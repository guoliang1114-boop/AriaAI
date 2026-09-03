"""Projects sub-router: meeting briefing and stakeholder capture."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app.routers.projects_deps import get_session
from app.models.db import (
    ClientStakeholder,
    ClientRecord,
    Conversation,
    Milestone,
    Message,
    Project,
    ProjectFile,
    ProjectMember,
    ProjectTodo,
    User,
)
from app.services.stakeholder_detection import detect_stakeholders_from_text
from app.routers.projects_deps import (
    _build_project_briefing,
    _normalize_briefing_meeting_type,
    _briefing_cache_type,
    _briefing_source_version,
    _build_project_briefing_refine_prompt,
    _extract_stakeholder_candidates_from_text,
    _refresh_instance,
    _bust_project,
    _mark_project_memory_stale,
    _ensure_project_memory,
    _find_client_record_for_project,
    _serialize_client_stakeholder_dict,
    _extract_first_json_object_from_text,
    _normalize_name,
    _project_summary_lock_key,
    _get_project_summary_lock,
    _CLIENTS_KEY,
    ProjectBriefingRefineRequest,
    ProjectStakeholderCaptureRequest,
    ProjectStakeholderAnalyzeRequest,
)
from app.services.project_contexts import (
    get_project_memory_summary_cache,
    get_project_memory_payload,
    mark_project_memories_stale_by_client_id,
    normalize_summary_language,
    save_project_memory_summary_cache,
)
from app.services.client_contexts import (
    get_client_memory_payload,
    mark_client_memory_stale,
)
from app.services.client_permissions import lock_and_require_client_access
from app.services.memory_operations import classify_memory_failure
from app.services.memory_slots import (
    load_client_memory_slot_values,
    load_project_memory_slot_values,
)
from app.services.project_core import (
    get_project_or_404,
    lock_and_require_project_write as lock_project_write,
)
from app.services.project_llm import complete_with_selected_model, stream_with_selected_model
from app.services.cache import clients_cache, projects_cache
from app.services.time_utils import utc_now_naive

from app.routers.auth import get_current_user
from app.routers.chat_security import (
    maybe_require_project_access,
    member_can_write,
    require_project_access,
)

router = APIRouter(
    tags=["projects"],
    dependencies=[Depends(maybe_require_project_access)],
)

logger = logging.getLogger(__name__)


_PROJECT_STAKEHOLDER_ANALYSIS_FIELDS = (
    "name",
    "role",
    "organization_level",
    "influence_type",
    "relationship_status",
    "concerns",
    "sensitivities",
    "communication_preference",
    "contact",
    "last_action",
    "personality_profile",
    "decision_style",
    "communication_strategy",
    "trust_signals",
    "note",
)


def _project_stakeholder_analysis_baseline(
    session: Session,
    project: Project,
    client: ClientRecord,
    stakeholder: ClientStakeholder,
) -> str:
    """Freeze every prompt source that may be edited while the provider runs."""

    return json.dumps(
        {
            "project": {
                "id": project.id,
                "name": project.name,
                "client": project.client,
                "status": project.status,
                "description": project.description,
                "memory": load_project_memory_slot_values(
                    session,
                    project,
                    get_project_memory_payload(project),
                ),
                "memory_updated_at": (
                    project.memory_updated_at.isoformat()
                    if project.memory_updated_at
                    else None
                ),
            },
            "client": {
                "id": client.id,
                "name": client.name,
                "industry": client.industry,
                "contact": client.contact,
                "notes": client.notes,
                "memory": load_client_memory_slot_values(
                    session,
                    client,
                    get_client_memory_payload(client),
                ),
                "memory_updated_at": (
                    client.client_memory_updated_at.isoformat()
                    if client.client_memory_updated_at
                    else None
                ),
            },
            "stakeholder": {
                "id": stakeholder.id,
                "client_id": stakeholder.client_id,
                "updated_at": stakeholder.updated_at.isoformat(),
                **{
                    field: getattr(stakeholder, field, "")
                    for field in _PROJECT_STAKEHOLDER_ANALYSIS_FIELDS
                },
            },
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _lock_and_require_source_project_client_write(
    session: Session,
    *,
    project_id: int,
    client_id: int,
    current_user: User,
) -> tuple[Project, ClientRecord]:
    """Finalize a project-scoped client write under the shared lock order.

    Client write permission alone is insufficient here: the request originated
    from one project, so a non-admin must still be an owner/editor of that exact
    source project. ``lock_and_require_client_access`` reloads and locks the
    active actor, all stable-linked projects, the client, and the actor's
    memberships before client-owned child rows are locked by the caller.
    """

    client, actor, locked_projects = lock_and_require_client_access(
        session,
        client_id,
        current_user,
        require_write=True,
    )
    project = next(
        (
            candidate
            for candidate in locked_projects
            if candidate.id == project_id and candidate.client_id == client_id
        ),
        None,
    )
    if project is None:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Project client changed; reload and retry.",
        )
    if actor.is_admin:
        return project, client

    membership = session.exec(
        select(ProjectMember)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == actor.id,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if membership is None:
        session.rollback()
        raise HTTPException(status_code=403, detail="Project membership required")
    if not member_can_write(membership):
        session.rollback()
        raise HTTPException(status_code=403, detail="Project write permission required")
    return project, client


def _lock_and_require_project_write(
    session: Session,
    *,
    project_id: int,
    current_user: User,
) -> tuple[Project, User]:
    """Reload and authorize through the repository-wide project lock order."""

    return lock_project_write(
        session,
        project_id,
        actor_user_id=int(current_user.id or 0),
    )


def _require_current_briefing_source(
    session: Session,
    *,
    project_id: int,
    meeting_type: str,
    expected_source_version: int,
) -> dict:
    """Reject a model result when any deterministic prompt source changed."""

    session.expire_all()
    current_briefing = _build_project_briefing(session, project_id)
    current_source_version = _briefing_source_version(
        current_briefing,
        meeting_type,
    )
    if current_source_version != expected_source_version:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Briefing sources changed during generation; retry with current data.",
        )
    return current_briefing


def _lock_and_require_briefing_sources(
    session: Session,
    *,
    project_id: int,
    expected_client_id: int | None,
    current_user: User,
) -> tuple[Project, ClientRecord | None]:
    """Authorize and freeze every row family used by a briefing prompt.

    PostgreSQL foreign-key checks take key-share locks on their parent rows.
    Holding the Project/Client/Conversation parents plus every existing source
    child therefore blocks both new inserts and updates/deletes until the
    summary cache commit.  The final source hash is rebuilt only after this
    source set is frozen, closing the post-verification/pre-save race.
    """

    if expected_client_id is not None:
        project, client = _lock_and_require_source_project_client_write(
            session,
            project_id=project_id,
            client_id=expected_client_id,
            current_user=current_user,
        )
    else:
        project, _ = _lock_and_require_project_write(
            session,
            project_id=project_id,
            current_user=current_user,
        )
        if project.client_id is not None:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Project client changed during briefing generation; retry.",
            )
        client = None

    session.exec(
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .order_by(Milestone.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    session.exec(
        select(ProjectTodo)
        .where(ProjectTodo.project_id == project_id)
        .order_by(ProjectTodo.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    session.exec(
        select(ProjectFile)
        .where(ProjectFile.project_id == project_id)
        .order_by(ProjectFile.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    conversations = list(
        session.exec(
            select(Conversation)
            .where(Conversation.project_id == project_id)
            .order_by(Conversation.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    )
    conversation_ids = [
        int(conversation.id)
        for conversation in conversations
        if conversation.id is not None
    ]
    if conversation_ids:
        session.exec(
            select(Message)
            .where(Message.conversation_id.in_(conversation_ids))
            .order_by(Message.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    if client is not None:
        session.exec(
            select(ClientStakeholder)
            .where(ClientStakeholder.client_id == int(client.id))
            .order_by(ClientStakeholder.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    return project, client


def _record_authorized_project_memory_failure(
    session: Session,
    *,
    project_id: int,
    current_user: User,
    stage: str,
    message: str,
    expected_memory_version: int,
    expected_rebuild_status: str,
) -> bool:
    """Persist a request failure only while final project write auth is held."""

    session.rollback()
    current, _ = _lock_and_require_project_write(
        session,
        project_id=project_id,
        current_user=current_user,
    )
    if (
        current.memory_version > expected_memory_version
        or (
            expected_rebuild_status in {"queued", "rebuilding"}
            and current.memory_rebuild_status == "idle"
        )
    ):
        session.rollback()
        return False
    try:
        memory = json.loads(current.context_memory_json or "{}")
        if not isinstance(memory, dict):
            memory = {}
    except json.JSONDecodeError:
        memory = {}
    failed_at = utc_now_naive()
    memory["_last_failure"] = {
        "category": classify_memory_failure(stage, message),
        "stage": stage,
        "message": message[:400],
        "retry_count": 0,
        "failed_at": failed_at.isoformat(),
    }
    current.context_memory_json = json.dumps(memory, ensure_ascii=False)
    session.add(current)
    session.commit()
    return True


@router.get("/{project_id}/briefing")
def get_project_meeting_briefing(project_id: int, session: Session = Depends(get_session)):
    """Return a deterministic pre-meeting briefing assembled from memory and project signals."""
    return _build_project_briefing(session, project_id)


@router.post("/{project_id}/briefing/refine")
async def refine_project_meeting_briefing(
    project_id: int,
    body: ProjectBriefingRefineRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Generate or reuse an AI-refined briefing for the current deterministic briefing payload."""
    project = get_project_or_404(session, project_id)
    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    meeting_type = _normalize_briefing_meeting_type(body.meeting_type)
    normalized_language = normalize_summary_language(body.language)
    briefing = _build_project_briefing(session, project_id)
    cache_type = _briefing_cache_type(meeting_type)
    source_version = _briefing_source_version(briefing, meeting_type)
    expected_client_id = project.client_id
    expected_memory_version = project.memory_version
    expected_rebuild_status = project.memory_rebuild_status

    if not body.force_refresh:
        cached = get_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=cache_type,
            language=normalized_language,
            memory_version=source_version,
        )
        if cached:
            return {
                "project_id": project_id,
                "meeting_type": meeting_type,
                "content": cached.content,
                "source_memory_version": source_version,
                "generated_at": cached.updated_at.isoformat(),
                "cached": True,
            }

    lock_key = _project_summary_lock_key(project_id, cache_type, normalized_language, source_version)
    summary_lock = _get_project_summary_lock(lock_key)
    session.rollback()
    async with summary_lock:
        _require_current_briefing_source(
            session,
            project_id=project_id,
            meeting_type=meeting_type,
            expected_source_version=source_version,
        )
        session.rollback()
        if not body.force_refresh:
            fresh_cached = get_project_memory_summary_cache(
                session,
                project_id=project_id,
                summary_type=cache_type,
                language=normalized_language,
                memory_version=source_version,
            )
            if fresh_cached:
                return {
                    "project_id": project_id,
                    "meeting_type": meeting_type,
                    "content": fresh_cached.content,
                    "source_memory_version": source_version,
                    "generated_at": fresh_cached.updated_at.isoformat(),
                    "cached": True,
                }

        session.rollback()
        try:
            content = await complete_with_selected_model(
                messages=[{"role": "user", "content": _build_project_briefing_refine_prompt(briefing, meeting_type, normalized_language)}],
                max_tokens=1800,
            )
        except Exception as e:
            _record_authorized_project_memory_failure(
                session,
                project_id=project_id,
                current_user=current_user,
                stage=f"briefing_refine:{meeting_type}",
                message=str(e),
                expected_memory_version=expected_memory_version,
                expected_rebuild_status=expected_rebuild_status,
            )
            raise

        session.expire_all()
        _lock_and_require_briefing_sources(
            session,
            project_id=project_id,
            expected_client_id=expected_client_id,
            current_user=current_user,
        )
        _require_current_briefing_source(
            session,
            project_id=project_id,
            meeting_type=meeting_type,
            expected_source_version=source_version,
        )
        cached = save_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=cache_type,
            language=normalized_language,
            memory_version=source_version,
            content=content.strip(),
        )
        return {
            "project_id": project_id,
            "meeting_type": meeting_type,
            "content": cached.content,
            "source_memory_version": source_version,
            "generated_at": cached.updated_at.isoformat(),
            "cached": False,
        }


@router.post("/{project_id}/briefing/refine/stream")
async def refine_project_meeting_briefing_stream(
    project_id: int,
    body: ProjectBriefingRefineRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Streaming variant of /briefing/refine — yields SSE events as
    the LLM produces tokens, so the frontend can render the script
    progressively instead of waiting 30-90s for the full payload.

    Events:
        - data: {"type": "meta", "memory_version": N, "cached": false}
        - data: {"type": "delta", "text": "<chunk>"}     (many)
        - data: {"type": "done",  "content": "<full content>"}
        - data: {"type": "error", "message": "<reason>"}

    On hit-cache the whole content arrives in a single "done" event
    with cached=true in the meta — frontend can switch from
    progressive rendering to instant rendering without a code split.
    """
    project = get_project_or_404(session, project_id)
    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    meeting_type = _normalize_briefing_meeting_type(body.meeting_type)
    normalized_language = normalize_summary_language(body.language)
    briefing = _build_project_briefing(session, project_id)
    cache_type = _briefing_cache_type(meeting_type)
    source_version = _briefing_source_version(briefing, meeting_type)
    expected_client_id = project.client_id
    prompt = _build_project_briefing_refine_prompt(briefing, meeting_type, normalized_language)
    expected_memory_version = project.memory_version
    expected_rebuild_status = project.memory_rebuild_status
    # The response generator may outlive this endpoint frame. It must start
    # without retaining the request's initial read transaction.
    session.rollback()

    async def event_stream():
        def sse(payload: dict) -> str:
            return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        # 1. Try cache first unless force_refresh is set. If hit, send
        #    meta + done in two events so the UI gets the same shape.
        try:
            _require_current_briefing_source(
                session,
                project_id=project_id,
                meeting_type=meeting_type,
                expected_source_version=source_version,
            )
        except HTTPException as source_exc:
            yield sse({
                "type": "error",
                "message": str(source_exc.detail),
                "status_code": source_exc.status_code,
            })
            return
        session.rollback()
        if not body.force_refresh:
            cached = get_project_memory_summary_cache(
                session,
                project_id=project_id,
                summary_type=cache_type,
                language=normalized_language,
                memory_version=source_version,
            )
            if cached:
                cached_content = cached.content
                cached_updated_at = cached.updated_at.isoformat()
                session.rollback()
                yield sse({
                    "type": "meta",
                    "memory_version": source_version,
                    "cached": True,
                    "meeting_type": meeting_type,
                })
                yield sse({
                    "type": "done",
                    "content": cached_content,
                    "generated_at": cached_updated_at,
                    "cached": True,
                })
                return
            session.rollback()

        yield sse({
            "type": "meta",
            "memory_version": source_version,
            "cached": False,
            "meeting_type": meeting_type,
        })

        # 2. Otherwise stream tokens from the LLM. Buffer the accumulated
        #    content so we can persist it to the cache at the end and
        #    send a final "done" event with the full content for callers
        #    that prefer atomic rendering.
        #
        #    Some providers' streams (openai_compat for Kimi / DeepSeek)
        #    inline metadata chunks shaped like {"type": "reasoning_content"...}
        #    or {"type": "tool_use"...} alongside the real text content.
        #    Those are meant for the chat pipeline to parse and attach
        #    as assistant-message metadata; we just want the markdown,
        #    so skip any chunk whose first char is "{" and parses as a
        #    metadata wrapper.
        def _is_metadata_chunk(text: str) -> bool:
            stripped = text.lstrip()
            if not stripped.startswith("{"):
                return False
            try:
                obj = json.loads(stripped)
            except (json.JSONDecodeError, ValueError):
                return False
            return isinstance(obj, dict) and obj.get("type") in {
                "reasoning_content",
                "tool_use",
                "tool_result",
                "thinking",
            }

        buffer: list[str] = []
        try:
            async for chunk in stream_with_selected_model(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1800,
            ):
                if not chunk:
                    continue
                if _is_metadata_chunk(chunk):
                    continue
                buffer.append(chunk)
                yield sse({"type": "delta", "text": chunk})
                # Cooperative yield so other requests can run.
                await asyncio.sleep(0)
        except Exception as exc:  # noqa: BLE001
            try:
                _record_authorized_project_memory_failure(
                    session,
                    project_id=project_id,
                    current_user=current_user,
                    stage=f"briefing_refine_stream:{meeting_type}",
                    message=str(exc),
                    expected_memory_version=expected_memory_version,
                    expected_rebuild_status=expected_rebuild_status,
                )
            except HTTPException as auth_exc:
                yield sse({
                    "type": "error",
                    "message": str(auth_exc.detail),
                    "status_code": auth_exc.status_code,
                })
                return
            yield sse({"type": "error", "message": str(exc)})
            return

        full_content = "".join(buffer).strip()
        if not full_content:
            yield sse({"type": "error", "message": "Empty LLM response"})
            return

        session.expire_all()
        try:
            _lock_and_require_briefing_sources(
                session,
                project_id=project_id,
                expected_client_id=expected_client_id,
                current_user=current_user,
            )
            _require_current_briefing_source(
                session,
                project_id=project_id,
                meeting_type=meeting_type,
                expected_source_version=source_version,
            )
        except HTTPException as auth_exc:
            yield sse({
                "type": "error",
                "message": str(auth_exc.detail),
                "status_code": auth_exc.status_code,
            })
            return
        cached = save_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=cache_type,
            language=normalized_language,
            memory_version=source_version,
            content=full_content,
        )
        yield sse({
            "type": "done",
            "content": cached.content,
            "generated_at": cached.updated_at.isoformat(),
            "cached": False,
        })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        # Disable proxy buffering so chunks reach the browser as they
        # come — nginx in front of FastAPI will otherwise hold them.
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{project_id}/stakeholder-candidates")
def scan_recent_stakeholder_candidates(
    project_id: int,
    limit: int = 5,
    session: Session = Depends(get_session),
):
    """Scan recent assistant messages in the project's conversations and return
    stakeholder candidates that are NOT already in the stakeholder table."""
    project = get_project_or_404(session, project_id)
    client = _find_client_record_for_project(session, project)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")

    conversations = session.exec(
        select(Conversation).where(Conversation.project_id == project_id)
    ).all()
    if not conversations:
        return {"project_id": project_id, "client_id": client.id, "client_name": client.name, "candidates": []}

    conv_ids = [c.id for c in conversations if c.id is not None]
    recent_messages = session.exec(
        select(Message)
        .where(Message.conversation_id.in_(conv_ids), Message.role == "assistant")  # type: ignore[attr-defined]
        .order_by(Message.created_at.desc())
        .limit(limit)
    ).all()

    existing_names = {
        _normalize_name(s.name)
        for s in session.exec(select(ClientStakeholder).where(ClientStakeholder.client_id == client.id)).all()
    }

    seen: set[str] = set()
    candidates: list[dict[str, str]] = []
    for msg in recent_messages:
        for cand in detect_stakeholders_from_text(msg.content):
            normalized = _normalize_name(cand.get("name"))
            if not normalized or normalized in seen or normalized in existing_names:
                continue
            seen.add(normalized)
            candidates.append(cand)

    return {
        "project_id": project_id,
        "client_id": client.id,
        "client_name": client.name,
        "candidates": candidates,
    }


@router.post("/{project_id}/stakeholder-candidates")
def list_project_stakeholder_candidates(
    project_id: int,
    body: ProjectStakeholderCaptureRequest,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    client = _find_client_record_for_project(session, project)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")
    return {
        "project_id": project_id,
        "client_id": client.id,
        "client_name": client.name,
        "candidates": _extract_stakeholder_candidates_from_text(body.text),
    }


@router.post("/{project_id}/stakeholder-candidates/apply")
def apply_project_stakeholder_candidates(
    project_id: int,
    body: ProjectStakeholderCaptureRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    project = get_project_or_404(session, project_id)
    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    client = _find_client_record_for_project(session, project)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")
    client_id = int(client.id)

    candidates = _extract_stakeholder_candidates_from_text(body.text)
    if not candidates:
        return {"project_id": project_id, "client_id": client.id, "candidates": [], "created": [], "skipped": []}

    # Release the early read transaction, then make authorization and the
    # source project's stable client relationship part of the write boundary.
    session.rollback()
    project, client = _lock_and_require_source_project_client_write(
        session,
        project_id=project_id,
        client_id=client_id,
        current_user=current_user,
    )
    locked_stakeholders = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client_id)
        .order_by(ClientStakeholder.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    existing = {
        _normalize_name(stakeholder.name)
        for stakeholder in locked_stakeholders
    }
    created_rows: list[ClientStakeholder] = []
    created: list[dict] = []
    skipped: list[dict] = []
    now = utc_now_naive()
    for candidate in candidates:
        normalized_name = _normalize_name(candidate.get("name"))
        if not normalized_name or normalized_name in existing:
            skipped.append({**candidate, "reason": "exists" if normalized_name in existing else "empty_name"})
            continue
        stakeholder = ClientStakeholder(
            client_id=client.id,
            name=candidate.get("name", ""),
            role=candidate.get("role", ""),
            influence_type=candidate.get("influence_type", ""),
            relationship_status=candidate.get("relationship_status", "unknown"),
            note=candidate.get("note", ""),
            created_at=now,
            updated_at=now,
        )
        session.add(stakeholder)
        created_rows.append(stakeholder)
        existing.add(normalized_name)

    if created_rows:
        session.flush()
        for stakeholder in created_rows:
            created.append(
                {
                    "id": stakeholder.id,
                    "client_id": stakeholder.client_id,
                    "name": stakeholder.name,
                    "role": stakeholder.role,
                    "influence_type": stakeholder.influence_type,
                    "relationship_status": stakeholder.relationship_status,
                    "note": stakeholder.note,
                }
            )
        mark_client_memory_stale(
            session,
            client_id,
            trigger="stakeholder_created",
            commit=False,
        )
        mark_project_memories_stale_by_client_id(
            session,
            client_id,
            trigger="stakeholder_created",
            commit=False,
        )
        session.commit()

    if created:
        _bust_project(project_id)

    return {
        "project_id": project_id,
        "client_id": client.id,
        "client_name": client.name,
        "candidates": candidates,
        "created": created,
        "skipped": skipped,
    }


@router.post("/{project_id}/stakeholders/{stakeholder_id}/analyze")
async def analyze_project_stakeholder(
    project_id: int,
    stakeholder_id: int,
    body: ProjectStakeholderAnalyzeRequest | None = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    project = get_project_or_404(session, project_id)
    require_project_access(
        session,
        project_id,
        current_user,
        require_write=True,
    )
    client = _find_client_record_for_project(session, project)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client.id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")
    analysis_client_id = int(client.id)

    project_memory = load_project_memory_slot_values(
        session,
        project,
        get_project_memory_payload(project),
    )
    client_memory = load_client_memory_slot_values(
        session,
        client,
        get_client_memory_payload(client),
    )
    source_baseline = _project_stakeholder_analysis_baseline(
        session,
        project,
        client,
        stakeholder,
    )
    focus = (body.focus if body else "") or ""
    prompt = (
        "You are a senior account strategy advisor. Analyze this contact for the current project and client.\n"
        "Return ONLY a valid JSON object with keys: personality_profile, decision_style, communication_strategy, trust_signals.\n"
        "Keep each value concise, practical, and based only on the provided facts. If evidence is limited, say what is inferred and what still needs validation.\n\n"
        f"Project:\n- name: {project.name}\n- client: {project.client}\n- status: {project.status}\n- description: {project.description}\n\n"
        f"Project memory JSON:\n{json.dumps(project_memory, ensure_ascii=False)[:6000]}\n\n"
        f"Client memory JSON:\n{json.dumps(client_memory, ensure_ascii=False)[:6000]}\n\n"
        "Contact profile:\n"
        f"- name: {stakeholder.name}\n"
        f"- role: {stakeholder.role}\n"
        f"- organization_level: {stakeholder.organization_level}\n"
        f"- influence_type: {stakeholder.influence_type}\n"
        f"- relationship_status: {stakeholder.relationship_status}\n"
        f"- concerns: {stakeholder.concerns}\n"
        f"- sensitivities: {stakeholder.sensitivities}\n"
        f"- communication_preference: {stakeholder.communication_preference}\n"
        f"- last_action: {stakeholder.last_action}\n"
        f"- existing_note: {stakeholder.note}\n"
        f"- focus: {focus}\n\n"
        "Write in Chinese unless the facts are clearly English-only."
    )
    # Do not retain a synchronous SQLAlchemy transaction while awaiting the
    # provider. A locked reload and exact prompt-source comparison below make a
    # concurrent manual edit authoritative over this stale model response.
    session.rollback()
    raw = await complete_with_selected_model(messages=[{"role": "user", "content": prompt}], max_tokens=1600)
    try:
        parsed = json.loads(_extract_first_json_object_from_text(str(raw or "")))
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    session.expire_all()
    # Re-authorize after the provider wait. The shared helper reloads the
    # active actor and locks stable project/client ownership before the child.
    project, client = _lock_and_require_source_project_client_write(
        session,
        project_id=project_id,
        client_id=analysis_client_id,
        current_user=current_user,
    )
    stakeholder = session.exec(
        select(ClientStakeholder)
        .where(
            ClientStakeholder.id == stakeholder_id,
            ClientStakeholder.client_id == analysis_client_id,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if (
        not project
        or not client
        or not stakeholder
        or stakeholder.client_id != client.id
        or project.client_id != client.id
    ):
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Project, client, or stakeholder changed during analysis; retry with current data.",
        )
    if (
        _project_stakeholder_analysis_baseline(
            session,
            project,
            client,
            stakeholder,
        )
        != source_baseline
    ):
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Stakeholder analysis sources changed during generation; retry with current data.",
        )
    stakeholder.personality_profile = str(parsed.get("personality_profile") or "").strip()[:2000]
    stakeholder.decision_style = str(parsed.get("decision_style") or "").strip()[:2000]
    stakeholder.communication_strategy = str(parsed.get("communication_strategy") or "").strip()[:2400]
    stakeholder.trust_signals = str(parsed.get("trust_signals") or "").strip()[:2000]
    stakeholder.updated_at = utc_now_naive()
    session.add(stakeholder)
    mark_client_memory_stale(
        session,
        int(client.id),
        trigger="stakeholder_analyzed",
        commit=False,
    )
    mark_project_memories_stale_by_client_id(
        session,
        int(client.id),
        trigger="stakeholder_analyzed",
        commit=False,
    )
    session.commit()
    session.refresh(stakeholder)
    _bust_project(project_id)
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder_dict(stakeholder)
