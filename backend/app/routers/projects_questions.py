"""Authorized project-level question workbench endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Conversation, Message, Project, User
from app.routers.auth import get_current_user
from app.routers.chat_schemas import (
    ReopenProjectQuestionRequest,
    ResolveProjectQuestionRequest,
)
from app.routers.chat_security import (
    maybe_require_project_access,
    require_project_access,
)
from app.services.project_question_resolutions import (
    reopen_project_question,
    resolve_project_question,
)
from app.services.project_question_evidence import (
    build_project_question_evidence_review,
)
from app.services.project_question_workbench import (
    build_project_question_workbench,
    update_project_question_profile,
)


router = APIRouter(
    prefix="/{project_id}/questions",
    tags=["project-questions"],
    dependencies=[Depends(maybe_require_project_access)],
)


class UpdateProjectQuestionProfileRequest(BaseModel):
    question: str = Field(min_length=1, max_length=360)
    owner_user_id: Optional[int] = Field(default=None, gt=0)
    priority: str = Field(default="normal", min_length=1, max_length=16)
    due_date: Optional[str] = Field(default=None, max_length=10)
    expected_revision: int = Field(ge=0)


class AnalyzeProjectQuestionEvidenceRequest(BaseModel):
    question: str = Field(min_length=1, max_length=360)


def _project(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _workbench(
    session: Session,
    *,
    project_id: int,
    current_user: User,
):
    return build_project_question_workbench(
        session,
        project=_project(session, project_id),
        current_user=current_user,
    )


@router.get("")
def get_project_question_workbench(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return bounded question state, ownership, and answer candidates."""

    return _workbench(
        session,
        project_id=project_id,
        current_user=current_user,
    )


@router.post("/{question_sha256}/evidence")
def analyze_project_question_evidence(
    project_id: int,
    question_sha256: str,
    body: AnalyzeProjectQuestionEvidenceRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Recall current evidence and rank bounded project answer candidates."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    return build_project_question_evidence_review(
        session,
        project=_project(session, project_id),
        question=body.question,
        question_sha256=question_sha256,
    )


@router.patch("/{question_sha256}")
def patch_project_question_profile(
    project_id: int,
    question_sha256: str,
    body: UpdateProjectQuestionProfileRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Assign accountable metadata using per-question optimistic revision."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    update_project_question_profile(
        session,
        project_id=project_id,
        actor_user_id=int(current_user.id),
        question=body.question,
        question_sha256=question_sha256,
        owner_user_id=body.owner_user_id,
        priority=body.priority,
        due_date=body.due_date,
        expected_revision=body.expected_revision,
    )
    return _workbench(
        session,
        project_id=project_id,
        current_user=current_user,
    )


@router.post("/resolve")
def resolve_project_workbench_question(
    project_id: int,
    body: ResolveProjectQuestionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Resolve a question against any persisted Assistant answer in the project."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    scoped_answer = session.exec(
        select(Message, Conversation)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.id == body.answer_message_id,
            Message.role == "assistant",
            Conversation.project_id == project_id,
        )
    ).first()
    if scoped_answer is None:
        raise HTTPException(
            status_code=409,
            detail="The selected Assistant answer is unavailable or outside this project.",
        )
    _, conversation = scoped_answer
    resolve_project_question(
        session,
        conversation=conversation,
        actor_user_id=int(current_user.id),
        question=body.question,
        answer_message_id=body.answer_message_id,
        resolution_summary=body.resolution_summary,
        expected_memory_version=body.expected_memory_version,
        expected_slot_version=body.expected_slot_version,
    )
    return _workbench(
        session,
        project_id=project_id,
        current_user=current_user,
    )


@router.post("/{resolution_id}/reopen")
def reopen_project_workbench_question(
    project_id: int,
    resolution_id: int,
    body: ReopenProjectQuestionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Reopen a resolved question without depending on its source conversation."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    reopen_project_question(
        session,
        project_id=project_id,
        resolution_id=resolution_id,
        actor_user_id=int(current_user.id),
        reason=body.reason,
        expected_resolution_revision=body.expected_resolution_revision,
        expected_memory_version=body.expected_memory_version,
        expected_slot_version=body.expected_slot_version,
    )
    return _workbench(
        session,
        project_id=project_id,
        current_user=current_user,
    )
