"""Shared helpers, schemas, and internal functions for clients sub-routers."""
from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from typing import Optional

from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import (
    CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS,
    CLIENT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS,
    MEMORY_REBUILD_DEBOUNCE_SECONDS,
    MEMORY_SUMMARY_WARM_DAILY_LIMIT,
    MEMORY_SUMMARY_WARM_INTERVAL_SECONDS,
    MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS,
)
from app.database import engine
from app.models.db import ClientMemorySummary, ClientRecord, ClientStakeholder
from app.services.cache import clients_cache
from app.services import scheduler as scheduler_service
from app.services.client_contexts import (
    CORE_CLIENT_MEMORY_SUMMARY_TYPES,
    EXTENDED_CLIENT_MEMORY_SUMMARY_TYPES,
    build_client_memory_data,
    build_client_memory_prompt,
    build_client_memory_summary_prompt,
    get_client_memory_summary_cache,
    get_client_memory_payload,
    mark_client_memory_stale,
    parse_client_memory,
    save_client_memory_summary_cache,
    save_client_memory,
)
from app.services.project_contexts import normalize_summary_language
from app.services.project_llm import complete_with_selected_model
from app.services.time_utils import utc_now_naive


# ── Constants ──────────────────────────────────────────────────────────────────

_CLIENTS_KEY = "all"
_CLIENTS_TTL = 120.0
_ALL_CLIENT_MEMORY_SUMMARY_TYPES = [
    *CORE_CLIENT_MEMORY_SUMMARY_TYPES,
    *EXTENDED_CLIENT_MEMORY_SUMMARY_TYPES,
]


# ── Schemas ────────────────────────────────────────────────────────────────────

class ClientCreate(BaseModel):
    name: str
    industry: str = ""
    contact: str = ""
    notes: str = ""


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class AISuggestQuery(BaseModel):
    query: str


class AISuggestion(BaseModel):
    name: str
    industry: str
    contact: str
    notes: str


class ClientOut(BaseModel):
    id: int
    name: str
    industry: str
    contact: str
    notes: str
    created_at: str
    document_count: int
    project_names: list[str]
    client_memory_version: int = 0
    client_memory_stale: bool = True
    client_memory_updated_at: Optional[str] = None
    client_memory_rebuild_status: str = "idle"
    client_memory_rebuild_failed_at: Optional[str] = None

    class Config:
        from_attributes = True


class ClientMemoryResponse(BaseModel):
    client_id: int
    memory: dict
    memory_version: int
    memory_stale: bool
    memory_updated_at: Optional[str] = None
    memory_rebuild_status: str = "idle"
    memory_rebuild_failed_at: Optional[str] = None


class ClientMemoryStatusResponse(BaseModel):
    client_id: int
    has_memory: bool
    memory_version: int
    memory_stale: bool
    memory_updated_at: Optional[str] = None
    memory_rebuild_status: str = "idle"
    memory_rebuild_failed_at: Optional[str] = None


class ClientMemoryBatchRebuildRequest(BaseModel):
    client_ids: list[int]
    stale_only: bool = True


class ClientMemoryBatchRebuildItem(BaseModel):
    client_id: int
    memory: dict
    memory_version: int
    memory_stale: bool
    memory_updated_at: Optional[str] = None
    memory_rebuild_status: str = "idle"
    memory_rebuild_failed_at: Optional[str] = None


class ClientMemoryBatchRebuildResponse(BaseModel):
    ok: bool
    requested_count: int
    rebuilt_count: int
    queued_count: int = 0
    rebuilt: list[ClientMemoryBatchRebuildItem]
    queued: list[dict] = []
    skipped: list[dict]


class ClientMemoryJob(BaseModel):
    client_id: int
    client_name: str
    industry: str = ""
    job_type: str
    language: Optional[str] = None
    job_id: str
    next_run_at: Optional[str] = None
    memory_stale: bool
    memory_version: int
    retry_count: int = 0
    max_retries: int = 0
    trigger: Optional[str] = None
    summary_types: list[str] = []
    status_source: Optional[str] = None
    status_note: Optional[str] = None


class ClientMemoryJobsResponse(BaseModel):
    jobs: list[ClientMemoryJob]
    count: int
    budget: dict = {}
    recent_failures: list[dict] = []
    recent_successes: list[dict] = []


class PromoteProjectMemoryRequest(BaseModel):
    project_id: int


class ClientStakeholderBase(BaseModel):
    name: str
    role: str = ""
    organization_level: str = ""
    influence_type: str = ""
    relationship_status: str = "unknown"
    concerns: str = ""
    sensitivities: str = ""
    communication_preference: str = ""
    contact: str = ""
    last_action: str = ""
    personality_profile: str = ""
    decision_style: str = ""
    communication_strategy: str = ""
    trust_signals: str = ""
    note: str = ""


class ClientStakeholderCreate(ClientStakeholderBase):
    pass


class ClientStakeholderUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    organization_level: Optional[str] = None
    influence_type: Optional[str] = None
    relationship_status: Optional[str] = None
    concerns: Optional[str] = None
    sensitivities: Optional[str] = None
    communication_preference: Optional[str] = None
    contact: Optional[str] = None
    last_action: Optional[str] = None
    personality_profile: Optional[str] = None
    decision_style: Optional[str] = None
    communication_strategy: Optional[str] = None
    trust_signals: Optional[str] = None
    note: Optional[str] = None


class ClientStakeholderAnalyzeRequest(BaseModel):
    linkedin_info: Optional[str] = None
    focus: Optional[str] = None


class ClientStakeholderOut(ClientStakeholderBase):
    id: int
    client_id: int
    created_at: str
    updated_at: str


class ClientMemorySummaryRequest(BaseModel):
    language: Optional[str] = None
    summary_type: Optional[str] = "overview"
    force_refresh: bool = False


class ClientMemoryBatchWarmSummariesRequest(BaseModel):
    client_ids: list[int] = []
    summary_types: list[str] = CORE_CLIENT_MEMORY_SUMMARY_TYPES.copy()
    language: Optional[str] = None
    force_refresh: bool = False


class ClientMemoryBatchWarmSummariesResponse(BaseModel):
    ok: bool
    requested_count: int
    processed_count: int
    warmed_count: int
    queued_count: int = 0
    processed: list[dict]
    skipped: list[dict]


# ── Internal helpers ───────────────────────────────────────────────────────────

def _normalized_name(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _normalize_client_summary_types(values: list[str] | None) -> list[str]:
    requested = values or CORE_CLIENT_MEMORY_SUMMARY_TYPES
    normalized: list[str] = []
    for summary_type in requested:
        candidate = (summary_type or "").strip().lower()
        if candidate in _ALL_CLIENT_MEMORY_SUMMARY_TYPES and candidate not in normalized:
            normalized.append(candidate)
    return normalized or CORE_CLIENT_MEMORY_SUMMARY_TYPES.copy()


def _get_raw_client_memory(client: ClientRecord) -> dict:
    try:
        parsed = json.loads(client.client_memory_json or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _set_client_memory_failure(
    session: Session,
    client: ClientRecord,
    *,
    stage: str,
    message: str,
    retry_count: int = 0,
) -> None:
    memory = _get_raw_client_memory(client)
    memory["_last_failure"] = {
        "category": _classify_memory_failure(stage, message),
        "stage": stage,
        "message": message[:400],
        "retry_count": retry_count,
        "failed_at": utc_now_naive().isoformat(),
    }
    client.client_memory_json = json.dumps(memory, ensure_ascii=False)
    session.add(client)
    session.commit()


def _get_client_memory_failure(client: ClientRecord) -> dict | None:
    failure = _get_raw_client_memory(client).get("_last_failure")
    return failure if isinstance(failure, dict) else None


def _get_client_memory_successes(client: ClientRecord) -> list[dict]:
    rebuild_log = _get_raw_client_memory(client).get("rebuild_log")
    if not isinstance(rebuild_log, list):
        return []

    successes: list[dict] = []
    for item in rebuild_log:
        if not isinstance(item, dict):
            continue
        completed_at = str(item.get("at") or "")
        if not completed_at:
            continue
        version = item.get("version", client.client_memory_version)
        successes.append(
            {
                "scope": "client",
                "client_id": client.id,
                "client_name": client.name,
                "stage": "rebuild",
                "status": "success",
                "message": f"Client memory rebuilt successfully at version {version}.",
                "trigger": item.get("trigger", ""),
                "version": version,
                "completed_at": completed_at,
            }
        )
    return successes


def _build_client_out(
    client: ClientRecord,
    docs_by_client: dict[int, list],
    projects_by_client_name: dict[str, list[str]],
) -> ClientOut:
    docs = docs_by_client.get(client.id, [])
    matching = projects_by_client_name.get(_normalized_name(client.name), [])
    return ClientOut(
        id=client.id,
        name=client.name,
        industry=client.industry,
        contact=client.contact,
        notes=client.notes,
        created_at=client.created_at.isoformat(),
        document_count=len(docs),
        project_names=matching,
        client_memory_version=client.client_memory_version,
        client_memory_stale=client.client_memory_stale,
        client_memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
        client_memory_rebuild_status=client.client_memory_rebuild_status,
        client_memory_rebuild_failed_at=client.client_memory_rebuild_failed_at.isoformat() if client.client_memory_rebuild_failed_at else None,
    )


def _client_out(client: ClientRecord, session: Session) -> ClientOut:
    from app.models.db import KnowledgeDocument, Project
    docs = session.exec(select(KnowledgeDocument).where(KnowledgeDocument.client_id == client.id)).all()
    all_projects = session.exec(select(Project)).all()
    client_key = _normalized_name(client.name)
    matching = [project.name for project in all_projects if _normalized_name(project.client) == client_key]
    return ClientOut(
        id=client.id,
        name=client.name,
        industry=client.industry,
        contact=client.contact,
        notes=client.notes,
        created_at=client.created_at.isoformat(),
        document_count=len(docs),
        project_names=matching,
        client_memory_version=client.client_memory_version,
        client_memory_stale=client.client_memory_stale,
        client_memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
        client_memory_rebuild_status=client.client_memory_rebuild_status,
        client_memory_rebuild_failed_at=client.client_memory_rebuild_failed_at.isoformat() if client.client_memory_rebuild_failed_at else None,
    )


def _client_memory_rebuild_job_id(client_id: int) -> str:
    return f"client_memory_rebuild_{client_id}"


def _client_memory_summary_warm_job_id(client_id: int, language: str | None = None) -> str:
    normalized_language = normalize_summary_language(language)
    return f"client_memory_summary_warm_{client_id}_{normalized_language}"


def _serialize_client_stakeholder(stakeholder: ClientStakeholder) -> ClientStakeholderOut:
    return ClientStakeholderOut(
        id=stakeholder.id,
        client_id=stakeholder.client_id,
        name=stakeholder.name,
        role=stakeholder.role,
        organization_level=stakeholder.organization_level,
        influence_type=stakeholder.influence_type,
        relationship_status=stakeholder.relationship_status,
        concerns=stakeholder.concerns,
        sensitivities=stakeholder.sensitivities,
        communication_preference=stakeholder.communication_preference,
        contact=stakeholder.contact,
        last_action=stakeholder.last_action,
        personality_profile=stakeholder.personality_profile,
        decision_style=stakeholder.decision_style,
        communication_strategy=stakeholder.communication_strategy,
        trust_signals=stakeholder.trust_signals,
        note=stakeholder.note,
        created_at=stakeholder.created_at.isoformat(),
        updated_at=stakeholder.updated_at.isoformat(),
    )


def _extract_first_json_object_from_text(raw: str) -> str:
    raw = (raw or "").strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return raw[start : end + 1]
    return "{}"


def _parse_client_memory_job(job) -> dict | None:
    if not job or not getattr(job, "id", None):
        return None
    metadata = scheduler_service.get_job_metadata(job.id)
    if job.id.startswith("client_memory_rebuild_"):
        try:
            client_id = int(job.id.removeprefix("client_memory_rebuild_"))
        except ValueError:
            return None
        return {
            "client_id": client_id,
            "job_type": "rebuild",
            "job_id": job.id,
            "next_run_at": job.next_run_time.isoformat() if getattr(job, "next_run_time", None) else None,
            "retry_count": int(metadata.get("retry_count", 0) or 0),
            "max_retries": int(metadata.get("max_retries", CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS) or 0),
            "trigger": metadata.get("trigger"),
            "summary_types": [],
        }

    if job.id.startswith("client_memory_summary_warm_"):
        raw = job.id.removeprefix("client_memory_summary_warm_")
        client_id_raw, _, language = raw.partition("_")
        try:
            client_id = int(client_id_raw)
        except ValueError:
            return None
        return {
            "client_id": client_id,
            "job_type": "summary_warm",
            "job_id": job.id,
            "next_run_at": job.next_run_time.isoformat() if getattr(job, "next_run_time", None) else None,
            "language": language or None,
            "retry_count": int(metadata.get("retry_count", 0) or 0),
            "max_retries": int(metadata.get("max_retries", MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS) or 0),
            "trigger": metadata.get("trigger"),
            "summary_types": list(metadata.get("summary_types", []) or []),
        }

    return None


async def _rebuild_client_memory(
    session: Session,
    client_id: int,
    *,
    trigger: str = "manual",
) -> dict:
    client, client_data, source_project_ids = build_client_memory_data(session, client_id)
    raw_memory = await complete_with_selected_model(
        messages=[{"role": "user", "content": build_client_memory_prompt(client_data)}],
        max_tokens=2200,
    )
    parsed_memory = parse_client_memory(raw_memory, client)
    return save_client_memory(
        session,
        client_id,
        parsed_memory,
        trigger=trigger,
        source_project_ids=source_project_ids,
    )


def _is_retryable_summary_warm_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "429" in message or "rate limit" in message or "timeout" in message


def _is_retryable_client_memory_rebuild_error(exc: Exception) -> bool:
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
    if "not found" in text or "no client" in text or "empty" in text:
        return "data"
    if "scheduler" in text or "job" in text or "queue" in text:
        return "scheduler"
    if "model" in text or "llm" in text or "claude" in text or "kimi" in text or "deepseek" in text:
        return "llm"
    return "unknown"


def _count_client_summary_warm_budget_used_today(session: Session) -> int:
    start_of_day = utc_now_naive().replace(hour=0, minute=0, second=0, microsecond=0)
    warmed = session.exec(
        select(ClientMemorySummary).where(ClientMemorySummary.created_at >= start_of_day)
    ).all()
    return len(warmed)


async def _generate_client_memory_summary_cache(
    session: Session,
    client: ClientRecord,
    memory_payload: dict,
    summary_type: str,
    language: str | None = None,
    force_refresh: bool = False,
) -> str:
    if not force_refresh:
        cached = get_client_memory_summary_cache(
            session,
            client_id=client.id,
            summary_type=summary_type,
            language=language,
            memory_version=int(memory_payload.get("memory_version", 0) or 0),
        )
        if cached:
            return cached.content

    content = await complete_with_selected_model(
        messages=[
            {
                "role": "user",
                "content": build_client_memory_summary_prompt(
                    memory_payload,
                    client.name,
                    summary_type=summary_type,
                    language=language,
                ),
            }
        ],
        max_tokens=900,
    )
    save_client_memory_summary_cache(
        session,
        client_id=client.id,
        summary_type=summary_type,
        language=language,
        memory_version=int(memory_payload.get("memory_version", 0) or 0),
        content=content.strip(),
    )
    return content.strip()


async def _warm_client_memory_summary_caches(
    session: Session,
    client: ClientRecord,
    memory_payload: dict,
    summary_types: list[str] | None = None,
    language: str | None = None,
    force_refresh: bool = False,
) -> list[str]:
    requested_types = _normalize_client_summary_types(summary_types)
    normalized_language = normalize_summary_language(language)
    warmed: list[str] = []

    for summary_type in requested_types:
        if not force_refresh:
            cached = get_client_memory_summary_cache(
                session,
                client_id=client.id,
                summary_type=summary_type,
                language=normalized_language,
                memory_version=int(memory_payload.get("memory_version", 0) or 0),
            )
            if cached:
                warmed.append(summary_type)
                continue

        await _generate_client_memory_summary_cache(
            session,
            client,
            memory_payload,
            summary_type,
            language=language,
            force_refresh=force_refresh,
        )
        warmed.append(summary_type)

    return warmed


async def _run_client_memory_summary_warm_job(
    client_id: int,
    language: str | None = None,
    summary_types: list[str] | None = None,
    force_refresh: bool = False,
    trigger: str = "background",
) -> None:
    del trigger
    with Session(engine) as session:
        client = session.get(ClientRecord, client_id)
        if not client:
            return
        memory_payload = get_client_memory_payload(client)
        if int(memory_payload.get("memory_version", 0) or 0) <= 0:
            return

        for attempt in range(MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS):
            try:
                await _warm_client_memory_summary_caches(
                    session,
                    client,
                    memory_payload,
                    summary_types=summary_types,
                    language=language,
                    force_refresh=force_refresh,
                )
                return
            except Exception as exc:
                if attempt >= MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS - 1 or not _is_retryable_summary_warm_error(exc):
                    _set_client_memory_failure(
                        session,
                        client,
                        stage="summary_warm",
                        message=str(exc),
                        retry_count=attempt,
                    )
                    raise
                wait_seconds = MEMORY_SUMMARY_WARM_INTERVAL_SECONDS * (2 ** attempt)
                await asyncio.sleep(wait_seconds)


def _schedule_client_memory_summary_warm(
    client_id: int,
    language: str | None = None,
    summary_types: list[str] | None = None,
    force_refresh: bool = False,
    delay_seconds: int = 0,
    trigger: str = "background",
) -> bool:
    if not scheduler_service.is_running():
        return False
    job_id = _client_memory_summary_warm_job_id(client_id, language)
    run_at = utc_now_naive() + timedelta(seconds=max(0, delay_seconds))
    scheduler_service.add_or_replace_date_job(
        job_id,
        run_at,
        _run_client_memory_summary_warm_job,
        args=[
            client_id,
            language,
            _normalize_client_summary_types(summary_types),
            force_refresh,
            trigger,
        ],
        metadata={
            "trigger": trigger,
            "summary_types": _normalize_client_summary_types(summary_types),
            "retry_count": 0,
            "max_retries": MEMORY_SUMMARY_WARM_RETRY_ATTEMPTS,
        },
    )
    return True


async def _run_client_memory_rebuild_job(client_id: int, trigger: str = "debounced") -> None:
    with Session(engine) as session:
        client = session.get(ClientRecord, client_id)
        if not client:
            return

        client.client_memory_rebuild_status = "rebuilding"
        client.client_memory_rebuild_failed_at = None
        session.add(client)
        session.commit()

        try:
            await _rebuild_client_memory(session, client_id, trigger=trigger)
            _schedule_client_memory_summary_warm(
                client_id,
                summary_types=CORE_CLIENT_MEMORY_SUMMARY_TYPES,
                trigger="rebuild_completed",
            )
            clients_cache.delete(_CLIENTS_KEY)
        except Exception as exc:
            client = session.get(ClientRecord, client_id)
            if client:
                if _is_retryable_client_memory_rebuild_error(exc):
                    retry_count = 0
                    if trigger.startswith("retry:"):
                        try:
                            retry_count = int(trigger.split(":", 1)[1])
                        except ValueError:
                            retry_count = 0
                    if retry_count < CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS - 1 and scheduler_service.is_running():
                        delay_seconds = CLIENT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS * (2 ** retry_count)
                        scheduler_service.add_or_replace_date_job(
                            _client_memory_rebuild_job_id(client_id),
                            utc_now_naive() + timedelta(seconds=delay_seconds),
                            _run_client_memory_rebuild_job,
                            args=[client_id, f"retry:{retry_count + 1}"],
                            metadata={
                                "trigger": trigger,
                                "retry_count": retry_count + 1,
                                "max_retries": CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS,
                            },
                        )
                        client.client_memory_rebuild_status = "queued"
                        client.client_memory_rebuild_failed_at = None
                        session.add(client)
                        session.commit()
                        return
                _set_client_memory_failure(
                    session,
                    client,
                    stage="rebuild",
                    message=str(exc),
                    retry_count=retry_count if 'retry_count' in locals() else 0,
                )
                client.client_memory_rebuild_status = "failed"
                client.client_memory_rebuild_failed_at = utc_now_naive()
                session.add(client)
                session.commit()
            raise


def _schedule_client_memory_rebuild(
    client_id: int,
    trigger: str = "data_changed",
    *,
    delay_seconds: int | None = None,
) -> None:
    if not scheduler_service.is_running():
        return
    run_at = utc_now_naive() + timedelta(
        seconds=MEMORY_REBUILD_DEBOUNCE_SECONDS if delay_seconds is None else max(0, delay_seconds)
    )
    scheduler_service.add_or_replace_date_job(
        _client_memory_rebuild_job_id(client_id),
        run_at,
        _run_client_memory_rebuild_job,
        args=[client_id, trigger],
        metadata={
            "trigger": trigger,
            "retry_count": 0,
            "max_retries": CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS,
        },
    )


def _restore_missing_client_memory_rebuild_jobs(session: Session, clients: list[ClientRecord]) -> set[int]:
    rebuild_job_client_ids: set[int] = set()
    for job in scheduler_service.get_jobs():
        parsed = _parse_client_memory_job(job)
        if parsed and parsed.get("job_type") == "rebuild":
            rebuild_job_client_ids.add(int(parsed["client_id"]))

    if not scheduler_service.is_running():
        return rebuild_job_client_ids

    restore_index = 0
    updated_status = False
    for client in clients:
        if client.id in rebuild_job_client_ids:
            continue
        needs_rebuild = (
            client.client_memory_rebuild_status in {"queued", "rebuilding"}
            or bool(client.client_memory_stale)
            or int(client.client_memory_version or 0) <= 0
        )
        if not needs_rebuild:
            continue

        _schedule_client_memory_rebuild(
            client.id,
            trigger="restore_missing_job",
            delay_seconds=restore_index * CLIENT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS,
        )
        if client.client_memory_rebuild_status != "rebuilding":
            client.client_memory_rebuild_status = "queued"
            client.client_memory_rebuild_failed_at = None
            session.add(client)
            updated_status = True
        rebuild_job_client_ids.add(client.id)
        restore_index += 1

    if updated_status:
        session.commit()
        clients_cache.delete(_CLIENTS_KEY)

    return rebuild_job_client_ids


def _mark_client_memory_stale(session: Session, client_id: int, trigger: str = "data_changed") -> None:
    mark_client_memory_stale(session, client_id, trigger=trigger)
    client = session.get(ClientRecord, client_id)
    _schedule_client_memory_rebuild(client_id, trigger=trigger)
    if client and client.client_memory_rebuild_status != "rebuilding":
        client.client_memory_rebuild_status = "queued" if scheduler_service.is_running() else "idle"
        session.add(client)
        session.commit()
