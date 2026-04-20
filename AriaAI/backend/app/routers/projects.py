"""Projects router — CRUD for projects, milestones, file uploads."""
from __future__ import annotations

import asyncio
import logging
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Form, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

import json
from app.config import (
    MEMORY_REBUILD_DEBOUNCE_SECONDS,
    MEMORY_SUMMARY_WARM_DAILY_LIMIT,
    MEMORY_SUMMARY_WARM_INTERVAL_SECONDS,
    MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS,
    PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS,
    PROJECT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS,
    UPLOADS_DIR,
)
from app.database import engine, get_session
from app.models.db import Conversation, Message, Project, Milestone, ProjectFile, ProjectFolder, ProjectPayment, ProjectTodo, ProjectMember, ProjectMemorySummary, User, ClientRecord
from app.services import claude as _claude_svc, openai_compat as _kimi_svc
from app.services import scheduler as scheduler_service
from app.models.db import Setting as _Setting
from app.services.cache import clients_cache, projects_cache
from app.services.client_contexts import (
    build_client_memory_promote_prompt,
    get_client_memory_payload,
    mark_client_memory_stale_by_name,
    parse_client_memory,
    save_client_memory,
)
from app.services.chat_exports import build_markdown_export_content
from app.services.document_text import extract_text_from_file
from app.services.project_ai import (
    build_project_ai_suggest_messages,
    parse_project_ai_suggestions,
    summarize_uploaded_project_file,
)
from app.services.project_core import (
    create_project_record,
    get_project_or_404,
    init_default_project_folders,
    list_projects_basic,
    update_project_record,
)
from app.services.project_contexts import (
    EDITABLE_MEMORY_SLOTS,
    _get_existing_raw_memory,
    _normalize_editable_slot,
    build_project_context_data,
    build_project_context_prompt,
    build_project_memory_data,
    build_project_memory_prompt,
    build_project_memory_view_prompt,
    build_project_summary_from_memory_prompt,
    get_project_memory_summary_cache,
    get_project_memory_payload,
    mark_project_memory_stale,
    normalize_summary_language,
    parse_project_memory,
    save_project_memory,
    save_project_context_summary,
    save_project_memory_summary_cache,
    stream_llm_text_chunks,
)
from app.services.project_deletion import delete_project_cascade
from app.services.project_details import build_project_detail
from app.services.project_documents import (
    build_markdown_export_header,
    build_timestamped_markdown_filename,
    create_markdown_project_file,
    create_project_document_record,
    get_project_document_file_or_404,
    get_project_document_payload,
    ensure_markdown_filename,
    init_presales_template_documents,
    resolve_project_folder,
    update_project_document_record,
    write_project_markdown_file,
)
from app.services.project_financials import (
    add_project_payment,
    delete_project_payment,
    get_project_financials,
    list_project_payments,
    serialize_financials,
)
from app.services.project_files import (
    create_project_upload,
    delete_project_file,
    get_project_file_or_404 as get_uploaded_project_file_or_404,
    list_project_files,
    resolve_project_file_path,
)
from app.services.project_folders import (
    create_project_folder,
    delete_project_folder,
    list_project_folders,
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
from app.services.project_llm import complete_with_selected_model, stream_with_selected_model
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

_PROJECTS_TTL = 120.0
_CLIENTS_KEY = "all"
logger = logging.getLogger(__name__)


def _bust_project(project_id: int) -> None:
    """Invalidate all caches that reference this project."""
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")


def _memory_rebuild_job_id(project_id: int) -> str:
    return f"project_memory_rebuild_{project_id}"


def _memory_summary_warm_job_id(project_id: int, language: str | None = None) -> str:
    normalized_language = normalize_summary_language(language)
    return f"project_memory_summary_warm_{project_id}_{normalized_language}"


def _normalize_name(value: str | None) -> str:
    return (value or "").strip().lower()


def _find_client_record_by_name(session: Session, client_name: str | None) -> ClientRecord | None:
    normalized = _normalize_name(client_name)
    if not normalized:
        return None

    exact = session.exec(select(ClientRecord).where(ClientRecord.name == client_name)).first()
    if exact is not None:
        return exact

    return next(
        (
            client
            for client in session.exec(select(ClientRecord)).all()
            if _normalize_name(client.name) == normalized
        ),
        None,
    )


async def _auto_promote_archived_project_to_client_memory(
    session: Session,
    project_id: int,
    *,
    previous_status: str | None,
) -> bool:
    project = session.get(Project, project_id)
    if not project or previous_status == "archived" or project.status != "archived":
        return False

    client = _find_client_record_by_name(session, project.client)
    if client is None:
        return False

    project_memory = get_project_memory_payload(project)
    if (project.memory_version or 0) == 0 or project.memory_stale:
        project_data = build_project_memory_data(session, project_id)
        raw_project_memory = await complete_with_selected_model(
            messages=[{"role": "user", "content": build_project_memory_prompt(project_data)}],
            max_tokens=2200,
        )
        parsed_project_memory = parse_project_memory(raw_project_memory, project)
        project_memory = save_project_memory(
            session,
            project_id,
            parsed_project_memory,
            trigger="archive_promotion_prepare",
        )
        project = session.get(Project, project_id) or project

    raw_client_memory = await complete_with_selected_model(
        messages=[
            {
                "role": "user",
                "content": build_client_memory_promote_prompt(
                    get_client_memory_payload(client),
                    project.name,
                    project_memory,
                ),
            }
        ],
        max_tokens=2200,
    )
    parsed_client_memory = parse_client_memory(raw_client_memory, client)
    save_client_memory(
        session,
        client.id,
        parsed_client_memory,
        trigger="project_archived_auto_promoted",
        source_project_ids=[project.id],
    )
    project = session.get(Project, project_id)
    if project:
        raw_project_memory = _get_existing_raw_memory(project)
        raw_project_memory["_client_promotion"] = {
            "client_id": client.id,
            "client_name": client.name,
            "promoted_at": datetime.utcnow().isoformat(),
            "trigger": "project_archived_auto_promoted",
        }
        project.context_memory_json = json.dumps(raw_project_memory, ensure_ascii=False)
        project.updated_at = datetime.utcnow()
        session.add(project)
        session.commit()
    clients_cache.delete(_CLIENTS_KEY)
    return True


def _parse_project_memory_job(job) -> dict | None:
    if not job or not getattr(job, "id", None):
        return None
    metadata = scheduler_service.get_job_metadata(job.id)

    if job.id.startswith("project_memory_rebuild_"):
        try:
            project_id = int(job.id.removeprefix("project_memory_rebuild_"))
        except ValueError:
            return None
        return {
            "project_id": project_id,
            "job_type": "rebuild",
            "language": None,
            "job_id": job.id,
            "next_run_at": job.next_run_time.isoformat() if getattr(job, "next_run_time", None) else None,
            "retry_count": int(metadata.get("retry_count", 0) or 0),
            "max_retries": int(metadata.get("max_retries", PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS) or 0),
            "trigger": metadata.get("trigger"),
            "summary_types": [],
        }

    if job.id.startswith("project_memory_summary_warm_"):
        raw = job.id.removeprefix("project_memory_summary_warm_")
        project_id_raw, _, language = raw.partition("_")
        try:
            project_id = int(project_id_raw)
        except ValueError:
            return None
        return {
            "project_id": project_id,
            "job_type": "summary_warm",
            "language": language or None,
            "job_id": job.id,
            "next_run_at": job.next_run_time.isoformat() if getattr(job, "next_run_time", None) else None,
            "retry_count": int(metadata.get("retry_count", 0) or 0),
            "max_retries": int(metadata.get("max_retries", MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS) or 0),
            "trigger": metadata.get("trigger"),
            "summary_types": list(metadata.get("summary_types", []) or []),
        }

    return None


def _is_retryable_summary_warm_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "429" in message or "rate limit" in message or "timeout" in message


def _is_retryable_project_memory_rebuild_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "429" in message
        or "rate limit" in message
        or "timeout" in message
        or "temporarily unavailable" in message
    )


def _classify_memory_failure(stage: str, message: str) -> str:
    text = f"{stage} {message}".lower()
    if "budget" in text or "daily limit" in text or "quota" in text:
        return "budget"
    if "429" in text or "rate limit" in text or "too many requests" in text:
        return "rate_limit"
    if "timeout" in text or "timed out" in text:
        return "timeout"
    if "database" in text or "sql" in text or "psycopg" in text or "sqlite" in text:
        return "database"
    if "not found" in text or "no project" in text or "empty" in text:
        return "data"
    if "scheduler" in text or "job" in text or "queue" in text:
        return "scheduler"
    if "model" in text or "llm" in text or "claude" in text or "kimi" in text or "deepseek" in text:
        return "llm"
    return "unknown"


def _count_summary_warm_budget_used_today(session: Session) -> int:
    start_of_day = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    warmed = session.exec(
        select(ProjectMemorySummary).where(ProjectMemorySummary.created_at >= start_of_day)
    ).all()
    return len(warmed)


def _get_raw_project_memory(project: Project) -> dict:
    return _get_existing_raw_memory(project)


def _set_project_memory_failure(
    session: Session,
    project: Project,
    *,
    stage: str,
    message: str,
    retry_count: int = 0,
) -> None:
    memory = _get_raw_project_memory(project)
    memory["_last_failure"] = {
        "category": _classify_memory_failure(stage, message),
        "stage": stage,
        "message": message[:400],
        "retry_count": retry_count,
        "failed_at": datetime.utcnow().isoformat(),
    }
    project.context_memory_json = json.dumps(memory, ensure_ascii=False)
    session.add(project)
    session.commit()


def _get_project_memory_failure(project: Project) -> dict | None:
    failure = _get_raw_project_memory(project).get("_last_failure")
    return failure if isinstance(failure, dict) else None


async def _generate_memory_summary_cache(
    session: Session,
    project: Project,
    memory_payload: dict,
    summary_type: str,
    language: str | None = None,
) -> None:
    prompt = build_project_memory_view_prompt(
        memory_payload,
        project.name,
        summary_type,
        language,
    )
    content = await complete_with_selected_model(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1400,
    )
    save_project_memory_summary_cache(
        session,
        project_id=project.id,
        summary_type=summary_type,
        language=language,
        memory_version=int(memory_payload.get("memory_version", 0) or 0),
        content=content.strip(),
    )


async def _warm_project_memory_summary_caches(
    session: Session,
    project: Project,
    memory_payload: dict,
    summary_types: list[str] | None = None,
    language: str | None = None,
    force_refresh: bool = False,
) -> list[str]:
    requested_types = summary_types or ["overview", "risk", "stakeholder"]
    normalized_language = normalize_summary_language(language)
    memory_version = int(memory_payload.get("memory_version", 0) or 0)
    warmed: list[str] = []

    for summary_type in requested_types:
        if summary_type not in {
            "overview",
            "risk",
            "stakeholder",
            "delivery",
            "client-facing",
            "financial",
            "documents",
        }:
            continue

        if not force_refresh and memory_version > 0:
            cached = get_project_memory_summary_cache(
                session,
                project_id=project.id,
                summary_type=summary_type,
                language=normalized_language,
                memory_version=memory_version,
            )
            if cached:
                warmed.append(summary_type)
                continue

        await _generate_memory_summary_cache(
            session,
            project,
            memory_payload,
            summary_type,
            language=normalized_language,
        )
        warmed.append(summary_type)

    return warmed


async def _run_project_memory_summary_warm_job(
    project_id: int,
    language: str | None = None,
    summary_types: list[str] | None = None,
    force_refresh: bool = False,
    trigger: str = "background",
) -> None:
    del trigger
    with Session(engine) as session:
        project = get_project_or_404(session, project_id)
        memory_payload = get_project_memory_payload(project)
        if int(memory_payload.get("memory_version", 0) or 0) <= 0 or project.memory_stale:
            return

        for attempt in range(MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS):
            try:
                await _warm_project_memory_summary_caches(
                    session,
                    project,
                    memory_payload,
                    summary_types=summary_types,
                    language=language,
                    force_refresh=force_refresh,
                )
                return
            except Exception as exc:
                if attempt >= MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS - 1 or not _is_retryable_summary_warm_error(exc):
                    _set_project_memory_failure(
                        session,
                        project,
                        stage="summary_warm",
                        message=str(exc),
                        retry_count=attempt,
                    )
                    raise
                wait_seconds = MEMORY_SUMMARY_WARM_INTERVAL_SECONDS * (2 ** attempt)
                await asyncio.sleep(wait_seconds)


def _schedule_project_memory_summary_warm(
    project_id: int,
    language: str | None = None,
    summary_types: list[str] | None = None,
    force_refresh: bool = False,
    delay_seconds: int = 0,
    trigger: str = "background",
) -> bool:
    if not scheduler_service.is_running():
        return False

    job_id = _memory_summary_warm_job_id(project_id, language)
    run_at = datetime.utcnow() + timedelta(seconds=max(0, delay_seconds))
    scheduler_service.add_or_replace_date_job(
        job_id,
        run_at,
        _run_project_memory_summary_warm_job,
        args=[project_id, language, summary_types or ["overview", "risk", "stakeholder"], force_refresh, trigger],
        metadata={
            "trigger": trigger,
            "summary_types": summary_types or ["overview", "risk", "stakeholder"],
            "retry_count": 0,
            "max_retries": MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS,
        },
    )
    return True


async def _run_project_memory_rebuild_job(project_id: int, trigger: str = "debounced") -> None:
    with Session(engine) as session:
        project = get_project_or_404(session, project_id)
        project.memory_rebuild_status = "rebuilding"
        project.memory_rebuild_failed_at = None
        session.add(project)
        session.commit()

        try:
            memory_payload = await _rebuild_project_memory(
                session,
                project_id,
                project=project,
                trigger=trigger,
            )
            _schedule_project_memory_summary_warm(
                project_id,
                summary_types=["overview", "risk", "stakeholder"],
                trigger="rebuild_completed",
            )
            _bust_project(project_id)
        except Exception as exc:
            project = get_project_or_404(session, project_id)
            retry_count = 0
            if trigger.startswith("retry:"):
                try:
                    retry_count = int(trigger.split(":", 1)[1])
                except ValueError:
                    retry_count = 0

            if (
                _is_retryable_project_memory_rebuild_error(exc)
                and retry_count < PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS - 1
                and scheduler_service.is_running()
            ):
                delay_seconds = PROJECT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS * (2 ** retry_count)
                scheduler_service.add_or_replace_date_job(
                    _memory_rebuild_job_id(project_id),
                    datetime.utcnow() + timedelta(seconds=delay_seconds),
                    _run_project_memory_rebuild_job,
                    args=[project_id, f"retry:{retry_count + 1}"],
                    metadata={
                        "trigger": trigger,
                        "retry_count": retry_count + 1,
                        "max_retries": PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS,
                    },
                )
                project.memory_rebuild_status = "queued"
                project.memory_rebuild_failed_at = None
                session.add(project)
                session.commit()
                return

            _set_project_memory_failure(
                session,
                project,
                stage="rebuild",
                message=str(exc),
                retry_count=retry_count,
            )
            project.memory_rebuild_status = "failed"
            project.memory_rebuild_failed_at = datetime.utcnow()
            session.add(project)
            session.commit()
            raise


def _schedule_project_memory_rebuild(project_id: int, trigger: str = "data_changed") -> None:
    if not scheduler_service.is_running():
        return
    run_at = datetime.utcnow() + timedelta(seconds=MEMORY_REBUILD_DEBOUNCE_SECONDS)
    scheduler_service.add_or_replace_date_job(
        _memory_rebuild_job_id(project_id),
        run_at,
        _run_project_memory_rebuild_job,
        args=[project_id, trigger],
        metadata={
            "trigger": trigger,
            "retry_count": 0,
            "max_retries": PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS,
        },
    )


def _mark_project_memory_stale(session: Session, project_id: int, trigger: str = "data_changed") -> None:
    mark_project_memory_stale(session, project_id, trigger=trigger)
    project = session.get(Project, project_id)
    if project:
        mark_client_memory_stale_by_name(session, project.client, trigger="project_changed")
    _schedule_project_memory_rebuild(project_id, trigger=trigger)
    if project and project.memory_rebuild_status != "rebuilding":
        project.memory_rebuild_status = "queued" if scheduler_service.is_running() else "idle"
        session.add(project)
        session.commit()


def _refresh_instance(session: Session, instance):
    if instance is not None and hasattr(instance, "__sqlmodel_relationships__"):
        session.refresh(instance)
    return instance


async def _rebuild_project_memory(
    session: Session,
    project_id: int,
    project: Optional[Project] = None,
    trigger: str = "manual",
) -> dict:
    project = project or get_project_or_404(session, project_id)
    _, project_memory_data, coverage = build_project_memory_data(session, project_id)
    raw_memory = await complete_with_selected_model(
        messages=[{"role": "user", "content": build_project_memory_prompt(project_memory_data)}],
        max_tokens=2200,
    )
    parsed_memory = parse_project_memory(raw_memory, project)
    return save_project_memory(session, project_id, parsed_memory, trigger=trigger, coverage=coverage)


async def _ensure_project_memory(
    session: Session,
    project_id: int,
    project: Optional[Project] = None,
) -> tuple[Project, dict]:
    project = project or get_project_or_404(session, project_id)
    memory_payload = get_project_memory_payload(project)
    if project.memory_stale or project.memory_version == 0:
        memory_payload = await _rebuild_project_memory(session, project_id, project, trigger="on_demand")
        project = get_project_or_404(session, project_id)
    return project, memory_payload


# Shared file text extraction


def _extract_file_text(path: Path, file_type: str, max_chars: int = 4000) -> str:
    return extract_text_from_file(path, file_type, max_chars=max_chars)

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Schemas ──────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    client: str
    description: str = ""
    status: str = "lead"
    contract_amount: float = 0.0
    notes: str = ""
    md_notes: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    client: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    context_freshness: Optional[float] = None
    contract_amount: Optional[float] = None
    context_summary: Optional[str] = None
    notes: Optional[str] = None
    md_notes: Optional[str] = None


class TodoCreate(BaseModel):
    content: str
    is_done: bool = False
    due_date: Optional[str] = None
    assigned_to_user_id: Optional[int] = None


class TodoUpdate(BaseModel):
    content: Optional[str] = None
    is_done: Optional[bool] = None
    due_date: Optional[str] = None
    assigned_to_user_id: Optional[int] = None


class NoteBody(BaseModel):
    content: str
    append: bool = True   # True = append to existing notes; False = overwrite


class NotePolishBody(BaseModel):
    draft: str


class MemberCreate(BaseModel):
    user_id: int


class MemberUserOut(BaseModel):
    id: int
    display_name: str


class MemberOut(BaseModel):
    id: int
    project_id: int
    user_id: int
    user: MemberUserOut
    created_at: datetime


class PaymentCreate(BaseModel):
    amount: float
    payment_date: str               # YYYY-MM-DD
    note: str = ""
    payment_type: str = "received"  # received | expense | milestone_payment


class MilestoneCreate(BaseModel):
    title: str
    priority: str = "medium"
    due_date: Optional[str] = None


class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    is_done: Optional[bool] = None
    priority: Optional[str] = None
    due_date: Optional[str] = None


class FolderCreate(BaseModel):
    name: str
    sort_order: int = 0


class SaveConversationMarkdownRequest(BaseModel):
    action: str = "new"  # merge | new
    folder_id: Optional[int] = None
    file_id: Optional[int] = None
    file_name: Optional[str] = None


class SaveMessageToDocumentRequest(BaseModel):
    action: str  # merge | new
    file_id: Optional[int] = None
    file_name: Optional[str] = None
    folder_id: Optional[int] = None
    prepend_header: bool = True


class ProjectDocumentCreate(BaseModel):
    folder_id: Optional[int] = None
    name: str
    content: str = ""


class ProjectDocumentUpdate(BaseModel):
    content: Optional[str] = None
    name: Optional[str] = None
    folder_id: Optional[int] = None


class InitPresalesTemplateRequest(BaseModel):
    overwrite: bool = False


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


# ── Files ─────────────────────────────────────────────────────────────────────

@router.get("/{project_id}/files")
def list_files(project_id: int, session: Session = Depends(get_session)):
    return list_project_files(session, project_id)


@router.post("/{project_id}/notes/templates/presales", status_code=201)
def init_presales_notes_template(
    project_id: int,
    body: InitPresalesTemplateRequest,
    session: Session = Depends(get_session),
):
    result = init_presales_template_documents(
        session,
        project_id,
        uploads_dir=UPLOADS_DIR,
        overwrite=body.overwrite,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return result


@router.post("/{project_id}/documents", status_code=201)
def create_project_document(
    project_id: int,
    data: ProjectDocumentCreate,
    session: Session = Depends(get_session),
):
    project_file = create_project_document_record(
        session=session,
        project_id=project_id,
        folder_id=data.folder_id,
        name=data.name,
        content=data.content,
        uploads_dir=UPLOADS_DIR,
        init_default_folders=init_default_project_folders,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, project_file)


@router.get("/{project_id}/documents/{file_id}")
def get_project_document(project_id: int, file_id: int, session: Session = Depends(get_session)):
    return get_project_document_payload(session, project_id, file_id, uploads_dir=UPLOADS_DIR)


@router.patch("/{project_id}/documents/{file_id}")
def update_project_document(
    project_id: int,
    file_id: int,
    data: ProjectDocumentUpdate,
    session: Session = Depends(get_session),
):
    result = update_project_document_record(
        session,
        project_id,
        file_id,
        uploads_dir=UPLOADS_DIR,
        init_default_folders=init_default_project_folders,
        content=data.content,
        name=data.name,
        folder_id=data.folder_id,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, result)


@router.post("/{project_id}/conversations/{conv_id}/save-markdown", status_code=201)
def save_conversation_markdown(
    project_id: int,
    conv_id: int,
    data: SaveConversationMarkdownRequest,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    conv = session.get(Conversation, conv_id)
    if not conv or conv.project_id != project_id:
        raise HTTPException(404, "Conversation not found")

    messages = session.exec(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at)
    ).all()
    if not messages:
        raise HTTPException(400, "Conversation has no messages")

    markdown_content = build_markdown_export_content(conv, messages)

    if data.action == "merge":
        if not data.file_id:
            raise HTTPException(400, "file_id is required for merge action")
        project_file = get_project_document_file_or_404(session, project_id, data.file_id)
        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents can be merged")

        full_path = UPLOADS_DIR / project_file.path
        if not full_path.exists():
            raise HTTPException(404, "File not found on disk")

        project_file.size_bytes = write_project_markdown_file(
            project_file,
            build_markdown_export_header() + markdown_content,
            uploads_dir=UPLOADS_DIR,
            append=True,
        )
        session.add(project_file)
        session.commit()
        session.refresh(project_file)
        _mark_project_memory_stale(session, project_id)
        _bust_project(project_id)
        return {
            "ok": True,
            "action": "merge",
            "id": project_file.id,
            "name": project_file.name,
            "folder_id": project_file.folder_id,
            "size_bytes": project_file.size_bytes,
        }

    # action == "new"
    target_folder = (
        resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_project_folders,
            preferred_folder_id=data.folder_id,
        )
        if data.folder_id is not None
        else None
    )
    filename = build_timestamped_markdown_filename(data.file_name or conv.title or "conversation")

    new_file = create_markdown_project_file(
        session=session,
        project_id=project_id,
        folder_id=target_folder.id if target_folder else None,
        name=filename,
        content=markdown_content,
        uploads_dir=UPLOADS_DIR,
        summary=f"Saved from conversation: {conv.title or 'Untitled Conversation'}",
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {
        "ok": True,
        "action": "new",
        "id": new_file.id,
        "name": new_file.name,
        "folder_id": new_file.folder_id,
        "size_bytes": new_file.size_bytes,
    }


@router.post("/{project_id}/messages/{message_id}/save-to-document", status_code=201)
def save_message_to_document(
    project_id: int,
    message_id: int,
    data: SaveMessageToDocumentRequest,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(404, "Message not found")

    conv = session.get(Conversation, message.conversation_id)
    if not conv or conv.project_id != project_id:
        raise HTTPException(404, "Message does not belong to this project")

    content_block = build_markdown_export_header() + message.content if data.prepend_header else message.content

    if data.action == "merge":
        if not data.file_id:
            raise HTTPException(400, "file_id is required for merge action")
        project_file = get_project_document_file_or_404(session, project_id, data.file_id)
        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents can be merged")

        full_path = UPLOADS_DIR / project_file.path
        if not full_path.exists():
            raise HTTPException(404, "File not found on disk")

        project_file.size_bytes = write_project_markdown_file(
            project_file,
            content_block,
            uploads_dir=UPLOADS_DIR,
            append=True,
        )
        session.add(project_file)
        session.commit()
        session.refresh(project_file)
        _mark_project_memory_stale(session, project_id)
        _bust_project(project_id)
        return {
            "ok": True,
            "action": "merge",
            "id": project_file.id,
            "name": project_file.name,
            "size_bytes": project_file.size_bytes,
        }

    # action == "new"
    target_folder = (
        resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_project_folders,
            preferred_folder_id=data.folder_id,
        )
        if data.folder_id is not None
        else None
    )
    base_name = ensure_markdown_filename(
        data.file_name or f"message_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    )

    new_file = create_markdown_project_file(
        session=session,
        project_id=project_id,
        folder_id=target_folder.id if target_folder else None,
        name=base_name,
        content=message.content,
        uploads_dir=UPLOADS_DIR,
        summary=f"Saved from conversation: {conv.title or 'Untitled Conversation'}",
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {
        "ok": True,
        "action": "new",
        "id": new_file.id,
        "name": new_file.name,
        "folder_id": new_file.folder_id,
        "size_bytes": new_file.size_bytes,
    }


@router.post("/{project_id}/files", status_code=201)
async def upload_file(
    project_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    folder_id: Optional[int] = Form(None),
    session: Session = Depends(get_session),
):
    pf, dest_file, file_type = create_project_upload(
        session,
        project_id,
        upload=file,
        uploads_dir=UPLOADS_DIR,
        folder_id=folder_id,
    )

    # Auto-generate file summary in the background
    background_tasks.add_task(_auto_summarize_file, pf.id, str(dest_file), file_type)

    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, pf)


@router.delete("/{project_id}/files/{file_id}")
def delete_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    delete_project_file(session, project_id, file_id, uploads_dir=UPLOADS_DIR)
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return {"ok": True}


@router.get("/{project_id}/files/{file_id}/download")
def download_file(project_id: int, file_id: int, session: Session = Depends(get_session)):
    """Download a project file."""
    from fastapi.responses import FileResponse

    pf = get_uploaded_project_file_or_404(session, project_id, file_id)
    full_path = resolve_project_file_path(pf, UPLOADS_DIR)

    return FileResponse(
        path=str(full_path),
        filename=pf.name,
        media_type="application/octet-stream"
    )


# ── Folders ───────────────────────────────────────────────────────────────────

@router.get("/{project_id}/folders")
def list_folders(project_id: int, session: Session = Depends(get_session)):
    return list_project_folders(session, project_id, init_default_folders=init_default_project_folders)


@router.post("/{project_id}/folders", status_code=201)
def create_folder(project_id: int, data: FolderCreate, session: Session = Depends(get_session)):
    folder = create_project_folder(
        session,
        project_id,
        name=data.name,
        sort_order=data.sort_order,
    )
    _mark_project_memory_stale(session, project_id)
    _bust_project(project_id)
    return _refresh_instance(session, folder)


@router.delete("/{project_id}/folders/{folder_id}")
def delete_folder(project_id: int, folder_id: int, session: Session = Depends(get_session)):
    delete_project_folder(session, project_id, folder_id)
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


# ── AI Suggest ────────────────────────────────────────────────────────────────

class ProjectAISuggestQuery(BaseModel):
    query: str             # rough idea the user typed
    client_name: str = ""
    client_industry: str = ""


class ProjectAISuggestion(BaseModel):
    name: str
    description: str


class ProjectMemorySummarizeRequest(BaseModel):
    summary_type: str = "overview"
    rebuild_if_stale: bool = True
    stream: bool = False
    language: Optional[str] = None
    force_refresh: bool = False


class ProjectMemorySlotUpdateRequest(BaseModel):
    pinned: list[str] = []


class ProjectMemoryBatchRebuildRequest(BaseModel):
    project_ids: list[int] = []
    stale_only: bool = False


class ProjectMemoryBatchWarmSummariesRequest(BaseModel):
    project_ids: list[int] = []
    summary_types: list[str] = ["overview", "risk", "stakeholder"]
    language: Optional[str] = None
    force_refresh: bool = False


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


# ── Background: auto-summarize uploaded file ──────────────────────────────────

async def _auto_summarize_file(file_id: int, file_path: str, file_type: str) -> None:
    """Generate a 2-3 sentence summary for an uploaded project file and persist it."""
    from app.database import engine
    from sqlmodel import Session as _Session

    await summarize_uploaded_project_file(
        file_id,
        file_path=file_path,
        file_type=file_type,
        extract_file_text=_extract_file_text,
        complete=lambda messages, max_tokens: complete_with_selected_model(messages, max_tokens=max_tokens),
        session_factory=lambda: _Session(engine),
    )


# ── Generate project context summary ──────────────────────────────────────────

class ProjectContextGenerateRequest(BaseModel):
    language: Optional[str] = None


@router.post("/{project_id}/generate-context")
async def generate_project_context(
    project_id: int,
    body: Optional[ProjectContextGenerateRequest] = None,
    session: Session = Depends(get_session),
):
    """Generate overview summary from structured project memory, rebuilding memory when stale."""
    project, memory_payload = await _ensure_project_memory(session, project_id)

    messages = [
        {
            "role": "user",
            "content": build_project_summary_from_memory_prompt(
                memory_payload,
                project.name,
                body.language if body else None,
            ),
        }
    ]

    async def event_stream():
        accumulated: list[str] = []
        try:
            async for chunk in stream_llm_text_chunks(stream_with_selected_model(messages, max_tokens=1400)):
                accumulated.append(chunk)
                yield f"data: {json.dumps({'type': 'text', 'content': chunk}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        summary = "".join(accumulated).strip()

        # Save to DB with a fresh session
        from app.database import engine as _engine
        from sqlmodel import Session as _S
        with _S(_engine) as write_session:
            save_project_context_summary(write_session, project_id, summary)
            _bust_project(project_id)

        yield f"data: {json.dumps({'type': 'done', 'context_summary': summary}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/{project_id}/memory")
def get_project_memory(project_id: int, session: Session = Depends(get_session)):
    project = get_project_or_404(session, project_id)
    return {
        "project_id": project_id,
        "memory": get_project_memory_payload(project),
        "memory_version": project.memory_version,
        "memory_stale": project.memory_stale,
        "memory_updated_at": project.memory_updated_at,
        "memory_rebuild_status": project.memory_rebuild_status,
        "memory_rebuild_failed_at": project.memory_rebuild_failed_at,
    }


@router.get("/{project_id}/memory/status")
def get_project_memory_status(project_id: int, session: Session = Depends(get_session)):
    project = get_project_or_404(session, project_id)
    return {
        "project_id": project_id,
        "has_memory": (project.memory_version or 0) > 0,
        "memory_version": project.memory_version,
        "memory_stale": project.memory_stale,
        "memory_updated_at": project.memory_updated_at,
        "memory_rebuild_status": project.memory_rebuild_status,
        "memory_rebuild_failed_at": project.memory_rebuild_failed_at,
    }


@router.patch("/{project_id}/memory/slots/{slot_name}")
async def update_project_memory_slot(
    project_id: int,
    slot_name: str,
    body: ProjectMemorySlotUpdateRequest,
    session: Session = Depends(get_session),
):
    if slot_name not in EDITABLE_MEMORY_SLOTS:
        raise HTTPException(status_code=400, detail="Unsupported memory slot")

    project, _ = await _ensure_project_memory(session, project_id)
    raw_memory = _get_existing_raw_memory(project)
    coverage = raw_memory.get("_coverage", {}) if isinstance(raw_memory.get("_coverage"), dict) else {}
    raw_memory[slot_name] = _normalize_editable_slot(raw_memory.get(slot_name), pinned=body.pinned)
    saved_memory = save_project_memory(
        session,
        project_id,
        raw_memory,
        trigger=f"slot_update:{slot_name}",
        coverage=coverage,
    )
    _schedule_project_memory_summary_warm(
        project_id,
        summary_types=["overview", "risk", "stakeholder"],
        force_refresh=True,
        trigger=f"slot_update:{slot_name}",
    )
    _bust_project(project_id)
    refreshed_project = get_project_or_404(session, project_id)
    return {
        "ok": True,
        "project_id": project_id,
        "slot_name": slot_name,
        "memory": saved_memory,
        "memory_version": refreshed_project.memory_version,
        "memory_stale": refreshed_project.memory_stale,
        "memory_updated_at": refreshed_project.memory_updated_at.isoformat() if refreshed_project.memory_updated_at else None,
        "memory_rebuild_status": refreshed_project.memory_rebuild_status,
        "memory_rebuild_failed_at": refreshed_project.memory_rebuild_failed_at.isoformat()
        if refreshed_project.memory_rebuild_failed_at
        else None,
    }


@router.post("/memory/rebuild-batch")
async def rebuild_project_memory_batch(
    body: ProjectMemoryBatchRebuildRequest,
    session: Session = Depends(get_session),
):
    requested_ids = [int(project_id) for project_id in body.project_ids if int(project_id) > 0]
    if requested_ids:
        candidate_projects = session.exec(
            select(Project).where(Project.id.in_(requested_ids))
        ).all()
        project_lookup = {project.id: project for project in candidate_projects}
        projects_to_process = [project_lookup[project_id] for project_id in requested_ids if project_id in project_lookup]
    elif body.stale_only:
        projects_to_process = session.exec(
            select(Project).where(Project.memory_stale == True)
        ).all()
    else:
        projects_to_process = []

    rebuilt: list[dict] = []
    skipped: list[dict] = []
    for project in projects_to_process:
        if body.stale_only and not project.memory_stale:
            skipped.append(
                {
                    "project_id": project.id,
                    "reason": "not_stale",
                }
            )
            continue

        scheduler_service.remove_job(_memory_rebuild_job_id(project.id))
        saved_memory = await _rebuild_project_memory(session, project.id, project, trigger="batch")
        _schedule_project_memory_summary_warm(
            project.id,
            summary_types=["overview", "risk", "stakeholder"],
            trigger="batch_rebuild_completed",
        )
        _bust_project(project.id)
        rebuilt.append(
            {
                "project_id": project.id,
                "memory": saved_memory,
                "memory_version": saved_memory.get("memory_version", 0),
                "memory_updated_at": saved_memory.get("last_updated_at", ""),
                "memory_stale": False,
                "memory_rebuild_status": "idle",
            }
        )

    return {
        "ok": True,
        "requested_count": len(requested_ids) if requested_ids else len(projects_to_process),
        "rebuilt_count": len(rebuilt),
        "rebuilt": rebuilt,
        "skipped": skipped,
    }


@router.post("/{project_id}/memory/rebuild")
async def rebuild_project_memory(project_id: int, session: Session = Depends(get_session)):
    scheduler_service.remove_job(_memory_rebuild_job_id(project_id))
    saved_memory = await _rebuild_project_memory(session, project_id, trigger="manual")
    _schedule_project_memory_summary_warm(
        project_id,
        summary_types=["overview", "risk", "stakeholder"],
        trigger="manual_rebuild_completed",
    )
    _bust_project(project_id)
    return {
        "ok": True,
        "project_id": project_id,
        "memory": saved_memory,
        "memory_version": saved_memory.get("memory_version", 0),
        "memory_updated_at": saved_memory.get("last_updated_at", ""),
        "memory_rebuild_status": "idle",
    }


@router.post("/memory/warm-summaries-batch")
async def warm_project_memory_summaries_batch(
    body: ProjectMemoryBatchWarmSummariesRequest,
    session: Session = Depends(get_session),
):
    requested_ids = [int(project_id) for project_id in body.project_ids if int(project_id) > 0]
    if not requested_ids:
        return {
            "ok": True,
            "requested_count": 0,
            "processed_count": 0,
            "warmed_count": 0,
            "processed": [],
            "skipped": [],
        }

    candidate_projects = session.exec(
        select(Project).where(Project.id.in_(requested_ids))
    ).all()
    project_lookup = {project.id: project for project in candidate_projects}
    projects_to_process = [project_lookup[project_id] for project_id in requested_ids if project_id in project_lookup]

    processed: list[dict] = []
    skipped: list[dict] = []
    warmed_count = 0
    queued_count = 0
    normalized_summary_types = [
        summary_type
        for summary_type in (body.summary_types or ["overview", "risk", "stakeholder"])
        if summary_type in {"overview", "risk", "stakeholder", "delivery", "client-facing", "financial", "documents"}
    ] or ["overview", "risk", "stakeholder"]
    scheduler_running = scheduler_service.is_running()
    budget_used_today = _count_summary_warm_budget_used_today(session) if scheduler_running else 0

    for project_id in requested_ids:
        if project_id not in project_lookup:
            skipped.append({"project_id": project_id, "reason": "not_found"})

    for project in projects_to_process:
        memory_payload = get_project_memory_payload(project)
        if int(memory_payload.get("memory_version", 0) or 0) <= 0:
            skipped.append({"project_id": project.id, "reason": "memory_missing"})
            continue

        memory_version = int(memory_payload.get("memory_version", 0) or 0)
        normalized_language = normalize_summary_language(body.language)
        already_cached = all(
            get_project_memory_summary_cache(
                session,
                project_id=project.id,
                summary_type=summary_type,
                language=normalized_language,
                memory_version=memory_version,
            )
            for summary_type in normalized_summary_types
        )
        if already_cached and not body.force_refresh:
            skipped.append({"project_id": project.id, "reason": "already_cached"})
            continue

        if scheduler_running:
            if budget_used_today + queued_count >= MEMORY_SUMMARY_WARM_DAILY_LIMIT:
                skipped.append({"project_id": project.id, "reason": "daily_limit_reached"})
                continue

            job_id = _memory_summary_warm_job_id(project.id, body.language)
            if scheduler_service.get_job(job_id):
                skipped.append({"project_id": project.id, "reason": "already_queued"})
                continue

            queued = _schedule_project_memory_summary_warm(
                project.id,
                language=body.language,
                summary_types=normalized_summary_types,
                force_refresh=body.force_refresh,
                delay_seconds=queued_count * MEMORY_SUMMARY_WARM_INTERVAL_SECONDS,
                trigger="batch_warm",
            )
            if queued:
                queued_count += 1
                processed.append(
                    {
                        "project_id": project.id,
                        "summary_types": normalized_summary_types,
                        "memory_version": memory_version,
                        "mode": "queued",
                    }
                )
                continue

        warmed_types = await _warm_project_memory_summary_caches(
            session,
            project,
            memory_payload,
            summary_types=normalized_summary_types,
            language=body.language,
            force_refresh=body.force_refresh,
        )
        warmed_count += len(warmed_types)
        processed.append(
            {
                "project_id": project.id,
                "summary_types": warmed_types,
                "memory_version": memory_version,
                "mode": "inline",
            }
        )

    return {
        "ok": True,
        "requested_count": len(requested_ids),
        "processed_count": len(processed),
        "warmed_count": warmed_count,
        "queued_count": queued_count,
        "processed": processed,
        "skipped": skipped,
    }


@router.get("/memory/jobs")
def list_project_memory_jobs(session: Session = Depends(get_session)):
    all_projects = session.exec(select(Project)).all()
    project_lookup = {project.id: project for project in all_projects}

    jobs: list[dict] = []
    for job in scheduler_service.get_jobs():
        parsed = _parse_project_memory_job(job)
        if not parsed:
            continue
        project = project_lookup.get(parsed["project_id"])
        jobs.append(
            {
                **parsed,
                "project_name": project.name if project else f"Project #{parsed['project_id']}",
                "client": project.client if project else "",
                "memory_stale": project.memory_stale if project else False,
                "memory_version": project.memory_version if project else 0,
            }
        )

    jobs.sort(key=lambda item: (item.get("next_run_at") or "", item["project_id"], item["job_type"]))
    used_today = _count_summary_warm_budget_used_today(session)
    recent_failures = []
    for project in all_projects:
        failure = _get_project_memory_failure(project)
        if not failure:
            continue
        recent_failures.append(
            {
                "scope": "project",
                "project_id": project.id,
                "project_name": project.name,
                "client": project.client,
                **failure,
            }
        )
    recent_failures.sort(key=lambda item: item.get("failed_at", ""), reverse=True)
    return {
        "jobs": jobs,
        "count": len(jobs),
        "budget": {
            "used": used_today,
            "limit": MEMORY_SUMMARY_WARM_DAILY_LIMIT,
            "remaining": max(MEMORY_SUMMARY_WARM_DAILY_LIMIT - used_today, 0),
        },
        "recent_failures": recent_failures[:8],
    }


@router.post("/memory/jobs/{project_id}/cancel")
def cancel_project_memory_jobs(project_id: int):
    scheduler_service.remove_job(_memory_rebuild_job_id(project_id))
    for language in ("zh", "en", "default"):
        scheduler_service.remove_job(_memory_summary_warm_job_id(project_id, language))
    return {"ok": True, "project_id": project_id}


@router.post("/memory/jobs/{project_id}/run-now")
async def run_project_memory_jobs_now(
    project_id: int,
    session: Session = Depends(get_session),
):
    scheduler_service.remove_job(_memory_rebuild_job_id(project_id))
    for language in ("zh", "en", "default"):
        scheduler_service.remove_job(_memory_summary_warm_job_id(project_id, language))

    project = get_project_or_404(session, project_id)
    if project.memory_stale or (project.memory_version or 0) == 0:
        saved_memory = await _rebuild_project_memory(session, project_id, project, trigger="manual_queue_run")
        _schedule_project_memory_summary_warm(
            project_id,
            summary_types=["overview", "risk", "stakeholder"],
            trigger="run_now_after_rebuild",
        )
        _bust_project(project_id)
        return {
            "ok": True,
            "project_id": project_id,
            "action": "rebuild",
            "memory_version": saved_memory.get("memory_version", 0),
        }

    memory_payload = get_project_memory_payload(project)
    warmed = await _warm_project_memory_summary_caches(
        session,
        project,
        memory_payload,
        summary_types=["overview", "risk", "stakeholder"],
        force_refresh=False,
    )
    return {
        "ok": True,
        "project_id": project_id,
        "action": "summary_warm",
        "warmed": warmed,
    }


@router.post("/{project_id}/memory/summarize")
async def summarize_project_memory(
    project_id: int,
    body: ProjectMemorySummarizeRequest,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    if body.rebuild_if_stale:
        project, memory_payload = await _ensure_project_memory(session, project_id, project)
    else:
        memory_payload = get_project_memory_payload(project)

    summary_type = (body.summary_type or "overview").strip() or "overview"
    normalized_language = normalize_summary_language(body.language)
    memory_version = int(memory_payload.get("memory_version", 0) or 0)

    cached_summary = None
    if not body.force_refresh and memory_version > 0:
        cached_summary = get_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=summary_type,
            language=normalized_language,
            memory_version=memory_version,
        )

    if cached_summary:
        if body.stream:
            async def cached_event_stream():
                generated_at = cached_summary.updated_at.isoformat()
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "text",
                            "content": cached_summary.content,
                            "cached": True,
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )
                yield (
                    "data: "
                    + json.dumps(
                        {
                            "type": "done",
                            "project_id": project_id,
                            "summary_type": summary_type,
                            "content": cached_summary.content,
                            "source_memory_version": memory_version,
                            "memory_stale": memory_payload.get("stale", False),
                            "generated_at": generated_at,
                            "cached": True,
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )

            return StreamingResponse(cached_event_stream(), media_type="text/event-stream")

        return {
            "project_id": project_id,
            "summary_type": summary_type,
            "content": cached_summary.content,
            "source_memory_version": memory_version,
            "memory_stale": memory_payload.get("stale", False),
            "generated_at": cached_summary.updated_at,
            "cached": True,
        }

    prompt = build_project_memory_view_prompt(
        memory_payload,
        project.name,
        summary_type,
        body.language,
    )
    if body.stream:
        async def event_stream():
            accumulated: list[str] = []
            try:
                async for chunk in stream_llm_text_chunks(
                    stream_with_selected_model(
                        [{"role": "user", "content": prompt}],
                        max_tokens=1400,
                    )
                ):
                    accumulated.append(chunk)
                    yield f"data: {json.dumps({'type': 'text', 'content': chunk}, ensure_ascii=False)}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                return

            content = "".join(accumulated).strip()
            cached = save_project_memory_summary_cache(
                session,
                project_id=project_id,
                summary_type=summary_type,
                language=normalized_language,
                memory_version=memory_version,
                content=content,
            )
            yield (
                "data: "
                + json.dumps(
                    {
                        "type": "done",
                        "project_id": project_id,
                        "summary_type": summary_type,
                        "content": content,
                        "source_memory_version": memory_version,
                        "memory_stale": memory_payload.get("stale", False),
                        "generated_at": cached.updated_at.isoformat(),
                        "cached": False,
                    },
                    ensure_ascii=False,
                )
                + "\n\n"
            )

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    content = await complete_with_selected_model(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1400,
    )
    cached = save_project_memory_summary_cache(
        session,
        project_id=project_id,
        summary_type=summary_type,
        language=normalized_language,
        memory_version=memory_version,
        content=content.strip(),
    )
    return {
        "project_id": project_id,
        "summary_type": summary_type,
        "content": cached.content,
        "source_memory_version": memory_version,
        "memory_stale": memory_payload.get("stale", False),
        "generated_at": cached.updated_at,
        "cached": False,
    }


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


@router.get("/todos/my")
def list_my_todos(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Return pending todos assigned to the current user across all projects."""
    return list_user_pending_todos(session, current_user.id)
