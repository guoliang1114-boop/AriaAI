from __future__ import annotations

import json
import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import CHAT_RETENTION_DAYS, CONVERSATION_CACHE_TTL, UPLOADS_DIR
from app.models.db import ChatTrace, Conversation, ConversationState, GeneratedFile, MemoryCandidate, Message, PendingToolAction, ProjectFile, TaskRun, ToolCall
from app.services.agent_harness.run_output_record import (
    RUN_OUTPUT_RECORD_VERSION,
    append_run_output_record,
    build_artifact_output_record,
    mark_artifact_output_persisted,
    mark_run_output_failed,
    normalize_run_output_records,
)
from app.services.cache import conversations_cache
from app.services.time_utils import utc_now_naive
from app.services.upload_paths import resolve_upload_path

_CONV_TTL = CONVERSATION_CACHE_TTL
_RETENTION_DAYS = max(CHAT_RETENTION_DAYS, 1)
logger = logging.getLogger(__name__)
_PLACEHOLDER_CONVERSATION_TITLES = {
    "new chat",
    "new conversation",
    "new workstream",
    "新建对话",
    "新对话",
}
_NUMBERED_CONVERSATION_TITLE_RE = re.compile(r"^(?:对话|conversation)\s*#\d+$", re.IGNORECASE)


def _is_placeholder_conversation_title(title: str | None) -> bool:
    normalized = (title or "").strip()
    if not normalized:
        return True
    if normalized.lower() in _PLACEHOLDER_CONVERSATION_TITLES:
        return True
    return bool(_NUMBERED_CONVERSATION_TITLE_RE.match(normalized))


def list_conversations_cached(
    session: Session,
    project_id: Optional[int] = None,
    standalone: bool = False,
    *,
    accessible_project_ids: Optional[list[int]] = None,
    owner_user_id: Optional[int] = None,
):
    purge_expired_conversations(session)

    project_scope = ",".join(str(item) for item in sorted(accessible_project_ids or []))
    cache_key = f"list:{project_id or ''}:{'s' if standalone else ''}:owner:{owner_user_id or ''}:projects:{project_scope}"
    cached = conversations_cache.get(cache_key)
    if cached is not None:
        return cached

    stmt = select(Conversation).order_by(Conversation.updated_at.desc()).limit(100)
    if project_id:
        stmt = stmt.where(Conversation.project_id == project_id)
    elif standalone:
        stmt = stmt.where(Conversation.project_id == None)  # noqa: E711
        if owner_user_id is not None:
            stmt = stmt.where(Conversation.owner_user_id == owner_user_id)
    elif accessible_project_ids is not None:
        from sqlalchemy import or_

        project_filter = Conversation.project_id.in_(accessible_project_ids) if accessible_project_ids else False
        if owner_user_id is not None:
            stmt = stmt.where(
                or_(
                    project_filter,
                    (Conversation.project_id == None) & (Conversation.owner_user_id == owner_user_id),  # noqa: E711
                )
            )
        else:
            stmt = stmt.where(project_filter)

    result = session.exec(stmt).all()
    conversations_cache.set(cache_key, result, _CONV_TTL)
    return result


def purge_expired_conversations(
    session: Session,
    *,
    retention_days: int = _RETENTION_DAYS,
    now: Optional[datetime] = None,
) -> int:
    cutoff = (now or utc_now_naive()) - timedelta(days=max(retention_days, 1))
    expired = session.exec(
        select(Conversation).where(Conversation.updated_at < cutoff).order_by(Conversation.updated_at)
    ).all()
    if not expired:
        return 0

    for conv in expired:
        if conv.id is not None:
            delete_conversation_with_messages(session, conv.id, clear_cache=False)
    conversations_cache.delete_prefix("list:")
    return len(expired)


def get_conversation_or_404(session: Session, conv_id: int) -> Conversation:
    conv = session.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv


def create_conversation_record(
    session: Session,
    project_id: Optional[int] = None,
    skill_id: Optional[int] = None,
    title: str = "",
    owner_user_id: Optional[int] = None,
) -> Conversation:
    conv = Conversation(project_id=project_id, skill_id=skill_id, title=title, owner_user_id=owner_user_id)
    session.add(conv)
    session.commit()
    session.refresh(conv)
    conversations_cache.delete_prefix("list:")
    return conv


def get_or_create_conversation(
    session: Session,
    conversation_id: Optional[int],
    project_id: Optional[int] = None,
    skill_id: Optional[int] = None,
    owner_user_id: Optional[int] = None,
) -> Conversation:
    if conversation_id:
        return get_conversation_or_404(session, conversation_id)
    return create_conversation_record(session, project_id=project_id, skill_id=skill_id, owner_user_id=owner_user_id)


def get_conversation_messages(
    session: Session,
    conv_id: int,
    limit: int = 30,
    before_id: Optional[int] = None,
):
    get_conversation_or_404(session, conv_id)
    stmt = (
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    if before_id is not None:
        stmt = stmt.where(Message.id < before_id)
    msgs = session.exec(stmt).all()
    msgs.reverse()
    return msgs


def get_full_message_history(session: Session, conv_id: int):
    return session.exec(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at, Message.id)
    ).all()


def get_recent_message_history(
    session: Session,
    conv_id: int,
    limit: int = 24,
):
    msgs = session.exec(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(limit)
    ).all()
    msgs.reverse()
    return msgs


def build_message_metadata(
    project_id: Optional[int] = None,
    skill_id: Optional[int] = None,
    rag_doc_ids: Optional[list[int]] = None,
    file_ids: Optional[list[int]] = None,
    mention_context: Optional[dict] = None,
    turn_brief: Optional[dict] = None,
) -> dict:
    metadata = {}
    if skill_id:
        metadata["skill_id"] = skill_id
    if rag_doc_ids:
        metadata["doc_ids"] = rag_doc_ids
    if file_ids:
        metadata["file_ids"] = file_ids
    if project_id:
        metadata["project_id"] = project_id
    if mention_context and any(mention_context.values()):
        metadata["mention_context"] = mention_context
    if turn_brief:
        goal = re.sub(r"\s+", " ", str(turn_brief.get("goal") or "")).strip()[:240]
        constraints: list[str] = []
        for item in list(turn_brief.get("constraints") or []):
            normalized = re.sub(r"\s+", " ", str(item or "")).strip()[:160]
            if normalized and normalized not in constraints:
                constraints.append(normalized)
            if len(constraints) >= 8:
                break
        if goal or constraints:
            metadata["turn_brief"] = {"goal": goal, "constraints": constraints}
    return metadata


def persist_user_message(
    session: Session,
    conv_id: int,
    content: str,
    metadata: Optional[dict] = None,
) -> Message:
    now = utc_now_naive()
    user_msg = Message(
        conversation_id=conv_id,
        role="user",
        content=content,
        metadata_json=json.dumps(metadata, ensure_ascii=False, default=str) if metadata else "{}",
    )
    session.add(user_msg)
    conv = session.get(Conversation, conv_id)
    if conv:
        conv.updated_at = now
        session.add(conv)
    session.commit()
    conversations_cache.delete_prefix("list:")
    return user_msg


@dataclass(frozen=True)
class ArtifactPersistenceBatch:
    artifacts: list[dict]
    run_outputs: list[dict]
    failures: list[dict]


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_file_kind(value: str) -> str:
    normalized = str(value or "").strip().lower().lstrip(".")
    return {
        "markdown": "md",
        "text": "txt",
        "jpeg": "jpg",
    }.get(normalized, normalized)


_VERIFIABLE_FILE_KINDS = {
    "pptx",
    "docx",
    "xlsx",
    "pdf",
    "md",
    "txt",
    "json",
    "csv",
    "html",
    "jpg",
    "png",
}


def persist_run_artifacts(
    bind,
    conv_id: int,
    artifacts: list[dict],
    project_id: Optional[int] = None,
    *,
    run_id: str = "",
    run_outputs: Optional[list[dict]] = None,
) -> ArtifactPersistenceBatch:
    if not artifacts:
        return ArtifactPersistenceBatch([], normalize_run_output_records(run_outputs or []), [])

    normalized_artifacts: list[dict] = []
    normalized_outputs = normalize_run_output_records(run_outputs or [])
    failures: list[dict] = []
    records_by_id = {
        str(item.get("output_id") or ""): item
        for item in normalized_outputs
        if isinstance(item, dict) and item.get("output_id")
    }
    with Session(bind) as session:
        for artifact in artifacts:
            name = str(artifact.get("name") or "").strip()
            path = str(artifact.get("path") or "").strip()
            file_type = str(artifact.get("file_type") or "").strip()
            output_id = str(artifact.get("output_id") or "").strip()
            record = records_by_id.get(output_id) or build_artifact_output_record(
                artifact,
                run_id=run_id,
                source_tool=str(artifact.get("source_tool") or ""),
                tool_use_id=str(artifact.get("tool_use_id") or ""),
            )
            output_id = str(record.get("output_id") or output_id)
            if not (name and path and file_type):
                failed_record = mark_run_output_failed(
                    record,
                    "ARTIFACT_SCHEMA_INVALID",
                    "artifact name, path, and file_type are required",
                )
                append_run_output_record(normalized_outputs, failed_record)
                failures.append(failed_record)
                continue

            try:
                full_path = resolve_upload_path(
                    UPLOADS_DIR,
                    path,
                    must_exist=True,
                    allow_absolute=True,
                )
            except HTTPException as exc:
                failure_code = (
                    "ARTIFACT_PATH_UNSAFE"
                    if int(exc.status_code) == 400
                    else "ARTIFACT_FILE_MISSING"
                )
                failed_record = mark_run_output_failed(
                    record,
                    failure_code,
                    str(exc.detail),
                )
                append_run_output_record(normalized_outputs, failed_record)
                failures.append(failed_record)
                continue

            relative_path = str(full_path.relative_to(UPLOADS_DIR.resolve()))
            expected_kind = _canonical_file_kind(file_type)
            path_kind = _canonical_file_kind(full_path.suffix)
            name_kind = _canonical_file_kind(Path(name).suffix)
            if expected_kind in _VERIFIABLE_FILE_KINDS and (
                path_kind != expected_kind
                or (name_kind and name_kind != expected_kind)
            ):
                failed_record = mark_run_output_failed(
                    record,
                    "ARTIFACT_TYPE_MISMATCH",
                    "artifact file_type does not match its file extension",
                )
                append_run_output_record(normalized_outputs, failed_record)
                failures.append(failed_record)
                continue

            project_file_id = artifact.get("project_file_id")
            if isinstance(project_file_id, int):
                project_file = session.get(ProjectFile, project_file_id)
                project_file_invalid = (
                    project_file is None
                    or project_file.deleted_at is not None
                    or (project_id is not None and project_file.project_id != project_id)
                )
                if not project_file_invalid:
                    try:
                        project_file_path = resolve_upload_path(
                            UPLOADS_DIR,
                            project_file.path,
                            must_exist=True,
                            allow_absolute=True,
                        )
                        project_file_invalid = project_file_path != full_path
                    except HTTPException:
                        project_file_invalid = True
                if project_file_invalid:
                    failed_record = mark_run_output_failed(
                        record,
                        "PROJECT_FILE_EVIDENCE_MISMATCH",
                        "project_file_id does not resolve to the produced artifact",
                    )
                    append_run_output_record(normalized_outputs, failed_record)
                    failures.append(failed_record)
                    continue

            existing = None
            if output_id:
                existing = session.exec(
                    select(GeneratedFile).where(
                        GeneratedFile.conversation_id == conv_id,
                        GeneratedFile.output_id == output_id,
                    )
                ).first()
            if existing is None:
                existing = session.exec(
                    select(GeneratedFile).where(
                        GeneratedFile.conversation_id == conv_id,
                        GeneratedFile.path == relative_path,
                        GeneratedFile.name == name,
                    )
                ).first()

            size_bytes = full_path.stat().st_size
            content_sha256 = _file_sha256(full_path)

            description = str(artifact.get("description") or "")
            mime_type = str(artifact.get("mime_type") or "")
            source_tool = str(artifact.get("source_tool") or "")[:120]

            if existing:
                existing.project_id = project_id if project_id is not None else existing.project_id
                existing.file_type = file_type or existing.file_type
                existing.path = relative_path
                existing.size_bytes = size_bytes
                existing.run_id = run_id or existing.run_id
                existing.output_id = output_id or existing.output_id
                existing.source_tool = source_tool or existing.source_tool
                existing.content_sha256 = content_sha256
                existing.output_record_version = RUN_OUTPUT_RECORD_VERSION
                if description:
                    existing.description = description
                if mime_type:
                    existing.mime_type = mime_type
                session.add(existing)
                session.flush()
                record = existing
            else:
                record = GeneratedFile(
                    conversation_id=conv_id,
                    project_id=project_id,
                    name=name,
                    file_type=file_type,
                    path=relative_path,
                    size_bytes=size_bytes,
                    description=description,
                    mime_type=mime_type,
                    run_id=run_id,
                    output_id=output_id,
                    source_tool=source_tool,
                    content_sha256=content_sha256,
                    output_record_version=RUN_OUTPUT_RECORD_VERSION,
                )
                session.add(record)
                session.flush()

            artifact_payload = dict(artifact)
            artifact_payload["id"] = record.id
            artifact_payload["conversation_id"] = conv_id
            artifact_payload["project_id"] = project_id
            artifact_payload["path"] = relative_path
            artifact_payload["size_bytes"] = size_bytes
            artifact_payload["output_id"] = output_id
            artifact_payload["content_sha256"] = content_sha256
            artifact_payload["persistence_status"] = "persisted"
            if description:
                artifact_payload["description"] = description
            normalized_artifacts.append(artifact_payload)

            persisted_record = mark_artifact_output_persisted(
                records_by_id.get(output_id) or build_artifact_output_record(
                    artifact_payload,
                    run_id=run_id,
                    source_tool=source_tool,
                    tool_use_id=str(artifact.get("tool_use_id") or ""),
                ),
                generated_file_id=int(record.id),
                size_bytes=size_bytes,
                content_sha256=content_sha256,
                project_file_id=project_file_id if isinstance(project_file_id, int) else None,
            )
            append_run_output_record(normalized_outputs, persisted_record)

        session.commit()

    return ArtifactPersistenceBatch(
        artifacts=normalized_artifacts,
        run_outputs=normalize_run_output_records(normalized_outputs),
        failures=failures,
    )


def persist_generated_artifacts(
    bind,
    conv_id: int,
    artifacts: list[dict],
    project_id: Optional[int] = None,
) -> list[dict]:
    """Compatibility wrapper; new chat code consumes ``persist_run_artifacts``."""

    return persist_run_artifacts(
        bind,
        conv_id,
        artifacts,
        project_id,
    ).artifacts


def persist_assistant_message(
    bind,
    conv_id: int,
    content: str,
    user_content: str,
    metadata: Optional[dict] = None,
) -> tuple[bool, int | None]:
    need_title = False
    message_id: int | None = None
    metadata_payload = dict(metadata or {})
    with Session(bind) as new_session:
        asst_msg = Message(
            conversation_id=conv_id,
            role="assistant",
            content=content,
            metadata_json=json.dumps(metadata_payload, ensure_ascii=False, default=str) if metadata_payload else "{}",
        )
        new_session.add(asst_msg)
        new_session.flush()
        message_id = asst_msg.id
        conv = new_session.get(Conversation, conv_id)
        if conv:
            conv.updated_at = utc_now_naive()
            # Title-generation trigger. Fires when the title is still a
            # stand-in, including legacy numbered/default labels from older UI
            # paths. Real user-edited titles are preserved.
            if _is_placeholder_conversation_title(conv.title):
                conv.title = user_content[:40] + ("…" if len(user_content) > 40 else "")
                need_title = True
            new_session.add(conv)
        try:
            from app.services.conversation_state import upsert_conversation_state_from_metadata

            upsert_conversation_state_from_metadata(
                new_session,
                conversation_id=conv_id,
                user_content=user_content,
                assistant_content=content,
                metadata=metadata_payload,
                message_id=message_id,
            )
        except Exception as exc:
            logger.warning("Failed to update persistent conversation state for %s", conv_id, exc_info=True)
            metadata_payload["conversation_state_error"] = {
                "type": exc.__class__.__name__,
                "message": str(exc)[:500],
            }
            asst_msg.metadata_json = json.dumps(metadata_payload, ensure_ascii=False, default=str)
            new_session.add(asst_msg)
        new_session.commit()
    conversations_cache.delete_prefix("list:")
    return need_title, message_id


def delete_conversation_with_messages(session: Session, conv_id: int, *, clear_cache: bool = True) -> None:
    conv = get_conversation_or_404(session, conv_id)
    messages = session.exec(select(Message).where(Message.conversation_id == conv_id)).all()
    message_source_ids = [str(message.id) for message in messages if message.id is not None]
    if message_source_ids:
        for candidate in session.exec(
            select(MemoryCandidate).where(
                MemoryCandidate.source_type == "chat_message",
                MemoryCandidate.source_id.in_(message_source_ids),
            )
        ).all():
            candidate.source_type = "deleted_chat_message"
            if candidate.status == "pending":
                candidate.status = "archived"
                candidate.decision_note = "Source conversation deleted"
                candidate.resolved_at = utc_now_naive()
            session.add(candidate)
        session.flush()
    for task in session.exec(select(TaskRun).where(TaskRun.conversation_id == conv_id)).all():
        task.conversation_id = None
        session.add(task)
    for artifact in session.exec(select(GeneratedFile).where(GeneratedFile.conversation_id == conv_id)).all():
        session.delete(artifact)
    for tool_call in session.exec(select(ToolCall).where(ToolCall.conversation_id == conv_id)).all():
        session.delete(tool_call)
    for trace in session.exec(select(ChatTrace).where(ChatTrace.conversation_id == conv_id)).all():
        session.delete(trace)
    for state in session.exec(select(ConversationState).where(ConversationState.conversation_id == conv_id)).all():
        session.delete(state)
    for action in session.exec(select(PendingToolAction).where(PendingToolAction.conversation_id == conv_id)).all():
        session.delete(action)
    session.flush()
    for msg in messages:
        session.delete(msg)
    session.delete(conv)
    session.commit()
    if clear_cache:
        conversations_cache.delete_prefix("list:")


def update_conversation_title(
    session: Session,
    conv_id: int,
    title: str,
) -> Conversation:
    conv = get_conversation_or_404(session, conv_id)
    conv.title = title
    conv.updated_at = utc_now_naive()
    session.add(conv)
    session.commit()
    session.refresh(conv)
    conversations_cache.delete_prefix("list:")
    return conv
