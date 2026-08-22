"""Deterministic read-parallel / write-serial tool scheduling for AriaAI.

The execution-lane concept is adapted from OpenAI Codex
``codex-rs/core/src/tools/parallel.rs`` and
``codex-rs/core/src/tools/orchestrator.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: Codex's asynchronous read/write lock is
translated into deterministic contiguous batches. Only Aria operations that
are both policy-classified as read-only and explicitly declared
``parallel_safe`` may overlap. Every mutation, approval boundary, unknown tool,
or malformed call is an exclusive ordered barrier. This module does not start,
import, or communicate with a Codex runtime.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Sequence

from app.services.agent_harness.tool_policy import PolicyDecision, evaluate_tool_policy
from app.services.chat.mode_registry import ActionPolicy
from app.services.tool_descriptions import tool_supports_parallel

DEFAULT_MAX_PARALLEL_TOOLS = 4
HARD_MAX_PARALLEL_TOOLS = 8


class ToolExecutionLane(str, Enum):
    PARALLEL_READ = "parallel_read"
    SERIAL = "serial"


@dataclass(frozen=True)
class ToolExecutionBatch:
    lane: ToolExecutionLane
    indexes: tuple[int, ...]

    @property
    def parallel(self) -> bool:
        return self.lane is ToolExecutionLane.PARALLEL_READ and len(self.indexes) > 1


@dataclass(frozen=True)
class ToolExecutionPlan:
    batches: tuple[ToolExecutionBatch, ...]
    call_count: int
    parallel_call_count: int
    serial_call_count: int
    max_parallel: int

    def to_trace_dict(self) -> dict[str, Any]:
        return {
            "batch_count": len(self.batches),
            "call_count": self.call_count,
            "parallel_call_count": self.parallel_call_count,
            "serial_call_count": self.serial_call_count,
            "max_parallel": self.max_parallel,
            "lanes": [batch.lane.value for batch in self.batches],
            "batch_sizes": [len(batch.indexes) for batch in self.batches],
        }


def normalize_max_parallel(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = DEFAULT_MAX_PARALLEL_TOOLS
    return max(1, min(parsed, HARD_MAX_PARALLEL_TOOLS))


def _operation(tool_input: dict[str, Any]) -> str:
    return str(
        tool_input.get("action")
        or tool_input.get("mode")
        or tool_input.get("file_type")
        or tool_input.get("document_type")
        or "default"
    ).strip().lower()


def tool_call_supports_parallel(
    action_policy: ActionPolicy | str,
    tool_call: dict[str, Any],
) -> bool:
    """Return true only for an explicitly safe, currently allowed read."""

    if not isinstance(tool_call, dict):
        return False
    name = str(tool_call.get("name") or "").strip()
    tool_input = tool_call.get("input")
    if not name or not isinstance(tool_input, dict):
        return False
    evaluation = evaluate_tool_policy(action_policy, name, tool_input)
    if evaluation.decision is not PolicyDecision.ALLOW:
        return False
    if evaluation.required_policy is not ActionPolicy.READ_ONLY_TOOL:
        return False
    return tool_supports_parallel(name, _operation(tool_input))


def plan_tool_execution(
    tool_calls: Sequence[dict[str, Any]],
    *,
    action_policy: ActionPolicy | str,
    max_parallel: Any = DEFAULT_MAX_PARALLEL_TOOLS,
) -> ToolExecutionPlan:
    """Partition calls into ordered read batches and exclusive barriers.

    Parallel reads never cross a serial call. Results can therefore be merged
    by original index without changing the model-visible transcript order.
    """

    width = normalize_max_parallel(max_parallel)
    batches: list[ToolExecutionBatch] = []
    pending_reads: list[int] = []

    def flush_reads() -> None:
        nonlocal pending_reads
        while pending_reads:
            indexes = tuple(pending_reads[:width])
            del pending_reads[:width]
            lane = (
                ToolExecutionLane.PARALLEL_READ
                if len(indexes) > 1 and width > 1
                else ToolExecutionLane.SERIAL
            )
            batches.append(ToolExecutionBatch(lane=lane, indexes=indexes))

    for index, tool_call in enumerate(tool_calls):
        if width > 1 and tool_call_supports_parallel(action_policy, tool_call):
            pending_reads.append(index)
            if len(pending_reads) >= width:
                flush_reads()
            continue
        flush_reads()
        batches.append(ToolExecutionBatch(lane=ToolExecutionLane.SERIAL, indexes=(index,)))
    flush_reads()

    parallel_indexes = {
        index
        for batch in batches
        if batch.parallel
        for index in batch.indexes
    }
    return ToolExecutionPlan(
        batches=tuple(batches),
        call_count=len(tool_calls),
        parallel_call_count=len(parallel_indexes),
        serial_call_count=len(tool_calls) - len(parallel_indexes),
        max_parallel=width,
    )
