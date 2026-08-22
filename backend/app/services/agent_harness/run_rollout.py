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

from app.models.db import Message, TaskEvent, TaskRun, TaskStep
from app.services.time_utils import utc_now_naive

ROLLOUT_SCHEMA_VERSION = 1
ROLLOUT_TASK_TYPE = "chat_rollout"

_TERMINAL_EVENT_STATUS = {
    "run_completed": "completed",
    "run_failed": "failed",
    "run_waiting_confirmation": "waiting_confirmation",
    "run_cancelled": "cancelled",
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
        if isinstance(event, dict) and _safe_int(event.get("step_index"), -1) == step_index
    ]
    status = str(getattr(step, "status", "") or "")
    if not status:
        if any(str(event.get("status") or "") in {"error", "failed", "blocked"} for event in matching_tool_events):
            status = "failed"
        elif any(str(event.get("status") or "") == "confirmation_required" for event in matching_tool_events):
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
        if str(event.get("status") or "") in {"error", "failed"}
    ]
    retryable = bool(failed_events) and all(bool(event.get("retryable", False)) for event in failed_events)
    if getattr(step, "retryable", None) is not None:
        retryable = bool(getattr(step, "retryable"))

    model_text = str(getattr(step, "model_text", "") or "")
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
        "tool_calls": [
            _sanitize_tool_call(tool_call)
            for tool_call in list(getattr(step, "tool_calls", None) or [])
            if isinstance(tool_call, dict)
        ],
        "tool_events": [_sanitize_tool_event(event) for event in matching_tool_events],
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
    status = "running" if task_status in {"pending", "running"} else task_status
    message_id: int | str | None = None
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
        if event_type == "step_checkpoint":
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
    snapshot_core = {
        "schema_version": ROLLOUT_SCHEMA_VERSION,
        "run_id": run_id,
        "status": status,
        "terminal_event": terminal_event or None,
        "message_id": message_id,
        "last_ordinal": int(ordered[-1]["payload"]["ordinal"]) if ordered else 0,
        "steps": ordered_steps,
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


def begin_chat_rollout(bind: Any, runtime: Any, request_content: str, run_id: str) -> int:
    """Create the durable Aria rollout before the first model/tool step."""

    now = utc_now_naive()
    with Session(bind) as session:
        source_message = session.exec(
            select(Message)
            .where(Message.conversation_id == int(runtime.conv_id), Message.role == "user")
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(1)
        ).first()
        task = TaskRun(
            project_id=None,  # hidden from project task lists; project id stays in the event payload
            conversation_id=int(runtime.conv_id),
            task_type=ROLLOUT_TASK_TYPE,
            goal=f"Aria chat rollout {run_id}",
            status="running",
            current_step_key="agent_loop",
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
                }
            ),
            created_at=now,
            updated_at=now,
            started_at=now,
        )
        session.add(task)
        session.flush()
        _append_event(
            session,
            task,
            "run_started",
            {
                "conversation_id": int(runtime.conv_id),
                "project_id": getattr(runtime, "project_id", None),
                "source_message_id": getattr(source_message, "id", None),
                "model": str(getattr(runtime, "selected_model", "") or ""),
                "chat_mode": _enum_value(getattr(runtime, "chat_mode", "")),
                "action_policy": _enum_value(getattr(runtime, "action_policy", "")),
            },
        )
        session.commit()
        return _task_run_id(task)


def checkpoint_chat_rollout(bind: Any, task_id: int, step: Any, state: Any) -> dict[str, Any]:
    """Upsert one durable step checkpoint and append its immutable event."""

    checkpoint = build_step_checkpoint(step, state)
    with Session(bind) as session:
        task = session.get(TaskRun, task_id)
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
        record.error_code = "STEP_FAILED" if status == "failed" else ""
        record.error_message = str(checkpoint.get("error") or "")
        record.retryable = bool(checkpoint.get("retryable", False))
        record.retry_count = int(checkpoint.get("retry_count") or 0)
        record.updated_at = utc_now_naive()
        record.started_at = record.started_at or record.updated_at
        if status in {"completed", "failed"}:
            record.completed_at = record.updated_at
        task.current_step_key = key
        task.updated_at = record.updated_at
        if status == "waiting_confirmation":
            task.status = "paused"
        session.add(record)
        session.add(task)
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
        task = session.get(TaskRun, task_id)
        if task is None or task.task_type != ROLLOUT_TASK_TYPE:
            raise ValueError(f"chat rollout task not found: {task_id}")
        if message_id is not None:
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
            "payload": {"ordinal": 1, "run_id": run_id},
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
            },
        }
    )
    return reconstruct_rollout(records, task_status=status)
