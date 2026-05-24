"""Background execution helpers for long-running HITAS actions."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

LONG_RUNNING_TOOL_NAMES = {
    "edit_project_office_document",
    "generate_docx",
    "generate_pdf",
    "generate_ppt",
    "generate_ppt_from_skill",
    "generate_xlsx",
    "write_project_office_document",
}

LONG_RUNNING_PDF_ACTIONS = {"extract_pages", "merge", "split", "watermark"}


def should_execute_in_background(tool_name: str, tool_input: dict[str, Any]) -> bool:
    """Return true when confirmation should release the HTTP request quickly."""
    normalized_name = (tool_name or "").strip()
    if normalized_name in LONG_RUNNING_TOOL_NAMES:
        return True
    if normalized_name == "manage_pdf":
        action = str(tool_input.get("action") or "").strip().lower()
        return action in LONG_RUNNING_PDF_ACTIONS
    return False


def schedule_background_job(job_name: str, job_factory: Callable[[], Awaitable[None]]) -> None:
    """Schedule a best-effort in-process background job.

    This is deliberately small: the database claim/reaper model remains the
    durable safety boundary, and this helper only avoids holding an HTTP
    request open for long Office/PDF work. A future external queue can replace
    this function without changing HITAS state transitions.
    """
    task = asyncio.create_task(job_factory(), name=job_name)

    def _log_completion(done_task: asyncio.Task) -> None:
        try:
            done_task.result()
        except Exception as exc:  # pragma: no cover - defensive event-loop guard
            logger.error("Background HITAS job %s failed outside persistence path: %s", job_name, exc, exc_info=True)

    task.add_done_callback(_log_completion)
