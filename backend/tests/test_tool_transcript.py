from __future__ import annotations

import asyncio
import json
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.tool_transcript import (
    normalize_planned_tool_calls,
    normalize_tool_transcript,
)
from app.services.chat.agent_loop import run_agent_loop
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import ToolOutcome
from app.services.openai_compat import _to_openai_messages


def _tool_call(call_id: str, name: str = "search") -> dict:
    return {
        "type": "tool_use",
        "id": call_id,
        "name": name,
        "input": {"query": "Aria"},
    }


def _tool_result(call_id: str, content: str = "done") -> dict:
    return {
        "type": "tool_result",
        "tool_use_id": call_id,
        "content": content,
    }


def test_well_formed_transcript_is_byte_stable_and_input_is_not_mutated() -> None:
    messages = [
        {"role": "user", "content": "start"},
        {"role": "assistant", "content": [_tool_call("call_1")]},
        {"role": "user", "content": [_tool_result("call_1")]},
    ]
    original = deepcopy(messages)

    result = normalize_tool_transcript(messages)

    assert result.messages == original
    assert result.changed is False
    assert result.issues == ()
    assert messages == original
    assert result.messages is not messages


def test_missing_result_gets_immediate_fail_closed_synthetic_output() -> None:
    messages = [
        {"role": "assistant", "content": [_tool_call("call_missing")]},
        {"role": "user", "content": "continue"},
    ]

    result = normalize_tool_transcript(messages)

    assert result.changed is True
    assert [message["role"] for message in result.messages] == ["assistant", "user", "user"]
    synthetic = result.messages[1]["content"][0]
    assert synthetic["tool_use_id"] == "call_missing"
    payload = json.loads(synthetic["content"])
    assert payload["status"] == "aborted"
    assert payload["execution_outcome_unknown"] is True
    assert payload["retryable"] is False
    assert result.synthetic_result_count == 1
    assert result.messages[2] == messages[1]


def test_orphan_results_are_removed_without_losing_neighboring_user_text() -> None:
    messages = [
        {
            "role": "user",
            "content": [
                _tool_result("unknown"),
                {"type": "text", "text": "keep me"},
            ],
            "metadata": {"source": "test"},
        }
    ]

    result = normalize_tool_transcript(messages)

    assert result.messages == [
        {
            "role": "user",
            "content": [{"type": "text", "text": "keep me"}],
            "metadata": {"source": "test"},
        }
    ]
    assert result.removed_orphan_count == 1
    assert result.issues[0].code == "orphan_tool_result_removed"


def test_duplicate_history_call_ids_are_rewritten_and_results_follow_call_order() -> None:
    messages = [
        {"role": "assistant", "content": [_tool_call("same", "first")]},
        {"role": "user", "content": [_tool_result("same", "one")]},
        {"role": "assistant", "content": [_tool_call("same", "second")]},
        {"role": "user", "content": [_tool_result("same", "two")]},
    ]

    first = normalize_tool_transcript(messages)
    second = normalize_tool_transcript(messages)

    rewritten_call = first.messages[2]["content"][0]["id"]
    rewritten_result = first.messages[3]["content"][0]["tool_use_id"]
    assert rewritten_call.startswith("aria_call_")
    assert rewritten_result == rewritten_call
    assert rewritten_call != "same"
    assert first.messages == second.messages
    assert first.normalized_fingerprint == second.normalized_fingerprint
    assert {issue.code for issue in first.issues} >= {
        "duplicate_call_id_rewritten",
        "tool_result_id_rewritten",
    }


def test_missing_call_id_is_stable_and_pairs_an_empty_result_id() -> None:
    messages = [
        {"role": "assistant", "content": [_tool_call("")]},
        {"role": "user", "content": [_tool_result("")]},
    ]

    first = normalize_tool_transcript(messages)
    second = normalize_tool_transcript(messages)

    call_id = first.messages[0]["content"][0]["id"]
    assert call_id.startswith("aria_call_")
    assert first.messages[1]["content"][0]["tool_use_id"] == call_id
    assert second.messages == first.messages
    assert first.synthetic_result_count == 0


def test_duplicate_planned_call_is_not_executed_twice_and_missing_id_is_assigned() -> None:
    calls = [
        _tool_call("same", "first"),
        _tool_call("same", "duplicate"),
        _tool_call("", "missing"),
    ]

    result = normalize_planned_tool_calls(calls, step_index=3)
    repeated = normalize_planned_tool_calls(calls, step_index=3)

    assert [call["name"] for call in result.tool_calls] == ["first", "missing"]
    assert result.tool_calls[1]["id"].startswith("aria_call_")
    assert result.tool_calls == repeated.tool_calls
    assert result.removed_duplicate_count == 1
    assert result.assigned_call_id_count == 1
    assert {issue.code for issue in result.issues} == {
        "duplicate_tool_call_removed",
        "missing_call_id_assigned",
    }


def test_normalized_transcript_converts_to_openai_call_id_pairs() -> None:
    normalized = normalize_tool_transcript(
        [{"role": "assistant", "content": [_tool_call("call_1")]}]
    )

    openai_messages = _to_openai_messages(normalized.messages)

    assert openai_messages[0]["tool_calls"][0]["id"] == "call_1"
    assert openai_messages[1]["role"] == "tool"
    assert openai_messages[1]["tool_call_id"] == "call_1"


class _CapturingLLM:
    def __init__(self) -> None:
        self.received_messages: list[list[dict]] = []

    async def stream_response(self, messages, **_kwargs):
        self.received_messages.append(deepcopy(messages))
        yield "normalized"


class _SequenceLLM:
    def __init__(self, responses: list[list[str]]) -> None:
        self.responses = responses
        self.received_messages: list[list[dict]] = []
        self.received_systems: list[str] = []

    async def stream_response(self, messages, **kwargs):
        self.received_messages.append(deepcopy(messages))
        self.received_systems.append(str(kwargs.get("system") or ""))
        response = self.responses[len(self.received_messages) - 1]
        for item in response:
            yield item


def test_agent_loop_normalizes_the_transcript_at_the_provider_boundary() -> None:
    llm = _CapturingLLM()
    runtime = SimpleNamespace(
        llm=llm,
        system="system",
        selected_model="test-model",
        tools=None,
        max_tokens=256,
        temperature=0.0,
        api_messages=[
            {"role": "assistant", "content": [_tool_call("interrupted")]},
            {"role": "user", "content": "latest request"},
        ],
        action_policy=ActionPolicy.READ_ONLY_TOOL,
    )
    state = ChatSessionState()

    async def collect() -> list[str]:
        return [event async for event in run_agent_loop(runtime, SendMessageRequest(content="go"), state)]

    asyncio.run(collect())

    provider_messages = llm.received_messages[0]
    assert provider_messages[1]["content"][0]["tool_use_id"] == "interrupted"
    assert provider_messages[2] == {"role": "user", "content": "latest request"}
    trace = next(event for event in state.trace_events if event["type"] == "tool_transcript_normalized")
    assert trace["synthetic_result_count"] == 1
    assert "missing_tool_result_inserted" in trace["issue_codes"]
    assert state.full_text == "normalized"


def test_agent_loop_drops_duplicate_call_id_before_tool_execution() -> None:
    first = json.dumps(_tool_call("duplicate", "read_project_file"))
    second = json.dumps(_tool_call("duplicate", "read_project_markdown_document"))
    llm = _SequenceLLM([[first, second], ["complete"]])
    runtime = SimpleNamespace(
        llm=llm,
        system="system",
        selected_model="test-model",
        tools=None,
        max_tokens=256,
        temperature=0.0,
        api_messages=[{"role": "user", "content": "go"}],
        action_policy=ActionPolicy.READ_ONLY_TOOL,
    )
    state = ChatSessionState()
    executed: list[str] = []

    async def fake_execute(_runtime, _state, tool_call, **_kwargs):
        executed.append(tool_call["name"])
        return ToolOutcome(
            result_block=_tool_result(
                tool_call["id"],
                json.dumps({"ok": True}),
            )
        )

    async def collect() -> list[str]:
        return [event async for event in run_agent_loop(runtime, SendMessageRequest(content="go"), state)]

    with patch("app.services.chat.agent_loop.execute_tool_with_policy", new=fake_execute):
        asyncio.run(collect())

    assert executed == ["read_project_file"]
    assert len(state.steps[0].tool_calls) == 1
    assert len(llm.received_messages[1][1]["content"]) == 1
    assert len(llm.received_messages[1][2]["content"]) == 1
    trace = next(event for event in state.trace_events if event["type"] == "planned_tool_calls_normalized")
    assert trace["removed_duplicate_count"] == 1
    assert "duplicate_tool_call_removed" in trace["issue_codes"]


def test_agent_loop_rebudgets_large_tool_output_before_the_next_model_turn() -> None:
    planned = json.dumps(_tool_call("large_call", "read_project_file"))
    llm = _SequenceLLM([[planned], ["complete"]])
    runtime = SimpleNamespace(
        llm=llm,
        system="system " + ("policy " * 500),
        selected_model="test-model",
        tools=None,
        max_tokens=512,
        temperature=0.0,
        api_messages=[{"role": "user", "content": "inspect"}],
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        context_window_tokens=4_096,
        context_safety_margin_percent=8,
        context_history_summary_tokens=256,
    )
    state = ChatSessionState()

    async def fake_execute(_runtime, _state, tool_call, **_kwargs):
        return ToolOutcome(
            result_block=_tool_result(
                tool_call["id"],
                json.dumps({"ok": True, "content": "RESULT " + ("data " * 10_000)}),
            )
        )

    async def collect() -> list[str]:
        return [event async for event in run_agent_loop(runtime, SendMessageRequest(content="go"), state)]

    with patch("app.services.chat.agent_loop.execute_tool_with_policy", new=fake_execute):
        asyncio.run(collect())

    second_turn = llm.received_messages[1]
    assistant_index = next(
        index
        for index, message in enumerate(second_turn)
        if message.get("role") == "assistant" and isinstance(message.get("content"), list)
    )
    assistant = second_turn[assistant_index]
    tool_output = second_turn[assistant_index + 1]
    assert assistant["content"][0]["id"] == "large_call"
    assert tool_output["content"][0]["tool_use_id"] == "large_call"
    assert json.loads(tool_output["content"][0]["content"])["_aria_compacted"] is True
    openai_messages = _to_openai_messages(second_turn)
    openai_call = next(message for message in openai_messages if message.get("tool_calls"))
    openai_result = next(message for message in openai_messages if message.get("role") == "tool")
    assert openai_call["tool_calls"][0]["id"] == "large_call"
    assert openai_result["tool_call_id"] == "large_call"

    budgets = [event for event in state.trace_events if event["type"] == "turn_context_budget"]
    assert len(budgets) == 2
    assert budgets[0]["compacted"] is False
    assert budgets[1]["compacted"] is True
    assert budgets[1]["tool_batches_before"] == 1
    assert budgets[1]["tool_batches_after"] == 1
    assert budgets[1]["estimated_total_after"] <= (
        budgets[1]["context_window_tokens"] - budgets[1]["safety_margin_tokens"]
    )
    assert not any(
        event["type"] == "post_budget_tool_transcript_normalized"
        for event in state.trace_events
    )
