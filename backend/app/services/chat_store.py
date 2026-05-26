from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import CHAT_RETENTION_DAYS, CONVERSATION_CACHE_TTL, UPLOADS_DIR
from app.models.db import ChatTrace, Conversation, ConversationState, GeneratedFile, Message, TaskRun, ToolCall
from app.services.cache import conversations_cache
from app.services.time_utils import utc_now_naive

_CONV_TTL = CONVERSATION_CACHE_TTL
_RETENTION_DAYS = max(CHAT_RETENTION_DAYS, 1)
logger = logging.getLogger(__name__)


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


def persist_generated_artifacts(
    bind,
    conv_id: int,
    artifacts: list[dict],
    project_id: Optional[int] = None,
) -> list[dict]:
    if not artifacts:
        return []

    normalized_artifacts: list[dict] = []
    with Session(bind) as session:
        for artifact in artifacts:
            name = str(artifact.get("name") or "").strip()
            path = str(artifact.get("path") or "").strip()
            file_type = str(artifact.get("file_type") or "").strip()
            if not (name and path and file_type):
                normalized_artifacts.append(dict(artifact))
                continue

            existing = session.exec(
                select(GeneratedFile).where(
                    GeneratedFile.conversation_id == conv_id,
                    GeneratedFile.path == path,
                    GeneratedFile.name == name,
                )
            ).first()

            full_path = UPLOADS_DIR / Path(path)
            size_bytes = artifact.get("size_bytes")
            if not isinstance(size_bytes, int):
                size_bytes = full_path.stat().st_size if full_path.is_file() else 0

            description = str(artifact.get("description") or "")
            mime_type = str(artifact.get("mime_type") or "")

            if existing:
                existing.project_id = project_id if project_id is not None else existing.project_id
                existing.file_type = file_type or existing.file_type
                existing.size_bytes = size_bytes or existing.size_bytes
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
                    path=path,
                    size_bytes=size_bytes,
                    description=description,
                    mime_type=mime_type,
                )
                session.add(record)
                session.flush()

            artifact_payload = dict(artifact)
            artifact_payload["id"] = record.id
            artifact_payload["conversation_id"] = conv_id
            artifact_payload["project_id"] = project_id
            artifact_payload["size_bytes"] = size_bytes
            if description:
                artifact_payload["description"] = description
            normalized_artifacts.append(artifact_payload)

        session.commit()

    return normalized_artifacts


def persist_assistant_message(
    bind,
    conv_id: int,
    content: str,
    user_content: str,
    metadata: Optional[dict] = None,
) -> tuple[bool, int | None]:
    need_title = False
    message_id: int | None = None
    with Session(bind) as new_session:
        asst_msg = Message(
            conversation_id=conv_id,
            role="assistant",
            content=content,
            metadata_json=json.dumps(metadata, ensure_ascii=False, default=str) if metadata else "{}",
        )
        new_session.add(asst_msg)
        new_session.flush()
        message_id = asst_msg.id
        conv = new_session.get(Conversation, conv_id)
        if conv:
            conv.updated_at = utc_now_naive()
            if conv.title == "New Workstream":
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
                metadata=metadata,
                message_id=message_id,
            )
        except Exception:
            logger.warning("Failed to update persistent conversation state for %s", conv_id, exc_info=True)
        new_session.commit()
    conversations_cache.delete_prefix("list:")
    return need_title, message_id


def delete_conversation_with_messages(session: Session, conv_id: int, *, clear_cache: bool = True) -> None:
    conv = get_conversation_or_404(session, conv_id)
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
    for msg in session.exec(select(Message).where(Message.conversation_id == conv_id)).all():
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
