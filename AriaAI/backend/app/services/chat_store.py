from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import CONVERSATION_CACHE_TTL
from app.models.db import Conversation, Message
from app.services.cache import conversations_cache
from app.services.time_utils import utc_now_naive

_CONV_TTL = CONVERSATION_CACHE_TTL


def list_conversations_cached(
    session: Session,
    project_id: Optional[int] = None,
    standalone: bool = False,
):
    cache_key = f"list:{project_id or ''}:{'s' if standalone else ''}"
    cached = conversations_cache.get(cache_key)
    if cached is not None:
        return cached

    stmt = select(Conversation).order_by(Conversation.updated_at.desc()).limit(100)
    if project_id:
        stmt = stmt.where(Conversation.project_id == project_id)
    elif standalone:
        stmt = stmt.where(Conversation.project_id == None)  # noqa: E711

    result = session.exec(stmt).all()
    conversations_cache.set(cache_key, result, _CONV_TTL)
    return result


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
) -> Conversation:
    conv = Conversation(project_id=project_id, skill_id=skill_id, title=title)
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
) -> Conversation:
    if conversation_id:
        return get_conversation_or_404(session, conversation_id)
    return create_conversation_record(session, project_id=project_id, skill_id=skill_id)


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
    user_msg = Message(
        conversation_id=conv_id,
        role="user",
        content=content,
        metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata else "{}",
    )
    session.add(user_msg)
    session.commit()
    return user_msg


def persist_assistant_message(
    bind,
    conv_id: int,
    content: str,
    user_content: str,
    metadata: Optional[dict] = None,
) -> bool:
    need_title = False
    with Session(bind) as new_session:
        asst_msg = Message(
            conversation_id=conv_id,
            role="assistant",
            content=content,
            metadata_json=json.dumps(metadata, ensure_ascii=False) if metadata else "{}",
        )
        new_session.add(asst_msg)
        conv = new_session.get(Conversation, conv_id)
        if conv:
            conv.updated_at = utc_now_naive()
            if conv.title == "New Workstream":
                conv.title = user_content[:40] + ("…" if len(user_content) > 40 else "")
                need_title = True
            new_session.add(conv)
        new_session.commit()
    return need_title


def delete_conversation_with_messages(session: Session, conv_id: int) -> None:
    conv = get_conversation_or_404(session, conv_id)
    for msg in session.exec(select(Message).where(Message.conversation_id == conv_id)).all():
        session.delete(msg)
    session.delete(conv)
    session.commit()
    conversations_cache.delete_prefix("list:")
