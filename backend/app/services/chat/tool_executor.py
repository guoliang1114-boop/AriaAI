"""Unified tool execution for the agent loop.

This module owns all tool-handling logic invoked from the agent loop:

* Tool input routing & repair (PPT, Markdown, Office)
* Action-policy gate
* HITAS confirmation detection + pending action payload construction
* Tool invocation (with retry for Office docs)
* Write-result validation
* Artifact extraction
* SSE event production
* Mutation of ``ChatSessionState`` (tool_call_events, artifacts, trace_events,
  pending_markdown_saves, pending_tool_actions, pending_tool_confirmations,
  confirmation_requested)

The caller (``agent_loop.run_agent_loop``) only receives a ``ToolOutcome``
describing what to feed back to the LLM and which extra SSE events to stream.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.output_buffer import serialize_tool_output
from app.services.agent_harness.tool_policy import PolicyDecision, evaluate_tool_policy
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.pending_actions import tool_confirmation_token
from app.services.chat.sse import await_with_heartbeat, sse_event
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_repair import repair_project_office_tool_input
from app.services.chat.tool_validation import validate_write_tool_result, validation_error_result
from app.services.chat_artifacts import (
    _extract_artifact,
    _repair_digital_strategy_ppt_tool_input,
    _repair_skill_ppt_tool_input,
    _route_ppt_tool_for_skill,
)
from app.services.chat_tools import (
    ChatRuntime,
    _summarize_tool_result,
    _tool_progress_payload,
)
from app.tools import registry
from app.tools.capabilities import (
    TOOL_CAPABILITY_MANIFEST_VERSION,
    ToolRetryMode,
    resolve_tool_capability,
    tool_is_project_scoped,
)
from app.tools.office_documents import (
    MANAGE_PROJECT_FILES_TOOL_NAME,
    MANAGE_PROJECT_FOLDERS_TOOL_NAME,
    WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
)
from app.tools.project_markdown import (
    PROJECT_MARKDOWN_TOOL_NAME,
    READ_MARKDOWN_TOOL_NAME,
    prepare_project_markdown_action_input,
)

logger = logging.getLogger(__name__)

_PROJECT_MARKDOWN_TOOLS = frozenset({PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME})
_PROJECT_OFFICE_TOOLS = frozenset({WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME})
_MAX_TOOL_ATTEMPTS = 2
_TRANSIENT_FAILURE_MARKERS = (
    "429",
    "rate limit",
    "temporarily",
    "timeout",
    "timed out",
    "connection reset",
    "connection refused",
    "service unavailable",
    "overloaded",
    "tool returned no result",
)


# ----------------------------------------------------------------------
# ToolOutcome — return contract to the agent loop
# ----------------------------------------------------------------------


@dataclass
class ToolOutcome:
    """What the agent loop needs back after executing one tool_use block."""

    result_block: dict  # the ``tool_result`` dict to feed back to the LLM
    events: list[str] = field(default_factory=list)  # extra SSE frames to yield
    confirmation_required: bool = False
    markdown_inline_text: str = ""  # text already emitted via state (do not re-emit)


# ----------------------------------------------------------------------
# Helpers (private)
# ----------------------------------------------------------------------


def _action_policy_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def _result_failed(result: dict | None) -> bool:
    if not isinstance(result, dict):
        return True
    return result.get("status") == "error" or result.get("success") is False or bool(result.get("error"))


def _should_retry_tool(runtime: ChatRuntime, tool_name: str, tool_input: dict[str, Any]) -> bool:
    capability = resolve_tool_capability(tool_name, tool_input)
    if capability.retry_mode is not ToolRetryMode.ARTIFACT:
        return False
    contract = getattr(runtime, "artifact_contract", None)
    allowed_tools = set(getattr(contract, "allowed_tools", ()) or ())
    if getattr(contract, "delivery_required", False) and tool_name in allowed_tools:
        return True
    return True


def _is_safe_read_retry_tool(tool_name: str, tool_input: dict[str, Any]) -> bool:
    return resolve_tool_capability(tool_name, tool_input).retry_mode is ToolRetryMode.TRANSIENT_READ


def _capability_record_fields(tool_name: str, tool_input: dict[str, Any] | None = None) -> dict[str, Any]:
    capability = resolve_tool_capability(tool_name, tool_input)
    return {
        "capability_version": TOOL_CAPABILITY_MANIFEST_VERSION,
        "tool_effect": capability.effect.value,
        "result_kind": capability.result_kind.value,
        "retry_mode": capability.retry_mode.value,
        "product_event": capability.product_event.value,
    }


def _is_transient_failure(result: dict | None) -> bool:
    if not _result_failed(result):
        return False
    rendered = json.dumps(result or {}, ensure_ascii=False, default=str).lower()
    return any(marker in rendered for marker in _TRANSIENT_FAILURE_MARKERS)


def _result_has_persisted_artifact_evidence(result: dict | None) -> bool:
    """Avoid replay when a failed response may already have produced a file."""

    if not isinstance(result, dict):
        return False
    output = result.get("output") if isinstance(result.get("output"), dict) else result
    return bool(
        output.get("project_file_id")
        or output.get("file_id")
        or output.get("path")
        or output.get("file_path")
    )


def _blocked_tool_output(*, block_reason: str, required_policy: ActionPolicy, current_policy: Any) -> dict:
    return {
        "ok": False,
        "success": False,
        "skipped": True,
        "status": "blocked",
        "not_executed": True,
        "error": f"工具调用未执行：{block_reason}",
        "reason": block_reason,
        "required_policy": required_policy.value,
        "current_policy": _action_policy_value(current_policy),
        "assistant_instruction": (
            "Do not claim the operation is complete. Tell the user it was not executed and "
            "needs the proper action policy or confirmation."
        ),
    }


def _repair_project_markdown_tool_input(tool_name: str, tool_input: dict) -> tuple[dict, list[str]]:
    repaired = dict(tool_input or {})
    changes: list[str] = []
    if tool_name == READ_MARKDOWN_TOOL_NAME and not repaired.get("action"):
        repaired["action"] = "read" if (repaired.get("file_id") is not None or repaired.get("file_name")) else "list"
        changes.append(f"补齐 Markdown 读取动作：{repaired['action']}")
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME and not repaired.get("mode"):
        if repaired.get("patch"):
            repaired["mode"] = "patch"
        elif repaired.get("version_id") is not None:
            repaired["mode"] = "rollback"
        else:
            repaired["mode"] = "replace" if repaired.get("file_id") is not None else "create"
        changes.append(f"补齐 Markdown 写入模式：{repaired['mode']}")
    allowed_keys = (
        {"project_id", "action", "file_id", "file_name", "max_chars"}
        if tool_name == READ_MARKDOWN_TOOL_NAME
        else {
            "project_id",
            "mode",
            "file_id",
            "file_name",
            "content",
            "patch",
            "base_sha256",
            "version_id",
            "summary",
            "folder_id",
            "folder_name",
        }
    )
    dropped = sorted(k for k in repaired if k not in allowed_keys)
    for k in dropped:
        repaired.pop(k, None)
    if dropped:
        changes.append(f"移除 Markdown 工具不支持的参数：{', '.join(dropped)}")
    return repaired, changes


def _confirmation_details(tool_name: str, tool_input: dict) -> list[str]:
    action = str(tool_input.get("action") or "").lower()
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        mode = str(tool_input.get("mode") or "").lower()
        frozen = tool_input.get("_aria_patch_preflight")
        if mode in {"patch", "rollback"} and isinstance(frozen, dict):
            details = [
                f"目标文档：{frozen.get('target_name') or tool_input.get('file_id')}",
                f"基线版本：{str(frozen.get('base_sha256') or '')[:12]}",
                f"确认后版本：{str(frozen.get('result_sha256') or '')[:12]}",
                f"原子变更片段：{int(frozen.get('replacement_count') or 0)}",
            ]
            if mode == "rollback":
                details.append(f"回滚目标版本 ID：{frozen.get('rollback_target_version_id')}")
            preview = str(frozen.get("preview_diff") or "").strip()
            if preview:
                suffix = "\n（预览已截断）" if frozen.get("preview_truncated") else ""
                details.append(f"Diff 预览：\n```diff\n{preview}\n```{suffix}")
            return details
    if tool_name == MANAGE_PROJECT_FILES_TOOL_NAME and action == "delete":
        ids = list(tool_input.get("file_ids") or [])
        if tool_input.get("file_id") is not None:
            ids.append(tool_input["file_id"])
        details = [f"待删除文件 ID：{', '.join(str(i) for i in ids)}"] if ids else []
        if tool_input.get("reason"):
            details.append(f"删除原因：{tool_input['reason']}")
        return details
    if tool_name == MANAGE_PROJECT_FOLDERS_TOOL_NAME:
        details: list[str] = []
        if action == "move_file":
            file_label = tool_input.get("file_id") or tool_input.get("file_name")
            folder_label = tool_input.get("folder_id") or tool_input.get("folder_name")
            if file_label:
                details.append(f"待移动文件：{file_label}")
            if folder_label:
                details.append(f"目标文件夹：{folder_label}")
        elif action == "rename":
            folder_label = tool_input.get("folder_id") or tool_input.get("folder_name")
            if folder_label:
                details.append(f"待重命名文件夹：{folder_label}")
            if tool_input.get("new_name"):
                details.append(f"新名称：{tool_input['new_name']}")
        elif action == "create":
            folder_label = tool_input.get("new_name") or tool_input.get("folder_name")
            if folder_label:
                details.append(f"新建文件夹：{folder_label}")
        elif action == "delete":
            folder_label = tool_input.get("folder_id") or tool_input.get("folder_name")
            if folder_label:
                details.append(f"待删除文件夹：{folder_label}")
        return details
    return []


def _build_pending_action_payload(
    tool_name: str,
    tool_input: dict,
    details: list[str],
    token: str,
    required_policy: ActionPolicy,
) -> dict | None:
    action = str(tool_input.get("action") or "").lower()
    risk_level = (
        "destructive"
        if required_policy is ActionPolicy.DESTRUCTIVE_ACTION
        else "high"
        if required_policy in {
            ActionPolicy.MODIFY_EXISTING_FILE,
            ActionPolicy.DURABLE_TASK,
        }
        else "medium"
    )
    if tool_name == MANAGE_PROJECT_FILES_TOOL_NAME and action == "delete":
        file_ids = list(tool_input.get("file_ids") or [])
        if tool_input.get("file_id") is not None:
            file_ids.append(tool_input["file_id"])
        return {
            "action_type": "delete_files",
            "title": "确认删除项目文件",
            "description": f"即将删除 {len(file_ids)} 个项目空间中的文件。此操作不可撤销。",
            "details": details,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "risk_level": risk_level,
            "confirmation_token": token,
        }
    if tool_name == MANAGE_PROJECT_FOLDERS_TOOL_NAME and action == "delete":
        return {
            "action_type": "delete_folder",
            "title": "确认删除文件夹",
            "description": "即将删除项目空间中的文件夹。此操作不可撤销。",
            "details": details,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "risk_level": risk_level,
            "confirmation_token": token,
        }
    if tool_name == MANAGE_PROJECT_FOLDERS_TOOL_NAME and action == "move_file":
        return {
            "action_type": "move_project_file",
            "title": "确认移动项目文件",
            "description": "即将把项目空间中的文件移动到指定文件夹。",
            "details": details,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "risk_level": risk_level,
            "confirmation_token": token,
        }
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        mode = str(tool_input.get("mode") or "").lower()
        return {
            "action_type": "modify_document",
            "title": "确认回滚文档" if mode == "rollback" else "确认修改文档",
            "description": (
                "即将按已预览的版本差异回滚项目 Markdown 文档；执行前会再次校验基线。"
                if mode == "rollback"
                else "即将按已预览的结构化 Diff 修改项目 Markdown 文档；执行前会再次校验基线。"
            ),
            "details": details,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "risk_level": risk_level,
            "confirmation_token": token,
        }
    if tool_name == WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME:
        return {
            "action_type": "write_document",
            "title": "确认生成文档",
            "description": "即将生成新的 Office 文档并保存到项目空间。",
            "details": details,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "risk_level": risk_level,
            "confirmation_token": token,
        }
    return {
        "action_type": "tool_action_requires_confirmation",
        "title": f"确认执行 {tool_name}",
        "description": "该操作会修改项目内容或执行高风险动作，确认后将按已保存的工具参数执行。",
        "details": details,
        "tool_name": tool_name,
        "tool_input": tool_input,
        "risk_level": risk_level,
        "confirmation_token": token,
    }


def _apply_input_repair(
    runtime: ChatRuntime,
    state: ChatSessionState,
    *,
    tool_name: str,
    tool_input: dict,
    request_content: str,
    step_text: str,
    step_truncated: bool,
    step_index: int,
) -> tuple[str, dict]:
    """Route + repair tool input. Mutates ``state.trace_events`` on changes."""
    tool_name, tool_input = _route_ppt_tool_for_skill(runtime, tool_name, tool_input)
    tool_input = _repair_digital_strategy_ppt_tool_input(
        runtime, tool_name, tool_input, step_text, force_rebuild=step_truncated
    )
    tool_input, ppt_changes = _repair_skill_ppt_tool_input(
        runtime,
        tool_name,
        tool_input,
        f"{request_content}\n\n{step_text}",
        force_rebuild=step_truncated,
    )
    if ppt_changes:
        state.record_trace_event(
            "tool_input_repaired",
            stage=f"step_{step_index}",
            tool_name=tool_name,
            changes=ppt_changes,
        )

    if runtime.project_id is not None and tool_is_project_scoped(tool_name):
        tool_input = {**tool_input, "project_id": runtime.project_id}

    if tool_name in _PROJECT_MARKDOWN_TOOLS and runtime.project_id is not None:
        tool_input, md_changes = _repair_project_markdown_tool_input(tool_name, tool_input)
        if md_changes:
            state.record_trace_event(
                "tool_input_repaired",
                stage=f"step_{step_index}",
                tool_name=tool_name,
                changes=md_changes,
            )

    if tool_name in _PROJECT_OFFICE_TOOLS:
        tool_input, office_changes = repair_project_office_tool_input(
            request_content, tool_input, infer_file_type_from_content=True
        )
        if office_changes:
            state.record_trace_event(
                "tool_input_repaired",
                stage=f"step_{step_index}",
                tool_name=tool_name,
                changes=office_changes,
            )

    return tool_name, tool_input


def _handle_blocked(
    *,
    state: ChatSessionState,
    tool_name: str,
    tool_input: dict[str, Any],
    tool_id: str,
    block_reason: str,
    required_policy: ActionPolicy,
    current_policy: Any,
    step_index: int,
) -> ToolOutcome:
    skipped_output = _blocked_tool_output(
        block_reason=block_reason, required_policy=required_policy, current_policy=current_policy
    )
    skip_result = {
        "type": "tool_result",
        "tool_use_id": tool_id,
        "tool_name": tool_name,
        "status": "blocked",
        "success": False,
        "error": skipped_output["error"],
        "output": skipped_output,
    }
    state.record_tool_execution(
        {
            "tool_use_id": tool_id,
            "tool_name": tool_name,
            "step_index": step_index,
            "status": "blocked",
            "message": "工具调用已被本轮 ActionPolicy 阻止。",
            "summary": block_reason,
            "required_policy": required_policy.value,
            "attempt_count": 0,
            "max_attempts": 0,
            "retryable": False,
            **_capability_record_fields(tool_name, tool_input),
        }
    )
    state.record_trace_event(
        "tool_blocked",
        stage=f"step_{step_index}",
        tool_name=tool_name,
        reason=block_reason,
        required_policy=required_policy.value,
        current_policy=_action_policy_value(current_policy),
    )
    return ToolOutcome(
        result_block={
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps(skipped_output, ensure_ascii=False),
        },
        events=[sse_event({"type": "tool_result", "result": skip_result})],
    )


def _handle_confirmation(
    *,
    runtime: ChatRuntime,
    state: ChatSessionState,
    tool_name: str,
    tool_input: dict,
    required_policy: ActionPolicy,
    tool_id: str,
    step_index: int,
) -> ToolOutcome:
    state.confirmation_requested = True
    token = tool_confirmation_token(tool_name, tool_input)
    details = _confirmation_details(tool_name, tool_input)
    confirmation_output = {
        "ok": False,
        "success": False,
        "skipped": True,
        "requires_confirmation": True,
        "not_executed": True,
        "status": "confirmation_required",
        "confirmation_token": token,
        "reason": "需要用户确认后才能执行修改或危险操作。",
        "current_policy": _action_policy_value(runtime.action_policy),
        "assistant_instruction": "Do not claim the operation is complete. Tell the user it is waiting for confirmation.",
    }
    hitas = _build_pending_action_payload(
        tool_name,
        tool_input,
        details,
        token,
        required_policy,
    )
    if hitas:
        state.pending_tool_actions.append(hitas)
    state.record_tool_execution(
        {
            "tool_use_id": tool_id,
            "tool_name": tool_name,
            "step_index": step_index,
            "status": "confirmation_required",
            "message": "该工具会修改或删除项目内容，已暂停等待用户确认。",
            "summary": confirmation_output["reason"],
            "confirmation_token": token,
            "details": details,
            "attempt_count": 0,
            "max_attempts": 0,
            "retryable": False,
            **_capability_record_fields(tool_name, tool_input),
        }
    )
    state.pending_tool_confirmations.append(
        {
            "confirmation_token": token,
            "tool_name": tool_name,
            "tool_input": tool_input,
            "tool_use_id": tool_id,
            "details": details,
            "summary": confirmation_output["reason"],
            "stage": f"step_{step_index}",
        }
    )
    state.record_trace_event(
        "tool_confirmation_required",
        stage=f"step_{step_index}",
        tool_name=tool_name,
        confirmation_token=token,
        current_policy=_action_policy_value(runtime.action_policy),
        required_policy=required_policy.value,
    )

    sse_result = {
        "type": "tool_result",
        "tool_use_id": tool_id,
        "tool_name": tool_name,
        "status": "confirmation_required",
        "summary": confirmation_output["reason"],
        "confirmation_token": token,
        "details": details,
        "output": confirmation_output,
    }
    return ToolOutcome(
        result_block={
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps(confirmation_output, ensure_ascii=False),
        },
        events=[sse_event({"type": "tool_result", "result": sse_result})],
        confirmation_required=True,
    )


def _handle_patch_preflight_failure(
    *,
    state: ChatSessionState,
    tool_name: str,
    tool_input: dict[str, Any],
    tool_id: str,
    step_index: int,
    exc: HTTPException,
) -> ToolOutcome:
    detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail, ensure_ascii=False, default=str)
    output = {
        "ok": False,
        "success": False,
        "status": "conflict" if exc.status_code == 409 else "error",
        "not_executed": True,
        "error": detail,
        "http_status": exc.status_code,
        "assistant_instruction": (
            "Do not claim the edit is complete. Read the latest document and create a new patch when this is a conflict."
        ),
    }
    state.record_tool_execution(
        {
            "tool_use_id": tool_id,
            "tool_name": tool_name,
            "step_index": step_index,
            "status": output["status"],
            "message": "结构化文档变更预检失败，未创建审批动作。",
            "summary": detail,
            "error": detail,
            "attempt_count": 0,
            "max_attempts": 0,
            "retryable": exc.status_code == 409,
            **_capability_record_fields(tool_name, tool_input),
        }
    )
    state.record_trace_event(
        "structured_patch_preflight_failed",
        stage=f"step_{step_index}",
        tool_name=tool_name,
        status_code=exc.status_code,
        error=detail,
    )
    sse_result = {
        "type": "tool_result",
        "tool_use_id": tool_id,
        "tool_name": tool_name,
        "status": output["status"],
        "summary": detail,
        "output": output,
    }
    return ToolOutcome(
        result_block={
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": json.dumps(output, ensure_ascii=False),
        },
        events=[sse_event({"type": "tool_result", "result": sse_result})],
    )


# ----------------------------------------------------------------------
# Public entry point
# ----------------------------------------------------------------------


async def execute_tool_with_policy(
    runtime: ChatRuntime,
    state: ChatSessionState,
    tool_call: dict,
    *,
    req: SendMessageRequest,
    step_text: str,
    step_truncated: bool,
    step_index: int,
) -> ToolOutcome:
    """Run one tool_use block through the unified pipeline.

    The function is responsible for mutating ``state`` (tool_call_events,
    artifacts, etc.) and returning a ``ToolOutcome`` that the agent loop
    feeds back to the LLM and uses to drive the per-tool SSE event stream.
    """
    tool_name = str(tool_call.get("name") or "")
    tool_id = str(tool_call.get("id") or "")
    tool_input = tool_call.get("input") or {}

    if not tool_name or not isinstance(tool_input, dict):
        state.record_tool_execution(
            {
                "tool_use_id": tool_id,
                "tool_name": tool_name,
                "step_index": step_index,
                "status": "error",
                "message": "工具名称或参数格式无效，未执行。",
                "summary": "Invalid tool name or input",
                "error": "Invalid tool name or input",
                "attempt_count": 0,
                "max_attempts": 0,
                "retryable": False,
                **_capability_record_fields(
                    tool_name,
                    tool_input if isinstance(tool_input, dict) else None,
                ),
            }
        )
        return ToolOutcome(
            result_block={
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": json.dumps({"error": "Invalid tool name or input"}, ensure_ascii=False),
            }
        )

    request_content = getattr(req, "content", "") or ""
    tool_name, tool_input = _apply_input_repair(
        runtime,
        state,
        tool_name=tool_name,
        tool_input=tool_input,
        request_content=request_content,
        step_text=step_text,
        step_truncated=step_truncated,
        step_index=step_index,
    )

    # ---- policy ----
    evaluation = evaluate_tool_policy(runtime.action_policy, tool_name, tool_input)
    if evaluation.decision is PolicyDecision.FORBIDDEN:
        logger.warning(
            "[agent_loop] blocked tool by action policy. tool=%s required=%s policy=%s reason=%s",
            tool_name,
            evaluation.required_policy.value,
            runtime.action_policy,
            evaluation.reason,
        )
        return _handle_blocked(
            state=state,
            tool_name=tool_name,
            tool_input=tool_input,
            tool_id=tool_id,
            block_reason=evaluation.reason,
            required_policy=evaluation.required_policy,
            current_policy=runtime.action_policy,
            step_index=step_index,
        )

    # Patch preflight is read-only, but it still runs only after the Aria
    # action policy authorizes planning this mutation.
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        try:
            tool_input = prepare_project_markdown_action_input(tool_input)
        except HTTPException as exc:
            return _handle_patch_preflight_failure(
                state=state,
                tool_name=tool_name,
                tool_input=tool_input,
                tool_id=tool_id,
                step_index=step_index,
                exc=exc,
            )
        except Exception:
            logger.exception("[agent_loop] structured patch preflight failed unexpectedly")
            return _handle_patch_preflight_failure(
                state=state,
                tool_name=tool_name,
                tool_input=tool_input,
                tool_id=tool_id,
                step_index=step_index,
                exc=HTTPException(500, "Structured patch preflight failed; no approval action was created."),
            )

    # ---- HITAS confirmation ----
    if evaluation.requires_confirmation:
        return _handle_confirmation(
            runtime=runtime,
            state=state,
            tool_name=tool_name,
            tool_input=tool_input,
            required_policy=evaluation.required_policy,
            tool_id=tool_id,
            step_index=step_index,
        )

    # ---- Markdown write inline-display contract ----
    inline_text = ""
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None:
        markdown_content = str(tool_input.get("content") or "").strip()
        if markdown_content:
            inline_text = markdown_content

    events: list[str] = [
        sse_event(
            {
                "type": "tool_executing",
                "tool_use_id": tool_id,
                "tool_name": tool_name,
                **_tool_progress_payload(tool_name, tool_input),
            }
        )
    ]

    # ---- Execute (bounded retry for artifact tools and transient reads) ----
    started_at = time.perf_counter()
    retry_by_contract = _should_retry_tool(runtime, tool_name, tool_input)
    retry_safe_read = _is_safe_read_retry_tool(tool_name, tool_input)
    max_attempts = _MAX_TOOL_ATTEMPTS if retry_by_contract or retry_safe_read else 1
    result: dict | None = None
    attempt_count = 0
    for attempt in range(1, max_attempts + 1):
        attempt_count = attempt
        try:
            async for evt in await_with_heartbeat(
                registry.execute(tool_name, tool_input),
                stage="tool_running",
                message=f"{tool_name} 正在执行中，文件生成类任务可能需要 1-2 分钟...",
            ):
                if evt.get("type") == "result":
                    result = evt.get("result")
                else:
                    events.append(sse_event(evt))
            if result is None:
                result = {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "status": "error",
                    "error": "Tool returned no result",
                }
            if tool_name in _PROJECT_OFFICE_TOOLS:
                ok, err = validate_write_tool_result(tool_name, result, tool_input)
                if not ok:
                    result = validation_error_result(tool_name, result, err)
        except Exception as exc:
            result = {"type": "tool_result", "tool_name": tool_name, "status": "error", "error": str(exc)}

        should_retry_failure = (
            retry_by_contract and not _result_has_persisted_artifact_evidence(result)
        ) or (retry_safe_read and _is_transient_failure(result))
        if not _result_failed(result) or attempt >= max_attempts or not should_retry_failure:
            break
        state.record_trace_event(
            "tool_retry",
            stage=f"step_{step_index}",
            tool_name=tool_name,
            attempt=attempt + 1,
            max_attempts=max_attempts,
            reason=_summarize_tool_result(result),
        )

    assert result is not None  # for type-checkers; the retry loop guarantees this
    duration_ms = round((time.perf_counter() - started_at) * 1000)

    # ---- Artifact extraction ----
    artifact = _extract_artifact(
        result,
        tool_name=tool_name,
        tool_input=tool_input,
        tool_use_id=tool_id,
    )
    if artifact:
        state.record_artifact_output(
            artifact,
            source_tool=tool_name,
            tool_use_id=tool_id,
        )

    # ---- Markdown write side effects (pending_markdown_saves) ----
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None and not _result_failed(result):
        output_dict = result.get("output", result)
        state.pending_markdown_saves.append(
            {
                "tool_use_id": tool_id,
                "project_id": runtime.project_id,
                "file_id": (output_dict.get("project_file_id") or output_dict.get("id"))
                if isinstance(output_dict, dict)
                else tool_input.get("file_id"),
                "file_name": output_dict.get("name") if isinstance(output_dict, dict) else tool_input.get("file_name"),
                "mode": tool_input.get("mode"),
                "content": inline_text,
                "summary": tool_input.get("summary"),
                "folder_id": output_dict.get("folder_id") if isinstance(output_dict, dict) else tool_input.get("folder_id"),
                "saved": True,
                "original_content": output_dict.get("original_content") if isinstance(output_dict, dict) else None,
            }
        )

    # ---- Tool call audit event ----
    failed = _result_failed(result)
    failure_retryable = bool(
        failed
        and (
            (retry_by_contract and not _result_has_persisted_artifact_evidence(result))
            or (retry_safe_read and _is_transient_failure(result))
        )
    )
    state.record_tool_execution(
        {
            "tool_use_id": tool_id,
            "tool_name": tool_name,
            "step_index": step_index,
            "status": "error" if failed else "completed",
            "message": _tool_progress_payload(tool_name, tool_input).get("message", ""),
            "summary": _summarize_tool_result(result),
            "duration_ms": duration_ms,
            "attempt_count": attempt_count,
            "max_attempts": max_attempts,
            "retryable": failure_retryable,
            **_capability_record_fields(tool_name, tool_input),
            **({"error": str(result.get("error"))} if result.get("error") else {}),
        }
    )

    events.append(
        sse_event(
            {
                "type": "tool_result",
                "result": {**result, "tool_use_id": tool_id},
            }
        )
    )
    events.append(sse_event({"type": "timing", "key": f"tool:{tool_name}", "duration_ms": duration_ms}))

    output_payload = result.get("output", result)
    return ToolOutcome(
        result_block={
            "type": "tool_result",
            "tool_use_id": tool_id,
            "content": serialize_tool_output(output_payload),
        },
        events=events,
        markdown_inline_text=inline_text,
    )
