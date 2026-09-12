"""Durable selection and bounded follow-up queries; never an ACL bypass."""
from __future__ import annotations

import json
import re

from sqlmodel import Session, select

from app.models.db import Message, User
from app.models.knowledge import KnowledgeV1Document
from app.services.knowledge_document_access import readable_document_source


def _metadata(message: Message) -> dict:
    try:
        value = json.loads(message.metadata_json or "{}")
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def _selection(metadata: dict) -> list[int]:
    values = metadata.get("knowledge_document_ids")
    if not isinstance(values, list) or not 1 <= len(values) <= 20:
        return []
    if any(type(value) is not int or value <= 0 for value in values):
        return []
    return sorted(set(values))


def conversation_knowledge_context(session: Session, conversation_id: int, user: User) -> dict:
    """Called only after conversation authorization. Latest turn wins, even empty."""
    payload = {"namespace": "source_scoped", "documents": [], "unavailable_count": 0}
    recent = session.exec(select(Message).where(
        Message.conversation_id == conversation_id, Message.role == "user",
    ).order_by(Message.id.desc()).limit(100)).all()
    for message in recent:
        metadata = _metadata(message)
        if metadata.get("run_steering"):
            continue
        reservation = metadata.get("recovery_reservation")
        if isinstance(reservation, dict) and reservation.get("status") in {"reserved", "expired"}:
            continue
        for document_id in _selection(metadata):
            document = session.get(KnowledgeV1Document, document_id)
            if document is None or document.status != "indexed" or readable_document_source(session, user, document) is None:
                payload["unavailable_count"] += 1
                continue
            payload["documents"].append({"id": document_id, "title": document.title})
        break
    return payload


# Deliberately narrow: new substantive questions do not inherit old search terms.
_FOLLOWUP = re.compile(
    r"^(?:请|帮我|再|请再)?(?:继续(?:回答|说明|展开)?|展开(?:说明|一下)?|详细(?:解释|说明)(?:一下)?|"
    r"(?:精简|压缩|浓缩|总结|概括|整理|改写)(?:一下|成.{1,12}|为.{1,12})?|"
    r"(?:改成|改为|换成)(?:表格|列表|两条|三条|英文|中文)|简短一点|再短一点|更具体一点)[。！!？?\s]*$",
    re.IGNORECASE,
)


def contextual_knowledge_query(*, content: str, document_ids: list[int] | None,
                               history: list[Message], current_message_id: int | None,
                               conversation_id: int) -> tuple[str, int | None]:
    """Requery current authorized documents using the last same-scope topic.

    Only user text supplies query terms. No old evidence/content is re-granted,
    and a removed/replaced scope or malformed record ends the search.
    """
    if not document_ids or len(content) > 160 or not _FOLLOWUP.fullmatch(content.strip()):
        return content, None
    expected = sorted(set(document_ids))
    for message in list(reversed(history))[:40]:
        if message.conversation_id != conversation_id:
            return content, None
        if message.id == current_message_id or message.role != "user":
            continue
        metadata = _metadata(message)
        if metadata.get("run_steering"):
            continue
        if _selection(metadata) != expected:
            break
        previous = str(message.content or "").strip()
        if previous and not _FOLLOWUP.fullmatch(previous):
            return f"{previous[:2000]}\n{content}", message.id
    return content, None
