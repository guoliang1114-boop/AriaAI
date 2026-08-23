"""Versioned, bounded tool-execution records for the Aria agent harness.

The shared-boundary recorder, trusted truncation marker, recent-first retention,
and explicit omission accounting are Python adaptations of OpenAI Codex's
``codex-rs/core/src/tools/executed_tool_calls.rs`` and
``codex-rs/protocol/src/models/executed_tool_calls.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: records execution outcomes rather than raw
model arguments, preserves Aria policy/confirmation/retry fields, removes raw
tool inputs and outputs from the audit ledger, attaches bounded capability
manifest fields, and provides provider-neutral status classification for
rollout, evaluation, persistence, and UI consumers.
This module does not import, start, or communicate with a Codex runtime.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, MutableSequence
from enum import Enum
from typing import Any


TOOL_EXECUTION_SCHEMA_VERSION = 1
MAX_TOOL_EXECUTION_RECORDS = 256
MAX_TOOL_EXECUTION_LEDGER_BYTES = 32 * 1024
MAX_TOOL_NAME_CHARS = 120
MAX_TOOL_USE_ID_CHARS = 200
MAX_TEXT_CHARS = 500
MAX_DETAILS = 12
MAX_DETAIL_CHARS = 240


class ToolExecutionOutcome(str, Enum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    WAITING_CONFIRMATION = "waiting_confirmation"
    SKIPPED = "skipped"


_STATUS_ALIASES = {
    "success": "completed",
    "succeeded": "completed",
    "done": "completed",
    "failed": "error",
    "failure": "error",
    "pending_confirmation": "confirmation_required",
    "in_progress": "running",
}
_OUTCOME_BY_STATUS = {
    "planned": ToolExecutionOutcome.PENDING,
    "pending": ToolExecutionOutcome.PENDING,
    "running": ToolExecutionOutcome.PENDING,
    "completed": ToolExecutionOutcome.SUCCEEDED,
    "error": ToolExecutionOutcome.FAILED,
    "blocked": ToolExecutionOutcome.FAILED,
    "conflict": ToolExecutionOutcome.FAILED,
    "confirmation_required": ToolExecutionOutcome.WAITING_CONFIRMATION,
    "skipped": ToolExecutionOutcome.SKIPPED,
    "suppressed": ToolExecutionOutcome.SKIPPED,
}
_TERMINAL_OUTCOMES = frozenset(
    {
        ToolExecutionOutcome.SUCCEEDED,
        ToolExecutionOutcome.FAILED,
        ToolExecutionOutcome.WAITING_CONFIRMATION,
        ToolExecutionOutcome.SKIPPED,
    }
)
_OPTIONAL_TEXT_FIELDS = (
    "message",
    "summary",
    "error",
    "error_code",
    "error_type",
    "step_title",
    "required_policy",
    "confirmation_token",
    "source",
    "retry_of_tool_use_id",
    "recovery_of_tool_use_id",
    "tool_effect",
    "result_kind",
    "retry_mode",
    "product_event",
)
_OPTIONAL_NON_NEGATIVE_INT_FIELDS = (
    "step_index",
    "step_total",
    "duration_ms",
    "attempt_count",
    "max_attempts",
    "http_status",
    "capability_version",
)


def _bounded_text(value: Any, limit: int = MAX_TEXT_CHARS) -> str:
    return str(value or "").strip()[:limit]


def _non_negative_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(0, parsed)


def _serialized_bytes(value: Any) -> int:
    try:
        return len(
            json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode(
                "utf-8"
            )
        )
    except (TypeError, ValueError):
        return MAX_TOOL_EXECUTION_LEDGER_BYTES + 1


def _canonical_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    status = _STATUS_ALIASES.get(status, status)
    return status if status in _OUTCOME_BY_STATUS else "error"


def tool_event_outcome(event: dict[str, Any]) -> ToolExecutionOutcome:
    """Return one stable outcome for both v1 and legacy tool-event records."""

    if str(event.get("status") or "").strip():
        return _OUTCOME_BY_STATUS[_canonical_status(event.get("status"))]
    declared = str(event.get("outcome") or "").strip().lower()
    try:
        return ToolExecutionOutcome(declared)
    except ValueError:
        return _OUTCOME_BY_STATUS[_canonical_status(event.get("status"))]


def tool_event_is_completed(event: dict[str, Any]) -> bool:
    return tool_event_outcome(event) is ToolExecutionOutcome.SUCCEEDED


def tool_event_is_failure(event: dict[str, Any]) -> bool:
    return tool_event_outcome(event) is ToolExecutionOutcome.FAILED


def tool_event_waits_confirmation(event: dict[str, Any]) -> bool:
    return tool_event_outcome(event) is ToolExecutionOutcome.WAITING_CONFIRMATION


def tool_event_is_omission_marker(event: dict[str, Any]) -> bool:
    marker = event.get("_aria_tool_execution_truncated")
    return isinstance(marker, dict) and bool(marker.get("omitted_calls"))


def _synthetic_tool_use_id(event: dict[str, Any], ordinal: int) -> str:
    stable_identity = {
        "tool_name": _bounded_text(event.get("tool_name") or event.get("name"), MAX_TOOL_NAME_CHARS),
        "status": _canonical_status(event.get("status")),
        "step_index": _non_negative_int(event.get("step_index")),
        "ordinal": max(1, ordinal),
    }
    digest = hashlib.sha256(
        json.dumps(stable_identity, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    return f"aria-tool-{max(1, ordinal)}-{digest}"


def build_tool_execution_record(event: dict[str, Any], *, ordinal: int = 1) -> dict[str, Any]:
    """Normalize an untrusted event into the persisted ToolExecutionRecord v1.

    Only an explicit allowlist is copied. In particular, ``input``,
    ``tool_input``, ``output``, and arbitrary underscore-prefixed truncation
    markers are never accepted from callers.
    """

    if not isinstance(event, dict):
        raise TypeError("tool execution event must be an object")

    status = _canonical_status(event.get("status"))
    outcome = _OUTCOME_BY_STATUS[status]
    tool_name = _bounded_text(event.get("tool_name") or event.get("name"), MAX_TOOL_NAME_CHARS) or "unknown"
    tool_use_id = _bounded_text(event.get("tool_use_id") or event.get("call_id"), MAX_TOOL_USE_ID_CHARS)
    if not tool_use_id:
        tool_use_id = _synthetic_tool_use_id(event, ordinal)

    record: dict[str, Any] = {
        "schema_version": TOOL_EXECUTION_SCHEMA_VERSION,
        "event_ordinal": max(1, ordinal),
        "tool_use_id": tool_use_id,
        "tool_name": tool_name,
        "status": status,
        "outcome": outcome.value,
        "terminal": outcome in _TERMINAL_OUTCOMES,
        "retryable": bool(event.get("retryable", False)),
    }

    for field in _OPTIONAL_TEXT_FIELDS:
        limit = MAX_TOOL_USE_ID_CHARS if field.endswith("tool_use_id") else MAX_TEXT_CHARS
        value = _bounded_text(event.get(field), limit)
        if value:
            record[field] = value

    for field in _OPTIONAL_NON_NEGATIVE_INT_FIELDS:
        value = _non_negative_int(event.get(field))
        if value is not None:
            record[field] = value

    details = event.get("details")
    if isinstance(details, list):
        bounded_details = []
        for detail in details[:MAX_DETAILS]:
            bounded_detail = _bounded_text(detail, MAX_DETAIL_CHARS)
            if bounded_detail:
                bounded_details.append(bounded_detail)
        if bounded_details:
            record["details"] = bounded_details

    if bool(event.get("has_recoverable_task", False)):
        record["has_recoverable_task"] = True
    return record


def _omission_marker(*, omitted_calls: int, original_records: int) -> dict[str, Any]:
    return {
        "schema_version": TOOL_EXECUTION_SCHEMA_VERSION,
        "event_ordinal": 0,
        "tool_use_id": "aria-tool-ledger-truncation",
        "tool_name": "aria_tool_execution_ledger",
        "status": "skipped",
        "outcome": ToolExecutionOutcome.SKIPPED.value,
        "terminal": True,
        "retryable": False,
        "summary": f"{omitted_calls} older tool execution record(s) omitted by the audit budget.",
        "_aria_tool_execution_truncated": {
            "omitted_calls": omitted_calls,
            "original_records": original_records,
            "max_records": MAX_TOOL_EXECUTION_RECORDS,
            "max_bytes": MAX_TOOL_EXECUTION_LEDGER_BYTES,
        },
    }


def bound_tool_execution_records(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Retain the newest records within count/byte limits and report omissions."""

    source = [dict(record) for record in records if isinstance(record, dict)]
    if (
        len(source) <= MAX_TOOL_EXECUTION_RECORDS
        and _serialized_bytes(source) <= MAX_TOOL_EXECUTION_LEDGER_BYTES
    ):
        return source

    marker_reservation = _serialized_bytes(_omission_marker(omitted_calls=len(source), original_records=len(source)))
    byte_budget = max(0, MAX_TOOL_EXECUTION_LEDGER_BYTES - marker_reservation - 2)
    kept_reversed: list[dict[str, Any]] = []
    kept_bytes = 0
    max_payload_records = max(0, MAX_TOOL_EXECUTION_RECORDS - 1)
    for record in reversed(source):
        if len(kept_reversed) >= max_payload_records:
            break
        record_bytes = _serialized_bytes(record) + (1 if kept_reversed else 0)
        if record_bytes > byte_budget - kept_bytes:
            continue
        kept_reversed.append(record)
        kept_bytes += record_bytes

    kept = list(reversed(kept_reversed))
    omitted_calls = max(0, len(source) - len(kept))
    bounded = [_omission_marker(omitted_calls=omitted_calls, original_records=len(source)), *kept]
    # The marker is intentionally compact, but keep this fail-closed fallback
    # in case future schema fields increase its serialized size.
    while len(bounded) > 1 and _serialized_bytes(bounded) > MAX_TOOL_EXECUTION_LEDGER_BYTES:
        bounded.pop(1)
        omitted_calls += 1
        bounded[0] = _omission_marker(omitted_calls=omitted_calls, original_records=len(source))
    return bounded[:MAX_TOOL_EXECUTION_RECORDS]


def append_tool_execution_record(
    records: MutableSequence[dict[str, Any]],
    event: dict[str, Any],
) -> dict[str, Any]:
    """Append through the shared boundary and enforce the ledger budget."""

    existing_omissions = 0
    material_records = list(records)
    if material_records and tool_event_is_omission_marker(material_records[0]):
        marker = material_records.pop(0).get("_aria_tool_execution_truncated") or {}
        existing_omissions = max(0, _non_negative_int(marker.get("omitted_calls")) or 0)

    raw_tool_use_id = _bounded_text(event.get("tool_use_id") or event.get("call_id"), MAX_TOOL_USE_ID_CHARS)
    replace_index = next(
        (
            index
            for index, existing in enumerate(material_records)
            if raw_tool_use_id and existing.get("tool_use_id") == raw_tool_use_id
        ),
        None,
    )
    if replace_index is None:
        record = build_tool_execution_record(
            event,
            ordinal=existing_omissions + len(material_records) + 1,
        )
        candidate_records = [*material_records, record]
        total_original = existing_omissions + len(material_records) + 1
    else:
        existing = material_records[replace_index]
        normalized = build_tool_execution_record(
            event,
            ordinal=int(existing.get("event_ordinal") or replace_index + 1),
        )
        if bool(existing.get("terminal")) and not bool(normalized.get("terminal")):
            return existing
        record = {**existing, **normalized, "event_ordinal": existing.get("event_ordinal", replace_index + 1)}
        candidate_records = list(material_records)
        candidate_records[replace_index] = record
        total_original = existing_omissions + len(material_records)

    bounded = bound_tool_execution_records(candidate_records)
    payload_records = bounded[1:] if bounded and tool_event_is_omission_marker(bounded[0]) else bounded
    omitted_calls = max(0, total_original - len(payload_records))
    if omitted_calls:
        bounded = [
            _omission_marker(omitted_calls=omitted_calls, original_records=total_original),
            *payload_records,
        ]
        while (
            len(bounded) > MAX_TOOL_EXECUTION_RECORDS
            or _serialized_bytes(bounded) > MAX_TOOL_EXECUTION_LEDGER_BYTES
        ) and len(bounded) > 1:
            bounded.pop(1)
            omitted_calls += 1
            bounded[0] = _omission_marker(
                omitted_calls=omitted_calls,
                original_records=total_original,
            )
    records[:] = bounded
    return record


def normalize_tool_execution_records(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for event in events:
        if isinstance(event, dict):
            append_tool_execution_record(records, event)
    return records
