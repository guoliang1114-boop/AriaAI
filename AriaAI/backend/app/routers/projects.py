"""Projects router — slim file with core CRUD endpoints.

Memory, files, and briefing endpoints live in sub-routers:
  - projects_memory.py
  - projects_files.py
  - projects_briefing.py
"""
from __future__ import annotations

import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Project, User
from app.services import scheduler as scheduler_service
from app.services.cache import projects_cache
from app.services.project_ai import (
    build_project_ai_suggest_messages,
    parse_project_ai_suggestions,
)
from app.services.project_contexts import (
    _default_project_memory,
    save_project_memory,
    stream_llm_text_chunks,
)
from app.services.project_core import (
    create_project_record,
    get_project_or_404,
    init_default_project_folders,
    list_projects_basic,
    update_project_record,
)
from app.services.project_deletion import delete_project_cascade
from app.services.project_details import build_project_detail
from app.services.project_financials import (
    add_project_payment,
    delete_project_payment,
    get_project_financials,
)
from app.services.project_members import (
    add_project_member,
    list_project_members,
    remove_project_member,
    serialize_member,
)
from app.services.project_milestones import (
    create_project_milestone,
    delete_project_milestone,
    list_project_milestones,
    update_project_milestone,
)
from app.services.project_notes import build_project_note_polish_messages, save_project_notes
from app.routers.projects_deps import complete_with_selected_model, stream_with_selected_model
from app.services.project_todos import (
    create_project_todo,
    delete_project_todo,
    ensure_project_exists,
    list_project_todos,
    list_user_pending_todos,
    serialize_todo,
    update_project_todo,
)
from app.routers.auth import get_current_user
from app.routers.projects_deps import (
    _PROJECTS_TTL,
    _auto_promote_archived_project_to_client_memory,
    _bust_project,
    _mark_project_memory_stale,
    _refresh_instance,
    _schedule_project_memory_rebuild,
    MemberCreate,
    MemberOut,
    MemberUserOut,
    MilestoneCreate,
    MilestoneUpdate,
    NoteBody,
    NotePolishBody,
    PaymentCreate,
    ProjectAISuggestQuery,
    ProjectAISuggestion,
    ProjectCreate,
    ProjectUpdate,
    TodoCreate,
    TodoUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("")
def list_projects(
    status: Optional[str] = None,
    member_user_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    cache_key = f"list:{status or ''}:member:{member_user_id or ''}"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached
    result = list_projects_basic(session, status=status, member_user_id=member_user_id)
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.post("", status_code=201)
def create_project(data: ProjectCreate, session: Session = Depends(get_session)):
    project = create_project_record(session, data.model_dump())
    # Seed initial memory so AI has basic context immediately (no waiting for async rebuild)
    seed_memory = _default_project_memory(project)
    save_project_memory(session, project.id, seed_memory, trigger="project_created")
    _schedule_project_memory_rebuild(project.id, trigger="project_created")
    if scheduler_service.is_running():
        project.memory_rebuild_status = "queued"
        session.add(project)
        session.commit()
        session.refresh(project)
    projects_cache.delete_prefix("list:")   # no detail key yet — project just created
    return project


@router.get("/{project_id}")
def get_project(project_id: int, session: Session = Depends(get_session)):
    return get_project_or_404(session, project_id)


@router.get("/{project_id}/detail")
def get_project_detail(project_id: int, session: Session = Depends(get_session)):
    """Single-request combined endpoint: project + files + milestones + folders + financials.

    Reduces 4-5 round trips to Supabase down to 1 HTTP call with 5 fast local queries.
    """
    cache_key = f"detail:{project_id}"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached

    result = build_project_detail(session, project_id, init_default_folders=init_default_project_folders)
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.get("/meta/dashboard-summary")
def list_projects_dashboard_summary(
    session: Session = Depends(get_session),
):
    cache_key = "list:dashboard-summary"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached

    rows = session.exec(
        select(
            Project.id,
            Project.name,
            Project.client,
            Project.status,
            Project.contract_amount,
            Project.updated_at,
            Project.memory_stale,
            Project.memory_version,
        ).order_by(Project.updated_at.desc())
    ).all()

    result = [
        {
            "id": project_id,
            "name": name,
            "client": client,
            "status": status,
            "contract_amount": contract_amount,
            "updated_at": updated_at,
            "memory_stale": memory_stale,
            "memory_version": memory_version,
        }
        for (
            project_id,
            name,
            client,
            status,
            contract_amount,
            updated_at,
            memory_stale,
            memory_version,
        ) in rows
    ]
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.patch("/{project_id}")
async def update_project(project_id: int, data: ProjectUpdate, session: Session = Depends(get_session)):
    existing = session.get(Project, project_id)
    previous_status = existing.status if existing else None
    project = update_project_record(session, project_id, data.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id)
    try:
        await _auto_promote_archived_project_to_client_memory(
            session,
            project_id,
            previous_status=previous_status,
        )
    except Exception:
        logger.exception("Failed to auto-promote archived project %s into client memory", project_id)
    _bust_project(project_id)
    return project


@router.delete("/{project_id}")
def delete_project(project_id: int, session: Session = Depends(get_session)):
    delete_project_cascade(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── AI Suggest ────────────────────────────────────────────────────────────────

@router.post("/ai-suggest", response_model=list[ProjectAISuggestion])
async def ai_suggest_project(body: ProjectAISuggestQuery):
    """Ask Claude to propose 1-3 consulting project names + descriptions."""
    try:
        raw = await complete_with_selected_model(
            messages=build_project_ai_suggest_messages(
                body.query,
                client_name=body.client_name,
                client_industry=body.client_industry,
            ),
            max_tokens=4000,
        )
        suggestions = parse_project_ai_suggestions(raw)
        return [ProjectAISuggestion(**s) for s in suggestions[:3]]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {e}")


# ── Milestones ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/milestones")
def list_milestones(project_id: int, session: Session = Depends(get_session)):
    return list_project_milestones(session, project_id)


@router.post("/{project_id}/milestones", status_code=201)
def create_milestone(project_id: int, data: MilestoneCreate, session: Session = Depends(get_session)):
    ms = create_project_milestone(
        session,
        project_id,
        title=data.title,
        priority=data.priority,
        due_date=data.due_date,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, ms)


@router.patch("/{project_id}/milestones/{ms_id}")
def update_milestone(project_id: int, ms_id: int, data: MilestoneUpdate, session: Session = Depends(get_session)):
    ms = update_project_milestone(session, project_id, ms_id, data.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, ms)


@router.delete("/{project_id}/milestones/{ms_id}")
def delete_milestone(project_id: int, ms_id: int, session: Session = Depends(get_session)):
    delete_project_milestone(session, project_id, ms_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── Financials ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/financials")
def get_financials(project_id: int, session: Session = Depends(get_session)):
    return get_project_financials(session, project_id)


@router.post("/{project_id}/financials", status_code=201)
def add_payment(project_id: int, data: PaymentCreate, session: Session = Depends(get_session)):
    payment = add_project_payment(
        session,
        project_id,
        amount=data.amount,
        payment_date=data.payment_date,
        note=data.note,
        payment_type=data.payment_type,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, payment)


@router.delete("/{project_id}/financials/{payment_id}")
def delete_payment(project_id: int, payment_id: int, session: Session = Depends(get_session)):
    delete_project_payment(session, project_id, payment_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── Project notes (沉淀到项目) ─────────────────────────────────────────────────

@router.post("/{project_id}/notes")
def save_project_note(project_id: int, body: NoteBody, session: Session = Depends(get_session)):
    """Append or overwrite project notes."""
    project = save_project_notes(session, project_id, body.content, append=body.append)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"notes": project.notes}

# ── Project Todos ────────────────────────────────────────────────────────────


@router.get("/{project_id}/todos")
def list_todos(project_id: int, session: Session = Depends(get_session)):
    todos = list_project_todos(session, project_id)
    return [serialize_todo(todo) for todo in todos]


@router.post("/{project_id}/todos", status_code=201)
def create_todo(project_id: int, body: TodoCreate, session: Session = Depends(get_session)):
    todo = create_project_todo(
        session,
        project_id,
        content=body.content,
        is_done=body.is_done,
        due_date=body.due_date,
        assigned_to_user_id=body.assigned_to_user_id,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return serialize_todo(todo)


@router.patch("/{project_id}/todos/{todo_id}")
def update_todo(project_id: int, todo_id: int, body: TodoUpdate, session: Session = Depends(get_session)):
    todo = update_project_todo(session, project_id, todo_id, body.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return serialize_todo(todo)


@router.delete("/{project_id}/todos/{todo_id}")
def delete_todo(project_id: int, todo_id: int, session: Session = Depends(get_session)):
    delete_project_todo(session, project_id, todo_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


@router.get("/todos/my")
def list_my_todos(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Return pending todos assigned to the current user across all projects."""
    return list_user_pending_todos(session, current_user.id)


# ── Project Members ───────────────────────────────────────────────────────────

@router.get("/{project_id}/members", response_model=list[MemberOut])
def list_members(project_id: int, session: Session = Depends(get_session)):
    ensure_project_exists(session, project_id)
    members = list_project_members(session, project_id)
    return [
        MemberOut(**serialize_member(member))
        for member in members
        if member.user
    ]


@router.post("/{project_id}/members", status_code=201, response_model=MemberOut)
def add_member(project_id: int, body: MemberCreate, session: Session = Depends(get_session)):
    ensure_project_exists(session, project_id)
    member, user = add_project_member(session, project_id, body.user_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return MemberOut(
        id=member.id,
        project_id=member.project_id,
        user_id=member.user_id,
        user=MemberUserOut(id=user.id, display_name=user.display_name),
        created_at=member.created_at,
    )


@router.delete("/{project_id}/members/{user_id}")
def remove_member(project_id: int, user_id: int, session: Session = Depends(get_session)):
    remove_project_member(session, project_id, user_id)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


# ── AI Polish for Project Notes ──────────────────────────────────────────────

@router.post("/{project_id}/notes/ai-polish")
async def ai_polish_project_notes(project_id: int, body: NotePolishBody, session: Session = Depends(get_session)):
    """Use the active LLM to polish a rough draft into structured Markdown project notes."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    messages = build_project_note_polish_messages(project, body.draft)
    result = await complete_with_selected_model(messages, max_tokens=4000)
    return {"result": result}


@router.post("/{project_id}/notes/ai-polish-stream")
async def ai_polish_project_notes_stream(project_id: int, body: NotePolishBody, session: Session = Depends(get_session)):
    """Stream the active LLM polishing a rough draft into structured Markdown project notes."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    messages = build_project_note_polish_messages(project, body.draft)

    async def event_stream():
        try:
            async for chunk in stream_llm_text_chunks(stream_with_selected_model(messages, max_tokens=4000)):
                yield f"data: {json.dumps({'type': 'text', 'content': chunk}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return
        yield f"data: {json.dumps({'type': 'done'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── Include sub-routers ──────────────────────────────────────────────────────
from app.routers import projects_memory as _projects_memory
from app.routers import projects_files as _projects_files
from app.routers import projects_briefing as _projects_briefing

router.include_router(_projects_memory.router)
router.include_router(_projects_files.router)
router.include_router(_projects_briefing.router)

# ── Re-exports for test compatibility ────────────────────────────────────────
from app.config import UPLOADS_DIR  # noqa: F401
from app.services import scheduler as scheduler_service  # noqa: F401
from app.routers.projects_deps import _auto_summarize_file  # noqa: F401
from app.routers.projects_memory import list_project_memory_jobs  # noqa: F401
