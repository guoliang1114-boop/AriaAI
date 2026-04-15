from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlmodel import Session

from app.models.db import Project


def save_project_notes(session: Session, project_id: int, content: str, *, append: bool = True) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if append and project.notes:
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
        project.notes = f"{project.notes}\n\n---\n[{timestamp}]\n{content}"
    else:
        project.notes = content

    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project
