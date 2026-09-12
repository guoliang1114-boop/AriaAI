from __future__ import annotations

import asyncio
import json

import pytest

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.answer_length import AnswerLengthError, answer_char_count, explicit_answer_char_limit
from app.services.chat.agent_loop import run_agent_loop
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime
from app.services.chat.truncation import OUTPUT_TRUNCATED_MARKER


@pytest.mark.parametrize("text,expected", [
    ("请用两条回答，不超过180字。", 180), ("回复控制在 １８０ 字以内", 180),
    ("180字以内，保留引用", 180), ("最多200个字符", 200),
    ("不超过180字；改为不超过120字", 120), ("不超过180字。不限字数", None),
    ("至少180字", None), ("大约180字", None), ("不超过180字左右", None),
    ("每条不超过180字", None), ("文件不超过180字", None),
    ("解释“不超过180字”的含义", None), ("`最多180字`", None),
    ("不要控制在180字", None), ("不必限制在180字", None),
    ("不要把回答控制在180字", None), ("无需将回复限制在180字", None),
    ("最多180 words", None), ("不超过20字", None), ("不超过5000字", None),
])
def test_explicit_global_ceilings_only(text, expected):
    assert explicit_answer_char_limit(text) == expected


def test_count_includes_unicode_punctuation_and_citation_but_not_whitespace():
    assert answer_char_count("中 A🙂\n[K1] 。\t") == 8


class Model:
    def __init__(self, drafts):
        self.drafts = drafts
        self.requests = []

    async def stream_response(self, messages, **kwargs):
        self.requests.append((messages, kwargs))
        for chunk in self.drafts[len(self.requests) - 1]:
            if isinstance(chunk, BaseException):
                raise chunk
            yield chunk


def runtime(model, limit=80):
    return ChatRuntime(conv_id=1, selected_model="configured-model", llm=model, system="Authorized evidence [K1]",
                       api_messages=[{"role": "user", "content": "请回答，最多80字"}], rag_sources=[], tools=[],
                       max_tokens=2048, temperature=0, max_answer_chars=limit)


def run(model, *, limit=80):
    state = ChatSessionState(run_id="run_length_test")
    events = []
    async def consume():
        async for event in run_agent_loop(runtime(model, limit), SendMessageRequest(content="最多80字"), state):
            events.append(json.loads(event.removeprefix("data: ").strip()))
    asyncio.run(consume())
    return state, events


def test_passed_answer_is_emitted_once_in_each_contract_and_saved_exactly():
    state, events = run(Model([["有效结论", "，需要验证。[K1]"]]))
    assert state.full_text == "有效结论，需要验证。[K1]"
    for kind in ("text", "text_delta"):
        assert [event["content"] for event in events if event["type"] == kind] == [state.full_text]
    assert state.steps[0].model_text == state.full_text
    assert state.stage_timings["bounded_answer_ready_ms"] >= 0


@pytest.mark.parametrize("draft", ["长" * 90, "未完整回答" + OUTPUT_TRUNCATED_MARKER, ""])
def test_repair_requeries_original_authorized_context_without_leaking_bad_draft(draft):
    model = Model([[draft], ["保留限定的完整结论。[K1]"]])
    state, events = run(model)
    assert len(model.requests) == 2
    assert state.full_text == "保留限定的完整结论。[K1]"
    assert model.requests[0][1] == model.requests[1][1]
    assert model.requests[1][1]["tools"] == []
    assert model.requests[1][1]["model"] == "configured-model"
    assert "尚未交付" in model.requests[1][0][-1]["content"]
    assert not any(event.get("content") == draft for event in events if event["type"] in {"text", "text_delta"})
    assert [event["passed"] for event in state.trace_events if event["type"] == "answer_length_checked"] == [False, True]
    assert len(state.steps) == 1


def test_second_invalid_answer_fails_without_visible_or_checkpoint_text():
    model = Model([["第一稿" * 90], ["第二稿" * 90]])
    state = ChatSessionState()
    events = []
    async def consume():
        with pytest.raises(AnswerLengthError):
            async for event in run_agent_loop(runtime(model), SendMessageRequest(content="最多80字"), state):
                events.append(json.loads(event.removeprefix("data: ").strip()))
    asyncio.run(consume())
    assert len(model.requests) == 2
    assert state.full_text == state.steps[0].model_text == ""
    assert not any(event["type"] in {"text", "text_delta"} for event in events)


def test_provider_error_after_partial_text_is_not_retried_or_leaked():
    model = Model([["未验证的片段", RuntimeError("connection lost")]])
    state = ChatSessionState()
    async def consume():
        with pytest.raises(RuntimeError, match="connection lost"):
            async for _ in run_agent_loop(runtime(model), SendMessageRequest(content="最多80字"), state):
                pass
    asyncio.run(consume())
    assert len(model.requests) == 1
    assert state.full_text == ""


def test_cancellation_discards_unvalidated_draft_without_starting_repair():
    model = Model([["尚未验证的片段", asyncio.CancelledError()]])
    state = ChatSessionState()
    async def consume():
        with pytest.raises(asyncio.CancelledError):
            async for _ in run_agent_loop(runtime(model), SendMessageRequest(content="最多80字"), state):
                pass
    asyncio.run(consume())
    assert len(model.requests) == 1
    assert state.full_text == state.steps[0].model_text == ""


def test_unbounded_answers_keep_original_incremental_streaming():
    state, events = run(Model([["第一段", "第二段"]]), limit=0)
    assert [event["content"] for event in events if event["type"] == "text"] == ["第一段", "第二段"]
    assert state.full_text == "第一段第二段"
