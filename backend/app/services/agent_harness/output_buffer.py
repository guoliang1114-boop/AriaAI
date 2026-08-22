"""Bound tool output while retaining diagnostically useful context.

Adapted from OpenAI Codex's ``HeadTailBuffer`` implementation:
``codex-rs/core/src/unified_exec/head_tail_buffer.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-22: translated from Rust to Python, made the
capacity runtime-configurable, and added a JSON-safe tool-result envelope.
This module is Aria-native and has no Codex runtime dependency.
"""
from __future__ import annotations

import json
from collections import deque
from typing import Any, Deque, Union

DEFAULT_TOOL_OUTPUT_MAX_BYTES = 64 * 1024


class HeadTailBuffer:
    """A capped byte buffer that keeps a stable prefix and newest suffix."""

    def __init__(self, max_bytes: int = DEFAULT_TOOL_OUTPUT_MAX_BYTES) -> None:
        if max_bytes < 2:
            raise ValueError("max_bytes must be at least 2")
        self.max_bytes = max_bytes
        self.head_budget = max_bytes // 2
        self.tail_budget = max_bytes - self.head_budget
        self._head = bytearray()
        self._tail: Deque[int] = deque()
        self.omitted_bytes = 0

    @property
    def retained_bytes(self) -> int:
        return len(self._head) + len(self._tail)

    @property
    def total_bytes(self) -> int:
        return self.retained_bytes + self.omitted_bytes

    def push_chunk(self, chunk: Union[str, bytes, bytearray]) -> None:
        data = chunk.encode("utf-8") if isinstance(chunk, str) else bytes(chunk)

        remaining_head = max(0, self.head_budget - len(self._head))
        self._head.extend(data[:remaining_head])
        tail_chunk = data[remaining_head:]
        if not tail_chunk:
            return

        remaining_tail = max(0, self.tail_budget - len(self._tail))
        excess_tail = max(0, len(tail_chunk) - remaining_tail)
        self.omitted_bytes += excess_tail

        if excess_tail <= len(self._tail):
            for _ in range(excess_tail):
                self._tail.popleft()
        else:
            skip = excess_tail - len(self._tail)
            self._tail.clear()
            tail_chunk = tail_chunk[skip:]
        self._tail.extend(tail_chunk)

    def to_bytes(self) -> bytes:
        return bytes(self._head) + bytes(self._tail)

    def to_text(self, *, include_omission_marker: bool = True) -> str:
        head = bytes(self._head).decode("utf-8", errors="replace")
        tail = bytes(self._tail).decode("utf-8", errors="replace")
        if not include_omission_marker or self.omitted_bytes == 0:
            return head + tail
        marker = f"[... {self.omitted_bytes} bytes omitted by AriaAI ...]"
        return f"{head}\n{marker}\n{tail}"


def serialize_tool_output(
    payload: Any,
    *,
    max_bytes: int = DEFAULT_TOOL_OUTPUT_MAX_BYTES,
) -> str:
    """Serialize tool output for the next model turn with a bounded preview.

    The full result remains available to Aria's audit, artifact, and frontend
    paths. Only the copy fed back into the model loop is compacted.
    """

    raw = json.dumps(payload, ensure_ascii=False, default=str)
    raw_bytes = raw.encode("utf-8")
    if len(raw_bytes) <= max_bytes:
        return raw

    buffer = HeadTailBuffer(max_bytes=max_bytes)
    buffer.push_chunk(raw_bytes)
    return json.dumps(
        {
            "aria_truncated_tool_output": True,
            "original_bytes": len(raw_bytes),
            "omitted_bytes": buffer.omitted_bytes,
            "preview": buffer.to_text(),
        },
        ensure_ascii=False,
    )
