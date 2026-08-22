"""Chat streaming service — SSE orchestration engine.

Replaces the legacy P1 → P2 → P3 cascade with a unified agent loop that
streams the LLM, executes any tool_use blocks emitted, feeds the results
back, and repeats. Pre- and post-loop hooks remain:

* ``durable_task``  — long-running project tasks routed before the loop
* ``agent_loop``    — the main streaming + tool-execution loop
* ``persist``       — final-text assembly, artifact persistence, HITAS
  pending-action storage, message persist

Supporting modules:

* ``runtime``        — ``ChatRuntime`` dataclass + ``prepare_chat_runtime``
* ``state``          — ``ChatSessionState`` (mutable shared run state)
* ``sse``            — SSE formatting, heartbeats, stream helpers
* ``truncation``     — ``[OUTPUT_TRUNCATED]`` detection
* ``workflow``       — workflow status builders & task-event normalizers
* ``tool_repair``    — office-document input repair, JSON extraction
* ``tool_executor``  — unified tool routing, repair, policy, retry, validation
* ``agent_step``     — ``AgentStep`` dataclass and serializers

Public API:

.. code-block:: python

    from app.services.chat import prepare_chat_runtime, stream_chat_events
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_tools import ChatRuntime, _to_user_friendly_error
from app.services.chat_store import persist_assistant_message
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event
from app.services.chat.product_run_events import (
    ErrorCode,
    RunFinalStatus,
    make_run_id,
    run_done,
    run_failed,
    run_started,
)
from app.services.agent_harness.run_rollout import (
    begin_chat_rollout,
    build_in_memory_rollout_snapshot,
    checkpoint_chat_rollout,
    finalize_chat_rollout,
)
from app.services.agent_harness.turn_interrupt import (
    cancellation_reason,
    get_active_turn,
    interrupted_reply,
    register_active_turn,
    unregister_active_turn,
)

logger = logging.getLogger(__name__)


def _safe_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _last_step_retryable(state: ChatSessionState) -> bool:
    if not state.steps:
        return False
    step = state.steps[-1]
    return bool(step.status == "failed" and step.retryable)


def _mark_active_step_failed(state: ChatSessionState, exc: Exception) -> None:
    if not state.steps:
        return
    step = state.steps[-1]
    if step.status not in {"running", ""}:
        return
    step.status = "failed"
    step.error = str(exc)[:500]
    step.retryable = False
    if state.rollout_task_id and state.rollout_bind is not None:
        try:
            checkpoint_chat_rollout(
                state.rollout_bind,
                state.rollout_task_id,
                step,
                state,
            )
        except Exception as checkpoint_exc:
            logger.warning("[rollout] failed to checkpoint phase error: %s", checkpoint_exc)


def _finalize_rollout_safely(
    state: ChatSessionState,
    *,
    status: str,
    message_id: int | None = None,
    phase: str = "",
    error_code: str = "",
    error_message: str = "",
    retryable: bool = False,
) -> None:
    if getattr(state, "rollout_finalized", False):
        return
    if not state.rollout_task_id or state.rollout_bind is None:
        return
    try:
        finalize_chat_rollout(
            state.rollout_bind,
            state.rollout_task_id,
            status=status,
            message_id=message_id,
            phase=phase,
            error_code=error_code,
            error_message=error_message,
            retryable=retryable,
        )
        state.rollout_finalized = True
    except Exception as exc:
        logger.warning("[rollout] failed to finalize chat rollout: %s", exc)
        state.record_trace_event(
            "rollout_finalize_failed",
            stage=phase or "finalize",
            error=str(exc)[:500],
        )


def _mark_active_step_cancelled(state: ChatSessionState, reason: str) -> None:
    if not state.steps:
        return
    step = state.steps[-1]
    if step.status not in {"running", ""}:
        return
    step.status = "cancelled"
    step.error = reason[:500]
    step.retryable = False
    if state.rollout_task_id and state.rollout_bind is not None:
        try:
            checkpoint_chat_rollout(
                state.rollout_bind,
                state.rollout_task_id,
                step,
                state,
            )
        except Exception as exc:
            logger.warning("[rollout] failed to checkpoint interrupted step: %s", exc)


def _persist_interrupted_turn(
    *,
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
    reason: str,
) -> None:
    """Persist partial output and a terminal cancellation boundary.

    This is deliberately synchronous: it also runs when Starlette closes the
    async generator while its response task is being cancelled.
    """

    if state.assistant_message_id is not None:
        _finalize_rollout_safely(
            state,
            status="waiting_confirmation" if state.confirmation_requested else "completed",
            message_id=state.assistant_message_id,
            phase="persisted_before_interrupt",
        )
        return

    _mark_active_step_cancelled(state, reason)
    partial_text = state.full_text
    tool_execution_possible = bool(state.workflow_started or state.tool_call_events)
    full_text = interrupted_reply(
        partial_text,
        tool_execution_possible=tool_execution_possible,
        reason=reason,
    )
    state.full_text = full_text
    state.stage_timings["total_stream_ms"] = round(
        (time.perf_counter() - state.stream_started_at) * 1000
    )
    state.record_trace_event(
        "turn_interrupted",
        stage="stream",
        reason=reason,
        tool_execution_possible=tool_execution_possible,
    )
    metadata = {
        "project_id": req.project_id,
        "turn_interrupted": {
            "reason": reason,
            "phase": "stream",
            "tool_execution_possible": tool_execution_possible,
            "partial_text_chars": len(partial_text),
        },
        "stage_timings": dict(state.stage_timings or {}),
        "tool_calls": _safe_list(state.tool_call_events),
        "artifacts": _safe_list(state.artifacts),
        "run_rollout": build_in_memory_rollout_snapshot(
            state,
            status="cancelled",
            phase="stream",
            error_message=reason,
        ),
    }
    if getattr(runtime, "rag_sources", None):
        metadata["references"] = runtime.rag_sources

    try:
        _, assistant_message_id = persist_assistant_message(
            bind,
            runtime.conv_id,
            full_text,
            req.content,
            metadata,
        )
        state.assistant_message_id = assistant_message_id
    except Exception as exc:
        logger.error("[chat interrupt persist failed] %s", exc, exc_info=True)
        _finalize_rollout_safely(
            state,
            status="cancelled",
            phase="stream",
            error_code="INTERRUPT_PERSISTENCE_ERROR",
            error_message=str(exc),
            retryable=False,
        )
        return

    _finalize_rollout_safely(
        state,
        status="cancelled",
        message_id=assistant_message_id,
        phase="stream",
        error_code="USER_INTERRUPTED" if reason == "user_interrupted" else "STREAM_CANCELLED",
        error_message=reason,
        retryable=False,
    )
    logger.info(
        "[run cancelled] run_id=%s conv=%s reason=%s message_id=%s partial_chars=%s tool_execution_possible=%s",
        state.run_id,
        runtime.conv_id,
        reason,
        assistant_message_id,
        len(partial_text),
        tool_execution_possible,
    )


def _persist_phase_error_events(
    *,
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
    phase: str,
    exc: Exception,
) -> list[str]:
    """Persist phase failures so refresh/deep-link does not erase the failed turn."""
    _mark_active_step_failed(state, exc)
    friendly = _to_user_friendly_error(str(exc))
    full_text = (
        f"这个对话步骤在 {phase} 阶段遇到问题，本轮没有完成。\n\n"
        f"错误信息：{friendly}\n\n"
        "我已经保存这次失败状态，刷新或重新打开链接后仍可看到原因。"
    )
    metadata = {
        "project_id": req.project_id,
        "phase_error": {
            "phase": phase,
            "type": exc.__class__.__name__,
            "message": str(exc)[:800],
            "friendly_message": friendly,
        },
        "delivery_failed": True,
        "stage_timings": dict(state.stage_timings or {}),
        "tool_calls": _safe_list(getattr(state, "tool_call_events", None)),
        "artifacts": _safe_list(getattr(state, "artifacts", None)),
        "run_rollout": build_in_memory_rollout_snapshot(
            state,
            status="failed",
            phase=phase,
            error_message=str(exc),
        ),
    }
    if runtime.rag_sources:
        metadata["references"] = runtime.rag_sources

    try:
        _, assistant_message_id = persist_assistant_message(
            bind,
            runtime.conv_id,
            full_text,
            req.content,
            metadata,
        )
    except Exception as persist_exc:
        logger.error("[chat phase error persist failed] %s", persist_exc, exc_info=True)
        _finalize_rollout_safely(
            state,
            status="failed",
            phase=phase,
            error_code=ErrorCode.PERSISTENCE_ERROR,
            error_message=str(persist_exc),
            retryable=False,
        )
        events: list[str] = []
        if state.run_id:
            events.append(
                sse_event(
                    run_failed(
                        state.run_id,
                        ErrorCode.PERSISTENCE_ERROR,
                        friendly,
                        retryable=True,
                    )
                )
            )
        events.append(sse_event({"type": "error", "message": friendly}))
        return events

    state.assistant_message_id = assistant_message_id
    _finalize_rollout_safely(
        state,
        status="failed",
        message_id=assistant_message_id,
        phase=phase,
        error_code=ErrorCode.UNKNOWN,
        error_message=str(exc),
        retryable=_last_step_retryable(state),
    )

    events_list: list[str] = []
    if state.run_id:
        events_list.append(
            sse_event(
                run_failed(
                    state.run_id,
                    ErrorCode.UNKNOWN,
                    friendly,
                    retryable=True,
                    fallback_content=full_text,
                )
            )
        )
    events_list.extend(
        [
            sse_event({"type": "text", "content": full_text}),
            sse_event(
                {
                    "type": "done",
                    "metadata": metadata,
                    "assistant_message_id": assistant_message_id,
                }
            ),
        ]
    )
    return events_list


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

    Drives ``durable_task`` (long-running task pre-loop) → ``agent_loop``
    (streaming + tool execution) → ``persist`` (artifact persistence,
    HITAS pending-action storage, message persist).

    The function signature is identical to the legacy monolithic
    ``chat_streaming.py`` API — routers and tests do not need to change.
    """
    stream_started_at = time.perf_counter()
    state = ChatSessionState(stage_timings=dict(runtime.prepare_metrics or {}))
    state.run_id = make_run_id()
    state.rollout_bind = bind
    try:
        state.rollout_task_id = begin_chat_rollout(
            bind,
            runtime,
            req.content,
            state.run_id,
        )
    except Exception as exc:
        logger.warning("[rollout] failed to begin chat rollout: %s", exc)
        state.record_trace_event(
            "rollout_start_failed",
            stage="run_start",
            error=str(exc)[:500],
        )
    # Stamp the stream start time so persist can compute total_stream_ms
    # against the actual stream start, not against persist's own start.
    # The local ``stream_started_at`` above is still used by the
    # durable-task early-exit path below.
    state.stream_started_at = stream_started_at

    active_task = asyncio.current_task()
    registered = False
    try:
        register_active_turn(
            state.run_id,
            runtime.conv_id,
            task=active_task,
        )
        registered = True
    except Exception as exc:
        logger.error("[run registry] failed to register run_id=%s: %s", state.run_id, exc)
        state.record_trace_event(
            "active_turn_registration_failed",
            stage="run_start",
            error=str(exc)[:500],
        )

    completed = False
    caught_reason = ""
    try:
        async for event in _stream_chat_events_impl(
            runtime,
            req,
            bind,
            state,
            stream_started_at,
        ):
            yield event
        completed = True
    except asyncio.CancelledError as exc:
        caught_reason = cancellation_reason(exc)
        if caught_reason == "user_interrupted":
            _persist_interrupted_turn(
                runtime=runtime,
                req=req,
                bind=bind,
                state=state,
                reason=caught_reason,
            )
            completed = True
            yield sse_event(
                run_done(
                    state.run_id,
                    RunFinalStatus.CANCELLED,
                    message_id=state.assistant_message_id,
                )
            )
            return
        raise
    finally:
        active_snapshot = get_active_turn(state.run_id) if registered else None
        if not completed and not state.rollout_finalized:
            reason = caught_reason or (
                "user_interrupted"
                if active_snapshot is not None and active_snapshot.interrupt_requested
                else "stream_cancelled"
            )
            _persist_interrupted_turn(
                runtime=runtime,
                req=req,
                bind=bind,
                state=state,
                reason=reason,
            )
        if registered:
            unregister_active_turn(state.run_id, task=active_task)


async def _stream_chat_events_impl(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
    stream_started_at: float,
) -> AsyncIterator[str]:
    from app.services.chat.agent_loop import run_agent_loop
    from app.services.chat.durable_task import run_durable_task
    from app.services.chat.persist import run_persist

    # V0.0.4 D.3: structured run-lifecycle log. Stays human-readable; easy to
    # grep / pipe into JSON later. Emitted at run start, persist success, and
    # in every error path so we can correlate runs to failures by run_id.
    logger.info(
        "[run start] run_id=%s conv=%s project=%s mode=%s policy=%s skill=%s model=%s",
        state.run_id,
        runtime.conv_id,
        getattr(req, "project_id", None),
        getattr(runtime, "chat_mode", ""),
        getattr(runtime, "action_policy", ""),
        getattr(runtime, "skill_name", "") or "-",
        getattr(runtime, "selected_model", ""),
    )

    # ------------------------------------------------------------------
    # Emit conversation_id, run_started (Product Run Event v1), and prepare
    # metrics upfront. run_started is additive — legacy frontends ignore it.
    # ------------------------------------------------------------------
    yield sse_event({"type": "conversation_id", "id": runtime.conv_id})

    _run_started_skill = None
    if getattr(runtime, "skill_name", "") or getattr(runtime, "skill_id", None):
        _run_started_skill = {"name": runtime.skill_name or ""}
        if getattr(runtime, "skill_id", None):
            _run_started_skill["id"] = str(runtime.skill_id)
        if not _run_started_skill["name"]:
            _run_started_skill = None  # name is required by the builder
    yield sse_event(run_started(state.run_id, skill=_run_started_skill))

    if runtime.rag_sources:
        yield sse_event({"type": "references", "references": runtime.rag_sources})

    # Capability frame — emits the policy/tool snapshot the runtime
    # decided on. The frontend can render a dev pill ("能力·
    # WRITE_ALLOWED · explicit_write") from this; researchers grep
    # the matching server log line ([capability]) when debugging why
    # a turn lost a tool. Strictly additive: old clients ignore the
    # unknown event type.
    _capability_tool_names = [
        str(tool.get("name") or "")
        for tool in (runtime.tools or [])
        if tool and tool.get("name")
    ]
    _capability_payload = {
        "type": "capability",
        "action_policy": str(runtime.action_policy or ""),
        "tool_access_policy": str(runtime.tool_access_policy or ""),
        "intent_reason": str(runtime.intent_reason or ""),
        "intent_method": str(runtime.intent_method or ""),
        "tools_granted": _capability_tool_names,
        "tools_granted_count": len(_capability_tool_names),
        "chat_mode": str(runtime.chat_mode or ""),
    }
    _prepare_metrics = runtime.prepare_metrics if isinstance(runtime.prepare_metrics, dict) else {}
    if isinstance(_prepare_metrics.get("turn_contract"), dict):
        _capability_payload["turn_contract"] = _prepare_metrics["turn_contract"]
    logger.info(
        "[capability] run_id=%s action_policy=%s tool_access=%s "
        "intent_reason=%s intent_method=%s tools_granted=%d chat_mode=%s",
        state.run_id,
        _capability_payload["action_policy"],
        _capability_payload["tool_access_policy"],
        _capability_payload["intent_reason"],
        _capability_payload["intent_method"],
        _capability_payload["tools_granted_count"],
        _capability_payload["chat_mode"],
    )
    yield sse_event(_capability_payload)

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
    # Durable task — early return for long-running project work
    # ==================================================================
    try:
        async for event in run_durable_task(runtime, req, bind, state):
            yield event
    except Exception as exc:
        logger.error(
            "[run failed] run_id=%s phase=durable_task exc_type=%s exc=%s",
            state.run_id, exc.__class__.__name__, exc,
            exc_info=True,
        )
        for event in _persist_phase_error_events(
            runtime=runtime,
            req=req,
            bind=bind,
            state=state,
            phase="durable_task",
            exc=exc,
        ):
            yield event
        return

    if state.durable_task_completed:
        state.stage_timings["total_stream_ms"] = round((time.perf_counter() - stream_started_at) * 1000)
        yield sse_event(
            {
                "type": "timing",
                "key": "total_stream_ms",
                "duration_ms": state.stage_timings["total_stream_ms"],
            }
        )
        yield sse_event(run_done(state.run_id, RunFinalStatus.COMPLETED))
        _finalize_rollout_safely(
            state,
            status="completed",
            message_id=state.assistant_message_id,
            phase="durable_task",
        )
        logger.info(
            "[run done] run_id=%s path=durable_task duration_ms=%s artifacts=%s tool_events=%s",
            state.run_id,
            state.stage_timings.get("total_stream_ms"),
            len(state.artifacts or []),
            len(state.tool_call_events or []),
        )
        return

    # ==================================================================
    # Agent loop — streaming + tool execution
    # ==================================================================
    try:
        async for event in run_agent_loop(runtime, req, state):
            yield event
    except Exception as exc:
        logger.error(
            "[run failed] run_id=%s phase=agent_loop exc_type=%s exc=%s",
            state.run_id, exc.__class__.__name__, exc,
            exc_info=True,
        )
        for event in _persist_phase_error_events(
            runtime=runtime,
            req=req,
            bind=bind,
            state=state,
            phase="agent_loop",
            exc=exc,
        ):
            yield event
        return

    # ==================================================================
    # Persist — final-text assembly, artifact persistence, HITAS, message
    # ==================================================================
    try:
        async for event in run_persist(runtime, req, bind, state):
            yield event
    except Exception as exc:
        logger.error(
            "[run failed] run_id=%s phase=persist exc_type=%s exc=%s",
            state.run_id, exc.__class__.__name__, exc,
            exc_info=True,
        )
        for event in _persist_phase_error_events(
            runtime=runtime,
            req=req,
            bind=bind,
            state=state,
            phase="persist",
            exc=exc,
        ):
            yield event
        return

    # Successful end-of-run terminator (Product Run Event v1).
    _finalize_rollout_safely(
        state,
        status="waiting_confirmation" if state.confirmation_requested else "completed",
        message_id=state.assistant_message_id,
        phase="persist",
    )
    yield sse_event(run_done(state.run_id, RunFinalStatus.COMPLETED))
    logger.info(
        "[run done] run_id=%s path=agent_loop duration_ms=%s steps=%s artifacts=%s tool_events=%s",
        state.run_id,
        state.stage_timings.get("total_stream_ms")
        or round((time.perf_counter() - stream_started_at) * 1000),
        len(state.steps or []),
        len(state.artifacts or []),
        len(state.tool_call_events or []),
    )
