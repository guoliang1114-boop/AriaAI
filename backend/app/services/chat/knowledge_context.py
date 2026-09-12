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


# Compositional but deliberately bounded: all clauses must be a known rewrite
# request or a presentation/read-only modifier. No wildcard can swallow a new
# topic, proposed write or a factual question such as "第二条预算是多少".
_REFERENCE = r"(?:上述|上面(?:的)?|刚才(?:的)?|上一条(?:的)?|前面(?:的)?|这些|这个)(?:回答|答复|内容|分析|方法|结论|建议)?"
_TARGET = r"(?:表格|列表|英文|中文|[一二三四五六七八九十两1-9][0-9]?(?:条|点|项)|\d{2,4}字以内)"
_REWRITE = r"(?:精简|压缩|浓缩|总结|概括|整理|改写)"
_FOLLOWUP = re.compile(
    rf"^(?:请|帮我|请帮我)?(?:再)?(?:"
    rf"继续(?:回答|说明|展开)?|展开(?:说明|一下)?|详细(?:解释|说明)(?:一下)?|"
    rf"{_REWRITE}(?:一下|(?:成|为|到){_TARGET})?|"
    rf"(?:改成|改为|换成){_TARGET}|简短一点|短一点|更具体一点|"
    rf"(?:把|将)?{_REFERENCE}{_REWRITE}(?:一下|(?:成|为|到){_TARGET})?|"
    rf"(?:把|将)?{_REFERENCE}(?:改成|改为|换成){_TARGET}|"
    rf"{_REWRITE}{_REFERENCE}(?:成|为|到)?(?:{_TARGET})?"
    rf")$"
)
_FOLLOWUP_MODIFIER = re.compile(
    r"^(?:请|并|且|并且)?(?:保留(?:资料|来源)?引用|标注(?:资料|来源)?引用|保留关键结论|"
    r"(?:不超过|最多|控制在)\d{2,4}(?:字符|字)(?:以内)?|\d{2,4}(?:字符|字)以内|"
    r"(?:只|仅)(?:回答|文字回答|分析)|(?:不|不要|无需|不需要)"
    r"(?:生成文件|修改项目(?:内容|数据)?|写入项目(?:内容|数据)?))$"
)


def is_knowledge_rewrite_followup(content: str) -> bool:
    if not content or len(content) > 240:
        return False
    clauses = [re.sub(r"\s+", "", clause) for clause in re.split(r"[，,。；;！!？?\n]", content) if clause.strip()]
    return bool(clauses) and any(_FOLLOWUP.fullmatch(clause) for clause in clauses) and all(
        _FOLLOWUP.fullmatch(clause) or _FOLLOWUP_MODIFIER.fullmatch(clause) for clause in clauses
    )


def is_concise_knowledge_rewrite_followup(content: str) -> bool:
    # Expansion/continuation is not a lightweight rewrite, even with a ceiling.
    return is_knowledge_rewrite_followup(content) and bool(re.search(r"精简|压缩|浓缩|简短一点|短一点", content))


def contextual_knowledge_query(*, content: str, document_ids: list[int] | None,
                               history: list[Message], current_message_id: int | None,
                               conversation_id: int) -> tuple[str, int | None]:
    """Requery current authorized documents using the last same-scope topic.

    Only user text supplies query terms. No old evidence/content is re-granted,
    and a removed/replaced scope or malformed record ends the search.
    """
    if not document_ids or not is_knowledge_rewrite_followup(content):
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
        reservation = metadata.get("recovery_reservation")
        if isinstance(reservation, dict) and reservation.get("status") in {"reserved", "expired"}:
            continue
        if _selection(metadata) != expected:
            break
        previous = str(message.content or "").strip()
        if previous and not is_knowledge_rewrite_followup(previous):
            return f"{previous[:2000]}\n{content}", message.id
    return content, None
