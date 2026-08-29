"""Projects sub-router: memory management endpoints."""
from __future__ import annotations

import json
import asyncio
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlmodel import Session, select

from app.config import (
    MEMORY_SUMMARY_WARM_DAILY_LIMIT,
    MEMORY_SUMMARY_WARM_INTERVAL_SECONDS,
    PROJECT_MEMORY_REBUILD_RETRY_ATTEMPTS,
)
from app.routers.projects_deps import get_session
from app.database import engine
from app.models.db import Project, ProjectMemorySnapshot, ProjectMemorySummary
from app.services import scheduler as scheduler_service
from app.services.project_contexts import (
    EDITABLE_MEMORY_SLOTS,
    PROJECT_MEMORY_SUMMARY_TYPES,
    _get_existing_raw_memory,
    _normalize_editable_slot,
    build_project_memory_multi_summary_prompt,
    build_project_memory_view_prompt,
    build_project_summary_from_memory_prompt,
    get_project_memory_summary_cache,
    get_project_memory_payload,
    normalize_summary_language,
    parse_project_memory_multi_summary_with_missing,
    save_project_memory,
    save_project_context_summary,
    save_project_memory_summary_cache,
    stream_llm_text_chunks,
)
from app.services.project_core import get_project_or_404
from app.routers.projects_deps import complete_with_selected_model, stream_with_selected_model
from app.services.memory_snapshots import build_memory_snapshot_diff, parse_snapshot_memory
from app.services.memory_facts import get_project_memory_fact_states
from app.services.memory_slots import get_project_memory_slot_states
from app.services.memory_rebuilds import latest_memory_rebuild_metadata
from app.routers.projects_deps import get_current_user
from app.routers.projects_deps import (
    _get_project_memory_lock,
    _get_project_summary_lock,
    _project_summary_lock_key,
    _bust_project,
    _memory_rebuild_job_id,
    _memory_summary_warm_job_id,
    _generate_single_project_memory_summary_content,
    _parse_project_memory_job,
    _count_summary_warm_budget_used_today,
    _get_project_memory_failure,
    _get_project_memory_successes,
    _get_project_summary_cache_successes,
    _record_project_memory_failure_by_id,
    _build_project_memory_summary_response,
    _generate_memory_summary_cache,
    _warm_project_memory_summary_caches,
    _schedule_project_memory_summary_warm,
    _rebuild_project_memory,
    _ensure_project_memory,
    _set_project_memory_failure,
    _build_project_memory_summaries_response,
    ProjectContextGenerateRequest,
    ProjectMemorySummarizeRequest,
    ProjectMemoryGenerateSummariesRequest,
    ProjectMemorySlotUpdateRequest,
    ProjectMemoryBatchRebuildRequest,
    ProjectMemoryBatchWarmSummariesRequest,
)

logger = logging.getLogger(__name__)

from app.routers.auth import require_admin
from app.routers.chat_security import maybe_require_project_access

router = APIRouter(
    tags=["projects"],
    # Router-level membership gate. The dep no-ops on endpoints
    # without a ``project_id`` path param (the global /memory/list,
    # /memory/jobs etc. admin endpoints), which keeps the cross-
    # project ops accessible while still locking down the
    # /{project_id}/memory/* surface.
    dependencies=[Depends(maybe_require_project_access)],
)


def _project_memory_search_conditions(search: str | None):
    query = " ".join(str(search or "").strip().lower().split())
    if not query:
        return []
    pattern = f"%{query}%"
    return [
        or_(
            func.lower(Project.name).like(pattern),
            func.lower(Project.client).like(pattern),
            func.lower(Project.context_summary).like(pattern),
        )
    ]


def _project_memory_status_conditions(status: str | None):
    normalized = (status or "all").strip().lower()
    if normalized == "ready":
        return [Project.memory_version > 0, Project.memory_stale == False]
    if normalized == "stale":
        return [Project.memory_version > 0, Project.memory_stale == True]
    if normalized == "missing":
        return [Project.memory_version <= 0]
    return []


def _count_projects(session: Session, conditions: list) -> int:
    value = session.exec(select(func.count(Project.id)).where(*conditions)).one()
    return int(value or 0)


# ── Generate project context summary ──────────────────────────────────────────


@router.get("/memory/list", dependencies=[Depends(require_admin)])
def list_project_memory_items(
    search: str = "",
    status: str = "all",
    limit: int = 20,
    offset: int = 0,
    session: Session = Depends(get_session),
):
    safe_limit = min(max(int(limit or 20), 1), 100)
    safe_offset = max(int(offset or 0), 0)
    search_conditions = _project_memory_search_conditions(search)
    filtered_conditions = [
        *search_conditions,
        *_project_memory_status_conditions(status),
    ]

    items = session.exec(
        select(Project)
        .where(*filtered_conditions)
        .order_by(Project.updated_at.desc(), Project.id.desc())
        .offset(safe_offset)
        .limit(safe_limit)
    ).all()

    counts = {
        "all": _count_projects(session, search_conditions),
        "ready": _count_projects(session, [*search_conditions, *_project_memory_status_conditions("ready")]),
        "stale": _count_projects(session, [*search_conditions, *_project_memory_status_conditions("stale")]),
        "missing": _count_projects(session, [*search_conditions, *_project_memory_status_conditions("missing")]),
    }

    return {
        "items": items,
        "total": _count_projects(session, filtered_conditions),
        "limit": safe_limit,
        "offset": safe_offset,
        "counts": counts,
    }


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


@router.get("/{project_id}/memory/slots")
def get_project_memory_slots(project_id: int, session: Session = Depends(get_session)):
    project = get_project_or_404(session, project_id)
    slots = get_project_memory_slot_states(session, project_id)
    stale_count = sum(item["status"] in {"stale", "corrupt"} for item in slots)
    rebuild_metadata = latest_memory_rebuild_metadata(
        get_project_memory_payload(project)
    )
    return {
        "scope": "project",
        "entity_id": project_id,
        "memory_version": int(project.memory_version or 0),
        "slot_count": len(slots),
        "stale_slot_count": stale_count,
        "slots": slots,
        **rebuild_metadata,
    }


@router.get("/{project_id}/memory/facts")
def get_project_memory_facts(project_id: int, session: Session = Depends(get_session)):
    project = get_project_or_404(session, project_id)
    facts = get_project_memory_fact_states(session, project_id)
    return {
        "scope": "project",
        "entity_id": project_id,
        "memory_version": int(project.memory_version or 0),
        "fact_count": len(facts),
        "stale_fact_count": sum(
            item["status"] in {"stale", "corrupt"} for item in facts
        ),
        "direct_fact_count": sum(
            item["provenance_status"] == "direct" for item in facts
        ),
        "matched_fact_count": sum(
            item["provenance_status"] == "matched" for item in facts
        ),
        "scoped_fact_count": sum(
            item["provenance_status"] in {"scoped", "legacy"} for item in facts
        ),
        "unresolved_fact_count": sum(
            item["provenance_status"] == "unresolved" for item in facts
        ),
        "facts": facts,
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
        rebuilt_slots=(slot_name,),
        rebuild_mode="targeted_edit",
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


@router.post("/memory/rebuild-batch", dependencies=[Depends(require_admin)])
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
            select(Project)
            .where(Project.memory_version > 0, Project.memory_stale == True)
            .order_by(Project.updated_at.desc(), Project.id.desc())
        ).all()
    elif body.missing_only:
        projects_to_process = session.exec(
            select(Project)
            .where(Project.memory_version <= 0)
            .order_by(Project.updated_at.desc(), Project.id.desc())
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


@router.post("/memory/warm-summaries-batch", dependencies=[Depends(require_admin)])
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


@router.get("/memory/jobs", dependencies=[Depends(require_admin)])
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
        expected_memory_version = int(project.memory_version or 0)
        expected_rebuild_status = project.memory_rebuild_status
        try:
            saved_memory = await _rebuild_project_memory(
                session,
                project_id,
                project,
                trigger="manual_queue_run",
            )
        except Exception as exc:
            # The scheduler job has already been removed, so a failed manual
            # run must leave a durable terminal state instead of an orphaned
            # ``queued`` owner with no job available to execute it.
            session.rollback()
            _set_project_memory_failure(
                session,
                project_id,
                stage="rebuild",
                message=str(exc),
                expected_memory_version=expected_memory_version,
                expected_rebuild_status=expected_rebuild_status,
                mark_rebuild_failed=True,
            )
            if session.get(Project, project_id):
                _bust_project(project_id)
            raise
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
        # The stream uses fresh short-lived sessions for cache reads/writes;
        # release the request session before the provider can block.
        session.rollback()

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
            session.rollback()
            content = await complete_with_selected_model(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=1400,
            )
        except Exception as e:
            session.expire_all()
            project = session.get(Project, project_id) or project
            _set_project_memory_failure(
                session,
                project,
                stage=f"memory_summary:{summary_type}",
                message=str(e),
            )
            raise
        session.expire_all()
        current_project = session.get(Project, project_id)
        if current_project is None:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Project was removed during summary generation.",
            )
        current_prompt = build_project_memory_view_prompt(
            get_project_memory_payload(current_project),
            current_project.name,
            summary_type,
            body.language,
        )
        if current_prompt != prompt:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Project memory changed during summary generation; retry with current data.",
            )
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
        project_name = project.name
        try:
            session.rollback()
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
                    project_name,
                    memory_payload,
                    missing_summary_type,
                    body.language,
                )
        except Exception as e:
            session.expire_all()
            project = session.get(Project, project_id) or project
            _set_project_memory_failure(
                session,
                project,
                stage="memory_summary:all",
                message=str(e),
            )
            raise

        session.expire_all()
        current_project = session.get(Project, project_id)
        if current_project is None:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Project was removed during summary generation.",
            )
        current_prompt = build_project_memory_multi_summary_prompt(
            get_project_memory_payload(current_project),
            current_project.name,
            summary_types=summary_types,
            language=body.language,
        )
        if current_prompt != prompt:
            session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Project memory changed during summary generation; retry with current data.",
            )

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
