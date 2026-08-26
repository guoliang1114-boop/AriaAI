"""Product Run Event v1 — the frontend-facing event protocol for AI runs.

This module is the **spec in code** for the events described in
``docs/11-Model-Harness产品方案设计.md §8``. It defines the event type names,
the enum-like field values, and a small builder function per event type that
returns a JSON-serialisable ``dict`` with validated fields.

The protocol is wired into the current Aria chat harness and is the stable
product-facing boundary for all agent runs. Provider- and tool-specific events
must be normalized here instead of leaking internal execution shapes into the
frontend.

Design notes:

* Builders return plain ``dict`` rather than dataclasses so the existing
  ``sse_event`` helper can serialise them unchanged.
* ``timestamp`` is filled in by the builder using ISO-8601 UTC; callers can
  override for tests.
* Each builder validates its inputs and raises ``ValueError`` on bad data — the
  Event Harness should never emit malformed events even if internal sources
  contain stale fields.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

# ----------------------------------------------------------------------
# Event type constants
# ----------------------------------------------------------------------


class EventType:
    """String constants for the Product Run Event v1 event types."""

    RUN_STARTED = "run_started"
    TURN_RECEIPT = "turn_receipt"
    CONTEXT_RECEIPT = "context_receipt"
    STEERING_APPLIED = "steering_applied"
    STATUS = "status"
    TEXT_DELTA = "text_delta"
    REFERENCE_DELTA = "reference_delta"
    STEP_STARTED = "step_started"
    STEP_COMPLETED = "step_completed"
    TOOL_PROGRESS = "tool_progress"
    TASK_UPDATE = "task_update"
    CONFIRMATION_REQUIRED = "confirmation_required"
    ARTIFACT_READY = "artifact_ready"
    MEMORY_CANDIDATE_READY = "memory_candidate_ready"
    MESSAGE_PERSISTED = "message_persisted"
    RUN_DONE = "run_done"
    RUN_FAILED = "run_failed"


# ----------------------------------------------------------------------
# Enum-like field value sets
# ----------------------------------------------------------------------


class DisplayMode:
    QUIET = "quiet"
    CONTEXTUAL = "contextual"
    TASK = "task"
    SKILL = "skill"
    CONFIRMATION = "confirmation"
    DEBUG = "debug"


_DISPLAY_MODES = frozenset(
    {
        DisplayMode.QUIET,
        DisplayMode.CONTEXTUAL,
        DisplayMode.TASK,
        DisplayMode.SKILL,
        DisplayMode.CONFIRMATION,
        DisplayMode.DEBUG,
    }
)

_SKILL_SOURCES = frozenset({"explicit", "auto", "conversation"})


class ToolProgressStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


_TOOL_PROGRESS_STATUSES = frozenset(
    {
        ToolProgressStatus.PENDING,
        ToolProgressStatus.RUNNING,
        ToolProgressStatus.COMPLETED,
        ToolProgressStatus.FAILED,
    }
)


class StepCompletedStatus:
    """Subset of statuses used by ``step_completed``. Steps can only finish in
    one of these terminal states (no ``pending`` / ``running``)."""

    COMPLETED = "completed"
    FAILED = "failed"


_STEP_COMPLETED_STATUSES = frozenset(
    {StepCompletedStatus.COMPLETED, StepCompletedStatus.FAILED}
)


class ArtifactType:
    PPTX = "pptx"
    DOCX = "docx"
    XLSX = "xlsx"
    PDF = "pdf"
    MARKDOWN = "markdown"


_ARTIFACT_TYPES = frozenset(
    {
        ArtifactType.PPTX,
        ArtifactType.DOCX,
        ArtifactType.XLSX,
        ArtifactType.PDF,
        ArtifactType.MARKDOWN,
    }
)


class RunFinalStatus:
    COMPLETED = "completed"
    WAITING_CONFIRMATION = "waiting_confirmation"
    FAILED = "failed"
    CANCELLED = "cancelled"


_RUN_FINAL_STATUSES = frozenset(
    {
        RunFinalStatus.COMPLETED,
        RunFinalStatus.WAITING_CONFIRMATION,
        RunFinalStatus.FAILED,
        RunFinalStatus.CANCELLED,
    }
)


class ErrorCode:
    """Stable, machine-readable error codes. ``run_failed`` events must use one
    of these (or extend the set here as new failure shapes appear)."""

    TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED"
    MODEL_TIMEOUT = "MODEL_TIMEOUT"
    PERSISTENCE_ERROR = "PERSISTENCE_ERROR"
    POLICY_REJECTED = "POLICY_REJECTED"
    CONTEXT_PREPARATION_FAILED = "CONTEXT_PREPARATION_FAILED"
    TURN_BUDGET_EXCEEDED = "TURN_BUDGET_EXCEEDED"
    RUN_EVALUATION_FAILED = "RUN_EVALUATION_FAILED"
    UNKNOWN = "UNKNOWN"


_ERROR_CODES = frozenset(
    {
        ErrorCode.TOOL_EXECUTION_FAILED,
        ErrorCode.MODEL_TIMEOUT,
        ErrorCode.PERSISTENCE_ERROR,
        ErrorCode.POLICY_REJECTED,
        ErrorCode.CONTEXT_PREPARATION_FAILED,
        ErrorCode.TURN_BUDGET_EXCEEDED,
        ErrorCode.RUN_EVALUATION_FAILED,
        ErrorCode.UNKNOWN,
    }
)


# ----------------------------------------------------------------------
# Field constraints (per doc/11 §8 "Event 字段约束")
# ----------------------------------------------------------------------

USER_FACING_MESSAGE_MAX_CHARS = 50
"""``status.message`` is shown to end users and must stay short."""

TURN_RECEIPT_SUMMARY_MAX_CHARS = 240
TURN_RECEIPT_MAX_CONSTRAINTS = 8
TURN_RECEIPT_CONSTRAINT_MAX_CHARS = 160
STEERING_PREVIEW_MAX_CHARS = 160
CONTEXT_RECEIPT_MAX_CANDIDATES = 3

_CONTEXT_SCOPES = frozenset({"chat", "project", "client_portfolio", "workspace"})
_MEMORY_STATUSES = frozenset({"not_applicable", "missing", "stale", "ready"})
_MEMORY_RETRIEVAL_MODES = frozenset({"none", "overview", "focused", "full"})
_SKILL_RECEIPT_STATUSES = frozenset({"applied", "ambiguous", "not_used"})
_SKILL_USAGE_MODES = frozenset({"none", "advisory", "workflow"})
_CONTEXT_WARNING_CODES = frozenset(
    {
        "project_memory_missing",
        "project_memory_stale",
        "memory_retrieval_truncated",
        "skill_match_ambiguous",
        "context_compacted",
        "project_world_state_changed",
        "project_world_state_truncated",
    }
)

_PROJECT_WORLD_STATE_CATEGORIES = frozenset(
    {
        "project",
        "milestones",
        "todos",
        "files",
        "progress",
        "financials",
        "stakeholders",
        "deliverables",
    }
)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def make_run_id() -> str:
    """Generate a fresh ``run_{uuid}`` identifier."""
    return f"run_{uuid.uuid4().hex}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _require_run_id(run_id: str) -> str:
    if not isinstance(run_id, str) or not run_id.startswith("run_") or len(run_id) <= 4:
        raise ValueError(f"invalid run_id: {run_id!r}")
    return run_id


def _require_in(value: str, allowed: Iterable[str], label: str) -> str:
    if value not in allowed:
        raise ValueError(f"{label} must be one of {sorted(allowed)}, got {value!r}")
    return value


def _require_positive_int(value: Any, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{label} must be a positive int, got {value!r}")
    return value


def _maybe_timestamp(timestamp: str | None) -> str:
    return timestamp if timestamp else _now_iso()


# ----------------------------------------------------------------------
# Event builders
# ----------------------------------------------------------------------


def run_started(
    run_id: str,
    *,
    display_mode: str | None = None,
    skill: dict | None = None,
    timestamp: str | None = None,
) -> dict:
    """Run has started — frontend can enter loading state."""
    event: dict[str, Any] = {
        "type": EventType.RUN_STARTED,
        "run_id": _require_run_id(run_id),
        "timestamp": _maybe_timestamp(timestamp),
    }
    if display_mode is not None:
        event["display_mode"] = _require_in(display_mode, _DISPLAY_MODES, "display_mode")
    if skill is not None:
        name = str(skill.get("name") or "").strip()
        if not name:
            raise ValueError("skill.name is required when skill is provided")
        event["skill"] = {"name": name}
        if skill.get("id"):
            event["skill"]["id"] = str(skill["id"])
        if skill.get("source"):
            event["skill"]["source"] = _require_in(str(skill["source"]), _SKILL_SOURCES, "skill.source")
    return event


def turn_receipt(
    run_id: str,
    *,
    summary: str,
    mode: str,
    target_scope: str,
    execution_scope: str,
    expected_response: str,
    write_allowed: bool,
    requires_confirmation: bool,
    steering_supported: bool,
    user_constraints: Iterable[str] = (),
) -> dict:
    """Concise, user-visible acknowledgement of how Aria read the turn."""

    normalized_summary = str(summary or "").strip()
    if not normalized_summary or len(normalized_summary) > TURN_RECEIPT_SUMMARY_MAX_CHARS:
        raise ValueError(
            f"turn_receipt.summary must be 1–{TURN_RECEIPT_SUMMARY_MAX_CHARS} chars"
        )
    normalized_mode = str(mode or "").strip()
    if normalized_mode not in {"answer_only", "plan_only", "execute_now", "plan_then_execute"}:
        raise ValueError("turn_receipt.mode is invalid")
    normalized_target = str(target_scope or "").strip()
    if normalized_target not in {"chat", "project", "workspace"}:
        raise ValueError("turn_receipt.target_scope is invalid")
    normalized_execution = str(execution_scope or "").strip()
    if normalized_execution not in {
        "chat_only",
        "injected_project_context",
        "read_tools",
        "project_write",
        "workspace_write",
    }:
        raise ValueError("turn_receipt.execution_scope is invalid")
    normalized_response = str(expected_response or "").strip()
    if not normalized_response or len(normalized_response) > 80:
        raise ValueError("turn_receipt.expected_response is invalid")
    normalized_constraints: list[str] = []
    for item in user_constraints:
        normalized = " ".join(str(item or "").split())[:TURN_RECEIPT_CONSTRAINT_MAX_CHARS]
        if normalized and normalized not in normalized_constraints:
            normalized_constraints.append(normalized)
        if len(normalized_constraints) >= TURN_RECEIPT_MAX_CONSTRAINTS:
            break
    return {
        "type": EventType.TURN_RECEIPT,
        "run_id": _require_run_id(run_id),
        "summary": normalized_summary,
        "mode": normalized_mode,
        "target_scope": normalized_target,
        "execution_scope": normalized_execution,
        "expected_response": normalized_response,
        "write_allowed": bool(write_allowed),
        "requires_confirmation": bool(requires_confirmation),
        "steering_supported": bool(steering_supported),
        "user_constraints": normalized_constraints,
    }


def context_receipt(
    run_id: str,
    *,
    scope: str,
    memory: dict,
    skill: dict,
    evidence: dict,
    project: dict | None = None,
    world_state: dict | None = None,
    warnings: Iterable[str] = (),
) -> dict:
    """Privacy-safe receipt of the evidence and Skill used for this turn."""

    normalized_scope = _require_in(str(scope or ""), _CONTEXT_SCOPES, "context_receipt.scope")
    memory_status = _require_in(
        str(memory.get("status") or ""),
        _MEMORY_STATUSES,
        "context_receipt.memory.status",
    )
    try:
        memory_version = max(0, int(memory.get("version") or 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("context_receipt.memory.version is invalid") from exc
    memory_retrieval_mode = _require_in(
        str(memory.get("retrieval_mode") or "none"),
        _MEMORY_RETRIEVAL_MODES,
        "context_receipt.memory.retrieval_mode",
    )
    selected_slots = [
        str(slot).strip()[:80]
        for slot in list(memory.get("selected_slots") or [])[:12]
        if str(slot).strip()
    ]
    query_facets = [
        str(facet).strip()[:40]
        for facet in list(memory.get("query_facets") or [])[:5]
        if str(facet).strip()
    ]
    memory_counts: dict[str, int] = {}
    for key in (
        "selected_slot_count",
        "available_slot_count",
        "omitted_slot_count",
        "selected_item_count",
    ):
        try:
            memory_counts[key] = max(0, int(memory.get(key) or 0))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"context_receipt.memory.{key} is invalid") from exc

    skill_status = _require_in(
        str(skill.get("status") or ""),
        _SKILL_RECEIPT_STATUSES,
        "context_receipt.skill.status",
    )
    usage_mode = _require_in(
        str(skill.get("usage_mode") or "none"),
        _SKILL_USAGE_MODES,
        "context_receipt.skill.usage_mode",
    )
    normalized_skill: dict[str, Any] = {
        "status": skill_status,
        "usage_mode": usage_mode,
        "reason": str(skill.get("reason") or "")[:160],
        "confidence": max(0.0, min(1.0, float(skill.get("confidence") or 0.0))),
    }
    for key in ("id", "name", "source"):
        value = str(skill.get(key) or "").strip()
        if value:
            normalized_skill[key] = value[:160]
    candidates: list[dict[str, Any]] = []
    for candidate in list(skill.get("candidates") or [])[:CONTEXT_RECEIPT_MAX_CANDIDATES]:
        if not isinstance(candidate, dict):
            continue
        name = str(candidate.get("name") or candidate.get("skill_name") or "").strip()
        if not name:
            continue
        payload: dict[str, Any] = {"name": name[:160]}
        candidate_id = candidate.get("id") or candidate.get("skill_id")
        if candidate_id is not None:
            payload["id"] = str(candidate_id)[:80]
        try:
            payload["score"] = max(0, min(100, int(candidate.get("score") or 0)))
        except (TypeError, ValueError):
            payload["score"] = 0
        candidates.append(payload)
    if candidates:
        normalized_skill["candidates"] = candidates

    normalized_evidence: dict[str, Any] = {}
    for key in (
        "attached_file_count",
        "knowledge_reference_count",
        "history_message_count",
    ):
        try:
            normalized_evidence[key] = max(0, int(evidence.get(key) or 0))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"context_receipt.evidence.{key} is invalid") from exc
    for key in (
        "workspace_context",
        "conversation_capsule",
        "user_preferences",
        "compacted",
    ):
        normalized_evidence[key] = bool(evidence.get(key, False))

    event: dict[str, Any] = {
        "type": EventType.CONTEXT_RECEIPT,
        "schema_version": 1,
        "run_id": _require_run_id(run_id),
        "scope": normalized_scope,
        "memory": {
            "status": memory_status,
            "version": memory_version,
            "raw_context_available": bool(memory.get("raw_context_available", False)),
            "retrieval_mode": memory_retrieval_mode,
            "query_facets": query_facets,
            "selected_slots": selected_slots,
            **memory_counts,
            "truncated": bool(memory.get("truncated", False)),
        },
        "skill": normalized_skill,
        "evidence": normalized_evidence,
        "warnings": list(
            dict.fromkeys(
                _require_in(str(warning), _CONTEXT_WARNING_CODES, "context_receipt.warning")
                for warning in warnings
            )
        ),
    }
    if project is not None:
        project_id = project.get("id")
        project_name = str(project.get("name") or "").strip()
        if project_id is not None and project_name:
            event["project"] = {
                "id": str(project_id)[:80],
                "name": project_name[:160],
            }
    if world_state is not None:
        current_version = str(world_state.get("current_version") or "").lower()
        previous_version = str(world_state.get("previous_version") or "").lower()
        if (
            len(current_version) != 12
            or any(char not in "0123456789abcdef" for char in current_version)
            or (
                previous_version
                and (
                    len(previous_version) != 12
                    or any(char not in "0123456789abcdef" for char in previous_version)
                )
            )
        ):
            raise ValueError("context_receipt.world_state.version is invalid")
        changed_categories = []
        normalized_changes: dict[str, dict[str, int]] = {}
        raw_changes = world_state.get("categories")
        raw_changes = raw_changes if isinstance(raw_changes, dict) else {}
        for category in list(world_state.get("changed_categories") or [])[:8]:
            normalized_category = _require_in(
                str(category),
                _PROJECT_WORLD_STATE_CATEGORIES,
                "context_receipt.world_state.category",
            )
            if normalized_category in changed_categories:
                continue
            changed_categories.append(normalized_category)
            raw_counts = raw_changes.get(normalized_category)
            raw_counts = raw_counts if isinstance(raw_counts, dict) else {}
            counts: dict[str, int] = {}
            for key in ("added", "removed", "updated", "current_count"):
                try:
                    counts[key] = max(0, int(raw_counts.get(key) or 0))
                except (TypeError, ValueError) as exc:
                    raise ValueError(
                        f"context_receipt.world_state.{normalized_category}.{key} is invalid"
                    ) from exc
            normalized_changes[normalized_category] = counts
        event["world_state"] = {
            "current_version": current_version,
            "previous_version": previous_version or None,
            "baseline": bool(world_state.get("baseline", False)),
            "changed": bool(world_state.get("changed", False)),
            "changed_categories": changed_categories,
            "categories": normalized_changes,
            "truncated": bool(world_state.get("truncated", False)),
        }
    return event


def steering_applied(
    run_id: str,
    *,
    steering_id: str,
    sequence: int,
    content_preview: str,
    message_id: int | None = None,
) -> dict:
    """One accepted addition has reached a safe Agent Loop boundary."""

    normalized_id = str(steering_id or "").strip()
    if not normalized_id.startswith("steer_"):
        raise ValueError("steering_applied.steering_id is invalid")
    normalized_preview = str(content_preview or "").strip()
    if not normalized_preview or len(normalized_preview) > STEERING_PREVIEW_MAX_CHARS:
        raise ValueError(
            f"steering_applied.content_preview must be 1–{STEERING_PREVIEW_MAX_CHARS} chars"
        )
    event: dict[str, Any] = {
        "type": EventType.STEERING_APPLIED,
        "run_id": _require_run_id(run_id),
        "steering_id": normalized_id,
        "sequence": _require_positive_int(sequence, "sequence"),
        "content_preview": normalized_preview,
    }
    if message_id is not None:
        event["message_id"] = _require_positive_int(message_id, "message_id")
    return event


def status(
    run_id: str,
    message: str,
    *,
    display_mode: str | None = None,
    progress: float | None = None,
) -> dict:
    """User-facing one-liner about the current stage. ≤50 chars."""
    if not isinstance(message, str) or not message.strip():
        raise ValueError("status.message must be a non-empty string")
    if len(message) > USER_FACING_MESSAGE_MAX_CHARS:
        raise ValueError(
            f"status.message must be ≤ {USER_FACING_MESSAGE_MAX_CHARS} chars (got {len(message)})"
        )
    event: dict[str, Any] = {
        "type": EventType.STATUS,
        "run_id": _require_run_id(run_id),
        "message": message,
    }
    if display_mode is not None:
        event["display_mode"] = _require_in(display_mode, _DISPLAY_MODES, "display_mode")
    if progress is not None:
        event["progress"] = float(progress)
    return event


def text_delta(run_id: str, content: str) -> dict:
    """Incremental model text. Must be forwarded near-realtime (see doc §8)."""
    if not isinstance(content, str):
        raise ValueError("text_delta.content must be a string")
    return {
        "type": EventType.TEXT_DELTA,
        "run_id": _require_run_id(run_id),
        "content": content,
    }


def reference_delta(
    run_id: str,
    source: str,
    *,
    url: str | None = None,
    title: str | None = None,
) -> dict:
    if not isinstance(source, str) or not source.strip():
        raise ValueError("reference_delta.source must be a non-empty string")
    event: dict[str, Any] = {
        "type": EventType.REFERENCE_DELTA,
        "run_id": _require_run_id(run_id),
        "source": source,
    }
    if url is not None:
        event["url"] = url
    if title is not None:
        event["title"] = title
    return event


def step_started(
    run_id: str,
    step_index: int,
    title: str,
    *,
    step_total: int | None = None,
) -> dict:
    """A visible timeline step opens. ``step_index`` is 1-based and monotonic."""
    if not isinstance(title, str) or not title.strip():
        raise ValueError("step_started.title must be a non-empty string")
    event: dict[str, Any] = {
        "type": EventType.STEP_STARTED,
        "run_id": _require_run_id(run_id),
        "step_index": _require_positive_int(step_index, "step_index"),
        "title": title,
    }
    if step_total is not None:
        event["step_total"] = _require_positive_int(step_total, "step_total")
    return event


def step_completed(
    run_id: str,
    step_index: int,
    status: str,
    duration_ms: int,
    *,
    truncated: bool = False,
) -> dict:
    """A step has finished. Must come after a matching ``step_started``."""
    if not isinstance(duration_ms, int) or duration_ms < 0:
        raise ValueError(f"duration_ms must be a non-negative int, got {duration_ms!r}")
    return {
        "type": EventType.STEP_COMPLETED,
        "run_id": _require_run_id(run_id),
        "step_index": _require_positive_int(step_index, "step_index"),
        "status": _require_in(status, _STEP_COMPLETED_STATUSES, "step_completed.status"),
        "duration_ms": duration_ms,
        "truncated": bool(truncated),
    }


def tool_progress(
    run_id: str,
    step_index: int,
    title: str,
    status: str,
    *,
    detail: str | None = None,
    progress: float | None = None,
) -> dict:
    """A user-visible tool invocation, attached to a step."""
    if not isinstance(title, str) or not title.strip():
        raise ValueError("tool_progress.title must be a non-empty string")
    event: dict[str, Any] = {
        "type": EventType.TOOL_PROGRESS,
        "run_id": _require_run_id(run_id),
        "step_index": _require_positive_int(step_index, "step_index"),
        "title": title,
        "status": _require_in(status, _TOOL_PROGRESS_STATUSES, "tool_progress.status"),
    }
    if detail is not None:
        event["detail"] = detail
    if progress is not None:
        event["progress"] = float(progress)
    return event


def task_update(
    run_id: str,
    task_id: str | int,
    status: str,
    *,
    progress_pct: int | None = None,
    current_step: int | None = None,
    total_steps: int | None = None,
    step_title: str | None = None,
) -> dict:
    """Durable/background task progress."""
    if progress_pct is not None and not (0 <= int(progress_pct) <= 100):
        raise ValueError(f"task_update.progress_pct must be 0–100, got {progress_pct!r}")
    event: dict[str, Any] = {
        "type": EventType.TASK_UPDATE,
        "run_id": _require_run_id(run_id),
        "task_id": str(task_id),
        "status": _require_in(status, _TOOL_PROGRESS_STATUSES, "task_update.status"),
    }
    if progress_pct is not None:
        event["progress_pct"] = int(progress_pct)
    if current_step is not None:
        event["current_step"] = _require_positive_int(current_step, "current_step")
    if total_steps is not None:
        event["total_steps"] = _require_positive_int(total_steps, "total_steps")
    if step_title is not None:
        event["step_title"] = step_title
    return event


def confirmation_required(
    run_id: str,
    action: str,
    impact: str,
    *,
    params_snapshot: dict | None = None,
    deadline: str | None = None,
) -> dict:
    """HITAS confirmation card. ``action`` must be human-readable."""
    if not isinstance(action, str) or not action.strip():
        raise ValueError("confirmation_required.action must be a non-empty string")
    if not isinstance(impact, str) or not impact.strip():
        raise ValueError("confirmation_required.impact must be a non-empty string")
    event: dict[str, Any] = {
        "type": EventType.CONFIRMATION_REQUIRED,
        "run_id": _require_run_id(run_id),
        "action": action,
        "impact": impact,
    }
    if params_snapshot is not None:
        event["params_snapshot"] = dict(params_snapshot)
    if deadline is not None:
        event["deadline"] = deadline
    return event


def artifact_ready(
    run_id: str,
    artifact_id: str | int,
    artifact_type: str,
    *,
    download_url: str | None = None,
    preview_url: str | None = None,
    source_tool: str | None = None,
    output_id: str | None = None,
    content_sha256: str | None = None,
) -> dict:
    event: dict[str, Any] = {
        "type": EventType.ARTIFACT_READY,
        "run_id": _require_run_id(run_id),
        "artifact_id": str(artifact_id),
        "artifact_type": _require_in(artifact_type, _ARTIFACT_TYPES, "artifact_type"),
    }
    if download_url is not None:
        event["download_url"] = download_url
    if preview_url is not None:
        event["preview_url"] = preview_url
    if source_tool is not None:
        normalized_source = str(source_tool).strip()
        if normalized_source:
            if len(normalized_source) > 120:
                raise ValueError("artifact_ready.source_tool must be at most 120 characters")
            event["source_tool"] = normalized_source
    if output_id is not None:
        normalized_output_id = str(output_id).strip()
        if normalized_output_id:
            if len(normalized_output_id) > 96:
                raise ValueError("artifact_ready.output_id must be at most 96 characters")
            event["output_id"] = normalized_output_id
    if content_sha256 is not None:
        normalized_digest = str(content_sha256).strip().lower()
        if len(normalized_digest) != 64 or any(char not in "0123456789abcdef" for char in normalized_digest):
            raise ValueError("artifact_ready.content_sha256 must be a SHA-256 digest")
        event["content_sha256"] = normalized_digest
    return event


def memory_candidate_ready(
    run_id: str,
    candidate_id: str | int,
    scope: str,
    candidate_type: str,
    *,
    content_sha256: str | None = None,
) -> dict:
    normalized_scope = _require_in(scope, frozenset({"user", "project", "client"}), "scope")
    normalized_type = str(candidate_type or "").strip()
    if not normalized_type or len(normalized_type) > 48:
        raise ValueError("memory_candidate_ready.candidate_type is invalid")
    event: dict[str, Any] = {
        "type": EventType.MEMORY_CANDIDATE_READY,
        "run_id": _require_run_id(run_id),
        "candidate_id": str(candidate_id),
        "scope": normalized_scope,
        "candidate_type": normalized_type,
        "status": "pending_review",
    }
    if content_sha256 is not None:
        normalized_digest = str(content_sha256).strip().lower()
        if len(normalized_digest) != 64 or any(char not in "0123456789abcdef" for char in normalized_digest):
            raise ValueError("memory_candidate_ready.content_sha256 must be a SHA-256 digest")
        event["content_sha256"] = normalized_digest
    return event


def message_persisted(
    run_id: str,
    message_id: int | str,
    *,
    parent_run_id: str | None = None,
) -> dict:
    event: dict[str, Any] = {
        "type": EventType.MESSAGE_PERSISTED,
        "run_id": _require_run_id(run_id),
        "message_id": int(message_id) if isinstance(message_id, int) else str(message_id),
    }
    if parent_run_id is not None:
        event["parent_run_id"] = _require_run_id(parent_run_id)
    return event


def run_done(
    run_id: str,
    final_status: str,
    *,
    message_id: int | str | None = None,
    artifact_ids: list[str | int] | None = None,
) -> dict:
    event: dict[str, Any] = {
        "type": EventType.RUN_DONE,
        "run_id": _require_run_id(run_id),
        "final_status": _require_in(final_status, _RUN_FINAL_STATUSES, "final_status"),
    }
    if message_id is not None:
        event["message_id"] = (
            int(message_id) if isinstance(message_id, int) else str(message_id)
        )
    if artifact_ids is not None:
        event["artifact_ids"] = [str(a) for a in artifact_ids]
    return event


def run_failed(
    run_id: str,
    error_code: str,
    error_message: str,
    *,
    retryable: bool | None = None,
    fallback_content: str | None = None,
) -> dict:
    """Failure event. ``error_message`` is user-facing — no internal stacks."""
    if not isinstance(error_message, str) or not error_message.strip():
        raise ValueError("run_failed.error_message must be a non-empty string")
    event: dict[str, Any] = {
        "type": EventType.RUN_FAILED,
        "run_id": _require_run_id(run_id),
        "error_code": _require_in(error_code, _ERROR_CODES, "error_code"),
        "error_message": error_message,
    }
    if retryable is not None:
        event["retryable"] = bool(retryable)
    if fallback_content is not None:
        event["fallback_content"] = fallback_content
    return event
