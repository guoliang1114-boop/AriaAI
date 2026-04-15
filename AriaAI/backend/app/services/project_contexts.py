from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlmodel import Session

from app.models.db import Project
from app.services.project_files import list_project_files
from app.services.project_milestones import list_project_milestones


def build_project_context_data(session: Session, project_id: int) -> tuple[Project, str]:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    milestones = list_project_milestones(session, project_id)
    files = list_project_files(session, project_id)

    lines = [
        f"Project: {project.name}",
        f"Client: {project.client}",
        f"Status: {project.status}",
    ]
    if project.description:
        lines.append(f"Description: {project.description}")
    if milestones:
        lines.append(f"Milestones ({len(milestones)} total, {sum(1 for m in milestones if m.is_done)} completed):")
        for milestone in milestones:
            status = "done" if milestone.is_done else "pending"
            priority = f" [{milestone.priority}]" if milestone.priority == "high" else ""
            lines.append(f"  - {status} {milestone.title}{priority}")
    if files:
        lines.append(f"Uploaded files ({len(files)}):")
        for project_file in files:
            lines.append(
                f"  - {project_file.name}"
                + (f": {project_file.summary[:120]}" if project_file.summary else "")
            )

    return project, "\n".join(lines)


def save_project_context_summary(session: Session, project_id: int, summary: str) -> None:
    project = session.get(Project, project_id)
    if not project:
        return
    project.context_summary = summary
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
