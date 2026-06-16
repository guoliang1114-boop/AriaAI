from __future__ import annotations

from sqlmodel import Session, select

from app.models.db import ClientRecord, Project, ProjectMember, User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document


def has_project_access(user_id: int, project_id: int | None, session: Session) -> bool:
    if project_id is None:
        return False
    project = session.get(Project, project_id)
    if not project:
        return False
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    return member is not None


def has_client_access(user_id: int, client_id: int | None, session: Session) -> bool:
    if client_id is None:
        return False
    # The current product has no dedicated client membership table. Keep the
    # v1 rule conservative: admins pass in the caller, regular users get client
    # knowledge when they are members of at least one project for that client.
    client = session.get(ClientRecord, client_id)
    if not client:
        return False
    project_ids = session.exec(select(Project.id).where(Project.client == client.name)).all()
    if not project_ids:
        return False
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id.in_(project_ids),
            ProjectMember.user_id == user_id,
        )
    ).first()
    return member is not None


def can_access_source(user: User, source: KnowledgeSource, session: Session) -> bool:
    if user.is_admin:
        return True
    if source.scope_type == "user":
        return source.owner_user_id == user.id
    if source.scope_type == "project":
        return has_project_access(user.id, source.scope_id, session)
    if source.scope_type == "client":
        return has_client_access(user.id, source.scope_id, session)
    if source.scope_type in {"workspace", "skill", "global"}:
        return user.is_active
    return False


def filter_chunks_by_permission(
    user: User,
    chunks: list[KnowledgeChunk],
    session: Session,
) -> list[KnowledgeChunk]:
    allowed: list[KnowledgeChunk] = []
    for chunk in chunks:
        doc = session.get(KnowledgeV1Document, chunk.document_id)
        if not doc:
            continue
        source = session.get(KnowledgeSource, doc.source_id)
        if not source:
            continue
        if can_access_source(user, source, session):
            allowed.append(chunk)
    return allowed

