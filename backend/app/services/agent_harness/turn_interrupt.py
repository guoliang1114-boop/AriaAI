"""Process-local interruption and steering control for active Aria turns.

The active-task cancellation, graceful terminal-boundary, and model-visible
interruption principles are adapted from OpenAI Codex
``codex-rs/core/src/tasks/mod.rs``,
``codex-rs/core/src/context/turn_aborted.rs``, and
``codex-rs/core/tests/suite/abort_tasks.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: translated to a small Python registry for
the currently serving ASGI process. Aria persists partial assistant text and a
``run_cancelled`` rollout boundary before cancellation escapes the stream.
Authorization remains in Aria's chat router. No Codex process, protocol,
account, or model API is started or contacted.

The expected-turn binding and active-turn mailbox behavior for steering are
adapted from OpenAI Codex ``codex-rs/core/src/session/turn_input.rs`` at
upstream commit ``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache
License 2.0). Modified for AriaAI on 2026-08-24: Aria accepts text-only
additions through its own authenticated HTTP endpoint, stores them as normal
conversation messages, and drains a bounded process-local queue only at safe
Agent Loop boundaries. It does not use the Codex runtime, wire protocol, app
server, SDK, account, or model API.
"""
from __future__ import annotations

import asyncio
import hashlib
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4

USER_INTERRUPT_CANCEL_MESSAGE = "aria_user_interrupted"


class InterruptStatus(str, Enum):
    ACCEPTED = "accepted"
    NOT_FOUND = "not_found"
    CONVERSATION_MISMATCH = "conversation_mismatch"
    ALREADY_FINISHED = "already_finished"


class SteeringStatus(str, Enum):
    ACCEPTED = "accepted"
    NOT_FOUND = "not_found"
    CONVERSATION_MISMATCH = "conversation_mismatch"
    EXPECTED_RUN_MISMATCH = "expected_run_mismatch"
    NOT_STEERABLE = "not_steerable"
    INTERRUPT_REQUESTED = "interrupt_requested"
    EMPTY_INPUT = "empty_input"
    INPUT_TOO_LARGE = "input_too_large"
    QUEUE_FULL = "queue_full"


MAX_STEERING_INPUT_CHARS = 8_000
MAX_PENDING_STEERING_INPUTS = 12


@dataclass(frozen=True)
class ActiveTurnSnapshot:
    run_id: str
    conversation_id: int
    started_monotonic: float
    interrupt_requested: bool
    stage: str
    steerable: bool
    pending_steering_count: int
    accepted_steering_count: int


@dataclass(frozen=True)
class InterruptOutcome:
    status: InterruptStatus
    run_id: str
    conversation_id: int | None = None

    @property
    def accepted(self) -> bool:
        return self.status is InterruptStatus.ACCEPTED


@dataclass(frozen=True)
class SteeringInput:
    steering_id: str
    run_id: str
    conversation_id: int
    sequence: int
    content: str
    content_sha256: str
    accepted_monotonic: float
    message_id: int | None = None


@dataclass(frozen=True)
class SteeringOutcome:
    status: SteeringStatus
    run_id: str
    conversation_id: int | None = None
    steering: SteeringInput | None = None

    @property
    def accepted(self) -> bool:
        return self.status is SteeringStatus.ACCEPTED


@dataclass
class _ActiveTurn:
    run_id: str
    conversation_id: int
    task: asyncio.Task
    started_monotonic: float
    interrupt_requested: bool = False
    stage: str = "registered"
    steerable: bool = False
    steering_sequence: int = 0
    pending_steering: list[SteeringInput] = field(default_factory=list)


_ACTIVE_TURNS: dict[str, _ActiveTurn] = {}
_ACTIVE_TURNS_LOCK = threading.RLock()


def register_active_turn(
    run_id: str,
    conversation_id: int,
    *,
    task: asyncio.Task | None = None,
) -> ActiveTurnSnapshot:
    """Register the task serving one active SSE turn.

    A repeated run id replaces only a finished registration. Live collisions
    are rejected so an old stream can never unregister or cancel a newer one.
    """

    normalized_run_id = str(run_id or "").strip()
    if not normalized_run_id.startswith("run_"):
        raise ValueError("run_id must start with 'run_'")
    normalized_conversation_id = int(conversation_id)
    if normalized_conversation_id < 1:
        raise ValueError("conversation_id must be positive")
    active_task = task or asyncio.current_task()
    if active_task is None:
        raise RuntimeError("active turn registration requires an asyncio task")

    with _ACTIVE_TURNS_LOCK:
        existing = _ACTIVE_TURNS.get(normalized_run_id)
        if existing is not None and not existing.task.done():
            raise RuntimeError(f"active turn already registered: {normalized_run_id}")
        record = _ActiveTurn(
            run_id=normalized_run_id,
            conversation_id=normalized_conversation_id,
            task=active_task,
            started_monotonic=time.monotonic(),
        )
        _ACTIVE_TURNS[normalized_run_id] = record
        return _snapshot(record)


def unregister_active_turn(run_id: str, *, task: asyncio.Task | None = None) -> bool:
    """Remove one registration without deleting a replacement task."""

    with _ACTIVE_TURNS_LOCK:
        record = _ACTIVE_TURNS.get(str(run_id or ""))
        if record is None or (task is not None and record.task is not task):
            return False
        del _ACTIVE_TURNS[record.run_id]
        return True


def get_active_turn(run_id: str) -> ActiveTurnSnapshot | None:
    """Return non-sensitive routing metadata for authorization checks."""

    with _ACTIVE_TURNS_LOCK:
        record = _ACTIVE_TURNS.get(str(run_id or ""))
        if record is None:
            return None
        if record.task.done():
            del _ACTIVE_TURNS[record.run_id]
            return None
        return _snapshot(record)


def interrupt_active_turn(
    run_id: str,
    *,
    conversation_id: int | None = None,
) -> InterruptOutcome:
    """Request cancellation of an authorized active turn."""

    normalized_run_id = str(run_id or "")
    with _ACTIVE_TURNS_LOCK:
        record = _ACTIVE_TURNS.get(normalized_run_id)
        if record is None:
            return InterruptOutcome(InterruptStatus.NOT_FOUND, normalized_run_id)
        if conversation_id is not None and record.conversation_id != int(conversation_id):
            return InterruptOutcome(
                InterruptStatus.CONVERSATION_MISMATCH,
                normalized_run_id,
                record.conversation_id,
            )
        if record.task.done():
            del _ACTIVE_TURNS[record.run_id]
            return InterruptOutcome(
                InterruptStatus.ALREADY_FINISHED,
                normalized_run_id,
                record.conversation_id,
            )
        record.interrupt_requested = True
        record.steerable = False
        record.stage = "interrupt_requested"
        record.task.cancel(USER_INTERRUPT_CANCEL_MESSAGE)
        return InterruptOutcome(
            InterruptStatus.ACCEPTED,
            normalized_run_id,
            record.conversation_id,
        )


def set_active_turn_stage(
    run_id: str,
    *,
    stage: str,
    steerable: bool,
) -> ActiveTurnSnapshot | None:
    """Atomically publish whether one active run currently accepts additions."""

    normalized_stage = str(stage or "").strip()[:64] or "unknown"
    with _ACTIVE_TURNS_LOCK:
        record = _ACTIVE_TURNS.get(str(run_id or ""))
        if record is None or record.task.done():
            if record is not None:
                del _ACTIVE_TURNS[record.run_id]
            return None
        record.stage = normalized_stage
        record.steerable = bool(steerable) and not record.interrupt_requested
        return _snapshot(record)


def submit_active_turn_steering(
    run_id: str,
    *,
    expected_run_id: str,
    conversation_id: int,
    content: str,
    message_id: int | None = None,
) -> SteeringOutcome:
    """Append text to the exact active run, or reject without rerouting it."""

    normalized_run_id = str(run_id or "").strip()
    normalized_expected = str(expected_run_id or "").strip()
    normalized_content = str(content or "").strip()
    if normalized_expected != normalized_run_id:
        return SteeringOutcome(
            SteeringStatus.EXPECTED_RUN_MISMATCH,
            normalized_run_id,
        )
    if not normalized_content:
        return SteeringOutcome(SteeringStatus.EMPTY_INPUT, normalized_run_id)
    if len(normalized_content) > MAX_STEERING_INPUT_CHARS:
        return SteeringOutcome(SteeringStatus.INPUT_TOO_LARGE, normalized_run_id)

    with _ACTIVE_TURNS_LOCK:
        record = _ACTIVE_TURNS.get(normalized_run_id)
        if record is None:
            return SteeringOutcome(SteeringStatus.NOT_FOUND, normalized_run_id)
        if record.task.done():
            del _ACTIVE_TURNS[record.run_id]
            return SteeringOutcome(SteeringStatus.NOT_FOUND, normalized_run_id)
        if record.conversation_id != int(conversation_id):
            return SteeringOutcome(
                SteeringStatus.CONVERSATION_MISMATCH,
                normalized_run_id,
                record.conversation_id,
            )
        if record.interrupt_requested:
            return SteeringOutcome(
                SteeringStatus.INTERRUPT_REQUESTED,
                normalized_run_id,
                record.conversation_id,
            )
        if not record.steerable:
            return SteeringOutcome(
                SteeringStatus.NOT_STEERABLE,
                normalized_run_id,
                record.conversation_id,
            )
        if len(record.pending_steering) >= MAX_PENDING_STEERING_INPUTS:
            return SteeringOutcome(
                SteeringStatus.QUEUE_FULL,
                normalized_run_id,
                record.conversation_id,
            )

        record.steering_sequence += 1
        steering = SteeringInput(
            steering_id=f"steer_{uuid4().hex}",
            run_id=record.run_id,
            conversation_id=record.conversation_id,
            sequence=record.steering_sequence,
            content=normalized_content,
            content_sha256=hashlib.sha256(normalized_content.encode("utf-8")).hexdigest(),
            accepted_monotonic=time.monotonic(),
            message_id=int(message_id) if message_id is not None else None,
        )
        record.pending_steering.append(steering)
        return SteeringOutcome(
            SteeringStatus.ACCEPTED,
            normalized_run_id,
            record.conversation_id,
            steering,
        )


def retract_active_turn_steering(run_id: str, steering_id: str) -> bool:
    """Remove an accepted item when the surrounding database commit fails."""

    with _ACTIVE_TURNS_LOCK:
        record = _ACTIVE_TURNS.get(str(run_id or ""))
        if record is None:
            return False
        before = len(record.pending_steering)
        record.pending_steering = [
            item for item in record.pending_steering if item.steering_id != steering_id
        ]
        return len(record.pending_steering) != before


def drain_active_turn_steering(
    run_id: str,
    *,
    conversation_id: int,
) -> tuple[SteeringInput, ...]:
    """Drain accepted additions in submission order at an Agent Loop boundary."""

    with _ACTIVE_TURNS_LOCK:
        record = _ACTIVE_TURNS.get(str(run_id or ""))
        if (
            record is None
            or record.task.done()
            or record.conversation_id != int(conversation_id)
        ):
            return ()
        pending = tuple(record.pending_steering)
        record.pending_steering.clear()
        return pending


def cancellation_reason(exc: asyncio.CancelledError) -> str:
    """Classify explicit user interrupts separately from transport shutdown."""

    return (
        "user_interrupted"
        if USER_INTERRUPT_CANCEL_MESSAGE in {str(arg) for arg in exc.args}
        else "stream_cancelled"
    )


def interrupted_reply(
    partial_text: str,
    *,
    tool_execution_possible: bool,
    reason: str = "user_interrupted",
) -> str:
    """Build a durable, model-visible interrupted-turn marker for Aria history."""

    notice = (
        "本轮已由用户停止。"
        if reason == "user_interrupted"
        else "本轮流式连接已中断。"
    )
    if tool_execution_possible:
        notice += "停止时工具可能正在执行或已经部分完成；再次操作前，请先检查项目中的实际结果。"
    cleaned = str(partial_text or "").strip()
    return f"{cleaned}\n\n（{notice}）" if cleaned else f"（{notice}）"


def _snapshot(record: _ActiveTurn) -> ActiveTurnSnapshot:
    return ActiveTurnSnapshot(
        run_id=record.run_id,
        conversation_id=record.conversation_id,
        started_monotonic=record.started_monotonic,
        interrupt_requested=record.interrupt_requested,
        stage=record.stage,
        steerable=record.steerable,
        pending_steering_count=len(record.pending_steering),
        accepted_steering_count=record.steering_sequence,
    )
