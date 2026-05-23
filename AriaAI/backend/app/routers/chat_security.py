"""Shared authorization helpers for chat-facing routes."""
from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Conversation, ProjectMember, User


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
        require_project_access(session, conversation.project_id, current_user, require_write=require_write)
        return conversation
    if current_user.is_admin:
        return conversation
    owner_user_id = getattr(conversation, "owner_user_id", None)
    if owner_user_id is None or owner_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Conversation owner required")
    return conversation


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
