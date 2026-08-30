"""Server-authoritative recovery contracts for interrupted Aria chat turns."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any

from sqlmodel import Session, select

from app.config import CHAT_RECOVERY_RESERVATION_TTL_SECONDS
from app.models.db import ChatRun, ChatRunInput, Message, TaskEvent, TaskRun
from app.services.agent_harness.run_effect_record import (
    build_rollout_effect_ledger,
    normalize_run_effect_ledger,
)
from app.services.agent_harness.durable_run_inputs import (
    INPUT_STATUS_ACCEPTED,
    INPUT_STATUS_RETRACTED,
    INPUT_STATUS_UNAPPLIED,
    recovery_input_message_identities,
    recovery_run_identity_from_runtime,
)
from app.services.agent_harness.project_world_state import (
    build_project_world_state_manifest,
    compare_project_world_states,
    normalize_project_world_state_manifest,
)
from app.tools.capabilities import ToolEffect, resolve_tool_capability
from app.services.time_utils import utc_now_naive


TURN_RECOVERY_SCHEMA_VERSION = 2
_HEX_64 = re.compile(r"^[a-f0-9]{64}$")
_V1_STRATEGIES = {"resume_from_checkpoint", "retry_failed_step", "continue_as_new_turn"}
_V2_STRATEGIES = {"replan_from_checkpoint", "retry_read_step", "manual_review"}


class TurnRecoveryError(ValueError):
    """Invalid or unauthorized recovery source."""


class TurnRecoveryConflict(TurnRecoveryError):
    """Recovery preview is stale or has already been consumed."""


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _sha256(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def _world_state_ref(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not value:
        return {}
    fingerprint = str(value.get("fingerprint") or "").lower()
    version = str(value.get("version") or "").lower()
    project_id = value.get("project_id")
    if (
        not isinstance(project_id, int)
        or isinstance(project_id, bool)
        or project_id <= 0
        or not _HEX_64.fullmatch(fingerprint)
        or version != fingerprint[:12]
    ):
        return {}
    return {"schema_version": 1, "project_id": project_id, "version": version, "fingerprint": fingerprint}


def _safe_world_state_change(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not value:
        return {}
    changed_categories = [
        str(item)[:40]
        for item in list(value.get("changed_categories") or [])[:8]
        if isinstance(item, str)
    ]
    raw_categories = value.get("categories") if isinstance(value.get("categories"), dict) else {}
    categories: dict[str, Any] = {}
    for name in changed_categories:
        raw = raw_categories.get(name) if isinstance(raw_categories.get(name), dict) else {}
        categories[name] = {
            "added": max(0, _safe_int(raw.get("added"))),
            "removed": max(0, _safe_int(raw.get("removed"))),
            "updated": max(0, _safe_int(raw.get("updated"))),
            "current_count": max(0, _safe_int(raw.get("current_count"))),
            "truncated": bool(raw.get("truncated", False)),
        }
    previous_version = value.get("previous_version")
    current_version = value.get("current_version")
    return {
        "schema_version": 1,
        "baseline": bool(value.get("baseline", False)),
        "changed": bool(value.get("changed", False)),
        "previous_version": str(previous_version)[:12] if previous_version else None,
        "current_version": str(current_version)[:12] if current_version else None,
        "changed_categories": changed_categories,
        "categories": categories,
    }


def _contract_sha256(contract: dict[str, Any]) -> str:
    return _sha256(
        {
            "domain": "aria.turn-recovery.v2",
            "source_run_id": contract.get("source_run_id"),
            "source_message_id": contract.get("source_message_id"),
            "source_snapshot_sha256": contract.get("source_snapshot_sha256"),
            "source_status": contract.get("source_status"),
            "strategy": contract.get("strategy"),
            "completed_steps": contract.get("completed_steps"),
            "effect_ledger": contract.get("effect_ledger"),
            "project_world_state": contract.get("project_world_state"),
            "project_world_state_change": contract.get("project_world_state_change"),
            "world_state_change": contract.get("world_state_change"),
            "completed_effect_count": contract.get("completed_effect_count"),
            "pending_effect_count": contract.get("pending_effect_count"),
            "duplicate_policy": contract.get("duplicate_policy"),
            "unapplied_input_message_ids": contract.get("unapplied_input_message_ids"),
            "applied_input_message_ids": contract.get("applied_input_message_ids"),
        }
    )


def _source_snapshot_sha256(rollout: dict[str, Any], effect_ledger: dict[str, Any]) -> str:
    declared = str(rollout.get("snapshot_sha256") or "").lower()
    if _HEX_64.fullmatch(declared):
        return declared
    steps = [
        {
            "step_index": item.get("step_index"),
            "status": item.get("status"),
            "retryable": bool(item.get("retryable", False)),
        }
        for item in list(rollout.get("steps") or [])
        if isinstance(item, dict)
    ]
    return _sha256(
        {
            "domain": "aria.rollout-recovery-source.v1",
            "run_id": str(rollout.get("run_id") or ""),
            "status": str(rollout.get("status") or ""),
            "terminal_event": rollout.get("terminal_event"),
            "steps": steps,
            "effect_ledger": effect_ledger,
        }
    )


def _failed_step_is_read_only(steps: list[dict[str, Any]]) -> bool:
    if not steps:
        return False
    calls = [item for item in list(steps[-1].get("tool_calls") or []) if isinstance(item, dict)]
    return bool(calls) and all(
        resolve_tool_capability(str(item.get("tool_name") or "")).effect is ToolEffect.READ
        for item in calls
    )


def resolve_recovery_world_state(
    session: Session,
    *,
    conversation_id: int,
    source_run_id: str,
    requested_project_id: int | None,
) -> dict[str, Any]:
    """Resolve the source-turn baseline and current project state for CAS.

    The baseline is the exact user message that started ``source_run_id``;
    looking up the conversation's latest state would silently use a later turn.
    """

    chat_run = session.exec(select(ChatRun).where(ChatRun.run_id == source_run_id)).first()
    if chat_run is None or chat_run.conversation_id != conversation_id:
        raise TurnRecoveryError("Turn recovery ChatRun does not belong to this conversation")
    if chat_run.project_id != requested_project_id:
        raise TurnRecoveryError("Turn recovery ChatRun does not belong to this project")
    if chat_run.source_message_id is None:
        raise TurnRecoveryError("Turn recovery source user message is unavailable")
    source_user_message = session.get(Message, int(chat_run.source_message_id))
    if (
        source_user_message is None
        or source_user_message.role != "user"
        or source_user_message.conversation_id != conversation_id
    ):
        raise TurnRecoveryError("Turn recovery source user message is invalid")
    if requested_project_id is None:
        unapplied_ids, applied_ids = recovery_input_message_identities(
            session,
            parent_run_id=source_run_id,
            conversation_id=conversation_id,
        )
        return {
            "chat_run": chat_run,
            "current_world_state": {},
            "world_state_change": {},
            "source_world_state_available": True,
            "unapplied_input_message_ids": list(unapplied_ids),
            "applied_input_message_ids": list(applied_ids),
        }
    source_world_state = normalize_project_world_state_manifest(
        source_user_message.get_metadata().get("project_world_state"),
        project_id=requested_project_id,
    )
    current_world_state = build_project_world_state_manifest(session, requested_project_id)
    unapplied_ids, applied_ids = recovery_input_message_identities(
        session,
        parent_run_id=source_run_id,
        conversation_id=conversation_id,
    )
    return {
        "chat_run": chat_run,
        "current_world_state": current_world_state,
        "world_state_change": compare_project_world_states(source_world_state, current_world_state),
        "source_world_state_available": bool(source_world_state),
        "unapplied_input_message_ids": list(unapplied_ids),
        "applied_input_message_ids": list(applied_ids),
    }


def find_existing_recovery_child(
    session: Session,
    *,
    conversation_id: int,
    contract: dict[str, Any],
    reconcile_stale_reservation: bool = False,
    now: datetime | None = None,
) -> ChatRun | None:
    """Resolve an already-consumed recovery contract with the canonical CAS.

    A recovery user message and child run are committed before the SSE
    generator starts. If the process dies in that narrow gap, an exact
    ``reserved`` child may be reconciled after the configured TTL. Activated
    runs are never reclaimed here.
    """

    identity = recovery_run_identity_from_runtime(
        SimpleNamespace(conv_id=conversation_id, prepare_metrics={"turn_recovery": contract}),
        session=session,
        conversation_id=conversation_id,
    )
    if not identity.parent_run_id or not identity.recovery_snapshot_sha256:
        return None

    # Lock source before child so concurrent preview/send requests use one
    # deterministic lock order. The unique identity remains the final CAS.
    parent = session.exec(
        select(ChatRun)
        .where(ChatRun.run_id == identity.parent_run_id)
        .with_for_update()
    ).first()
    if parent is None or parent.conversation_id != conversation_id:
        return None
    child = session.exec(
        select(ChatRun)
        .where(
            ChatRun.parent_run_id == identity.parent_run_id,
            ChatRun.recovery_snapshot_sha256 == identity.recovery_snapshot_sha256,
        )
        .with_for_update()
    ).first()
    if child is None or not reconcile_stale_reservation:
        return child
    if (
        child.phase != "reserved"
        or child.status != "running"
        or child.assistant_message_id is not None
        or child.conversation_id != conversation_id
    ):
        return child
    task = session.exec(
        select(TaskRun)
        .where(TaskRun.id == int(child.task_run_id))
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if task is None or task.status != "pending" or task.current_step_key != "reserved":
        return child
    reconciled_at = now or utc_now_naive()
    try:
        reservation_age = reconciled_at - child.created_at
    except (TypeError, ValueError):
        return child
    if reservation_age <= timedelta(seconds=CHAT_RECOVERY_RESERVATION_TTL_SECONDS):
        return child

    original_parent = str(child.parent_run_id or "")
    original_snapshot = str(child.recovery_snapshot_sha256 or "")
    expired_at = reconciled_at.isoformat()
    reason = "reserved_stream_not_started_before_ttl"
    existing_event_count = len(
        session.exec(
            select(TaskEvent.id).where(TaskEvent.task_run_id == int(task.id or 0))
        ).all()
    )
    audit_payload = {
        "schema_version": 1,
        "ordinal": existing_event_count + 1,
        "run_id": child.run_id,
        "original_parent_run_id": original_parent,
        "original_recovery_snapshot_sha256": original_snapshot,
        "reason": reason,
        "expired_at": expired_at,
    }
    task.status = "failed"
    task.current_step_key = "reservation_expired"
    task.error_code = "RECOVERY_RESERVATION_EXPIRED"
    task.error_message = "Recovery reservation expired before stream activation"
    task.updated_at = reconciled_at
    task.completed_at = reconciled_at
    # A remote cancel can be durably accepted during the narrow interval
    # between reservation commit and SSE activation. If the stream never
    # starts, no worker remains to finalize that mailbox row. Close every
    # accepted input in this same terminal transaction so recovery never sees
    # a failed Run with an indefinitely "accepted" intent.
    finalized_inputs: list[dict[str, Any]] = []
    for item in session.exec(
        select(ChatRunInput)
        .where(
            ChatRunInput.chat_run_id == int(child.id or 0),
            ChatRunInput.status == INPUT_STATUS_ACCEPTED,
        )
        .order_by(ChatRunInput.sequence, ChatRunInput.id)
        .with_for_update()
    ).all():
        if (
            item.run_id != child.run_id
            or int(item.conversation_id) != int(child.conversation_id)
        ):
            item.status = INPUT_STATUS_RETRACTED
        else:
            item.status = INPUT_STATUS_UNAPPLIED
        item.applied_at = None
        session.add(item)
        if item.id is not None:
            finalized_inputs.append(
                {"input_id": int(item.id), "status": item.status}
            )
    audit_payload["finalized_inputs"] = finalized_inputs
    task.output_json = _stable_json(audit_payload)
    session.add(
        TaskEvent(
            task_run_id=int(task.id or 0),
            event_type="recovery_reservation_expired",
            message="recovery reservation expired",
            payload_json=_stable_json(audit_payload),
            created_at=reconciled_at,
        )
    )
    child.status = "failed"
    child.phase = "reservation_expired"
    child.error_code = "RECOVERY_RESERVATION_EXPIRED"
    child.retryable = True
    child.updated_at = reconciled_at
    child.completed_at = reconciled_at
    child.recovery_snapshot_sha256 = _sha256(
        {"domain": "aria.recovery-reservation-expired.v1", **audit_payload}
    )
    source_message = session.exec(
        select(Message)
        .where(Message.id == int(child.source_message_id or 0))
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if (
        source_message is not None
        and source_message.role == "user"
        and source_message.conversation_id == conversation_id
    ):
        metadata = source_message.get_metadata()
        source_reservation = metadata.get("recovery_reservation")
        if not isinstance(source_reservation, dict):
            source_reservation = {}
        metadata["recovery_reservation"] = {
            **source_reservation,
            "schema_version": 1,
            "run_id": child.run_id,
            "status": "expired",
            "original_parent_run_id": original_parent,
            "original_recovery_snapshot_sha256": original_snapshot,
            "reason": reason,
            "expired_at": expired_at,
        }
        source_message.set_metadata(metadata)
        session.add(source_message)
    session.add(task)
    session.add(child)
    session.flush()
    return None


def build_turn_recovery_preview(
    rollout: dict[str, Any],
    *,
    source_message_id: int,
    current_project_world_state: Any = None,
    project_world_state_change: Any = None,
    force_manual_review: bool = False,
    unapplied_input_message_ids: Any = None,
    applied_input_message_ids: Any = None,
) -> dict[str, Any]:
    """Build Recovery v2 exclusively from the durable server rollout."""

    status = str(rollout.get("status") or "")
    recovery = rollout.get("recovery") if isinstance(rollout.get("recovery"), dict) else {}
    steps = [item for item in list(rollout.get("steps") or []) if isinstance(item, dict)]
    completed_steps = [
        int(item.get("step_index"))
        for item in steps
        if item.get("status") == "completed" and isinstance(item.get("step_index"), int)
    ][:32]
    completed_tool_calls = sum(len(item.get("tool_calls") or []) for item in steps if item.get("status") == "completed")
    effect_ledger = normalize_run_effect_ledger(rollout.get("effect_ledger"))
    if not effect_ledger:
        effect_ledger = build_rollout_effect_ledger(steps, rollout.get("run_outputs") or [])
    integrity = effect_ledger.get("integrity") if isinstance(effect_ledger.get("integrity"), dict) else {}
    requires_manual_review = force_manual_review or any(
        _safe_int(integrity.get(key)) > 0
        for key in (
            "unresolved_mutating_count",
            "legacy_or_unknown_mutating_count",
            "orphan_persisted_result_count",
        )
    )
    # A local in-memory registry cannot prove another worker is idle. Only an
    # explicit durable terminal/interrupted state is recoverable; stale
    # ``running`` reconciliation is a separate audited operation.
    can_continue = status in {"cancelled", "failed", "interrupted"}
    strategy = (
        "manual_review"
        if requires_manual_review
        else "retry_read_step"
        if recovery.get("can_retry") and _failed_step_is_read_only(steps)
        else "replan_from_checkpoint"
    )
    warning_codes: list[str] = []
    if completed_steps:
        warning_codes.append("preserve_completed_steps")
    side_effects_possible = bool(
        _safe_int(integrity.get("mutating_effect_count"))
        or _safe_int(integrity.get("legacy_or_unknown_mutating_count"))
        or _safe_int(integrity.get("orphan_persisted_result_count"))
    )
    if side_effects_possible:
        warning_codes.append("verify_effect_ledger_before_write")
    if strategy == "manual_review":
        warning_codes.append("manual_review_required")
    world_ref = _world_state_ref(current_project_world_state)
    world_change = _safe_world_state_change(project_world_state_change)
    if world_change.get("changed"):
        warning_codes.append("project_world_state_changed")
    records = [item for item in list(effect_ledger.get("records") or []) if isinstance(item, dict)]
    mutating_records = [item for item in records if str(item.get("effect") or "") != ToolEffect.READ.value]
    public_world_change = {
        "changed": bool(world_change.get("changed", False)),
        "current_version": world_change.get("current_version"),
        "source_version": world_change.get("previous_version"),
        "changed_categories": list(world_change.get("changed_categories") or [])[:8],
    }
    contract: dict[str, Any] = {
        "schema_version": TURN_RECOVERY_SCHEMA_VERSION,
        "source_run_id": str(rollout.get("run_id") or "")[:80],
        "source_message_id": source_message_id,
        "source_snapshot_sha256": _source_snapshot_sha256(rollout, effect_ledger),
        "source_status": status,
        "can_continue": can_continue,
        "strategy": strategy,
        "completed_steps": completed_steps,
        "completed_tool_call_count": completed_tool_calls,
        "side_effects_possible": side_effects_possible,
        "effect_ledger": effect_ledger,
        "completed_effect_count": sum(str(item.get("outcome") or "") == "persisted" for item in mutating_records),
        "pending_effect_count": sum(
            str(item.get("outcome") or "") not in {"persisted", "not_executed"}
            for item in mutating_records
        ),
        "duplicate_policy": "verified_persisted_artifact_only",
        "unapplied_input_message_ids": [
            int(item)
            for item in list(unapplied_input_message_ids or [])
            if isinstance(item, int) and not isinstance(item, bool) and item > 0
        ],
        "applied_input_message_ids": [
            int(item)
            for item in list(applied_input_message_ids or [])
            if isinstance(item, int) and not isinstance(item, bool) and item > 0
        ],
        "project_world_state": world_ref,
        "project_world_state_change": world_change,
        "world_state_change": public_world_change,
        "warning_codes": warning_codes,
        "suggested_content": (
            "请先人工核对当前项目状态与历史副作用；本轮不要执行或声称完成任何写入。"
            if strategy == "manual_review"
            else "请仅重试失败的只读步骤；不要执行任何写入或重新规划写入。"
            if strategy == "retry_read_step"
            else "请基于当前项目状态保留已核验的持久化结果，并从未完成部分重新规划。"
        ),
    }
    contract["contract_sha256"] = _contract_sha256(contract)
    return contract


def normalize_turn_recovery_contract(value: Any) -> dict[str, Any]:
    """Normalize server v2 metadata while retaining bounded v1 history."""

    if not isinstance(value, dict):
        return {}
    source_run_id = str(value.get("source_run_id") or "").strip()
    source_message_id = value.get("source_message_id")
    strategy = str(value.get("strategy") or "").strip()
    if not re.fullmatch(r"run_[A-Za-z0-9_-]{1,76}", source_run_id):
        return {}
    if not isinstance(source_message_id, int) or isinstance(source_message_id, bool) or source_message_id <= 0:
        return {}
    completed_steps: list[int] = []
    for item in list(value.get("completed_steps") or [])[:32]:
        if isinstance(item, int) and not isinstance(item, bool) and item >= 0 and item not in completed_steps:
            completed_steps.append(item)
    if value.get("schema_version") != TURN_RECOVERY_SCHEMA_VERSION:
        if strategy not in _V1_STRATEGIES:
            return {}
        return {
            "schema_version": 1,
            "source_run_id": source_run_id,
            "source_message_id": source_message_id,
            "strategy": strategy,
            "completed_steps": completed_steps,
            "side_effects_possible": bool(value.get("side_effects_possible", False)),
        }
    if strategy not in _V2_STRATEGIES:
        return {}
    snapshot_sha = str(value.get("source_snapshot_sha256") or "").lower()
    ledger = normalize_run_effect_ledger(value.get("effect_ledger"))
    if not ledger:
        return {}
    public_world = value.get("world_state_change") if isinstance(value.get("world_state_change"), dict) else {}
    contract: dict[str, Any] = {
        "schema_version": TURN_RECOVERY_SCHEMA_VERSION,
        "source_run_id": source_run_id,
        "source_message_id": source_message_id,
        "source_snapshot_sha256": snapshot_sha,
        "source_status": str(value.get("source_status") or "")[:32],
        "can_continue": bool(value.get("can_continue", False)),
        "strategy": strategy,
        "completed_steps": completed_steps,
        "completed_tool_call_count": max(0, _safe_int(value.get("completed_tool_call_count"))),
        "side_effects_possible": bool(value.get("side_effects_possible", False)),
        "effect_ledger": ledger,
        "completed_effect_count": max(0, _safe_int(value.get("completed_effect_count"))),
        "pending_effect_count": max(0, _safe_int(value.get("pending_effect_count"))),
        "duplicate_policy": str(value.get("duplicate_policy") or "")[:64],
        "unapplied_input_message_ids": [
            int(item)
            for item in list(value.get("unapplied_input_message_ids") or [])
            if isinstance(item, int) and not isinstance(item, bool) and item > 0
        ],
        "applied_input_message_ids": [
            int(item)
            for item in list(value.get("applied_input_message_ids") or [])
            if isinstance(item, int) and not isinstance(item, bool) and item > 0
        ],
        "project_world_state": _world_state_ref(value.get("project_world_state")),
        "project_world_state_change": _safe_world_state_change(value.get("project_world_state_change")),
        "world_state_change": {
            "changed": bool(public_world.get("changed", False)),
            "current_version": str(public_world.get("current_version") or "")[:12] or None,
            "source_version": str(public_world.get("source_version") or "")[:12] or None,
            "changed_categories": [
                str(item)[:40]
                for item in list(public_world.get("changed_categories") or [])[:8]
            ],
        },
        "warning_codes": [str(item)[:64] for item in list(value.get("warning_codes") or [])[:12]],
        "suggested_content": str(value.get("suggested_content") or "")[:300],
    }
    declared = str(value.get("contract_sha256") or "").lower()
    if not _HEX_64.fullmatch(snapshot_sha) or declared != _contract_sha256(contract):
        return {}
    contract["contract_sha256"] = declared
    return contract


def format_turn_recovery_for_prompt(value: Any) -> str:
    contract = normalize_turn_recovery_contract(value)
    if not contract:
        return ""
    if contract.get("schema_version") == 1:
        return "\n".join(
            [
                "## Legacy Turn Recovery Guard",
                f"Source run: {contract['source_run_id']}",
                "The old recovery record has no verifiable effect ledger. Treat all writes as manual review.",
            ]
        )
    strategy = contract["strategy"]
    lines = [
        "## Turn Recovery Contract v2",
        f"Source run: {contract['source_run_id']}",
        f"Recovery strategy: {strategy}",
        f"Completed step indexes: {contract['completed_steps']}",
        "This contract was rebuilt from Aria's durable rollout; client recovery fields are navigation hints only.",
        "Never claim a write was completed unless its identical input digest has a verified persisted-artifact reference.",
    ]
    if strategy == "manual_review":
        lines.append("Mutating tools are fail-closed for this recovery turn; explain that manual review is required.")
    elif strategy == "retry_read_step":
        lines.append("Only the failed read step may be retried; current Aria authorization still applies.")
    else:
        lines.append("Replan from current project state and preserve verified persisted results.")
    if contract.get("project_world_state_change", {}).get("changed"):
        lines.append("Project world state changed after the source checkpoint; current state is authoritative.")
    return "\n".join(lines)
