"""SSE (Server-Sent Events) helpers and stream utilities."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

# Heartbeat interval for "model is still thinking" status events. 2s is short
# enough that a 3–5s blank period during cold-connect / first-token latency
# surfaces ~1–2 visible status pings (so the user doesn't feel "stuck"), and
# still well below the 60s reverse-proxy timeout this guard was originally
# added to defend against.
STREAM_HEARTBEAT_SECONDS = 2.0
STREAM_TASK_EVENT_PAUSE_SECONDS = 0.18


def sse_event(payload: dict) -> str:
    """Format a dict as an SSE event string."""
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


async def task_stream_flush_pause() -> None:
    """Give browsers/proxies a short chance to paint fast task progress events."""
    await asyncio.sleep(STREAM_TASK_EVENT_PAUSE_SECONDS)


async def iter_with_heartbeat(
    source: AsyncIterator[str],
    *,
    stage: str,
    message: str,
    seconds: float = STREAM_HEARTBEAT_SECONDS,
) -> AsyncIterator[str | dict]:
    """Wrap an async text iterator so that a ``{"type": "status"}`` heartbeat
    is yielded if no real item arrives within *seconds*.

    This prevents reverse-proxy timeouts (e.g. Nginx default 60 s) when the
    LLM is "thinking" but not yet emitting tokens.
    """
    iterator = source.__aiter__()
    pending = asyncio.create_task(iterator.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=seconds)
            if not done:
                yield {"type": "status", "stage": stage, "message": message}
                continue
            try:
                yield pending.result()
            except StopAsyncIteration:
                break
            pending = asyncio.create_task(iterator.__anext__())
    finally:
        if not pending.done():
            pending.cancel()
            try:
                await pending
            except (asyncio.CancelledError, StopAsyncIteration):
                pass


async def await_with_heartbeat(
    awaitable,
    *,
    stage: str,
    message: str,
    seconds: float = STREAM_HEARTBEAT_SECONDS,
) -> AsyncIterator[dict]:
    """Wrap an awaitable (e.g. a tool call) with heartbeat status events."""
    task = asyncio.create_task(awaitable)
    try:
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=seconds)
            if not done:
                yield {"type": "status", "stage": stage, "message": message}
        yield {"type": "result", "result": task.result()}
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


# Backward-compatible aliases for the legacy ``chat_streaming`` shim and tests.
_task_stream_flush_pause = task_stream_flush_pause
_iter_with_heartbeat = iter_with_heartbeat
_await_with_heartbeat = await_with_heartbeat
