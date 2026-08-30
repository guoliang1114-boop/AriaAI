"""Review API for source-linked memory candidates."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import (
    ClientRecord,
    Conversation,
    MemoryCandidate,
    Message,
    Project,
    ProjectMember,
    User,
)
from app.routers.auth import get_current_user
from app.routers.chat_security import (
    member_can_write,
    require_conversation_access,
    require_project_access,
)
from app.services.chat.product_run_events import memory_candidate_ready
from app.services.memory_candidates import (
    RESERVED_SOURCE_REF_TYPES,
    SCOPE_TYPES,
    SOURCE_CONVERSATION_REF_TYPE,
    SOURCE_OWNER_REF_TYPE,
    SOURCE_PROJECT_REF_TYPE,
    accept_memory_candidate,
    create_memory_candidate,
    inspect_memory_candidate,
    reject_memory_candidate,
    serialize_memory_candidate,
    source_run_id_from_message,
    sync_candidate_source_message,
)
from app.services.project_clients import project_belongs_to_client
from app.services.client_permissions import (
    lock_and_require_client_access,
    require_client_access as require_client_record_access,
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
) -> MemoryCandidate:
    statement = select(MemoryCandidate).where(
        MemoryCandidate.id == candidate_id,
        MemoryCandidate.owner_user_id == current_user.id,
    )
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
    if client_id is None:
        raise HTTPException(404, "Client not found")
    return require_client_record_access(
        session,
        client_id,
        current_user,
        require_write=require_write,
    )


def _lock_active_actor(session: Session, current_user: User) -> User:
    actor = session.exec(
        select(User)
        .where(User.id == current_user.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if actor is None:
        raise HTTPException(401, "Not authenticated")
    if not actor.is_active:
        raise HTTPException(403, "User account is inactive")
    return actor


def _lock_candidate_create_context(
    session: Session,
    *,
    current_user: User,
    requested_scope: str,
    project_id: int | None,
    client_id: int | None,
    source_message_id: int | None,
    source_conversation_id: int | None,
    source_project_id: int | None,
) -> tuple[User, Message | None]:
    """Re-authorize candidate creation under the shared write-lock order.

    The checks before this helper are only fast failures. This transaction is
    authoritative through candidate creation, source-message synchronization,
    and commit. Source rows are locked after their authorization rows so a
    message or conversation cannot be rebound between validation and write.
    """

    actor: User
    locked_projects: list[Project] = []
    source_memberships: list[ProjectMember] = []
    if requested_scope == "client":
        if client_id is None:
            raise HTTPException(404, "Client not found")
        _client, actor, locked_projects = lock_and_require_client_access(
            session,
            client_id,
            current_user,
            require_write=True,
        )
        locked_project_ids = {
            int(project.id) for project in locked_projects if project.id is not None
        }
        if (
            source_project_id is not None
            and source_project_id in locked_project_ids
            and not actor.is_admin
        ):
            source_memberships = list(
                session.exec(
                    select(ProjectMember)
                    .where(
                        ProjectMember.project_id == source_project_id,
                        ProjectMember.user_id == actor.id,
                    )
                    .order_by(ProjectMember.id)
                    .execution_options(populate_existing=True)
                    .with_for_update()
                ).all()
            )
    else:
        # Early route checks may already have populated all of these identities.
        # Expire them before acquiring the authoritative locked snapshots.
        session.expire_all()
        actor = _lock_active_actor(session, current_user)
        project_to_lock = (
            project_id
            if requested_scope == "project"
            else source_project_id
            if requested_scope == "user"
            else None
        )
        if requested_scope == "project" and project_to_lock is None:
            raise HTTPException(404, "Project not found")
        if project_to_lock is not None:
            project = session.exec(
                select(Project)
                .where(Project.id == project_to_lock)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).first()
            if project is None:
                if requested_scope == "project":
                    raise HTTPException(404, "Project not found")
                raise HTTPException(409, "Source project changed; reload and retry")
            locked_projects = [project]
            source_memberships = list(
                session.exec(
                    select(ProjectMember)
                    .where(
                        ProjectMember.project_id == project_to_lock,
                        ProjectMember.user_id == actor.id,
                    )
                    .order_by(ProjectMember.id)
                    .execution_options(populate_existing=True)
                    .with_for_update()
                ).all()
            )
            if not actor.is_admin:
                if not source_memberships:
                    raise HTTPException(403, "Project membership required")
                if requested_scope == "project" and not any(
                    member_can_write(member) for member in source_memberships
                ):
                    raise HTTPException(403, "Project write permission required")

    if source_message_id is None:
        return actor, None
    if source_conversation_id is None:
        raise HTTPException(409, "Source message changed; reload and retry")

    conversation = session.exec(
        select(Conversation)
        .where(Conversation.id == source_conversation_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if conversation is None:
        raise HTTPException(409, "Source conversation changed; reload and retry")
    message = session.exec(
        select(Message)
        .where(Message.id == source_message_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if message is None:
        raise HTTPException(404, "Source message not found")
    if (
        message.conversation_id != source_conversation_id
        or conversation.project_id != source_project_id
    ):
        raise HTTPException(409, "Source message changed; reload and retry")

    if requested_scope == "project" and conversation.project_id != project_id:
        raise HTTPException(400, "Source message does not belong to the requested project")
    if requested_scope == "client":
        locked_project_ids = {
            int(project.id) for project in locked_projects if project.id is not None
        }
        if conversation.project_id not in locked_project_ids:
            raise HTTPException(
                409,
                "Source project/client link changed; reload and retry",
            )

    if conversation.project_id is None:
        if conversation.owner_user_id != actor.id:
            raise HTTPException(403, "Conversation owner required")
    elif not actor.is_admin:
        # Synchronizing the candidate projection changes the source message.
        # A viewer may read that message but must not mutate its metadata, even
        # when the target is the actor's personal or creator-owned memory.
        if not source_memberships:
            raise HTTPException(403, "Project membership required")
        if not any(member_can_write(member) for member in source_memberships):
            raise HTTPException(403, "Source project write permission required")
    return actor, message


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
    source_message_id: int | None = None
    source_conversation_id: int | None = None
    source_project_id: int | None = None

    if source_type == "chat_message":
        if not source_id.isdigit():
            raise HTTPException(400, "chat_message source_id must be a message id")
        source_message_id = int(source_id)
        message = session.get(Message, source_message_id)
        if message is None:
            raise HTTPException(404, "Source message not found")
        conversation = require_conversation_access(
            session,
            message.conversation_id,
            current_user,
            require_write=False,
        )
        source_conversation_id = int(conversation.id)
        source_project_id = conversation.project_id
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
                or not project_belongs_to_client(
                    session,
                    source_project,
                    source_client,
                )
            ):
                raise HTTPException(400, "Source message is not linked to the requested client")

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

    actor, locked_source_message = _lock_candidate_create_context(
        session,
        current_user=current_user,
        requested_scope=requested_scope,
        project_id=body.project_id,
        client_id=body.client_id,
        source_message_id=source_message_id,
        source_conversation_id=source_conversation_id,
        source_project_id=source_project_id,
    )
    if locked_source_message is not None:
        source_refs = [
            ref
            for ref in source_refs
            if str(ref.get("source_type") or ref.get("type") or "")
            .strip()
            .lower()
            not in RESERVED_SOURCE_REF_TYPES
        ]
        if not content:
            content = locked_source_message.content
        source_run_id = source_run_id_from_message(locked_source_message) or source_run_id
        source_refs = [
            {
                "source_type": "chat_message",
                "source_id": str(locked_source_message.id),
                "label": "Aria project chat message",
            },
                {
                    "source_type": SOURCE_CONVERSATION_REF_TYPE,
                    "source_id": str(source_conversation_id),
                    "label": "Aria source conversation identity",
                },
                {
                    "source_type": SOURCE_PROJECT_REF_TYPE,
                    "source_id": (
                        str(source_project_id)
                        if source_project_id is not None
                        else "none"
                    ),
                    "label": "Aria source project identity",
                },
                {
                    "source_type": SOURCE_OWNER_REF_TYPE,
                    "source_id": (
                        str(actor.id) if source_project_id is None else "none"
                    ),
                    "label": "Aria source conversation owner identity",
                },
            *source_refs,
        ]

    candidate, created = create_memory_candidate(
        session,
        owner_user_id=int(actor.id),
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
    candidate = _owned_candidate(session, candidate_id, current_user)
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
    candidate = _owned_candidate(session, candidate_id, current_user)
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
