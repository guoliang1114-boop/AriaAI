"""Shared helpers, schemas, and internal functions for projects sub-routers."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import re
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
from app.models.db import ClientStakeholder, Conversation, MemoryCandidate, Message, Project, Milestone, ProjectFile, ProjectFolder, ProjectPayment, ProjectProgressUpdate, ProjectTodo, ProjectMember, ProjectMemorySnapshot, ProjectMemorySummary, User, ClientRecord
from app.services import claude as _claude_svc, openai_compat as _kimi_svc
from app.services import scheduler as scheduler_service
from app.models.db import Setting as _Setting
from app.services.cache import clients_cache, projects_cache
from app.services.client_contexts import (
    build_client_memory_promote_prompt,
    get_client_memory_payload,
    mark_client_memory_stale,
    parse_client_memory_patch,
    save_client_memory,
)
from app.services.client_permissions import lock_and_require_client_access
from app.services.memory_facts import capture_client_memory_source_snapshots
from app.services.chat_exports import build_markdown_export_content
from app.services.document_text import extract_text_from_file
from app.services.project_ai import (
    build_project_ai_suggest_messages,
    parse_project_ai_suggestions,
    summarize_uploaded_project_file,
)
from app.services.agent_harness.structured_patch import locked_text_path
from app.services.project_core import (
    create_project_record,
    get_project_or_404,
    init_default_project_folders,
    list_projects_basic,
    lock_and_require_project_memory_write,
    lock_and_require_project_write,
    lock_project_for_trusted_system_write,
    update_project_record,
)
from app.services.project_clients import find_client_for_project
from app.services.project_contexts import (
    EDITABLE_MEMORY_SLOTS,
    PROJECT_MEMORY_SUMMARY_TYPES,
    _default_project_memory,
    _get_existing_raw_memory,
    _normalize_editable_slot,
    build_project_context_data,
    build_project_context_prompt,
    build_project_memory_data,
    build_project_memory_multi_summary_prompt,
    build_project_memory_prompt,
    build_project_memory_view_prompt,
    build_project_summary_from_memory_prompt,
    get_project_memory_summary_cache,
    get_project_memory_payload,
    mark_project_memory_stale,
    normalize_summary_language,
    parse_project_memory_multi_summary,
    parse_project_memory_multi_summary_with_missing,
    parse_project_memory_patch,
    save_project_memory,
    save_project_context_summary,
    save_project_memory_summary_cache,
    stream_llm_text_chunks,
)
from app.services.memory_rebuilds import (
    MemoryPatchValidationError,
    MemoryRebuildConflict,
    assert_memory_source_snapshots,
    begin_memory_prompt_snapshot,
    plan_client_memory_rebuild,
    plan_project_memory_rebuild,
)
from app.services.memory_slots import (
    CLIENT_MEMORY_SLOT_KEYS,
    PROJECT_MEMORY_SLOT_KEYS,
    get_client_memory_slot_states,
    get_project_memory_slot_states,
    load_client_memory_slot_values,
    load_project_memory_slot_canonical_values,
    load_project_memory_slot_values,
)
from app.services.project_deletion import delete_project_cascade
from app.services.project_details import build_project_detail
from app.services.project_documents import (
    build_markdown_export_header,
    build_timestamped_markdown_filename,
    create_markdown_project_file,
    create_project_document_record,
    get_project_document_file_or_404 as get_project_document_file_or_404,
    get_project_document_payload,
    ensure_markdown_filename,
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
from app.services.memory_snapshots import build_memory_snapshot_diff, parse_snapshot_memory
from app.services.memory_operation_state import (
    get_project_memory_rebuild_log,
    get_project_memory_failure,
    set_project_client_promotion,
    set_project_memory_failure,
)
from app.tools.project_markdown import update_project_markdown_document
from app.services.project_todos import (
    create_project_todo,
    delete_project_todo,
    ensure_project_exists,
    list_project_todos,
    list_user_pending_todos,
    serialize_todo,
    update_project_todo,
)
from app.services.stakeholder_contexts import (
    list_client_stakeholder_dicts,
)
from app.services.time_utils import utc_now_naive
from app.routers.auth import get_current_user


# ── Constants and locks ────────────────────────────────────────────────────────

_PROJECTS_TTL = 120.0
_CLIENTS_KEY = "all"
logger = logging.getLogger(__name__)

_MEMORY_REBUILD_MAX_TOKENS = 3200
_MEMORY_REBUILD_OUTPUT_GUARD = (
    "Return at most 48 _source_attributions entries. Source tags such as "
    "[project:123] are citation metadata only; never copy a source tag into "
    "any business field value."
)


def _build_project_memory_rebuild_prompt(
    project_data: str,
    slot_keys: tuple[str, ...] | None = None,
) -> str:
    return (
        f"{build_project_memory_prompt(project_data, slot_keys)}\n\n"
        f"Output safety: {_MEMORY_REBUILD_OUTPUT_GUARD}"
    )


_project_memory_locks: dict[int, asyncio.Lock] = {}
_project_summary_locks: dict[str, asyncio.Lock] = {}


_STAKEHOLDER_ROLE_PATTERN = re.compile(
    r"(?P<name>[\u4e00-\u9fa5]{1,4})(?P<role>总监|经理|负责人|主管|主任|老板|采购|财务|法务|安全|运维|商务|产品|技术|业务方|使用方)"
)
_STAKEHOLDER_TITLE_PATTERN = re.compile(
    r"(?P<title>CEO|CFO|CTO|CIO|采购负责人|财务负责人|法务负责人|安全负责人|业务负责人|技术负责人|项目负责人)",
    re.IGNORECASE,
)
_STAKEHOLDER_NAME_STOPWORDS = {"提醒", "表示", "认为", "需要", "关注", "等待", "确认", "补充", "客户", "业务", "项目"}


# ── Schemas ────────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    client: str
    client_id: Optional[int] = None
    description: str = ""
    status: str = "lead"
    contract_amount: float = 0.0
    notes: str = ""
    md_notes: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    client: Optional[str] = None
    client_id: Optional[int] = None
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


class ProgressUpdateCreate(BaseModel):
    content: str
    next_step: str = ""
    risk: str = ""


class NoteBody(BaseModel):
    content: str
    append: bool = True   # True = append to existing notes; False = overwrite


class NotePolishBody(BaseModel):
    draft: str


class MemberCreate(BaseModel):
    user_id: int
    role: str = "editor"


class MemberUserOut(BaseModel):
    id: int
    display_name: str


class MemberOut(BaseModel):
    id: int
    project_id: int
    user_id: int
    role: str = "editor"
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


class ConfirmMarkdownSaveRequest(BaseModel):
    pending_index: int = 0


class ProjectDocumentCreate(BaseModel):
    folder_id: Optional[int] = None
    name: str
    content: str = ""


class ProjectDocumentUpdate(BaseModel):
    content: Optional[str] = None
    name: Optional[str] = None
    folder_id: Optional[int] = None


class ProjectBriefingRefineRequest(BaseModel):
    meeting_type: str = "status"
    language: Optional[str] = None
    force_refresh: bool = False


class ProjectStakeholderCaptureRequest(BaseModel):
    text: str


class ProjectStakeholderAnalyzeRequest(BaseModel):
    focus: Optional[str] = None


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


class ProjectMemoryGenerateSummariesRequest(BaseModel):
    rebuild_if_stale: bool = True
    language: Optional[str] = None
    force_refresh: bool = True
    summary_types: Optional[List[str]] = None


class ProjectMemorySlotUpdateRequest(BaseModel):
    pinned: list[str] = []


class ProjectMemoryBatchRebuildRequest(BaseModel):
    project_ids: list[int] = []
    stale_only: bool = False
    missing_only: bool = False


class ProjectMemoryBatchWarmSummariesRequest(BaseModel):
    project_ids: list[int] = []
    summary_types: list[str] = ["overview", "risk", "stakeholder"]
    language: Optional[str] = None
    force_refresh: bool = False


class ProjectContextGenerateRequest(BaseModel):
    language: Optional[str] = None


# ── Internal helpers ───────────────────────────────────────────────────────────

def _get_project_memory_lock(project_id: int) -> asyncio.Lock:
    lock = _project_memory_locks.get(project_id)
    if lock is None:
        lock = asyncio.Lock()
        _project_memory_locks[project_id] = lock
    return lock


def _project_summary_lock_key(project_id: int, summary_type: str, language: str, memory_version: int) -> str:
    return f"{project_id}:{summary_type}:{language}:{memory_version}"


def _get_project_summary_lock(key: str) -> asyncio.Lock:
    lock = _project_summary_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _project_summary_locks[key] = lock
    return lock


async def _generate_single_project_memory_summary_content(
    project_name: str,
    memory_payload: dict,
    summary_type: str,
    language: str | None = None,
) -> str:
    prompt = build_project_memory_view_prompt(
        memory_payload,
        project_name,
        summary_type,
        language,
    )
    content = await complete_with_selected_model(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1400,
    )
    return str(content or "").strip()


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


def _find_client_record_for_project(
    session: Session,
    project: Project,
) -> ClientRecord | None:
    return find_client_for_project(session, project)


def _serialize_client_stakeholder_dict(stakeholder: ClientStakeholder) -> dict:
    return {
        "id": stakeholder.id,
        "client_id": stakeholder.client_id,
        "name": stakeholder.name,
        "role": stakeholder.role,
        "organization_level": stakeholder.organization_level,
        "influence_type": stakeholder.influence_type,
        "relationship_status": stakeholder.relationship_status,
        "concerns": stakeholder.concerns,
        "sensitivities": stakeholder.sensitivities,
        "communication_preference": stakeholder.communication_preference,
        "contact": stakeholder.contact,
        "last_action": stakeholder.last_action,
        "personality_profile": stakeholder.personality_profile,
        "decision_style": stakeholder.decision_style,
        "communication_strategy": stakeholder.communication_strategy,
        "trust_signals": stakeholder.trust_signals,
        "note": stakeholder.note,
        "created_at": stakeholder.created_at.isoformat(),
        "updated_at": stakeholder.updated_at.isoformat(),
    }


def _extract_first_json_object_from_text(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return raw[start : end + 1]
    return "{}"


async def _auto_promote_archived_project_to_client_memory(
    session: Session,
    project_id: int,
    *,
    actor: User,
    previous_status: str | None,
) -> bool:
    project = session.get(Project, project_id)
    if not project or previous_status == "archived" or project.status != "archived":
        return False

    client = _find_client_record_for_project(session, project)
    if client is None:
        return False

    project_memory = load_project_memory_slot_values(
        session,
        project,
        get_project_memory_payload(project),
    )
    if (project.memory_version or 0) == 0 or project.memory_stale:
        project_memory = await _rebuild_project_memory(
            session,
            project_id,
            project,
            trigger="archive_promotion_prepare",
            actor_user_id=int(actor.id),
        )
        project = session.get(Project, project_id) or project

    # Build the promotion prompt and its source digest from one stable database
    # snapshot. Re-fetch all authorization-bearing rows after resetting the
    # earlier lookup/rebuild transaction.
    begin_memory_prompt_snapshot(session)
    project = session.get(Project, project_id)
    if not project or project.status != "archived":
        return False
    client = _find_client_record_for_project(session, project)
    if client is None:
        return False
    project_memory = load_project_memory_slot_values(
        session,
        project,
        get_project_memory_payload(project),
    )

    current_client_memory = load_client_memory_slot_values(
        session,
        client,
        get_client_memory_payload(client),
    )
    promotion_plan = plan_client_memory_rebuild(
        memory_version=int(client.client_memory_version or 0),
        parent_stale=bool(client.client_memory_stale),
        trigger="manual",
        slot_states=get_client_memory_slot_states(session, int(client.id)),
    )
    promotion_source_handles = [f"project_memory:{project.id}"]
    promotion_source_snapshots = capture_client_memory_source_snapshots(
        session,
        client,
        {
            **current_client_memory,
            "source_project_ids": [
                *list(current_client_memory.get("source_project_ids") or []),
                project.id,
            ],
        },
        promotion_source_handles,
    )
    if set(promotion_source_snapshots) != set(promotion_source_handles):
        raise MemoryRebuildConflict(
            "memory promotion conflict: project memory source is unavailable"
        )
    promotion_client_id = int(client.id)
    promotion_prompt = build_client_memory_promote_prompt(
        current_client_memory,
        project.name,
        project_memory,
        project.id,
    )
    session.rollback()
    raw_client_memory = await complete_with_selected_model(
        messages=[
            {
                "role": "user",
                "content": promotion_prompt,
            }
        ],
        max_tokens=_MEMORY_REBUILD_MAX_TOKENS,
    )
    session.expire_all()
    # Re-establish business authorization after the untrusted provider wait.
    # The shared helper holds identity -> User -> all linked Projects (ID order)
    # -> ClientRecord -> memberships (ID order) through the atomic memory and
    # promotion-receipt commit below.
    try:
        client, _locked_actor, locked_projects = lock_and_require_client_access(
            session,
            promotion_client_id,
            actor,
            require_write=True,
        )
    except HTTPException as exc:
        if exc.status_code in {404, 409}:
            raise MemoryRebuildConflict(
                "memory promotion conflict: client was removed or changed during generation"
            ) from exc
        raise
    project = next(
        (
            locked_project
            for locked_project in locked_projects
            if int(locked_project.id) == project_id
        ),
        None,
    )
    if project is None or project.client_id != client.id:
        raise MemoryRebuildConflict(
            "memory promotion conflict: project client ownership changed during generation"
        )
    if project.status != "archived":
        raise MemoryRebuildConflict(
            "memory promotion conflict: project archive status changed during generation"
        )
    # Client-level write access may come from a different linked project. The
    # archive transition itself is source-project work, so revoking that exact
    # owner/editor membership during generation must still stop promotion.
    source_memberships = list(
        session.exec(
            select(ProjectMember)
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == int(_locked_actor.id),
            )
            .order_by(ProjectMember.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    )
    if not _locked_actor.is_admin and not any(
        str(member.role or "").strip().lower() in {"owner", "editor"}
        for member in source_memberships
    ):
        raise HTTPException(403, "Source project write permission required")
    refreshed_client_memory = load_client_memory_slot_values(
        session,
        client,
        get_client_memory_payload(client),
    )
    current_source_snapshots = capture_client_memory_source_snapshots(
        session,
        client,
        {
            **refreshed_client_memory,
            "source_project_ids": [
                *list(refreshed_client_memory.get("source_project_ids") or []),
                project.id,
            ],
        },
        promotion_source_handles,
    )
    if current_source_snapshots != promotion_source_snapshots:
        raise MemoryRebuildConflict(
            "memory promotion conflict: project memory changed during generation"
        )
    parsed_client_memory = parse_client_memory_patch(
        raw_client_memory,
        client,
        CLIENT_MEMORY_SLOT_KEYS,
    )
    save_client_memory(
        session,
        client.id,
        parsed_client_memory,
        trigger="project_archived_auto_promoted",
        source_project_ids=[project.id],
        source_snapshots=promotion_source_snapshots,
        rebuilt_slots=CLIENT_MEMORY_SLOT_KEYS,
        rebuild_mode="full",
        rebuild_plan=promotion_plan,
        commit=False,
    )
    project = session.get(Project, project_id)
    if project is None:
        session.rollback()
        raise MemoryRebuildConflict(
            "memory promotion conflict: project was removed before promotion commit"
        )
    raw_project_memory = _get_existing_raw_memory(project)
    promotion = {
        "status": "completed",
        "client_id": client.id,
        "client_name": client.name,
        "promoted_at": utc_now_naive().isoformat(),
        "last_attempt_at": utc_now_naive().isoformat(),
        "trigger": "project_archived_auto_promoted",
    }
    raw_project_memory.pop("_client_promotion", None)
    set_project_client_promotion(project, promotion)
    last_failure = get_project_memory_failure(project)
    if isinstance(last_failure, dict) and last_failure.get("stage") == "client_promotion":
        raw_project_memory.pop("_last_failure", None)
        set_project_memory_failure(project, None)
    project.context_memory_json = json.dumps(raw_project_memory, ensure_ascii=False)
    project.updated_at = utc_now_naive()
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
    if isinstance(exc, MemoryRebuildConflict):
        return True
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
    if "database" in text or "sql" in text or "psycopg" in text:
        return "database"
    if "not found" in text or "no project" in text or "empty" in text:
        return "data"
    if "scheduler" in text or "job" in text or "queue" in text:
        return "scheduler"
    if "model" in text or "llm" in text or "claude" in text or "kimi" in text or "deepseek" in text:
        return "llm"
    return "unknown"


def _count_summary_warm_budget_used_today(session: Session) -> int:
    start_of_day = utc_now_naive().replace(hour=0, minute=0, second=0, microsecond=0)
    warmed = session.exec(
        select(ProjectMemorySummary).where(ProjectMemorySummary.created_at >= start_of_day)
    ).all()
    return len(warmed)


def _get_raw_project_memory(project: Project) -> dict:
    return _get_existing_raw_memory(project)


def _require_project_memory_write_context(
    *,
    actor_user_id: int | None,
    trusted_system: bool,
) -> None:
    """Require an explicit user actor or an explicit internal-job context."""

    if actor_user_id is None and not trusted_system:
        raise ValueError(
            "Project memory writes require actor_user_id or trusted_system=True"
        )
    if actor_user_id is not None and trusted_system:
        raise ValueError(
            "Project memory writes cannot mix actor_user_id and trusted_system=True"
        )


def _lock_project_memory_writer(
    session: Session,
    project_id: int,
    *,
    actor_user_id: int | None,
    trusted_system: bool,
) -> Project:
    """Final-lock a Project under the declared authorization context."""

    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    if actor_user_id is not None:
        project, _ = lock_and_require_project_write(
            session,
            project_id,
            actor_user_id=actor_user_id,
        )
        return project
    return lock_project_for_trusted_system_write(session, project_id)


def _lock_project_memory_prompt_sources(
    session: Session,
    project: Project,
    *,
    client: ClientRecord | None,
) -> None:
    """Freeze every row family read by ``build_project_memory_data``.

    The Project parent is already locked by ``_lock_project_memory_writer``.
    On PostgreSQL that parent lock also conflicts with the FK key-share lock
    needed by a new child insert. Existing rows are locked in one fixed family
    and ascending-ID order. A linked Client parent is locked before its
    stakeholder children for the same reason.
    """

    project_id = int(project.id or 0)
    if project.client_id is not None and (
        client is None or int(project.client_id) != int(client.id or 0)
    ):
        raise MemoryRebuildConflict(
            "project memory conflict: linked client changed during generation"
        )
    client_id = int(client.id) if client is not None and client.id is not None else None

    session.exec(
        select(ProjectProgressUpdate)
        .where(ProjectProgressUpdate.project_id == project_id)
        .order_by(ProjectProgressUpdate.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
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
    session.exec(
        select(ProjectPayment)
        .where(ProjectPayment.project_id == project_id)
        .order_by(ProjectPayment.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    session.exec(
        select(MemoryCandidate)
        .where(MemoryCandidate.project_id == project_id)
        .order_by(MemoryCandidate.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    if client_id is not None:
        session.exec(
            select(ClientStakeholder)
            .where(ClientStakeholder.client_id == client_id)
            .order_by(ClientStakeholder.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()


def _lock_project_memory_rebuild_writer(
    session: Session,
    project_id: int,
    *,
    actor_user_id: int | None,
    trusted_system: bool,
) -> tuple[Project, ClientRecord | None]:
    """Final-lock rebuild authorization plus its Client-owned source parent."""

    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    if actor_user_id is not None:
        project, _, client = lock_and_require_project_memory_write(
            session,
            project_id,
            actor_user_id=actor_user_id,
        )
        return project, client

    project = lock_project_for_trusted_system_write(session, project_id)
    client: ClientRecord | None = None
    if project.client_id is not None:
        client = session.exec(
            select(ClientRecord)
            .where(ClientRecord.id == int(project.client_id))
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if client is None:
            raise MemoryRebuildConflict(
                "project memory conflict: linked client changed during generation"
            )
    return project, client


def _require_current_project_memory_generation(
    session: Session,
    project: Project,
    *,
    expected_rebuild_status: str,
    expected_project_updated_at: datetime,
) -> None:
    """Reject a provider result cancelled or superseded while it was running."""

    if (
        project.memory_rebuild_status != expected_rebuild_status
        or project.updated_at != expected_project_updated_at
    ):
        session.rollback()
        raise MemoryRebuildConflict(
            "project memory rebuild was cancelled or superseded during generation"
        )


def _set_project_memory_failure(
    session: Session,
    project: Project | int,
    *,
    stage: str,
    message: str,
    retry_count: int = 0,
    expected_memory_version: int | None = None,
    expected_rebuild_status: str | None = None,
    expected_project_updated_at: datetime | None = None,
    mark_rebuild_failed: bool = False,
    actor_user_id: int | None = None,
    trusted_system: bool = False,
) -> bool:
    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    project_id = project if isinstance(project, int) else project.id
    if project_id is None:
        return False
    if not isinstance(project, int):
        if expected_memory_version is None:
            expected_memory_version = project.memory_version
        if expected_rebuild_status is None:
            expected_rebuild_status = project.memory_rebuild_status
        if expected_project_updated_at is None:
            expected_project_updated_at = project.updated_at

    # The caller may have retained this Session across an async provider wait.
    # End that transaction and rebuild the failure receipt from a locked, fresh
    # owner so stale JSON can never replace a concurrent successful rebuild.
    session.rollback()
    try:
        current = _lock_project_memory_writer(
            session,
            int(project_id),
            actor_user_id=actor_user_id,
            trusted_system=trusted_system,
        )
    except HTTPException as exc:
        if exc.status_code not in {401, 403, 404, 409}:
            raise
        session.rollback()
        return False
    if (
        expected_memory_version is not None
        and current.memory_version > expected_memory_version
    ) or (
        expected_rebuild_status in {"queued", "rebuilding"}
        and current.memory_rebuild_status == "idle"
    ) or (
        expected_project_updated_at is not None
        and current.updated_at != expected_project_updated_at
    ):
        session.rollback()
        return False

    failed_at = utc_now_naive()
    memory = _get_raw_project_memory(current)
    failure = {
        "category": _classify_memory_failure(stage, message),
        "stage": stage,
        "message": message[:400],
        "retry_count": retry_count,
        "failed_at": failed_at.isoformat(),
    }
    memory.pop("_last_failure", None)
    set_project_memory_failure(current, failure)
    current.context_memory_json = json.dumps(memory, ensure_ascii=False)
    if mark_rebuild_failed:
        current.memory_rebuild_status = "failed"
        current.memory_rebuild_failed_at = failed_at
    session.add(current)
    session.commit()
    return True


def _get_project_memory_failure(project: Project) -> dict | None:
    return get_project_memory_failure(project) or None


def _get_project_memory_successes(project: Project) -> list[dict]:
    rebuild_log = get_project_memory_rebuild_log(project)

    successes: list[dict] = []
    for item in rebuild_log:
        if not isinstance(item, dict):
            continue
        completed_at = str(item.get("at") or "")
        if not completed_at:
            continue
        version = item.get("version", project.memory_version)
        successes.append(
            {
                "scope": "project",
                "project_id": project.id,
                "project_name": project.name,
                "client": project.client,
                "stage": "rebuild",
                "status": "success",
                "message": f"Project memory rebuilt successfully at version {version}.",
                "trigger": item.get("trigger", ""),
                "version": version,
                "completed_at": completed_at,
            }
        )
    return successes


def _get_project_summary_cache_successes(
    session: Session,
    project_lookup: dict[int, Project],
    limit: int = 16,
) -> list[dict]:
    rows = session.exec(
        select(ProjectMemorySummary)
        .order_by(ProjectMemorySummary.updated_at.desc())
        .limit(limit)
    ).all()
    successes: list[dict] = []
    for item in rows:
        project = project_lookup.get(item.project_id)
        if not project:
            continue
        is_briefing = item.summary_type.startswith("briefing:")
        readable_type = item.summary_type.removeprefix("briefing:") if is_briefing else item.summary_type
        successes.append(
            {
                "scope": "project",
                "project_id": project.id,
                "project_name": project.name,
                "client": project.client,
                "stage": f"briefing_refine:{readable_type}" if is_briefing else f"summary_cache:{readable_type}",
                "status": "success",
                "message": (
                    f"AI refined meeting briefing cached for {readable_type}."
                    if is_briefing
                    else f"Project summary cache updated for {readable_type}."
                ),
                "trigger": "cache_write",
                "version": item.memory_version,
                "completed_at": item.updated_at.isoformat(),
            }
        )
    return successes


def _as_briefing_list(value, limit: int = 5) -> list[str]:
    if isinstance(value, dict):
        merged: list[str] = []
        for key in ("pinned", "ai"):
            nested = value.get(key, [])
            if isinstance(nested, list):
                merged.extend(str(item).strip() for item in nested if str(item).strip())
        return merged[:limit]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()][:limit]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _as_briefing_dicts(value, limit: int = 5) -> list[dict]:
    if not isinstance(value, list):
        return []
    rows = [item for item in value if isinstance(item, dict)]
    return rows[:limit]


def _first_non_empty(*values: str | None) -> str:
    for value in values:
        if value and value.strip():
            return value.strip()
    return ""


def _briefing_excerpt(value: str | None, limit: int = 220) -> str:
    text = " ".join((value or "").replace("\r", " ").replace("\n", " ").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _list_project_communication_sources(session: Session, project: Project, limit: int = 6) -> list[dict]:
    sources: list[dict] = []
    if project.md_notes and project.md_notes.strip():
        sources.append(
            {
                "type": "markdown_note",
                "label": "Project markdown notes",
                "excerpt": _briefing_excerpt(project.md_notes),
                "target": "notes",
                "created_at": project.updated_at.isoformat() if project.updated_at else "",
            }
        )
    if project.notes and project.notes.strip():
        sources.append(
            {
                "type": "project_note",
                "label": "Project notes",
                "excerpt": _briefing_excerpt(project.notes),
                "target": "notes",
                "created_at": project.updated_at.isoformat() if project.updated_at else "",
            }
        )

    chat_rows = session.exec(
        select(Message, Conversation)
        .join(Conversation, Message.conversation_id == Conversation.id)
        .where(Conversation.project_id == project.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(max(limit - len(sources), 0))
    ).all()
    for message, conversation in chat_rows:
        excerpt = _briefing_excerpt(message.content)
        if not excerpt:
            continue
        sources.append(
            {
                "type": "chat",
                "label": conversation.title or "Project chat",
                "conversation_id": conversation.id,
                "message_id": message.id,
                "role": message.role,
                "excerpt": excerpt,
                "target": "chat",
                "created_at": message.created_at.isoformat() if message.created_at else "",
            }
        )
        if len(sources) >= limit:
            break
    return sources[:limit]


def _build_project_briefing(session: Session, project_id: int) -> dict:
    project = get_project_or_404(session, project_id)
    memory = load_project_memory_slot_values(
        session,
        project,
        get_project_memory_payload(project),
    )
    client = _find_client_record_for_project(session, project)
    client_memory = (
        load_client_memory_slot_values(
            session,
            client,
            get_client_memory_payload(client),
        )
        if client
        else {}
    )
    stakeholders = (
        list_client_stakeholder_dicts(session, int(client.id), limit=8)
        if client is not None and client.id is not None
        else []
    )

    milestones = list_project_milestones(session, project_id)
    todos = list_project_todos(session, project_id)
    files = list_project_files(session, project_id)

    upcoming_milestones = [
        {
            "id": milestone.id,
            "title": milestone.title,
            "due_date": milestone.due_date,
            "priority": milestone.priority,
        }
        for milestone in sorted(
            [milestone for milestone in milestones if not milestone.is_done],
            key=lambda item: (item.due_date or "9999-12-31", item.id or 0),
        )[:4]
    ]
    pending_todos = [
        {
            "id": todo.id,
            "content": todo.content,
            "due_date": todo.due_date,
        }
        for todo in sorted(
            [todo for todo in todos if not todo.is_done],
            key=lambda item: (item.due_date or "9999-12-31", item.id or 0),
        )[:5]
    ]
    recent_documents = [
        {
            "id": file.id,
            "name": file.name,
            "summary": file.summary,
            "uploaded_at": file.uploaded_at.isoformat() if file.uploaded_at else "",
        }
        for file in sorted(files, key=lambda item: item.uploaded_at, reverse=True)[:4]
    ]
    communication_sources = _list_project_communication_sources(session, project, limit=6)

    stakeholder_concerns = [
        f"{row.get('name')}: {row.get('concerns')}"
        for row in stakeholders
        if row.get("name") and row.get("concerns")
    ]
    stakeholder_sensitivities = [
        f"{row.get('name')}: {row.get('sensitivities')}"
        for row in stakeholders
        if row.get("name") and row.get("sensitivities")
    ]
    stakeholder_followups = [
        f"{row.get('name')}: {row.get('last_action')}"
        for row in stakeholders
        if row.get("name") and row.get("last_action")
    ]

    key_risks = _as_briefing_list(memory.get("key_risks"), limit=5)
    open_questions = _as_briefing_list(memory.get("open_questions"), limit=5)
    next_actions = _as_briefing_list(memory.get("next_actions"), limit=5)
    stakeholder_notes = _as_briefing_list(memory.get("stakeholder_notes"), limit=5)
    client_sensitive_topics = _as_briefing_list(client_memory.get("sensitive_topics"), limit=4)
    decision_patterns = _as_briefing_list(client_memory.get("decision_patterns"), limit=4)
    lessons = _as_briefing_list(client_memory.get("lessons_learned"), limit=4)

    say = [
        item
        for item in [
            _first_non_empty(memory.get("current_objective"), memory.get("project_brief"), project.description),
            *next_actions[:2],
            *stakeholder_concerns[:2],
        ]
        if item
    ][:5]
    avoid = [*stakeholder_sensitivities, *client_sensitive_topics, *key_risks[:2]][:5]
    confirm = [*open_questions, *stakeholder_followups, *[todo["content"] for todo in pending_todos[:2]]][:6]
    experience = [*decision_patterns, *lessons][:6]

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "client": project.client,
            "status": project.status,
            "description": project.description,
            "contract_amount": project.contract_amount,
            "memory_version": project.memory_version,
            "memory_stale": project.memory_stale,
            "memory_updated_at": project.memory_updated_at.isoformat() if project.memory_updated_at else None,
        },
        "client": {
            "id": client.id if client else None,
            "name": client.name if client else project.client,
            "industry": client.industry if client else "",
            "memory_version": client.client_memory_version if client else 0,
            "memory_stale": client.client_memory_stale if client else True,
            "memory_updated_at": client.client_memory_updated_at.isoformat() if client and client.client_memory_updated_at else None,
        },
        "memory": {
            "project_brief": memory.get("project_brief", ""),
            "current_objective": memory.get("current_objective", ""),
            "recent_progress": _as_briefing_list(memory.get("recent_progress"), limit=4),
            "key_risks": key_risks,
            "open_questions": open_questions,
            "next_actions": next_actions,
            "delivery_signals": _as_briefing_list(memory.get("delivery_signals"), limit=4),
            "stakeholder_notes": stakeholder_notes,
            "financial_status": memory.get("financial_status", ""),
            "important_documents": _as_briefing_dicts(memory.get("important_documents"), limit=4),
        },
        "client_memory": {
            "client_profile": client_memory.get("client_profile", ""),
            "decision_patterns": decision_patterns,
            "lessons_learned": lessons,
            "sensitive_topics": client_sensitive_topics,
            "project_history": _as_briefing_dicts(client_memory.get("project_history"), limit=4),
        },
        "stakeholders": stakeholders,
        "meeting_card": {
            "say": say,
            "avoid": avoid,
            "confirm": confirm,
            "experience": experience,
        },
        "signals": {
            "upcoming_milestones": upcoming_milestones,
            "pending_todos": pending_todos,
            "recent_documents": recent_documents,
            "communication_sources": communication_sources,
        },
        "generated_at": utc_now_naive().isoformat(),
    }


def _normalize_briefing_meeting_type(value: str | None) -> str:
    normalized = (value or "status").strip().lower()
    if normalized not in {"status", "executive", "risk", "commercial"}:
        return "status"
    return normalized


def _briefing_cache_type(meeting_type: str) -> str:
    return f"briefing:{_normalize_briefing_meeting_type(meeting_type)}"


def _briefing_source_version(briefing: dict, meeting_type: str) -> int:
    source = {
        "meeting_type": _normalize_briefing_meeting_type(meeting_type),
        "project": briefing.get("project", {}),
        "client": briefing.get("client", {}),
        "memory": briefing.get("memory", {}),
        "client_memory": briefing.get("client_memory", {}),
        "stakeholders": briefing.get("stakeholders", []),
        "meeting_card": briefing.get("meeting_card", {}),
        "signals": briefing.get("signals", {}),
    }
    payload = json.dumps(source, ensure_ascii=False, sort_keys=True, default=str)
    return int(hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12], 16) % 2_000_000_000 + 1


def _build_project_briefing_refine_prompt(briefing: dict, meeting_type: str, language: str | None) -> str:
    normalized_language = normalize_summary_language(language)
    output_language = "中文" if normalized_language == "zh" else "English"
    meeting_type_label = {
        "status": "项目例会 / status meeting",
        "executive": "高层汇报 / executive briefing",
        "risk": "风险沟通 / risk alignment",
        "commercial": "商务推进 / commercial push",
    }[_normalize_briefing_meeting_type(meeting_type)]
    compact_briefing = dict(briefing)
    compact_briefing.pop("generated_at", None)
    # Strict section structure — the frontend splits on these "## "
    # headers to render each block separately (focus / themes / cautions
    # / script). Use these exact 4 headers in this exact order, no
    # others, no extra preamble before the first header.
    return (
        "你是资深项目负责人。请基于下面的确定性会前简报，生成一份可直接用于客户会议前准备的 AI 精炼版。\n"
        f"输出语言：{output_language}\n"
        f"会议类型：{meeting_type_label}\n\n"
        "要求：\n"
        "1. 不要编造未提供的事实。\n"
        "2. 优先突出客户侧干系人、风险、确认事项和下一步推进动作。\n"
        "3. 如果某部分输入不足，要明确写「暂无足够信息」，不要空泛发挥。\n"
        "4. 短句优先，每条要点 ≤ 1 行，长论述放在「开场脚本」里。\n"
        "5. 整体控制在 500-900 字以内。\n\n"
        "严格按以下 4 个二级标题顺序输出，不要加其他标题、不要在第一个标题前写任何文字：\n\n"
        "## 唯一聚焦点\n"
        "（一句话，明确本次会议想要达成的最关键目标，越具体越好）\n\n"
        "## 主打什么\n"
        "- 2-4 条短句要点，每条 ≤ 1 行\n"
        "- 突出会议中最希望客户接收到的信息\n\n"
        "## 谨慎表达\n"
        "- 2-4 条短句要点，每条 ≤ 1 行\n"
        "- 列出需要避开 / 谨慎说的话题与红线\n\n"
        "## 开场脚本\n"
        "一段可直接照念的开场话术（150-300 字），口语化、自然，可包含称呼和具体数字。\n\n"
        "确定性简报 JSON：\n"
        f"{json.dumps(compact_briefing, ensure_ascii=False, indent=2, default=str)}"
    )


def _extract_stakeholder_candidates_from_text(text: str, limit: int = 8) -> list[dict[str, str]]:
    from app.services.stakeholder_detection import detect_stakeholders_from_text

    return detect_stakeholders_from_text(text, limit=limit)


def _record_project_memory_failure_by_id(
    project_id: int,
    *,
    stage: str,
    message: str,
    retry_count: int = 0,
    actor_user_id: int | None = None,
    trusted_system: bool = False,
) -> None:
    """Record ad-hoc LLM failures so operations pages can surface them."""
    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    from app.database import engine as _engine
    from sqlmodel import Session as _S

    try:
        with _S(_engine) as write_session:
            _set_project_memory_failure(
                write_session,
                project_id,
                stage=stage,
                message=message,
                retry_count=retry_count,
                actor_user_id=actor_user_id,
                trusted_system=trusted_system,
            )
    except Exception:
        logger.exception("Failed to record project memory failure for project_id=%s", project_id)


def _build_project_memory_summary_response(
    *,
    cached: bool,
    content: str,
    generated_at: datetime,
    memory_payload: dict,
    memory_version: int,
    project_id: int,
    summary_type: str,
) -> dict:
    return {
        "project_id": project_id,
        "summary_type": summary_type,
        "content": content,
        "source_memory_version": memory_version,
        "memory_stale": memory_payload.get("stale", False),
        "generated_at": generated_at.isoformat(),
        "cached": cached,
    }


async def _generate_memory_summary_cache(
    session: Session,
    project: Project,
    memory_payload: dict,
    summary_type: str,
    language: str | None = None,
    *,
    actor_user_id: int | None = None,
    trusted_system: bool = False,
) -> None:
    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    project_id = int(project.id or 0)
    memory_version = int(memory_payload.get("memory_version", 0) or 0)
    prompt = build_project_memory_view_prompt(
        memory_payload,
        project.name,
        summary_type,
        language,
    )
    session.rollback()
    content = await complete_with_selected_model(
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1400,
    )
    session.expire_all()
    current_project = _lock_project_memory_writer(
        session,
        project_id,
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    current_prompt = build_project_memory_view_prompt(
        load_project_memory_slot_values(
            session,
            current_project,
            get_project_memory_payload(current_project),
        ),
        current_project.name,
        summary_type,
        language,
    )
    if current_prompt != prompt:
        session.rollback()
        raise MemoryRebuildConflict(
            "project summary conflict: project memory changed during generation"
        )
    save_project_memory_summary_cache(
        session,
        project_id=project_id,
        summary_type=summary_type,
        language=language,
        memory_version=memory_version,
        content=content.strip(),
    )


async def _warm_project_memory_summary_caches(
    session: Session,
    project: Project,
    memory_payload: dict,
    summary_types: list[str] | None = None,
    language: str | None = None,
    force_refresh: bool = False,
    *,
    actor_user_id: int | None = None,
    trusted_system: bool = False,
) -> list[str]:
    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
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
            actor_user_id=actor_user_id,
            trusted_system=trusted_system,
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
        memory_payload = load_project_memory_slot_values(
            session,
            project,
            get_project_memory_payload(project),
        )
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
                    trusted_system=True,
                )
                return
            except MemoryRebuildConflict:
                # A newer memory version superseded this warm attempt. Never
                # cache the stale output or report it as a provider failure.
                return
            except Exception as exc:
                if attempt >= MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS - 1 or not _is_retryable_summary_warm_error(exc):
                    _set_project_memory_failure(
                        session,
                        project,
                        stage="summary_warm",
                        message=str(exc),
                        retry_count=attempt,
                        trusted_system=True,
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
    run_at = utc_now_naive() + timedelta(seconds=max(0, delay_seconds))
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
        project = lock_project_for_trusted_system_write(session, project_id)
        # A source change can schedule a replacement while an older provider
        # call is still marked ``rebuilding``. ``idle`` is the committed cancel
        # state and is the only state an already-submitted job must not reclaim.
        if project.memory_rebuild_status not in {"queued", "rebuilding"}:
            session.rollback()
            return
        project.memory_rebuild_status = "rebuilding"
        project.memory_rebuild_failed_at = None
        expected_memory_version = int(project.memory_version or 0)
        expected_rebuild_status = "rebuilding"
        expected_project_updated_at = project.updated_at
        session.add(project)
        session.commit()

        try:
            memory_payload = await _rebuild_project_memory(
                session,
                project_id=project_id,
                project=project,
                trigger=trigger,
                trusted_system=True,
                start_rebuild_status=expected_rebuild_status,
                start_project_updated_at=expected_project_updated_at,
            )
            _schedule_project_memory_summary_warm(
                project_id=project_id,
                summary_types=["overview", "risk", "stakeholder"],
                trigger="rebuild_completed",
            )
            _bust_project(project_id)
        except Exception as exc:
            session.rollback()
            project = session.exec(
                select(Project).where(Project.id == project_id).with_for_update()
            ).first()
            if project is None:
                return
            if (
                int(project.memory_version or 0) > expected_memory_version
                or project.memory_rebuild_status == "idle"
                or project.updated_at != expected_project_updated_at
            ):
                session.rollback()
                return
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
                    utc_now_naive() + timedelta(seconds=delay_seconds),
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
                project_id,
                stage="rebuild",
                message=str(exc),
                retry_count=retry_count,
                expected_memory_version=expected_memory_version,
                expected_rebuild_status="rebuilding",
                expected_project_updated_at=expected_project_updated_at,
                mark_rebuild_failed=True,
                trusted_system=True,
            )
            raise


def _schedule_project_memory_rebuild(project_id: int, trigger: str = "data_changed") -> None:
    if not scheduler_service.is_running():
        return
    run_at = utc_now_naive() + timedelta(seconds=MEMORY_REBUILD_DEBOUNCE_SECONDS)
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
        if project.client_id is not None:
            mark_client_memory_stale(
                session,
                int(project.client_id),
                trigger="project_changed",
            )
    if project and project.memory_rebuild_status != "rebuilding":
        project.memory_rebuild_status = "queued" if scheduler_service.is_running() else "idle"
        session.add(project)
        session.commit()
    # Persist the claimable state before publishing the external scheduler
    # entry. A concurrent cancel can then leave ``idle`` as the winning state;
    # even if this add happens afterwards, the worker's compare-and-claim gate
    # discards that stale submission before any provider call.
    _schedule_project_memory_rebuild(project_id, trigger=trigger)


def _refresh_instance(session: Session, instance):
    if instance is not None and hasattr(instance, "__sqlmodel_relationships__"):
        session.refresh(instance)
    return instance


async def _rebuild_project_memory(
    session: Session,
    project_id: int,
    project: Optional[Project] = None,
    trigger: str = "manual",
    *,
    actor_user_id: int | None = None,
    trusted_system: bool = False,
    start_rebuild_status: str | None = None,
    start_project_updated_at: datetime | None = None,
) -> dict:
    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    if (start_rebuild_status is None) != (start_project_updated_at is None):
        raise ValueError(
            "Project memory rebuild start status and generation must be supplied together"
        )
    begin_memory_prompt_snapshot(session)
    project = get_project_or_404(session, project_id)
    plan = plan_project_memory_rebuild(
        memory_version=int(project.memory_version or 0),
        parent_stale=bool(project.memory_stale),
        trigger=trigger,
        slot_states=get_project_memory_slot_states(session, project_id),
    )
    expected_memory_version = int(project.memory_version or 0)
    expected_rebuild_status = (
        str(start_rebuild_status)
        if start_rebuild_status is not None
        else project.memory_rebuild_status
    )
    expected_project_updated_at = (
        start_project_updated_at
        if start_project_updated_at is not None
        else project.updated_at
    )
    _require_current_project_memory_generation(
        session,
        project,
        expected_rebuild_status=expected_rebuild_status,
        expected_project_updated_at=expected_project_updated_at,
    )
    try:
        _, project_memory_data, coverage = build_project_memory_data(
            session,
            project_id,
            plan.slot_keys if plan.is_partial else None,
        )
        session.rollback()
        raw_memory = await complete_with_selected_model(
            messages=[
                {
                    "role": "user",
                    "content": _build_project_memory_rebuild_prompt(
                        project_memory_data,
                        plan.slot_keys if plan.is_partial else None,
                    ),
                }
            ],
            max_tokens=_MEMORY_REBUILD_MAX_TOKENS,
        )
        session.expire_all()
        project, source_client = _lock_project_memory_rebuild_writer(
            session,
            project_id,
            actor_user_id=actor_user_id,
            trusted_system=trusted_system,
        )
        _require_current_project_memory_generation(
            session,
            project,
            expected_rebuild_status=expected_rebuild_status,
            expected_project_updated_at=expected_project_updated_at,
        )
        _lock_project_memory_prompt_sources(
            session,
            project,
            client=source_client,
        )
        _, _, current_coverage = build_project_memory_data(
            session,
            project_id,
            plan.slot_keys if plan.is_partial else None,
        )
        assert_memory_source_snapshots(
            coverage.get("_source_snapshots", {}),
            current_coverage.get("_source_snapshots", {}),
            scope="project",
        )
        if plan.is_partial:
            try:
                parsed_memory = parse_project_memory_patch(
                    raw_memory,
                    project,
                    plan.slot_keys,
                    existing_memory=load_project_memory_slot_canonical_values(
                        session,
                        project,
                        get_project_memory_payload(project),
                    ),
                )
            except MemoryPatchValidationError:
                begin_memory_prompt_snapshot(session)
                _, full_data, full_coverage = build_project_memory_data(
                    session,
                    project_id,
                )
                session.rollback()
                full_raw = await complete_with_selected_model(
                    messages=[
                        {
                            "role": "user",
                            "content": _build_project_memory_rebuild_prompt(full_data),
                        }
                    ],
                    max_tokens=_MEMORY_REBUILD_MAX_TOKENS,
                )
                session.expire_all()
                project, source_client = _lock_project_memory_rebuild_writer(
                    session,
                    project_id,
                    actor_user_id=actor_user_id,
                    trusted_system=trusted_system,
                )
                _require_current_project_memory_generation(
                    session,
                    project,
                    expected_rebuild_status=expected_rebuild_status,
                    expected_project_updated_at=expected_project_updated_at,
                )
                _lock_project_memory_prompt_sources(
                    session,
                    project,
                    client=source_client,
                )
                _, _, current_full_coverage = build_project_memory_data(
                    session,
                    project_id,
                )
                assert_memory_source_snapshots(
                    full_coverage.get("_source_snapshots", {}),
                    current_full_coverage.get("_source_snapshots", {}),
                    scope="project",
                )
                parsed_memory = parse_project_memory_patch(
                    full_raw,
                    project,
                    PROJECT_MEMORY_SLOT_KEYS,
                    existing_memory=load_project_memory_slot_canonical_values(
                        session,
                        project,
                        get_project_memory_payload(project),
                    ),
                )
                return save_project_memory(
                    session,
                    project_id,
                    parsed_memory,
                    trigger=trigger,
                    coverage=full_coverage,
                    rebuilt_slots=PROJECT_MEMORY_SLOT_KEYS,
                    rebuild_mode="full_fallback",
                    fallback_reason="invalid_partial_payload",
                    rebuild_plan=plan,
                )
        else:
            parsed_memory = parse_project_memory_patch(
                raw_memory,
                project,
                PROJECT_MEMORY_SLOT_KEYS,
                existing_memory=load_project_memory_slot_canonical_values(
                    session,
                    project,
                    get_project_memory_payload(project),
                ),
            )
        return save_project_memory(
            session,
            project_id,
            parsed_memory,
            trigger=trigger,
            coverage=coverage,
            rebuilt_slots=plan.slot_keys,
            rebuild_mode=plan.mode,
            rebuild_plan=plan,
        )
    except Exception as e:
        session.rollback()
        _set_project_memory_failure(
            session,
            project_id,
            stage=f"memory_rebuild:{trigger}",
            message=str(e),
            expected_memory_version=expected_memory_version,
            expected_rebuild_status=expected_rebuild_status,
            expected_project_updated_at=expected_project_updated_at,
            actor_user_id=actor_user_id,
            trusted_system=trusted_system,
        )
        raise


async def _ensure_project_memory(
    session: Session,
    project_id: int,
    project: Optional[Project] = None,
    *,
    actor_user_id: int | None = None,
    trusted_system: bool = False,
) -> tuple[Project, dict]:
    _require_project_memory_write_context(
        actor_user_id=actor_user_id,
        trusted_system=trusted_system,
    )
    project = project or get_project_or_404(session, project_id)
    memory_payload = load_project_memory_slot_values(
        session,
        project,
        get_project_memory_payload(project),
    )
    if project.memory_stale or project.memory_version == 0:
        async with _get_project_memory_lock(project_id):
            project = get_project_or_404(session, project_id)
            memory_payload = load_project_memory_slot_values(
                session,
                project,
                get_project_memory_payload(project),
            )
            if project.memory_stale or project.memory_version == 0:
                memory_payload = await _rebuild_project_memory(
                    session,
                    project_id,
                    project,
                    trigger="on_demand",
                    actor_user_id=actor_user_id,
                    trusted_system=trusted_system,
                )
        project = get_project_or_404(session, project_id)
    return project, load_project_memory_slot_values(
        session,
        project,
        memory_payload,
    )


def _extract_file_text(path: Path, file_type: str, max_chars: int = 4000) -> str:
    return extract_text_from_file(path, file_type, max_chars=max_chars)


async def _auto_summarize_file(
    file_id: int,
    file_path: str,
    file_type: str,
    project_id: int,
    folder_id: int | None,
    actor_user_id: int,
) -> None:
    """Generate a 2-3 sentence summary for an uploaded file, then create a companion .md."""
    from app.database import engine
    from sqlmodel import Session as _Session

    source_snapshot = await summarize_uploaded_project_file(
        file_id,
        project_id=project_id,
        file_path=file_path,
        file_type=file_type,
        extract_file_text=_extract_file_text,
        complete=lambda messages, max_tokens: complete_with_selected_model(messages, max_tokens=max_tokens),
        session_factory=lambda: _Session(engine),
        authorize_write=lambda write_session: lock_and_require_project_write(
            write_session,
            project_id,
            actor_user_id=actor_user_id,
        ),
    )
    if source_snapshot is None:
        return

    # Create companion markdown for non-markdown files
    if file_type.lower() not in ("md",):
        try:
            with _Session(engine) as md_session:
                lock_and_require_project_write(
                    md_session,
                    project_id,
                    actor_user_id=actor_user_id,
                )
                source_file = md_session.exec(
                    select(ProjectFile)
                    .where(ProjectFile.id == file_id)
                    .with_for_update()
                ).first()
                if (
                    source_file is None
                    or not source_snapshot.matches_record(source_file)
                ):
                    md_session.rollback()
                    return
                source_path = Path(file_path)
                with locked_text_path(source_path):
                    if not source_snapshot.matches_file(source_path):
                        md_session.rollback()
                        return
                    text = _extract_file_text(source_path, file_type, 8000)
                    if not text or text.startswith("[") or len(text.strip()) <= 50:
                        md_session.rollback()
                        return
                    source_name = source_path.stem
                    md_content = f"# {source_name}\n\n> Auto-extracted from `{source_path.name}`\n\n{text}"
                    # Hold the source path lock through both the derivative
                    # commit and stale marker so its content remains the exact
                    # snapshot that was authorized and summarized.
                    create_markdown_project_file(
                        md_session,
                        project_id,
                        name=f"{source_name}_extracted.md",
                        content=md_content,
                        uploads_dir=UPLOADS_DIR,
                        folder_id=folder_id,
                        summary=f"Auto-extracted content from {source_path.name}",
                        source_file_id=file_id,
                        origin="markdown_derivative",
                    )
                    _mark_project_memory_stale(
                        md_session,
                        project_id,
                        trigger="project_file_changed",
                    )
        except Exception:
            pass


def _build_project_memory_summaries_response(
    *,
    cached: bool,
    memory_payload: dict,
    memory_version: int,
    project_id: int,
    summaries: dict[str, ProjectMemorySummary],
) -> dict:
    return {
        "project_id": project_id,
        "source_memory_version": memory_version,
        "memory_stale": memory_payload.get("stale", False),
        "cached": cached,
        "summaries": {
            summary_type: _build_project_memory_summary_response(
                cached=cached,
                content=summary.content,
                generated_at=summary.updated_at,
                memory_payload=memory_payload,
                memory_version=memory_version,
                project_id=project_id,
                summary_type=summary_type,
            )
            for summary_type, summary in summaries.items()
        },
    }
