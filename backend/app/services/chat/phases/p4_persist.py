"""P4 — Persistence & finalization phase.

Saves artifacts, builds metadata, persists the assistant message, schedules title
generation, and emits the final ``done`` event.
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
from app.services.artifact_intent import ArtifactContract
from app.services.chat_tools import ChatRuntime, _build_completed_skill_progress, _strip_internal_tool_markers
from app.services.chat_artifacts import _build_artifact_notice
from app.models.db import PendingToolAction
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
from app.tools.office_documents import MANAGE_PROJECT_FILES_TOOL_NAME

logger = logging.getLogger(__name__)

_MARKDOWN_FILENAME_PATTERN = re.compile(
    r"(?:写入|保存到|保存为|保存成|存到|存为|另存为|命名为|文件名[:：]?)\s*([^\s，。；;、]+?\.md)",
    re.IGNORECASE,
)
_MARKDOWN_FILENAME_FALLBACK_PATTERN = re.compile(r"([^\s，。；;、]+?\.md)", re.IGNORECASE)


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
    normalized = json.dumps(tool_input or {}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


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
                "source": "p4_markdown_fallback",
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
                    tool_input_hash = _hash_tool_input(tool_input)
                    tool_input_json = json.dumps(tool_input, ensure_ascii=False, default=str)
                    existing = session.exec(
                        select(PendingToolAction)
                        .where(PendingToolAction.conversation_id == runtime.conv_id)
                        .where(PendingToolAction.tool_name == tool_name)
                        .where(
                            or_(
                                PendingToolAction.tool_input_hash == tool_input_hash,
                                (PendingToolAction.tool_input_hash == "") & (PendingToolAction.tool_input_json == tool_input_json),
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
                        if not existing.tool_input_hash:
                            existing.tool_input_hash = tool_input_hash
                        if not existing.approval_batch_id:
                            existing.approval_batch_id = batch_id
                        existing.sequence_index = sequence_index
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
                        action_type=action_payload.get("action_type", ""),
                        risk_level=action_payload.get("risk_level") or _risk_level_for_action(action_payload),
                        policy_at_creation=str(getattr(runtime.action_policy, "value", runtime.action_policy) or ""),
                        tool_input_hash=tool_input_hash,
                        approval_batch_id=str(action_payload.get("approval_batch_id") or batch_id),
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
                    logger.exception("[P4] failed to persist pending tool action: %s", exc)

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
                logger.exception("[P4] failed to fail-closed pending tool actions: %s", exc)
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
            stage="p4",
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
            logger.warning("[P4] failed to attach pending tool actions to assistant message: %s", exc)
    state.full_text = full_text
    state.need_title = need_title

    try:
        persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
    except Exception as exc:
        logger.warning("[P4] failed to persist chat trace: %s", exc)

    logger.info(f"[chat timing] conv={runtime.conv_id} metrics={state.stage_timings}")
    yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})

    if need_title and full_text:
        schedule_title_generation(
            conv_id=runtime.conv_id,
            user_content=req.content,
            bind=bind,
            complete_fn=runtime.llm.complete,
        )
