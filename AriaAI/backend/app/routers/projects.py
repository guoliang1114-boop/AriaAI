"""Projects router — CRUD for projects, milestones, file uploads."""
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
from app.models.db import ClientStakeholder, Conversation, Message, Project, Milestone, ProjectFile, ProjectFolder, ProjectPayment, ProjectTodo, ProjectMember, ProjectMemorySnapshot, ProjectMemorySummary, User, ClientRecord
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
from app.services.stakeholder_contexts import list_client_stakeholder_dicts_by_name
from app.services.time_utils import utc_now_naive
from app.routers.auth import get_current_user

_PROJECTS_TTL = 120.0
_CLIENTS_KEY = "all"
logger = logging.getLogger(__name__)
_project_memory_locks: dict[int, asyncio.Lock] = {}
_project_summary_locks: dict[str, asyncio.Lock] = {}


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
    project: Project,
    memory_payload: dict,
    summary_type: str,
    language: str | None = None,
) -> str:
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
            "promoted_at": utc_now_naive().isoformat(),
            "trigger": "project_archived_auto_promoted",
        }
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
        "failed_at": utc_now_naive().isoformat(),
    }
    project.context_memory_json = json.dumps(memory, ensure_ascii=False)
    session.add(project)
    session.commit()


def _get_project_memory_failure(project: Project) -> dict | None:
    failure = _get_raw_project_memory(project).get("_last_failure")
    return failure if isinstance(failure, dict) else None


def _get_project_memory_successes(project: Project) -> list[dict]:
    rebuild_log = _get_raw_project_memory(project).get("rebuild_log")
    if not isinstance(rebuild_log, list):
        return []

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
    memory = get_project_memory_payload(project)
    client = _find_client_record_by_name(session, project.client)
    client_memory = get_client_memory_payload(client) if client else {}
    stakeholders = list_client_stakeholder_dicts_by_name(session, project.client, limit=8)

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
    return (
        "你是资深项目负责人。请基于下面的确定性会前简报，生成一份可直接用于客户会议前准备的 AI 精炼版。\n"
        f"输出语言：{output_language}\n"
        f"会议类型：{meeting_type_label}\n\n"
        "要求：\n"
        "1. 不要编造未提供的事实。\n"
        "2. 优先突出客户侧干系人、风险、确认事项和下一步推进动作。\n"
        "3. 如果某部分输入不足，要明确写“暂无足够信息”，不要空泛发挥。\n"
        "4. 使用清晰短标题，控制在 600-900 字以内。\n\n"
        "建议结构：\n"
        "- 30 秒会议判断\n"
        "- 这次应该主打什么\n"
        "- 需要谨慎表达的点\n"
        "- 关键客户干系人策略\n"
        "- 必问问题\n"
        "- 会后行动清单\n\n"
        "确定性简报 JSON：\n"
        f"{json.dumps(compact_briefing, ensure_ascii=False, indent=2, default=str)}"
    )


_STAKEHOLDER_ROLE_PATTERN = re.compile(
    r"(?P<name>[\u4e00-\u9fa5]{1,4})(?P<role>总监|经理|负责人|主管|主任|老板|采购|财务|法务|安全|运维|商务|产品|技术|业务方|使用方)"
)
_STAKEHOLDER_TITLE_PATTERN = re.compile(
    r"(?P<title>CEO|CFO|CTO|CIO|采购负责人|财务负责人|法务负责人|安全负责人|业务负责人|技术负责人|项目负责人)",
    re.IGNORECASE,
)
_STAKEHOLDER_NAME_STOPWORDS = {"提醒", "表示", "认为", "需要", "关注", "等待", "确认", "补充", "客户", "业务", "项目"}


def _extract_stakeholder_candidates_from_text(text: str, limit: int = 8) -> list[dict[str, str]]:
    compact_text = " ".join((text or "").replace("\r", " ").replace("\n", " ").split())
    candidates: list[dict[str, str]] = []
    seen: set[str] = set()

    for match in _STAKEHOLDER_ROLE_PATTERN.finditer(compact_text):
        raw_name = match.group("name").strip()
        role = match.group("role").strip()
        if len(raw_name) > 4 or raw_name in _STAKEHOLDER_NAME_STOPWORDS:
            continue
        name = f"{raw_name}{role}" if len(raw_name) == 1 else raw_name
        key = f"{name}:{role}".lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "name": name,
                "role": role,
                "influence_type": role if role in {"采购", "财务", "法务", "安全", "商务"} else "",
                "relationship_status": "unknown",
                "note": _briefing_excerpt(compact_text, limit=180),
            }
        )
        if len(candidates) >= limit:
            return candidates

    for match in _STAKEHOLDER_TITLE_PATTERN.finditer(compact_text):
        title = match.group("title").strip()
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "name": title,
                "role": title,
                "influence_type": title,
                "relationship_status": "unknown",
                "note": _briefing_excerpt(compact_text, limit=180),
            }
        )
        if len(candidates) >= limit:
            return candidates

    return candidates


def _record_project_memory_failure_by_id(
    project_id: int,
    *,
    stage: str,
    message: str,
    retry_count: int = 0,
) -> None:
    """Record ad-hoc LLM failures so operations pages can surface them."""
    from app.database import engine as _engine
    from sqlmodel import Session as _S

    try:
        with _S(_engine) as write_session:
            project = write_session.get(Project, project_id)
            if project:
                _set_project_memory_failure(
                    write_session,
                    project,
                    stage=stage,
                    message=message,
                    retry_count=retry_count,
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
        project = get_project_or_404(session, project_id)
        project.memory_rebuild_status = "rebuilding"
        project.memory_rebuild_failed_at = None
        session.add(project)
        session.commit()

        try:
            memory_payload = await _rebuild_project_memory(
                session,
                project_id=project_id,
                project=project,
                trigger=trigger,
            )
            _schedule_project_memory_summary_warm(
                project_id=project_id,
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
                project,
                stage="rebuild",
                message=str(exc),
                retry_count=retry_count,
            )
            project.memory_rebuild_status = "failed"
            project.memory_rebuild_failed_at = utc_now_naive()
            session.add(project)
            session.commit()
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
    try:
        raw_memory = await complete_with_selected_model(
            messages=[{"role": "user", "content": build_project_memory_prompt(project_memory_data)}],
            max_tokens=2200,
        )
    except Exception as e:
        _set_project_memory_failure(
            session,
            project,
            stage=f"memory_rebuild:{trigger}",
            message=str(e),
        )
        raise
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
        async with _get_project_memory_lock(project_id):
            project = get_project_or_404(session, project_id)
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


@router.get("/{project_id}/briefing")
def get_project_meeting_briefing(project_id: int, session: Session = Depends(get_session)):
    """Return a deterministic pre-meeting briefing assembled from memory and project signals."""
    return _build_project_briefing(session, project_id)


@router.post("/{project_id}/briefing/refine")
async def refine_project_meeting_briefing(
    project_id: int,
    body: ProjectBriefingRefineRequest,
    session: Session = Depends(get_session),
):
    """Generate or reuse an AI-refined briefing for the current deterministic briefing payload."""
    project = get_project_or_404(session, project_id)
    meeting_type = _normalize_briefing_meeting_type(body.meeting_type)
    normalized_language = normalize_summary_language(body.language)
    briefing = _build_project_briefing(session, project_id)
    cache_type = _briefing_cache_type(meeting_type)
    source_version = _briefing_source_version(briefing, meeting_type)

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
    async with summary_lock:
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

        try:
            content = await complete_with_selected_model(
                messages=[{"role": "user", "content": _build_project_briefing_refine_prompt(briefing, meeting_type, normalized_language)}],
                max_tokens=1800,
            )
        except Exception as e:
            _set_project_memory_failure(
                session,
                project,
                stage=f"briefing_refine:{meeting_type}",
                message=str(e),
            )
            raise

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


@router.post("/{project_id}/stakeholder-candidates")
def list_project_stakeholder_candidates(
    project_id: int,
    body: ProjectStakeholderCaptureRequest,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    client = _find_client_record_by_name(session, project.client)
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
):
    project = get_project_or_404(session, project_id)
    client = _find_client_record_by_name(session, project.client)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")

    candidates = _extract_stakeholder_candidates_from_text(body.text)
    if not candidates:
        return {"project_id": project_id, "client_id": client.id, "candidates": [], "created": [], "skipped": []}

    existing = {
        _normalize_name(stakeholder.name)
        for stakeholder in session.exec(select(ClientStakeholder).where(ClientStakeholder.client_id == client.id)).all()
    }
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
        session.commit()
        session.refresh(stakeholder)
        existing.add(normalized_name)
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

    if created:
        mark_client_memory_stale_by_name(session, project.client)
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
):
    project = get_project_or_404(session, project_id)
    client = _find_client_record_by_name(session, project.client)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client.id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")

    project_memory = get_project_memory_payload(project)
    client_memory = get_client_memory_payload(client)
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
    raw = await complete_with_selected_model(messages=[{"role": "user", "content": prompt}], max_tokens=1600)
    try:
        parsed = json.loads(_extract_first_json_object_from_text(str(raw or "")))
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    stakeholder.personality_profile = str(parsed.get("personality_profile") or "").strip()[:2000]
    stakeholder.decision_style = str(parsed.get("decision_style") or "").strip()[:2000]
    stakeholder.communication_strategy = str(parsed.get("communication_strategy") or "").strip()[:2400]
    stakeholder.trust_signals = str(parsed.get("trust_signals") or "").strip()[:2000]
    stakeholder.updated_at = utc_now_naive()
    session.add(stakeholder)
    session.commit()
    session.refresh(stakeholder)
    mark_client_memory_stale_by_name(session, project.client, trigger="stakeholder_analyzed")
    _bust_project(project_id)
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder_dict(stakeholder)


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
        if not full_path.is_file():
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
        data.file_name or f"message_{utc_now_naive().strftime('%Y%m%d_%H%M%S')}"
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


@router.post("/{project_id}/messages/{message_id}/confirm-markdown-save", status_code=201)
async def confirm_message_markdown_save(
    project_id: int,
    message_id: int,
    data: ConfirmMarkdownSaveRequest,
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

    try:
        metadata = json.loads(message.metadata_json or "{}")
        if not isinstance(metadata, dict):
            metadata = {}
    except json.JSONDecodeError:
        metadata = {}

    pending = metadata.get("pending_markdown_saves") or []
    if not isinstance(pending, list) or data.pending_index < 0 or data.pending_index >= len(pending):
        raise HTTPException(404, "Pending markdown save not found")

    item = pending[data.pending_index]
    if not isinstance(item, dict):
        raise HTTPException(400, "Invalid pending markdown save")
    if item.get("saved"):
        raise HTTPException(400, "Markdown save already confirmed")

    result = await update_project_markdown_document(
        project_id=project_id,
        mode=item.get("mode") or "append",
        content=item.get("content") or message.content,
        file_id=item.get("file_id"),
        file_name=item.get("file_name"),
        summary=item.get("summary"),
        folder_id=item.get("folder_id"),
    )

    item["saved"] = True
    item["saved_result"] = result
    pending[data.pending_index] = item
    metadata["pending_markdown_saves"] = pending
    message.metadata_json = json.dumps(metadata, ensure_ascii=False)
    session.add(message)
    session.commit()

    return result


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

    # Auto-generate file summary and companion markdown in the background
    background_tasks.add_task(
        _auto_summarize_file, pf.id, str(dest_file), file_type, project_id, folder_id
    )

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

async def _auto_summarize_file(
    file_id: int, file_path: str, file_type: str, project_id: int, folder_id: int | None
) -> None:
    """Generate a 2-3 sentence summary for an uploaded file, then create a companion .md."""
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

    # Create companion markdown for non-markdown files
    if file_type.lower() not in ("md",):
        try:
            text = _extract_file_text(Path(file_path), file_type, 8000)
            if text and not text.startswith("[") and len(text.strip()) > 50:
                source_name = Path(file_path).stem
                md_content = f"# {source_name}\n\n> Auto-extracted from `{Path(file_path).name}`\n\n{text}"
                with _Session(engine) as md_session:
                    create_markdown_project_file(
                        md_session,
                        project_id,
                        name=f"{source_name}_extracted.md",
                        content=md_content,
                        uploads_dir=UPLOADS_DIR,
                        folder_id=folder_id,
                        summary=f"Auto-extracted content from {Path(file_path).name}",
                        source_file_id=file_id,
                        origin="markdown_derivative",
                    )
        except Exception:
            pass


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
            _record_project_memory_failure_by_id(
                project_id,
                stage="overview_summary",
                message=str(e),
            )
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
        "memory_stale": False,
        "memory_rebuild_status": "idle",
        "memory_rebuild_failed_at": None,
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
    rebuild_job_project_ids: set[int] = set()
    for job in scheduler_service.get_jobs():
        parsed = _parse_project_memory_job(job)
        if not parsed:
            continue
        project = project_lookup.get(parsed["project_id"])
        if parsed["job_type"] == "rebuild":
            rebuild_job_project_ids.add(parsed["project_id"])
        jobs.append(
            {
                **parsed,
                "project_name": project.name if project else f"Project #{parsed['project_id']}",
                "client": project.client if project else "",
                "memory_stale": project.memory_stale if project else False,
                "memory_version": project.memory_version if project else 0,
                "status_source": "scheduler",
            }
        )

    for project in all_projects:
        if project.id in rebuild_job_project_ids:
            continue
        if project.memory_rebuild_status not in {"queued", "rebuilding"}:
            continue
        jobs.append(
            {
                "project_id": project.id,
                "job_type": "rebuild",
                "language": None,
                "job_id": f"project_memory_rebuild_status_{project.id}",
                "next_run_at": None,
                "retry_count": 0,
                "max_retries": PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS,
                "trigger": "status_only",
                "summary_types": [],
                "project_name": project.name,
                "client": project.client,
                "memory_stale": project.memory_stale,
                "memory_version": project.memory_version,
                "status_source": "project_status",
                "status_note": project.memory_rebuild_status,
            }
        )

    jobs.sort(key=lambda item: (item.get("next_run_at") or "", item["project_id"], item["job_type"]))
    used_today = _count_summary_warm_budget_used_today(session)
    recent_failures = []
    recent_successes = []
    for project in all_projects:
        failure = _get_project_memory_failure(project)
        if failure:
            recent_failures.append(
                {
                    "scope": "project",
                    "project_id": project.id,
                    "project_name": project.name,
                    "client": project.client,
                    **failure,
                }
            )
        recent_successes.extend(_get_project_memory_successes(project))
    recent_successes.extend(_get_project_summary_cache_successes(session, project_lookup))
    recent_failures.sort(key=lambda item: item.get("failed_at", ""), reverse=True)
    recent_successes.sort(key=lambda item: item.get("completed_at", ""), reverse=True)
    return {
        "jobs": jobs,
        "count": len(jobs),
        "budget": {
            "used": used_today,
            "limit": MEMORY_SUMMARY_WARM_DAILY_LIMIT,
            "remaining": max(MEMORY_SUMMARY_WARM_DAILY_LIMIT - used_today, 0),
        },
        "recent_failures": recent_failures[:8],
        "recent_successes": recent_successes[:12],
    }


@router.post("/memory/jobs/{project_id}/cancel")
def cancel_project_memory_jobs(project_id: int, session: Session = Depends(get_session)):
    scheduler_service.remove_job(_memory_rebuild_job_id(project_id))
    for language in ("zh", "en", "default"):
        scheduler_service.remove_job(_memory_summary_warm_job_id(project_id, language))
    project = session.get(Project, project_id)
    if project and project.memory_rebuild_status in {"queued", "rebuilding"}:
        project.memory_rebuild_status = "idle"
        project.memory_rebuild_failed_at = None
        session.add(project)
        session.commit()
        _bust_project(project_id)
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
    if project.memory_rebuild_status in {"queued", "rebuilding"}:
        project.memory_rebuild_status = "idle"
        project.memory_rebuild_failed_at = None
        session.add(project)
        session.commit()
        _bust_project(project_id)
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
    lock_key = _project_summary_lock_key(project_id, summary_type, normalized_language, memory_version)
    summary_lock = _get_project_summary_lock(lock_key)
    wait_for_existing_generation = summary_lock.locked()
    session_bind = session.get_bind()

    if body.stream:
        async def event_stream():
            accumulated: list[str] = []
            async with summary_lock:
                with Session(session_bind) as lock_session:
                    fresh_cached = get_project_memory_summary_cache(
                        lock_session,
                        project_id=project_id,
                        summary_type=summary_type,
                        language=normalized_language,
                        memory_version=memory_version,
                    )
                    if fresh_cached and (not body.force_refresh or wait_for_existing_generation):
                        generated_at = fresh_cached.updated_at.isoformat()
                        yield (
                            "data: "
                            + json.dumps(
                                {
                                    "type": "text",
                                    "content": fresh_cached.content,
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
                                    "content": fresh_cached.content,
                                    "source_memory_version": memory_version,
                                    "memory_stale": memory_payload.get("stale", False),
                                    "generated_at": generated_at,
                                    "cached": True,
                                },
                                ensure_ascii=False,
                            )
                            + "\n\n"
                        )
                        return

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
                    _record_project_memory_failure_by_id(
                        project_id,
                        stage=f"memory_summary:{summary_type}",
                        message=str(e),
                    )
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                    return

                content = "".join(accumulated).strip()
                with Session(session_bind) as write_session:
                    cached = save_project_memory_summary_cache(
                        write_session,
                        project_id=project_id,
                        summary_type=summary_type,
                        language=normalized_language,
                        memory_version=memory_version,
                        content=content,
                    )
                    generated_at = cached.updated_at.isoformat()
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
                            "generated_at": generated_at,
                            "cached": False,
                        },
                        ensure_ascii=False,
                    )
                    + "\n\n"
                )

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    async with summary_lock:
        fresh_cached = get_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=summary_type,
            language=normalized_language,
            memory_version=memory_version,
        )
        if fresh_cached and (not body.force_refresh or wait_for_existing_generation):
            return _build_project_memory_summary_response(
                cached=True,
                content=fresh_cached.content,
                generated_at=fresh_cached.updated_at,
                memory_payload=memory_payload,
                memory_version=memory_version,
                project_id=project_id,
                summary_type=summary_type,
            )

        try:
            content = await complete_with_selected_model(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1400,
            )
        except Exception as e:
            _set_project_memory_failure(
                session,
                project,
                stage=f"memory_summary:{summary_type}",
                message=str(e),
            )
            raise
        cached = save_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=summary_type,
            language=normalized_language,
            memory_version=memory_version,
            content=content.strip(),
        )
        return _build_project_memory_summary_response(
            cached=False,
            content=cached.content,
            generated_at=cached.updated_at,
            memory_payload=memory_payload,
            memory_version=memory_version,
            project_id=project_id,
            summary_type=summary_type,
        )


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


@router.get("/{project_id}/memory/summaries")
def get_project_memory_summaries(
    project_id: int,
    language: Optional[str] = None,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    memory_payload = get_project_memory_payload(project)
    memory_version = int(memory_payload.get("memory_version", 0) or 0)
    normalized_language = normalize_summary_language(language)

    if memory_version <= 0:
        return {
            "project_id": project_id,
            "source_memory_version": memory_version,
            "memory_stale": memory_payload.get("stale", False),
            "cached": True,
            "summaries": {},
        }

    cached_items = session.exec(
        select(ProjectMemorySummary)
        .where(ProjectMemorySummary.project_id == project_id)
        .where(ProjectMemorySummary.language == normalized_language)
        .where(ProjectMemorySummary.memory_version == memory_version)
    ).all()
    summaries = {
        item.summary_type: item
        for item in cached_items
        if item.summary_type in PROJECT_MEMORY_SUMMARY_TYPES
    }
    return _build_project_memory_summaries_response(
        cached=True,
        memory_payload=memory_payload,
        memory_version=memory_version,
        project_id=project_id,
        summaries=summaries,
    )


@router.post("/{project_id}/memory/summaries/generate")
async def generate_project_memory_summaries(
    project_id: int,
    body: ProjectMemoryGenerateSummariesRequest,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    if body.rebuild_if_stale:
        project, memory_payload = await _ensure_project_memory(session, project_id, project)
    else:
        memory_payload = get_project_memory_payload(project)

    memory_version = int(memory_payload.get("memory_version", 0) or 0)
    normalized_language = normalize_summary_language(body.language)
    summary_types = [
        item
        for item in (body.summary_types or list(PROJECT_MEMORY_SUMMARY_TYPES))
        if item in PROJECT_MEMORY_SUMMARY_TYPES
    ]
    if not summary_types:
        summary_types = list(PROJECT_MEMORY_SUMMARY_TYPES)

    if not body.force_refresh and memory_version > 0:
        cached_items = {
            summary_type: get_project_memory_summary_cache(
                session,
                project_id=project_id,
                summary_type=summary_type,
                language=normalized_language,
                memory_version=memory_version,
            )
            for summary_type in summary_types
        }
        if all(cached_items.values()):
            return _build_project_memory_summaries_response(
                cached=True,
                memory_payload=memory_payload,
                memory_version=memory_version,
                project_id=project_id,
                summaries={key: value for key, value in cached_items.items() if value},
            )

    lock_key = _project_summary_lock_key(project_id, "all", normalized_language, memory_version)
    summary_lock = _get_project_summary_lock(lock_key)
    was_locked = summary_lock.locked()
    async with summary_lock:
        if memory_version > 0 and (was_locked or not body.force_refresh):
            fresh_cached_items = {
                summary_type: get_project_memory_summary_cache(
                    session,
                    project_id=project_id,
                    summary_type=summary_type,
                    language=normalized_language,
                    memory_version=memory_version,
                )
                for summary_type in summary_types
            }
            if all(fresh_cached_items.values()):
                return _build_project_memory_summaries_response(
                    cached=True,
                    memory_payload=memory_payload,
                    memory_version=memory_version,
                    project_id=project_id,
                    summaries={key: value for key, value in fresh_cached_items.items() if value},
                )

        prompt = build_project_memory_multi_summary_prompt(
            memory_payload,
            project.name,
            summary_types=summary_types,
            language=body.language,
        )
        try:
            raw_content = await complete_with_selected_model(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=3200,
            )
            summary_contents, missing_summary_types = parse_project_memory_multi_summary_with_missing(
                raw_content,
                summary_types,
            )
            for missing_summary_type in missing_summary_types:
                summary_contents[missing_summary_type] = await _generate_single_project_memory_summary_content(
                    project,
                    memory_payload,
                    missing_summary_type,
                    body.language,
                )
        except Exception as e:
            _set_project_memory_failure(
                session,
                project,
                stage="memory_summary:all",
                message=str(e),
            )
            raise

        saved_summaries: dict[str, ProjectMemorySummary] = {}
        for summary_type, content in summary_contents.items():
            saved_summaries[summary_type] = save_project_memory_summary_cache(
                session,
                project_id=project_id,
                summary_type=summary_type,
                language=normalized_language,
                memory_version=memory_version,
                content=content.strip(),
            )

        if summary_contents.get("overview"):
            save_project_context_summary(session, project_id, summary_contents["overview"])

        return _build_project_memory_summaries_response(
            cached=False,
            memory_payload=memory_payload,
            memory_version=memory_version,
            project_id=project_id,
            summaries=saved_summaries,
        )


@router.get("/{project_id}/memory/summaries/{summary_type}")
def get_project_memory_summary(
    project_id: int,
    summary_type: str,
    language: Optional[str] = None,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    memory_payload = get_project_memory_payload(project)
    memory_version = int(memory_payload.get("memory_version", 0) or 0)
    normalized_language = normalize_summary_language(language)

    if memory_version <= 0:
        raise HTTPException(status_code=404, detail="No cached project memory summary")

    normalized_summary_type = (summary_type or "overview").strip() or "overview"
    cached_summary = get_project_memory_summary_cache(
        session,
        project_id=project_id,
        summary_type=normalized_summary_type,
        language=normalized_language,
        memory_version=memory_version,
    )
    if not cached_summary:
        raise HTTPException(status_code=404, detail="No cached project memory summary")

    return _build_project_memory_summary_response(
        cached=True,
        content=cached_summary.content,
        generated_at=cached_summary.updated_at,
        memory_payload=memory_payload,
        memory_version=memory_version,
        project_id=project_id,
        summary_type=normalized_summary_type,
    )


@router.get("/{project_id}/memory/snapshots")
def list_project_memory_snapshots(project_id: int, session: Session = Depends(get_session)):
    get_project_or_404(session, project_id)
    snapshots = session.exec(
        select(ProjectMemorySnapshot)
        .where(ProjectMemorySnapshot.project_id == project_id)
        .order_by(ProjectMemorySnapshot.created_at.desc(), ProjectMemorySnapshot.id.desc())
        .limit(30)
    ).all()
    return [
        {
            "id": snapshot.id,
            "project_id": snapshot.project_id,
            "memory_version": snapshot.memory_version,
            "trigger": snapshot.trigger,
            "created_at": snapshot.created_at.isoformat(),
        }
        for snapshot in snapshots
    ]


@router.get("/{project_id}/memory/snapshots/{snapshot_id}")
def get_project_memory_snapshot(project_id: int, snapshot_id: int, session: Session = Depends(get_session)):
    get_project_or_404(session, project_id)
    snapshot = session.get(ProjectMemorySnapshot, snapshot_id)
    if not snapshot or snapshot.project_id != project_id:
        raise HTTPException(status_code=404, detail="Memory snapshot not found")
    return {
        "id": snapshot.id,
        "project_id": snapshot.project_id,
        "memory_version": snapshot.memory_version,
        "trigger": snapshot.trigger,
        "memory": json.loads(snapshot.memory_json or "{}"),
        "created_at": snapshot.created_at.isoformat(),
    }


@router.get("/{project_id}/memory/snapshots/{snapshot_id}/diff")
def get_project_memory_snapshot_diff(project_id: int, snapshot_id: int, session: Session = Depends(get_session)):
    project = get_project_or_404(session, project_id)
    snapshot = session.get(ProjectMemorySnapshot, snapshot_id)
    if not snapshot or snapshot.project_id != project_id:
        raise HTTPException(status_code=404, detail="Memory snapshot not found")
    try:
        snapshot_memory = parse_snapshot_memory(snapshot.memory_json)
    except ValueError:
        raise HTTPException(status_code=422, detail="Memory snapshot is corrupted")

    current_memory = get_project_memory_payload(project)
    diff = build_memory_snapshot_diff(
        snapshot_memory,
        current_memory,
        ignored_fields={"last_updated_at", "rebuild_log", "stale"},
    )
    return {
        "scope": "project",
        "entity_id": project_id,
        "from_snapshot": {
            "id": snapshot.id,
            "memory_version": snapshot.memory_version,
            "trigger": snapshot.trigger,
            "created_at": snapshot.created_at.isoformat(),
        },
        "to": {
            "type": "current",
            "memory_version": project.memory_version or 0,
            "created_at": project.memory_updated_at.isoformat() if project.memory_updated_at else None,
        },
        **diff,
    }


@router.post("/{project_id}/memory/snapshots/{snapshot_id}/rollback")
def rollback_project_memory_snapshot(project_id: int, snapshot_id: int, session: Session = Depends(get_session)):
    get_project_or_404(session, project_id)
    snapshot = session.get(ProjectMemorySnapshot, snapshot_id)
    if not snapshot or snapshot.project_id != project_id:
        raise HTTPException(status_code=404, detail="Memory snapshot not found")
    try:
        memory = json.loads(snapshot.memory_json or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Memory snapshot is corrupted")
    restored = save_project_memory(
        session,
        project_id,
        memory,
        trigger=f"rollback:{snapshot.memory_version}",
    )
    _bust_project(project_id)
    return {
        "project_id": project_id,
        "restored_from_snapshot_id": snapshot.id,
        "restored_from_version": snapshot.memory_version,
        "memory": restored,
        "memory_version": restored.get("memory_version", 0),
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


# ── Include sub-routers for backward compatibility ───────────────────────────
# This ensures `from app.routers import projects; app.include_router(projects.router)`
# still registers ALL project endpoints (memory, files, briefing).
from app.routers import projects_memory as _projects_memory
from app.routers import projects_files as _projects_files
from app.routers import projects_briefing as _projects_briefing

router.include_router(_projects_memory.router)
router.include_router(_projects_files.router)
router.include_router(_projects_briefing.router)
