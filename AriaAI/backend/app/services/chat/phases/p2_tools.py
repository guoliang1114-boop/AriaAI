"""P2 — Tool execution phase.

Executes every ``tool_use`` block detected in P1, handles Markdown / Office / PPT
special cases, collects artifacts, and manages workflow status events.
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_tools import (
    ChatRuntime,
    _summarize_tool_result,
    _tool_progress_payload,
)
from app.services.policy_guards import policy_allows_tool
from app.services.chat_artifacts import (
    _extract_artifact,
    _repair_digital_strategy_ppt_tool_input,
    _route_ppt_tool_for_skill,
)
from app.services.chat.state import ChatSessionState
from app.services.chat.pending_actions import tool_confirmation_token
from app.services.chat.sse import sse_event, await_with_heartbeat
from app.services.chat.workflow import workflow_status, workflow_plan_events
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.tool_repair import repair_project_office_tool_input
from app.tools import registry
from app.tools.office_documents import (
    MANAGE_PROJECT_FILES_TOOL_NAME,
    MANAGE_PROJECT_FOLDERS_TOOL_NAME,
    WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
)
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME

logger = logging.getLogger(__name__)

_PROJECT_MARKDOWN_TOOLS = frozenset({PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME})
_PROJECT_OFFICE_TOOLS = frozenset({WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME})
_PROJECT_SPACE_MANAGEMENT_TOOLS = frozenset({MANAGE_PROJECT_FILES_TOOL_NAME, MANAGE_PROJECT_FOLDERS_TOOL_NAME})
_MAX_TOOL_ATTEMPTS = 2
_CONFIRMATION_POLICIES = {ActionPolicy.MODIFY_EXISTING_FILE, ActionPolicy.DESTRUCTIVE_ACTION}
_tool_confirmation_token = tool_confirmation_token


def _result_failed(result: dict | None) -> bool:
    if not isinstance(result, dict):
        return True
    return result.get("status") == "error" or result.get("success") is False or bool(result.get("error"))


def _should_retry_tool(runtime: ChatRuntime, tool_name: str) -> bool:
    contract = getattr(runtime, "artifact_contract", None)
    allowed_tools = set(getattr(contract, "allowed_tools", ()) or ())
    if getattr(contract, "delivery_required", False) and tool_name in allowed_tools:
        return True
    return tool_name in _PROJECT_OFFICE_TOOLS


def _action_policy_value(value) -> str:
    return str(getattr(value, "value", value) or "")


def _tool_requires_confirmation(
    required_policy: ActionPolicy,
    tool_name: str,
    tool_input: dict,
    req: SendMessageRequest,
) -> bool:
    if required_policy not in _CONFIRMATION_POLICIES:
        return False
    confirmations = set(getattr(req, "action_confirmations", []) or [])
    return tool_confirmation_token(tool_name, tool_input) not in confirmations


def _build_pending_action_payload(tool_name: str, tool_input: dict, details: list[str], token: str) -> dict | None:
    """Build a HITAS pending-action payload to be persisted in P4."""
    action = str(tool_input.get("action") or "").lower()
    if tool_name == MANAGE_PROJECT_FILES_TOOL_NAME and action == "delete":
        file_ids = tool_input.get("file_ids") or []
        if tool_input.get("file_id") is not None:
            file_ids = [*file_ids, tool_input["file_id"]]
        return {
            "action_type": "delete_files",
            "title": "确认删除项目文件",
            "description": f"即将删除 {len(file_ids)} 个项目空间中的文件。此操作不可撤销。",
            "details": details,
            "tool_name": tool_name,
            "tool_input": tool_input,
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
            "confirmation_token": token,
        }
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        return {
            "action_type": "modify_document",
            "title": "确认修改文档",
            "description": "即将修改项目 Markdown 文档内容。",
            "details": details,
            "tool_name": tool_name,
            "tool_input": tool_input,
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
            "confirmation_token": token,
        }
    return None


def _tool_confirmation_details(tool_name: str, tool_input: dict) -> list[str]:
    if tool_name == MANAGE_PROJECT_FILES_TOOL_NAME and str(tool_input.get("action") or "").lower() == "delete":
        ids = tool_input.get("file_ids") or []
        if tool_input.get("file_id") is not None:
            ids = [*ids, tool_input["file_id"]]
        details = [f"待删除文件 ID：{', '.join(str(item) for item in ids)}"] if ids else []
        if tool_input.get("reason"):
            details.append(f"删除原因：{tool_input['reason']}")
        return details
    return []


def _repair_project_markdown_tool_input(tool_name: str, tool_input: dict) -> tuple[dict, list[str]]:
    """Normalize project markdown read/write tool arguments before execution.

    LLMs occasionally call ``read_project_markdown_document`` without the
    required ``action`` field. The safest default is ``list``: it is read-only,
    gives the model a file index, and avoids surfacing a raw Python signature
    error to the user.
    """
    repaired = dict(tool_input or {})
    changes: list[str] = []
    if tool_name == READ_MARKDOWN_TOOL_NAME and not repaired.get("action"):
        if repaired.get("file_id") is not None or repaired.get("file_name"):
            repaired["action"] = "read"
        else:
            repaired["action"] = "list"
        changes.append(f"补齐 Markdown 读取动作：{repaired['action']}")
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME and not repaired.get("mode"):
        repaired["mode"] = "replace" if repaired.get("file_id") is not None else "create"
        changes.append(f"补齐 Markdown 写入模式：{repaired['mode']}")
    return repaired, changes


async def run_p2_tools(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Execute all tools planned in P1.

    Populates:
    * ``state.tool_result_blocks``
    * ``state.tool_call_events``
    * ``state.artifacts``
    * ``state.pending_markdown_saves``
    * ``state.workflow_started``
    * ``state.stage_timings["tools_total_ms"]``
    """
    state.workflow_started = True

    for workflow_event in workflow_plan_events():
        yield sse_event(workflow_event)

    yield sse_event(
        workflow_status(
            step_index=3,
            step_total=4,
            title="执行 Skill / 工具",
            stage="tools",
            message="第 3 步：正在执行规划好的 Skill 或工具调用。",
        )
    )
    yield sse_event(
        {"type": "status", "stage": "tools", "message": "模型已完成初稿规划，正在执行所需工具..."}
    )

    tool_result_blocks: list[dict] = []
    tools_started_at = time.perf_counter()

    for tool_data in state.tool_use_blocks:
        tool_name = tool_data.get("name", "")
        tool_input = tool_data.get("input", {})
        tool_id = tool_data.get("id", "")

        if not tool_name or not isinstance(tool_input, dict):
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps({"error": "Invalid tool name or input"}, ensure_ascii=False),
                }
            )
            continue

        # Route / repair tool input
        tool_name, tool_input = _route_ppt_tool_for_skill(runtime, tool_name, tool_input)
        tool_input = _repair_digital_strategy_ppt_tool_input(
            runtime, tool_name, tool_input, state.text_buffer, force_rebuild=state.p1_truncated
        )
        if tool_name in _PROJECT_MARKDOWN_TOOLS and runtime.project_id is not None:
            tool_input = {**tool_input, "project_id": runtime.project_id}
            tool_input, repaired_changes = _repair_project_markdown_tool_input(tool_name, tool_input)
            if repaired_changes:
                state.record_trace_event(
                    "tool_input_repaired",
                    stage="p2",
                    tool_name=tool_name,
                    changes=repaired_changes,
                )
                yield sse_event(
                    workflow_status(
                        step_index=3,
                        step_total=4,
                        title="执行 Skill / 工具",
                        stage="tools",
                        message=f"第 3 步：已补齐 Markdown 工具参数（{'；'.join(repaired_changes)}）。",
                    )
                )
        if tool_name in _PROJECT_OFFICE_TOOLS and runtime.project_id is not None:
            tool_input = {**tool_input, "project_id": runtime.project_id}
            tool_input, repaired_changes = repair_project_office_tool_input(req.content, tool_input)
            if repaired_changes:
                state.record_trace_event(
                    "tool_input_repaired",
                    stage="p2",
                    tool_name=tool_name,
                    changes=repaired_changes,
                )
                yield sse_event(
                    workflow_status(
                        step_index=3,
                        step_total=4,
                        title="执行 Skill / 工具",
                        stage="tools",
                        message=f"第 3 步：已补齐文件生成参数（{'；'.join(repaired_changes)}）。",
                        )
                    )
        if tool_name in _PROJECT_SPACE_MANAGEMENT_TOOLS and runtime.project_id is not None:
            tool_input = {**tool_input, "project_id": runtime.project_id}

        allowed, block_reason, required_policy = policy_allows_tool(runtime.action_policy, tool_name, tool_input)
        if not allowed:
            logger.warning(
                "[P2] blocked tool by action policy. tool=%s required=%s policy=%s reason=%s",
                tool_name,
                required_policy.value,
                runtime.action_policy,
                block_reason,
            )
            skipped_output = {
                "skipped": True,
                "reason": block_reason,
                "required_policy": required_policy.value,
                "current_policy": str(getattr(runtime.action_policy, "value", runtime.action_policy)),
            }
            skip_result = {
                "type": "tool_result",
                "tool_name": tool_name,
                "status": "skipped",
                "success": True,
                "output": skipped_output,
            }
            state.tool_call_events.append(
                {
                    "tool_name": tool_name,
                    "status": "blocked",
                    "message": "工具调用已被本轮 ActionPolicy 阻止。",
                    "summary": block_reason,
                    "required_policy": required_policy.value,
                }
            )
            state.record_trace_event(
                "tool_blocked",
                stage="p2",
                tool_name=tool_name,
                reason=block_reason,
                required_policy=required_policy.value,
                current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
            )
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(skipped_output, ensure_ascii=False),
                }
            )
            yield sse_event({"type": "tool_result", "result": skip_result})
            continue
        if _tool_requires_confirmation(required_policy, tool_name, tool_input, req):
            state.confirmation_requested = True
            confirmation_token = tool_confirmation_token(tool_name, tool_input)
            confirmation_details = _tool_confirmation_details(tool_name, tool_input)
            confirmation_output = {
                "skipped": True,
                "requires_confirmation": True,
                "confirmation_token": confirmation_token,
                "reason": "需要用户确认后才能执行修改或危险操作。",
                "current_policy": _action_policy_value(runtime.action_policy),
            }
            # ── HITAS: Build server-side pending action payload for P4 persistence ──
            hitas_action = _build_pending_action_payload(tool_name, tool_input, confirmation_details, confirmation_token)
            if hitas_action:
                state.pending_tool_actions.append(hitas_action)
            state.tool_call_events.append(
                {
                    "tool_name": tool_name,
                    "status": "confirmation_required",
                    "message": "该工具会修改或删除项目内容，已暂停等待用户确认。",
                    "summary": confirmation_output["reason"],
                    "confirmation_token": confirmation_token,
                    "details": confirmation_details,
                }
            )
            state.pending_tool_confirmations.append(
                {
                    "confirmation_token": confirmation_token,
                    "tool_name": tool_name,
                    "tool_input": tool_input,
                    "tool_use_id": tool_id,
                    "details": confirmation_details,
                    "summary": confirmation_output["reason"],
                    "stage": "p2",
                }
            )
            state.record_trace_event(
                "tool_confirmation_required",
                stage="p2",
                tool_name=tool_name,
                confirmation_token=confirmation_token,
                current_policy=_action_policy_value(runtime.action_policy),
            )
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(confirmation_output, ensure_ascii=False),
                }
            )
            yield sse_event(
                workflow_status(
                    step_index=3,
                    step_total=4,
                    title="执行 Skill / 工具",
                    stage="tools",
                    status="confirmation_required",
                    message="第 3 步：该操作会修改或删除项目内容，已暂停等待确认。",
                )
            )
            yield sse_event(
                {
                    "type": "tool_result",
                    "result": {
                        "type": "tool_result",
                        "tool_name": tool_name,
                        "status": "confirmation_required",
                        "summary": confirmation_output["reason"],
                        "confirmation_token": confirmation_token,
                        "details": confirmation_details,
                        "output": confirmation_output,
                    },
                }
            )
            break

        # ---- Markdown write tool (special inline handling) ----
        if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None:
            markdown_content = str(tool_input.get("content") or "").strip()
            if markdown_content:
                if state.text_buffer.strip():
                    state.text_buffer = f"{state.text_buffer.rstrip()}\n\n{markdown_content}"
                    yield sse_event({"type": "text", "content": f"\n\n{markdown_content}"})
                else:
                    state.text_buffer = markdown_content
                    yield sse_event({"type": "text", "content": markdown_content})

            write_result = None
            try:
                write_result = await registry.execute(tool_name, tool_input)
                artifact = _extract_artifact(write_result)
                if artifact:
                    state.artifacts.append(artifact)

                write_failed = write_result.get("status") == "error" or write_result.get("success") is False
                output = write_result.get("output", write_result)
                if write_failed:
                    state.tool_call_events.append(
                        {
                            "tool_name": tool_name,
                            "status": "error",
                            "message": "写入项目 Markdown 文件失败。",
                            "summary": _summarize_tool_result(write_result),
                            "error": str(
                                write_result.get("error")
                                or (output.get("error") if isinstance(output, dict) else "")
                            ),
                        }
                    )
                else:
                    state.pending_markdown_saves.append(
                        {
                            "tool_use_id": tool_id,
                            "project_id": runtime.project_id,
                            "file_id": output.get("project_file_id") or output.get("id")
                            if isinstance(output, dict)
                            else tool_input.get("file_id"),
                            "file_name": output.get("name") if isinstance(output, dict) else tool_input.get("file_name"),
                            "mode": tool_input.get("mode"),
                            "content": markdown_content,
                            "summary": tool_input.get("summary"),
                            "folder_id": output.get("folder_id") if isinstance(output, dict) else tool_input.get("folder_id"),
                            "saved": True,
                            "original_content": output.get("original_content") if isinstance(output, dict) else None,
                        }
                    )
                    state.tool_call_events.append(
                        {
                            "tool_name": tool_name,
                            "status": "completed",
                            "message": "已写入项目 Markdown 文件。",
                            "summary": _summarize_tool_result(write_result),
                        }
                    )
                yield sse_event({"type": "tool_result", "result": write_result})
            except Exception as exc:
                write_result = {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "status": "error",
                    "error": str(exc),
                }
                state.tool_call_events.append(
                    {
                        "tool_name": tool_name,
                        "status": "error",
                        "message": f"写入失败: {exc}",
                        "summary": "写入项目 Markdown 文件失败",
                        "error": str(exc),
                    }
                )
                yield sse_event({"type": "tool_result", "result": write_result})

            output = write_result.get("output", write_result) if write_result else {"error": "No result"}
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(output, ensure_ascii=False),
                }
            )
            continue

        # ---- Normal tool execution ----
        yield sse_event(
            {"type": "tool_executing", "tool_name": tool_name, **_tool_progress_payload(tool_name, tool_input)}
        )
        logger.info(f"[P2] executing tool: {tool_name}, input_keys={list(tool_input.keys())}")

        tool_started_at = time.perf_counter()
        max_attempts = _MAX_TOOL_ATTEMPTS if _should_retry_tool(runtime, tool_name) else 1
        result = None
        for attempt in range(1, max_attempts + 1):
            try:
                result = None
                async for event in await_with_heartbeat(
                    registry.execute(tool_name, tool_input),
                    stage="tool_running",
                    message=f"{tool_name} 正在执行中，文件生成类任务可能需要 1-2 分钟...",
                ):
                    if event.get("type") == "result":
                        result = event.get("result")
                    else:
                        yield sse_event(event)
                if result is None:
                    result = {
                        "type": "tool_result",
                        "tool_name": tool_name,
                        "status": "error",
                        "error": "Tool returned no result",
                    }
            except Exception as exc:
                result = {"type": "tool_result", "tool_name": tool_name, "status": "error", "error": str(exc)}
            if not _result_failed(result) or attempt >= max_attempts:
                break
            state.record_trace_event(
                "tool_retry",
                stage="p2",
                tool_name=tool_name,
                attempt=attempt + 1,
                max_attempts=max_attempts,
                reason=_summarize_tool_result(result),
            )
            yield sse_event(
                workflow_status(
                    step_index=3,
                    step_total=4,
                    title="执行 Skill / 工具",
                    stage="tools",
                    message=f"第 3 步：{tool_name} 首次执行失败，正在自动重试一次。",
                )
            )

        logger.info(f"[P2] tool result: status={result.get('status')}, keys={list(result.keys())}")
        yield sse_event({"type": "tool_result", "result": result})
        tool_duration_ms = round((time.perf_counter() - tool_started_at) * 1000)
        yield sse_event(
            {"type": "timing", "key": f"tool:{tool_name}", "duration_ms": tool_duration_ms}
        )

        state.tool_call_events.append(
            {
                "tool_name": tool_name,
                "status": "error"
                if result.get("status") == "error" or result.get("success") is False
                else "completed",
                "message": _tool_progress_payload(tool_name, tool_input).get("message", ""),
                "summary": _summarize_tool_result(result),
                "duration_ms": tool_duration_ms,
                **({"error": str(result.get("error"))} if result.get("error") else {}),
            }
        )

        artifact = _extract_artifact(result)
        if artifact:
            state.artifacts.append(artifact)

        output = result.get("output", result)
        tool_result_blocks.append(
            {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": json.dumps(output, ensure_ascii=False),
            }
        )

    logger.info(f"[P2] done. tool_result_blocks={len(tool_result_blocks)}")
    if state.tool_use_blocks:
        state.stage_timings["tools_total_ms"] = round((time.perf_counter() - tools_started_at) * 1000)
        yield sse_event(
            {
                "type": "timing",
                "key": "tools_total_ms",
                "duration_ms": state.stage_timings["tools_total_ms"],
            }
        )
        has_tool_error = any(event.get("status") == "error" for event in state.tool_call_events)
        has_confirmation = state.confirmation_requested
        yield sse_event(
            workflow_status(
                step_index=3,
                step_total=4,
                title="执行 Skill / 工具",
                stage="tools",
                status="confirmation_required" if has_confirmation else "error" if has_tool_error else "completed",
                message=(
                    "第 3 步：后续工具调用涉及修改或删除，等待确认后再执行。"
                    if has_confirmation
                    else
                    "第 3 步：工具执行遇到错误，正在整理可恢复信息。"
                    if has_tool_error
                    else "第 3 步：Skill / 工具调用已完成。"
                ),
            )
        )
    elif not state.text_buffer.strip():
        yield sse_event(
            {"type": "status", "stage": "finalizing", "message": "模型已返回，正在整理结果..."}
        )

    state.tool_result_blocks = tool_result_blocks
