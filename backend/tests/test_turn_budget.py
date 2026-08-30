from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace
from typing import AsyncIterator
from unittest.mock import AsyncMock, patch

import pytest

import app.services.chat as chat_service
from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.turn_budget import (
    BudgetKind,
    TurnBudgetExceeded,
    TurnBudgetLedger,
    TurnBudgetLimits,
    await_with_turn_deadline,
    iter_with_turn_deadline,
    normalize_turn_budget_limits,
)
from app.services.chat.agent_loop import run_agent_loop
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.persist import run_persist
from app.services.chat.state import ChatSessionState


def test_normalize_turn_budget_limits_applies_hard_clamps_and_fallbacks() -> None:
    maximum = normalize_turn_budget_limits(
        max_steps=999,
        max_tool_calls=999,
        max_elapsed_seconds=float("inf"),
    )
    minimum = normalize_turn_budget_limits(
        max_steps=-1,
        max_tool_calls=0,
        max_elapsed_seconds=1,
    )

    assert maximum == TurnBudgetLimits(
        max_steps=16,
        max_tool_calls=64,
        max_elapsed_seconds=600.0,
    )
    assert minimum == TurnBudgetLimits(
        max_steps=1,
        max_tool_calls=1,
        max_elapsed_seconds=30.0,
    )


def test_step_budget_allows_exact_limit_then_stops() -> None:
    ledger = TurnBudgetLedger(TurnBudgetLimits(2, 4, 60))

    ledger.start_step(phase="step_0")
    ledger.start_step(phase="step_1")

    with pytest.raises(TurnBudgetExceeded) as raised:
        ledger.start_step(phase="step_2")

    assert raised.value.kind is BudgetKind.STEP_LIMIT
    assert raised.value.limit == 2
    assert raised.value.used == 2
    assert ledger.steps_started == 2


def test_tool_call_reservation_is_atomic() -> None:
    ledger = TurnBudgetLedger(TurnBudgetLimits(2, 3, 60))
    ledger.reserve_tool_calls(2, phase="first_batch")

    with pytest.raises(TurnBudgetExceeded) as raised:
        ledger.reserve_tool_calls(2, phase="oversized_batch")

    assert raised.value.kind is BudgetKind.TOOL_CALL_LIMIT
    assert raised.value.used == 4
    assert ledger.tool_calls_reserved == 2


def test_deadline_uses_injected_monotonic_clock() -> None:
    now = [100.0]
    ledger = TurnBudgetLedger(
        TurnBudgetLimits(2, 2, 5.0),
        clock=lambda: now[0],
    )
    now[0] = 105.0

    with pytest.raises(TurnBudgetExceeded) as raised:
        ledger.check_deadline(phase="model_stream")

    assert raised.value.kind is BudgetKind.DEADLINE
    assert raised.value.phase == "model_stream"
    assert ledger.snapshot()["usage"]["remaining_seconds"] == 0.0


@pytest.mark.asyncio
async def test_deadline_cancels_inflight_tool_wait_and_marks_uncertainty() -> None:
    cancelled = asyncio.Event()

    async def slow_tool() -> None:
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()

    ledger = TurnBudgetLedger(TurnBudgetLimits(1, 1, 0.02))
    with pytest.raises(TurnBudgetExceeded) as raised:
        await await_with_turn_deadline(
            slow_tool(),
            ledger,
            phase="tool_batch",
            tool_execution_possible=True,
        )

    assert raised.value.kind is BudgetKind.DEADLINE
    assert raised.value.tool_execution_possible is True
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_stream_iterator_obeys_shared_deadline() -> None:
    async def slow_stream() -> AsyncIterator[str]:
        await asyncio.sleep(10)
        yield "late"

    ledger = TurnBudgetLedger(TurnBudgetLimits(1, 1, 0.02))
    with pytest.raises(TurnBudgetExceeded) as raised:
        async for _ in iter_with_turn_deadline(
            slow_stream(),
            ledger,
            phase="model_stream",
        ):
            pass

    assert raised.value.kind is BudgetKind.DEADLINE
    assert raised.value.tool_execution_possible is False


class _PlannedCallsLLM:
    async def stream_response(self, _messages, **_kwargs) -> AsyncIterator[str]:
        for call_id in ("call-1", "call-2"):
            yield json.dumps(
                {
                    "type": "tool_use",
                    "id": call_id,
                    "name": "read_project_file",
                    "input": {"action": "list"},
                }
            )


@pytest.mark.asyncio
async def test_agent_loop_rejects_oversized_tool_plan_before_execution() -> None:
    runtime = SimpleNamespace(
        llm=_PlannedCallsLLM(),
        system="system",
        selected_model="test-model",
        tools=None,
        max_tokens=256,
        temperature=0.0,
        api_messages=[{"role": "user", "content": "inspect"}],
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        tool_parallel_max_concurrency=4,
        agent_turn_max_steps=8,
        agent_turn_max_tool_calls=1,
        agent_turn_timeout_seconds=600,
    )
    state = ChatSessionState(run_id="run_budget_test")
    execute = AsyncMock(side_effect=AssertionError("tool must not execute"))

    with patch("app.services.chat.agent_loop.execute_tool_with_policy", new=execute):
        events = [
            event
            async for event in run_agent_loop(
                runtime,
                SendMessageRequest(content="inspect"),
                state,
            )
        ]

    execute.assert_not_awaited()
    assert state.budget_exhausted is True
    assert state.budget_exhaustion["kind"] == "tool_call_limit"
    assert state.turn_budget.tool_calls_reserved == 0
    assert state.steps[-1].status == "failed"
    assert "TURN_BUDGET_EXCEEDED" in "".join(events)
    assert "超出部分未执行" in state.full_text


@pytest.mark.asyncio
async def test_persist_records_budget_failure_without_starting_fallback_work() -> None:
    runtime = SimpleNamespace(
        conv_id=7,
        project_id=3,
        rag_sources=[],
        skill_name="",
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        artifact_contract=None,
        working_memory={},
        llm=SimpleNamespace(complete=AsyncMock()),
    )
    req = SimpleNamespace(
        project_id=3,
        content="inspect",
        action_confirmations=[],
        skill_id=None,
        language=None,
    )
    ledger = TurnBudgetLedger(TurnBudgetLimits(1, 1, 60))
    state = ChatSessionState(
        run_id="run_budget_persist",
        full_text="partial\n\nbudget stopped",
        turn_budget=ledger,
        budget_exhausted=True,
        budget_exhaustion={
            "kind": "tool_call_limit",
            "phase": "step_0_tools",
            "limit": 1,
            "used": 2,
            "message": "budget stopped",
            "budget": ledger.snapshot(),
        },
    )
    persisted: dict = {}

    def fake_persist(_bind, _conv_id, content, _request_content, metadata):
        persisted["content"] = content
        persisted["metadata"] = metadata
        return True, 91

    with patch(
        "app.services.chat.persist.persist_assistant_message", new=fake_persist
    ), patch(
        "app.services.chat.persist.persist_chat_trace"
    ), patch(
        "app.services.chat.persist._maybe_create_markdown_from_response"
    ) as fallback, patch(
        "app.services.chat.persist.schedule_title_generation"
    ) as title:
        events = [
            event
            async for event in run_persist(runtime, req, object(), state)
        ]

    fallback.assert_not_called()
    title.assert_not_called()
    assert persisted["metadata"]["turn_budget"]["kind"] == "tool_call_limit"
    assert persisted["metadata"]["run_rollout"]["status"] == "failed"
    assert persisted["metadata"]["run_rollout"]["terminal_event"] == "run_failed"
    assert state.assistant_message_id == 91
    assert any('"type": "done"' in event for event in events)


@pytest.mark.asyncio
async def test_orchestrator_finalizes_budget_exhaustion_as_failed_without_run_done() -> None:
    runtime = SimpleNamespace(
        conv_id=7,
        selected_model="test-model",
        rag_sources=[],
        skill_name="",
        tools=None,
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        tool_access_policy="read_on_demand",
        intent_reason="explicit_read",
        intent_method="rule",
        chat_mode="project_qa",
        prepare_metrics={},
    )
    req = SimpleNamespace(project_id=3)
    rollout_bind = object()
    state = ChatSessionState(
        run_id="run_budget_terminal",
        rollout_task_id=51,
        rollout_bind=rollout_bind,
    )
    finalized: dict = {}
    timeline: list[str] = []

    async def fake_durable(_runtime, _req, _bind, _state):
        if False:  # pragma: no cover - async-generator shape
            yield ""

    async def fake_agent(_runtime, _req, run_state):
        run_state.budget_exhausted = True
        run_state.budget_exhaustion = {
            "kind": "deadline",
            "message": "budget stopped",
        }
        timeline.append("budget_terminal_produced")
        yield (
            'data: {"type":"run_failed","run_id":"run_budget_terminal",'
            '"error_code":"TURN_BUDGET_EXCEEDED","error_message":"budget stopped",'
            '"retryable":false}\n\n'
        )

    async def fake_persist(_runtime, _req, _bind, run_state):
        run_state.assistant_message_id = 91
        timeline.append("legacy_done_produced")
        yield 'data: {"type":"done"}\n\n'

    def fake_finalize(_bind, task_id, **kwargs):
        finalized.update(task_id=task_id, **kwargs)
        timeline.append("terminal_committed")
        return {"status": kwargs["status"]}

    with patch(
        "app.services.chat.durable_task.run_durable_task", new=fake_durable
    ), patch(
        "app.services.chat.agent_loop.run_agent_loop", new=fake_agent
    ), patch(
        "app.services.chat.persist.run_persist", new=fake_persist
    ), patch.object(
        chat_service, "finalize_chat_rollout", new=fake_finalize
    ):
        events = []
        async for event in chat_service._stream_chat_events_impl(
            runtime,
            req,
            rollout_bind,
            state,
            time.perf_counter(),
        ):
            if chat_service._sse_payload(event).get("type") == "run_failed":
                timeline.append("yield_run_failed")
            events.append(event)

    assert not any('"type": "run_done"' in event for event in events)
    assert not any(chat_service._sse_payload(event).get("type") == "done" for event in events)
    assert timeline == [
        "budget_terminal_produced",
        "legacy_done_produced",
        "terminal_committed",
        "yield_run_failed",
    ]
    assert finalized == {
        "task_id": 51,
        "status": "failed",
        "message_id": 91,
        "phase": "turn_budget",
        "error_code": "TURN_BUDGET_EXCEEDED",
            "error_message": "budget stopped",
            "retryable": False,
            "run_outputs": [],
        }
