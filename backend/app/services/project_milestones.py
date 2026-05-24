from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Milestone
from app.services.project_todos import ensure_project_exists


def list_project_milestones(session: Session, project_id: int) -> list[Milestone]:
    ensure_project_exists(session, project_id)
    return session.exec(
        select(Milestone).where(Milestone.project_id == project_id)
    ).all()


def create_project_milestone(
    session: Session,
    project_id: int,
    *,
    title: str,
    priority: str = "medium",
    due_date: str | None = None,
    is_done: bool = False,
) -> Milestone:
    ensure_project_exists(session, project_id)
    milestone = Milestone(
        project_id=project_id,
        title=title,
        priority=priority,
        due_date=due_date,
        is_done=is_done,
    )
    session.add(milestone)
    session.commit()
    session.refresh(milestone)
    return milestone


def update_project_milestone(
    session: Session,
    project_id: int,
    milestone_id: int,
    changes: dict,
) -> Milestone:
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found")
    for key, value in changes.items():
        setattr(milestone, key, value)
    session.add(milestone)
    session.commit()
    session.refresh(milestone)
    return milestone


def delete_project_milestone(session: Session, project_id: int, milestone_id: int) -> None:
    milestone = session.get(Milestone, milestone_id)
    if not milestone or milestone.project_id != project_id:
        raise HTTPException(404, "Milestone not found")
    session.delete(milestone)
    session.commit()
