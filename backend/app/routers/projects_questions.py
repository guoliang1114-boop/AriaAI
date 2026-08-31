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
from app.services.project_question_remediation import (
    build_project_question_remediation_plan,
)
from app.services.project_question_remediation_promotions import (
    confirm_project_question_remediation_promotion,
    list_project_question_remediation_promotions,
    prepare_project_question_remediation_promotion,
    reject_project_question_remediation_promotion,
)
from app.services.project_question_remediation_executions import (
    attach_project_question_remediation_evidence,
    list_project_question_remediation_executions,
    transition_project_question_remediation_execution,
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


class PrepareProjectQuestionRemediationPromotionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=360)
    evidence_basis_fingerprint: str = Field(min_length=64, max_length=64)
    idempotency_key: str = Field(min_length=16, max_length=128)
    target_kind: str = Field(min_length=1, max_length=40)
    action_kind: str = Field(min_length=1, max_length=40)
    source_action_id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=120)
    draft: str = Field(default="", max_length=600)
    owner_user_id: Optional[int] = Field(default=None, gt=0)
    due_date: Optional[str] = Field(default=None, max_length=10)
    recipient_label: str = Field(default="", max_length=160)


class DecideProjectQuestionRemediationPromotionRequest(BaseModel):
    snapshot_sha256: str = Field(min_length=64, max_length=64)
    expected_revision: int = Field(ge=1)
    reason: str = Field(default="", max_length=600)


class TransitionProjectQuestionRemediationExecutionRequest(BaseModel):
    action: str = Field(min_length=1, max_length=40)
    expected_revision: int = Field(ge=1)
    note: str = Field(min_length=1, max_length=600)


class AttachProjectQuestionRemediationEvidenceRequest(BaseModel):
    expected_revision: int = Field(ge=1)
    idempotency_key: str = Field(min_length=16, max_length=128)
    evidence_kind: str = Field(min_length=1, max_length=40)
    title: str = Field(default="", max_length=160)
    note: str = Field(default="", max_length=1200)
    reference_locator: str = Field(default="", max_length=500)
    project_file_id: Optional[int] = Field(default=None, gt=0)
    knowledge_document_id: Optional[int] = Field(default=None, gt=0)
    message_id: Optional[int] = Field(default=None, gt=0)


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


@router.post("/{question_sha256}/remediation")
def plan_project_question_remediation(
    project_id: int,
    question_sha256: str,
    body: AnalyzeProjectQuestionEvidenceRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return editable evidence-gap drafts without saving or executing them."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    return build_project_question_remediation_plan(
        session,
        project=_project(session, project_id),
        question=body.question,
        question_sha256=question_sha256,
    )


@router.post("/{question_sha256}/promotions/prepare")
def prepare_project_question_remediation(
    project_id: int,
    question_sha256: str,
    body: PrepareProjectQuestionRemediationPromotionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Persist a frozen HITAS preview without creating its target."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return prepare_project_question_remediation_promotion(
        session,
        project_id=project_id,
        actor_user_id=int(current_user.id),
        question=body.question,
        question_sha256=question_sha256,
        evidence_basis_fingerprint=body.evidence_basis_fingerprint,
        idempotency_key=body.idempotency_key,
        target_kind=body.target_kind,
        action_kind=body.action_kind,
        source_action_id=body.source_action_id,
        title=body.title,
        draft=body.draft,
        owner_user_id=body.owner_user_id,
        due_date=body.due_date,
        recipient_label=body.recipient_label,
    )


@router.post("/{question_sha256}/promotions/{promotion_id}/confirm")
def confirm_project_question_remediation(
    project_id: int,
    question_sha256: str,
    promotion_id: int,
    body: DecideProjectQuestionRemediationPromotionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Confirm one exact preview after final authorization and basis checks."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return confirm_project_question_remediation_promotion(
        session,
        project_id=project_id,
        question_sha256=question_sha256,
        promotion_id=promotion_id,
        actor_user_id=int(current_user.id),
        snapshot_sha256=body.snapshot_sha256,
        expected_revision=body.expected_revision,
    )


@router.post("/{question_sha256}/promotions/{promotion_id}/reject")
def reject_project_question_remediation(
    project_id: int,
    question_sha256: str,
    promotion_id: int,
    body: DecideProjectQuestionRemediationPromotionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Reject one exact preview without creating project state."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return reject_project_question_remediation_promotion(
        session,
        project_id=project_id,
        question_sha256=question_sha256,
        promotion_id=promotion_id,
        actor_user_id=int(current_user.id),
        snapshot_sha256=body.snapshot_sha256,
        expected_revision=body.expected_revision,
        reason=body.reason,
    )


@router.get("/{question_sha256}/promotions")
def get_project_question_remediation_promotions(
    project_id: int,
    question_sha256: str,
    limit: int = 20,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return bounded write-member-only remediation promotion history."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return list_project_question_remediation_promotions(
        session,
        project_id=project_id,
        question_sha256=question_sha256,
        actor_user_id=int(current_user.id),
        limit=limit,
    )


@router.get("/remediation-executions")
def get_project_question_remediation_executions(
    project_id: int,
    status: str = "",
    limit: int = 100,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Return the project-wide, write-member-only remediation execution center."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return list_project_question_remediation_executions(
        session,
        project_id=project_id,
        actor_user_id=int(current_user.id),
        status=status,
        limit=limit,
    )


@router.post("/remediation-executions/{execution_id}/transition")
def transition_project_question_remediation(
    project_id: int,
    execution_id: int,
    body: TransitionProjectQuestionRemediationExecutionRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Record one manual lifecycle transition without external delivery."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return transition_project_question_remediation_execution(
        session,
        project_id=project_id,
        execution_id=execution_id,
        actor_user_id=int(current_user.id),
        action=body.action,
        expected_revision=body.expected_revision,
        note=body.note,
    )


@router.post("/remediation-executions/{execution_id}/evidence")
def attach_project_question_remediation_execution_evidence(
    project_id: int,
    execution_id: int,
    body: AttachProjectQuestionRemediationEvidenceRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Attach immutable, project-scoped evidence to one remediation target."""

    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    if current_user.id is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return attach_project_question_remediation_evidence(
        session,
        project_id=project_id,
        execution_id=execution_id,
        actor_user_id=int(current_user.id),
        expected_revision=body.expected_revision,
        idempotency_key=body.idempotency_key,
        evidence_kind=body.evidence_kind,
        title=body.title,
        note=body.note,
        reference_locator=body.reference_locator,
        project_file_id=body.project_file_id,
        knowledge_document_id=body.knowledge_document_id,
        message_id=body.message_id,
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
