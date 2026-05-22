"""P4 — Persistence & finalization phase.

Saves artifacts, builds metadata, persists the assistant message, schedules title
generation, and emits the final ``done`` event.
"""
from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from sqlmodel import Session

from app.routers.chat_schemas import SendMessageRequest
from app.services.artifact_intent import ArtifactContract
from app.services.chat_tools import ChatRuntime, _build_completed_skill_progress, _strip_internal_tool_markers
from app.services.chat_artifacts import _build_artifact_notice
from app.services.chat.pending_actions import build_project_file_cleanup_pending_action
from app.services.chat_store import persist_assistant_message, persist_generated_artifacts
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event
from app.services.chat.trace import persist_chat_trace
from app.services.chat.workflow import workflow_status
from app.services.title_generator import schedule_title_generation
from app.tools.office_documents import MANAGE_PROJECT_FILES_TOOL_NAME

logger = logging.getLogger(__name__)


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


def _delivery_failure_message(contract: ArtifactContract) -> str:
    kind = (contract.output_kind or "文件").upper()
    return (
        f"抱歉，这次没有成功生成 {kind} 文件，因此我不会把正文文本当作交付物完成。\n\n"
        "请重试一次，或切换模型后再试；系统会保留这次失败记录，便于排查具体原因。"
    )


def _contract_to_metadata(contract: ArtifactContract | None) -> dict[str, Any] | None:
    if not contract or not contract.delivery_required:
        return None
    return contract.to_dict()


def _ensure_project_cleanup_confirmation(runtime: ChatRuntime, req: SendMessageRequest, bind, state: ChatSessionState) -> None:
    """Create a deterministic approval when the model failed to emit delete tool_use.

    Cleanup/deletion is too important to depend on the model remembering to
    express the action as a tool call. If the user explicitly asked to clean
    project files and no pending confirmation exists yet, synthesize a frozen
    manage_project_files delete action from conservative duplicate/junk-file
    heuristics. The generated action still requires the user to approve it.
    """
    if state.pending_tool_confirmations or getattr(req, "action_confirmations", None):
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
        stage="p4",
        tool_name=MANAGE_PROJECT_FILES_TOOL_NAME,
        confirmation_token=confirmation_token,
        candidate_count=len(details),
        source="project_file_cleanup_fallback",
    )


async def run_p4_persist(
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

    stream_started_at = time.perf_counter() - (state.stage_timings.get("total_stream_ms", 0) / 1000)

    # Assemble full text
    full_text = state.text_buffer.strip()
    if state.follow_up_text.strip():
        full_text = (full_text + "\n\n" + state.follow_up_text.strip()).strip()
    full_text = _strip_internal_tool_markers(full_text)

    if not state.tool_use_blocks:
        yield sse_event({"type": "status", "stage": "finalizing", "message": "模型回复已整理完成。"})

    # Suppress leaked tool_use JSON from saved text
    leaked_tool_blocks, cleaned_full_text = extract_tool_use_json_blocks(full_text)
    if leaked_tool_blocks:
        for block in leaked_tool_blocks:
            state.record_tool_use_via_text("p4", block, status="suppressed")
        logger.warning(f"[SAVE] suppressed {len(leaked_tool_blocks)} leaked tool_use JSON block(s) from assistant text")
        full_text = cleaned_full_text.strip()

    logger.info(f"[P4] persisting. full_text_len={len(full_text)}")

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

    # Persist artifacts
    if state.artifacts:
        state.artifacts = persist_generated_artifacts(bind, runtime.conv_id, state.artifacts, req.project_id)

    artifact_contract = _runtime_artifact_contract(runtime)

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
            logger.warning("[P4] empty response detected, using fallback message")

    delivery_failed = False
    if artifact_contract and not _delivery_satisfied(state, artifact_contract):
        delivery_failed = True
        full_text = _delivery_failure_message(artifact_contract)
        state.record_trace_event(
            "artifact_delivery_failed",
            output_kind=artifact_contract.output_kind,
            title=artifact_contract.title,
            reason="contract_not_satisfied",
        )
        logger.warning(
            "[P4] artifact contract not satisfied. output_kind=%s title=%s",
            artifact_contract.output_kind,
            artifact_contract.title,
        )
        yield sse_event({"type": "text", "content": f"\n\n{full_text}"})

    _ensure_project_cleanup_confirmation(runtime, req, bind, state)
    if state.confirmation_requested and state.pending_tool_confirmations:
        confirmation_notice = "我已整理出一批可清理的项目空间文件。请在弹出的 Action Preview 中确认后，我再执行删除。"
        if confirmation_notice not in full_text:
            full_text = f"{full_text}\n\n{confirmation_notice}".strip()
            yield sse_event({"type": "text", "content": f"\n\n{confirmation_notice}"})

    # Build metadata
    metadata: dict = {}
    if runtime.rag_sources:
        metadata["references"] = runtime.rag_sources
    if state.tool_call_events:
        metadata["tool_calls"] = state.tool_call_events
    if state.pending_tool_confirmations:
        metadata["pending_tool_confirmations"] = state.pending_tool_confirmations
    if req.action_confirmations:
        metadata["resolved_action_confirmations"] = list(req.action_confirmations)
    if state.artifacts:
        metadata["artifacts"] = state.artifacts
    if state.pending_markdown_saves:
        metadata["pending_markdown_saves"] = state.pending_markdown_saves
    contract_metadata = _contract_to_metadata(artifact_contract)
    if contract_metadata:
        metadata["artifact_contract"] = contract_metadata
    if delivery_failed:
        metadata["delivery_failed"] = True
    if req.project_id:
        metadata["project_id"] = req.project_id
    if runtime.skill_name:
        metadata["skill_id"] = req.skill_id
        metadata["skill_progress"] = _build_completed_skill_progress(state.tool_call_events, full_text)
    if state.p1_double_truncated or state.p3_double_truncated:
        metadata["truncated"] = True

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
    state.full_text = full_text
    state.need_title = need_title

    try:
        persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
    except Exception as exc:
        logger.warning("[P4] failed to persist chat trace: %s", exc)

    logger.info(f"[chat timing] conv={runtime.conv_id} metrics={state.stage_timings}")
    yield sse_event({"type": "done", **metadata})

    if need_title and full_text:
        schedule_title_generation(
            conv_id=runtime.conv_id,
            user_content=req.content,
            bind=bind,
            complete_fn=runtime.llm.complete,
        )
