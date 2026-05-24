from __future__ import annotations

from typing import Callable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Milestone, Project, ProjectFile, ProjectFolder
from app.services.project_financials import list_project_payments, serialize_financials
from app.services.project_files import active_project_files_stmt
from app.services.project_members import list_project_members, serialize_member
from app.services.project_todos import list_project_todos, serialize_todo


def build_project_detail(
    session: Session,
    project_id: int,
    *,
    init_default_folders: Callable[[Session, int], list[ProjectFolder]],
) -> dict:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    files = session.exec(active_project_files_stmt(project_id)).all()
    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project_id)
    ).all()
    folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order)
    ).all()
    if not folders:
        folders = init_default_folders(session, project_id)

    payments = list_project_payments(session, project_id)
    todos = list_project_todos(session, project_id)
    members = list_project_members(session, project_id)

    return {
        "project": project,
        "files": files,
        "milestones": milestones,
        "folders": folders,
        "md_notes": project.md_notes or "",
        "todos": [serialize_todo(todo) for todo in todos],
        "members": [serialize_member(member) for member in members],
        "financials": serialize_financials(project, payments),
    }
