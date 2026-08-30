"""Client-record authorization derived from stable project relationships."""
from __future__ import annotations

from collections.abc import Iterable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import ClientRecord, Project, ProjectMember, User
from app.services.client_identity import (
    lock_client_identity_values,
    resolve_client_identity,
)


_CLIENT_WRITE_ROLES = {"owner", "editor"}


def accessible_client_ids(session: Session, user: User) -> set[int] | None:
    """Return accessible stable client IDs; admins receive ``None`` for all."""

    if user.is_admin:
        return None
    user_id = int(user.id or 0)
    created_ids = session.exec(
        select(ClientRecord.id).where(ClientRecord.created_by_user_id == user_id)
    ).all()
    linked_ids = session.exec(
        select(Project.client_id)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            ProjectMember.user_id == user_id,
            Project.client_id.is_not(None),
        )
        .distinct()
    ).all()
    return {
        int(client_id)
        for client_id in [*created_ids, *linked_ids]
        if client_id is not None
    }


def _memberships_for_client(
    session: Session,
    *,
    client_id: int,
    user_id: int,
    for_update: bool = False,
    locked_projects: list[Project] | None = None,
) -> list[ProjectMember]:
    project_ids = (
        [int(project.id) for project in locked_projects if project.id is not None]
        if locked_projects is not None
        else list(
            session.exec(
                select(Project.id)
                .where(Project.client_id == client_id)
                .order_by(Project.id)
            ).all()
        )
    )
    if not project_ids:
        return []
    statement = (
        select(ProjectMember)
        .where(
            ProjectMember.project_id.in_(project_ids),
            ProjectMember.user_id == user_id,
        )
        .order_by(ProjectMember.id)
        .execution_options(populate_existing=True)
    )
    if for_update:
        statement = statement.with_for_update()
    return list(session.exec(statement).all())


def _is_authorized(
    user: User,
    client: ClientRecord,
    memberships: Iterable[ProjectMember],
    *,
    require_write: bool,
) -> bool:
    if user.is_admin or client.created_by_user_id == user.id:
        return True
    memberships = list(memberships)
    if not memberships:
        return False
    if not require_write:
        return True
    return any(
        str(member.role or "").strip().lower() in _CLIENT_WRITE_ROLES
        for member in memberships
    )


def _can_write_every_linked_project(
    user: User,
    client: ClientRecord,
    memberships: Iterable[ProjectMember],
    projects: Iterable[Project],
) -> bool:
    """Authorize client-wide writes that mutate every linked project.

    Ordinary client metadata keeps the existing any-project-write ACL. Renames
    and deletion are broader: they rewrite or unlink every linked project, so a
    project-scoped actor must be able to write every affected project. The
    client creator and admins remain the client-wide authorities.
    """

    if user.is_admin or client.created_by_user_id == user.id:
        return True
    project_ids = {
        int(project.id)
        for project in projects
        if project.id is not None
    }
    if not project_ids:
        return False
    writable_project_ids = {
        int(member.project_id)
        for member in memberships
        if str(member.role or "").strip().lower() in _CLIENT_WRITE_ROLES
    }
    return project_ids.issubset(writable_project_ids)


def require_client_access(
    session: Session,
    client_id: int,
    user: User,
    *,
    require_write: bool = False,
) -> ClientRecord:
    """Authorize a current snapshot for read paths and early write failure."""

    client = session.get(ClientRecord, client_id)
    if client is None:
        raise HTTPException(404, "Client not found")
    memberships = _memberships_for_client(
        session,
        client_id=client_id,
        user_id=int(user.id or 0),
    )
    if not _is_authorized(
        user,
        client,
        memberships,
        require_write=require_write,
    ):
        permission = "write" if require_write else "access"
        raise HTTPException(403, f"Client {permission} permission required")
    return client


def lock_and_require_client_access(
    session: Session,
    client_id: int,
    user: User,
    *,
    require_write: bool = False,
    require_all_linked_project_write: bool = False,
    additional_identity_values: Iterable[str | None] = (),
) -> tuple[ClientRecord, User, list[Project]]:
    """Perform final client authorization under the shared row-lock order.

    Order: client-name namespace -> User -> Projects (ID order) -> ClientRecord
    -> ProjectMembers (ID order). Callers may then lock client-owned children.
    """

    locator = session.exec(
        select(ClientRecord)
        .where(ClientRecord.id == client_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Client not found")
    identities = lock_client_identity_values(
        session,
        (locator.name, *tuple(additional_identity_values)),
    )
    expected_identity = identities[0]

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

    projects = list(
        session.exec(
            select(Project)
            .where(Project.client_id == client_id)
            .order_by(Project.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    )
    session.expire(locator)
    client = session.exec(
        select(ClientRecord)
        .where(ClientRecord.id == client_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if client is None:
        raise HTTPException(409, "Client was deleted; reload and retry.")
    if resolve_client_identity(session, client.name) != expected_identity:
        raise HTTPException(409, "Client changed; reload and retry.")

    # Projects must be locked before ClientRecord in the global order. A link
    # transaction that started just after the first Project query can therefore
    # commit while this transaction is waiting for the Client row. Once the
    # Client FOR UPDATE lock is held, its FK parent lock excludes further links;
    # a non-locking re-read detects the already-committed phantom without
    # acquiring Project rows after Client and inverting the lock order.
    locked_project_ids = [
        int(project.id)
        for project in projects
        if project.id is not None
    ]
    current_project_ids = [
        int(project_id)
        for project_id in session.exec(
            select(Project.id)
            .where(Project.client_id == client_id)
            .order_by(Project.id)
        ).all()
        if project_id is not None
    ]
    if current_project_ids != locked_project_ids:
        raise HTTPException(
            409,
            "Client project links changed; reload and retry.",
        )

    memberships = _memberships_for_client(
        session,
        client_id=client_id,
        user_id=int(actor.id),
        for_update=True,
        locked_projects=projects,
    )
    if not _is_authorized(
        actor,
        client,
        memberships,
        require_write=require_write,
    ):
        permission = "write" if require_write else "access"
        raise HTTPException(403, f"Client {permission} permission required")
    if require_all_linked_project_write and not _can_write_every_linked_project(
        actor,
        client,
        memberships,
        projects,
    ):
        raise HTTPException(
            403,
            "Client-wide write permission requires write access to every linked project",
        )
    return client, actor, projects
