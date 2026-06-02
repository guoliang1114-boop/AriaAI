"""Unified memory operations dashboard endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.database import get_session
from app.routers import clients as clients_router
from app.routers import projects as projects_router
from app.services.memory_operations import normalize_memory_failure, summarize_memory_operations

from app.routers.auth import require_admin

# memory_operations exposes the cross-project memory job dashboard —
# admin operational tooling. Gate with require_admin rather than the
# generic auth floor used by the other R74 routers.
router = APIRouter(
    prefix="/memory/operations",
    tags=["memory-operations"],
    dependencies=[Depends(require_admin)],
)


def _payload(value):
    return value.model_dump() if hasattr(value, "model_dump") else dict(value)


def _page(items: list[dict], offset: int, limit: int) -> dict:
    return {"items": items[offset : offset + limit], "total": len(items), "limit": limit, "offset": offset}


def _matches_query(values: list[object], query: str) -> bool:
    keyword = query.strip().lower()
    if not keyword:
        return True
    return any(keyword in str(value or "").lower() for value in values)


@router.get("/summary")
def get_memory_operations_summary(
    search: str = "",
    scope: str = "all",
    job_type: str = "all",
    retry: str = "all",
    failure_category: str = "all",
    attention: str = "all",
    jobs_limit: int = Query(10, ge=1, le=100),
    jobs_offset: int = Query(0, ge=0),
    success_limit: int = Query(10, ge=1, le=100),
    success_offset: int = Query(0, ge=0),
    failure_limit: int = Query(10, ge=1, le=100),
    failure_offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    project_jobs = projects_router.list_project_memory_jobs(session)
    client_jobs = clients_router.list_client_memory_jobs(session)
    project_jobs_payload = _payload(project_jobs)
    client_jobs_payload = _payload(client_jobs)
    summary = summarize_memory_operations(
        project_jobs=project_jobs_payload,
        client_jobs=client_jobs_payload,
    )

    jobs = [
        *[{**job, "scope": "project"} for job in project_jobs_payload.get("jobs", [])],
        *[{**job, "scope": "client"} for job in client_jobs_payload.get("jobs", [])],
    ]
    failures = [
        *[normalize_memory_failure({**failure, "scope": "project"}) for failure in project_jobs_payload.get("recent_failures", [])],
        *[normalize_memory_failure({**failure, "scope": "client"}) for failure in client_jobs_payload.get("recent_failures", [])],
    ]
    successes = [
        *[{**success, "scope": "project"} for success in project_jobs_payload.get("recent_successes", [])],
        *[{**success, "scope": "client"} for success in client_jobs_payload.get("recent_successes", [])],
    ]

    filtered_jobs = []
    for job in jobs:
        if scope != "all" and job.get("scope") != scope:
            continue
        if job_type != "all" and job.get("job_type") != job_type:
            continue
        retry_count = int(job.get("retry_count") or 0)
        if retry == "retrying" and retry_count <= 0:
            continue
        if retry == "clean" and retry_count > 0:
            continue
        fields = (
            [job.get("project_name"), job.get("client"), job.get("trigger"), *(job.get("summary_types") or [])]
            if job.get("scope") == "project"
            else [job.get("client_name"), job.get("industry"), job.get("trigger"), *(job.get("summary_types") or [])]
        )
        if _matches_query(fields, search):
            filtered_jobs.append(job)

    filtered_failures = []
    for failure in failures:
        if scope != "all" and failure.get("scope") != scope:
            continue
        if attention == "manual" and not failure.get("manual_attention"):
            continue
        if failure_category != "all" and failure.get("category") != failure_category:
            continue
        fields = (
            [failure.get("project_name"), failure.get("client"), failure.get("stage"), failure.get("message"), failure.get("category")]
            if failure.get("scope") == "project"
            else [failure.get("client_name"), failure.get("stage"), failure.get("message"), failure.get("category")]
        )
        if _matches_query(fields, search):
            filtered_failures.append(failure)

    filtered_successes = []
    for success in successes:
        if scope != "all" and success.get("scope") != scope:
            continue
        fields = (
            [success.get("project_name"), success.get("client"), success.get("stage"), success.get("message"), success.get("trigger")]
            if success.get("scope") == "project"
            else [success.get("client_name"), success.get("stage"), success.get("message"), success.get("trigger")]
        )
        if _matches_query(fields, search):
            filtered_successes.append(success)

    filtered_jobs.sort(key=lambda item: (item.get("next_run_at") or "", item.get("scope") or "", item.get("job_id") or ""))
    filtered_failures.sort(key=lambda item: item.get("failed_at", ""), reverse=True)
    filtered_successes.sort(key=lambda item: item.get("completed_at", ""), reverse=True)
    summary["pages"] = {
        "jobs": _page(filtered_jobs, jobs_offset, jobs_limit),
        "failures": _page(filtered_failures, failure_offset, failure_limit),
        "successes": _page(filtered_successes, success_offset, success_limit),
    }
    return summary
