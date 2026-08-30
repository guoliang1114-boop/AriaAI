"""Chat mentionables — list project entities that can be @-mentioned in chat."""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ClientRecord, ClientStakeholder, Milestone, Project, ProjectFile, User
from app.routers.auth import get_current_user
from app.routers.chat_security import require_project_access
from app.services.project_files import active_project_files_stmt
from app.services.project_clients import find_client_for_project

router = APIRouter()


class MentionableFile(BaseModel):
    id: int
    name: str
    file_type: str


class MentionableStakeholder(BaseModel):
    id: int
    name: str
    role: str


class MentionableMilestone(BaseModel):
    id: int
    title: str
    due_date: str | None
    is_done: bool


class MentionablesOut(BaseModel):
    files: List[MentionableFile]
    stakeholders: List[MentionableStakeholder]
    milestones: List[MentionableMilestone]


@router.get("/mentionables", response_model=MentionablesOut)
def list_mentionables(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return files, stakeholders, and milestones for a project that can be @-mentioned."""
    require_project_access(session, project_id, current_user)
    project = session.get(Project, project_id)
    if not project:
        return MentionablesOut(files=[], stakeholders=[], milestones=[])

    files = session.exec(active_project_files_stmt(project_id)).all()

    stakeholders: list[ClientStakeholder] = []
    client = find_client_for_project(session, project)
    if client and client.id is not None:
        stakeholders = session.exec(
            select(ClientStakeholder).where(ClientStakeholder.client_id == client.id)
        ).all()

    milestones = session.exec(
        select(Milestone).where(Milestone.project_id == project_id)
    ).all()

    return MentionablesOut(
        files=[
            MentionableFile(id=f.id, name=f.name, file_type=f.file_type)
            for f in files
        ],
        stakeholders=[
            MentionableStakeholder(id=s.id, name=s.name, role=s.role)
            for s in stakeholders
        ],
        milestones=[
            MentionableMilestone(
                id=m.id, title=m.title, due_date=m.due_date, is_done=m.is_done
            )
            for m in milestones
        ],
    )
