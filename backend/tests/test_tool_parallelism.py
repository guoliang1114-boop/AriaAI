from __future__ import annotations

import asyncio
import json
import threading
from types import SimpleNamespace
from typing import Any, AsyncIterator
from unittest.mock import patch

import pytest

from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.tool_scheduler import (
    ToolExecutionLane,
    normalize_max_parallel,
    plan_tool_execution,
    tool_call_supports_parallel,
)
from app.services.chat.agent_loop import run_agent_loop
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import ToolOutcome
from app.tools import office_documents, project_markdown, registry


def _call(call_id: str, name: str, tool_input: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "type": "tool_use",
        "id": call_id,
        "name": name,
        "input": tool_input or {},
    }


def _result(call_id: str) -> dict[str, Any]:
    return {
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": json.dumps({"ok": True, "call_id": call_id}),
    }


class _SequenceLLM:
    def __init__(self, turns: list[list[str]]) -> None:
        self._turns = iter(turns)
        self.received_messages: list[list[dict]] = []

    async def stream_response(self, messages, **_kwargs) -> AsyncIterator[str]:
        self.received_messages.append(messages)
        for chunk in next(self._turns):
            yield chunk


def _runtime(llm: _SequenceLLM, *, action_policy: ActionPolicy) -> SimpleNamespace:
    return SimpleNamespace(
        llm=llm,
        system="system",
        selected_model="test-model",
        tools=None,
        max_tokens=256,
        temperature=0.0,
        api_messages=[{"role": "user", "content": "inspect project files"}],
        action_policy=action_policy,
        tool_parallel_max_concurrency=4,
    )


def test_parallel_eligibility_is_explicit_and_policy_bounded() -> None:
    markdown_read = _call(
        "read-1",
        "read_project_markdown_document",
        {"action": "read", "file_id": 1},
    )
    generic_search = _call("search-1", "search_everything", {"query": "risk"})
    write = _call("write-1", "generate_docx", {"title": "Risk memo"})

    assert tool_call_supports_parallel(ActionPolicy.READ_ONLY_TOOL, markdown_read) is True
    assert tool_call_supports_parallel(ActionPolicy.DIRECT_ANSWER, markdown_read) is False
    assert tool_call_supports_parallel(ActionPolicy.READ_ONLY_TOOL, generic_search) is False
    assert tool_call_supports_parallel(ActionPolicy.WRITE_ARTIFACT, write) is False


def test_plan_groups_contiguous_reads_around_serial_write_barriers() -> None:
    calls = [
        _call("r1", "read_project_markdown_document", {"action": "read", "file_id": 1}),
        _call("r2", "read_project_file", {"action": "read", "file_id": 2}),
        _call("w1", "generate_docx", {"title": "Memo"}),
        _call("r3", "read_project_markdown_document", {"action": "list"}),
        _call("r4", "read_project_file", {"action": "list"}),
    ]

    plan = plan_tool_execution(
        calls,
        action_policy=ActionPolicy.WRITE_ARTIFACT,
        max_parallel=2,
    )

    assert [(batch.lane, batch.indexes) for batch in plan.batches] == [
        (ToolExecutionLane.PARALLEL_READ, (0, 1)),
        (ToolExecutionLane.SERIAL, (2,)),
        (ToolExecutionLane.PARALLEL_READ, (3, 4)),
    ]
    assert plan.parallel_call_count == 4
    assert plan.serial_call_count == 1


def test_parallel_width_is_hard_bounded_and_one_disables_overlap() -> None:
    calls = [
        _call(f"r{index}", "read_project_file", {"action": "list"})
        for index in range(10)
    ]

    bounded = plan_tool_execution(
        calls,
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        max_parallel=999,
    )
    disabled = plan_tool_execution(
        calls[:2],
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        max_parallel=1,
    )

    assert normalize_max_parallel(999) == 8
    assert [len(batch.indexes) for batch in bounded.batches] == [8, 2]
    assert all(batch.parallel for batch in bounded.batches)
    assert [batch.lane for batch in disabled.batches] == [
        ToolExecutionLane.SERIAL,
        ToolExecutionLane.SERIAL,
    ]


@pytest.mark.asyncio
async def test_parallel_safe_read_handlers_leave_the_event_loop() -> None:
    event_loop_thread = threading.get_ident()
    worker_threads: dict[str, int] = {}

    def fake_project_file_read(**_kwargs):
        worker_threads["project_file"] = threading.get_ident()
        return {"ok": True, "source": "project_file"}

    def fake_markdown_read(**_kwargs):
        worker_threads["markdown"] = threading.get_ident()
        return {"ok": True, "source": "markdown"}

    with patch.object(
        office_documents,
        "_read_project_file_sync",
        side_effect=fake_project_file_read,
    ), patch.object(
        project_markdown,
        "_read_project_markdown_document_sync",
        side_effect=fake_markdown_read,
    ):
        results = await asyncio.gather(
            registry.execute(
                "read_project_file",
                {"project_id": 1, "action": "list"},
            ),
            registry.execute(
                "read_project_markdown_document",
                {"project_id": 1, "action": "list"},
            ),
        )

    assert [result["status"] for result in results] == ["success", "success"]
    assert worker_threads.keys() == {"project_file", "markdown"}
    assert all(thread_id != event_loop_thread for thread_id in worker_threads.values())


@pytest.mark.asyncio
async def test_agent_loop_overlaps_safe_reads_and_merges_results_in_call_order() -> None:
    calls = [
        _call("slow-first", "read_project_markdown_document", {"action": "list"}),
        _call("fast-second", "read_project_file", {"action": "list"}),
    ]
    llm = _SequenceLLM(
        [
            [json.dumps(call) for call in calls],
            ["done"],
        ]
    )
    runtime = _runtime(llm, action_policy=ActionPolicy.READ_ONLY_TOOL)
    state = ChatSessionState()
    active = 0
    max_active = 0
    started: set[str] = set()
    both_started = asyncio.Event()

    async def fake_execute(_runtime, child_state, tool_call, **_kwargs):
        nonlocal active, max_active
        call_id = tool_call["id"]
        active += 1
        max_active = max(max_active, active)
        started.add(call_id)
        if len(started) == 2:
            both_started.set()
        await asyncio.wait_for(both_started.wait(), timeout=0.5)
        if call_id == "slow-first":
            await asyncio.sleep(0.03)
        child_state.tool_call_events.append(
            {"tool_use_id": call_id, "tool_name": tool_call["name"], "step_index": 0, "status": "completed"}
        )
        active -= 1
        return ToolOutcome(result_block=_result(call_id))

    with patch("app.services.chat.agent_loop.execute_tool_with_policy", new=fake_execute):
        await asyncio.wait_for(
            _drain(runtime, state),
            timeout=1.0,
        )

    assert max_active == 2
    assert [event["tool_use_id"] for event in state.tool_call_events] == [
        "slow-first",
        "fast-second",
    ]
    assert [block["tool_use_id"] for block in state.steps[0].tool_results] == [
        "slow-first",
        "fast-second",
    ]
    next_turn_results = llm.received_messages[1][-1]["content"]
    assert [block["tool_use_id"] for block in next_turn_results] == [
        "slow-first",
        "fast-second",
    ]
    plan_trace = next(event for event in state.trace_events if event["type"] == "tool_execution_planned")
    assert plan_trace["parallel_call_count"] == 2
    assert plan_trace["lanes"] == ["parallel_read"]


@pytest.mark.asyncio
async def test_serial_write_is_a_barrier_between_parallel_read_batches() -> None:
    calls = [
        _call("r1", "read_project_markdown_document", {"action": "list"}),
        _call("r2", "read_project_file", {"action": "list"}),
        _call("w1", "generate_docx", {"title": "Memo"}),
        _call("r3", "read_project_markdown_document", {"action": "list"}),
        _call("r4", "read_project_file", {"action": "list"}),
    ]
    llm = _SequenceLLM([[json.dumps(call) for call in calls], ["done"]])
    runtime = _runtime(llm, action_policy=ActionPolicy.WRITE_ARTIFACT)
    state = ChatSessionState()
    timeline: list[str] = []
    active = 0
    max_active = 0

    async def fake_execute(_runtime, child_state, tool_call, **_kwargs):
        nonlocal active, max_active
        call_id = tool_call["id"]
        timeline.append(f"start:{call_id}")
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.02)
        active -= 1
        timeline.append(f"end:{call_id}")
        child_state.tool_call_events.append(
            {"tool_use_id": call_id, "tool_name": tool_call["name"], "step_index": 0, "status": "completed"}
        )
        return ToolOutcome(result_block=_result(call_id))

    with patch("app.services.chat.agent_loop.execute_tool_with_policy", new=fake_execute):
        await _drain(runtime, state)

    assert max_active == 2
    assert timeline.index("end:r1") < timeline.index("start:w1")
    assert timeline.index("end:r2") < timeline.index("start:w1")
    assert timeline.index("end:w1") < timeline.index("start:r3")
    assert timeline.index("end:w1") < timeline.index("start:r4")
    assert [block["tool_use_id"] for block in state.steps[0].tool_results] == [
        "r1",
        "r2",
        "w1",
        "r3",
        "r4",
    ]


async def _drain(runtime, state: ChatSessionState) -> list[str]:
    return [
        event
        async for event in run_agent_loop(
            runtime,
            SendMessageRequest(content="inspect project files"),
            state,
        )
    ]
