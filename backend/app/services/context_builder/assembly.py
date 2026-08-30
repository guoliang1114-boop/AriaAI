"""Versioned, provider-neutral context assembly for Aria model requests.

Stable section identities, duplicate rejection, compact persisted snapshots,
and domain-separated model-visible fingerprints are adapted from OpenAI
Codex's ``codex-rs/core/src/context/world_state/mod.rs``. The distinction
between retained prompt state and the model request rendered after budgeting
also follows ``codex-rs/core/src/context_manager/history.rs`` at upstream
commit ``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: translated to Python, reduced to Aria's
business context layers, switched to SHA-256, and combined with Aria's local
context budget. Persisted manifests contain only bounded metadata, counts, and
fingerprints; raw prompts, messages, retrieved text, and tool schemas are never
stored. This module does not import, run, or communicate with Codex.

Extended for AriaAI on 2026-08-30: added content-free, base-linked derived
request receipts that bind verified durable-input identities to the exact
effective system, messages, and tools after normalization and budgeting.
"""
from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Iterable, Mapping

from app.services.agent_harness.context_budget import (
    ContextBudgetReport,
    apply_context_budget,
    approx_token_count,
    estimate_message_tokens,
    estimate_tools_tokens,
)


CONTEXT_ASSEMBLY_SCHEMA_VERSION = 1
POST_ASSEMBLY_REQUEST_SCHEMA_VERSION = 1
MAX_CONTEXT_SOURCES = 24
# One already-applied post-model batch can be carried into the next request
# while a second full batch commits before that request's opening boundary.
MAX_POST_ASSEMBLY_INPUTS = 24
MAX_SOURCE_ID_CHARS = 64
MAX_SOURCE_METADATA_FIELDS = 12
MAX_SOURCE_METADATA_KEY_CHARS = 48
MAX_SOURCE_METADATA_VALUE_CHARS = 160

_SOURCE_ID_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_VALID_SOURCE_KINDS = {
    "instructions",
    "workspace",
    "retrieval",
    "memory",
    "execution_state",
    "policy",
    "preferences",
    "conversation",
    "tools",
}
_VALID_TRUST_LEVELS = {"platform", "workspace", "retrieved", "user"}


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _normalized_text(value: str) -> str:
    return (value or "").replace("\r\n", "\n")


def _fingerprint(namespace: str, *components: str) -> str:
    hasher = hashlib.sha256()
    hasher.update(f"aria-context-{namespace}-v1\0".encode("utf-8"))
    for component in components:
        encoded = _normalized_text(component).encode("utf-8")
        hasher.update(len(encoded).to_bytes(8, "big"))
        hasher.update(encoded)
    return hasher.hexdigest()


def _bounded_metadata(metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    if not metadata:
        return {}
    bounded: dict[str, Any] = {}
    for raw_key in sorted(metadata, key=str)[:MAX_SOURCE_METADATA_FIELDS]:
        key = str(raw_key)[:MAX_SOURCE_METADATA_KEY_CHARS]
        value = metadata[raw_key]
        if value is None or isinstance(value, (bool, int, float)):
            bounded[key] = value
        else:
            bounded[key] = str(value)[:MAX_SOURCE_METADATA_VALUE_CHARS]
    return bounded


@dataclass(frozen=True)
class ContextSourceInput:
    """One in-memory logical source; ``content`` is never persisted verbatim."""

    source_id: str
    kind: str
    trust: str
    content: str
    metadata: Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        if not _SOURCE_ID_RE.fullmatch(self.source_id or ""):
            raise ValueError(f"invalid context source id: {self.source_id!r}")
        if self.kind not in _VALID_SOURCE_KINDS:
            raise ValueError(f"invalid context source kind: {self.kind!r}")
        if self.trust not in _VALID_TRUST_LEVELS:
            raise ValueError(f"invalid context trust level: {self.trust!r}")
        if not isinstance(self.content, str):
            raise TypeError("context source content must be a string")


@dataclass(frozen=True)
class ContextAssembly:
    """The exact provider request inputs plus their safe persisted manifest."""

    system: str
    messages: list[dict[str, Any]]
    tools: list[dict] | None
    budget_report: ContextBudgetReport
    manifest: dict[str, Any]


def _source_record(source: ContextSourceInput, position: int) -> dict[str, Any]:
    normalized = _normalized_text(source.content)
    return {
        "source_id": source.source_id,
        "kind": source.kind,
        "trust": source.trust,
        "position": position,
        "included": bool(normalized.strip()),
        "chars": len(normalized),
        "estimated_tokens": approx_token_count(normalized),
        "content_sha256": _fingerprint("source", source.source_id, normalized),
        "metadata": _bounded_metadata(source.metadata),
    }


def _message_snapshot(messages: list[dict[str, Any]]) -> dict[str, Any]:
    rendered = _canonical_json(messages)
    return {
        "message_count": len(messages),
        "structured_message_count": sum(
            isinstance(message.get("content"), list)
            for message in messages
            if isinstance(message, dict)
        ),
        "estimated_tokens": sum(
            estimate_message_tokens(message)
            for message in messages
            if isinstance(message, dict)
        ),
        "sha256": _fingerprint("messages", rendered),
    }


def _tools_snapshot(tools: list[dict] | None) -> dict[str, Any]:
    normalized_tools = tools or []
    return {
        "tool_count": len(normalized_tools),
        "estimated_tokens": estimate_tools_tokens(normalized_tools),
        "sha256": _fingerprint("tools", _canonical_json(normalized_tools)),
    }


def _manifest_fingerprint(manifest_without_fingerprint: Mapping[str, Any]) -> str:
    return _fingerprint("manifest", _canonical_json(manifest_without_fingerprint))


def assemble_context(
    *,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None,
    sources: Iterable[ContextSourceInput],
    context_window_tokens: int,
    max_output_tokens: int,
    safety_margin_percent: int = 8,
    minimum_recent_messages: int = 4,
    history_summary_tokens: int = 1_024,
) -> ContextAssembly:
    """Budget one exact model request and build its privacy-safe manifest."""

    source_list = list(sources)
    if len(source_list) > MAX_CONTEXT_SOURCES:
        raise ValueError(
            f"context source limit exceeded: {len(source_list)} > {MAX_CONTEXT_SOURCES}"
        )
    source_ids = [source.source_id for source in source_list]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("duplicate context source id")

    original_messages = deepcopy(messages)
    original_tools = deepcopy(tools) if tools is not None else None
    budgeted = apply_context_budget(
        system=system,
        messages=original_messages,
        tools=original_tools,
        context_window_tokens=context_window_tokens,
        max_output_tokens=max_output_tokens,
        safety_margin_percent=safety_margin_percent,
        minimum_recent_messages=minimum_recent_messages,
        history_summary_tokens=history_summary_tokens,
    )
    final_tools = deepcopy(original_tools) if original_tools is not None else None
    source_records = [
        _source_record(source, position)
        for position, source in enumerate(source_list)
    ]
    source_records.extend(
        [
            _source_record(
                ContextSourceInput(
                    source_id="conversation_history",
                    kind="conversation",
                    trust="user",
                    content=_canonical_json(original_messages),
                    metadata={"message_count": len(original_messages)},
                ),
                len(source_records),
            ),
            _source_record(
                ContextSourceInput(
                    source_id="tool_catalog",
                    kind="tools",
                    trust="platform",
                    content=_canonical_json(original_tools or []),
                    metadata={"tool_count": len(original_tools or [])},
                ),
                len(source_records) + 1,
            ),
        ]
    )

    budget = budgeted.report.to_dict()
    manifest_core: dict[str, Any] = {
        "schema_version": CONTEXT_ASSEMBLY_SCHEMA_VERSION,
        "sources": source_records,
        "summary": {
            "source_count": len(source_records),
            "included_source_count": sum(record["included"] for record in source_records),
            "compacted": budgeted.report.compacted,
            "system_compacted": (
                budgeted.report.system_tokens_after
                < budgeted.report.system_tokens_before
            ),
            "history_compacted": (
                budgeted.report.history_tokens_after
                < budgeted.report.history_tokens_before
                or budgeted.report.history_messages_after
                < budgeted.report.history_messages_before
            ),
        },
        "budget": budget,
        "model_input": {
            "system": {
                "chars": len(budgeted.system),
                "estimated_tokens": approx_token_count(budgeted.system),
                "sha256": _fingerprint("system", budgeted.system),
            },
            "messages": _message_snapshot(budgeted.messages),
            "tools": _tools_snapshot(final_tools),
        },
    }
    manifest = {
        **manifest_core,
        "manifest_sha256": _manifest_fingerprint(manifest_core),
    }
    return ContextAssembly(
        system=budgeted.system,
        messages=budgeted.messages,
        tools=final_tools,
        budget_report=budgeted.report,
        manifest=manifest,
    )


def validate_context_assembly_manifest(manifest: Any) -> tuple[bool, str]:
    """Validate a persisted manifest without requiring any raw prompt content."""

    if not isinstance(manifest, dict):
        return False, "manifest_not_object"
    if manifest.get("schema_version") != CONTEXT_ASSEMBLY_SCHEMA_VERSION:
        return False, "unsupported_schema_version"
    sources = manifest.get("sources")
    if not isinstance(sources, list) or len(sources) > MAX_CONTEXT_SOURCES + 2:
        return False, "invalid_source_count"
    source_ids: list[str] = []
    for position, source in enumerate(sources):
        if not isinstance(source, dict):
            return False, "source_not_object"
        source_id = source.get("source_id")
        if not isinstance(source_id, str) or not _SOURCE_ID_RE.fullmatch(source_id):
            return False, "invalid_source_id"
        if source.get("position") != position:
            return False, "invalid_source_position"
        if source.get("kind") not in _VALID_SOURCE_KINDS:
            return False, "invalid_source_kind"
        if source.get("trust") not in _VALID_TRUST_LEVELS:
            return False, "invalid_source_trust"
        digest = source.get("content_sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            return False, "invalid_source_fingerprint"
        source_ids.append(source_id)
    if len(source_ids) != len(set(source_ids)):
        return False, "duplicate_source_id"

    summary = manifest.get("summary")
    if not isinstance(summary, dict) or summary.get("source_count") != len(sources):
        return False, "invalid_summary"
    budget = manifest.get("budget")
    if not isinstance(budget, dict):
        return False, "invalid_budget"
    try:
        effective_limit = int(budget["context_window_tokens"]) - int(
            budget["safety_margin_tokens"]
        )
        estimated_after = int(budget["estimated_total_after"])
    except (KeyError, TypeError, ValueError):
        return False, "invalid_budget_values"
    if estimated_after > effective_limit:
        return False, "budget_exceeded"

    model_input = manifest.get("model_input")
    if not isinstance(model_input, dict):
        return False, "invalid_model_input"
    for section in ("system", "messages", "tools"):
        snapshot = model_input.get(section)
        if not isinstance(snapshot, dict):
            return False, f"missing_{section}_snapshot"
        digest = snapshot.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            return False, f"invalid_{section}_fingerprint"

    stored_fingerprint = manifest.get("manifest_sha256")
    if not isinstance(stored_fingerprint, str):
        return False, "missing_manifest_fingerprint"
    core = dict(manifest)
    core.pop("manifest_sha256", None)
    if stored_fingerprint != _manifest_fingerprint(core):
        return False, "manifest_fingerprint_mismatch"
    return True, "valid"


def validate_context_assembly_request(
    manifest: Any,
    *,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None,
) -> tuple[bool, str]:
    """Verify that the first provider request still matches its manifest."""

    valid, reason = validate_context_assembly_manifest(manifest)
    if not valid:
        return False, reason
    expected = manifest["model_input"]
    actual = {
        "system": {
            "chars": len(system or ""),
            "estimated_tokens": approx_token_count(system or ""),
            "sha256": _fingerprint("system", system or ""),
        },
        "messages": _message_snapshot(messages),
        "tools": _tools_snapshot(tools),
    }
    for section in ("system", "messages", "tools"):
        if actual[section] != expected.get(section):
            return False, f"{section}_request_mismatch"
    return True, "valid"


def _normalized_post_assembly_inputs(value: Any) -> tuple[list[dict[str, Any]], str]:
    if not isinstance(value, list) or not value or len(value) > MAX_POST_ASSEMBLY_INPUTS:
        return [], "invalid_post_assembly_input_count"
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for item in value:
        if not isinstance(item, dict):
            return [], "post_assembly_input_not_object"
        run_id = item.get("run_id")
        steering_id = item.get("steering_id")
        sequence = item.get("sequence")
        message_id = item.get("message_id")
        digest = item.get("content_sha256")
        if not isinstance(run_id, str) or not re.fullmatch(
            r"run_[A-Za-z0-9_-]{1,76}", run_id
        ):
            return [], "invalid_post_assembly_run_id"
        if not isinstance(steering_id, str) or not re.fullmatch(
            r"steer_[A-Za-z0-9_-]{1,64}", steering_id
        ):
            return [], "invalid_post_assembly_steering_id"
        if (
            not isinstance(sequence, int)
            or isinstance(sequence, bool)
            or sequence < 1
            or not isinstance(message_id, int)
            or isinstance(message_id, bool)
            or message_id < 1
        ):
            return [], "invalid_post_assembly_input_identity"
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            return [], "invalid_post_assembly_content_fingerprint"
        identity = (run_id, sequence)
        if identity in seen:
            return [], "duplicate_post_assembly_input"
        seen.add(identity)
        normalized.append(
            {
                "run_id": run_id,
                "steering_id": steering_id,
                "sequence": sequence,
                "message_id": message_id,
                "content_sha256": digest,
            }
        )
    return normalized, "valid"


def build_post_assembly_request_manifest(
    base_manifest: Any,
    *,
    request_stage: str,
    durable_inputs: list[dict[str, Any]],
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None,
) -> dict[str, Any]:
    """Bind verified durable user inputs to one exact derived provider request.

    The record contains identities and hashes only. The original assembly must
    already match its raw request before callers apply these post-assembly
    additions; this receipt then covers any resulting system/tool contraction,
    transcript normalization, and context-budget compaction.
    """

    valid, reason = validate_context_assembly_manifest(base_manifest)
    if not valid:
        raise ValueError(f"invalid base context manifest: {reason}")
    normalized_inputs, reason = _normalized_post_assembly_inputs(durable_inputs)
    if reason != "valid":
        raise ValueError(reason)
    normalized_stage = str(request_stage or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", normalized_stage):
        raise ValueError("invalid post-assembly request stage")
    core: dict[str, Any] = {
        "schema_version": POST_ASSEMBLY_REQUEST_SCHEMA_VERSION,
        "base_manifest_sha256": str(base_manifest.get("manifest_sha256") or ""),
        "request_stage": normalized_stage,
        "delta_kind": "durable_run_steering",
        "durable_inputs": normalized_inputs,
        "model_input": {
            "system": {
                "chars": len(system or ""),
                "estimated_tokens": approx_token_count(system or ""),
                "sha256": _fingerprint("system", system or ""),
            },
            "messages": _message_snapshot(messages),
            "tools": _tools_snapshot(tools),
        },
    }
    return {
        **core,
        "derived_manifest_sha256": _fingerprint(
            "post_assembly_request",
            _canonical_json(core),
        ),
    }


def validate_post_assembly_request(
    derived_manifest: Any,
    base_manifest: Any,
    *,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict] | None,
) -> tuple[bool, str]:
    """Validate one derived request against its base and exact model inputs."""

    valid, reason = validate_context_assembly_manifest(base_manifest)
    if not valid:
        return False, f"base_{reason}"
    if not isinstance(derived_manifest, dict):
        return False, "derived_manifest_not_object"
    if derived_manifest.get("schema_version") != POST_ASSEMBLY_REQUEST_SCHEMA_VERSION:
        return False, "unsupported_derived_schema_version"
    if derived_manifest.get("base_manifest_sha256") != base_manifest.get(
        "manifest_sha256"
    ):
        return False, "base_manifest_mismatch"
    stage = derived_manifest.get("request_stage")
    if not isinstance(stage, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,64}", stage):
        return False, "invalid_post_assembly_request_stage"
    if derived_manifest.get("delta_kind") != "durable_run_steering":
        return False, "invalid_post_assembly_delta_kind"
    normalized_inputs, reason = _normalized_post_assembly_inputs(
        derived_manifest.get("durable_inputs")
    )
    if reason != "valid":
        return False, reason
    if normalized_inputs != derived_manifest.get("durable_inputs"):
        return False, "noncanonical_post_assembly_inputs"
    declared = derived_manifest.get("derived_manifest_sha256")
    core = dict(derived_manifest)
    core.pop("derived_manifest_sha256", None)
    expected_digest = _fingerprint(
        "post_assembly_request",
        _canonical_json(core),
    )
    if declared != expected_digest:
        return False, "derived_manifest_fingerprint_mismatch"
    actual_model_input = {
        "system": {
            "chars": len(system or ""),
            "estimated_tokens": approx_token_count(system or ""),
            "sha256": _fingerprint("system", system or ""),
        },
        "messages": _message_snapshot(messages),
        "tools": _tools_snapshot(tools),
    }
    if derived_manifest.get("model_input") != actual_model_input:
        return False, "derived_request_mismatch"
    return True, "valid"


def context_manifest_reference(manifest: Any) -> dict[str, Any]:
    """Return the small common identity consumed by product diagnostics."""

    valid, reason = validate_context_assembly_manifest(manifest)
    if not isinstance(manifest, dict):
        manifest = {}
    summary = manifest.get("summary") if isinstance(manifest.get("summary"), dict) else {}
    budget = manifest.get("budget") if isinstance(manifest.get("budget"), dict) else {}
    return {
        "schema_version": manifest.get("schema_version"),
        "manifest_sha256": str(manifest.get("manifest_sha256") or ""),
        "valid": valid,
        "validation_reason": reason,
        "source_count": int(summary.get("source_count") or 0),
        "included_source_count": int(summary.get("included_source_count") or 0),
        "compacted": bool(summary.get("compacted", False)),
        "estimated_total_after": int(budget.get("estimated_total_after") or 0),
    }
