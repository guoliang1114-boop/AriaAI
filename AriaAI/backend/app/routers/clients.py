"""Client management router — CRUD for clients, related docs/projects, and client memory."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
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
from app.database import engine, get_session
from app.models.db import ClientMemorySnapshot, ClientMemorySummary, ClientRecord, ClientStakeholder, KnowledgeDocument, Project
from app.services.cache import clients_cache
from app.services.claude import complete
from app.services import scheduler as scheduler_service
from app.services.client_contexts import (
    CORE_CLIENT_MEMORY_SUMMARY_TYPES,
    EXTENDED_CLIENT_MEMORY_SUMMARY_TYPES,
    build_client_memory_data,
    build_client_memory_prompt,
    build_client_memory_promote_prompt,
    build_client_memory_summary_prompt,
    get_client_memory_summary_cache,
    get_client_memory_payload,
    mark_client_memory_stale,
    parse_client_memory,
    save_client_memory_summary_cache,
    save_client_memory,
)
from app.services.memory_snapshots import build_memory_snapshot_diff, parse_snapshot_memory
from app.services.project_contexts import normalize_summary_language
from app.services.project_llm import complete_with_selected_model
from app.services.time_utils import utc_now_naive

_CLIENTS_KEY = "all"
_CLIENTS_TTL = 120.0
_ALL_CLIENT_MEMORY_SUMMARY_TYPES = [
    *CORE_CLIENT_MEMORY_SUMMARY_TYPES,
    *EXTENDED_CLIENT_MEMORY_SUMMARY_TYPES,
]

router = APIRouter(prefix="/clients", tags=["clients"])


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
    rebuilt: list[ClientMemoryBatchRebuildItem]
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
    note: Optional[str] = None


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
        note=stakeholder.note,
        created_at=stakeholder.created_at.isoformat(),
        updated_at=stakeholder.updated_at.isoformat(),
    )


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
    if "database" in text or "sql" in text or "psycopg" in text or "sqlite" in text:
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


def _schedule_client_memory_rebuild(client_id: int, trigger: str = "data_changed") -> None:
    if not scheduler_service.is_running():
        return
    run_at = utc_now_naive() + timedelta(seconds=MEMORY_REBUILD_DEBOUNCE_SECONDS)
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


def _mark_client_memory_stale(session: Session, client_id: int, trigger: str = "data_changed") -> None:
    mark_client_memory_stale(session, client_id, trigger=trigger)
    client = session.get(ClientRecord, client_id)
    _schedule_client_memory_rebuild(client_id, trigger=trigger)
    if client and client.client_memory_rebuild_status != "rebuilding":
        client.client_memory_rebuild_status = "queued" if scheduler_service.is_running() else "idle"
        session.add(client)
        session.commit()


@router.get("", response_model=list[ClientOut])
def list_clients(session: Session = Depends(get_session)):
    cached = clients_cache.get(_CLIENTS_KEY)
    if cached is not None:
        return cached

    clients = session.exec(select(ClientRecord).order_by(ClientRecord.name)).all()
    all_docs = session.exec(select(KnowledgeDocument)).all()
    all_projects = session.exec(select(Project)).all()

    docs_by_client: dict[int, list] = {}
    for document in all_docs:
        if document.client_id is not None:
            docs_by_client.setdefault(document.client_id, []).append(document)

    projects_by_name: dict[str, list[str]] = {}
    for project in all_projects:
        key = _normalized_name(project.client)
        if key:
            projects_by_name.setdefault(key, []).append(project.name)

    result = [_build_client_out(client, docs_by_client, projects_by_name) for client in clients]
    clients_cache.set(_CLIENTS_KEY, result, _CLIENTS_TTL)
    return result


@router.post("", response_model=ClientOut)
def create_client(body: ClientCreate, session: Session = Depends(get_session)):
    client = ClientRecord(**body.model_dump())
    session.add(client)
    session.commit()
    session.refresh(client)
    _mark_client_memory_stale(session, client.id, trigger="client_created")
    clients_cache.delete(_CLIENTS_KEY)
    return _client_out(client, session)


@router.get("/memory/jobs", response_model=ClientMemoryJobsResponse)
def list_client_memory_jobs(session: Session = Depends(get_session)):
    all_clients = session.exec(select(ClientRecord)).all()
    client_lookup = {client.id: client for client in all_clients}

    jobs: list[ClientMemoryJob] = []
    for job in scheduler_service.get_jobs():
        parsed = _parse_client_memory_job(job)
        if not parsed:
            continue
        client = client_lookup.get(parsed["client_id"])
        jobs.append(
            ClientMemoryJob(
                **parsed,
                client_name=client.name if client else f"Client #{parsed['client_id']}",
                industry=client.industry if client else "",
                memory_stale=client.client_memory_stale if client else True,
                memory_version=client.client_memory_version if client else 0,
            )
        )

    jobs.sort(key=lambda item: ((item.next_run_at or ""), item.client_id, item.job_type))
    used_today = _count_client_summary_warm_budget_used_today(session)
    recent_failures = []
    recent_successes = []
    for client in all_clients:
        failure = _get_client_memory_failure(client)
        if failure:
            recent_failures.append(
                {
                    "scope": "client",
                    "client_id": client.id,
                    "client_name": client.name,
                    **failure,
                }
            )
        recent_successes.extend(_get_client_memory_successes(client))
    recent_failures.sort(key=lambda item: item.get("failed_at", ""), reverse=True)
    recent_successes.sort(key=lambda item: item.get("completed_at", ""), reverse=True)
    return ClientMemoryJobsResponse(
        jobs=jobs,
        count=len(jobs),
        budget={
            "used": used_today,
            "limit": MEMORY_SUMMARY_WARM_DAILY_LIMIT,
            "remaining": max(MEMORY_SUMMARY_WARM_DAILY_LIMIT - used_today, 0),
        },
        recent_failures=recent_failures[:8],
        recent_successes=recent_successes[:12],
    )


@router.post("/memory/jobs/{client_id}/cancel")
def cancel_client_memory_jobs(client_id: int):
    scheduler_service.remove_job(_client_memory_rebuild_job_id(client_id))
    for language in ("zh", "en", "default"):
        scheduler_service.remove_job(_client_memory_summary_warm_job_id(client_id, language))
    return {"ok": True, "client_id": client_id}


@router.post("/memory/jobs/{client_id}/run-now")
async def run_client_memory_jobs_now(
    client_id: int,
    session: Session = Depends(get_session),
):
    scheduler_service.remove_job(_client_memory_rebuild_job_id(client_id))
    for language in ("zh", "en", "default"):
        scheduler_service.remove_job(_client_memory_summary_warm_job_id(client_id, language))
    payload = await _rebuild_client_memory(session, client_id, trigger="manual_queue_run")
    clients_cache.delete(_CLIENTS_KEY)
    refreshed = session.get(ClientRecord, client_id)
    return {
        "ok": True,
        "action": "rebuild",
        "client_id": client_id,
        "memory_version": refreshed.client_memory_version if refreshed else 0,
        "memory_stale": refreshed.client_memory_stale if refreshed else True,
        "memory_updated_at": refreshed.client_memory_updated_at.isoformat() if refreshed and refreshed.client_memory_updated_at else None,
        "memory_rebuild_status": refreshed.client_memory_rebuild_status if refreshed else "idle",
        "memory_rebuild_failed_at": refreshed.client_memory_rebuild_failed_at.isoformat()
        if refreshed and refreshed.client_memory_rebuild_failed_at
        else None,
        "memory": payload,
    }


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return _client_out(client, session)


@router.put("/{client_id}", response_model=ClientOut)
def update_client(client_id: int, body: ClientUpdate, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(client, field, value)
    session.add(client)
    session.commit()
    session.refresh(client)
    _mark_client_memory_stale(session, client_id, trigger="client_updated")
    clients_cache.delete(_CLIENTS_KEY)
    return _client_out(client, session)


@router.delete("/{client_id}", status_code=204)
def delete_client(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    docs = session.exec(select(KnowledgeDocument).where(KnowledgeDocument.client_id == client_id)).all()
    for document in docs:
        document.client_id = None
        session.add(document)
    session.delete(client)
    session.commit()
    clients_cache.delete(_CLIENTS_KEY)


@router.get("/{client_id}/documents")
def list_client_documents(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return session.exec(select(KnowledgeDocument).where(KnowledgeDocument.client_id == client_id)).all()


@router.get("/{client_id}/projects")
def list_client_projects(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    client_key = _normalized_name(client.name)
    matching = [
        project
        for project in session.exec(select(Project)).all()
        if _normalized_name(project.client) == client_key
    ]
    return [
        {
            "id": project.id,
            "name": project.name,
            "status": project.status,
            "contract_amount": project.contract_amount,
            "memory_version": project.memory_version,
            "memory_stale": project.memory_stale,
        }
        for project in matching
    ]


@router.get("/{client_id}/stakeholders", response_model=list[ClientStakeholderOut])
def list_client_stakeholders(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholders = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client_id)
        .order_by(ClientStakeholder.updated_at.desc(), ClientStakeholder.id.desc())
    ).all()
    return [_serialize_client_stakeholder(stakeholder) for stakeholder in stakeholders]


@router.post("/{client_id}/stakeholders", response_model=ClientStakeholderOut, status_code=201)
def create_client_stakeholder(
    client_id: int,
    body: ClientStakeholderCreate,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Stakeholder name is required")
    stakeholder = ClientStakeholder(client_id=client_id, **body.model_dump())
    stakeholder.name = name
    session.add(stakeholder)
    session.commit()
    session.refresh(stakeholder)
    _mark_client_memory_stale(session, client_id, trigger="stakeholder_created")
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder(stakeholder)


@router.put("/{client_id}/stakeholders/{stakeholder_id}", response_model=ClientStakeholderOut)
def update_client_stakeholder(
    client_id: int,
    stakeholder_id: int,
    body: ClientStakeholderUpdate,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client_id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")

    values = body.model_dump(exclude_none=True)
    if "name" in values:
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise HTTPException(status_code=400, detail="Stakeholder name is required")
    for field, value in values.items():
        setattr(stakeholder, field, value)
    stakeholder.updated_at = utc_now_naive()
    session.add(stakeholder)
    session.commit()
    session.refresh(stakeholder)
    _mark_client_memory_stale(session, client_id, trigger="stakeholder_updated")
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder(stakeholder)


@router.delete("/{client_id}/stakeholders/{stakeholder_id}", status_code=204)
def delete_client_stakeholder(
    client_id: int,
    stakeholder_id: int,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client_id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")
    session.delete(stakeholder)
    session.commit()
    _mark_client_memory_stale(session, client_id, trigger="stakeholder_deleted")
    clients_cache.delete(_CLIENTS_KEY)
    return None


@router.post("/{client_id}/documents/{doc_id}", status_code=200)
def link_document(client_id: int, doc_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    document = session.get(KnowledgeDocument, doc_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    document.client_id = client_id
    session.add(document)
    session.commit()
    _mark_client_memory_stale(session, client_id, trigger="document_linked")
    return {"ok": True}


@router.delete("/{client_id}/documents/{doc_id}", status_code=200)
def unlink_document(client_id: int, doc_id: int, session: Session = Depends(get_session)):
    document = session.get(KnowledgeDocument, doc_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    original_client_id = document.client_id
    document.client_id = None
    session.add(document)
    session.commit()
    if original_client_id:
        _mark_client_memory_stale(session, original_client_id, trigger="document_unlinked")
    return {"ok": True}


@router.get("/{client_id}/memory", response_model=ClientMemoryResponse)
def get_client_memory(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientMemoryResponse(
        client_id=client_id,
        memory=get_client_memory_payload(client),
        memory_version=client.client_memory_version,
        memory_stale=client.client_memory_stale,
        memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
        memory_rebuild_status=client.client_memory_rebuild_status,
        memory_rebuild_failed_at=client.client_memory_rebuild_failed_at.isoformat() if client.client_memory_rebuild_failed_at else None,
    )


@router.get("/{client_id}/memory/status", response_model=ClientMemoryStatusResponse)
def get_client_memory_status(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientMemoryStatusResponse(
        client_id=client_id,
        has_memory=(client.client_memory_version or 0) > 0,
        memory_version=client.client_memory_version,
        memory_stale=client.client_memory_stale,
        memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
        memory_rebuild_status=client.client_memory_rebuild_status,
        memory_rebuild_failed_at=client.client_memory_rebuild_failed_at.isoformat() if client.client_memory_rebuild_failed_at else None,
    )


@router.get("/{client_id}/memory/snapshots")
def list_client_memory_snapshots(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    snapshots = session.exec(
        select(ClientMemorySnapshot)
        .where(ClientMemorySnapshot.client_id == client_id)
        .order_by(ClientMemorySnapshot.created_at.desc(), ClientMemorySnapshot.id.desc())
        .limit(30)
    ).all()
    return [
        {
            "id": snapshot.id,
            "client_id": snapshot.client_id,
            "memory_version": snapshot.memory_version,
            "trigger": snapshot.trigger,
            "created_at": snapshot.created_at.isoformat(),
        }
        for snapshot in snapshots
    ]


@router.get("/{client_id}/memory/snapshots/{snapshot_id}")
def get_client_memory_snapshot(client_id: int, snapshot_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    snapshot = session.get(ClientMemorySnapshot, snapshot_id)
    if not snapshot or snapshot.client_id != client_id:
        raise HTTPException(status_code=404, detail="Client memory snapshot not found")
    return {
        "id": snapshot.id,
        "client_id": snapshot.client_id,
        "memory_version": snapshot.memory_version,
        "trigger": snapshot.trigger,
        "memory": json.loads(snapshot.memory_json or "{}"),
        "created_at": snapshot.created_at.isoformat(),
    }


@router.get("/{client_id}/memory/snapshots/{snapshot_id}/diff")
def get_client_memory_snapshot_diff(client_id: int, snapshot_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    snapshot = session.get(ClientMemorySnapshot, snapshot_id)
    if not snapshot or snapshot.client_id != client_id:
        raise HTTPException(status_code=404, detail="Client memory snapshot not found")
    try:
        snapshot_memory = parse_snapshot_memory(snapshot.memory_json)
    except ValueError:
        raise HTTPException(status_code=422, detail="Client memory snapshot is corrupted")

    current_memory = get_client_memory_payload(client)
    diff = build_memory_snapshot_diff(
        snapshot_memory,
        current_memory,
        ignored_fields={"last_updated_at", "rebuild_log", "stale"},
    )
    return {
        "scope": "client",
        "entity_id": client_id,
        "from_snapshot": {
            "id": snapshot.id,
            "memory_version": snapshot.memory_version,
            "trigger": snapshot.trigger,
            "created_at": snapshot.created_at.isoformat(),
        },
        "to": {
            "type": "current",
            "memory_version": client.client_memory_version or 0,
            "created_at": client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
        },
        **diff,
    }


@router.post("/{client_id}/memory/snapshots/{snapshot_id}/rollback", response_model=ClientMemoryResponse)
def rollback_client_memory_snapshot(client_id: int, snapshot_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    snapshot = session.get(ClientMemorySnapshot, snapshot_id)
    if not snapshot or snapshot.client_id != client_id:
        raise HTTPException(status_code=404, detail="Client memory snapshot not found")
    try:
        memory = json.loads(snapshot.memory_json or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Client memory snapshot is corrupted")

    payload = save_client_memory(
        session,
        client_id,
        memory,
        trigger=f"rollback:{snapshot.memory_version}",
    )
    clients_cache.delete(_CLIENTS_KEY)
    refreshed = session.get(ClientRecord, client_id)
    return ClientMemoryResponse(
        client_id=client_id,
        memory=payload,
        memory_version=refreshed.client_memory_version if refreshed else 0,
        memory_stale=refreshed.client_memory_stale if refreshed else True,
        memory_updated_at=refreshed.client_memory_updated_at.isoformat() if refreshed and refreshed.client_memory_updated_at else None,
        memory_rebuild_status=refreshed.client_memory_rebuild_status if refreshed else "idle",
        memory_rebuild_failed_at=refreshed.client_memory_rebuild_failed_at.isoformat()
        if refreshed and refreshed.client_memory_rebuild_failed_at
        else None,
    )


@router.post("/memory/rebuild-batch", response_model=ClientMemoryBatchRebuildResponse)
async def rebuild_client_memory_batch(
    body: ClientMemoryBatchRebuildRequest,
    session: Session = Depends(get_session),
):
    rebuilt: list[ClientMemoryBatchRebuildItem] = []
    skipped: list[dict] = []

    for client_id in body.client_ids:
        client = session.get(ClientRecord, client_id)
        if not client:
            skipped.append({"client_id": client_id, "reason": "not_found"})
            continue
        if body.stale_only and not client.client_memory_stale:
            skipped.append({"client_id": client_id, "reason": "not_stale"})
            continue

        payload = await _rebuild_client_memory(session, client_id, trigger="batch_rebuild")
        refreshed = session.get(ClientRecord, client_id)
        rebuilt.append(
            ClientMemoryBatchRebuildItem(
                client_id=client_id,
                memory=payload,
                memory_version=refreshed.client_memory_version if refreshed else 0,
                memory_stale=refreshed.client_memory_stale if refreshed else True,
                memory_updated_at=refreshed.client_memory_updated_at.isoformat()
                if refreshed and refreshed.client_memory_updated_at
                else None,
                memory_rebuild_status=refreshed.client_memory_rebuild_status if refreshed else "idle",
                memory_rebuild_failed_at=refreshed.client_memory_rebuild_failed_at.isoformat()
                if refreshed and refreshed.client_memory_rebuild_failed_at
                else None,
            )
        )
        _schedule_client_memory_summary_warm(
            client_id,
            summary_types=CORE_CLIENT_MEMORY_SUMMARY_TYPES,
            trigger="batch_rebuild_completed",
        )

    clients_cache.delete(_CLIENTS_KEY)
    return ClientMemoryBatchRebuildResponse(
        ok=True,
        requested_count=len(body.client_ids),
        rebuilt_count=len(rebuilt),
        rebuilt=rebuilt,
        skipped=skipped,
    )


@router.post("/memory/warm-summaries-batch", response_model=ClientMemoryBatchWarmSummariesResponse)
async def warm_client_memory_summaries_batch(
    body: ClientMemoryBatchWarmSummariesRequest,
    session: Session = Depends(get_session),
):
    requested_ids = [int(client_id) for client_id in body.client_ids if int(client_id) > 0]
    if not requested_ids:
        return ClientMemoryBatchWarmSummariesResponse(
            ok=True,
            requested_count=0,
            processed_count=0,
            warmed_count=0,
            processed=[],
            skipped=[],
        )

    candidate_clients = session.exec(select(ClientRecord).where(ClientRecord.id.in_(requested_ids))).all()
    client_lookup = {client.id: client for client in candidate_clients}
    processed: list[dict] = []
    skipped: list[dict] = []
    warmed_count = 0
    queued_count = 0
    normalized_summary_types = _normalize_client_summary_types(body.summary_types)
    scheduler_running = scheduler_service.is_running()
    budget_used_today = _count_client_summary_warm_budget_used_today(session) if scheduler_running else 0

    for client_id in requested_ids:
        if client_id not in client_lookup:
            skipped.append({"client_id": client_id, "reason": "not_found"})

    for client in [client_lookup[client_id] for client_id in requested_ids if client_id in client_lookup]:
        memory_payload = get_client_memory_payload(client)
        memory_version = int(memory_payload.get("memory_version", 0) or 0)
        if memory_version <= 0:
            skipped.append({"client_id": client.id, "reason": "memory_missing"})
            continue

        if scheduler_running:
            if budget_used_today + queued_count >= MEMORY_SUMMARY_WARM_DAILY_LIMIT:
                skipped.append({"client_id": client.id, "reason": "daily_limit_reached"})
                continue

            job_id = _client_memory_summary_warm_job_id(client.id, body.language)
            if scheduler_service.get_job(job_id):
                skipped.append({"client_id": client.id, "reason": "already_queued"})
                continue

            queued = _schedule_client_memory_summary_warm(
                client.id,
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
                        "client_id": client.id,
                        "summary_types": normalized_summary_types,
                        "memory_version": memory_version,
                        "mode": "queued",
                    }
                )
                continue

        warmed_types = await _warm_client_memory_summary_caches(
            session,
            client,
            memory_payload,
            summary_types=normalized_summary_types,
            language=body.language,
            force_refresh=body.force_refresh,
        )
        warmed_count += len(warmed_types)
        processed.append(
            {
                "client_id": client.id,
                "summary_types": warmed_types,
                "memory_version": memory_version,
                "mode": "inline",
            }
        )

    return ClientMemoryBatchWarmSummariesResponse(
        ok=True,
        requested_count=len(requested_ids),
        processed_count=len(processed),
        warmed_count=warmed_count,
        queued_count=queued_count,
        processed=processed,
        skipped=skipped,
    )


@router.post("/{client_id}/memory/rebuild", response_model=ClientMemoryResponse)
async def rebuild_client_memory(client_id: int, session: Session = Depends(get_session)):
    payload = await _rebuild_client_memory(session, client_id, trigger="manual")
    _schedule_client_memory_summary_warm(
        client_id,
        summary_types=CORE_CLIENT_MEMORY_SUMMARY_TYPES,
        trigger="manual_rebuild_completed",
    )
    clients_cache.delete(_CLIENTS_KEY)
    refreshed = session.get(ClientRecord, client_id)
    return ClientMemoryResponse(
        client_id=client_id,
        memory=payload,
        memory_version=refreshed.client_memory_version if refreshed else 0,
        memory_stale=refreshed.client_memory_stale if refreshed else True,
        memory_updated_at=refreshed.client_memory_updated_at.isoformat() if refreshed and refreshed.client_memory_updated_at else None,
        memory_rebuild_status=refreshed.client_memory_rebuild_status if refreshed else "idle",
        memory_rebuild_failed_at=refreshed.client_memory_rebuild_failed_at.isoformat()
        if refreshed and refreshed.client_memory_rebuild_failed_at
        else None,
    )


@router.post("/{client_id}/memory/promote-project", response_model=ClientMemoryResponse)
async def promote_project_memory_to_client(
    client_id: int,
    body: PromoteProjectMemoryRequest,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if _normalized_name(project.client) != _normalized_name(client.name):
        raise HTTPException(status_code=400, detail="Project does not belong to this client")

    try:
        project_memory = json.loads(project.context_memory_json or "{}")
        if not isinstance(project_memory, dict):
            project_memory = {}
    except json.JSONDecodeError:
        project_memory = {}

    current_memory = get_client_memory_payload(client)
    raw_memory = await complete_with_selected_model(
        messages=[
            {
                "role": "user",
                "content": build_client_memory_promote_prompt(current_memory, project.name, project_memory),
            }
        ],
        max_tokens=2200,
    )
    parsed_memory = parse_client_memory(raw_memory, client)
    payload = save_client_memory(
        session,
        client_id,
        parsed_memory,
        trigger="project_promoted",
        source_project_ids=[project.id],
    )
    _schedule_client_memory_summary_warm(
        client_id,
        summary_types=CORE_CLIENT_MEMORY_SUMMARY_TYPES,
        trigger="project_promoted_completed",
    )
    clients_cache.delete(_CLIENTS_KEY)
    refreshed = session.get(ClientRecord, client_id)
    return ClientMemoryResponse(
        client_id=client_id,
        memory=payload,
        memory_version=refreshed.client_memory_version if refreshed else 0,
        memory_stale=refreshed.client_memory_stale if refreshed else True,
        memory_updated_at=refreshed.client_memory_updated_at.isoformat() if refreshed and refreshed.client_memory_updated_at else None,
        memory_rebuild_status=refreshed.client_memory_rebuild_status if refreshed else "idle",
        memory_rebuild_failed_at=refreshed.client_memory_rebuild_failed_at.isoformat()
        if refreshed and refreshed.client_memory_rebuild_failed_at
        else None,
    )


@router.post("/{client_id}/memory/summarize")
async def summarize_client_memory(
    client_id: int,
    body: ClientMemorySummaryRequest,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    memory = get_client_memory_payload(client)
    if (client.client_memory_version or 0) == 0 or client.client_memory_stale:
        client, client_data, source_project_ids = build_client_memory_data(session, client_id)
        raw_memory = await complete_with_selected_model(
            messages=[{"role": "user", "content": build_client_memory_prompt(client_data)}],
            max_tokens=2200,
        )
        parsed_memory = parse_client_memory(raw_memory, client)
        memory = save_client_memory(
            session,
            client_id,
            parsed_memory,
            trigger="on_demand",
            source_project_ids=source_project_ids,
        )
        _schedule_client_memory_summary_warm(
            client_id,
            summary_types=CORE_CLIENT_MEMORY_SUMMARY_TYPES,
            trigger="on_demand_rebuild_completed",
        )

    normalized_language = normalize_summary_language(body.language)
    normalized_summary_type = (body.summary_type or "overview").strip().lower() or "overview"
    if not body.force_refresh:
        cached = get_client_memory_summary_cache(
            session,
            client_id=client_id,
            summary_type=normalized_summary_type,
            language=body.language,
            memory_version=int(memory.get("memory_version", 0) or 0),
        )
        if cached:
            return {
                "client_id": client_id,
                "language": normalized_language,
                "summary_type": normalized_summary_type,
                "content": cached.content,
                "memory_version": int(memory.get("memory_version", 0) or 0),
                "generated_at": cached.updated_at.isoformat(),
                "cached": True,
            }

    content = await _generate_client_memory_summary_cache(
        session,
        client,
        memory,
        normalized_summary_type,
        language=body.language,
        force_refresh=True,
    )
    cached = get_client_memory_summary_cache(
        session,
        client_id=client_id,
        summary_type=normalized_summary_type,
        language=body.language,
        memory_version=int(memory.get("memory_version", 0) or 0),
    )
    return {
        "client_id": client_id,
        "language": normalized_language,
        "summary_type": normalized_summary_type,
        "content": content,
        "memory_version": int(memory.get("memory_version", 0) or 0),
        "generated_at": cached.updated_at.isoformat() if cached else utc_now_naive().isoformat(),
        "cached": False,
    }


@router.get("/{client_id}/memory/summaries/{summary_type}")
def get_client_memory_summary(
    client_id: int,
    summary_type: str,
    language: Optional[str] = None,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    memory_version = int(client.client_memory_version or 0)
    if memory_version <= 0:
        raise HTTPException(status_code=404, detail="No cached client memory summary")

    normalized_language = normalize_summary_language(language)
    normalized_summary_type = (summary_type or "overview").strip().lower() or "overview"
    cached = get_client_memory_summary_cache(
        session,
        client_id=client_id,
        summary_type=normalized_summary_type,
        language=normalized_language,
        memory_version=memory_version,
    )
    if not cached:
        raise HTTPException(status_code=404, detail="No cached client memory summary")

    return {
        "client_id": client_id,
        "language": normalized_language,
        "summary_type": normalized_summary_type,
        "content": cached.content,
        "memory_version": memory_version,
        "generated_at": cached.updated_at.isoformat(),
        "cached": True,
    }


@router.post("/ai-suggest", response_model=list[AISuggestion])
async def ai_suggest(body: AISuggestQuery):
    system = (
        "You are an expert business analyst assistant for a consulting firm. "
        "When given a company name or description, return structured client profile suggestions."
    )
    prompt = f"""The user typed: "{body.query}"

Based on this, generate 1 to 3 plausible client profile suggestions for a consulting firm CRM.
If the query is unambiguous, return 1 suggestion.
If the query could match multiple entities, return up to 3 distinct suggestions.

Return ONLY a valid JSON array with this exact schema:
[
  {{
    "name": "Full official company name",
    "industry": "Industry / sector",
    "contact": "",
    "notes": "1-2 sentence background relevant to consulting engagements"
  }}
]
"""

    try:
        raw = await complete(
            messages=[{"role": "user", "content": prompt}],
            system=system,
            max_tokens=800,
        )
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        suggestions = json.loads(text)
        return [AISuggestion(**item) for item in suggestions[:3]]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {exc}") from exc
