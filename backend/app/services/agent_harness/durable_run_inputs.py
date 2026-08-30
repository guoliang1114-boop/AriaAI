"""Durable, content-free inputs for an exact Aria chat run.

The mailbox/ordinal boundary is adapted from OpenAI Codex
``codex-rs/core/src/session/turn_input.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-30: translated to Python/SQLModel, bound to
Aria Conversation ACL and ChatRun identities, persisted as a content-free
database mailbox, and integrated only at Aria model/tool safety boundaries.
No Codex runtime, SDK, protocol, account, or subprocess is used.

Aria stores only hashes and message identities here; input text remains solely
in the authorized ``Message`` row and is loaded again at the apply boundary.
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, select

from app.models.db import ChatRun, ChatRunInput, Message
from app.services.agent_harness.turn_interrupt import (
    MAX_PENDING_STEERING_INPUTS,
    SteeringInput,
)
from app.services.time_utils import utc_now_naive


INPUT_KIND_STEERING = "steering"
INPUT_KIND_CANCEL = "cancel"
INPUT_STATUS_ACCEPTED = "accepted"
INPUT_STATUS_APPLIED = "applied"
INPUT_STATUS_UNAPPLIED = "unapplied"
INPUT_STATUS_RETRACTED = "retracted"

_NON_STEERABLE_ACTION_POLICIES = frozenset(
    {
        "durable_task",
        "destructive_action",
    }
)
_NON_STEERABLE_PHASES = frozenset(
    {
        "reserved",
        "agent_loop_done",
        "agent_loop_final_step",
        "confirmation_tool",
        "durable_task",
        "durable_task_done",
        "destructive_action",
        "non_steerable_execution",
        "p0_markdown_continuation",
        "p0_markdown_followup",
        "persist",
        "waiting_confirmation",
        "completed",
    }
)
_REMOTE_CANCEL_CLOSED_PHASES = frozenset(
    {
        "reserved",
        "agent_loop_done",
        "agent_loop_final_step",
        "confirmation_tool",
        "destructive_action",
        "durable_task_done",
        "persist",
        "waiting_confirmation",
        "completed",
    }
)
_LOCAL_CANCEL_CLOSED_PHASES = frozenset(
    {
        "reserved",
        "agent_loop_done",
        "agent_loop_final_step",
        "durable_task_done",
        "persist",
        "waiting_confirmation",
        "completed",
    }
)
_DURABLE_CANCEL_POLL_PHASES = frozenset(
    {
        "durable_task",
        "p0_markdown_continuation",
        "p0_markdown_followup",
    }
)


class DurableRunInputRejected(ValueError):
    """Fail-closed rejection with a stable router-facing code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class DurableRunInputBatch:
    """Authoritative inputs observed and handled at one safe boundary."""

    authoritative: bool
    steering: tuple[SteeringInput, ...] = ()
    cancel_requested: bool = False
    input_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class RecoveryRunIdentity:
    """Content-free parent/snapshot identity for a recovery child run."""

    parent_run_id: str | None = None
    recovery_snapshot_sha256: str = ""
    unapplied_message_ids: tuple[int, ...] = ()
    applied_message_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class RecoverySteeringMessage:
    """Authorized Message body resolved from a content-free input identity."""

    message_id: int
    sequence: int
    status: str
    content: str
    content_sha256: str


def content_sha256(content: str) -> str:
    return hashlib.sha256(str(content or "").strip().encode("utf-8")).hexdigest()


def _cancel_sha256(run_id: str, conversation_id: int) -> str:
    marker = f"aria.chat-run-input.cancel.v1\0{run_id}\0{conversation_id}"
    return hashlib.sha256(marker.encode("utf-8")).hexdigest()


def _locked_run(
    session: Session,
    *,
    run_id: str,
) -> ChatRun | None:
    return session.exec(
        select(ChatRun)
        .where(ChatRun.run_id == str(run_id or "").strip())
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()


def _require_active_run(
    session: Session,
    *,
    run_id: str,
    conversation_id: int,
) -> ChatRun:
    run = _locked_run(session, run_id=run_id)
    if run is None or run.id is None:
        raise DurableRunInputRejected("run_not_found", "Durable chat run not found")
    if int(run.conversation_id) != int(conversation_id):
        raise DurableRunInputRejected(
            "conversation_mismatch",
            "Durable chat run conversation mismatch",
        )
    if run.status != "running" or run.completed_at is not None:
        raise DurableRunInputRejected(
            "run_not_active",
            "Durable chat run is no longer active",
        )
    return run


def resolve_active_durable_run(session: Session, *, run_id: str) -> ChatRun:
    """Resolve routing identity from durable state, never process locality."""

    run = session.exec(
        select(ChatRun).where(ChatRun.run_id == str(run_id or "").strip())
    ).first()
    if run is None or run.id is None:
        raise DurableRunInputRejected("run_not_found", "Durable chat run not found")
    if run.status != "running" or run.completed_at is not None:
        raise DurableRunInputRejected(
            "run_not_active",
            "Durable chat run is no longer active",
        )
    return run


def durable_run_accepts_steering(run: ChatRun) -> bool:
    """Return whether durable state positively permits cross-worker steering.

    The process-local registry remains the most precise live-stage signal, but
    another worker cannot consult it.  Explicitly non-steerable policies and
    phases therefore fail closed from the persisted ``ChatRun`` projection.
    Unknown/ordinary active phases remain mailbox-steerable so a remote worker
    can still add input to a normal Agent Loop run.
    """

    action_policy = str(getattr(run, "action_policy", "") or "").strip().lower()
    phase = str(getattr(run, "phase", "") or "").strip().lower()
    if action_policy in _NON_STEERABLE_ACTION_POLICIES:
        return False
    if phase in _NON_STEERABLE_PHASES or phase.startswith("durable_task"):
        return False
    return True


def durable_run_accepts_cancel(run: ChatRun) -> bool:
    """Return whether a registry-absent worker may durably enqueue cancel.

    Ordinary Agent Loop phases accept remote cancellation only while another
    authoritative mailbox poll is still guaranteed. Terminalizing phases have
    already crossed their last poll and must reject instead of returning a
    misleading durable-boundary ``202``. Durable project-task phases are the
    exception because that execution path polls its cancel mailbox explicitly.

    A router may still allow a closed phase when its own process-local registry
    proves that it can cancel the live task immediately; this predicate covers
    only the cross-worker fallback.
    """

    if str(getattr(run, "status", "") or "").strip().lower() != "running":
        return False
    if getattr(run, "completed_at", None) is not None:
        return False

    action_policy = str(getattr(run, "action_policy", "") or "").strip().lower()
    phase = str(getattr(run, "phase", "") or "").strip().lower()
    if phase in _REMOTE_CANCEL_CLOSED_PHASES:
        return False
    if (
        action_policy == "durable_task"
        or phase in _DURABLE_CANCEL_POLL_PHASES
        or phase.startswith("durable_task")
    ):
        return True
    if action_policy == "destructive_action" or phase == "non_steerable_execution":
        return False
    return True


def durable_run_accepts_local_cancel(run: ChatRun) -> bool:
    """Return whether a live process task may accept and apply cancellation.

    Process locality can safely bypass phases that reject remote mailbox-only
    delivery, but it cannot reopen a terminal/persist boundary after the final
    model step or a durable assistant-message commit may already have occurred.
    """

    if str(getattr(run, "status", "") or "").strip().lower() != "running":
        return False
    if getattr(run, "completed_at", None) is not None:
        return False
    phase = str(getattr(run, "phase", "") or "").strip().lower()
    return phase not in _LOCAL_CANCEL_CLOSED_PHASES


def persist_non_steerable_run_state(
    bind,
    *,
    run_id: str,
    conversation_id: int,
    action_policy: str,
    phase: str,
) -> None:
    """Persist a cross-worker-visible non-steerable execution boundary."""

    normalized_policy = str(action_policy or "").strip().lower()
    normalized_phase = str(phase or "").strip().lower()
    if (
        normalized_policy not in _NON_STEERABLE_ACTION_POLICIES
        and normalized_phase not in _NON_STEERABLE_PHASES
        and not normalized_phase.startswith("durable_task")
    ):
        raise ValueError("persisted run state must be explicitly non-steerable")
    with Session(bind) as session:
        run = _require_active_run(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
        )
        if normalized_policy:
            run.action_policy = normalized_policy
        run.phase = normalized_phase
        run.updated_at = utc_now_naive()
        session.add(run)
        session.commit()


def _next_sequence(session: Session, chat_run_id: int) -> int:
    current = session.exec(
        select(func.max(ChatRunInput.sequence)).where(
            ChatRunInput.chat_run_id == chat_run_id
        )
    ).one()
    return int(current or 0) + 1


def accept_steering_run_input(
    session: Session,
    *,
    run_id: str,
    conversation_id: int,
    message_id: int | None,
    content_digest: str,
) -> ChatRunInput:
    """Stage one steering row in the caller's message transaction."""

    run = _require_active_run(
        session,
        run_id=run_id,
        conversation_id=conversation_id,
    )
    if not durable_run_accepts_steering(run):
        raise DurableRunInputRejected(
            "run_not_steerable",
            "Durable chat run is not accepting steering at this phase",
        )
    message = session.get(Message, int(message_id or 0))
    normalized_digest = str(content_digest or "").lower()
    normalized_content = str(message.content or "").strip() if message is not None else ""
    if (
        message is None
        or message.id is None
        or message.role != "user"
        or int(message.conversation_id) != int(conversation_id)
        or not normalized_content
        or len(normalized_content) > 8_000
        or len(normalized_digest) != 64
        or content_sha256(message.content) != normalized_digest
    ):
        raise DurableRunInputRejected(
            "message_invalid",
            "Steering message is missing or does not match its content hash",
        )

    stopping = session.exec(
        select(ChatRunInput.id).where(
            ChatRunInput.chat_run_id == int(run.id),
            ChatRunInput.kind == INPUT_KIND_CANCEL,
            ChatRunInput.status.in_(
                (INPUT_STATUS_ACCEPTED, INPUT_STATUS_APPLIED)
            ),
        )
    ).first()
    if stopping is not None:
        raise DurableRunInputRejected(
            "run_stopping",
            "Durable chat run is already stopping",
        )

    pending_count = session.exec(
        select(func.count(ChatRunInput.id)).where(
            ChatRunInput.chat_run_id == int(run.id),
            ChatRunInput.kind == INPUT_KIND_STEERING,
            ChatRunInput.status == INPUT_STATUS_ACCEPTED,
        )
    ).one()
    if int(pending_count or 0) >= MAX_PENDING_STEERING_INPUTS:
        raise DurableRunInputRejected(
            "queue_full",
            "Durable chat run steering queue is full",
        )

    sequence = _next_sequence(session, int(run.id))
    item = ChatRunInput(
        run_id=run.run_id,
        chat_run_id=int(run.id),
        conversation_id=int(conversation_id),
        message_id=int(message.id),
        kind=INPUT_KIND_STEERING,
        sequence=sequence,
        content_sha256=normalized_digest,
        status=INPUT_STATUS_ACCEPTED,
    )
    session.add(item)
    session.flush()
    return item


def accept_cancel_run_input(
    session: Session,
    *,
    run_id: str,
    conversation_id: int,
    allow_closed_phase: bool = False,
) -> ChatRunInput:
    """Stage a durable cancellation intent before cancelling the live task.

    A remote worker must still have an authoritative future mailbox poll.  A
    worker with the exact process-local task may opt into a closed phase because
    it can cancel that task immediately after this transaction commits.
    """

    run = _require_active_run(
        session,
        run_id=run_id,
        conversation_id=conversation_id,
    )
    accepts_cancel = (
        durable_run_accepts_local_cancel(run)
        if allow_closed_phase
        else durable_run_accepts_cancel(run)
    )
    if not accepts_cancel:
        raise DurableRunInputRejected(
            "run_not_cancellable",
            "Durable chat run is no longer accepting cancellation at this phase",
        )
    existing = session.exec(
        select(ChatRunInput).where(
            ChatRunInput.chat_run_id == int(run.id),
            ChatRunInput.kind == INPUT_KIND_CANCEL,
            ChatRunInput.status.in_(
                (INPUT_STATUS_ACCEPTED, INPUT_STATUS_APPLIED)
            ),
        )
    ).first()
    if existing is not None:
        return existing
    item = ChatRunInput(
        run_id=run.run_id,
        chat_run_id=int(run.id),
        conversation_id=int(conversation_id),
        message_id=None,
        kind=INPUT_KIND_CANCEL,
        sequence=_next_sequence(session, int(run.id)),
        content_sha256=_cancel_sha256(run.run_id, int(conversation_id)),
        status=INPUT_STATUS_ACCEPTED,
    )
    session.add(item)
    session.flush()
    return item


def _valid_steering_message(
    session: Session,
    item: ChatRunInput,
) -> tuple[Message | None, str]:
    message = session.get(Message, int(item.message_id or 0))
    if (
        message is None
        or message.id is None
        or message.role != "user"
        or int(message.conversation_id) != int(item.conversation_id)
        or content_sha256(message.content) != item.content_sha256
    ):
        return None, ""
    metadata = message.get_metadata()
    steering = metadata.get("run_steering")
    if not isinstance(steering, dict):
        return None, ""
    metadata_sequence = steering.get("sequence")
    metadata_input_id = steering.get("input_id")
    if (
        str(steering.get("run_id") or "") != item.run_id
        or str(steering.get("expected_run_id") or "") != item.run_id
        or not isinstance(metadata_sequence, int)
        or isinstance(metadata_sequence, bool)
        or metadata_sequence != int(item.sequence)
        or not isinstance(metadata_input_id, int)
        or isinstance(metadata_input_id, bool)
        or metadata_input_id != int(item.id or 0)
        or str(steering.get("status") or "") != INPUT_STATUS_ACCEPTED
    ):
        return None, ""
    steering_id = str(steering.get("steering_id") or "")
    if not re.fullmatch(r"steer_[A-Za-z0-9_-]{1,64}", steering_id):
        return None, ""
    return message, steering_id


def claim_durable_run_inputs_in_session(
    session: Session,
    *,
    run_id: str,
    conversation_id: int,
) -> DurableRunInputBatch:
    """Stage an authoritative input claim in the caller's transaction.

    Steering rows are marked applied before returning, so a worker restart
    cannot feed the same body to the model twice. A valid cancel remains
    accepted until the ChatRun terminal transaction proves status=cancelled;
    this prevents a crash between polling and terminalization from losing the
    user's stop intent. Invalid/tampered rows are retracted, while steering
    skipped by cancellation becomes ``unapplied`` for recovery.
    """

    run = _locked_run(session, run_id=run_id)
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

    rows = list(
        session.exec(
            select(ChatRunInput)
            .where(
                ChatRunInput.chat_run_id == int(run.id),
                ChatRunInput.status == INPUT_STATUS_ACCEPTED,
            )
            .order_by(ChatRunInput.sequence, ChatRunInput.id)
            .with_for_update()
        ).all()
    )
    if not rows:
        return DurableRunInputBatch(authoritative=True)

    valid_rows: list[ChatRunInput] = []
    for item in rows:
        if (
            item.run_id != run.run_id
            or int(item.conversation_id) != int(run.conversation_id)
            or (
                item.kind == INPUT_KIND_CANCEL
                and (
                    item.message_id is not None
                    or item.content_sha256
                    != _cancel_sha256(run.run_id, int(run.conversation_id))
                )
            )
        ):
            item.status = INPUT_STATUS_RETRACTED
            item.applied_at = None
            session.add(item)
        else:
            valid_rows.append(item)
    rows = valid_rows
    if not rows:
        session.flush()
        return DurableRunInputBatch(authoritative=True)

    if run.status != "running" or run.completed_at is not None:
        for item in rows:
            item.status = INPUT_STATUS_UNAPPLIED
            item.applied_at = None
            session.add(item)
        session.flush()
        return DurableRunInputBatch(authoritative=True)

    cancel_rows = [item for item in rows if item.kind == INPUT_KIND_CANCEL]
    if cancel_rows:
        cancel_ids: list[int] = []
        for item in rows:
            if item.kind == INPUT_KIND_CANCEL:
                # Observation is not proof that cancellation durably won. Keep
                # the intent retryable until terminal ChatRun status=cancelled
                # and let the terminal finalizer acknowledge it as applied.
                item.status = INPUT_STATUS_ACCEPTED
                item.applied_at = None
                if item.id is not None:
                    cancel_ids.append(int(item.id))
            else:
                item.status = INPUT_STATUS_UNAPPLIED
                item.applied_at = None
            session.add(item)
        session.flush()
        return DurableRunInputBatch(
            authoritative=True,
            cancel_requested=True,
            input_ids=tuple(cancel_ids),
        )

    claimed: list[SteeringInput] = []
    applied_ids: list[int] = []
    now = utc_now_naive()
    for item in rows:
        if item.kind != INPUT_KIND_STEERING:
            item.status = INPUT_STATUS_RETRACTED
            item.applied_at = None
            session.add(item)
            continue
        message, steering_id = _valid_steering_message(session, item)
        if message is None:
            item.status = INPUT_STATUS_RETRACTED
            item.applied_at = None
            session.add(item)
            continue
        item.status = INPUT_STATUS_APPLIED
        item.applied_at = now
        session.add(item)
        if item.id is not None:
            applied_ids.append(int(item.id))
        claimed.append(
            SteeringInput(
                steering_id=steering_id,
                run_id=item.run_id,
                conversation_id=int(item.conversation_id),
                sequence=int(item.sequence),
                content=message.content,
                content_sha256=item.content_sha256,
                accepted_monotonic=time.monotonic(),
                message_id=int(message.id),
            )
        )
    session.flush()
    return DurableRunInputBatch(
        authoritative=True,
        steering=tuple(claimed),
        input_ids=tuple(applied_ids),
    )


def claim_durable_run_inputs(
    bind,
    *,
    run_id: str,
    conversation_id: int,
) -> DurableRunInputBatch:
    """Atomically commit accepted inputs at one Agent Loop safe boundary."""

    with Session(bind) as session:
        batch = claim_durable_run_inputs_in_session(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        return batch


def claim_durable_run_cancel_in_session(
    session: Session,
    *,
    run_id: str,
    conversation_id: int,
    defer_terminal_ack: bool = False,
) -> DurableRunInputBatch:
    """Stage a cancel-only claim in the caller's current transaction.

    Durable project tasks cannot incorporate mid-flight prompt steering.  This
    narrower claim therefore leaves every accepted steering row untouched when
    no valid cancel exists.  When cancellation is present it wins atomically:
    accepted steering becomes ``unapplied`` so a later recovery can surface
    those instructions without pretending the durable task consumed them.
    Durable-task callers leave ``defer_terminal_ack`` false and atomically mark
    cancel applied with the linked TaskRun cancellation. Ordinary Agent Loop
    persist callers defer that acknowledgement until ChatRun terminal state.
    """

    run = _locked_run(session, run_id=run_id)
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

    cancel_rows = list(
        session.exec(
            select(ChatRunInput)
            .where(
                ChatRunInput.chat_run_id == int(run.id),
                ChatRunInput.kind == INPUT_KIND_CANCEL,
                ChatRunInput.status == INPUT_STATUS_ACCEPTED,
            )
            .order_by(ChatRunInput.sequence, ChatRunInput.id)
            .with_for_update()
        ).all()
    )
    valid_cancel_rows: list[ChatRunInput] = []
    for item in cancel_rows:
        if (
            item.run_id != run.run_id
            or int(item.conversation_id) != int(run.conversation_id)
            or item.content_sha256
            != _cancel_sha256(run.run_id, int(run.conversation_id))
        ):
            item.status = INPUT_STATUS_RETRACTED
            item.applied_at = None
            session.add(item)
        else:
            valid_cancel_rows.append(item)

    if not valid_cancel_rows:
        # In particular, do not claim, validate, retract, or otherwise mutate
        # steering here. Agent Loop owns steering consumption.
        session.flush()
        return DurableRunInputBatch(authoritative=True)

    rows = list(
        session.exec(
            select(ChatRunInput)
            .where(
                ChatRunInput.chat_run_id == int(run.id),
                ChatRunInput.status == INPUT_STATUS_ACCEPTED,
            )
            .order_by(ChatRunInput.sequence, ChatRunInput.id)
            .with_for_update()
        ).all()
    )
    now = utc_now_naive()
    cancel_ids: list[int] = []
    run_active = run.status == "running" and run.completed_at is None
    for item in rows:
        if item.kind == INPUT_KIND_CANCEL:
            if run_active and defer_terminal_ack:
                item.status = INPUT_STATUS_ACCEPTED
                item.applied_at = None
            else:
                item.status = (
                    INPUT_STATUS_APPLIED if run_active else INPUT_STATUS_UNAPPLIED
                )
                item.applied_at = now if run_active else None
            if run_active and item.id is not None:
                cancel_ids.append(int(item.id))
        elif item.kind == INPUT_KIND_STEERING:
            item.status = INPUT_STATUS_UNAPPLIED
            item.applied_at = None
        else:  # Defensive against a constraint-disabled/tampered database.
            item.status = INPUT_STATUS_RETRACTED
            item.applied_at = None
        session.add(item)
    session.flush()
    return DurableRunInputBatch(
        authoritative=True,
        cancel_requested=run_active,
        input_ids=tuple(cancel_ids),
    )


def claim_durable_run_cancel(
    bind,
    *,
    run_id: str,
    conversation_id: int,
) -> DurableRunInputBatch:
    """Atomically commit a cancel-only claim without touching lone steering."""

    with Session(bind) as session:
        batch = claim_durable_run_cancel_in_session(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        return batch


def _acknowledge_terminal_cancel_rows(
    session: Session,
    *,
    run: ChatRun,
) -> tuple[int, ...]:
    if run.status == "running" or run.completed_at is None:
        raise DurableRunInputRejected(
            "run_not_terminal",
            "Durable chat run inputs cannot be finalized before Run terminal state",
        )
    rows = list(
        session.exec(
            select(ChatRunInput)
            .where(
                ChatRunInput.chat_run_id == int(run.id),
                ChatRunInput.kind == INPUT_KIND_CANCEL,
                ChatRunInput.status == INPUT_STATUS_ACCEPTED,
            )
            .order_by(ChatRunInput.sequence, ChatRunInput.id)
            .with_for_update()
        ).all()
    )
    now = utc_now_naive()
    input_ids: list[int] = []
    for item in rows:
        if (
            item.run_id != run.run_id
            or int(item.conversation_id) != int(run.conversation_id)
            or item.content_sha256
            != _cancel_sha256(run.run_id, int(run.conversation_id))
        ):
            item.status = INPUT_STATUS_RETRACTED
            item.applied_at = None
            session.add(item)
            continue
        if run.status == "cancelled":
            item.status = INPUT_STATUS_APPLIED
            item.applied_at = now
        else:
            item.status = INPUT_STATUS_UNAPPLIED
            item.applied_at = None
        session.add(item)
        if item.id is not None:
            input_ids.append(int(item.id))
    session.flush()
    return tuple(input_ids)


def acknowledge_durable_run_cancel_after_terminal(
    bind,
    *,
    run_id: str,
) -> tuple[int, ...]:
    """Ack accepted cancel only after the ChatRun terminal CAS is durable."""

    with Session(bind) as session:
        run = _locked_run(session, run_id=run_id)
        if run is None or run.id is None:
            raise DurableRunInputRejected(
                "run_not_found",
                "Authoritative durable chat run identity is unavailable",
            )
        input_ids = _acknowledge_terminal_cancel_rows(session, run=run)
        session.commit()
        return input_ids


def finalize_durable_run_inputs(bind, *, run_id: str) -> tuple[int, ...]:
    """Finalize accepted inputs only after the durable Run is terminal.

    A cancel becomes ``applied`` only when the terminal ChatRun status proves
    cancellation.  Inputs left behind by any other terminal outcome become
    ``unapplied`` for recovery.  A still-running Run is rejected so a crash or
    failed terminal write never fabricates delivery semantics.
    """

    with Session(bind) as session:
        run = _locked_run(session, run_id=run_id)
        if run is None or run.id is None:
            raise DurableRunInputRejected(
                "run_not_found",
                "Authoritative durable chat run identity is unavailable",
            )
        cancel_ids = _acknowledge_terminal_cancel_rows(session, run=run)
        rows = list(
            session.exec(
                select(ChatRunInput)
                .where(
                    ChatRunInput.chat_run_id == int(run.id),
                    ChatRunInput.kind == INPUT_KIND_STEERING,
                    ChatRunInput.status == INPUT_STATUS_ACCEPTED,
                )
                .order_by(ChatRunInput.sequence, ChatRunInput.id)
                .with_for_update()
            ).all()
        )
        input_ids: list[int] = list(cancel_ids)
        for item in rows:
            item.status = INPUT_STATUS_UNAPPLIED
            item.applied_at = None
            session.add(item)
            if item.id is not None:
                input_ids.append(int(item.id))
        session.commit()
        return tuple(input_ids)


def recovery_input_message_identities(
    session: Session,
    *,
    parent_run_id: str,
    conversation_id: int,
) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """Return unapplied and claimed/applied steering Message identities."""

    parent = session.exec(
        select(ChatRun).where(
            ChatRun.run_id == str(parent_run_id or "").strip(),
            ChatRun.conversation_id == int(conversation_id),
        )
    ).first()
    if parent is None or parent.id is None:
        return (), ()
    rows = list(
        session.exec(
            select(ChatRunInput)
            .where(
                ChatRunInput.chat_run_id == int(parent.id),
                ChatRunInput.kind == INPUT_KIND_STEERING,
                ChatRunInput.status.in_(
                    (
                        INPUT_STATUS_ACCEPTED,
                        INPUT_STATUS_UNAPPLIED,
                        INPUT_STATUS_APPLIED,
                    )
                ),
                ChatRunInput.message_id.is_not(None),
            )
            .order_by(ChatRunInput.sequence, ChatRunInput.id)
        ).all()
    )
    unapplied = tuple(
        dict.fromkeys(
            int(item.message_id)
            for item in rows
            if item.message_id is not None
            and item.status in {INPUT_STATUS_ACCEPTED, INPUT_STATUS_UNAPPLIED}
        )
    )
    applied = tuple(
        dict.fromkeys(
            int(item.message_id)
            for item in rows
            if item.message_id is not None and item.status == INPUT_STATUS_APPLIED
        )
    )
    return unapplied, applied


def load_recovery_steering_messages(
    session: Session,
    *,
    parent_run_id: str,
    conversation_id: int,
) -> tuple[RecoverySteeringMessage, ...]:
    """Load exact recovery bodies after the caller's conversation ACL check.

    Every body is re-bound to its parent Run, conversation, sequence and hash.
    A missing/tampered row fails closed instead of silently dropping a user
    instruction from the recovery context.
    """

    parent = session.exec(
        select(ChatRun).where(
            ChatRun.run_id == str(parent_run_id or "").strip(),
            ChatRun.conversation_id == int(conversation_id),
        )
    ).first()
    if parent is None or parent.id is None:
        raise DurableRunInputRejected(
            "recovery_parent_not_found",
            "Recovery parent run does not belong to this conversation",
        )
    rows = list(
        session.exec(
            select(ChatRunInput)
            .where(
                ChatRunInput.chat_run_id == int(parent.id),
                ChatRunInput.kind == INPUT_KIND_STEERING,
                ChatRunInput.status.in_(
                    (
                        INPUT_STATUS_ACCEPTED,
                        INPUT_STATUS_UNAPPLIED,
                        INPUT_STATUS_APPLIED,
                    )
                ),
            )
            .order_by(ChatRunInput.sequence, ChatRunInput.id)
        ).all()
    )
    resolved: list[RecoverySteeringMessage] = []
    for item in rows:
        if (
            item.run_id != parent.run_id
            or int(item.conversation_id) != int(parent.conversation_id)
        ):
            raise DurableRunInputRejected(
                "recovery_input_invalid",
                "Recovery steering identity no longer matches its parent run",
            )
        message, _ = _valid_steering_message(session, item)
        if message is None or message.id is None:
            raise DurableRunInputRejected(
                "recovery_input_invalid",
                "Recovery steering identity or content hash no longer matches",
            )
        status = (
            INPUT_STATUS_UNAPPLIED
            if item.status == INPUT_STATUS_ACCEPTED
            else item.status
        )
        resolved.append(
            RecoverySteeringMessage(
                message_id=int(message.id),
                sequence=int(item.sequence),
                status=status,
                content=message.content,
                content_sha256=item.content_sha256,
            )
        )
    return tuple(resolved)


def build_recovery_steering_history_messages(
    steering: tuple[RecoverySteeringMessage, ...],
) -> tuple[dict[str, str], ...]:
    """Keep verified steering at its original user trust level.

    Callers must remove these exact Message ids from ordinary model history,
    then insert the returned user-role items once. Raw user text must never be
    promoted into the system/platform prompt.
    """

    if not steering:
        return ()
    messages: list[dict[str, str]] = []
    for item in steering:
        delivery = (
            "not applied before the prior run ended"
            if item.status == INPUT_STATUS_UNAPPLIED
            else "claimed by the prior run; provider receipt is not guaranteed"
        )
        messages.append(
            {
                "role": "user",
                "content": (
                    f"[Recovered run steering #{item.sequence}; {delivery}]\n"
                    f"{item.content}"
                ),
            }
        )
    return tuple(messages)


def recovery_run_identity_from_runtime(
    runtime: Any,
    *,
    session: Session | None = None,
    conversation_id: int | None = None,
) -> RecoveryRunIdentity:
    """Derive the unique parent snapshot without hashing suggested body text.

    ``begin_chat_rollout`` can pass its current session so the snapshot also
    records unapplied steering message identities. The caller may expose those
    ids in the server-built recovery contract; this service never reads their
    bodies while constructing the identity.
    """

    metrics = getattr(runtime, "prepare_metrics", None)
    contract = metrics.get("turn_recovery") if isinstance(metrics, dict) else None
    if not isinstance(contract, dict):
        return RecoveryRunIdentity()
    parent_run_id = str(contract.get("source_run_id") or "").strip()
    if not parent_run_id.startswith("run_"):
        return RecoveryRunIdentity()
    resolved_conversation_id = int(
        conversation_id or getattr(runtime, "conv_id", 0) or 0
    )
    if session is not None and resolved_conversation_id > 0:
        unapplied_message_ids, applied_message_ids = recovery_input_message_identities(
            session,
            parent_run_id=parent_run_id,
            conversation_id=resolved_conversation_id,
        )
    else:
        unapplied_message_ids = tuple(
            int(value)
            for value in list(contract.get("unapplied_input_message_ids") or [])
            if isinstance(value, int) and not isinstance(value, bool) and value > 0
        )
        applied_message_ids = tuple(
            int(value)
            for value in list(contract.get("applied_input_message_ids") or [])
            if isinstance(value, int) and not isinstance(value, bool) and value > 0
        )
    contract_sha256 = str(contract.get("contract_sha256") or "").lower()
    if len(contract_sha256) == 64 and all(
        char in "0123456789abcdef" for char in contract_sha256
    ):
        # V2 server recovery contracts already bind the effect ledger, current
        # world state, and continuation policy. Keep the child CAS anchored to
        # that authoritative snapshot plus any late input identities.
        digest_material = (
            "aria.turn-recovery-child.v2\0"
            + contract_sha256
            + "\0"
            + json.dumps(
                {
                    "unapplied": list(unapplied_message_ids),
                    "applied": list(applied_message_ids),
                },
                sort_keys=True,
                separators=(",", ":"),
            )
        )
        digest = hashlib.sha256(digest_material.encode("utf-8")).hexdigest()
        return RecoveryRunIdentity(
            parent_run_id=parent_run_id,
            recovery_snapshot_sha256=digest,
            unapplied_message_ids=unapplied_message_ids,
            applied_message_ids=applied_message_ids,
        )

    # V1 did not expose a single authoritative contract digest. Hash every
    # available content-free recovery/world/effect identity conservatively.
    snapshot = {
        "schema_version": int(contract.get("schema_version") or 1),
        "source_run_id": parent_run_id,
        "source_message_id": int(contract.get("source_message_id") or 0),
        "source_status": str(contract.get("source_status") or ""),
        "can_continue": bool(contract.get("can_continue")),
        "strategy": str(contract.get("strategy") or ""),
        "completed_steps": [
            int(value)
            for value in list(contract.get("completed_steps") or [])[:32]
            if isinstance(value, int) and value >= 0
        ],
        "completed_tool_call_count": max(
            0,
            int(contract.get("completed_tool_call_count") or 0),
        ),
        "side_effects_possible": bool(contract.get("side_effects_possible")),
        "warning_codes": [
            str(value)[:80]
            for value in list(contract.get("warning_codes") or [])[:32]
            if str(value or "").strip()
        ],
        "unapplied_input_message_ids": list(unapplied_message_ids),
        "applied_input_message_ids": list(applied_message_ids),
    }
    for field_name in (
        "effect_ledger_sha256",
        "run_effect_ledger_sha256",
        "world_state_sha256",
        "current_world_state_sha256",
        "context_manifest_sha256",
        "recovery_checkpoint_sha256",
    ):
        value = str(contract.get(field_name) or "").lower()
        if len(value) == 64 and all(char in "0123456789abcdef" for char in value):
            snapshot[field_name] = value
    digest = hashlib.sha256(
        json.dumps(
            snapshot,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return RecoveryRunIdentity(
        parent_run_id=parent_run_id,
        recovery_snapshot_sha256=digest,
        unapplied_message_ids=unapplied_message_ids,
        applied_message_ids=applied_message_ids,
    )
