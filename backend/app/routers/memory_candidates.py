"""Review API for source-linked memory candidates."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ClientRecord, MemoryCandidate, Message, Project, ProjectMember, User
from app.routers.auth import get_current_user
from app.routers.chat_security import (
    member_can_write,
    require_conversation_access,
    require_project_access,
)
from app.services.chat.product_run_events import memory_candidate_ready
from app.services.memory_candidates import (
    SCOPE_TYPES,
    accept_memory_candidate,
    create_memory_candidate,
    inspect_memory_candidate,
    reject_memory_candidate,
    serialize_memory_candidate,
    source_run_id_from_message,
    sync_candidate_source_message,
)


router = APIRouter(prefix="/memory-candidates", tags=["memory-candidates"])


class MemoryCandidateCreate(BaseModel):
    scope: str
    candidate_type: str
    content: str = Field(default="", max_length=4_000)
    source_type: str = "manual"
    source_id: str = ""
    source_run_id: str = ""
    source_refs: list[dict[str, Any]] = Field(default_factory=list)
    project_id: int | None = None
    client_id: int | None = None
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class MemoryCandidateDecision(BaseModel):
    decision_note: str = Field(default="", max_length=300)
    expected_memory_version: int | None = Field(default=None, ge=0)
    allow_conflict: bool = False


def _owned_candidate(
    session: Session,
    candidate_id: int,
    current_user: User,
    *,
    lock: bool = False,
) -> MemoryCandidate:
    statement = select(MemoryCandidate).where(
        MemoryCandidate.id == candidate_id,
        MemoryCandidate.owner_user_id == current_user.id,
    )
    if lock:
        statement = statement.with_for_update()
    candidate = session.exec(statement).first()
    if candidate is None:
        raise HTTPException(404, "Memory candidate not found")
    return candidate


def _require_candidate_scope_access(
    session: Session,
    candidate: MemoryCandidate,
    current_user: User,
    *,
    require_write: bool,
) -> None:
    if candidate.scope == "project":
        require_project_access(
            session,
            candidate.project_id,
            current_user,
            require_write=require_write,
        )
    elif candidate.scope == "client":
        _require_client_access(
            session,
            candidate.client_id,
            current_user,
            require_write=require_write,
        )


def _require_client_access(
    session: Session,
    client_id: int | None,
    current_user: User,
    *,
    require_write: bool,
) -> ClientRecord:
    client = session.get(ClientRecord, client_id) if client_id is not None else None
    if client is None:
        raise HTTPException(404, "Client not found")
    if current_user.is_admin:
        return client
    memberships = session.exec(
        select(ProjectMember)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(
            func.lower(func.trim(Project.client)) == client.name.strip().lower(),
            ProjectMember.user_id == current_user.id,
        )
    ).all()
    if not memberships:
        raise HTTPException(403, "Client project membership required")
    if require_write and not any(member_can_write(member) for member in memberships):
        raise HTTPException(403, "Client memory write permission required")
    return client


@router.post("")
def create_candidate(
    body: MemoryCandidateCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if current_user.id is None:
        raise HTTPException(401, "Not authenticated")

    source_type = str(body.source_type or "manual").strip().lower()
    requested_scope = str(body.scope or "").strip().lower()
    source_id = str(body.source_id or "").strip()
    source_run_id = str(body.source_run_id or "").strip()
    source_refs = list(body.source_refs)
    content = str(body.content or "").strip()

    if source_type == "chat_message":
        if not source_id.isdigit():
            raise HTTPException(400, "chat_message source_id must be a message id")
        message = session.get(Message, int(source_id))
        if message is None:
            raise HTTPException(404, "Source message not found")
        conversation = require_conversation_access(
            session,
            message.conversation_id,
            current_user,
            require_write=False,
        )
        if requested_scope == "project" and conversation.project_id != body.project_id:
            raise HTTPException(400, "Source message does not belong to the requested project")
        if requested_scope == "client":
            source_project = (
                session.get(Project, conversation.project_id)
                if conversation.project_id is not None
                else None
            )
            source_client = session.get(ClientRecord, body.client_id) if body.client_id else None
            if (
                source_project is None
                or source_client is None
                or source_project.client.strip().lower() != source_client.name.strip().lower()
            ):
                raise HTTPException(400, "Source message is not linked to the requested client")
        if not content:
            content = message.content
        source_run_id = source_run_id_from_message(message) or source_run_id
        source_refs.append(
            {
                "source_type": "chat_message",
                "source_id": str(message.id),
                "label": "Aria project chat message",
            }
        )

    if requested_scope == "project":
        project = session.get(Project, body.project_id)
        if project is None:
            raise HTTPException(404, "Project not found")
        require_project_access(
            session,
            body.project_id,
            current_user,
            require_write=True,
        )
    if requested_scope == "client":
        _require_client_access(
            session,
            body.client_id,
            current_user,
            require_write=True,
        )

    candidate, created = create_memory_candidate(
        session,
        owner_user_id=int(current_user.id),
        scope=requested_scope,
        candidate_type=body.candidate_type,
        content=content,
        source_type=source_type,
        source_id=source_id,
        source_run_id=source_run_id,
        source_refs=source_refs,
        project_id=body.project_id,
        client_id=body.client_id,
        confidence=body.confidence,
        created_by="user",
    )
    sync_candidate_source_message(session, candidate)
    session.commit()
    session.refresh(candidate)
    product_event = None
    if candidate.status == "pending" and candidate.source_run_id.startswith("run_"):
        product_event = memory_candidate_ready(
            candidate.source_run_id,
            int(candidate.id),
            candidate.scope,
            candidate.candidate_type,
            content_sha256=candidate.content_sha256,
        )
    return {
        "candidate": serialize_memory_candidate(
            candidate,
            relation=inspect_memory_candidate(session, candidate),
        ),
        "created": created,
        "product_event": product_event,
    }


@router.get("")
def list_candidates(
    scope: str | None = None,
    status: str = "pending",
    project_id: int | None = None,
    client_id: int | None = None,
    limit: int = 50,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if current_user.id is None:
        raise HTTPException(401, "Not authenticated")
    if project_id is not None:
        require_project_access(session, project_id, current_user)
    if client_id is not None:
        _require_client_access(
            session,
            client_id,
            current_user,
            require_write=False,
        )
    safe_limit = min(max(int(limit or 50), 1), 100)
    normalized_scope = str(scope or "").strip().lower()
    if normalized_scope and normalized_scope not in SCOPE_TYPES:
        raise HTTPException(400, "Unsupported memory candidate scope")
    statement = select(MemoryCandidate).where(
        MemoryCandidate.owner_user_id == current_user.id
    )
    if normalized_scope:
        statement = statement.where(MemoryCandidate.scope == normalized_scope)
    normalized_status = str(status or "pending").strip().lower()
    if normalized_status and normalized_status != "all":
        if normalized_status not in {"pending", "accepted", "rejected", "archived"}:
            raise HTTPException(400, "Unsupported memory candidate status")
        statement = statement.where(MemoryCandidate.status == normalized_status)
    if project_id is not None:
        statement = statement.where(MemoryCandidate.project_id == project_id)
    if client_id is not None:
        statement = statement.where(MemoryCandidate.client_id == client_id)
    candidates = session.exec(
        statement.order_by(MemoryCandidate.created_at.desc(), MemoryCandidate.id.desc()).limit(safe_limit * 3)
    ).all()
    items: list[MemoryCandidate] = []
    for candidate in candidates:
        try:
            _require_candidate_scope_access(
                session,
                candidate,
                current_user,
                require_write=False,
            )
        except HTTPException as exc:
            if exc.status_code in {403, 404}:
                continue
            raise
        items.append(candidate)
        if len(items) >= safe_limit:
            break
    return {
        "items": [
            serialize_memory_candidate(
                candidate,
                relation=inspect_memory_candidate(session, candidate),
            )
            for candidate in items
        ],
        "count": len(items),
    }


@router.get("/{candidate_id}")
def get_candidate(
    candidate_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    candidate = _owned_candidate(session, candidate_id, current_user)
    _require_candidate_scope_access(session, candidate, current_user, require_write=False)
    return serialize_memory_candidate(
        candidate,
        relation=inspect_memory_candidate(session, candidate),
    )


@router.post("/{candidate_id}/accept")
def accept_candidate(
    candidate_id: int,
    body: MemoryCandidateDecision | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if current_user.id is None:
        raise HTTPException(401, "Not authenticated")
    candidate = _owned_candidate(session, candidate_id, current_user, lock=True)
    _require_candidate_scope_access(session, candidate, current_user, require_write=True)
    accepted = accept_memory_candidate(
        session,
        candidate,
        user_id=int(current_user.id),
        decision_note=body.decision_note if body else "",
        expected_memory_version=body.expected_memory_version if body else None,
        allow_conflict=body.allow_conflict if body else False,
    )
    return serialize_memory_candidate(
        accepted,
        relation=inspect_memory_candidate(session, accepted),
    )


@router.post("/{candidate_id}/reject")
def reject_candidate(
    candidate_id: int,
    body: MemoryCandidateDecision | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if current_user.id is None:
        raise HTTPException(401, "Not authenticated")
    candidate = _owned_candidate(session, candidate_id, current_user, lock=True)
    _require_candidate_scope_access(session, candidate, current_user, require_write=True)
    rejected = reject_memory_candidate(
        session,
        candidate,
        user_id=int(current_user.id),
        decision_note=body.decision_note if body else "",
    )
    return serialize_memory_candidate(
        rejected,
        relation=inspect_memory_candidate(session, rejected),
    )
