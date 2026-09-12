"""One read boundary for source-scoped document viewers and chat selection."""
from __future__ import annotations

from sqlmodel import Session

from app.models.db import User
from app.models.knowledge import KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_permissions import can_access_source


def readable_document_source(session: Session, user: User, document: KnowledgeV1Document) -> KnowledgeSource | None:
    if not user.is_active or document.status == "deleted":
        return None
    source = session.get(KnowledgeSource, document.source_id)
    if (source is None or source.status != "active"
            or (document.scope_type, document.scope_id) != (source.scope_type, source.scope_id)
            or not can_access_source(user, source, session)):
        return None
    return source
