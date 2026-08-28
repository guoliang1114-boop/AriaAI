"""Clients sub-router: memory management endpoints."""
from __future__ import annotations

import json
import sys
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import (
    CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS,
    CLIENT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS,
    MEMORY_SUMMARY_WARM_DAILY_LIMIT,
    MEMORY_SUMMARY_WARM_INTERVAL_SECONDS,
)
from app.database import get_session
from app.models.db import ClientMemorySnapshot, ClientRecord, Project
from app.services import scheduler as scheduler_service
from app.services.cache import clients_cache
from app.services.client_contexts import (
    CORE_CLIENT_MEMORY_SUMMARY_TYPES,
    build_client_memory_data,
    build_client_memory_prompt,
    build_client_memory_promote_prompt,
    get_client_memory_summary_cache,
    get_client_memory_payload,
    parse_client_memory,
    save_client_memory,
)
from app.services.memory_snapshots import build_memory_snapshot_diff, parse_snapshot_memory
from app.services.memory_slots import get_client_memory_slot_states
from app.services.project_contexts import normalize_summary_language
from app.services.project_llm import complete_with_selected_model
from app.services.time_utils import utc_now_naive
from app.routers.clients_deps import (
    _CLIENTS_KEY,
    _ALL_CLIENT_MEMORY_SUMMARY_TYPES,
    _client_memory_rebuild_job_id,
    _client_memory_summary_warm_job_id,
    _count_client_summary_warm_budget_used_today,
    _generate_client_memory_summary_cache,
    _get_client_memory_failure,
    _get_client_memory_successes,
    _normalize_client_summary_types,
    _normalized_name,
    _parse_client_memory_job,
    _rebuild_client_memory,
    _restore_missing_client_memory_rebuild_jobs,
    _schedule_client_memory_rebuild,
    _schedule_client_memory_summary_warm,
    _warm_client_memory_summary_caches,
    ClientMemoryBatchRebuildItem,
    ClientMemoryBatchRebuildRequest,
    ClientMemoryBatchRebuildResponse,
    ClientMemoryBatchWarmSummariesRequest,
    ClientMemoryBatchWarmSummariesResponse,
    ClientMemoryJob,
    ClientMemoryJobsResponse,
    ClientMemoryResponse,
    ClientMemoryStatusResponse,
    ClientMemorySummaryRequest,
    PromoteProjectMemoryRequest,
)

from app.routers.auth import get_current_user

router = APIRouter(
    tags=["clients"],
    dependencies=[Depends(get_current_user)],
)


def _current_complete_with_selected_model():
    clients_router = sys.modules.get("app.routers.clients")
    return (
        getattr(clients_router, "complete_with_selected_model", complete_with_selected_model)
        if clients_router
        else complete_with_selected_model
    )


@router.get("/memory/jobs", response_model=ClientMemoryJobsResponse)
def list_client_memory_jobs(session: Session = Depends(get_session)):
    all_clients = session.exec(select(ClientRecord)).all()
    client_lookup = {client.id: client for client in all_clients}
    rebuild_job_client_ids = _restore_missing_client_memory_rebuild_jobs(session, all_clients)

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

    listed_rebuild_client_ids = {
        job.client_id for job in jobs if job.job_type == "rebuild" and job.client_id in rebuild_job_client_ids
    }
    for client in all_clients:
        if client.id in listed_rebuild_client_ids:
            continue
        if client.client_memory_rebuild_status not in {"queued", "rebuilding"}:
            continue
        jobs.append(
            ClientMemoryJob(
                client_id=client.id,
                client_name=client.name,
                industry=client.industry,
                job_type="rebuild",
                job_id=f"client_memory_rebuild_status_{client.id}",
                next_run_at=None,
                memory_stale=client.client_memory_stale,
                memory_version=client.client_memory_version,
                retry_count=0,
                max_retries=CLIENT_MEMORY_REBUILD_RETRY_ATTEMPTS,
                trigger="status_only",
                summary_types=[],
                status_source="client_status",
                status_note=client.client_memory_rebuild_status,
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
def cancel_client_memory_jobs(client_id: int, session: Session = Depends(get_session)):
    scheduler_service.remove_job(_client_memory_rebuild_job_id(client_id))
    for language in ("zh", "en", "default"):
        scheduler_service.remove_job(_client_memory_summary_warm_job_id(client_id, language))
    client = session.get(ClientRecord, client_id)
    if client and client.client_memory_rebuild_status in {"queued", "rebuilding"}:
        client.client_memory_rebuild_status = "idle"
        client.client_memory_rebuild_failed_at = None
        session.add(client)
        session.commit()
        clients_cache.delete(_CLIENTS_KEY)
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


@router.post("/memory/rebuild-batch", response_model=ClientMemoryBatchRebuildResponse)
async def rebuild_client_memory_batch(
    body: ClientMemoryBatchRebuildRequest,
    session: Session = Depends(get_session),
):
    rebuilt: list[ClientMemoryBatchRebuildItem] = []
    queued: list[dict] = []
    skipped: list[dict] = []
    scheduler_running = scheduler_service.is_running()

    for client_id in body.client_ids:
        client = session.get(ClientRecord, client_id)
        if not client:
            skipped.append({"client_id": client_id, "reason": "not_found"})
            continue
        if body.stale_only and not client.client_memory_stale:
            skipped.append({"client_id": client_id, "reason": "not_stale"})
            continue

        if scheduler_running:
            job_id = _client_memory_rebuild_job_id(client_id)
            if scheduler_service.get_job(job_id):
                skipped.append({"client_id": client_id, "reason": "already_queued"})
                continue
            _schedule_client_memory_rebuild(
                client_id,
                trigger="batch_rebuild",
                delay_seconds=len(queued) * CLIENT_MEMORY_REBUILD_RETRY_BASE_DELAY_SECONDS,
            )
            client.client_memory_rebuild_status = "queued"
            client.client_memory_rebuild_failed_at = None
            session.add(client)
            queued.append(
                {
                    "client_id": client_id,
                    "memory_version": client.client_memory_version,
                    "memory_stale": client.client_memory_stale,
                    "memory_rebuild_status": client.client_memory_rebuild_status,
                }
            )
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

    if queued:
        session.commit()
    clients_cache.delete(_CLIENTS_KEY)
    return ClientMemoryBatchRebuildResponse(
        ok=True,
        requested_count=len(body.client_ids),
        rebuilt_count=len(rebuilt),
        queued_count=len(queued),
        rebuilt=rebuilt,
        queued=queued,
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


@router.get("/{client_id}/memory/slots")
def get_client_memory_slots(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    slots = get_client_memory_slot_states(session, client_id)
    stale_count = sum(item["status"] in {"stale", "corrupt"} for item in slots)
    return {
        "scope": "client",
        "entity_id": client_id,
        "memory_version": int(client.client_memory_version or 0),
        "slot_count": len(slots),
        "stale_slot_count": stale_count,
        "slots": slots,
    }


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
    raw_memory = await _current_complete_with_selected_model()(
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
        raw_memory = await _current_complete_with_selected_model()(
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
