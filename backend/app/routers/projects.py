"""Projects router — slim file with core CRUD endpoints.

Memory, files, and briefing endpoints live in sub-routers:
  - projects_memory.py
  - projects_files.py
  - projects_briefing.py
  - projects_tasks.py
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
from app.services.cache import clients_cache, projects_cache
from app.services.client_contexts import mark_client_memory_stale
from app.services.memory_operations import classify_memory_failure
from app.services.project_ai import (
    build_project_ai_suggest_messages,
    parse_project_ai_suggestions,
)
from app.services.project_contexts import (
    _default_project_memory,
    _get_existing_raw_memory,
    save_project_memory,
    stream_llm_text_chunks,
)
from app.services.project_core import (
    create_project_record,
    get_project_or_404,
    init_default_project_folders,
    list_projects_basic,
    lock_and_require_project_write,
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
from app.services.project_progress import (
    create_project_progress_update,
    list_project_progress_updates,
    serialize_progress_update,
)
from app.services.time_utils import utc_now_naive
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
from app.routers.chat_security import member_project_ids, require_project_access
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
    ProgressUpdateCreate,
    ProjectAISuggestQuery,
    ProjectAISuggestion,
    ProjectCreate,
    ProjectUpdate,
    TodoCreate,
    TodoUpdate,
)

logger = logging.getLogger(__name__)

_CLIENT_PROMOTION_KEY = "_client_promotion"


def _client_promotion_state(project: Project | None) -> dict:
    if project is None:
        return {}
    state = _get_existing_raw_memory(project).get(_CLIENT_PROMOTION_KEY)
    return dict(state) if isinstance(state, dict) else {}


def _client_promotion_completed(project: Project | None) -> bool:
    state = _client_promotion_state(project)
    explicit_status = str(state.get("status") or "").strip().lower()
    if explicit_status:
        return explicit_status in {"completed", "success", "succeeded"}
    # Backward compatibility for promotion receipts written before an
    # explicit status field was introduced.
    return bool(state.get("promoted_at"))


def _mark_linked_client_memory_stale(
    session: Session,
    *,
    client_id: int | None,
    trigger: str,
) -> None:
    if client_id is not None:
        mark_client_memory_stale(session, int(client_id), trigger=trigger)


def _should_auto_promote_archived_project(
    project: Project,
    *,
    previous_status: str | None,
) -> bool:
    if project.status != "archived":
        return False
    if previous_status != "archived":
        return True
    # Failed/pending legacy attempts must be retriable. A completed receipt is
    # the idempotency guard that prevents unrelated edits to an archived
    # project from repeatedly promoting the same memory.
    return not _client_promotion_completed(project)


def _record_client_promotion_failure(
    session: Session,
    project_id: int,
    error: Exception,
    *,
    actor_user_id: int,
) -> bool:
    session.rollback()
    current = session.get(Project, project_id)
    if current is None or _client_promotion_completed(current):
        return False
    try:
        project, _locked_actor = lock_and_require_project_write(
            session,
            project_id,
            actor_user_id=actor_user_id,
        )
    except HTTPException as exc:
        if exc.status_code in {401, 403, 404, 409}:
            session.rollback()
            return False
        raise
    # Serialize the failure receipt with the atomic promotion commit. A losing
    # concurrent attempt must observe a completed receipt written by the
    # winner instead of overwriting it with its own baseline-conflict failure.
    if _client_promotion_completed(project):
        session.rollback()
        return False

    memory = _get_existing_raw_memory(project)
    previous = _client_promotion_state(project)
    try:
        previous_attempts = max(0, int(previous.get("attempt_count", 0) or 0))
    except (TypeError, ValueError):
        previous_attempts = 0
    failed_at = utc_now_naive().isoformat()
    memory[_CLIENT_PROMOTION_KEY] = {
        **previous,
        "status": "failed",
        "attempt_count": previous_attempts + 1,
        "failed_at": failed_at,
        "last_attempt_at": failed_at,
        "message": str(error)[:400],
        "trigger": "project_archived_auto_promoted",
    }
    memory["_last_failure"] = {
        "category": classify_memory_failure("client_promotion", str(error)),
        "stage": "client_promotion",
        "message": str(error)[:400],
        "retry_count": previous_attempts,
        "failed_at": failed_at,
    }
    project.context_memory_json = json.dumps(memory, ensure_ascii=False)
    session.add(project)
    session.commit()
    return True


router = APIRouter(prefix="/projects", tags=["projects"])


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("")
def list_projects(
    status: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    # Membership filter: non-admins only see projects they belong to.
    # ``member_project_ids`` returns ``None`` for admins (no filter)
    # and the explicit list of ids otherwise.
    visible_ids = member_project_ids(session, current_user)
    if visible_ids is not None and not visible_ids:
        # Non-admin with zero memberships — short-circuit to avoid a
        # SQL join that would return everything if we forgot the
        # filter. Result is also not cacheable per-user.
        return []
    member_user_id = current_user.id if visible_ids is not None else None
    cache_key = f"list:{status or ''}:member:{member_user_id or ''}"
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached
    result = list_projects_basic(session, status=status, member_user_id=member_user_id)
    projects_cache.set(cache_key, result, _PROJECTS_TTL)
    return result


@router.post("", status_code=201)
def create_project(
    data: ProjectCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    project = create_project_record(
        session,
        data.model_dump(),
        actor_user_id=int(current_user.id),
    )
    # Seed initial memory so AI has basic context immediately (no waiting for async rebuild)
    seed_memory = _default_project_memory(project)
    save_project_memory(session, project.id, seed_memory, trigger="project_created")
    _mark_linked_client_memory_stale(
        session,
        client_id=project.client_id,
        trigger="project_created",
    )
    if scheduler_service.is_running():
        project.memory_rebuild_status = "queued"
        session.add(project)
        session.commit()
        session.refresh(project)
    _schedule_project_memory_rebuild(project.id, trigger="project_created")
    projects_cache.delete_prefix("list:")   # no detail key yet — project just created
    clients_cache.clear()
    return project


@router.get("/{project_id}")
def get_project(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    return get_project_or_404(session, project_id)


@router.get("/{project_id}/detail")
def get_project_detail(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Single-request combined endpoint: project + files + milestones + folders + financials.

    Reduces 4-5 round trips to Supabase down to 1 HTTP call with 5 fast local queries.
    """
    require_project_access(session, project_id, current_user)
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
    current_user: User = Depends(get_current_user),
):
    # Same membership filter as list_projects. Admins get the full
    # snapshot; everyone else only sees rows for projects they're a
    # member of.
    visible_ids = member_project_ids(session, current_user)
    if visible_ids is not None and not visible_ids:
        return []
    cache_key = (
        "list:dashboard-summary"
        if visible_ids is None
        else f"list:dashboard-summary:user:{current_user.id}"
    )
    cached = projects_cache.get(cache_key)
    if cached is not None:
        return cached

    stmt = select(
        Project.id,
        Project.name,
        Project.client,
        Project.client_id,
        Project.status,
        Project.contract_amount,
        Project.updated_at,
        Project.memory_stale,
        Project.memory_version,
    ).order_by(Project.updated_at.desc())
    if visible_ids is not None:
        stmt = stmt.where(Project.id.in_(visible_ids))
    rows = session.exec(stmt).all()

    result = [
        {
            "id": project_id,
            "name": name,
            "client": client,
            "client_id": client_id,
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
            client_id,
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
async def update_project(
    project_id: int,
    data: ProjectUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    changes = data.model_dump(exclude_none=True)
    if "client_id" in data.model_fields_set:
        # Field absence preserves the existing relationship; explicit NULL
        # detaches it. Runtime reads never infer a client from display text.
        changes["client_id"] = data.client_id
    project, previous_status, previous_client, previous_client_id = update_project_record(
        session,
        project_id,
        changes,
        actor_user_id=int(current_user.id),
    )
    updated_client = str(project.client or "")
    updated_client_id = project.client_id
    client_reassigned = (
        "client" in changes or "client_id" in changes
    ) and (
        previous_client_id != updated_client_id
        or (
            previous_client_id is None
            and updated_client_id is None
            and " ".join(str(previous_client or "").strip().lower().split())
            != " ".join(updated_client.strip().lower().split())
        )
    )
    trigger_parts: list[str] = []
    if "status" in changes:
        trigger_parts.append("project_status")
    if "contract_amount" in changes:
        trigger_parts.append("project_financial")
    if any(key not in {"status", "contract_amount"} for key in changes):
        trigger_parts.append("project_profile")
    if client_reassigned:
        trigger_parts.append("project_reassigned")
    stale_trigger = "_".join(trigger_parts or ["project_profile"]) + "_changed"
    _mark_project_memory_stale(session, project_id, trigger=stale_trigger)
    if client_reassigned:
        _mark_linked_client_memory_stale(
            session,
            client_id=previous_client_id,
            trigger="project_reassigned",
        )
        clients_cache.clear()
        _mark_linked_client_memory_stale(
            session,
            client_id=updated_client_id,
            trigger="project_reassigned",
        )
    session.expire_all()
    project = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if project is None:
        raise HTTPException(
            status_code=409,
            detail="Project was deleted during update; reload the project list.",
        )
    if _should_auto_promote_archived_project(
        project,
        previous_status=previous_status,
    ):
        try:
            promoted = await _auto_promote_archived_project_to_client_memory(
                session,
                project_id,
                actor=current_user,
                # The helper's transition guard remains useful for normal
                # archive operations. Failed/missing receipts on an already
                # archived project deliberately bypass it for retry.
                previous_status=None if previous_status == "archived" else previous_status,
            )
            if not promoted:
                session.expire_all()
                refreshed = session.get(Project, project_id)
                if not _client_promotion_completed(refreshed):
                    _record_client_promotion_failure(
                        session,
                        project_id,
                        RuntimeError(
                            "Auto-promotion could not run because no client record matched the project."
                        ),
                        actor_user_id=int(current_user.id),
                    )
        except HTTPException as exc:
            if exc.status_code in {401, 403}:
                # Authorization is a request outcome, not a provider failure.
                # Roll back the final lock transaction and never let a revoked
                # actor write even a failure receipt onto the project.
                session.rollback()
                raise
            _record_client_promotion_failure(
                session,
                project_id,
                exc,
                actor_user_id=int(current_user.id),
            )
            logger.exception("Failed to auto-promote archived project %s into client memory", project_id)
        except Exception as exc:
            _record_client_promotion_failure(
                session,
                project_id,
                exc,
                actor_user_id=int(current_user.id),
            )
            logger.exception("Failed to auto-promote archived project %s into client memory", project_id)
    _bust_project(project_id)
    session.expire_all()
    refreshed_project = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if refreshed_project is None:
        raise HTTPException(
            status_code=409,
            detail="Project was deleted while post-update actions were running.",
        )
    return refreshed_project


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    client_id, client_name = delete_project_cascade(
        session,
        project_id,
        actor_user_id=int(current_user.id),
    )
    _mark_linked_client_memory_stale(
        session,
        client_id=client_id,
        trigger="project_deleted",
    )
    _bust_project(project_id)
    clients_cache.clear()
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
def list_milestones(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    return list_project_milestones(session, project_id)


@router.post("/{project_id}/milestones", status_code=201)
def create_milestone(
    project_id: int,
    data: MilestoneCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    ms = create_project_milestone(
        session,
        project_id,
        title=data.title,
        priority=data.priority,
        due_date=data.due_date,
    )
    _mark_project_memory_stale(session, project_id, trigger="milestone_created")
    _bust_project(project_id)
    return _refresh_instance(session, ms)


@router.patch("/{project_id}/milestones/{ms_id}")
def update_milestone(
    project_id: int,
    ms_id: int,
    data: MilestoneUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    ms = update_project_milestone(session, project_id, ms_id, data.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id, trigger="milestone_updated")
    _bust_project(project_id)
    return _refresh_instance(session, ms)


@router.delete("/{project_id}/milestones/{ms_id}")
def delete_milestone(
    project_id: int,
    ms_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    delete_project_milestone(session, project_id, ms_id)
    _mark_project_memory_stale(session, project_id, trigger="milestone_deleted")
    _bust_project(project_id)
    return {"ok": True}


# ── Project Progress Updates ─────────────────────────────────────────────────

@router.get("/{project_id}/progress-updates")
def list_progress_updates(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    return [
        serialize_progress_update(update)
        for update in list_project_progress_updates(session, project_id)
    ]


@router.post("/{project_id}/progress-updates", status_code=201)
def create_progress_update(
    project_id: int,
    data: ProgressUpdateCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    content = data.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Progress content cannot be empty")
    update = create_project_progress_update(
        session,
        project_id,
        content=content,
        next_step=data.next_step.strip(),
        risk=data.risk.strip(),
        created_by_user_id=current_user.id,
    )
    _mark_project_memory_stale(session, project_id, trigger="progress_created")
    _bust_project(project_id)
    return serialize_progress_update(_refresh_instance(session, update))


# ── Financials ────────────────────────────────────────────────────────────────

@router.get("/{project_id}/financials")
def get_financials(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    return get_project_financials(session, project_id)


@router.post("/{project_id}/financials", status_code=201)
def add_payment(
    project_id: int,
    data: PaymentCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    payment = add_project_payment(
        session,
        project_id,
        amount=data.amount,
        payment_date=data.payment_date,
        note=data.note,
        payment_type=data.payment_type,
    )
    _mark_project_memory_stale(session, project_id, trigger="payment_created")
    _bust_project(project_id)
    return _refresh_instance(session, payment)


@router.delete("/{project_id}/financials/{payment_id}")
def delete_payment(
    project_id: int,
    payment_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    delete_project_payment(session, project_id, payment_id)
    _mark_project_memory_stale(session, project_id, trigger="payment_deleted")
    _bust_project(project_id)
    return {"ok": True}


# ── Project notes (沉淀到项目) ─────────────────────────────────────────────────

@router.post("/{project_id}/notes")
def save_project_note(
    project_id: int,
    body: NoteBody,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Append or overwrite project notes."""
    require_project_access(session, project_id, current_user, require_write=True)
    project = save_project_notes(session, project_id, body.content, append=body.append)
    _mark_project_memory_stale(session, project_id, trigger="project_notes_changed")
    _bust_project(project_id)
    return {"notes": project.notes}

# ── Project Todos ────────────────────────────────────────────────────────────


@router.get("/{project_id}/todos")
def list_todos(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    todos = list_project_todos(session, project_id)
    return [serialize_todo(todo) for todo in todos]


@router.post("/{project_id}/todos", status_code=201)
def create_todo(
    project_id: int,
    body: TodoCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    todo = create_project_todo(
        session,
        project_id,
        content=body.content,
        is_done=body.is_done,
        due_date=body.due_date,
        assigned_to_user_id=body.assigned_to_user_id,
    )
    _mark_project_memory_stale(session, project_id, trigger="todo_created")
    _bust_project(project_id)
    return serialize_todo(todo)


@router.patch("/{project_id}/todos/{todo_id}")
def update_todo(
    project_id: int,
    todo_id: int,
    body: TodoUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    todo = update_project_todo(session, project_id, todo_id, body.model_dump(exclude_none=True))
    _mark_project_memory_stale(session, project_id, trigger="todo_updated")
    _bust_project(project_id)
    return serialize_todo(todo)


@router.delete("/{project_id}/todos/{todo_id}")
def delete_todo(
    project_id: int,
    todo_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    delete_project_todo(session, project_id, todo_id)
    _mark_project_memory_stale(session, project_id, trigger="todo_deleted")
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
def list_members(
    project_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user)
    ensure_project_exists(session, project_id)
    members = list_project_members(session, project_id)
    return [
        MemberOut(**serialize_member(member))
        for member in members
        if member.user
    ]


@router.post("/{project_id}/members", status_code=201, response_model=MemberOut)
def add_member(
    project_id: int,
    body: MemberCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    # Only existing members can invite — prevents random users from
    # adding themselves to other people's projects.
    require_project_access(session, project_id, current_user, require_write=True)
    ensure_project_exists(session, project_id)
    member, user = add_project_member(session, project_id, body.user_id, role=body.role)
    _bust_project(project_id)
    return MemberOut(
        id=member.id,
        project_id=member.project_id,
        user_id=member.user_id,
        role=member.role or "editor",
        user=MemberUserOut(id=user.id, display_name=user.display_name),
        created_at=member.created_at,
    )


@router.delete("/{project_id}/members/{user_id}")
def remove_member(
    project_id: int,
    user_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_project_access(session, project_id, current_user, require_write=True)
    remove_project_member(session, project_id, user_id)
    _bust_project(project_id)
    return {"ok": True}


# ── AI Polish for Project Notes ──────────────────────────────────────────────

@router.post("/{project_id}/notes/ai-polish")
async def ai_polish_project_notes(
    project_id: int,
    body: NotePolishBody,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Use the active LLM to polish a rough draft into structured Markdown project notes."""
    require_project_access(session, project_id, current_user, require_write=True)
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    messages = build_project_note_polish_messages(project, body.draft)
    result = await complete_with_selected_model(messages, max_tokens=4000)
    return {"result": result}


@router.post("/{project_id}/notes/ai-polish-stream")
async def ai_polish_project_notes_stream(
    project_id: int,
    body: NotePolishBody,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Stream the active LLM polishing a rough draft into structured Markdown project notes."""
    require_project_access(session, project_id, current_user, require_write=True)
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
from app.routers import projects_tasks as _projects_tasks
from app.routers import projects_questions as _projects_questions

router.include_router(_projects_memory.router)
router.include_router(_projects_files.router)
router.include_router(_projects_briefing.router)
router.include_router(_projects_tasks.router)
router.include_router(_projects_questions.router)

# ── Re-exports for test compatibility ────────────────────────────────────────
from app.config import UPLOADS_DIR  # noqa: F401
from app.services import scheduler as scheduler_service  # noqa: F401
from app.routers.projects_deps import _auto_summarize_file  # noqa: F401
from app.routers.projects_memory import list_project_memory_jobs  # noqa: F401
