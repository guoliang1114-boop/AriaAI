"""Shared authorization helpers for chat-facing routes."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Conversation, Project, ProjectMember, User
from app.routers.auth import get_current_user


def member_can_write(member: ProjectMember) -> bool:
    return (member.role or "editor").lower() in {"owner", "editor"}


def member_project_ids(session: Session, current_user: User) -> list[int] | None:
    """Return project ids visible to a non-admin user; admins return ``None``."""
    if current_user.is_admin:
        return None
    return list(
        session.exec(
            select(ProjectMember.project_id).where(ProjectMember.user_id == current_user.id)
        ).all()
    )


def membership_project_ids(session: Session, current_user: User) -> list[int]:
    """Project ids whose conversations the user may see in cross-project lists.

    Admins get global conversation oversight: every project id is returned so
    the unfiltered conversation list surfaces all project conversations (their
    own standalone conversations still scope by owner). Non-admins are limited
    to projects they are an actual ``ProjectMember`` of.
    """
    if current_user.is_admin:
        return list(session.exec(select(Project.id)).all())
    return list(
        session.exec(
            select(ProjectMember.project_id).where(ProjectMember.user_id == current_user.id)
        ).all()
    )


def require_conversation_membership(
    session: Session,
    project_id: int,
    current_user: User,
    *,
    require_write: bool = False,
) -> None:
    """Require project membership, with an admin super-user bypass.

    Admins have global conversation oversight, so they pass this gate for any
    project. Non-admins must be a real ``ProjectMember`` (and, when
    ``require_write`` is set, an owner/editor) of the project.
    """
    if current_user.is_admin:
        return
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    ).first()
    if member is None:
        raise HTTPException(status_code=403, detail="Project membership required")
    if require_write and not member_can_write(member):
        raise HTTPException(status_code=403, detail="Project write permission required")


def require_project_access(
    session: Session,
    project_id: int | None,
    current_user: User,
    *,
    require_write: bool = False,
) -> None:
    """Require the user to be an admin or a member of the project."""
    if project_id is None or current_user.is_admin:
        return
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == current_user.id,
        )
    ).first()
    if member is None:
        raise HTTPException(status_code=403, detail="Project membership required")
    if require_write and not member_can_write(member):
        raise HTTPException(status_code=403, detail="Project write permission required")


def require_conversation_access(
    session: Session,
    conversation_id: int,
    current_user: User,
    *,
    require_write: bool = False,
) -> Conversation:
    conversation = session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.project_id is not None:
        # Conversations are isolated per-user even for admins: require real
        # project membership (no admin super-user bypass here).
        require_conversation_membership(
            session, conversation.project_id, current_user, require_write=require_write
        )
        return conversation
    owner_user_id = getattr(conversation, "owner_user_id", None)
    if owner_user_id is None or owner_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Conversation owner required")
    return conversation


def maybe_require_project_access(
    request: Request,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Router-level dependency for sub-routers under /projects.

    If the matched route has a ``project_id`` path param, gate it
    with ``require_project_access``. If not (e.g. admin batch
    endpoints like ``/memory/rebuild-batch``), no-op — the endpoint
    itself is responsible for its own auth. The intent is to apply
    this once at the router level instead of decorating every one
    of the 50+ project sub-resource endpoints individually.

    Read-only by default; endpoints that mutate state should still
    call ``require_project_access(..., require_write=True)``
    directly for the stricter check.
    """
    project_id_raw = request.path_params.get("project_id")
    if project_id_raw is None:
        return
    try:
        project_id = int(project_id_raw)
    except (TypeError, ValueError):
        return
    require_project_access(session, project_id, current_user)


def require_project_write_access(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> None:
    """FastAPI dependency for project sub-resource mutation routes.

    Router-wide project gates intentionally grant viewers read access.  Attach
    this dependency to every mutating sub-route so a read membership can never
    be mistaken for business authorization to persist state or start work.
    Provider-backed handlers must still perform their final locked
    authorization after the provider returns.
    """

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )


def require_chat_request_access(
    session: Session,
    *,
    conversation_id: int | None,
    project_id: int | None,
    current_user: User,
    require_write: bool = False,
) -> Conversation | None:
    """Authorize a chat request before runtime preparation mutates state."""
    conversation: Conversation | None = None
    if conversation_id is not None:
        conversation = require_conversation_access(session, conversation_id, current_user, require_write=require_write)
        if project_id is not None and conversation.project_id != project_id:
            raise HTTPException(status_code=403, detail="Conversation project scope mismatch")
    elif project_id is not None:
        require_project_access(session, project_id, current_user, require_write=require_write)
    return conversation
