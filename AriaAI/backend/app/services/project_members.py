from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import ProjectMember, User


def list_project_members(session: Session, project_id: int) -> list[ProjectMember]:
    return session.exec(
        select(ProjectMember).where(ProjectMember.project_id == project_id)
    ).all()


def add_project_member(session: Session, project_id: int, user_id: int) -> tuple[ProjectMember, User]:
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

    member = ProjectMember(project_id=project_id, user_id=user_id)
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
