"""Process-local interruption control for active Aria chat turns.

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
"""
from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import dataclass
from enum import Enum

USER_INTERRUPT_CANCEL_MESSAGE = "aria_user_interrupted"


class InterruptStatus(str, Enum):
    ACCEPTED = "accepted"
    NOT_FOUND = "not_found"
    CONVERSATION_MISMATCH = "conversation_mismatch"
    ALREADY_FINISHED = "already_finished"


@dataclass(frozen=True)
class ActiveTurnSnapshot:
    run_id: str
    conversation_id: int
    started_monotonic: float
    interrupt_requested: bool


@dataclass(frozen=True)
class InterruptOutcome:
    status: InterruptStatus
    run_id: str
    conversation_id: int | None = None

    @property
    def accepted(self) -> bool:
        return self.status is InterruptStatus.ACCEPTED


@dataclass
class _ActiveTurn:
    run_id: str
    conversation_id: int
    task: asyncio.Task
    started_monotonic: float
    interrupt_requested: bool = False


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
        record.task.cancel(USER_INTERRUPT_CANCEL_MESSAGE)
        return InterruptOutcome(
            InterruptStatus.ACCEPTED,
            normalized_run_id,
            record.conversation_id,
        )


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
    )
