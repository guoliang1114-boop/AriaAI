"""Shared helpers for memory operations dashboards."""

from __future__ import annotations

from typing import Any

MEMORY_FAILURE_CATEGORIES = (
    "budget",
    "rate_limit",
    "timeout",
    "database",
    "data",
    "scheduler",
    "llm",
    "unknown",
)
MANUAL_ATTENTION_CATEGORIES = {"database", "data", "unknown"}


def classify_memory_failure(stage: str | None, message: str | None, explicit: str | None = None) -> str:
    if explicit in MEMORY_FAILURE_CATEGORIES:
        return explicit

    text = f"{stage or ''} {message or ''}".lower()
    if "budget" in text or "daily limit" in text or "quota" in text:
        return "budget"
    if "429" in text or "rate limit" in text or "too many requests" in text:
        return "rate_limit"
    if "timeout" in text or "timed out" in text:
        return "timeout"
    if "database" in text or "sql" in text or "psycopg" in text:
        return "database"
    if "not found" in text or "empty" in text or "no project" in text or "no client" in text:
        return "data"
    if "scheduler" in text or "job" in text or "queue" in text:
        return "scheduler"
    if "model" in text or "llm" in text or "claude" in text or "kimi" in text or "deepseek" in text:
        return "llm"
    return "unknown"


def normalize_memory_failure(failure: dict[str, Any]) -> dict[str, Any]:
    category = classify_memory_failure(
        failure.get("stage"),
        failure.get("message"),
        failure.get("category"),
    )
    return {
        **failure,
        "category": category,
        "manual_attention": category in MANUAL_ATTENTION_CATEGORIES,
    }


def summarize_memory_operations(
    *,
    project_jobs: dict[str, Any],
    client_jobs: dict[str, Any],
) -> dict[str, Any]:
    jobs = [
        *[{**job, "scope": "project"} for job in project_jobs.get("jobs", [])],
        *[{**job, "scope": "client"} for job in client_jobs.get("jobs", [])],
    ]
    failures = [
        *[normalize_memory_failure({**failure, "scope": "project"}) for failure in project_jobs.get("recent_failures", [])],
        *[normalize_memory_failure({**failure, "scope": "client"}) for failure in client_jobs.get("recent_failures", [])],
    ]
    successes = [
        *[{**success, "scope": "project"} for success in project_jobs.get("recent_successes", [])],
        *[{**success, "scope": "client"} for success in client_jobs.get("recent_successes", [])],
    ]

    category_counts = {category: 0 for category in MEMORY_FAILURE_CATEGORIES}
    scope_counts = {"project": 0, "client": 0}
    for failure in failures:
        category_counts[failure["category"]] += 1
        scope_counts[failure["scope"]] += 1

    top_category = max(category_counts.items(), key=lambda item: item[1])[0] if failures else "unknown"
    retrying_jobs = [job for job in jobs if int(job.get("retry_count") or 0) > 0]
    project_budget = project_jobs.get("budget") or {}
    client_budget = client_jobs.get("budget") or {}

    return {
        "counts": {
            "jobs": len(jobs),
            "rebuild_jobs": sum(1 for job in jobs if job.get("job_type") == "rebuild"),
            "summary_warm_jobs": sum(1 for job in jobs if job.get("job_type") == "summary_warm"),
            "retrying_jobs": len(retrying_jobs),
            "recent_failures": len(failures),
            "recent_successes": len(successes),
            "manual_attention": sum(1 for failure in failures if failure["manual_attention"]),
        },
        "failure_summary": {
            "category_counts": category_counts,
            "scope_counts": scope_counts,
            "top_category": top_category,
            "top_category_count": category_counts[top_category],
            "manual_attention_categories": sorted(MANUAL_ATTENTION_CATEGORIES),
        },
        "budget": {
            "project": project_budget,
            "client": client_budget,
            "project_low": _is_budget_low(project_budget),
            "client_low": _is_budget_low(client_budget),
        },
        "recent_failures": sorted(failures, key=lambda item: item.get("failed_at", ""), reverse=True)[:12],
        "recent_successes": sorted(successes, key=lambda item: item.get("completed_at", ""), reverse=True)[:12],
    }


def _is_budget_low(budget: dict[str, Any]) -> bool:
    limit = int(budget.get("limit") or 0)
    remaining = int(budget.get("remaining") or 0)
    if limit <= 0:
        return False
    return remaining <= max(5, limit // 6)
