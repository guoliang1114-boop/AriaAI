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
import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import suppress
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
    activate_prepared_chat_rollout,
    attach_chat_run_assistant_message,
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
    set_active_turn_stage,
    unregister_active_turn,
)
from app.services.agent_harness.durable_run_inputs import (
    finalize_durable_run_inputs,
)
from app.config import CHAT_RUN_HEARTBEAT_SECONDS
from app.services.agent_harness.active_run_lease import (
    CHAT_RUN_LEASE_LOST_CANCEL_MESSAGE,
    ChatRunLeaseError,
    chat_run_lease_from_state,
    heartbeat_chat_run_lease,
    new_chat_run_lease,
)
from app.services.agent_harness.turn_receipt import build_turn_receipt
from app.services.agent_harness.context_receipt import build_context_receipt
from app.services.agent_harness.knowledge_evidence import (
    resolve_runtime_knowledge_evidence,
)
from app.services.agent_harness.project_memory_evidence import (
    resolve_runtime_project_memory_evidence,
)

logger = logging.getLogger(__name__)


def _safe_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _attach_turn_audit_metadata(metadata: dict, runtime: ChatRuntime) -> None:
    prepare_metrics = getattr(runtime, "prepare_metrics", None)
    if not isinstance(prepare_metrics, dict):
        return
    for audit_key in (
        "turn_revision",
        "turn_recovery",
        "project_world_state_change",
    ):
        audit_value = prepare_metrics.get(audit_key)
        if isinstance(audit_value, dict) and audit_value:
            metadata[audit_key] = dict(audit_value)


def _last_step_retryable(state: ChatSessionState) -> bool:
    if not state.steps:
        return False
    step = state.steps[-1]
    return bool(step.status == "failed" and step.retryable)


def _stop_run_lease_heartbeat(state: ChatSessionState) -> None:
    stop = getattr(state, "run_lease_heartbeat_stop", None)
    if stop is not None:
        stop.set()


def _is_database_bind(bind: Any) -> bool:
    """Keep isolated orchestration tests/callers that intentionally use sentinels."""

    return bool(hasattr(bind, "connect") or hasattr(bind, "engine"))


def _renew_run_lease(state: ChatSessionState) -> None:
    """Fence a synchronous persistence boundary to the serving generation."""

    lease = chat_run_lease_from_state(state)
    if (
        lease is None
        or state.rollout_bind is None
        or not _is_database_bind(state.rollout_bind)
        or not state.run_id
    ):
        return
    heartbeat_chat_run_lease(
        state.rollout_bind,
        run_id=state.run_id,
        lease=lease,
    )


async def _maintain_run_lease(
    state: ChatSessionState,
    *,
    owner_task: asyncio.Task,
) -> None:
    stop = state.run_lease_heartbeat_stop
    while stop is not None and not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=CHAT_RUN_HEARTBEAT_SECONDS)
            return
        except asyncio.TimeoutError:
            pass
        if stop.is_set() or state.rollout_finalized:
            return
        try:
            await asyncio.to_thread(_renew_run_lease, state)
        except ChatRunLeaseError as exc:
            state.run_lease_lost = True
            state.record_trace_event(
                "chat_run_lease_lost",
                stage="heartbeat",
                error_code=exc.code,
            )
            logger.error(
                "[run lease] ownership lost run_id=%s code=%s",
                state.run_id,
                exc.code,
            )
            if not owner_task.done():
                owner_task.cancel(CHAT_RUN_LEASE_LOST_CANCEL_MESSAGE)
            return
        except Exception as exc:
            # A transient DB error is retried while the current lease window is
            # still authoritative. Exact phase/final writes independently
            # fence on the same token and fail closed after expiry.
            logger.warning(
                "[run lease] heartbeat failed run_id=%s: %s",
                state.run_id,
                exc,
            )


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
) -> bool:
    if getattr(state, "rollout_finalized", False):
        return True
    if not state.rollout_task_id and state.rollout_bind is None:
        # Compatibility for isolated callers that deliberately do not create a
        # durable rollout. A production stream always supplies ``rollout_bind``.
        return True
    if not state.rollout_task_id or state.rollout_bind is None:
        state.record_trace_event(
            "rollout_finalize_failed",
            stage=phase or "finalize",
            error="missing_rollout_identity",
        )
        return False
    _stop_run_lease_heartbeat(state)
    try:
        finalize_kwargs = dict(
            status=status,
            message_id=message_id,
            phase=phase,
            error_code=error_code,
            error_message=error_message,
            retryable=retryable,
            run_outputs=state.run_outputs,
        )
        lease = (
            chat_run_lease_from_state(state)
            if _is_database_bind(state.rollout_bind)
            else None
        )
        if lease is not None:
            finalize_kwargs["lease"] = lease
        finalize_chat_rollout(
            state.rollout_bind,
            state.rollout_task_id,
            **finalize_kwargs,
        )
        state.rollout_finalized = True
        return True
    except Exception as exc:
        logger.warning("[rollout] failed to finalize chat rollout: %s", exc)
        state.record_trace_event(
            "rollout_finalize_failed",
            stage=phase or "finalize",
            error=str(exc)[:500],
        )
        return False


def _sse_payload(frame: str) -> dict[str, Any]:
    """Parse one internally generated SSE frame for terminal-event gating."""

    if not isinstance(frame, str):
        return {}
    line = frame.strip()
    if not line.startswith("data:"):
        return {}
    try:
        payload = json.loads(line[len("data:") :].strip())
    except (TypeError, ValueError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _rollout_finalize_failed_event(state: ChatSessionState, *, phase: str) -> str:
    """Emit one failure terminator when the durable terminal commit failed."""

    return sse_event(
        run_failed(
            state.run_id,
            ErrorCode.PERSISTENCE_ERROR,
            "运行结果已保存，但终态保存失败。请刷新核对后重新发起新轮次，或联系管理员处理。",
            retryable=True,
            fallback_content=state.full_text,
        )
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
) -> str | None:
    """Persist partial output and a terminal cancellation boundary.

    This is deliberately synchronous: it also runs when Starlette closes the
    async generator while its response task is being cancelled.
    """

    if state.assistant_message_id is not None:
        terminal_status = (
            "waiting_confirmation" if state.confirmation_requested else "completed"
        )
        finalized = _finalize_rollout_safely(
            state,
            status=terminal_status,
            message_id=state.assistant_message_id,
            phase="persisted_before_interrupt",
        )
        return terminal_status if finalized else None

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
        "artifacts": _safe_list(state.delivered_artifacts()),
        "run_rollout": build_in_memory_rollout_snapshot(
            state,
            status="cancelled",
            phase="stream",
            error_message=reason,
        ),
    }
    _attach_turn_audit_metadata(metadata, runtime)
    if state.turn_receipt:
        metadata["turn_receipt"] = dict(state.turn_receipt)
    if state.context_receipt:
        metadata["context_receipt"] = dict(state.context_receipt)
    if state.steering_inputs:
        metadata["steering_inputs"] = state.steering_audit_records()
    resolved_evidence, references = resolve_runtime_knowledge_evidence(
        runtime,
        full_text,
    )
    if resolved_evidence:
        state.knowledge_evidence = resolved_evidence
        metadata["knowledge_evidence"] = resolved_evidence
    resolved_memory_evidence, memory_references = (
        resolve_runtime_project_memory_evidence(runtime, full_text)
    )
    if resolved_memory_evidence:
        state.project_memory_evidence = resolved_memory_evidence
        metadata["project_memory_evidence"] = resolved_memory_evidence
        references = [*memory_references, *references]
    if references:
        metadata["references"] = references

    try:
        _renew_run_lease(state)
        _, assistant_message_id = persist_assistant_message(
            bind,
            runtime.conv_id,
            full_text,
            req.content,
            metadata,
        )
        if state.rollout_task_id and _is_database_bind(bind):
            attach_chat_run_assistant_message(
                bind,
                run_id=state.run_id,
                conversation_id=int(runtime.conv_id),
                message_id=int(assistant_message_id),
                lease=chat_run_lease_from_state(state),
            )
        state.assistant_message_id = assistant_message_id
    except Exception as exc:
        logger.error("[chat interrupt persist failed] %s", exc, exc_info=True)
        finalized = _finalize_rollout_safely(
            state,
            status="cancelled",
            phase="stream",
            error_code="INTERRUPT_PERSISTENCE_ERROR",
            error_message=str(exc),
            retryable=False,
        )
        return "cancelled" if finalized else None

    finalized = _finalize_rollout_safely(
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
    return "cancelled" if finalized else None


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
    _attach_turn_audit_metadata(metadata, runtime)
    resolved_evidence, references = resolve_runtime_knowledge_evidence(
        runtime,
        full_text,
    )
    if resolved_evidence:
        state.knowledge_evidence = resolved_evidence
        metadata["knowledge_evidence"] = resolved_evidence
    resolved_memory_evidence, memory_references = (
        resolve_runtime_project_memory_evidence(runtime, full_text)
    )
    if resolved_memory_evidence:
        state.project_memory_evidence = resolved_memory_evidence
        metadata["project_memory_evidence"] = resolved_memory_evidence
        references = [*memory_references, *references]
    if references:
        metadata["references"] = references

    try:
        _renew_run_lease(state)
        _, assistant_message_id = persist_assistant_message(
            bind,
            runtime.conv_id,
            full_text,
            req.content,
            metadata,
        )
        if state.rollout_task_id and _is_database_bind(bind):
            attach_chat_run_assistant_message(
                bind,
                run_id=state.run_id,
                conversation_id=int(runtime.conv_id),
                message_id=int(assistant_message_id),
                lease=chat_run_lease_from_state(state),
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
        # Keep the canonical Product failure as the final frame. Legacy clients
        # may still consume the explanatory ``error`` event first, but no frame
        # follows ``run_failed`` with a different terminal meaning.
        events: list[str] = [sse_event({"type": "error", "message": friendly})]
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
        return events

    state.assistant_message_id = assistant_message_id
    state.full_text = full_text
    finalized = _finalize_rollout_safely(
        state,
        status="failed",
        message_id=assistant_message_id,
        phase=phase,
        error_code=ErrorCode.UNKNOWN,
        error_message=str(exc),
        retryable=_last_step_retryable(state),
    )
    if not finalized:
        events = [sse_event({"type": "text", "content": full_text})]
        if state.run_id:
            events.append(
                _rollout_finalize_failed_event(state, phase=phase)
            )
        return events

    # A durable failure must have exactly one terminal meaning. Emit the saved
    # explanatory text first, then make Product ``run_failed`` the final frame;
    # never append the legacy success-shaped ``done`` terminator.
    events_list: list[str] = [sse_event({"type": "text", "content": full_text})]
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
    state = ChatSessionState(
        stage_timings=dict(runtime.prepare_metrics or {}),
        context_manifest=dict(getattr(runtime, "context_manifest", None) or {}),
        knowledge_evidence=dict(
            getattr(runtime, "knowledge_evidence_manifest", None) or {}
        ),
        project_memory_evidence=dict(
            getattr(runtime, "project_memory_evidence_manifest", None) or {}
        ),
    )
    state.run_id = str(getattr(runtime, "prepared_run_id", "") or "") or make_run_id()
    state.rollout_bind = bind
    run_lease = new_chat_run_lease()
    state.run_lease_owner = run_lease.owner
    state.run_lease_token = run_lease.token
    state.run_lease_generation = run_lease.generation
    state.run_lease_ttl_seconds = run_lease.ttl_seconds
    prepared_rollout_task_id = getattr(runtime, "prepared_rollout_task_id", None)
    if isinstance(prepared_rollout_task_id, int) and prepared_rollout_task_id > 0:
        state.rollout_task_id = prepared_rollout_task_id
        try:
            # This is intentionally the first durable action taken by the SSE
            # generator. A process crash before iteration leaves an auditable
            # ``reserved`` claim; after activation it is never TTL-reclaimed.
            activate_prepared_chat_rollout(
                bind,
                prepared_rollout_task_id,
                state.run_id,
                run_lease,
            )
        except Exception as exc:
            logger.error(
                "[rollout] failed to activate recovery reservation run_id=%s: %s",
                state.run_id,
                exc,
                exc_info=True,
            )
            yield sse_event(
                run_failed(
                    state.run_id,
                    ErrorCode.POLICY_REJECTED,
                    "恢复预留已失效或无法安全启动，请重新核对后继续。",
                    retryable=False,
                )
            )
            return
    else:
        try:
            state.rollout_task_id = begin_chat_rollout(
                bind,
                runtime,
                req.content,
                state.run_id,
                run_lease,
            )
        except Exception as exc:
            logger.warning("[rollout] failed to begin chat rollout: %s", exc)
            state.record_trace_event(
                "rollout_start_failed",
                stage="run_start",
                error=str(exc)[:500],
            )
            recovery_contract = (
                runtime.prepare_metrics.get("turn_recovery")
                if isinstance(runtime.prepare_metrics, dict)
                and isinstance(runtime.prepare_metrics.get("turn_recovery"), dict)
                else {}
            )
            if recovery_contract:
                # Recovery uniqueness is a commit barrier. A duplicate/racing
                # child must never fall through into the model or tool executor.
                yield sse_event(
                    run_failed(
                        state.run_id,
                        ErrorCode.POLICY_REJECTED,
                        "恢复请求已失效或已由另一轮接管，请重新核对后继续。",
                        retryable=False,
                    )
                )
                return
            yield sse_event(
                run_failed(
                    state.run_id,
                    ErrorCode.PERSISTENCE_ERROR,
                    "无法建立可审计的运行记录，本轮未启动。请稍后重试。",
                    retryable=True,
                )
            )
            return
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
    heartbeat_task: asyncio.Task | None = None
    state.run_lease_heartbeat_stop = asyncio.Event()
    if active_task is not None:
        heartbeat_task = asyncio.create_task(
            _maintain_run_lease(state, owner_task=active_task),
            name=f"chat-run-heartbeat:{state.run_id}",
        )
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
        if CHAT_RUN_LEASE_LOST_CANCEL_MESSAGE in {str(arg) for arg in exc.args}:
            caught_reason = "worker_lease_lost"
            completed = True
            state.run_lease_lost = True
            yield sse_event(
                run_failed(
                    state.run_id,
                    ErrorCode.PERSISTENCE_ERROR,
                    "运行工作进程的数据库租约已失效，本轮已停止，且不会自动重放工具或写入。请刷新后核对并继续。",
                    retryable=True,
                    fallback_content=state.full_text,
                )
            )
            return
        caught_reason = cancellation_reason(exc)
        if caught_reason == "user_interrupted":
            terminal_status = _persist_interrupted_turn(
                runtime=runtime,
                req=req,
                bind=bind,
                state=state,
                reason=caught_reason,
            )
            completed = True
            if terminal_status is None:
                yield _rollout_finalize_failed_event(
                    state,
                    phase="user_interrupted",
                )
                return
            final_status = {
                "cancelled": RunFinalStatus.CANCELLED,
                "waiting_confirmation": RunFinalStatus.WAITING_CONFIRMATION,
                "completed": RunFinalStatus.COMPLETED,
            }.get(terminal_status)
            if final_status is None:
                yield _rollout_finalize_failed_event(
                    state,
                    phase="user_interrupted",
                )
                return
            yield sse_event(
                run_done(
                    state.run_id,
                    final_status,
                    message_id=state.assistant_message_id,
                )
            )
            return
        raise
    finally:
        _stop_run_lease_heartbeat(state)
        if heartbeat_task is not None:
            heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat_task
        active_snapshot = get_active_turn(state.run_id) if registered else None
        if not completed and not state.rollout_finalized and not state.run_lease_lost:
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
        try:
            finalize_durable_run_inputs(bind, run_id=state.run_id)
        except Exception as exc:
            logger.warning(
                "[run input] failed to finalize pending inputs run_id=%s: %s",
                state.run_id,
                exc,
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
    from app.services.chat.durable_task import (
        _finalize_durable_task_before_done,
        run_durable_task,
    )
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
        if getattr(runtime, "skill_activation_source", ""):
            _run_started_skill["source"] = runtime.skill_activation_source
        if not _run_started_skill["name"]:
            _run_started_skill = None  # name is required by the builder
    _prepare_metrics = runtime.prepare_metrics if isinstance(runtime.prepare_metrics, dict) else {}
    _turn_contract = (
        _prepare_metrics.get("turn_contract")
        if isinstance(_prepare_metrics.get("turn_contract"), dict)
        else {}
    )
    _policy_value = str(
        getattr(runtime.action_policy, "value", runtime.action_policy) or ""
    )
    _steering_supported = _policy_value not in {"durable_task", "destructive_action"}
    set_active_turn_stage(
        state.run_id,
        stage="agent_loop_pending" if _steering_supported else "non_steerable_execution",
        steerable=_steering_supported,
    )
    from app.services.chat.product_run_events import resolve_run_display_mode

    _display_mode = resolve_run_display_mode(
        runtime.action_policy,
        has_skill=_run_started_skill is not None,
    )
    yield sse_event(
        run_started(
            state.run_id,
            display_mode=_display_mode,
            skill=_run_started_skill,
        )
    )

    state.turn_receipt = build_turn_receipt(
        state.run_id,
        _turn_contract,
        steering_supported=_steering_supported,
    )
    yield sse_event(state.turn_receipt)
    state.context_receipt = build_context_receipt(state.run_id, runtime)
    yield sse_event(state.context_receipt)

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
    except ChatRunLeaseError as exc:
        state.run_lease_lost = True
        logger.error(
            "[run lease] durable task fenced run_id=%s code=%s",
            state.run_id,
            exc.code,
        )
        raise asyncio.CancelledError(CHAT_RUN_LEASE_LOST_CANCEL_MESSAGE) from exc
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
        # The P0 path must durably terminate the ChatRun before either its
        # legacy ``done`` frame (emitted inside ``run_durable_task``) or this
        # Product Run Event v1 terminator.  Re-run the strict helper as a
        # defensive no-op; if a future P0 branch forgets its boundary, fail
        # closed instead of announcing a completion that the database denies.
        _finalize_durable_task_before_done(
            bind,
            runtime=runtime,
            state=state,
        )
        state.stage_timings["total_stream_ms"] = round((time.perf_counter() - stream_started_at) * 1000)
        yield sse_event(
            {
                "type": "timing",
                "key": "total_stream_ms",
                "duration_ms": state.stage_timings["total_stream_ms"],
            }
        )
        yield sse_event(
            run_done(
                state.run_id,
                RunFinalStatus.WAITING_CONFIRMATION
                if state.confirmation_requested
                else RunFinalStatus.COMPLETED,
            )
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
    deferred_agent_terminal_events: list[str] = []
    try:
        async for event in run_agent_loop(runtime, req, state):
            payload = _sse_payload(event)
            if (
                payload.get("type") == "run_failed"
                and payload.get("error_code") == ErrorCode.TURN_BUDGET_EXCEEDED
            ):
                # Budget exhaustion is discovered inside the Agent Loop, but
                # its failure terminal is not truthful until run_persist has
                # saved the assistant projection and ChatRun finalization wins.
                deferred_agent_terminal_events.append(event)
            else:
                yield event
    except ChatRunLeaseError as exc:
        state.run_lease_lost = True
        logger.error(
            "[run lease] agent loop fenced run_id=%s code=%s",
            state.run_id,
            exc.code,
        )
        raise asyncio.CancelledError(CHAT_RUN_LEASE_LOST_CANCEL_MESSAGE) from exc
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
    finally:
        set_active_turn_stage(
            state.run_id,
            stage="persist",
            steerable=False,
        )

    # ==================================================================
    # Persist — final-text assembly, artifact persistence, HITAS, message
    # ==================================================================
    deferred_legacy_done: str | None = None
    try:
        async for event in run_persist(runtime, req, bind, state):
            if _sse_payload(event).get("type") == "done":
                # ``run_persist`` remains backward-compatible when consumed
                # directly. The orchestrator withholds only its legacy terminal
                # until the matching ChatRun terminal transaction commits.
                deferred_legacy_done = event
            else:
                yield event
    except ChatRunLeaseError as exc:
        state.run_lease_lost = True
        logger.error(
            "[run lease] persist fenced run_id=%s code=%s",
            state.run_id,
            exc.code,
        )
        raise asyncio.CancelledError(CHAT_RUN_LEASE_LOST_CANCEL_MESSAGE) from exc
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

    if state.budget_exhausted:
        budget_message = str(
            state.budget_exhaustion.get("message")
            or "本轮达到执行预算上限，已安全停止。"
        )
        finalized = _finalize_rollout_safely(
            state,
            status="failed",
            message_id=state.assistant_message_id,
            phase="turn_budget",
            error_code=ErrorCode.TURN_BUDGET_EXCEEDED,
            error_message=budget_message,
            retryable=False,
        )
        if not finalized:
            yield _rollout_finalize_failed_event(state, phase="turn_budget")
            return
        if deferred_agent_terminal_events:
            for event in deferred_agent_terminal_events:
                yield event
        else:
            yield sse_event(
                run_failed(
                    state.run_id,
                    ErrorCode.TURN_BUDGET_EXCEEDED,
                    budget_message,
                    retryable=False,
                    fallback_content=state.full_text,
                )
            )
        logger.info(
            "[run stopped] run_id=%s phase=turn_budget kind=%s duration_ms=%s steps=%s tool_calls=%s",
            state.run_id,
            state.budget_exhaustion.get("kind"),
            state.stage_timings.get("total_stream_ms")
            or round((time.perf_counter() - stream_started_at) * 1000),
            len(state.steps or []),
            len(state.tool_call_events or []),
        )
        return

    if state.run_evaluation.get("verdict") == "failed":
        evaluation_message = str(
            state.run_evaluation.get("summary")
            or "完成证据检查未通过，本轮已按失败状态保存。"
        )
        finalized = _finalize_rollout_safely(
            state,
            status="failed",
            message_id=state.assistant_message_id,
            phase="completion_evaluation",
            error_code=ErrorCode.RUN_EVALUATION_FAILED,
            error_message=evaluation_message,
            retryable=False,
        )
        if not finalized:
            yield _rollout_finalize_failed_event(
                state,
                phase="completion_evaluation",
            )
            return
        yield sse_event(
            run_failed(
                state.run_id,
                ErrorCode.RUN_EVALUATION_FAILED,
                evaluation_message,
                retryable=False,
                fallback_content=state.full_text,
            )
        )
        logger.info(
            "[run failed] run_id=%s phase=completion_evaluation score=%s primary=%s message_id=%s",
            state.run_id,
            state.run_evaluation.get("score"),
            state.run_evaluation.get("primary_finding_code"),
            state.assistant_message_id,
        )
        return

    # Successful end-of-run terminator (Product Run Event v1).
    finalized = _finalize_rollout_safely(
        state,
        status="waiting_confirmation" if state.confirmation_requested else "completed",
        message_id=state.assistant_message_id,
        phase="persist",
    )
    if not finalized:
        yield _rollout_finalize_failed_event(state, phase="persist")
        return
    if deferred_legacy_done is not None:
        yield deferred_legacy_done
    yield sse_event(
        run_done(
            state.run_id,
            RunFinalStatus.WAITING_CONFIRMATION
            if state.confirmation_requested
            else RunFinalStatus.COMPLETED,
        )
    )
    logger.info(
        "[run done] run_id=%s path=agent_loop duration_ms=%s steps=%s artifacts=%s tool_events=%s",
        state.run_id,
        state.stage_timings.get("total_stream_ms")
        or round((time.perf_counter() - stream_started_at) * 1000),
        len(state.steps or []),
        len(state.artifacts or []),
        len(state.tool_call_events or []),
    )
