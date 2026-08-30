from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import ClientRecord, Project, ProjectFolder, ProjectMember, User
from app.services.client_identity import (
    lock_client_identity_values,
    resolve_client_identity,
)
from app.services.project_clients import clients_matching_name, list_projects_for_client
from app.services.time_utils import utc_now_naive


DEFAULT_PROJECT_FOLDER_NAMES = ["项目需求", "方案和报价", "项目交付文档", "项目归档信息"]


def _normalize_project_identity(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def init_default_project_folders(
    session: Session,
    project_id: int,
    *,
    commit: bool = True,
) -> list[ProjectFolder]:
    existing = session.exec(
        select(ProjectFolder).where(ProjectFolder.project_id == project_id)
    ).all()
    if existing:
        return existing

    folders = [
        ProjectFolder(project_id=project_id, name=name, sort_order=index)
        for index, name in enumerate(DEFAULT_PROJECT_FOLDER_NAMES)
    ]
    for folder in folders:
        session.add(folder)
    if commit:
        session.commit()
    else:
        session.flush()
    for folder in folders:
        if commit:
            session.refresh(folder)
    return folders


def list_projects_basic(
    session: Session,
    *,
    status: str | None = None,
    member_user_id: int | None = None,
) -> list[Project]:
    stmt = select(Project).order_by(Project.updated_at.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    if member_user_id is not None:
        stmt = (
            stmt.join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == member_user_id)
            .distinct()
        )
    return session.exec(stmt).all()


def find_duplicate_project(
    session: Session,
    *,
    name: str,
    client: str,
    client_id: int | None = None,
) -> Project | None:
    normalized_name = _normalize_project_identity(name)
    normalized_client = _normalize_project_identity(client)
    if not normalized_name or not normalized_client:
        return None
    candidates = session.exec(
        select(Project)
        .where(Project.status != "archived")
        .order_by(Project.updated_at.desc(), Project.id.desc())
    ).all()
    for project in candidates:
        if _normalize_project_identity(project.name) != normalized_name:
            continue
        if client_id is not None:
            if project.client_id == client_id:
                return project
            continue
        if (
            project.client_id is None
            and _normalize_project_identity(project.client) == normalized_client
        ):
            return project
    return None


def _client_locator(session: Session, client_id: int) -> ClientRecord:
    locator = session.exec(
        select(ClientRecord)
        .where(ClientRecord.id == client_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Client not found")
    return locator


def _lock_client_locator(
    session: Session,
    locator: ClientRecord,
    expected_identity: str,
) -> ClientRecord:
    session.expire(locator)
    client = session.exec(
        select(ClientRecord)
        .where(ClientRecord.id == locator.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if client is None:
        raise HTTPException(409, "Client was deleted; reload and retry.")
    if resolve_client_identity(session, client.name) != expected_identity:
        raise HTTPException(409, "Client changed; reload and retry.")
    return client


def _resolve_name_only_client(
    session: Session,
    client_name: str,
    *,
    for_update: bool = True,
) -> ClientRecord | None:
    matches = clients_matching_name(session, client_name, for_update=for_update)
    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ambiguous_client",
                "message": "Multiple client records match this name; select a client ID.",
                "client": client_name,
            },
        )
    return matches[0] if matches else None


def _lock_active_actor(session: Session, actor_user_id: int) -> User:
    actor = session.exec(
        select(User)
        .where(User.id == actor_user_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if actor is None:
        raise HTTPException(401, "Not authenticated")
    if not actor.is_active:
        raise HTTPException(403, "User account is inactive")
    return actor


def _lock_projects_by_id(
    session: Session,
    project_ids: list[int],
) -> list[Project]:
    """Lock one project set in the repository-wide ascending-ID order."""

    ordered_ids = sorted(set(project_ids))
    if not ordered_ids:
        return []
    return list(
        session.exec(
            select(Project)
            .where(Project.id.in_(ordered_ids))
            .order_by(Project.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    )


def _lock_actor_memberships(
    session: Session,
    *,
    actor_user_id: int,
    project_ids: list[int],
) -> list[ProjectMember]:
    """Lock authorization-bearing memberships once, in ascending row ID."""

    ordered_project_ids = sorted(set(project_ids))
    if not ordered_project_ids:
        return []
    return list(
        session.exec(
            select(ProjectMember)
            .where(
                ProjectMember.project_id.in_(ordered_project_ids),
                ProjectMember.user_id == actor_user_id,
            )
            .order_by(ProjectMember.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    )


def _authorize_client_link(
    *,
    actor: User,
    target: ClientRecord,
    target_project_ids: set[int],
    memberships: list[ProjectMember],
) -> None:
    if actor.is_admin or target.created_by_user_id == actor.id:
        return
    if not any(
        int(member.project_id) in target_project_ids
        and str(member.role or "").strip().lower() in {"owner", "editor"}
        for member in memberships
    ):
        raise HTTPException(
            403,
            "Client link permission requires client ownership or an existing writable project membership.",
        )


def _lock_and_authorize_client_link(
    session: Session,
    *,
    actor: User,
    target_locator: ClientRecord,
    expected_identity: str,
) -> ClientRecord:
    # Keep the final authorization order aligned with candidate decisions:
    # identity namespace -> User -> Projects -> ClientRecord -> memberships.
    linked_projects = list_projects_for_client(
        session,
        target_locator,
        for_update=True,
    )
    project_ids = [
        int(project.id)
        for project in linked_projects
        if project.id is not None
    ]
    target = _lock_client_locator(session, target_locator, expected_identity)
    memberships = _lock_actor_memberships(
        session,
        actor_user_id=int(actor.id),
        project_ids=project_ids,
    )
    _authorize_client_link(
        actor=actor,
        target=target,
        target_project_ids=set(project_ids),
        memberships=memberships,
    )
    return target


def _require_project_write(
    *,
    actor: User,
    project_id: int,
    memberships: list[ProjectMember],
) -> None:
    """Recheck source-project authorization from rows locked by the caller."""

    if actor.is_admin:
        return
    project_memberships = [
        member
        for member in memberships
        if int(member.project_id) == project_id
    ]
    if not project_memberships:
        raise HTTPException(403, "Project membership required")
    if not any(
        str(member.role or "").strip().lower() in {"owner", "editor"}
        for member in project_memberships
    ):
        raise HTTPException(403, "Project write permission required")


def lock_and_require_project_write(
    session: Session,
    project_id: int,
    *,
    actor_user_id: int,
) -> tuple[Project, User]:
    """Lock and re-authorize one project write under the shared row order.

    Order: client-name namespace -> User -> Project -> ProjectMembers. The
    returned rows stay locked until the caller commits or rolls back.
    """

    locator = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Project not found")
    locator_client_id = locator.client_id
    expected_identity = lock_client_identity_values(
        session,
        (locator.client,),
    )[0]
    actor = _lock_active_actor(session, actor_user_id)
    session.expire(locator)
    locked_projects = _lock_projects_by_id(session, [project_id])
    project = locked_projects[0] if locked_projects else None
    if project is None:
        raise HTTPException(404, "Project not found")
    if resolve_client_identity(session, project.client) != expected_identity:
        raise HTTPException(
            status_code=409,
            detail="Project client changed during authorization; reload and retry.",
        )
    if project.client_id != locator_client_id:
        raise HTTPException(
            status_code=409,
            detail="Project client identity changed during authorization; reload and retry.",
        )
    memberships = _lock_actor_memberships(
        session,
        actor_user_id=int(actor.id),
        project_ids=[project_id],
    )
    _require_project_write(
        actor=actor,
        project_id=project_id,
        memberships=memberships,
    )
    return project, actor


def lock_and_require_project_memory_write(
    session: Session,
    project_id: int,
    *,
    actor_user_id: int,
) -> tuple[Project, User, ClientRecord | None]:
    """Authorize a Project-memory write with its linked Client pre-locked.

    Project-memory prompts may read Client-owned stakeholder sources, so their
    final transaction uses the complete shared order: identity namespace ->
    User -> Project -> linked Client -> ProjectMember. Source child families
    are locked by the caller after this helper returns.
    """

    locator = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Project not found")
    locator_client_id = locator.client_id
    expected_identity = lock_client_identity_values(
        session,
        (locator.client,),
    )[0]
    actor = _lock_active_actor(session, actor_user_id)
    session.expire(locator)
    locked_projects = _lock_projects_by_id(session, [project_id])
    project = locked_projects[0] if locked_projects else None
    if project is None:
        raise HTTPException(404, "Project not found")
    if resolve_client_identity(session, project.client) != expected_identity:
        raise HTTPException(
            status_code=409,
            detail="Project client changed during authorization; reload and retry.",
        )
    if project.client_id != locator_client_id:
        raise HTTPException(
            status_code=409,
            detail="Project client identity changed during authorization; reload and retry.",
        )

    client: ClientRecord | None = None
    if project.client_id is not None:
        client = session.exec(
            select(ClientRecord)
            .where(ClientRecord.id == int(project.client_id))
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if client is None:
            raise HTTPException(
                status_code=409,
                detail="Linked client changed during authorization; reload and retry.",
            )
        if resolve_client_identity(session, client.name) != expected_identity:
            raise HTTPException(
                status_code=409,
                detail="Linked client changed during authorization; reload and retry.",
            )

    memberships = _lock_actor_memberships(
        session,
        actor_user_id=int(actor.id),
        project_ids=[project_id],
    )
    _require_project_write(
        actor=actor,
        project_id=project_id,
        memberships=memberships,
    )
    return project, actor, client


def lock_project_for_trusted_system_write(
    session: Session,
    project_id: int,
) -> Project:
    """Lock one Project for a repository-owned background write.

    This deliberately performs no user authorization and must only be used by
    an internal scheduler/job runner that has no external-user execution path.
    It still protects the stable Project/client identity under the same
    namespace -> Project lock order used by user-authorized writes.
    """

    locator = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Project not found")
    locator_client_id = locator.client_id
    expected_identity = lock_client_identity_values(
        session,
        (locator.client,),
    )[0]
    session.expire(locator)
    locked_projects = _lock_projects_by_id(session, [project_id])
    project = locked_projects[0] if locked_projects else None
    if project is None:
        raise HTTPException(404, "Project not found")
    if resolve_client_identity(session, project.client) != expected_identity:
        raise HTTPException(
            status_code=409,
            detail="Project client changed during authorization; reload and retry.",
        )
    if project.client_id != locator_client_id:
        raise HTTPException(
            status_code=409,
            detail="Project client identity changed during authorization; reload and retry.",
        )
    return project


def create_project_record(
    session: Session,
    data: dict,
    *,
    actor_user_id: int,
) -> Project:
    requested_name = str(data.get("client") or "")
    requested_client_id = data.get("client_id")
    target_locator = (
        _client_locator(session, int(requested_client_id))
        if requested_client_id is not None
        else None
    )
    lock_values = [requested_name]
    if target_locator is not None:
        lock_values.append(target_locator.name)
    identities = lock_client_identity_values(session, lock_values)
    if target_locator is None:
        target_locator = _resolve_name_only_client(
            session,
            requested_name,
            for_update=False,
        )
    actor = _lock_active_actor(session, actor_user_id)
    target = (
        _lock_and_authorize_client_link(
            session,
            actor=actor,
            target_locator=target_locator,
            expected_identity=(
                resolve_client_identity(session, target_locator.name)
                if requested_client_id is None
                else identities[-1]
            ),
        )
        if target_locator is not None
        else None
    )
    if target is not None:
        data["client_id"] = int(target.id)
        data["client"] = target.name
    else:
        data["client_id"] = None
    duplicate = find_duplicate_project(
        session,
        name=str(data.get("name") or ""),
        client=str(data.get("client") or ""),
        client_id=data.get("client_id"),
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_project",
                "message": "Project already exists for this client",
                "project_id": duplicate.id,
                "project_name": duplicate.name,
                "client": duplicate.client,
            },
        )
    project = Project(**data)
    project.memory_stale = True
    session.add(project)
    session.flush()
    for index, folder_name in enumerate(DEFAULT_PROJECT_FOLDER_NAMES):
        session.add(
            ProjectFolder(
                project_id=int(project.id),
                name=folder_name,
                sort_order=index,
            )
        )
    session.add(
        ProjectMember(
            project_id=int(project.id),
            user_id=int(actor.id),
            role="owner",
        )
    )
    session.commit()
    session.refresh(project)
    return project


def get_project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def update_project_record(
    session: Session,
    project_id: int,
    changes: dict,
    *,
    actor_user_id: int,
) -> tuple[Project, str, str, int | None]:
    locator = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
    ).first()
    if locator is None:
        raise HTTPException(404, "Project not found")
    changes_client_link = "client" in changes or "client_id" in changes
    previous_identity: str | None = None
    target_locator: ClientRecord | None = None
    target_locator_identity: str | None = None
    requested_name = str(changes.get("client", locator.client) or "")
    requested_client_id = changes.get("client_id")
    explicit_detach = (
        "client_id" in changes
        and requested_client_id is None
    )
    locator_client_id = locator.client_id
    if changes_client_link and requested_client_id is not None:
        target_locator = _client_locator(session, int(requested_client_id))
    if changes_client_link:
        lock_values = [locator.client, requested_name]
        if target_locator is not None:
            lock_values.append(target_locator.name)
        identities = lock_client_identity_values(session, lock_values)
        previous_identity = identities[0]
        if target_locator is not None:
            target_locator_identity = identities[-1]
        elif explicit_detach:
            target_locator = None
        elif (
            locator_client_id is not None
            and identities[0] == identities[1]
        ):
            target_locator = _client_locator(session, int(locator_client_id))
            target_locator_identity = resolve_client_identity(
                session,
                target_locator.name,
            )
        else:
            target_locator = _resolve_name_only_client(
                session,
                requested_name,
                for_update=False,
            )
            if target_locator is not None:
                target_locator_identity = resolve_client_identity(
                    session,
                    target_locator.name,
                )
    actor = _lock_active_actor(session, actor_user_id)
    target_project_ids: list[int] = []
    if target_locator is not None:
        target_project_ids = [
            int(locked_project_id)
            for locked_project_id in session.exec(
                select(Project.id)
                .where(Project.client_id == int(target_locator.id))
                .order_by(Project.id)
            ).all()
        ]
    session.expire(locator)
    locked_projects = _lock_projects_by_id(
        session,
        [project_id, *target_project_ids],
    )
    project = next(
        (
            locked_project
            for locked_project in locked_projects
            if int(locked_project.id) == project_id
        ),
        None,
    )
    if project is None:
        raise HTTPException(404, "Project not found")
    if (
        previous_identity is not None
        and resolve_client_identity(session, project.client) != previous_identity
    ):
        raise HTTPException(
            status_code=409,
            detail="Project client changed during update; reload and retry.",
        )
    if project.client_id != locator_client_id:
        raise HTTPException(
            status_code=409,
            detail="Project client identity changed during update; reload and retry.",
        )
    previous_status = str(project.status or "")
    previous_client = str(project.client or "")
    previous_client_id = project.client_id
    target: ClientRecord | None = None
    if changes_client_link:
        if target_locator is not None and target_locator_identity is not None:
            target = _lock_client_locator(
                session,
                target_locator,
                target_locator_identity,
            )
    authorization_project_ids = [
        int(locked_project.id)
        for locked_project in locked_projects
        if locked_project.id is not None
    ]
    memberships = _lock_actor_memberships(
        session,
        actor_user_id=int(actor.id),
        project_ids=authorization_project_ids,
    )
    _require_project_write(
        actor=actor,
        project_id=int(project.id),
        memberships=memberships,
    )
    if changes_client_link:
        if target is not None:
            _authorize_client_link(
                actor=actor,
                target=target,
                target_project_ids=set(target_project_ids),
                memberships=memberships,
            )
        if target is not None:
            changes["client_id"] = int(target.id)
            changes["client"] = target.name
        else:
            changes["client_id"] = None
            changes["client"] = requested_name
    for key, value in changes.items():
        setattr(project, key, value)
    project.memory_stale = True
    project.updated_at = utc_now_naive()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project, previous_status, previous_client, previous_client_id
