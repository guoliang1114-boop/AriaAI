from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectProgressUpdate


def ensure_project_exists(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def serialize_progress_update(update: ProjectProgressUpdate) -> dict:
    return {
        "id": update.id,
        "project_id": update.project_id,
        "content": update.content,
        "next_step": update.next_step,
        "risk": update.risk,
        "created_by_user_id": update.created_by_user_id,
        "created_by": (
            {"id": update.created_by.id, "display_name": update.created_by.display_name}
            if update.created_by else None
        ),
        "created_at": update.created_at,
    }


def list_project_progress_updates(
    session: Session,
    project_id: int,
    *,
    limit: int | None = None,
) -> list[ProjectProgressUpdate]:
    ensure_project_exists(session, project_id)
    stmt = (
        select(ProjectProgressUpdate)
        .where(ProjectProgressUpdate.project_id == project_id)
        .order_by(ProjectProgressUpdate.created_at.desc(), ProjectProgressUpdate.id.desc())
    )
    if limit:
        stmt = stmt.limit(limit)
    return session.exec(stmt).all()


def create_project_progress_update(
    session: Session,
    project_id: int,
    *,
    content: str,
    next_step: str = "",
    risk: str = "",
    created_by_user_id: int | None = None,
) -> ProjectProgressUpdate:
    ensure_project_exists(session, project_id)
    update = ProjectProgressUpdate(
        project_id=project_id,
        content=content,
        next_step=next_step,
        risk=risk,
        created_by_user_id=created_by_user_id,
    )
    session.add(update)
    session.commit()
    session.refresh(update)
    return update
