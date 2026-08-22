"""Persistence & finalization — the post-loop step.

Runs after the agent loop finishes: saves artifacts, builds metadata, persists the
assistant message, schedules title generation, and emits the final ``done`` event.
"""
from __future__ import annotations

import json
import hashlib
import logging
import re
import time
from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Any

from sqlalchemy import or_, update
from sqlmodel import Session, select

from app.routers.chat_schemas import SendMessageRequest
from app.config import UPLOADS_DIR
from app.services.agent_harness.approval_envelope import (
    APPROVAL_ENVELOPE_PREFIX,
    approval_envelope_hash,
    legacy_tool_input_hash,
)
from app.services.artifact_intent import ArtifactContract
from app.services.chat_tools import (
    ChatRuntime,
    _build_completed_skill_progress,
    _strip_internal_tool_markers,
    _summarize_tool_result,
)
from app.services.chat_artifacts import _build_artifact_notice, _extract_artifact, _repair_skill_ppt_tool_input
from app.models.db import PendingToolAction
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.pending_actions import build_project_file_cleanup_pending_action
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import init_default_project_folders
from app.services.project_documents import create_project_document_record
from app.services.time_utils import utc_now_naive
from app.services.chat_store import persist_assistant_message, persist_generated_artifacts
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event
from app.services.chat.trace import persist_chat_trace
from app.services.chat.workflow import workflow_status
from app.services.title_generator import schedule_title_generation
from app.tools import registry
from app.tools.office_documents import MANAGE_PROJECT_FILES_TOOL_NAME

logger = logging.getLogger(__name__)

_MARKDOWN_FILENAME_PATTERN = re.compile(
    r"(?:写入|保存到|保存为|保存成|存到|存为|另存为|命名为|文件名[:：]?)\s*([^\s，。；;、]+?\.md)",
    re.IGNORECASE,
)
_MARKDOWN_FILENAME_FALLBACK_PATTERN = re.compile(r"([^\s，。；;、]+?\.md)", re.IGNORECASE)
_COMPLETION_CLAIM_RE = re.compile(
    r"(已完成|已执行|已更新|已写入|已保存|已生成|已创建|已制作|已导出|已归类|已移动|已删除|"
    r"完成归类|处理完成|操作已完成|生成完成|制作完成|导出完成|"
    r"已经[^。；;，,\n]{0,24}(?:完成|更新|写入|保存|生成|创建|制作|导出|移动|删除|归类))"
)
_ARTIFACT_DELIVERY_CLAIM_RE = re.compile(
    r"((?:ppt|pptx|powerpoint|deck|幻灯片|演示文稿|excel|xlsx|word|docx|pdf|markdown|md|文件|文档|材料)"
    r"[^。；;\n]{0,48}(?:已生成|已保存|已创建|已制作|已导出|已经生成|已经保存|生成完成|制作完成|导出完成|"
    r"保存到项目空间|可下载|下载链接|点击下载))|"
    r"((?:已生成|已保存|已创建|已制作|已导出|保存到项目空间|下载链接|点击下载)"
    r"[^。；;\n]{0,48}(?:ppt|pptx|powerpoint|deck|幻灯片|演示文稿|excel|xlsx|word|docx|pdf|markdown|md|文件|文档|项目空间))|"
    r"(文件(?:已|已经)?(?:保存|生成|创建)[^。；;\n]{0,32}(?:项目空间|下载))",
    re.IGNORECASE,
)
_OWN_ARTIFACT_DELIVERY_MARKERS = (
    "我已",
    "我已经",
    "我为你",
    "我帮你",
    "已为你",
    "文件已保存",
    "文件已经保存",
    "保存到项目空间",
    "点击下载",
    "下载链接",
    "文件详情",
    "文件名",
)
_MUTATING_ACTION_POLICIES = {
    ActionPolicy.WRITE_ARTIFACT.value,
    ActionPolicy.MODIFY_EXISTING_FILE.value,
    ActionPolicy.DURABLE_TASK.value,
    ActionPolicy.DESTRUCTIVE_ACTION.value,
}
_MUTATING_TOOL_NAMES = {
    "write_project_office_document",
    "update_project_markdown_document",
    "save_previous_answer_as_markdown",
    "manage_project_files",
    "manage_project_folders",
    "generate_ppt",
    "generate_ppt_from_skill",
    "generate_docx",
    "generate_xlsx",
    "generate_pdf",
}
_PPT_GENERATION_TOOL_NAME = "generate_ppt_from_skill"


def _runtime_artifact_contract(runtime: ChatRuntime) -> ArtifactContract | None:
    contract = getattr(runtime, "artifact_contract", None)
    if isinstance(contract, ArtifactContract) and contract.delivery_required:
        return contract
    return None


def _delivery_satisfied(state: ChatSessionState, contract: ArtifactContract | None) -> bool:
    if not contract or not contract.delivery_required:
        return True
    output_kind = (contract.output_kind or "").lower()
    if output_kind == "md" and state.pending_markdown_saves:
        return True
    for artifact in state.artifacts:
        file_type = str(artifact.get("file_type") or artifact.get("output_kind") or "").lower().lstrip(".")
        file_name = str(artifact.get("file_name") or artifact.get("name") or "").lower()
        if file_type == output_kind or (output_kind and file_name.endswith(f".{output_kind}")):
            return True
    for event in state.tool_call_events:
        if str(event.get("status") or "").lower() != "completed":
            continue
        artifact = event.get("artifact") or event.get("output") or {}
        if isinstance(artifact, dict):
            file_type = str(artifact.get("file_type") or artifact.get("output_kind") or "").lower().lstrip(".")
            file_name = str(artifact.get("file_name") or artifact.get("name") or "").lower()
            if file_type == output_kind or (output_kind and file_name.endswith(f".{output_kind}")):
                return True
    return False


def _tool_failure_detail_for_user(state: ChatSessionState) -> str:
    errors: list[str] = []
    for event in reversed(state.tool_call_events):
        if str(event.get("status") or "").lower() != "error":
            continue
        raw_error = str(event.get("error") or event.get("summary") or event.get("message") or "").strip()
        tool_name = str(event.get("tool_name") or "").strip()
        if not raw_error:
            continue
        if (
            ("generate_ppt_from_skill()" in raw_error and "missing" in raw_error)
            or ("missing required tool input" in raw_error.lower() and tool_name == _PPT_GENERATION_TOOL_NAME)
            or (
                str(event.get("error_type") or "") == "invalid_tool_input"
                and tool_name == _PPT_GENERATION_TOOL_NAME
            )
        ):
            return (
                "PPT 生成工具调用参数不完整，缺少 Skill、标题或页面结构参数。"
                "系统已记录具体工具错误，后续会自动尝试补齐后再执行。"
            )
        if "template not found" in raw_error:
            return "PPT 模板文件未找到，生成流程已停止以避免输出空白或低质量 deck。"
        if tool_name:
            errors.append(f"{tool_name}: {raw_error}")
        else:
            errors.append(raw_error)
    if not errors:
        return ""
    detail = errors[0]
    if len(detail) > 180:
        detail = f"{detail[:177]}..."
    return detail


def _delivery_failure_message(contract: ArtifactContract, state: ChatSessionState | None = None) -> str:
    kind = (contract.output_kind or "文件").upper()
    message = (
        f"抱歉，这次没有成功生成 {kind} 文件，因此我不会把正文文本当作交付物完成。\n\n"
        "请重试一次，或切换模型后再试；系统会保留这次失败记录，便于排查具体原因。"
    )
    if state is not None:
        detail = _tool_failure_detail_for_user(state)
        if detail:
            message = f"{message}\n\n失败原因：{detail}"
    return message


def _tool_result_failed(result: dict[str, Any] | None) -> bool:
    if not isinstance(result, dict):
        return True
    output = result.get("output") if isinstance(result.get("output"), dict) else {}
    return (
        result.get("status") == "error"
        or result.get("success") is False
        or bool(result.get("error"))
        or output.get("success") is False
        or bool(output.get("error"))
    )


def _remove_stale_ppt_failure_text(full_text: str) -> str:
    if "没有成功生成" not in full_text and "未能生成" not in full_text:
        return full_text
    cleaned = re.sub(
        r"抱歉[^\n]*(?:没有成功生成|未能生成)[^\n]*(?:PPTX|PPT|deck|幻灯片|演示文稿)[^\n]*"
        r"(?:\n\n请重试[^\n]*)?",
        "",
        full_text,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or full_text


async def _maybe_generate_missing_ppt_artifact(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    state: ChatSessionState,
    full_text: str,
    contract: ArtifactContract | None,
) -> bool:
    if not contract or (contract.output_kind or "").lower() != "pptx":
        return False
    if _delivery_satisfied(state, contract) or state.confirmation_requested:
        return False

    seed_input = {
        "skill_name": "presentation-builder",
        "template_key": "digital-strategy",
        "title": contract.title or "",
        "slides": [],
    }
    tool_input, repaired_changes = _repair_skill_ppt_tool_input(
        runtime,
        _PPT_GENERATION_TOOL_NAME,
        seed_input,
        f"{req.content}\n\n{full_text}",
        force_rebuild=True,
    )
    state.record_trace_event(
        "deterministic_ppt_fallback_attempt",
        stage="persist",
        tool_name=_PPT_GENERATION_TOOL_NAME,
        changes=repaired_changes,
        output_kind=contract.output_kind,
        title=tool_input.get("title"),
    )

    started_at = time.perf_counter()
    result = await registry.execute(_PPT_GENERATION_TOOL_NAME, tool_input)
    duration_ms = round((time.perf_counter() - started_at) * 1000)
    failed = _tool_result_failed(result)
    output = result.get("output", result) if isinstance(result, dict) else {}
    error = ""
    if isinstance(output, dict):
        error = str(result.get("error") or output.get("error") or "")
    elif isinstance(result, dict):
        error = str(result.get("error") or "")

    event: dict[str, Any] = {
        "tool_name": _PPT_GENERATION_TOOL_NAME,
        "status": "error" if failed else "completed",
        "message": "已自动补齐 PPT 生成参数并执行。" if not failed else "自动补齐 PPT 生成参数后仍执行失败。",
        "summary": _summarize_tool_result(result) if isinstance(result, dict) else "PPT fallback failed",
        "duration_ms": duration_ms,
        "source": "deterministic_ppt_fallback",
    }
    if error:
        event["error"] = error
    if isinstance(result, dict):
        event["output"] = output
    state.tool_call_events.append(event)

    artifact = _extract_artifact(result) if isinstance(result, dict) else None
    if artifact:
        state.artifacts.append(artifact)
        state.record_trace_event(
            "deterministic_ppt_fallback_succeeded",
            stage="persist",
            tool_name=_PPT_GENERATION_TOOL_NAME,
            artifact=artifact,
            duration_ms=duration_ms,
        )
        return True

    state.record_trace_event(
        "deterministic_ppt_fallback_failed",
        stage="persist",
        tool_name=_PPT_GENERATION_TOOL_NAME,
        error=error,
        duration_ms=duration_ms,
    )
    return False


def _contract_to_metadata(contract: ArtifactContract | None) -> dict[str, Any] | None:
    if not contract or not contract.delivery_required:
        return None
    return contract.to_dict()


def _policy_value(runtime: ChatRuntime) -> str:
    return str(getattr(getattr(runtime, "action_policy", ""), "value", getattr(runtime, "action_policy", "")) or "")


def _event_has_project_artifact(event: dict[str, Any]) -> bool:
    for key in ("artifact", "output", "result"):
        payload = event.get(key)
        if not isinstance(payload, dict):
            continue
        if payload.get("project_file_id") or payload.get("file_type") or payload.get("path"):
            return True
    return False


def _has_successful_mutation(state: ChatSessionState) -> bool:
    if state.artifacts or state.pending_markdown_saves:
        return True
    for event in state.tool_call_events:
        if str(event.get("status") or "").lower() != "completed":
            continue
        tool_name = str(event.get("tool_name") or "")
        if tool_name in _MUTATING_TOOL_NAMES or _event_has_project_artifact(event):
            return True
    return False


def _has_own_artifact_delivery_claim(full_text: str) -> bool:
    if not full_text or not _ARTIFACT_DELIVERY_CLAIM_RE.search(full_text):
        return False
    return any(marker in full_text for marker in _OWN_ARTIFACT_DELIVERY_MARKERS)


def _requires_execution_truth_gate(runtime: ChatRuntime, state: ChatSessionState, full_text: str) -> bool:
    if not full_text:
        return False
    completion_claim = bool(_COMPLETION_CLAIM_RE.search(full_text))
    artifact_delivery_claim = _has_own_artifact_delivery_claim(full_text)
    if not completion_claim and not artifact_delivery_claim:
        return False
    if state.confirmation_requested or state.pending_tool_actions or state.pending_tool_confirmations:
        return False
    if _has_successful_mutation(state):
        return False
    if artifact_delivery_claim:
        return True
    policy = _policy_value(runtime)
    if policy in _MUTATING_ACTION_POLICIES:
        return True
    contract = getattr(runtime, "artifact_contract", None)
    if isinstance(contract, ArtifactContract) and contract.delivery_required:
        return True
    working_memory = getattr(runtime, "working_memory", None)
    return isinstance(working_memory, dict) and bool(working_memory.get("continuation_requested") and working_memory.get("current_artifact"))


def _requested_markdown_filename(content: str) -> str:
    for pattern in (_MARKDOWN_FILENAME_PATTERN, _MARKDOWN_FILENAME_FALLBACK_PATTERN):
        matches = pattern.findall(content or "")
        if matches:
            filename = str(matches[-1]).strip(" \t\r\n'\"`，。；;、")
            for prefix in ("写入", "保存到", "保存为", "保存成", "存到", "存为", "另存为", "命名为"):
                if filename.startswith(prefix):
                    filename = filename[len(prefix):].strip()
            return filename or "项目文档.md"
    return "项目文档.md"


def _is_substantive_markdown_body(content: str) -> bool:
    text = (content or "").strip()
    if len(text) < 80:
        return False
    non_content_prefixes = (
        "操作已完成。",
        "抱歉，",
        "这个操作会修改或删除项目内容",
        "我已整理出一批可清理的项目空间文件",
    )
    return not any(text.startswith(prefix) for prefix in non_content_prefixes)


def _confirmation_notice(state: ChatSessionState) -> str:
    pending = state.pending_tool_confirmations[0] if state.pending_tool_confirmations else {}
    tool_name = str(pending.get("tool_name") or "")
    summary = str(pending.get("summary") or "").strip()
    if tool_name == "manage_project_files":
        return "我已整理出一批需要确认的项目文件操作。请在弹出的 Action Preview 中确认后，我再执行。"
    if tool_name == "update_project_markdown_document":
        return "这个操作会修改项目 Markdown 文档，已暂停等待确认。请在弹出的 Action Preview 中确认后，我再执行写入。"
    if tool_name == "manage_project_folders":
        return "这个操作会调整项目空间结构，已暂停等待确认。请在弹出的 Action Preview 中确认后，我再执行。"
    if summary:
        return f"{summary} 请在弹出的 Action Preview 中确认后，我再执行。"
    return "这个操作会修改项目内容，已暂停等待确认。请在弹出的 Action Preview 中确认后，我再执行。"


def _maybe_create_markdown_from_response(
    *,
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
    full_text: str,
    artifact_contract: ArtifactContract | None,
) -> dict[str, Any] | None:
    """Fail-safe for explicit MD writes when the model produced text but skipped the write tool."""
    if not req.project_id or not artifact_contract or artifact_contract.output_kind.lower() != "md":
        return None
    if state.pending_markdown_saves:
        return None
    if not _is_substantive_markdown_body(full_text):
        return None

    filename = _requested_markdown_filename(req.content)
    with Session(bind) as session:
        project_file = create_project_document_record(
            session=session,
            project_id=req.project_id,
            name=filename,
            content=full_text,
            uploads_dir=UPLOADS_DIR,
            init_default_folders=init_default_project_folders,
            summary=f"Saved from project chat conversation {runtime.conv_id}",
            auto_assign_folder=True,
        )
        mark_project_memory_stale(session, req.project_id, trigger="chat_markdown_fallback_save")
        return {
            "ok": True,
            "action": "created",
            "id": project_file.id,
            "project_file_id": project_file.id,
            "name": project_file.name,
            "file_type": project_file.file_type,
            "path": project_file.path,
            "folder_id": project_file.folder_id,
            "size_bytes": project_file.size_bytes,
        }


def _hash_tool_input(tool_input: dict) -> str:
    return legacy_tool_input_hash(tool_input)


def _approval_batch_id(runtime: ChatRuntime, action_payloads: list[dict]) -> str:
    parts: list[str] = []
    for payload in action_payloads:
        tool_name = str(payload.get("tool_name") or "")
        tool_input = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
        parts.append(f"{tool_name}:{_hash_tool_input(tool_input)}")
    source = f"{runtime.conv_id}:{getattr(runtime, 'trace_id', '')}:{'|'.join(parts)}"
    return f"hitas-{runtime.conv_id}-{hashlib.sha256(source.encode('utf-8')).hexdigest()[:16]}"


def _risk_level_for_action(action_payload: dict) -> str:
    action_type = str(action_payload.get("action_type") or "").lower()
    if "delete" in action_type or "destructive" in action_type:
        return "destructive"
    if "modify" in action_type or "write" in action_type:
        return "high"
    return "medium"


def _ensure_project_cleanup_confirmation(runtime: ChatRuntime, req: SendMessageRequest, bind, state: ChatSessionState) -> None:
    """Create a deterministic approval when the model failed to emit delete tool_use.

    Cleanup/deletion is too important to depend on the model remembering to
    express the action as a tool call. If the user explicitly asked to clean
    project files and no pending confirmation exists yet, synthesize a frozen
    manage_project_files delete action from conservative duplicate/junk-file
    heuristics. The generated action still requires the user to approve it.
    """
    if state.pending_tool_confirmations:
        return
    with Session(bind) as session:
        pending = build_project_file_cleanup_pending_action(
            session,
            project_id=req.project_id,
            user_content=req.content,
            action_policy=runtime.action_policy,
        )
    if not pending:
        return

    state.confirmation_requested = True
    confirmation_token = str(pending.get("confirmation_token") or "")
    details = pending.get("details") if isinstance(pending.get("details"), list) else []
    summary = str(pending.get("summary") or "需要用户确认后才能删除项目空间中的文件。")
    state.pending_tool_confirmations.append(pending)
    state.pending_tool_actions.append(
        {
            "action_type": "delete_files",
            "title": "确认删除项目文件",
            "description": str(pending.get("summary") or "即将删除项目空间中的文件。此操作不可撤销。"),
            "details": details,
            "tool_name": MANAGE_PROJECT_FILES_TOOL_NAME,
            "tool_input": pending.get("tool_input") if isinstance(pending.get("tool_input"), dict) else {},
            "confirmation_token": confirmation_token,
        }
    )
    state.tool_call_events.append(
        {
            "tool_name": MANAGE_PROJECT_FILES_TOOL_NAME,
            "status": "confirmation_required",
            "message": "已生成项目空间清理预览，等待用户确认后再删除文件。",
            "summary": summary,
            "confirmation_token": confirmation_token,
            "details": details,
        }
    )
    state.record_trace_event(
        "deterministic_cleanup_confirmation_created",
        stage="persist",
        tool_name=MANAGE_PROJECT_FILES_TOOL_NAME,
        confirmation_token=confirmation_token,
        candidate_count=len(details),
        source="project_file_cleanup_fallback",
    )


async def run_persist(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Persist the final response and emit completion events.

    Populates:
    * ``state.full_text``      – final assembled text
    * ``state.need_title``     – whether title generation was scheduled
    * ``state.stage_timings["save_ms"]`` / ``["total_stream_ms"]``
    * Yields the final ``done`` event
    """
    from app.services.chat.tool_repair import extract_tool_use_json_blocks

    # Prefer the orchestrator-stamped start time (set in stream_chat_events).
    # The legacy reconstruction below from stage_timings["total_stream_ms"]
    # only worked for the durable-task early-exit path — for normal chat the
    # metric isn't set yet at this point, so the legacy fallback yields ~0
    # and total_stream_ms ends up reflecting only persist's own duration.
    if state.stream_started_at > 0.0:
        stream_started_at = state.stream_started_at
    else:
        stream_started_at = time.perf_counter() - (state.stage_timings.get("total_stream_ms", 0) / 1000)

    # Assemble full text
    full_text = _strip_internal_tool_markers(state.full_text).strip()

    if not state.tool_call_events:
        yield sse_event({"type": "status", "stage": "finalizing", "message": "模型回复已整理完成。"})

    # Suppress leaked tool_use JSON from saved text
    leaked_tool_blocks, cleaned_full_text = extract_tool_use_json_blocks(full_text)
    if leaked_tool_blocks:
        for block in leaked_tool_blocks:
            state.record_tool_use_via_text("persist", block, status="suppressed")
        logger.warning(f"[SAVE] suppressed {len(leaked_tool_blocks)} leaked tool_use JSON block(s) from assistant text")
        full_text = cleaned_full_text.strip()

    logger.info(f"[persist] persisting. full_text_len={len(full_text)}")

    if state.workflow_started:
        yield sse_event(
            workflow_status(
                step_index=4,
                step_total=4,
                title="整理结果与链接",
                stage="saving",
                message="第 4 步：正在保存回复、附件和项目空间链接。",
            )
        )

    yield sse_event({"type": "status", "stage": "saving", "message": "正在保存本次回复..."})
    save_started_at = time.perf_counter()

    artifact_contract = _runtime_artifact_contract(runtime)
    if artifact_contract and (artifact_contract.output_kind or "").lower() == "pptx" and not _delivery_satisfied(state, artifact_contract):
        yield sse_event({"type": "status", "stage": "tools", "message": "正在补齐 PPT 生成参数并尝试生成交付文件..."})
        generated = await _maybe_generate_missing_ppt_artifact(runtime, req, state, full_text, artifact_contract)
        if generated:
            full_text = _remove_stale_ppt_failure_text(full_text)
            yield sse_event({"type": "status", "stage": "tools", "message": "PPT 交付文件已补齐生成，正在保存链接..."})

    # Persist artifacts
    if state.artifacts:
        state.artifacts = persist_generated_artifacts(bind, runtime.conv_id, state.artifacts, req.project_id)

        # Product Run Event v1: announce each newly-persisted artifact so a v1
        # frontend can render a "ready to download" card without polling.
        if state.run_id:
            from app.services.chat.product_run_events import (
                artifact_ready as _artifact_ready,
            )

            _ARTIFACT_TYPE_V1_MAP = {
                "pptx": "pptx",
                "docx": "docx",
                "xlsx": "xlsx",
                "pdf": "pdf",
                "md": "markdown",
                "markdown": "markdown",
            }
            for artifact in state.artifacts:
                artifact_id = artifact.get("id") or artifact.get("project_file_id")
                if not artifact_id:
                    continue
                raw_kind = str(
                    artifact.get("file_type") or artifact.get("output_kind") or ""
                ).lower().lstrip(".")
                v1_kind = _ARTIFACT_TYPE_V1_MAP.get(raw_kind)
                if not v1_kind:
                    continue
                yield sse_event(_artifact_ready(state.run_id, artifact_id, v1_kind))

    # Build artifact notice
    artifact_notice = _build_artifact_notice(state.artifacts) if state.artifacts else ""
    if not full_text and artifact_notice:
        full_text = artifact_notice
        yield sse_event({"type": "text", "content": artifact_notice})
    elif artifact_notice and artifact_notice not in full_text:
        full_text = f"{full_text}\n\n{artifact_notice}".strip()
        yield sse_event({"type": "text", "content": f"\n\n{artifact_notice}"})

    # Fallback message for empty response
    if not full_text:
        if state.confirmation_requested:
            full_text = "这个操作会修改或删除项目内容，已暂停。请确认后我再继续执行。"
            yield sse_event({"type": "text", "content": full_text})
        elif state.tool_call_events and all(str(event.get("status") or "") == "completed" for event in state.tool_call_events):
            summaries = [
                str(event.get("summary") or event.get("message") or event.get("tool_name") or "").strip()
                for event in state.tool_call_events
            ]
            summaries = [item for item in summaries if item]
            full_text = "操作已完成。" + (f"\n\n{chr(10).join(f'- {item}' for item in summaries)}" if summaries else "")
            yield sse_event({"type": "text", "content": full_text})
        else:
            full_text = (
                "抱歉，AI 服务暂时未能生成回复。可能原因包括：\n\n"
                "1. API 服务当前繁忙或暂时不可用\n"
                "2. 模型上下文过长，超出处理限制\n"
                "3. API Key 配置异常或余额不足\n\n"
                "建议稍后重试，或前往「设置」检查 API Key 配置。"
            )
            logger.warning("[persist] empty response detected, using fallback message")

    fallback_markdown = _maybe_create_markdown_from_response(
        runtime=runtime,
        req=req,
        bind=bind,
        state=state,
        full_text=full_text,
        artifact_contract=artifact_contract,
    )
    if fallback_markdown:
        state.pending_markdown_saves.append(
            {
                "project_id": req.project_id,
                "file_id": fallback_markdown.get("project_file_id") or fallback_markdown.get("id"),
                "file_name": fallback_markdown.get("name"),
                "mode": "create",
                "content": full_text,
                "summary": "Saved from project chat response",
                "folder_id": fallback_markdown.get("folder_id"),
                "saved": True,
                "saved_result": fallback_markdown,
                "source": "persist_markdown_fallback",
            }
        )
        state.tool_call_events.append(
            {
                "tool_name": "update_project_markdown_document",
                "status": "completed",
                "message": "已写入项目 Markdown 文件。",
                "summary": f"Created {fallback_markdown.get('name')}",
                "output": fallback_markdown,
            }
        )
        state.record_trace_event(
            "markdown_fallback_save",
            file_name=fallback_markdown.get("name"),
            project_file_id=fallback_markdown.get("project_file_id") or fallback_markdown.get("id"),
        )
        notice = f"已写入项目 Markdown 文件：{fallback_markdown.get('name')}"
        if notice not in full_text:
            full_text = f"{full_text}\n\n{notice}".strip()
            yield sse_event({"type": "text", "content": f"\n\n{notice}"})

    delivery_failed = False
    if artifact_contract and not _delivery_satisfied(state, artifact_contract):
        delivery_failed = True
        failure_message = _delivery_failure_message(artifact_contract, state)
        full_text = f"{full_text}\n\n{failure_message}".strip() if full_text else failure_message
        state.record_trace_event(
            "artifact_delivery_failed",
            output_kind=artifact_contract.output_kind,
            title=artifact_contract.title,
            reason="contract_not_satisfied",
        )
        logger.warning(
            "[persist] artifact contract not satisfied. output_kind=%s title=%s",
            artifact_contract.output_kind,
            artifact_contract.title,
        )
        yield sse_event({"type": "text", "content": f"\n\n{failure_message}"})

    _ensure_project_cleanup_confirmation(runtime, req, bind, state)
    if state.confirmation_requested and state.pending_tool_confirmations:
        confirmation_notice = _confirmation_notice(state)
        if confirmation_notice not in full_text:
            full_text = f"{full_text}\n\n{confirmation_notice}".strip()
            yield sse_event({"type": "text", "content": f"\n\n{confirmation_notice}"})

    if _requires_execution_truth_gate(runtime, state, full_text):
        policy = _policy_value(runtime)

        # Bucket the tool_use_via_text trace events so we can both log them in
        # structured form (for offline diagnosis) and reflect what was actually
        # attempted in the user-facing error.
        attempted_via_text: dict[str, dict[str, int]] = {}
        for ev in state.trace_events:
            if ev.get("type") != "tool_use_via_text":
                continue
            tool_name = str(ev.get("tool_name") or "unknown")
            status = str(ev.get("status") or "unknown")
            slot = attempted_via_text.setdefault(tool_name, {})
            slot[status] = slot.get(status, 0) + 1

        contract = getattr(runtime, "artifact_contract", None)
        contract_required = bool(
            isinstance(contract, ArtifactContract) and contract.delivery_required
        )
        artifact_claim = _has_own_artifact_delivery_claim(full_text)

        # Single structured log line — easy to grep for after the fact when
        # diagnosing why a specific turn got blocked. The text_preview is
        # truncated to keep log volume reasonable.
        logger.warning(
            "[execution_truth_gate] blocked run_id=%s conv=%s policy=%s "
            "artifact_claim=%s contract_required=%s "
            "attempted_via_text=%s text_preview=%r",
            getattr(state, "run_id", "") or "-",
            getattr(runtime, "conv_id", None),
            policy,
            artifact_claim,
            contract_required,
            attempted_via_text or {},
            full_text[:200],
        )

        # User-facing message: when the model attempted tool calls via text
        # (typical for DeepSeek), naming them helps the user understand what
        # actually happened instead of guessing at "operation didn't complete".
        if attempted_via_text:
            tool_list = "、".join(sorted(attempted_via_text.keys()))
            truth_gate_message = (
                f"我尝试调用了工具（{tool_list}），但模型把调用写成了普通文本而不是结构化的工具调用，"
                "所以系统没有真正执行它们。为了不误导你，我不会声称已经完成。\n\n"
                "可以试试：把请求改成更明确的「读取 / 修改」表述，或者换一个 Skill / 对话模式。"
            )
        else:
            truth_gate_message = (
                "没有完成这个操作：本轮没有成功执行项目空间写入/更新工具，也没有生成可验证的文件记录，"
                "所以我不会声称已完成。请重新指定目标文件或确认操作范围后，我再执行。"
            )

        state.tool_call_events.append(
            {
                "tool_name": "execution_truth_gate",
                "status": "error",
                "message": "拦截了没有工具结果支撑的完成表述。",
                "summary": "No successful mutation result was present.",
                "policy": policy,
                "attempted_via_text": attempted_via_text or {},
            }
        )
        state.record_trace_event(
            "execution_truth_gate_blocked_completion_claim",
            stage="persist",
            action_policy=policy,
            artifact_claim=artifact_claim,
            contract_required=contract_required,
            attempted_via_text=attempted_via_text or {},
            original_text_preview=full_text[:240],
        )
        full_text = f"{full_text}\n\n{truth_gate_message}".strip() if full_text else truth_gate_message
        yield sse_event({"type": "text", "content": f"\n\n{truth_gate_message}"})

    # ── HITAS: Persist pending tool actions to database ──
    pending_action_ids: list[int] = []
    pending_action_batch_ids: list[str] = []
    pending_action_persist_errors: list[str] = []
    if state.pending_tool_actions:
        with Session(bind) as session:
            batch_id = _approval_batch_id(runtime, state.pending_tool_actions)
            seen_pending_ids: set[int] = set()
            now = utc_now_naive()
            for sequence_index, action_payload in enumerate(state.pending_tool_actions):
                try:
                    tool_name = str(action_payload.get("tool_name") or "")
                    tool_input = action_payload.get("tool_input") if isinstance(action_payload.get("tool_input"), dict) else {}
                    tool_input_json = json.dumps(tool_input, ensure_ascii=False, default=str)
                    action_type = str(action_payload.get("action_type") or "")
                    risk_level = str(action_payload.get("risk_level") or _risk_level_for_action(action_payload))
                    policy_at_creation = str(
                        getattr(runtime.action_policy, "value", runtime.action_policy) or ""
                    )
                    action_batch_id = str(action_payload.get("approval_batch_id") or batch_id)
                    legacy_hash = _hash_tool_input(tool_input)
                    envelope_hash = approval_envelope_hash(
                        tool_name=tool_name,
                        tool_input=tool_input,
                        project_id=runtime.project_id,
                        action_type=action_type,
                        risk_level=risk_level,
                        policy_at_creation=policy_at_creation,
                        approval_batch_id=action_batch_id,
                        sequence_index=sequence_index,
                    )
                    existing = session.exec(
                        select(PendingToolAction)
                        .where(PendingToolAction.conversation_id == runtime.conv_id)
                        .where(PendingToolAction.tool_name == tool_name)
                        .where(
                            or_(
                                PendingToolAction.tool_input_hash == envelope_hash,
                                PendingToolAction.tool_input_hash == legacy_hash,
                                PendingToolAction.tool_input_json == tool_input_json,
                            )
                        )
                        .where(PendingToolAction.status == "pending")
                        .order_by(PendingToolAction.created_at.desc(), PendingToolAction.id.desc())
                    ).first()
                    if existing and existing.expires_at and existing.expires_at < now:
                        existing.status = "failed"
                        existing.error_message = "Action expired"
                        session.add(existing)
                        session.commit()
                        existing = None
                    if existing:
                        # Never mutate fields already bound by a v2 approval.
                        # Legacy pending rows are upgraded only while the same
                        # proposal is being published again for user review.
                        if not existing.tool_input_hash.startswith(APPROVAL_ENVELOPE_PREFIX):
                            existing.action_type = action_type
                            existing.risk_level = risk_level
                            existing.policy_at_creation = policy_at_creation
                            existing.approval_batch_id = action_batch_id
                            existing.sequence_index = sequence_index
                            existing.tool_input_hash = approval_envelope_hash(
                                tool_name=existing.tool_name,
                                tool_input=tool_input,
                                project_id=existing.project_id,
                                action_type=existing.action_type,
                                risk_level=existing.risk_level,
                                policy_at_creation=existing.policy_at_creation,
                                approval_batch_id=existing.approval_batch_id,
                                sequence_index=existing.sequence_index,
                            )
                        session.add(existing)
                        session.commit()
                        if existing.id and existing.id not in seen_pending_ids:
                            seen_pending_ids.add(existing.id)
                            pending_action_ids.append(existing.id)
                            action_payload["pending_action_id"] = existing.id
                            action_payload["approval_batch_id"] = existing.approval_batch_id or batch_id
                            pending_action_batch_ids.append(action_payload["approval_batch_id"])
                        continue

                    db_action = PendingToolAction(
                        trace_id=str(getattr(runtime, "trace_id", "") or f"conv-{runtime.conv_id}"),
                        conversation_id=runtime.conv_id,
                        project_id=runtime.project_id,
                        tool_name=tool_name,
                        tool_input_json=tool_input_json,
                        action_type=action_type,
                        risk_level=risk_level,
                        policy_at_creation=policy_at_creation,
                        tool_input_hash=envelope_hash,
                        approval_batch_id=action_batch_id,
                        sequence_index=sequence_index,
                        title=action_payload.get("title", "待确认的操作"),
                        description=action_payload.get("description", ""),
                        details_json=json.dumps(action_payload.get("details", []), ensure_ascii=False, default=str),
                        status="pending",
                        expires_at=utc_now_naive() + timedelta(hours=24),
                    )
                    session.add(db_action)
                    session.commit()
                    session.refresh(db_action)
                    if db_action.id:
                        seen_pending_ids.add(db_action.id)
                        pending_action_ids.append(db_action.id)
                        # Update payload with DB id for metadata reference
                        action_payload["pending_action_id"] = db_action.id
                        action_payload["approval_batch_id"] = db_action.approval_batch_id
                        pending_action_batch_ids.append(db_action.approval_batch_id)
                except Exception as exc:
                    error_message = str(exc) or exc.__class__.__name__
                    pending_action_persist_errors.append(error_message)
                    logger.exception("[persist] failed to persist pending tool action: %s", exc)

    if pending_action_persist_errors:
        failure_notice = (
            "审批动作保存失败，本次不会执行任何修改或删除。请重试，或刷新页面后重新生成 Action Preview。"
        )
        if pending_action_ids:
            try:
                with Session(bind) as session:
                    session.execute(
                        update(PendingToolAction)
                        .where(PendingToolAction.id.in_(pending_action_ids))
                        .where(PendingToolAction.status == "pending")
                        .values(status="failed", error_message=failure_notice)
                    )
                    session.commit()
            except Exception as exc:
                logger.exception("[persist] failed to fail-closed pending tool actions: %s", exc)
        pending_action_ids = []
        pending_action_batch_ids = []
        state.pending_tool_actions = []
        state.pending_tool_confirmations = []
        state.tool_call_events.append(
            {
                "tool_name": "hitas",
                "status": "error",
                "message": failure_notice,
                "summary": failure_notice,
                "error": "；".join(pending_action_persist_errors[:3]),
            }
        )
        state.record_trace_event(
            "pending_action_persist_failed",
            stage="persist",
            error_count=len(pending_action_persist_errors),
            errors=pending_action_persist_errors[:3],
        )
        if failure_notice not in full_text:
            full_text = f"{full_text}\n\n{failure_notice}".strip()
            yield sse_event({"type": "text", "content": f"\n\n{failure_notice}"})

    # Build metadata
    metadata: dict = {}
    if runtime.rag_sources:
        metadata["references"] = runtime.rag_sources
    if state.tool_call_events:
        metadata["tool_calls"] = state.tool_call_events
    if pending_action_ids:
        metadata["pending_action_ids"] = pending_action_ids
        unique_batch_ids = list(dict.fromkeys(batch_id for batch_id in pending_action_batch_ids if batch_id))
        if len(unique_batch_ids) == 1:
            metadata["pending_action_batch_id"] = unique_batch_ids[0]
        elif unique_batch_ids:
            metadata["pending_action_batch_ids"] = unique_batch_ids
    if state.pending_tool_confirmations:
        metadata["pending_tool_confirmations"] = state.pending_tool_confirmations
    if req.action_confirmations:
        metadata["resolved_action_confirmations"] = list(req.action_confirmations)
    if state.artifacts:
        metadata["artifacts"] = state.artifacts
    if state.pending_markdown_saves:
        metadata["pending_markdown_saves"] = state.pending_markdown_saves
    working_memory = getattr(runtime, "working_memory", None)
    if isinstance(working_memory, dict) and working_memory:
        metadata["working_memory"] = working_memory
    contract_metadata = _contract_to_metadata(artifact_contract)
    if contract_metadata:
        metadata["artifact_contract"] = contract_metadata
    if delivery_failed:
        metadata["delivery_failed"] = True
    if req.project_id:
        metadata["project_id"] = req.project_id
    if runtime.skill_name:
        prepare_metrics = getattr(runtime, "prepare_metrics", {}) if isinstance(getattr(runtime, "prepare_metrics", {}), dict) else {}
        metadata["skill_id"] = req.skill_id or prepare_metrics.get("effective_skill_id")
        metadata["skill_progress"] = _build_completed_skill_progress(state.tool_call_events, full_text)
    if any(step.truncated for step in state.steps):
        metadata["truncated"] = True

    # Product Run Event v1: snapshot the activity timeline so the persisted
    # view (ProjectChatMessageBubble) can re-render it on refresh. Returns
    # None when state.run_id is empty (legacy / no run tracked) — skip silently.
    from app.services.chat.activity_timeline_persist import build_activity_timeline

    activity_timeline = build_activity_timeline(state, runtime, full_text=full_text)
    if activity_timeline is not None:
        metadata["activity_timeline"] = activity_timeline

    # Durable Phase 2B snapshot. Raw tool arguments/results stay out of this
    # record; hashes and bounded summaries are enough for replay and recovery.
    from app.services.agent_harness.run_rollout import build_in_memory_rollout_snapshot

    if state.run_id:
        metadata["run_rollout"] = build_in_memory_rollout_snapshot(
            state,
            status="waiting_confirmation" if state.confirmation_requested else "completed",
            phase="persist",
        )

    # V0.0.4 A4: surface the routing decision so the frontend can show a small
    # badge ("按对话大纲生成 PPT" vs "自动生成项目 PPT" etc.) without re-running
    # any heuristic on its side.
    prepare_metrics_all = getattr(runtime, "prepare_metrics", {}) if isinstance(getattr(runtime, "prepare_metrics", {}), dict) else {}
    route_method = prepare_metrics_all.get("intent_method") or ""
    route_reason = prepare_metrics_all.get("intent_reason") or ""
    if route_method or route_reason:
        route_decision = {"method": str(route_method), "reason": str(route_reason)}
        chat_mode_value = prepare_metrics_all.get("chat_mode")
        if chat_mode_value:
            route_decision["chat_mode"] = str(chat_mode_value)
        metadata["route_decision"] = route_decision

    state.stage_timings["save_ms"] = round((time.perf_counter() - save_started_at) * 1000)
    state.stage_timings["total_stream_ms"] = round((time.perf_counter() - stream_started_at) * 1000)
    metadata["stage_timings"] = state.stage_timings

    yield sse_event(
        {"type": "timing", "key": "save_ms", "duration_ms": state.stage_timings["save_ms"]}
    )
    yield sse_event(
        {
            "type": "timing",
            "key": "total_stream_ms",
            "duration_ms": state.stage_timings["total_stream_ms"],
        }
    )

    if state.workflow_started:
        yield sse_event(
            workflow_status(
                step_index=4,
                step_total=4,
                title="整理结果与链接",
                stage="saving",
                status="completed",
                message="第 4 步：回复和生成物已保存完成。",
            )
        )

    # Persist assistant message
    need_title, assistant_message_id = persist_assistant_message(
        bind,
        runtime.conv_id,
        full_text,
        req.content,
        metadata or None,
    )
    if pending_action_ids and assistant_message_id:
        try:
            with Session(bind) as session:
                session.execute(
                    update(PendingToolAction)
                    .where(PendingToolAction.id.in_(pending_action_ids))
                    .where(PendingToolAction.message_id.is_(None))
                    .values(message_id=assistant_message_id)
                )
                session.commit()
        except Exception as exc:
            logger.warning("[persist] failed to attach pending tool actions to assistant message: %s", exc)
    state.full_text = full_text
    state.need_title = need_title
    state.assistant_message_id = assistant_message_id

    try:
        persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
    except Exception as exc:
        logger.warning("[persist] failed to persist chat trace: %s", exc)

    logger.info(f"[chat timing] conv={runtime.conv_id} metrics={state.stage_timings}")
    # Product Run Event v1: signal that the assistant message is now persisted,
    # right before the legacy done event. Additive — old frontends ignore it.
    if state.run_id and assistant_message_id is not None:
        from app.services.chat.product_run_events import message_persisted as _message_persisted

        yield sse_event(_message_persisted(state.run_id, assistant_message_id))

    # Auto-title — runs in the BACKGROUND so it never blocks ``done``.
    # In-band title generation was an LLM call that could take 10-16s,
    # holding the SSE stream open long after the reply finished. The
    # frontend clears its "busy" state on stream close, so that tail
    # delayed both the visible completion AND anything gated on it —
    # notably the HITAS confirmation card, which only surfaces once the
    # stream settles. The conversation keeps the stand-in truncation
    # title set by ``persist_assistant_message`` until the background
    # task upgrades it and invalidates the conversation-list cache.
    if need_title and full_text:
        try:
            schedule_title_generation(
                conv_id=runtime.conv_id,
                user_content=req.content,
                bind=bind,
                complete_fn=runtime.llm.complete,
                language=getattr(req, "language", None),
            )
        except Exception as exc:
            logger.warning("[persist] auto-title scheduling failed: %s", exc)

    yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})
