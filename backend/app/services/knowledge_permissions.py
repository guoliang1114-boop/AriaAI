from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlalchemy import or_
from sqlmodel import Session, select

from app.models.db import ClientRecord, KnowledgeDocument, Project, ProjectMember, User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.services.client_identity import lock_client_identity_values, resolve_client_identity
from app.services.project_clients import list_projects_for_client


_KNOWLEDGE_WRITE_ROLES = {"owner", "editor"}


class KnowledgeWriteAuthorizationLost(RuntimeError):
    """A deferred knowledge write no longer owns its actor/scope authority."""


def _member_can_write(member: ProjectMember) -> bool:
    return str(member.role or "").strip().lower() in _KNOWLEDGE_WRITE_ROLES


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


def has_project_write_access(user_id: int, project_id: int | None, session: Session) -> bool:
    """Return whether a project member may mutate project-scoped knowledge."""

    if project_id is None or session.get(Project, project_id) is None:
        return False
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    return member is not None and _member_can_write(member)


def has_client_access(user_id: int, client_id: int | None, session: Session) -> bool:
    if client_id is None:
        return False
    # The current product has no dedicated client membership table. Keep the
    # v1 rule conservative: admins pass in the caller, regular users get client
    # knowledge when they are members of at least one project for that client.
    client = session.get(ClientRecord, client_id)
    if not client:
        return False
    if client.created_by_user_id == user_id:
        return True
    project_ids = [
        int(project.id)
        for project in list_projects_for_client(session, client)
        if project.id is not None
    ]
    if not project_ids:
        return False
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id.in_(project_ids),
            ProjectMember.user_id == user_id,
        )
    ).first()
    return member is not None


def has_client_write_access(
    user_id: int,
    client_id: int | None,
    session: Session,
) -> bool:
    """Use only stable Project.client_id links when deriving client write access."""

    if client_id is None:
        return False
    client = session.get(ClientRecord, client_id)
    if client is None:
        return False
    if client.created_by_user_id == user_id:
        return True
    project_ids = [
        int(project.id)
        for project in list_projects_for_client(session, client)
        if project.id is not None
    ]
    if not project_ids:
        return False
    memberships = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id.in_(project_ids),
            ProjectMember.user_id == user_id,
        )
    ).all()
    return any(_member_can_write(member) for member in memberships)


def accessible_project_ids(user: User, session: Session) -> list[int]:
    if user.is_admin:
        return list(session.exec(select(Project.id)).all())
    return list(
        session.exec(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
        ).all()
    )


def can_access_legacy_document(
    user: User,
    document: KnowledgeDocument,
    session: Session,
) -> bool:
    """Apply the v0.0.5 scope boundary to the legacy knowledge model."""

    if user.is_admin:
        return True
    if document.project_id is not None:
        return has_project_access(user.id, document.project_id, session)
    if document.client_id is not None:
        return has_client_access(user.id, document.client_id, session)
    return bool(user.is_active)


def can_write_legacy_document(
    user: User,
    document: KnowledgeDocument,
    session: Session,
) -> bool:
    """Authorize legacy document mutation without weakening viewer reads."""

    return can_write_legacy_scope(
        user,
        project_id=document.project_id,
        client_id=document.client_id,
        session=session,
    )


def can_write_legacy_scope(
    user: User,
    *,
    project_id: int | None,
    client_id: int | None,
    session: Session,
) -> bool:
    """Authorize a proposed legacy document scope before any file write."""

    if user.is_admin:
        return True
    if project_id is None and client_id is None:
        return False
    # Project scope is authoritative when both legacy columns are populated.
    # A membership on another project for the same client must never grant
    # write access to this project's document.
    if project_id is not None:
        return has_project_write_access(int(user.id or 0), project_id, session)
    return has_client_write_access(int(user.id or 0), client_id, session)


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


def can_write_source(user: User, source: KnowledgeSource, session: Session) -> bool:
    """Authorize source mutation separately from the deliberately wider read ACL."""

    if user.is_admin:
        return True
    if source.scope_type == "user":
        return source.owner_user_id == user.id
    if source.scope_type == "project":
        return has_project_write_access(int(user.id or 0), source.scope_id, session)
    if source.scope_type == "client":
        return has_client_write_access(int(user.id or 0), source.scope_id, session)
    if source.scope_type in {"workspace", "skill", "global"}:
        return False
    return False


def _lock_active_actor(session: Session, user: User) -> User:
    actor = session.exec(
        select(User)
        .where(User.id == user.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if actor is None:
        raise HTTPException(401, "Not authenticated")
    if not actor.is_active:
        raise HTTPException(403, "User account is inactive")
    return actor


def _lock_and_require_scope_sets(
    session: Session,
    user: User,
    *,
    project_ids: Iterable[int] = (),
    client_ids: Iterable[int] = (),
) -> tuple[User, list[Project], list[ClientRecord]]:
    """Lock and authorize the union of project/client knowledge scopes.

    Shared order: client identity namespaces -> User -> Projects (ID) ->
    Clients (ID) -> ProjectMembers (ID). Knowledge children are locked only by
    the caller after this helper returns.
    """

    requested_project_ids = sorted({int(value) for value in project_ids})
    requested_client_ids = sorted({int(value) for value in client_ids})
    client_locators = (
        list(
            session.exec(
                select(ClientRecord)
                .where(ClientRecord.id.in_(requested_client_ids))
                .order_by(ClientRecord.id)
                .execution_options(populate_existing=True)
            ).all()
        )
        if requested_client_ids
        else []
    )
    if {int(client.id) for client in client_locators} != set(requested_client_ids):
        raise HTTPException(404, "Client not found")
    expected_client_identities = {
        int(client.id): identity
        for client, identity in zip(
            client_locators,
            lock_client_identity_values(
                session,
                [client.name for client in client_locators],
            ),
        )
    }

    actor = _lock_active_actor(session, user)
    project_conditions = []
    if requested_project_ids:
        project_conditions.append(Project.id.in_(requested_project_ids))
    if requested_client_ids:
        project_conditions.append(Project.client_id.in_(requested_client_ids))
    locked_projects = (
        list(
            session.exec(
                select(Project)
                .where(or_(*project_conditions))
                .order_by(Project.id)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).all()
        )
        if project_conditions
        else []
    )
    locked_project_ids = {int(project.id) for project in locked_projects}
    if not set(requested_project_ids).issubset(locked_project_ids):
        raise HTTPException(404, "Project not found")

    for locator in client_locators:
        session.expire(locator)
    locked_clients = (
        list(
            session.exec(
                select(ClientRecord)
                .where(ClientRecord.id.in_(requested_client_ids))
                .order_by(ClientRecord.id)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).all()
        )
        if requested_client_ids
        else []
    )
    if {int(client.id) for client in locked_clients} != set(requested_client_ids):
        raise HTTPException(409, "Client was deleted; reload and retry.")
    for client in locked_clients:
        if (
            resolve_client_identity(session, client.name)
            != expected_client_identities[int(client.id)]
        ):
            raise HTTPException(409, "Client changed; reload and retry.")

    all_project_ids = sorted(locked_project_ids)
    memberships = (
        session.exec(
            select(ProjectMember)
            .where(
                ProjectMember.project_id.in_(all_project_ids),
                ProjectMember.user_id == actor.id,
            )
            .order_by(ProjectMember.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
        if all_project_ids
        else []
    )
    writable_project_ids = {
        int(member.project_id)
        for member in memberships
        if _member_can_write(member)
    }
    if not actor.is_admin:
        if not set(requested_project_ids).issubset(writable_project_ids):
            raise HTTPException(403, "Project write permission required")
        for client in locked_clients:
            if client.created_by_user_id == actor.id:
                continue
            linked_project_ids = {
                int(project.id)
                for project in locked_projects
                if project.client_id == client.id
            }
            if not linked_project_ids.intersection(writable_project_ids):
                raise HTTPException(403, "Client write permission required")
    return actor, locked_projects, locked_clients


def lock_and_require_knowledge_scope_write(
    session: Session,
    user: User,
    *,
    scope_type: str,
    scope_id: int | None,
    owner_user_id: int | None = None,
) -> User:
    """Reload the active actor and authorize one knowledge scope under locks."""

    normalized_scope = str(scope_type or "").strip().lower()
    if normalized_scope == "client":
        if scope_id is None:
            raise HTTPException(403, "Client write permission required")
        actor, _, _ = _lock_and_require_scope_sets(
            session,
            user,
            client_ids=(int(scope_id),),
        )
        return actor
    if normalized_scope == "project":
        if scope_id is None:
            raise HTTPException(403, "Project write permission required")
        actor, _, _ = _lock_and_require_scope_sets(
            session,
            user,
            project_ids=(int(scope_id),),
        )
        return actor

    actor = _lock_active_actor(session, user)
    if normalized_scope == "user":
        if owner_user_id != actor.id:
            raise HTTPException(403, "Knowledge source owner required")
        return actor
    if normalized_scope in {"workspace", "skill", "global"}:
        if not actor.is_admin:
            raise HTTPException(403, "Admin access is required for shared knowledge writes")
        return actor
    raise HTTPException(403, "Knowledge scope write permission required")


def lock_and_require_source_write(
    session: Session,
    source_id: int,
    user: User,
) -> tuple[KnowledgeSource, User]:
    """Perform the final source ACL check before a write or queue operation."""

    locator = session.exec(
        select(KnowledgeSource)
        .where(KnowledgeSource.id == source_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Knowledge source not found")
    expected_scope = (locator.scope_type, locator.scope_id, locator.owner_user_id)
    actor = lock_and_require_knowledge_scope_write(
        session,
        user,
        scope_type=locator.scope_type,
        scope_id=locator.scope_id,
        owner_user_id=locator.owner_user_id,
    )
    session.expire(locator)
    source = session.exec(
        select(KnowledgeSource)
        .where(KnowledgeSource.id == source_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if source is None:
        raise HTTPException(409, "Knowledge source was deleted; reload and retry.")
    if (source.scope_type, source.scope_id, source.owner_user_id) != expected_scope:
        raise HTTPException(409, "Knowledge source scope changed; reload and retry.")
    if not can_write_source(actor, source, session):
        raise HTTPException(403, "Knowledge source write permission required")
    return source, actor


def lock_and_require_source_document_write(
    session: Session,
    source_id: int,
    document_id: int,
    user: User,
) -> tuple[KnowledgeSource, KnowledgeV1Document, User]:
    """Lock an authorized source before its document child in stable order."""

    source, actor = lock_and_require_source_write(session, source_id, user)
    document = session.exec(
        select(KnowledgeV1Document)
        .where(KnowledgeV1Document.id == document_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if document is None or document.status == "deleted":
        raise HTTPException(409, "Knowledge document was deleted; reload and retry.")
    if document.source_id != source.id:
        raise HTTPException(409, "Knowledge document scope changed; reload and retry.")
    if (document.scope_type, document.scope_id) != (
        source.scope_type,
        source.scope_id,
    ):
        raise HTTPException(409, "Knowledge document scope changed; reload and retry.")
    return source, document, actor


def lock_and_require_legacy_scope_write(
    session: Session,
    user: User,
    *,
    project_id: int | None,
    client_id: int | None,
    additional_client_ids: Iterable[int] = (),
) -> User:
    """Finalize a proposed legacy document scope before upload or reassignment."""

    project_ids = (int(project_id),) if project_id is not None else ()
    client_ids = {int(value) for value in additional_client_ids}
    # Project-first authorization: ``client_id`` is frozen on the document row
    # but is not an alternate grant when an exact project scope exists.
    if project_id is None and client_id is not None:
        client_ids.add(int(client_id))
    if project_ids or client_ids:
        actor, _, _ = _lock_and_require_scope_sets(
            session,
            user,
            project_ids=project_ids,
            client_ids=client_ids,
        )
        if project_id is None and client_id is None and not actor.is_admin:
            raise HTTPException(403, "Admin access is required for shared knowledge writes")
        return actor
    return lock_and_require_knowledge_scope_write(
        session,
        user,
        scope_type="global",
        scope_id=None,
    )


def lock_and_require_legacy_document_write(
    session: Session,
    document_id: int,
    user: User,
    *,
    additional_client_ids: Iterable[int] = (),
) -> tuple[KnowledgeDocument, User]:
    """Perform the final legacy document ACL check under scope and row locks."""

    locator = session.exec(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.id == document_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Document not found")
    expected_scope = (locator.project_id, locator.client_id)
    actor = lock_and_require_legacy_scope_write(
        session,
        user,
        project_id=locator.project_id,
        client_id=locator.client_id,
        additional_client_ids=additional_client_ids,
    )
    session.expire(locator)
    document = session.exec(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.id == document_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if document is None:
        raise HTTPException(409, "Document was deleted; reload and retry.")
    if (document.project_id, document.client_id) != expected_scope:
        raise HTTPException(409, "Knowledge document scope changed; reload and retry.")
    if not can_write_legacy_document(actor, document, session):
        raise HTTPException(403, "Knowledge document write permission required")
    return document, actor


def _lock_knowledge_scope_for_trusted_system(
    session: Session,
    *,
    scope_type: str,
    scope_id: int | None,
    owner_user_id: int | None = None,
) -> None:
    """Lock a scope for an explicitly trusted Aria worker without an actor.

    This is intentionally not an authorization fallback. Callers must first
    prove that the durable job was explicitly created as trusted-system work.
    """

    normalized_scope = str(scope_type or "").strip().lower()
    if normalized_scope == "project":
        if scope_id is None:
            raise HTTPException(409, "Knowledge project scope is missing")
        project = session.exec(
            select(Project)
            .where(Project.id == int(scope_id))
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if project is None:
            raise HTTPException(409, "Knowledge project scope was deleted")
        return
    if normalized_scope == "client":
        if scope_id is None:
            raise HTTPException(409, "Knowledge client scope is missing")
        locator = session.exec(
            select(ClientRecord)
            .where(ClientRecord.id == int(scope_id))
            .execution_options(populate_existing=True)
        ).first()
        if locator is None:
            raise HTTPException(409, "Knowledge client scope was deleted")
        expected_identity = lock_client_identity_values(session, (locator.name,))[0]
        session.exec(
            select(Project)
            .where(Project.client_id == int(scope_id))
            .order_by(Project.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
        session.expire(locator)
        client = session.exec(
            select(ClientRecord)
            .where(ClientRecord.id == int(scope_id))
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if client is None or resolve_client_identity(session, client.name) != expected_identity:
            raise HTTPException(409, "Knowledge client scope changed")
        return
    if normalized_scope == "user":
        if owner_user_id is None:
            raise HTTPException(409, "Knowledge user scope owner is missing")
        owner = session.exec(
            select(User)
            .where(User.id == int(owner_user_id))
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if owner is None:
            raise HTTPException(409, "Knowledge user scope owner was deleted")
        return
    if normalized_scope in {"workspace", "skill", "global"}:
        return
    raise HTTPException(409, "Knowledge scope changed")


def lock_source_document_for_trusted_system(
    session: Session,
    source_id: int,
    document_id: int | None = None,
) -> tuple[KnowledgeSource, KnowledgeV1Document | None]:
    """Lock source parents and children for an explicit trusted-system job."""

    locator = session.exec(
        select(KnowledgeSource)
        .where(KnowledgeSource.id == source_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(409, "Knowledge source was deleted")
    expected_scope = (locator.scope_type, locator.scope_id, locator.owner_user_id)
    _lock_knowledge_scope_for_trusted_system(
        session,
        scope_type=locator.scope_type,
        scope_id=locator.scope_id,
        owner_user_id=locator.owner_user_id,
    )
    session.expire(locator)
    source = session.exec(
        select(KnowledgeSource)
        .where(KnowledgeSource.id == source_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if source is None or (
        source.scope_type,
        source.scope_id,
        source.owner_user_id,
    ) != expected_scope:
        raise HTTPException(409, "Knowledge source scope changed")
    if document_id is None:
        return source, None
    document = session.exec(
        select(KnowledgeV1Document)
        .where(KnowledgeV1Document.id == document_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if (
        document is None
        or document.status == "deleted"
        or document.source_id != source.id
        or (document.scope_type, document.scope_id)
        != (source.scope_type, source.scope_id)
    ):
        raise HTTPException(409, "Knowledge document scope changed")
    return source, document


def lock_legacy_document_for_trusted_system(
    session: Session,
    document_id: int,
) -> KnowledgeDocument:
    """Lock a legacy document under project-first trusted-system scope."""

    locator = session.exec(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.id == document_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(409, "Knowledge document was deleted")
    expected_scope = (locator.project_id, locator.client_id)
    if locator.project_id is not None:
        _lock_knowledge_scope_for_trusted_system(
            session,
            scope_type="project",
            scope_id=locator.project_id,
        )
    elif locator.client_id is not None:
        _lock_knowledge_scope_for_trusted_system(
            session,
            scope_type="client",
            scope_id=locator.client_id,
        )
    session.expire(locator)
    document = session.exec(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.id == document_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if document is None or (document.project_id, document.client_id) != expected_scope:
        raise HTTPException(409, "Knowledge document scope changed")
    return document


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
