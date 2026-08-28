"""Plan and guard Aria-native slot-level memory reconstruction.

The stable state/identity and reconstruction boundary is adapted from OpenAI
Codex ``codex-rs/core/src/context/world_state/mod.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).
Aria owns every slot, fact, permission, provider call, and write transaction;
no Codex runtime, SDK, process, protocol, or communication is used.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from app.services.memory_slots import (
    CLIENT_MEMORY_SLOT_KEYS,
    PROJECT_MEMORY_SLOT_KEYS,
)


class MemoryPatchValidationError(ValueError):
    """A partial provider result cannot safely replace every requested slot."""


class MemoryRebuildConflict(RuntimeError):
    """Business data changed after a rebuild captured its input baseline."""


@dataclass(frozen=True)
class MemoryRebuildPlan:
    scope: str
    mode: str
    slot_keys: tuple[str, ...]
    reason: str
    expected_memory_version: int
    slot_markers: dict[str, tuple[Any, ...]]

    @property
    def is_partial(self) -> bool:
        return self.mode == "partial"


_PROJECT_FORCE_FULL_TRIGGERS = frozenset(
    {
        "manual",
        "manual_queue_run",
        "batch",
        "batch_rebuild",
        "project_created",
    }
)
_CLIENT_FORCE_FULL_TRIGGERS = frozenset(
    {
        "manual",
        "manual_queue_run",
        "batch",
        "batch_rebuild",
        "client_created",
    }
)


def _state_marker(state: dict[str, Any]) -> tuple[Any, ...]:
    return (
        max(0, int(state.get("slot_version") or 0)),
        str(state.get("status") or "missing"),
        str(state.get("value_sha256") or ""),
        str(state.get("stale_at") or ""),
        str(state.get("updated_at") or ""),
    )


def memory_slot_markers(
    states: Iterable[dict[str, Any]],
) -> dict[str, tuple[Any, ...]]:
    return {
        str(state.get("slot_key") or ""): _state_marker(state)
        for state in states
        if str(state.get("slot_key") or "")
    }


def _normalized_trigger(value: str) -> str:
    normalized = str(value or "data_changed").strip().lower()
    if normalized.startswith("retry:"):
        return "retry"
    return normalized


def _plan_memory_rebuild(
    *,
    scope: str,
    all_slot_keys: tuple[str, ...],
    memory_version: int,
    parent_stale: bool,
    trigger: str,
    slot_states: Iterable[dict[str, Any]],
    force_full_triggers: frozenset[str],
) -> MemoryRebuildPlan:
    states = list(slot_states)
    markers = memory_slot_markers(states)
    normalized_trigger = _normalized_trigger(trigger)
    all_slots = tuple(all_slot_keys)

    if int(memory_version or 0) <= 0:
        return MemoryRebuildPlan(
            scope=scope,
            mode="full",
            slot_keys=all_slots,
            reason="memory_missing",
            expected_memory_version=max(0, int(memory_version or 0)),
            slot_markers=markers,
        )
    if normalized_trigger in force_full_triggers:
        return MemoryRebuildPlan(
            scope=scope,
            mode="full",
            slot_keys=all_slots,
            reason="explicit_full_rebuild",
            expected_memory_version=max(0, int(memory_version or 0)),
            slot_markers=markers,
        )
    if set(markers) != set(all_slots):
        return MemoryRebuildPlan(
            scope=scope,
            mode="full",
            slot_keys=all_slots,
            reason="slot_ledger_incomplete",
            expected_memory_version=max(0, int(memory_version or 0)),
            slot_markers=markers,
        )

    state_by_slot = {
        str(state.get("slot_key") or ""): state
        for state in states
        if str(state.get("slot_key") or "")
    }
    stale_slots = tuple(
        slot_key
        for slot_key in all_slots
        if str((state_by_slot.get(slot_key) or {}).get("status") or "missing")
        in {"stale", "corrupt", "missing"}
    )
    if not stale_slots:
        return MemoryRebuildPlan(
            scope=scope,
            mode="full",
            slot_keys=all_slots,
            reason="parent_stale_without_slot_delta" if parent_stale else "no_slot_delta",
            expected_memory_version=max(0, int(memory_version or 0)),
            slot_markers=markers,
        )
    if len(stale_slots) == len(all_slots):
        return MemoryRebuildPlan(
            scope=scope,
            mode="full",
            slot_keys=all_slots,
            reason="all_slots_stale",
            expected_memory_version=max(0, int(memory_version or 0)),
            slot_markers=markers,
        )
    return MemoryRebuildPlan(
        scope=scope,
        mode="partial",
        slot_keys=stale_slots,
        reason="stale_slot_subset",
        expected_memory_version=max(0, int(memory_version or 0)),
        slot_markers=markers,
    )


def plan_project_memory_rebuild(
    *,
    memory_version: int,
    parent_stale: bool,
    trigger: str,
    slot_states: Iterable[dict[str, Any]],
) -> MemoryRebuildPlan:
    return _plan_memory_rebuild(
        scope="project",
        all_slot_keys=PROJECT_MEMORY_SLOT_KEYS,
        memory_version=memory_version,
        parent_stale=parent_stale,
        trigger=trigger,
        slot_states=slot_states,
        force_full_triggers=_PROJECT_FORCE_FULL_TRIGGERS,
    )


def plan_client_memory_rebuild(
    *,
    memory_version: int,
    parent_stale: bool,
    trigger: str,
    slot_states: Iterable[dict[str, Any]],
) -> MemoryRebuildPlan:
    return _plan_memory_rebuild(
        scope="client",
        all_slot_keys=CLIENT_MEMORY_SLOT_KEYS,
        memory_version=memory_version,
        parent_stale=parent_stale,
        trigger=trigger,
        slot_states=slot_states,
        force_full_triggers=_CLIENT_FORCE_FULL_TRIGGERS,
    )


def assert_memory_rebuild_baseline(
    plan: MemoryRebuildPlan,
    *,
    current_memory_version: int,
    current_slot_states: Iterable[dict[str, Any]],
    rebuilt_slots: Iterable[str] | None = None,
) -> None:
    if max(0, int(current_memory_version or 0)) != plan.expected_memory_version:
        raise MemoryRebuildConflict(
            "memory rebuild conflict: aggregate memory version changed during generation"
        )
    current_markers = memory_slot_markers(current_slot_states)
    slots = tuple(rebuilt_slots or plan.slot_keys)
    for slot_key in slots:
        if current_markers.get(slot_key) != plan.slot_markers.get(slot_key):
            raise MemoryRebuildConflict(
                f"memory rebuild conflict: slot {slot_key} changed during generation"
            )


def latest_memory_rebuild_metadata(memory: dict[str, Any]) -> dict[str, Any]:
    """Expose the latest rebuild scope without making the JSON log a UI contract."""

    rebuild_log = memory.get("rebuild_log")
    latest = rebuild_log[-1] if isinstance(rebuild_log, list) and rebuild_log else {}
    if not isinstance(latest, dict):
        latest = {}
    rebuilt_slots = latest.get("rebuilt_slots")
    return {
        "last_rebuild_mode": str(latest.get("mode") or "") or None,
        "last_rebuilt_slots": (
            [str(item) for item in rebuilt_slots]
            if isinstance(rebuilt_slots, list)
            else []
        ),
        "last_rebuild_fallback_reason": (
            str(latest.get("fallback_reason") or "") or None
        ),
    }
