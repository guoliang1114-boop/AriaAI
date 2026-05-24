from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session

from app.models.db import Project
from app.services.time_utils import utc_now_naive


def save_project_notes(session: Session, project_id: int, content: str, *, append: bool = True) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    if append and project.notes:
        timestamp = utc_now_naive().strftime("%Y-%m-%d %H:%M")
        project.notes = f"{project.notes}\n\n---\n[{timestamp}]\n{content}"
    else:
        project.notes = content

    project.updated_at = utc_now_naive()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def build_project_note_polish_messages(project: Project, draft: str) -> list[dict[str, Any]]:
    system_prompt = (
        "You are a helpful assistant that turns rough drafts into well-structured Markdown project notes. "
        "Keep the user's original meaning, organize content with headings, bullet points, and checklists where appropriate, "
        "and output clean Markdown without wrapping it in code blocks."
    )
    user_prompt = f"""Please polish the following rough draft into well-structured Markdown project notes.

Project name: {project.name}
Client: {project.client}

Draft:
{draft}
"""
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
