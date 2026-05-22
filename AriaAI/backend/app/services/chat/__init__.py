"""Chat streaming service — SSE orchestration engine.

The monolithic ``chat_streaming.py`` has been refactored into a focused package:

* ``runtime`` — ``ChatRuntime`` dataclass + ``prepare_chat_runtime``
* ``state`` — ``ChatSessionState`` (mutable cross-phase state)
* ``sse`` — SSE formatting, heartbeats, stream helpers
* ``truncation`` — ``[OUTPUT_TRUNCATED]`` detection
* ``workflow`` — workflow status builders & task-event normalizers
* ``tool_repair`` — office-document input repair, JSON extraction
* ``phases/`` — P0 (durable task), P1 (planning), P2 (tools), P3 (follow-up), P4 (persist)

Public API (unchanged signatures for backward compatibility):

.. code-block:: python

    from app.services.chat import prepare_chat_runtime, stream_chat_events
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator

from sqlmodel import Session

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_store import get_recent_message_history
from app.services.chat_tools import ChatRuntime, _to_user_friendly_error
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event

logger = logging.getLogger(__name__)


def _confirmed_tool_replay_block(bind, conv_id: int, confirmations: list[str]) -> dict | None:
    confirmation_set = set(confirmations or [])
    if not confirmation_set:
        return None
    with Session(bind) as session:
        history = get_recent_message_history(session, conv_id, limit=12)
    for message in reversed(history):
        if getattr(message, "role", "") != "assistant":
            continue
        try:
            metadata = json.loads(getattr(message, "metadata_json", "") or "{}")
        except json.JSONDecodeError:
            metadata = {}
        pending_items = metadata.get("pending_tool_confirmations") or []
        if not isinstance(pending_items, list):
            continue
        for item in pending_items:
            if not isinstance(item, dict):
                continue
            token = str(item.get("confirmation_token") or "")
            tool_name = str(item.get("tool_name") or "")
            tool_input = item.get("tool_input")
            if token in confirmation_set and tool_name and isinstance(tool_input, dict):
                return {
                    "type": "tool_use",
                    "id": str(item.get("tool_use_id") or f"confirmed-{token[-12:]}"),
                    "name": tool_name,
                    "input": tool_input,
                }
    return None


def prepare_chat_runtime(*args, **kwargs):
    from app.services.chat.runtime import prepare_chat_runtime as _prepare_chat_runtime

    return _prepare_chat_runtime(*args, **kwargs)


async def prepare_chat_runtime_async(*args, **kwargs):
    from app.services.chat.runtime import prepare_chat_runtime_async as _prepare_chat_runtime_async

    return await _prepare_chat_runtime_async(*args, **kwargs)


async def stream_chat_events(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
) -> AsyncIterator[str]:
    """Main SSE event generator.

    Orchestrates the chat flow through phases P0 → P1 → P2 → P3 → P4.
    Each phase is an async generator that yields SSE-formatted strings.
    Mutable state is carried in a single ``ChatSessionState`` instance.

    The function signature is **100 % backward-compatible** with the old
    monolithic ``chat_streaming.py`` implementation.
    """
    from app.services.chat.phases import (
        run_p0_durable_task,
        run_p1_planning,
        run_p2_tools,
        run_p3_followup,
        run_p4_persist,
    )

    stream_started_at = time.perf_counter()
    state = ChatSessionState(stage_timings=dict(runtime.prepare_metrics or {}))
    confirmed_replay_block = _confirmed_tool_replay_block(bind, runtime.conv_id, req.action_confirmations)

    # ------------------------------------------------------------------
    # Emit conversation_id and prepare metrics upfront
    # ------------------------------------------------------------------
    yield sse_event({"type": "conversation_id", "id": runtime.conv_id})

    if runtime.rag_sources:
        yield sse_event({"type": "references", "references": runtime.rag_sources})

    for metric_key in (
        "conversation_ready_ms",
        "user_message_saved_ms",
        "context_loaded_ms",
        "history_loaded_ms",
        "model_ready_ms",
        "prepare_total_ms",
    ):
        if metric_key in state.stage_timings:
            yield sse_event(
                {
                    "type": "timing",
                    "key": metric_key,
                    "duration_ms": state.stage_timings[metric_key],
                }
            )

    # ==================================================================
    # P0 — Durable task early-return
    # ==================================================================
    try:
        async for event in run_p0_durable_task(runtime, req, bind, state):
            yield event
    except Exception as exc:
        logger.error(f"[P0 durable_task error] {exc}", exc_info=True)
        yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        return

    if state.durable_task_completed:
        # Fix total_stream_ms that was left as 0 in P0
        state.stage_timings["total_stream_ms"] = round((time.perf_counter() - stream_started_at) * 1000)
        yield sse_event(
            {
                "type": "timing",
                "key": "total_stream_ms",
                "duration_ms": state.stage_timings["total_stream_ms"],
            }
        )
        return

    if confirmed_replay_block:
        state.workflow_started = True
        state.tool_use_blocks = [confirmed_replay_block]
        state.record_trace_event(
            "tool_confirmation_replay",
            stage="p0",
            tool_name=confirmed_replay_block["name"],
            source="pending_tool_confirmation",
        )
        try:
            async for event in run_p2_tools(runtime, req, state):
                yield event
        except Exception as exc:
            logger.error(f"[P2 confirmed replay error] {exc}", exc_info=True)
            yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
            return
        state.full_text = state.text_buffer.strip()
        try:
            async for event in run_p4_persist(runtime, req, bind, state):
                yield event
        except Exception as exc:
            logger.error(f"[P4 persist error] {exc}", exc_info=True)
            yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        return

    # ==================================================================
    # P1 — Planning / initial LLM stream
    # ==================================================================
    try:
        async for event in run_p1_planning(runtime, req, state):
            yield event
    except Exception as exc:
        logger.error(f"[P1 planning error] {exc}", exc_info=True)
        yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        return

    # ==================================================================
    # P2 — Tool execution
    # ==================================================================
    if state.tool_use_blocks:
        try:
            async for event in run_p2_tools(runtime, req, state):
                yield event
        except Exception as exc:
            logger.error(f"[P2 tools error] {exc}", exc_info=True)
            yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
            return

    if state.confirmation_requested:
        state.full_text = state.text_buffer.strip()
        try:
            async for event in run_p4_persist(runtime, req, bind, state):
                yield event
        except Exception as exc:
            logger.error(f"[P4 persist error] {exc}", exc_info=True)
            yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        return

    # ==================================================================
    # P3 — Follow-up / final reply
    # =================================================================
    if state.tool_use_blocks and state.tool_result_blocks:
        try:
            async for event in run_p3_followup(runtime, req, state):
                yield event
        except Exception as exc:
            logger.error(f"[P3 follow-up error] {exc}", exc_info=True)
            yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
            return

    state.full_text = state.text_buffer.strip()
    if state.follow_up_text.strip():
        state.full_text = (state.full_text + "\n\n" + state.follow_up_text.strip()).strip()

    # ==================================================================
    # P4 — Persistence & finalization
    # ==================================================================
    try:
        async for event in run_p4_persist(runtime, req, bind, state):
            yield event
    except Exception as exc:
        logger.error(f"[P4 persist error] {exc}", exc_info=True)
        yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        return
