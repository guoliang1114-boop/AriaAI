"""Durable, provider-neutral rollout checkpoints for Aria chat runs.

The append-only record/ordinal model and chronological reconstruction rules are
adapted from OpenAI Codex's ``codex-rs/rollout/src/recorder.rs``,
``codex-rs/rollout/src/ordinal.rs``, and
``codex-rs/core/src/session/rollout_reconstruction.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-22: translated to Python, persisted in Aria's
existing ``TaskRun`` / ``TaskStep`` / ``TaskEvent`` tables, reduced to business
run checkpoints, and extended with fail-closed retry/recovery decisions. No
Codex process, protocol, account, or model API is used.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

from sqlmodel import Session, select

from app.models.db import (
    ChatRun,
    Conversation,
    Message,
    SkillRollout,
    TaskEvent,
    TaskRun,
    TaskStep,
)
from app.services.agent_harness.skill_releases import evaluate_rollout_stop_loss
from app.services.context_builder.assembly import validate_context_assembly_manifest
from app.services.agent_harness.tool_execution_record import (
    tool_event_is_failure,
    tool_event_is_omission_marker,
    tool_event_waits_confirmation,
)
from app.services.agent_harness.run_output_record import normalize_run_output_records
from app.services.agent_harness.run_effect_record import (
    build_rollout_effect_ledger,
    build_step_effect_records,
)
from app.services.time_utils import utc_now_naive
from app.services.agent_harness.run_display import resolve_run_display_mode
from app.services.agent_harness.durable_run_inputs import (
    DurableRunInputBatch,
    DurableRunInputRejected,
    claim_durable_run_cancel_in_session,
    claim_durable_run_inputs_in_session,
    recovery_run_identity_from_runtime,
)
from app.services.agent_harness.active_run_lease import (
    ChatRunLease,
    bind_new_chat_run_lease,
    chat_run_lease_from_state,
    clear_chat_run_lease,
    require_chat_run_lease,
)

ROLLOUT_SCHEMA_VERSION = 1
ROLLOUT_TASK_TYPE = "chat_rollout"

_INPUT_CLOSED_CHAT_RUN_PHASES = frozenset(
    {
        "agent_loop_done",
        "agent_loop_final_step",
        "confirmation_tool",
        "persist",
        "waiting_confirmation",
    }
)

_TERMINAL_EVENT_STATUS = {
    "run_completed": "completed",
    "run_failed": "failed",
    "run_waiting_confirmation": "waiting_confirmation",
    "run_cancelled": "cancelled",
    "run_interrupted": "interrupted",
}


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def _json_loads(value: str | None, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except (json.JSONDecodeError, TypeError):
        return fallback


def _sha256(value: Any) -> str:
    return hashlib.sha256(_json_dumps(value).encode("utf-8")).hexdigest()


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "")


def _safe_context_manifest(value: Any) -> dict[str, Any]:
    valid, _ = validate_context_assembly_manifest(value)
    if not valid:
        return {}
    # JSON round-trip both deep-copies the manifest and enforces the same
    # serializable representation used by TaskRun/TaskEvent persistence.
    return json.loads(_json_dumps(value))


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _sanitize_tool_call(tool_call: dict[str, Any]) -> dict[str, Any]:
    tool_input = tool_call.get("input")
    if not isinstance(tool_input, dict):
        tool_input = {}
    return {
        "tool_use_id": str(tool_call.get("id") or ""),
        "tool_name": str(tool_call.get("name") or ""),
        "input_sha256": _sha256(tool_input),
    }


def _sanitize_tool_event(event: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "tool_use_id": str(event.get("tool_use_id") or ""),
        "tool_name": str(event.get("tool_name") or ""),
        "status": str(event.get("status") or ""),
        "summary": str(event.get("summary") or event.get("message") or "")[:500],
        "attempt_count": max(0, _safe_int(event.get("attempt_count"))),
        "max_attempts": max(0, _safe_int(event.get("max_attempts"))),
        "retryable": bool(event.get("retryable", False)),
    }
    tool_effect = str(event.get("tool_effect") or "")
    if tool_effect:
        payload["tool_effect"] = tool_effect[:24]
    error = str(event.get("error") or "").strip()
    if error:
        payload["error"] = error[:500]
    return payload


def build_step_checkpoint(step: Any, state: Any) -> dict[str, Any]:
    """Build a stable checkpoint without persisting raw tool arguments/results."""

    step_index = int(getattr(step, "index", 0) or 0)
    matching_tool_events = [
        event
        for event in list(getattr(state, "tool_call_events", None) or [])
        if isinstance(event, dict)
        and not tool_event_is_omission_marker(event)
        and _safe_int(event.get("step_index"), -1) == step_index
    ]
    status = str(getattr(step, "status", "") or "")
    if not status:
        if any(tool_event_is_failure(event) for event in matching_tool_events):
            status = "failed"
        elif any(tool_event_waits_confirmation(event) for event in matching_tool_events):
            status = "waiting_confirmation"
        else:
            status = "completed"

    retry_count = max(
        int(getattr(step, "retry_count", 0) or 0),
        sum(max(0, _safe_int(event.get("attempt_count"), 1) - 1) for event in matching_tool_events),
    )
    failed_events = [
        event
        for event in matching_tool_events
        if tool_event_is_failure(event)
    ]
    retryable = bool(failed_events) and all(bool(event.get("retryable", False)) for event in failed_events)
    if getattr(step, "retryable", None) is not None:
        retryable = bool(getattr(step, "retryable"))

    model_text = str(getattr(step, "model_text", "") or "")
    raw_tool_calls = [
        tool_call
        for tool_call in list(getattr(step, "tool_calls", None) or [])
        if isinstance(tool_call, dict)
    ]
    return {
        "step_index": step_index,
        "status": status,
        "duration_ms": max(0, int(getattr(step, "duration_ms", 0) or 0)),
        "truncated": bool(getattr(step, "truncated", False)),
        "retryable": retryable,
        "retry_count": retry_count,
        "error": str(getattr(step, "error", "") or "")[:500],
        "model_text_chars": len(model_text),
        "model_text_sha256": _sha256(model_text),
        "tool_calls": [_sanitize_tool_call(tool_call) for tool_call in raw_tool_calls],
        "tool_events": [_sanitize_tool_event(event) for event in matching_tool_events],
        "effect_records": build_step_effect_records(
            step_index,
            raw_tool_calls,
            matching_tool_events,
            recovered_effects=list(getattr(state, "recovery_effect_records", None) or []),
        ),
    }


def _normalize_records(records: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate ordinals and keep the newest record for a duplicate ordinal."""

    by_ordinal: dict[int, tuple[int, dict[str, Any]]] = {}
    warnings: list[str] = []
    for source_index, raw_record in enumerate(records):
        if not isinstance(raw_record, dict):
            warnings.append(f"ignored non-object record at source index {source_index}")
            continue
        payload = raw_record.get("payload")
        if not isinstance(payload, dict):
            warnings.append(f"ignored record without payload at source index {source_index}")
            continue
        try:
            ordinal = int(payload.get("ordinal"))
        except (TypeError, ValueError):
            warnings.append(f"ignored record without valid ordinal at source index {source_index}")
            continue
        if ordinal < 1:
            warnings.append(f"ignored non-positive ordinal {ordinal}")
            continue
        if ordinal in by_ordinal:
            warnings.append(f"duplicate ordinal {ordinal}; newest record kept")
        by_ordinal[ordinal] = (source_index, {**raw_record, "payload": dict(payload)})

    ordered = [item[1] for _, item in sorted(by_ordinal.items())]
    if ordered:
        ordinals = [int(record["payload"]["ordinal"]) for record in ordered]
        expected = set(range(ordinals[0], ordinals[-1] + 1))
        missing = sorted(expected.difference(ordinals))
        if missing:
            warnings.append(f"missing ordinals: {','.join(str(value) for value in missing)}")
    return ordered, warnings


def _recovery_plan(status: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    completed = [int(step["step_index"]) for step in steps if step.get("status") == "completed"]
    latest = steps[-1] if steps else None
    base = {
        "action": "none",
        "can_resume": False,
        "can_retry": False,
        "resume_from_step": None,
        "retry_step": None,
        "completed_steps": completed,
        "reason": "run_is_terminal",
    }
    if status == "completed":
        return base
    if status == "waiting_confirmation":
        return {
            **base,
            "action": "wait_for_confirmation",
            "reason": "hitas_confirmation_required",
        }
    if latest and latest.get("status") == "failed" and latest.get("retryable"):
        step_index = int(latest["step_index"])
        return {
            **base,
            "action": "retry_step",
            "can_retry": True,
            "retry_step": step_index,
            "reason": "latest_failed_step_is_retryable",
        }
    if status in {"running", "interrupted"} and latest and latest.get("status") == "completed":
        next_step = int(latest["step_index"]) + 1
        return {
            **base,
            "action": "resume_from_checkpoint",
            "can_resume": True,
            "resume_from_step": next_step,
            "reason": "durable_checkpoint_available",
        }
    if status in {"failed", "interrupted", "running"}:
        return {
            **base,
            "action": "restart_turn",
            "reason": "no_safe_step_level_replay",
        }
    return base


def reconstruct_rollout(
    records: Iterable[dict[str, Any]],
    *,
    task_status: str = "running",
) -> dict[str, Any]:
    """Replay append-only records chronologically into one deterministic state."""

    ordered, warnings = _normalize_records(records)
    run_id = ""
    steps: dict[int, dict[str, Any]] = {}
    terminal_event = ""
    context_manifest: dict[str, Any] = {}
    status = "running" if task_status in {"pending", "running"} else task_status
    message_id: int | str | None = None
    run_outputs: list[dict[str, Any]] = []
    valid_records = 0

    for record in ordered:
        payload = record["payload"]
        record_run_id = str(payload.get("run_id") or "")
        if not run_id and record_run_id:
            run_id = record_run_id
        if run_id and record_run_id and record_run_id != run_id:
            warnings.append(f"ignored record for mismatched run_id {record_run_id}")
            continue
        event_type = str(record.get("event_type") or "")
        valid_records += 1
        if event_type == "run_started":
            context_manifest = _safe_context_manifest(payload.get("context_manifest"))
        elif event_type == "step_checkpoint":
            checkpoint = payload.get("checkpoint")
            if isinstance(checkpoint, dict):
                try:
                    step_index = int(checkpoint.get("step_index"))
                except (TypeError, ValueError):
                    warnings.append("ignored step checkpoint without valid step_index")
                else:
                    steps[step_index] = dict(checkpoint)
        elif event_type == "message_persisted":
            message_id = payload.get("message_id")
        elif event_type in _TERMINAL_EVENT_STATUS:
            terminal_event = event_type
            status = _TERMINAL_EVENT_STATUS[event_type]
            run_outputs = normalize_run_output_records(payload.get("run_outputs") or [])

    if not terminal_event and status in {"pending", "running"}:
        status = "interrupted"
    ordered_steps = [steps[index] for index in sorted(steps)]
    if (
        not terminal_event
        and status == "paused"
        and ordered_steps
        and ordered_steps[-1].get("status") == "waiting_confirmation"
    ):
        status = "waiting_confirmation"
    effect_ledger = build_rollout_effect_ledger(ordered_steps, run_outputs)
    snapshot_core = {
        "schema_version": ROLLOUT_SCHEMA_VERSION,
        "run_id": run_id,
        "status": status,
        "terminal_event": terminal_event or None,
        "message_id": message_id,
        "context_manifest": context_manifest,
        "run_outputs": run_outputs,
        "last_ordinal": int(ordered[-1]["payload"]["ordinal"]) if ordered else 0,
        "steps": ordered_steps,
        "effect_ledger": effect_ledger,
        "recovery": _recovery_plan(status, ordered_steps),
        "integrity": {
            "valid_records": valid_records,
            "ignored_or_warning_count": len(warnings),
            "warnings": warnings,
        },
    }
    return {**snapshot_core, "snapshot_sha256": _sha256(snapshot_core)}


def _task_run_id(task: TaskRun) -> int:
    if task.id is None:
        raise ValueError("rollout task must be persisted before events are appended")
    return int(task.id)


def _run_id_from_task(task: TaskRun) -> str:
    input_data = _json_loads(task.input_json, {})
    return str(input_data.get("run_id") or "") if isinstance(input_data, dict) else ""


def _append_event(
    session: Session,
    task: TaskRun,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> TaskEvent:
    existing_count = len(
        session.exec(select(TaskEvent.id).where(TaskEvent.task_run_id == _task_run_id(task))).all()
    )
    event_payload = {
        "schema_version": ROLLOUT_SCHEMA_VERSION,
        "ordinal": existing_count + 1,
        "run_id": _run_id_from_task(task),
        **(payload or {}),
    }
    event = TaskEvent(
        task_run_id=_task_run_id(task),
        event_type=event_type,
        message=event_type.replace("_", " "),
        payload_json=_json_dumps(event_payload),
    )
    session.add(event)
    session.flush()
    return event


def _begin_chat_rollout_in_session(
    session: Session,
    runtime: Any,
    request_content: str,
    run_id: str,
    *,
    commit: bool,
    require_exact_source: bool,
    lease: ChatRunLease | None = None,
) -> int:
    now = utc_now_naive()
    prepare_metrics = getattr(runtime, "prepare_metrics", None)
    exact_source_message_id = (
        prepare_metrics.get("source_user_message_id")
        if isinstance(prepare_metrics, dict)
        else None
    )
    exact_source_provided = isinstance(exact_source_message_id, int) and exact_source_message_id > 0
    if require_exact_source and not exact_source_provided:
        raise ValueError("prepared rollout requires an exact source user message")
    source_message = session.get(Message, int(exact_source_message_id)) if exact_source_provided else None
    if exact_source_provided and source_message is None:
        raise ValueError("rollout source user message is unavailable")
    if exact_source_provided and (
        source_message.role != "user"
        or source_message.conversation_id != int(runtime.conv_id)
    ):
        raise ValueError("rollout source user message does not belong to this conversation")
    if not exact_source_provided:
        # Compatibility for direct harness constructors that predate the exact
        # source-message contract. Production and recovery reservation set it.
        source_message = session.exec(
            select(Message)
            .where(Message.conversation_id == int(runtime.conv_id), Message.role == "user")
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        ).first()
    context_manifest = _safe_context_manifest(getattr(runtime, "context_manifest", None))
    recovery_identity = recovery_run_identity_from_runtime(
        runtime,
        session=session,
        conversation_id=int(runtime.conv_id),
    )
    is_recovery_reservation = not commit
    if is_recovery_reservation and (
        not recovery_identity.parent_run_id
        or not recovery_identity.recovery_snapshot_sha256
    ):
        raise ValueError("prepared rollout reservation requires a recovery identity")
    task = TaskRun(
            project_id=None,  # hidden from project task lists; project id stays in the event payload
            conversation_id=int(runtime.conv_id),
            task_type=ROLLOUT_TASK_TYPE,
            goal=f"Aria chat rollout {run_id}",
            status="pending" if is_recovery_reservation else "running",
            current_step_key="reserved" if is_recovery_reservation else "agent_loop",
            input_json=_json_dumps(
                {
                    "schema_version": ROLLOUT_SCHEMA_VERSION,
                    "run_id": run_id,
                    "project_id": getattr(runtime, "project_id", None),
                    "source_message_id": getattr(source_message, "id", None),
                    "request_sha256": _sha256(request_content or ""),
                    "model": str(getattr(runtime, "selected_model", "") or ""),
                    "chat_mode": _enum_value(getattr(runtime, "chat_mode", "")),
                    "action_policy": _enum_value(getattr(runtime, "action_policy", "")),
                    "context_manifest": context_manifest,
                }
            ),
            created_at=now,
            updated_at=now,
            started_at=None if is_recovery_reservation else now,
    )
    session.add(task)
    session.flush()
    conversation = session.get(Conversation, int(runtime.conv_id))
    chat_run = ChatRun(
            run_id=run_id,
            task_run_id=_task_run_id(task),
            parent_run_id=recovery_identity.parent_run_id,
            recovery_snapshot_sha256=recovery_identity.recovery_snapshot_sha256,
            conversation_id=int(runtime.conv_id),
            project_id=getattr(runtime, "project_id", None),
            owner_user_id=getattr(conversation, "owner_user_id", None),
            source_message_id=getattr(source_message, "id", None),
            skill_id=getattr(runtime, "skill_id", None),
            skill_name=str(getattr(runtime, "skill_name", "") or ""),
            skill_version=str(getattr(runtime, "skill_version", "") or ""),
            skill_release_status=str(getattr(runtime, "skill_release_status", "") or ""),
            skill_release_sha256=str(getattr(runtime, "skill_release_sha256", "") or ""),
            skill_release_id=getattr(runtime, "skill_release_id", None),
            skill_rollout_id=getattr(runtime, "skill_rollout_id", None),
            skill_rollout_variant=str(getattr(runtime, "skill_rollout_variant", "") or ""),
            skill_rollout_bucket=getattr(runtime, "skill_rollout_bucket", None),
            skill_activation_source=str(getattr(runtime, "skill_activation_source", "") or ""),
            model=str(getattr(runtime, "selected_model", "") or ""),
            chat_mode=_enum_value(getattr(runtime, "chat_mode", "")),
            action_policy=_enum_value(getattr(runtime, "action_policy", "")),
            display_mode=resolve_run_display_mode(
                getattr(runtime, "action_policy", ""),
                has_skill=bool(
                    getattr(runtime, "skill_id", None)
                    or getattr(runtime, "skill_name", "")
                ),
            ),
            request_sha256=_sha256(request_content or ""),
            context_manifest_sha256=_sha256(context_manifest),
            phase="reserved" if is_recovery_reservation else "run_start",
            started_at=now,
            created_at=now,
            updated_at=now,
    )
    session.add(chat_run)
    if lease is not None and not is_recovery_reservation:
        bind_new_chat_run_lease(chat_run, lease, now=now)
    if is_recovery_reservation and source_message is not None:
        source_metadata = source_message.get_metadata()
        source_metadata["recovery_reservation"] = {
            "schema_version": 1,
            "run_id": run_id,
            "status": "reserved",
            "reserved_at": now.isoformat(),
        }
        source_message.set_metadata(source_metadata)
        session.add(source_message)
    _append_event(
        session,
        task,
        "run_reserved" if is_recovery_reservation else "run_started",
        {
            "conversation_id": int(runtime.conv_id),
            "project_id": getattr(runtime, "project_id", None),
            "source_message_id": getattr(source_message, "id", None),
            "model": str(getattr(runtime, "selected_model", "") or ""),
            "chat_mode": _enum_value(getattr(runtime, "chat_mode", "")),
            "action_policy": _enum_value(getattr(runtime, "action_policy", "")),
            "context_manifest": context_manifest,
            **(
                {
                    "parent_run_id": recovery_identity.parent_run_id,
                    "recovery_snapshot_sha256": recovery_identity.recovery_snapshot_sha256,
                }
                if is_recovery_reservation
                else {}
            ),
        },
    )
    if commit:
        session.commit()
    else:
        session.flush()
    return _task_run_id(task)


def begin_chat_rollout(
    bind: Any,
    runtime: Any,
    request_content: str,
    run_id: str,
    lease: ChatRunLease | None = None,
) -> int:
    """Create and commit a durable Aria rollout before model/tool execution."""

    with Session(bind) as session:
        return _begin_chat_rollout_in_session(
            session,
            runtime,
            request_content,
            run_id,
            commit=True,
            require_exact_source=False,
            lease=lease,
        )


def reserve_prepared_chat_rollout(
    session: Session,
    runtime: Any,
    request_content: str,
    run_id: str,
) -> int:
    """Flush a rollout claim in the caller's uncommitted user-message transaction."""

    return _begin_chat_rollout_in_session(
        session,
        runtime,
        request_content,
        run_id,
        commit=False,
        require_exact_source=True,
        lease=None,
    )


def activate_prepared_chat_rollout(
    bind: Any,
    task_id: int,
    run_id: str,
    lease: ChatRunLease | None = None,
) -> None:
    """Atomically activate one exact recovery reservation at stream entry."""

    now = utc_now_naive()
    with Session(bind) as session:
        chat_run = session.exec(
            select(ChatRun)
            .where(ChatRun.run_id == run_id, ChatRun.task_run_id == task_id)
            .with_for_update()
        ).first()
        task = session.exec(
            select(TaskRun)
            .where(TaskRun.id == task_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        source_message = (
            session.exec(
                select(Message)
                .where(Message.id == int(chat_run.source_message_id))
                .execution_options(populate_existing=True)
                .with_for_update()
            ).first()
            if chat_run is not None and chat_run.source_message_id is not None
            else None
        )
        source_reservation = (
            source_message.get_metadata().get("recovery_reservation")
            if source_message is not None
            else None
        )
        if (
            chat_run is None
            or task is None
            or chat_run.parent_run_id is None
            or chat_run.phase != "reserved"
            or chat_run.status != "running"
            or chat_run.assistant_message_id is not None
            or task.status != "pending"
            or task.current_step_key != "reserved"
            or not isinstance(source_reservation, dict)
            or source_reservation.get("status") != "reserved"
            or source_reservation.get("run_id") != run_id
        ):
            raise ValueError("prepared recovery rollout is not an activatable reservation")
        task.status = "running"
        task.current_step_key = "agent_loop"
        task.started_at = now
        task.updated_at = now
        chat_run.phase = "run_start"
        chat_run.started_at = now
        chat_run.updated_at = now
        if lease is not None:
            bind_new_chat_run_lease(chat_run, lease, now=now)
        source_metadata = source_message.get_metadata()
        source_metadata["recovery_reservation"] = {
            **source_reservation,
            "status": "activated",
            "activated_at": now.isoformat(),
        }
        source_message.set_metadata(source_metadata)
        _append_event(
            session,
            task,
            "run_started",
            {
                "conversation_id": chat_run.conversation_id,
                "project_id": chat_run.project_id,
                "source_message_id": chat_run.source_message_id,
                "activated_from": "reserved",
            },
        )
        session.add(task)
        session.add(chat_run)
        session.add(source_message)
        session.commit()


def close_chat_run_input_boundary(
    bind: Any,
    *,
    run_id: str,
    conversation_id: int,
    phase: str,
    force_close: bool = False,
    claim_steering: bool = True,
    lease: ChatRunLease | None = None,
) -> DurableRunInputBatch:
    """Claim committed inputs and close one Run phase in a single transaction.

    ``accept_steering_run_input`` locks the same ``ChatRun`` row. Therefore an
    input that commits before this boundary is returned to the serving loop,
    while an input racing after a closed boundary reloads the new phase and is
    rejected before its Message transaction commits.

    At a re-plannable boundary, valid steering keeps the Run open so the caller
    can incorporate it in the next model step. ``force_close`` is reserved for
    a final model boundary where the returned steering is incorporated before
    the already-closed execution continues. A persist boundary must set
    ``claim_steering=False`` because no later model request can truthfully apply
    newly accepted text; those rows stay accepted for terminal finalization.
    """

    normalized_phase = str(phase or "").strip().lower()
    if normalized_phase not in _INPUT_CLOSED_CHAT_RUN_PHASES:
        raise ValueError("unsupported closed chat run input phase")
    if not claim_steering and normalized_phase != "persist":
        raise ValueError("cancel-only input close is reserved for persist")

    with Session(bind) as session:
        if claim_steering:
            batch = claim_durable_run_inputs_in_session(
                session,
                run_id=run_id,
                conversation_id=conversation_id,
                lease=lease,
            )
        else:
            batch = claim_durable_run_cancel_in_session(
                session,
                run_id=run_id,
                conversation_id=conversation_id,
                defer_terminal_ack=True,
                lease=lease,
            )
        run = session.exec(
            select(ChatRun)
            .where(ChatRun.run_id == str(run_id or "").strip())
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if run is None or run.id is None:
            raise DurableRunInputRejected(
                "run_not_found",
                "Authoritative durable chat run identity is unavailable",
            )
        if int(run.conversation_id) != int(conversation_id):
            raise DurableRunInputRejected(
                "conversation_mismatch",
                "Authoritative durable chat run conversation mismatch",
            )
        if run.status != "running" or run.completed_at is not None:
            raise DurableRunInputRejected(
                "run_not_active",
                "Durable chat run is no longer active",
            )
        require_chat_run_lease(run, lease)

        should_close = (
            not claim_steering
            or force_close
            or batch.cancel_requested
            or not batch.steering
        )
        if should_close:
            run.phase = normalized_phase
            run.updated_at = utc_now_naive()
            session.add(run)
        session.commit()
        return batch


def checkpoint_chat_rollout(bind: Any, task_id: int, step: Any, state: Any) -> dict[str, Any]:
    """Upsert one durable step checkpoint and append its immutable event."""

    checkpoint = build_step_checkpoint(step, state)
    with Session(bind) as session:
        chat_run = session.exec(
            select(ChatRun)
            .where(ChatRun.task_run_id == task_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if chat_run is not None:
            require_chat_run_lease(chat_run, chat_run_lease_from_state(state))
        task = session.exec(
            select(TaskRun)
            .where(TaskRun.id == task_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if task is None or task.task_type != ROLLOUT_TASK_TYPE:
            raise ValueError(f"chat rollout task not found: {task_id}")
        step_index = int(checkpoint["step_index"])
        key = f"agent_step_{step_index}"
        record = session.exec(
            select(TaskStep).where(TaskStep.task_run_id == task_id, TaskStep.key == key)
        ).first()
        if record is None:
            record = TaskStep(
                task_run_id=task_id,
                key=key,
                title=f"Agent step {step_index + 1}",
                step_type="agent_step",
                sort_order=step_index + 1,
            )
        status = str(checkpoint.get("status") or "completed")
        record.status = "pending" if status == "waiting_confirmation" else status
        record.input_json = _json_dumps({"tool_calls": checkpoint["tool_calls"]})
        record.output_json = _json_dumps(checkpoint)
        record.error_code = (
            "STEP_FAILED"
            if status == "failed"
            else "STEP_CANCELLED"
            if status == "cancelled"
            else ""
        )
        record.error_message = str(checkpoint.get("error") or "")
        record.retryable = bool(checkpoint.get("retryable", False))
        record.retry_count = int(checkpoint.get("retry_count") or 0)
        record.updated_at = utc_now_naive()
        record.started_at = record.started_at or record.updated_at
        if status in {"completed", "failed", "cancelled"}:
            record.completed_at = record.updated_at
        task.current_step_key = key
        task.updated_at = record.updated_at
        if status == "waiting_confirmation":
            task.status = "paused"
        session.add(record)
        session.add(task)
        if chat_run is not None:
            chat_run.status = "waiting_confirmation" if status == "waiting_confirmation" else "running"
            if status == "waiting_confirmation":
                chat_run.phase = "waiting_confirmation"
            elif chat_run.phase not in _INPUT_CLOSED_CHAT_RUN_PHASES:
                # A checkpoint must never reopen a final-step/confirmation/input
                # barrier after the serving loop has closed it under row lock.
                chat_run.phase = key
            chat_run.step_count = max(chat_run.step_count, step_index + 1)
            chat_run.tool_call_count = sum(
                len(_json_loads(item.input_json, {}).get("tool_calls", []))
                for item in session.exec(
                    select(TaskStep).where(TaskStep.task_run_id == task_id)
                ).all()
            )
            chat_run.updated_at = record.updated_at
            session.add(chat_run)
        _append_event(session, task, "step_checkpoint", {"checkpoint": checkpoint})
        session.commit()
        return checkpoint


def _records_for_task(session: Session, task_id: int) -> list[dict[str, Any]]:
    events = session.exec(
        select(TaskEvent)
        .where(TaskEvent.task_run_id == task_id)
        .order_by(TaskEvent.created_at, TaskEvent.id)
    ).all()
    return [
        {
            "event_type": event.event_type,
            "payload": _json_loads(event.payload_json, {}),
        }
        for event in events
    ]


def attach_chat_run_assistant_message(
    bind: Any,
    *,
    run_id: str,
    conversation_id: int,
    message_id: int,
    lease: ChatRunLease | None = None,
) -> None:
    """Bind a persisted Assistant Message before the terminal Run commit.

    Message persistence remains owned by the chat store. This short follow-up
    transaction makes a crash between Message commit and terminal Rollout
    commit reconstructable, while exact lease fencing prevents a stale worker
    from attaching its late result after the reaper wins.
    """

    with Session(bind) as session:
        run = session.exec(
            select(ChatRun)
            .where(ChatRun.run_id == str(run_id or "").strip())
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if run is None or run.id is None:
            raise ValueError("chat run assistant projection is unavailable")
        require_chat_run_lease(run, lease)
        if int(run.conversation_id) != int(conversation_id):
            raise ValueError("chat run assistant projection conversation mismatch")
        message = session.get(Message, int(message_id))
        if (
            message is None
            or message.role != "assistant"
            or int(message.conversation_id) != int(conversation_id)
        ):
            raise ValueError("chat run assistant projection message mismatch")
        if run.assistant_message_id is not None:
            if int(run.assistant_message_id) != int(message_id):
                raise ValueError("chat run already references another assistant message")
            return
        task = session.exec(
            select(TaskRun)
            .where(TaskRun.id == int(run.task_run_id))
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if task is None or task.task_type != ROLLOUT_TASK_TYPE:
            raise ValueError("chat rollout task is unavailable")
        _append_event(session, task, "message_persisted", {"message_id": int(message_id)})
        run.assistant_message_id = int(message_id)
        run.updated_at = utc_now_naive()
        session.add(run)
        session.commit()


def finalize_chat_rollout(
    bind: Any,
    task_id: int,
    *,
    status: str,
    message_id: int | None = None,
    phase: str = "",
    error_code: str = "",
    error_message: str = "",
    retryable: bool = False,
    run_outputs: list[dict[str, Any]] | None = None,
    lease: ChatRunLease | None = None,
) -> dict[str, Any]:
    """Append one terminal boundary and store the reconstructed snapshot."""

    event_type_by_status = {
        "completed": "run_completed",
        "failed": "run_failed",
        "waiting_confirmation": "run_waiting_confirmation",
        "cancelled": "run_cancelled",
    }
    if status not in event_type_by_status:
        raise ValueError(f"unsupported rollout terminal status: {status}")
    with Session(bind) as session:
        chat_run = session.exec(
            select(ChatRun)
            .where(ChatRun.task_run_id == task_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if chat_run is not None:
            require_chat_run_lease(chat_run, lease)
        task = session.exec(
            select(TaskRun)
            .where(TaskRun.id == task_id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if task is None or task.task_type != ROLLOUT_TASK_TYPE:
            raise ValueError(f"chat rollout task not found: {task_id}")
        if message_id is not None:
            if chat_run is not None and chat_run.assistant_message_id is not None:
                if int(chat_run.assistant_message_id) != int(message_id):
                    raise ValueError("chat run already references another assistant message")
            else:
                _append_event(session, task, "message_persisted", {"message_id": message_id})
        _append_event(
            session,
            task,
            event_type_by_status[status],
            {
                "phase": phase,
                "error_code": error_code,
                "error_message": error_message[:800],
                "retryable": bool(retryable),
                "run_outputs": normalize_run_output_records(run_outputs or []),
            },
        )
        now = utc_now_naive()
        task.status = "paused" if status == "waiting_confirmation" else status
        task.error_code = error_code
        task.error_message = error_message[:800]
        task.updated_at = now
        task.completed_at = now
        session.add(task)
        session.flush()
        snapshot = reconstruct_rollout(_records_for_task(session, task_id), task_status=task.status)
        task.output_json = _json_dumps(snapshot)
        session.add(task)
        if chat_run is not None:
            steps = list(snapshot.get("steps") or [])
            if message_id is not None:
                chat_run.assistant_message_id = message_id
            chat_run.status = status
            chat_run.phase = phase or "completed"
            chat_run.step_count = len(steps)
            chat_run.tool_call_count = sum(
                len(step.get("tool_calls") or []) for step in steps if isinstance(step, dict)
            )
            chat_run.output_count = len(snapshot.get("run_outputs") or [])
            chat_run.error_code = error_code
            chat_run.retryable = bool(retryable)
            chat_run.completed_at = now
            chat_run.updated_at = now
            chat_run.duration_ms = max(
                0,
                int((now - chat_run.started_at).total_seconds() * 1000),
            )
            clear_chat_run_lease(chat_run)
            session.add(chat_run)
            session.flush()
            if chat_run.skill_rollout_id:
                skill_rollout = session.get(SkillRollout, chat_run.skill_rollout_id)
                if skill_rollout is not None:
                    health = evaluate_rollout_stop_loss(session, skill_rollout)
                    if health.get("auto_stopped"):
                        _append_event(
                            session,
                            task,
                            "skill_rollout_auto_stopped",
                            {
                                "skill_rollout_id": skill_rollout.id,
                                "reason": skill_rollout.stop_reason,
                                "candidate_terminal_count": health["candidate"]["terminal_count"],
                                "candidate_failure_rate": health["candidate"]["failure_rate"],
                            },
                        )
                        snapshot = reconstruct_rollout(
                            _records_for_task(session, task_id),
                            task_status=task.status,
                        )
                        task.output_json = _json_dumps(snapshot)
                        session.add(task)
        session.commit()
        return snapshot


def get_chat_rollout(
    session: Session,
    conversation_id: int,
    *,
    run_id: str | None = None,
) -> dict[str, Any] | None:
    """Return the latest (or selected) reconstructed rollout for a conversation."""

    tasks = session.exec(
        select(TaskRun)
        .where(
            TaskRun.conversation_id == conversation_id,
            TaskRun.task_type == ROLLOUT_TASK_TYPE,
        )
        .order_by(TaskRun.created_at.desc(), TaskRun.id.desc())
        .limit(100)
    ).all()
    selected = next(
        (task for task in tasks if run_id is None or _run_id_from_task(task) == run_id),
        None,
    )
    if selected is None or selected.id is None:
        return None
    snapshot = reconstruct_rollout(
        _records_for_task(session, selected.id),
        task_status=selected.status,
    )
    return {
        **snapshot,
        "task_run_id": selected.id,
        "conversation_id": selected.conversation_id,
        "updated_at": selected.updated_at.isoformat(),
    }


def build_in_memory_rollout_snapshot(
    state: Any,
    *,
    status: str,
    message_id: int | None = None,
    phase: str = "",
    error_message: str = "",
) -> dict[str, Any]:
    """Build the message-metadata snapshot from the same canonical records."""

    run_id = str(getattr(state, "run_id", "") or "")
    records: list[dict[str, Any]] = [
        {
            "event_type": "run_started",
            "payload": {
                "ordinal": 1,
                "run_id": run_id,
                "context_manifest": _safe_context_manifest(
                    getattr(state, "context_manifest", None)
                ),
            },
        }
    ]
    for step in list(getattr(state, "steps", None) or []):
        records.append(
            {
                "event_type": "step_checkpoint",
                "payload": {
                    "ordinal": len(records) + 1,
                    "run_id": run_id,
                    "checkpoint": build_step_checkpoint(step, state),
                },
            }
        )
    if message_id is not None:
        records.append(
            {
                "event_type": "message_persisted",
                "payload": {
                    "ordinal": len(records) + 1,
                    "run_id": run_id,
                    "message_id": message_id,
                },
            }
        )
    terminal_event = {
        "completed": "run_completed",
        "failed": "run_failed",
        "waiting_confirmation": "run_waiting_confirmation",
        "cancelled": "run_cancelled",
    }[status]
    records.append(
        {
            "event_type": terminal_event,
            "payload": {
                "ordinal": len(records) + 1,
                "run_id": run_id,
                "phase": phase,
                "error_message": error_message[:800],
                "run_outputs": normalize_run_output_records(
                    getattr(state, "run_outputs", None) or []
                ),
            },
        }
    )
    return reconstruct_rollout(records, task_status=status)
