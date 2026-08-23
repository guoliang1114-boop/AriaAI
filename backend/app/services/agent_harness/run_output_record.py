"""Versioned, bounded result records for durable Aria run outputs.

The typed output-item boundary and item-id lifecycle are adapted from OpenAI
Codex's ``codex-rs/protocol/src/models.rs`` (``ResponseItem``) and
``codex-rs/analytics/src/facts.rs`` (``ArtifactOperation``) at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: reduced to provider-neutral artifact and
memory-candidate facts, added persistence/decision states, stable hashes, and
strict bounds. Raw artifact bytes, memory text, prompts, and tool arguments are
never stored in this record. Aria owns execution and persistence; no Codex
runtime, protocol, account, or API is used.
"""
from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Any, Iterable


RUN_OUTPUT_RECORD_VERSION = 1
MAX_RUN_OUTPUT_RECORDS = 64
MAX_OUTPUT_ID_CHARS = 96
MAX_OUTPUT_NAME_CHARS = 240
MAX_SOURCE_NAME_CHARS = 120
MAX_FAILURE_MESSAGE_CHARS = 300


class RunOutputKind(str, Enum):
    ARTIFACT = "artifact"
    MEMORY_CANDIDATE = "memory_candidate"


class RunOutputStatus(str, Enum):
    PRODUCED = "produced"
    PERSISTED = "persisted"
    PENDING_REVIEW = "pending_review"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    FAILED = "failed"


_KINDS = {item.value for item in RunOutputKind}
_STATUSES = {item.value for item in RunOutputStatus}


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _sha256(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _bounded_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _artifact_output_id(
    artifact: dict[str, Any],
    *,
    run_id: str,
    source_tool: str,
    tool_use_id: str,
) -> str:
    digest = _sha256(
        {
            "domain": "aria.run-output.artifact.v1",
            "run_id": run_id,
            "tool_use_id": tool_use_id,
            "source_tool": source_tool,
            "name": artifact.get("name"),
            "path": artifact.get("path"),
        }
    )[:24]
    return f"out_artifact_{digest}"


def build_artifact_output_record(
    artifact: dict[str, Any],
    *,
    run_id: str,
    source_tool: str = "",
    tool_use_id: str = "",
) -> dict[str, Any]:
    """Create the produced fact before any durable-file claim is allowed."""

    name = _bounded_text(artifact.get("name"), MAX_OUTPUT_NAME_CHARS)
    file_type = _bounded_text(artifact.get("file_type"), 32).lower().lstrip(".")
    path = str(artifact.get("path") or "").strip()
    source_tool = _bounded_text(source_tool or artifact.get("source_tool"), MAX_SOURCE_NAME_CHARS)
    tool_use_id = _bounded_text(tool_use_id or artifact.get("tool_use_id"), MAX_OUTPUT_ID_CHARS)
    output_id = _bounded_text(artifact.get("output_id"), MAX_OUTPUT_ID_CHARS) or _artifact_output_id(
        artifact,
        run_id=str(run_id or ""),
        source_tool=source_tool,
        tool_use_id=tool_use_id,
    )
    record: dict[str, Any] = {
        "schema_version": RUN_OUTPUT_RECORD_VERSION,
        "output_id": output_id,
        "run_id": _bounded_text(run_id, MAX_OUTPUT_ID_CHARS),
        "kind": RunOutputKind.ARTIFACT.value,
        "status": RunOutputStatus.PRODUCED.value,
        "source": {
            "tool_use_id": tool_use_id,
            "tool_name": source_tool,
        },
        "artifact": {
            "name": name,
            "file_type": file_type,
            # Paths already live in message metadata. The canonical run record
            # keeps only a digest so diagnostics do not create another path log.
            "path_sha256": _sha256(
                {"domain": "aria.run-output.path.v1", "path": path}
            ),
        },
    }
    project_file_id = artifact.get("project_file_id")
    if isinstance(project_file_id, int):
        record["artifact"]["project_file_id"] = project_file_id
    valid, reason = validate_run_output_record(record)
    if not valid:
        return mark_run_output_failed(record, "ARTIFACT_SCHEMA_INVALID", reason)
    return record


def mark_artifact_output_persisted(
    record: dict[str, Any],
    *,
    generated_file_id: int,
    size_bytes: int,
    content_sha256: str,
    project_file_id: int | None = None,
) -> dict[str, Any]:
    payload = normalize_run_output_record(record)
    artifact = dict(payload.get("artifact") or {})
    artifact.update(
        {
            "generated_file_id": int(generated_file_id),
            "size_bytes": max(0, int(size_bytes)),
            "content_sha256": _bounded_text(content_sha256, 64),
        }
    )
    if project_file_id is not None:
        artifact["project_file_id"] = int(project_file_id)
    payload["artifact"] = artifact
    payload["status"] = RunOutputStatus.PERSISTED.value
    payload.pop("failure", None)
    return payload


def build_memory_candidate_output_record(candidate: Any) -> dict[str, Any]:
    """Build a no-content reference to a persisted review candidate."""

    candidate_id = getattr(candidate, "id", None)
    content_sha256 = _bounded_text(getattr(candidate, "content_sha256", ""), 64)
    status = str(getattr(candidate, "status", "pending") or "pending")
    output_status = {
        "pending": RunOutputStatus.PENDING_REVIEW.value,
        "accepted": RunOutputStatus.ACCEPTED.value,
        "rejected": RunOutputStatus.REJECTED.value,
        "archived": RunOutputStatus.REJECTED.value,
    }.get(status, RunOutputStatus.FAILED.value)
    return {
        "schema_version": RUN_OUTPUT_RECORD_VERSION,
        "output_id": f"out_memory_{candidate_id}",
        "run_id": _bounded_text(getattr(candidate, "source_run_id", ""), MAX_OUTPUT_ID_CHARS),
        "kind": RunOutputKind.MEMORY_CANDIDATE.value,
        "status": output_status,
        "source": {
            "source_type": _bounded_text(getattr(candidate, "source_type", ""), 40),
            "source_id": _bounded_text(getattr(candidate, "source_id", ""), MAX_OUTPUT_ID_CHARS),
        },
        "memory_candidate": {
            "candidate_id": int(candidate_id) if candidate_id is not None else None,
            "scope": _bounded_text(getattr(candidate, "scope", ""), 24),
            "candidate_type": _bounded_text(getattr(candidate, "candidate_type", ""), 48),
            "content_sha256": content_sha256,
            "applied_memory_version": getattr(candidate, "applied_memory_version", None),
        },
    }


def mark_run_output_failed(
    record: dict[str, Any],
    code: str,
    message: str,
) -> dict[str, Any]:
    payload = dict(record or {})
    payload.setdefault("schema_version", RUN_OUTPUT_RECORD_VERSION)
    payload["status"] = RunOutputStatus.FAILED.value
    payload["failure"] = {
        "code": _bounded_text(code, 80) or "OUTPUT_PERSISTENCE_FAILED",
        "message": _bounded_text(message, MAX_FAILURE_MESSAGE_CHARS),
    }
    return payload


def validate_run_output_record(value: Any) -> tuple[bool, str]:
    if not isinstance(value, dict):
        return False, "run output record must be an object"
    if value.get("schema_version") != RUN_OUTPUT_RECORD_VERSION:
        return False, "unsupported run output schema version"
    output_id = str(value.get("output_id") or "")
    if not output_id or len(output_id) > MAX_OUTPUT_ID_CHARS:
        return False, "invalid output_id"
    kind = str(value.get("kind") or "")
    status = str(value.get("status") or "")
    if kind not in _KINDS:
        return False, "invalid output kind"
    if status not in _STATUSES:
        return False, "invalid output status"
    if kind == RunOutputKind.ARTIFACT.value:
        artifact = value.get("artifact")
        if not isinstance(artifact, dict):
            return False, "artifact output is missing artifact metadata"
        # A failed record must remain valid even when the producer omitted a
        # required artifact field. Otherwise the persistence failure itself
        # could not be represented by the canonical output contract.
        if status != RunOutputStatus.FAILED.value:
            if not str(artifact.get("name") or "").strip():
                return False, "artifact name is required"
            if not str(artifact.get("file_type") or "").strip():
                return False, "artifact file_type is required"
            if len(str(artifact.get("path_sha256") or "")) != 64:
                return False, "artifact path digest is invalid"
        if status == RunOutputStatus.PERSISTED.value:
            if not isinstance(artifact.get("generated_file_id"), int):
                return False, "persisted artifact is missing generated_file_id"
            if len(str(artifact.get("content_sha256") or "")) != 64:
                return False, "persisted artifact content digest is invalid"
    if kind == RunOutputKind.MEMORY_CANDIDATE.value:
        candidate = value.get("memory_candidate")
        if not isinstance(candidate, dict):
            return False, "memory candidate metadata is missing"
        if not isinstance(candidate.get("candidate_id"), int):
            return False, "memory candidate id is required"
        if len(str(candidate.get("content_sha256") or "")) != 64:
            return False, "memory candidate content digest is invalid"
    if status == RunOutputStatus.FAILED.value:
        failure = value.get("failure")
        if not isinstance(failure, dict) or not str(failure.get("code") or "").strip():
            return False, "failed output is missing a failure code"
    return True, ""


def normalize_run_output_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    # JSON round-trip enforces the same safe representation used by message and
    # rollout persistence and drops object identity from mutable state.
    payload = json.loads(_stable_json(value))
    valid, reason = validate_run_output_record(payload)
    return payload if valid else mark_run_output_failed(payload, "RUN_OUTPUT_INVALID", reason)


def normalize_run_output_records(values: Iterable[Any]) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for value in values:
        payload = normalize_run_output_record(value)
        output_id = str(payload.get("output_id") or "")
        if not output_id:
            continue
        if output_id not in by_id:
            order.append(output_id)
        by_id[output_id] = payload
    bounded_ids = order[-MAX_RUN_OUTPUT_RECORDS:]
    return [by_id[output_id] for output_id in bounded_ids]


def append_run_output_record(
    records: list[dict[str, Any]],
    record: dict[str, Any],
) -> dict[str, Any]:
    payload = normalize_run_output_record(record)
    output_id = str(payload.get("output_id") or "")
    remaining = [
        item
        for item in records
        if isinstance(item, dict) and str(item.get("output_id") or "") != output_id
    ]
    remaining.append(payload)
    records[:] = normalize_run_output_records(remaining)
    return payload


def run_output_reference(record: dict[str, Any]) -> dict[str, Any]:
    """Return the compact identity used by product events and diagnostics."""

    payload = normalize_run_output_record(record)
    return {
        "schema_version": RUN_OUTPUT_RECORD_VERSION,
        "output_id": str(payload.get("output_id") or ""),
        "kind": str(payload.get("kind") or ""),
        "status": str(payload.get("status") or ""),
    }
