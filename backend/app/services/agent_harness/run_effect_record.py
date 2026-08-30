"""Content-free effect records used to recover interrupted Aria runs safely.

The fail-closed replay decision and executed-call identity are adapted from
OpenAI Codex ``codex-rs/core/src/tools/executed_tool_calls.rs`` and
``codex-rs/core/src/tools/registry.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-30: translated into Aria's provider-neutral
tool/effect model, bound to durable Aria artifacts and HITAS authorization,
and reduced to content-free hashes and entity references. No Codex runtime,
SDK, protocol, account, or subprocess is used.

The record deliberately keeps only tool identity, the canonical input digest,
bounded Aria entity references, and persisted-result references.  Raw tool
arguments and results never cross this boundary.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable

from app.services.agent_harness.run_output_record import normalize_run_output_records
from app.tools.capabilities import TOOL_CAPABILITY_MANIFEST_VERSION, ToolEffect, resolve_tool_capability


RUN_EFFECT_RECORD_VERSION = 1
RUN_EFFECT_LEDGER_VERSION = 1
MAX_RUN_EFFECT_RECORDS = 64
_MUTATING_EFFECTS = frozenset(
    {ToolEffect.CREATE.value, ToolEffect.MODIFY.value, ToolEffect.DELETE.value, ToolEffect.EXTERNAL.value}
)
_KNOWN_EFFECTS = frozenset({item.value for item in ToolEffect})
_HEX_64 = re.compile(r"^[a-f0-9]{64}$")
_TARGET_ID_KEYS = (
    "project_id",
    "project_file_id",
    "file_id",
    "folder_id",
    "generated_file_id",
    "version_id",
    "task_id",
    "client_id",
    "milestone_id",
    "todo_id",
    "artifact_id",
)
_TARGET_DIGEST_KEYS = ("base_sha256", "content_sha256", "expected_sha256")


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def canonical_tool_input_sha256(tool_input: Any) -> str:
    payload = tool_input if isinstance(tool_input, dict) else {}
    return hashlib.sha256(_stable_json(payload).encode("utf-8")).hexdigest()


def _bounded(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def _positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _safe_target_ref(tool_input: dict[str, Any], *, effect: str) -> dict[str, Any]:
    ids: dict[str, int | str] = {}
    for key in _TARGET_ID_KEYS:
        value = tool_input.get(key)
        if isinstance(value, bool) or value is None:
            continue
        if isinstance(value, int):
            if value > 0:
                ids[key] = value
            continue
        rendered = _bounded(value, 80)
        if rendered and re.fullmatch(r"[A-Za-z0-9_-]+", rendered):
            ids[key] = rendered
    digests = {
        key: str(tool_input.get(key) or "").lower()
        for key in _TARGET_DIGEST_KEYS
        if _HEX_64.fullmatch(str(tool_input.get(key) or "").lower())
    }
    if not ids and not digests:
        return {"kind": "new_artifact" if effect == ToolEffect.CREATE.value else "unresolved"}
    payload: dict[str, Any] = {"kind": "aria_entity", "ids": ids}
    if digests:
        payload["digests"] = digests
    return payload


def _event_for_call(
    tool_call: dict[str, Any],
    tool_events: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    tool_use_id = str(tool_call.get("id") or "")
    tool_name = str(tool_call.get("name") or "")
    candidates = [
        event
        for event in tool_events
        if isinstance(event, dict)
        and (
            (tool_use_id and str(event.get("tool_use_id") or "") == tool_use_id)
            or (not tool_use_id and str(event.get("tool_name") or "") == tool_name)
        )
    ]
    return candidates[-1] if candidates else {}


def _outcome_from_event(event: dict[str, Any]) -> str:
    status = str(event.get("status") or "").strip().lower()
    if status in {"completed", "success", "succeeded", "done"}:
        return "completed"
    if status in {"confirmation_required", "waiting_confirmation", "pending_confirmation"}:
        return "pending_confirmation"
    if status in {"blocked", "skipped", "suppressed"}:
        return "not_executed"
    if status in {"error", "failed", "failure", "conflict", "cancelled"}:
        return "failed"
    return "unknown"


def _persisted_result_ref(output: Any, *, tool_use_id: str, tool_name: str) -> dict[str, Any]:
    if not isinstance(output, dict) or output.get("kind") != "artifact" or output.get("status") != "persisted":
        return {}
    source = output.get("source") if isinstance(output.get("source"), dict) else {}
    if tool_use_id and str(source.get("tool_use_id") or "") != tool_use_id:
        return {}
    if tool_name and str(source.get("tool_name") or "") != tool_name:
        return {}
    artifact = output.get("artifact") if isinstance(output.get("artifact"), dict) else {}
    generated_file_id = artifact.get("generated_file_id")
    content_sha256 = str(artifact.get("content_sha256") or "").lower()
    output_id = _bounded(output.get("output_id"), 96)
    if not _positive_int(generated_file_id) or not output_id:
        return {}
    if not _HEX_64.fullmatch(content_sha256):
        return {}
    result: dict[str, Any] = {
        "kind": "persisted_artifact",
        "output_id": output_id,
        "generated_file_id": generated_file_id,
        "content_sha256": content_sha256,
    }
    if _positive_int(artifact.get("project_file_id")):
        result["project_file_id"] = artifact["project_file_id"]
    return result


def result_ref_is_verifiable(value: Any) -> bool:
    project_file_id = value.get("project_file_id") if isinstance(value, dict) else None
    return bool(
        isinstance(value, dict)
        and value.get("kind") == "persisted_artifact"
        and _bounded(value.get("output_id"), 96)
        and _positive_int(value.get("generated_file_id"))
        and (project_file_id is None or _positive_int(project_file_id))
        and _HEX_64.fullmatch(str(value.get("content_sha256") or "").lower())
    )


def normalize_run_effect_record(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema_version") != RUN_EFFECT_RECORD_VERSION:
        return {}
    if isinstance(value.get("step_index"), bool):
        return {}
    try:
        step_index = int(value.get("step_index"))
    except (TypeError, ValueError):
        return {}
    tool_use_id = _bounded(value.get("tool_use_id"), 200)
    tool_name = _bounded(value.get("tool_name"), 120)
    input_sha256 = str(value.get("input_sha256") or "").lower()
    effect = str(value.get("effect") or "")
    outcome = str(value.get("outcome") or "")
    if step_index < 0 or not tool_name or not _HEX_64.fullmatch(input_sha256) or effect not in _KNOWN_EFFECTS:
        return {}
    if outcome not in {"unknown", "completed", "persisted", "failed", "pending_confirmation", "not_executed"}:
        return {}
    target = value.get("target_ref") if isinstance(value.get("target_ref"), dict) else {"kind": "unresolved"}
    safe_target: dict[str, Any] = {"kind": str(target.get("kind") or "unresolved")[:32]}
    ids = target.get("ids") if isinstance(target.get("ids"), dict) else {}
    safe_ids = {
        key: ids[key]
        for key in _TARGET_ID_KEYS
        if key in ids
        and not isinstance(ids[key], bool)
        and isinstance(ids[key], (int, str))
    }
    if safe_ids:
        safe_target["ids"] = safe_ids
    digests = target.get("digests") if isinstance(target.get("digests"), dict) else {}
    safe_digests = {
        key: str(digests[key]).lower()
        for key in _TARGET_DIGEST_KEYS
        if key in digests and _HEX_64.fullmatch(str(digests[key]).lower())
    }
    if safe_digests:
        safe_target["digests"] = safe_digests
    payload: dict[str, Any] = {
        "schema_version": RUN_EFFECT_RECORD_VERSION,
        "step_index": step_index,
        "tool_use_id": tool_use_id,
        "tool_name": tool_name,
        "input_sha256": input_sha256,
        "effect": effect,
        "outcome": outcome,
        "target_ref": safe_target,
    }
    result_ref = value.get("result_ref")
    if outcome == "persisted" and result_ref_is_verifiable(result_ref):
        payload["result_ref"] = {
            key: result_ref[key]
            for key in ("kind", "output_id", "generated_file_id", "project_file_id", "content_sha256")
            if key in result_ref
        }
    elif outcome == "persisted":
        return {}
    return payload


def build_step_effect_records(
    step_index: int,
    tool_calls: Iterable[dict[str, Any]],
    tool_events: Iterable[dict[str, Any]],
    *,
    recovered_effects: Iterable[dict[str, Any]] = (),
) -> list[dict[str, Any]]:
    recovered = [normalize_run_effect_record(item) for item in recovered_effects]
    records: list[dict[str, Any]] = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        tool_name = _bounded(call.get("name"), 120)
        if not tool_name:
            continue
        tool_input = call.get("input") if isinstance(call.get("input"), dict) else {}
        tool_use_id = _bounded(call.get("id"), 200)
        input_sha256 = canonical_tool_input_sha256(tool_input)
        rebound = next(
            (
                item
                for item in recovered
                if item
                and item.get("step_index") == step_index
                and item.get("tool_use_id") == tool_use_id
                and item.get("tool_name") == tool_name
                and item.get("input_sha256") == input_sha256
                and item.get("outcome") == "persisted"
            ),
            None,
        )
        if rebound:
            records.append(rebound)
            continue
        capability = resolve_tool_capability(tool_name, tool_input)
        event = _event_for_call(call, tool_events)
        effect = str(event.get("tool_effect") or capability.effect.value)
        if effect not in _KNOWN_EFFECTS:
            effect = capability.effect.value
        records.append(
            {
                "schema_version": RUN_EFFECT_RECORD_VERSION,
                "step_index": max(0, int(step_index)),
                "tool_use_id": tool_use_id,
                "tool_name": tool_name,
                "input_sha256": input_sha256,
                "effect": effect,
                "outcome": _outcome_from_event(event),
                "target_ref": _safe_target_ref(tool_input, effect=effect),
            }
        )
    return records[:MAX_RUN_EFFECT_RECORDS]


def build_rollout_effect_ledger(
    steps: Iterable[dict[str, Any]],
    run_outputs: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    outputs = normalize_run_output_records(run_outputs)
    records: list[dict[str, Any]] = []
    legacy_or_unknown_mutating = 0
    for step in steps:
        if not isinstance(step, dict):
            continue
        raw_records = step.get("effect_records") if isinstance(step.get("effect_records"), list) else []
        normalized = [normalize_run_effect_record(item) for item in raw_records]
        normalized = [item for item in normalized if item]
        indexed = {(item["tool_use_id"], item["tool_name"], item["input_sha256"]) for item in normalized}
        for item in normalized:
            if item["effect"] in _MUTATING_EFFECTS:
                result_ref = next(
                    (
                        _persisted_result_ref(
                            output,
                            tool_use_id=item["tool_use_id"],
                            tool_name=item["tool_name"],
                        )
                        for output in outputs
                        if _persisted_result_ref(
                            output,
                            tool_use_id=item["tool_use_id"],
                            tool_name=item["tool_name"],
                        )
                    ),
                    {},
                )
                if result_ref:
                    item = {**item, "outcome": "persisted", "result_ref": result_ref}
            records.append(item)
        for call in list(step.get("tool_calls") or []):
            if not isinstance(call, dict):
                continue
            identity = (
                str(call.get("tool_use_id") or ""),
                str(call.get("tool_name") or ""),
                str(call.get("input_sha256") or ""),
            )
            if identity in indexed:
                continue
            tool_name = identity[1]
            event = next(
                (
                    event
                    for event in list(step.get("tool_events") or [])
                    if isinstance(event, dict)
                    and str(event.get("tool_use_id") or "") == identity[0]
                ),
                {},
            )
            effect = str(event.get("tool_effect") or resolve_tool_capability(tool_name).effect.value)
            if effect in _MUTATING_EFFECTS:
                legacy_or_unknown_mutating += 1

    records = records[:MAX_RUN_EFFECT_RECORDS]
    mutating = [item for item in records if item["effect"] in _MUTATING_EFFECTS]
    unresolved = [
        item
        for item in mutating
        if item.get("outcome") not in {"persisted", "not_executed"}
    ]
    matched_output_ids = {
        str(item.get("result_ref", {}).get("output_id") or "")
        for item in mutating
        if isinstance(item.get("result_ref"), dict)
    }
    orphan_persisted = sum(
        1
        for output in outputs
        if output.get("kind") == "artifact"
        and output.get("status") == "persisted"
        and str(output.get("output_id") or "") not in matched_output_ids
    )
    return {
        "schema_version": RUN_EFFECT_LEDGER_VERSION,
        "records": records,
        "integrity": {
            "mutating_effect_count": len(mutating),
            "verified_persisted_count": sum(item.get("outcome") == "persisted" for item in mutating),
            "unresolved_mutating_count": len(unresolved),
            "legacy_or_unknown_mutating_count": legacy_or_unknown_mutating,
            "orphan_persisted_result_count": orphan_persisted,
        },
    }


def normalize_run_effect_ledger(value: Any) -> dict[str, Any]:
    """Return the bounded, content-free ledger shape accepted by recovery."""

    if not isinstance(value, dict) or value.get("schema_version") != RUN_EFFECT_LEDGER_VERSION:
        return {}
    raw_records = value.get("records")
    if not isinstance(raw_records, list):
        return {}
    records = [normalize_run_effect_record(item) for item in raw_records[:MAX_RUN_EFFECT_RECORDS]]
    records = [item for item in records if item]
    raw_integrity = value.get("integrity") if isinstance(value.get("integrity"), dict) else {}
    mutating = [item for item in records if item["effect"] in _MUTATING_EFFECTS]
    unresolved = [
        item
        for item in mutating
        if item.get("outcome") not in {"persisted", "not_executed"}
    ]

    def bounded_count(key: str) -> int:
        return max(0, min(_safe_int(raw_integrity.get(key)), MAX_RUN_EFFECT_RECORDS))

    return {
        "schema_version": RUN_EFFECT_LEDGER_VERSION,
        "records": records,
        "integrity": {
            "mutating_effect_count": max(
                len(mutating),
                bounded_count("mutating_effect_count"),
            ),
            "verified_persisted_count": sum(
                item.get("outcome") == "persisted" for item in mutating
            ),
            "unresolved_mutating_count": max(
                len(unresolved),
                bounded_count("unresolved_mutating_count"),
            ),
            "legacy_or_unknown_mutating_count": bounded_count(
                "legacy_or_unknown_mutating_count"
            ),
            "orphan_persisted_result_count": bounded_count(
                "orphan_persisted_result_count"
            ),
        },
    }


@dataclass(frozen=True)
class RecoveryEffectDecision:
    action: str
    reason: str
    effect_record: dict[str, Any] | None = None


def decide_recovery_effect(
    recovery: Any,
    *,
    tool_name: str,
    tool_input: dict[str, Any],
) -> RecoveryEffectDecision:
    capability = resolve_tool_capability(tool_name, tool_input)
    if capability.effect is ToolEffect.READ or not isinstance(recovery, dict) or not recovery:
        return RecoveryEffectDecision("proceed", "read_or_no_recovery")
    if recovery.get("schema_version") != 2:
        return RecoveryEffectDecision("manual_review", "legacy_recovery_has_no_verifiable_effect_ledger")
    ledger = normalize_run_effect_ledger(recovery.get("effect_ledger"))
    if not ledger:
        return RecoveryEffectDecision("manual_review", "recovery_effect_ledger_is_invalid")
    integrity = ledger.get("integrity") if isinstance(ledger.get("integrity"), dict) else {}
    records = [normalize_run_effect_record(item) for item in list(ledger.get("records") or [])]
    records = [item for item in records if item]
    digest = canonical_tool_input_sha256(tool_input)
    exact = next(
        (
            item
            for item in records
            if item.get("tool_name") == tool_name
            and item.get("input_sha256") == digest
            and item.get("effect") in _MUTATING_EFFECTS
        ),
        None,
    )
    # Recovery strategy remains authoritative. ``retry_read_step`` may never
    # convert a mutating proposal into a completion claim, even when an exact
    # persisted record exists; the user chose a read-only retry contract.
    if recovery.get("strategy") == "retry_read_step":
        return RecoveryEffectDecision("manual_review", "retry_read_step_forbids_mutating_tools", exact)
    if recovery.get("strategy") == "manual_review":
        return RecoveryEffectDecision("manual_review", "recovery_contract_requires_manual_review", exact)
    if exact and exact.get("outcome") == "persisted" and result_ref_is_verifiable(exact.get("result_ref")):
        return RecoveryEffectDecision("already_completed", "identical_write_has_verified_persisted_artifact", exact)
    world_change = recovery.get("world_state_change")
    if isinstance(world_change, dict) and world_change.get("changed"):
        return RecoveryEffectDecision(
            "manual_review",
            "project_world_state_changed_since_source_run",
            exact,
        )
    if any(
        _safe_int(integrity.get(key)) > 0
        for key in (
            "unresolved_mutating_count",
            "legacy_or_unknown_mutating_count",
            "orphan_persisted_result_count",
        )
    ):
        return RecoveryEffectDecision("manual_review", "source_side_effects_cannot_be_verified", exact)
    if exact:
        return RecoveryEffectDecision("manual_review", "identical_prior_write_lacks_persisted_artifact_evidence", exact)
    return RecoveryEffectDecision("proceed", "new_mutation_under_current_aria_policy")
