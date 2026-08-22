"""Per-turn execution budgets for the Aria Agent Harness.

The monotonic accounting and centralized stop-boundary design are adapted
from OpenAI Codex's ``codex-rs/ext/goal/src/accounting.rs``,
``codex-rs/ext/goal/src/runtime.rs``, and
``codex-rs/core/src/tools/orchestrator.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: translated to Python, scoped to one chat
turn, extended with atomic planned-tool reservations and async deadline
wrappers, and integrated with Aria's persisted rollout/event model. No Codex
process, protocol, account, or model API is used.
"""
from __future__ import annotations

import asyncio
import contextlib
import math
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any, TypeVar


MIN_TURN_STEPS = 1
MAX_TURN_STEPS = 16
MIN_TURN_TOOL_CALLS = 1
MAX_TURN_TOOL_CALLS = 64
MIN_TURN_ELAPSED_SECONDS = 30.0
MAX_TURN_ELAPSED_SECONDS = 1_800.0

_T = TypeVar("_T")


class BudgetKind(str, Enum):
    STEP_LIMIT = "step_limit"
    TOOL_CALL_LIMIT = "tool_call_limit"
    DEADLINE = "deadline"


@dataclass(frozen=True)
class TurnBudgetLimits:
    max_steps: int
    max_tool_calls: int
    max_elapsed_seconds: float


def _bounded_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _bounded_float(
    value: Any,
    *,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        parsed = default
    if not math.isfinite(parsed):
        parsed = default
    return max(minimum, min(maximum, parsed))


def normalize_turn_budget_limits(
    *,
    max_steps: Any = 8,
    max_tool_calls: Any = 24,
    max_elapsed_seconds: Any = 600.0,
) -> TurnBudgetLimits:
    """Parse environment/runtime values and apply hard safety clamps."""

    return TurnBudgetLimits(
        max_steps=_bounded_int(
            max_steps,
            default=8,
            minimum=MIN_TURN_STEPS,
            maximum=MAX_TURN_STEPS,
        ),
        max_tool_calls=_bounded_int(
            max_tool_calls,
            default=24,
            minimum=MIN_TURN_TOOL_CALLS,
            maximum=MAX_TURN_TOOL_CALLS,
        ),
        max_elapsed_seconds=_bounded_float(
            max_elapsed_seconds,
            default=600.0,
            minimum=MIN_TURN_ELAPSED_SECONDS,
            maximum=MAX_TURN_ELAPSED_SECONDS,
        ),
    )


class TurnBudgetExceeded(RuntimeError):
    """Terminal boundary raised when a turn cannot safely continue."""

    def __init__(
        self,
        *,
        kind: BudgetKind,
        phase: str,
        limit: int | float,
        used: int | float,
        tool_execution_possible: bool = False,
    ) -> None:
        self.kind = kind
        self.phase = phase
        self.limit = limit
        self.used = used
        self.tool_execution_possible = tool_execution_possible
        super().__init__(
            f"turn budget exceeded: kind={kind.value} phase={phase} "
            f"used={used} limit={limit}"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind.value,
            "phase": self.phase,
            "limit": self.limit,
            "used": self.used,
            "tool_execution_possible": self.tool_execution_possible,
        }


class TurnBudgetLedger:
    """Monotonic, process-local accounting for exactly one chat turn."""

    def __init__(
        self,
        limits: TurnBudgetLimits,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if limits.max_steps < 1 or limits.max_tool_calls < 1:
            raise ValueError("turn budget counts must be positive")
        if not math.isfinite(limits.max_elapsed_seconds) or limits.max_elapsed_seconds <= 0:
            raise ValueError("turn budget elapsed seconds must be finite and positive")
        self.limits = limits
        self._clock = clock
        self._started_at = clock()
        self.steps_started = 0
        self.tool_calls_reserved = 0

    @property
    def elapsed_seconds(self) -> float:
        return max(0.0, self._clock() - self._started_at)

    @property
    def remaining_seconds(self) -> float:
        return max(0.0, self.limits.max_elapsed_seconds - self.elapsed_seconds)

    def _exceeded(
        self,
        kind: BudgetKind,
        *,
        phase: str,
        limit: int | float,
        used: int | float,
        tool_execution_possible: bool = False,
    ) -> TurnBudgetExceeded:
        return TurnBudgetExceeded(
            kind=kind,
            phase=phase,
            limit=limit,
            used=used,
            tool_execution_possible=tool_execution_possible,
        )

    def check_deadline(
        self,
        *,
        phase: str,
        tool_execution_possible: bool = False,
    ) -> None:
        elapsed = self.elapsed_seconds
        if elapsed >= self.limits.max_elapsed_seconds:
            raise self._exceeded(
                BudgetKind.DEADLINE,
                phase=phase,
                limit=self.limits.max_elapsed_seconds,
                used=round(elapsed, 3),
                tool_execution_possible=tool_execution_possible,
            )

    def start_step(self, *, phase: str) -> None:
        self.check_deadline(phase=phase)
        if self.steps_started >= self.limits.max_steps:
            raise self.step_limit_exceeded(phase=phase)
        self.steps_started += 1

    def step_limit_exceeded(self, *, phase: str) -> TurnBudgetExceeded:
        return self._exceeded(
            BudgetKind.STEP_LIMIT,
            phase=phase,
            limit=self.limits.max_steps,
            used=self.steps_started,
        )

    def reserve_tool_calls(self, count: int, *, phase: str) -> None:
        """Atomically reserve a model-planned batch before any call executes."""

        self.check_deadline(phase=phase)
        if count < 0:
            raise ValueError("tool call reservation cannot be negative")
        proposed = self.tool_calls_reserved + count
        if proposed > self.limits.max_tool_calls:
            raise self._exceeded(
                BudgetKind.TOOL_CALL_LIMIT,
                phase=phase,
                limit=self.limits.max_tool_calls,
                used=proposed,
            )
        self.tool_calls_reserved = proposed

    def deadline_exceeded(
        self,
        *,
        phase: str,
        tool_execution_possible: bool = False,
    ) -> TurnBudgetExceeded:
        return self._exceeded(
            BudgetKind.DEADLINE,
            phase=phase,
            limit=self.limits.max_elapsed_seconds,
            used=round(max(self.elapsed_seconds, self.limits.max_elapsed_seconds), 3),
            tool_execution_possible=tool_execution_possible,
        )

    def snapshot(self) -> dict[str, Any]:
        elapsed = self.elapsed_seconds
        return {
            "limits": {
                "max_steps": self.limits.max_steps,
                "max_tool_calls": self.limits.max_tool_calls,
                "max_elapsed_seconds": self.limits.max_elapsed_seconds,
            },
            "usage": {
                "steps_started": self.steps_started,
                "tool_calls_reserved": self.tool_calls_reserved,
                "elapsed_seconds": round(elapsed, 3),
                "remaining_seconds": round(
                    max(0.0, self.limits.max_elapsed_seconds - elapsed), 3
                ),
            },
        }


async def await_with_turn_deadline(
    awaitable: Awaitable[_T],
    ledger: TurnBudgetLedger,
    *,
    phase: str,
    tool_execution_possible: bool = False,
) -> _T:
    """Await work only until the shared turn deadline, propagating cancellation."""

    future = asyncio.ensure_future(awaitable)
    remaining = ledger.remaining_seconds
    if remaining <= 0:
        future.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await future
        raise ledger.deadline_exceeded(
            phase=phase,
            tool_execution_possible=tool_execution_possible,
        )

    try:
        done, _ = await asyncio.wait({future}, timeout=remaining)
    except BaseException:
        future.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await future
        raise
    if future in done:
        return future.result()

    future.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await future
    raise ledger.deadline_exceeded(
        phase=phase,
        tool_execution_possible=tool_execution_possible,
    )


async def iter_with_turn_deadline(
    source: AsyncIterator[_T],
    ledger: TurnBudgetLedger,
    *,
    phase: str,
) -> AsyncIterator[_T]:
    """Apply the shared deadline to every wait for the next stream item."""

    iterator = source.__aiter__()
    while True:
        try:
            item = await await_with_turn_deadline(
                iterator.__anext__(),
                ledger,
                phase=phase,
            )
        except StopAsyncIteration:
            return
        yield item
