from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import ProjectMember, User


def serialize_member(member: ProjectMember) -> dict:
    role = getattr(member, "role", "")
    if not isinstance(role, str) or not role.strip():
        role = "editor"
    return {
        "id": member.id,
        "project_id": member.project_id,
        "user_id": member.user_id,
        "role": role,
        "user": (
            {"id": member.user.id, "display_name": member.user.display_name}
            if member.user else None
        ),
        "created_at": member.created_at,
    }


def list_project_members(session: Session, project_id: int) -> list[ProjectMember]:
    return session.exec(
        select(ProjectMember).where(ProjectMember.project_id == project_id)
    ).all()


def add_project_member(session: Session, project_id: int, user_id: int, role: str = "editor") -> tuple[ProjectMember, User]:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")

    existing = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if existing:
        raise HTTPException(409, "User is already a member of this project")

    normalized_role = (role or "editor").strip().lower()
    if normalized_role not in {"owner", "editor", "viewer"}:
        raise HTTPException(400, "Invalid project member role")
    member = ProjectMember(project_id=project_id, user_id=user_id, role=normalized_role)
    session.add(member)
    session.commit()
    session.refresh(member)
    return member, user


def remove_project_member(session: Session, project_id: int, user_id: int) -> None:
    member = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    ).first()
    if not member:
        raise HTTPException(404, "Member not found")

    session.delete(member)
    session.commit()
