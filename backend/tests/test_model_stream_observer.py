from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.routers.chat_schemas import SendMessageRequest
from app.services import openai_compat
from app.services.chat import agent_loop
from app.services.chat.runtime import _bounded_rewrite_effort
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime
from app.services.model_stream_observer import ModelStreamObserver, ModelStreamIdleTimeout


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["http", "sdk"])
async def test_claude_observes_each_phase_without_exposing_thinking(monkeypatch, mode):
    from app.services import claude

    observer = ModelStreamObserver()
    raw = [
        {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "PRIVATE_REASONING"}},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "answer"}},
        {"type": "content_block_start", "content_block": {"type": "tool_use", "id": "t1", "name": "read_project", "input": {}}},
        {"type": "content_block_delta", "delta": {"type": "input_json_delta", "partial_json": '{"project_id":1}'}},
        {"type": "content_block_stop"},
    ]

    class Stream:
        status_code = 200
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def aiter_lines(self):
            for event in raw:
                yield "data: " + json.dumps(event)
        def __aiter__(self):
            return self.events()
        async def events(self):
            yield SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(thinking="PRIVATE_REASONING"))
            yield SimpleNamespace(type="text", text="answer")
            yield SimpleNamespace(type="content_block_start", content_block=SimpleNamespace(**raw[2]["content_block"]))
            yield SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(partial_json='{"project_id":1}'))
            yield SimpleNamespace(type="content_block_stop", content_block=SimpleNamespace(type="tool_use", id="t1", name="read_project", input={"project_id": 1}))
        async def get_final_message(self):
            return SimpleNamespace(stop_reason="end_turn")

    client = SimpleNamespace(stream=lambda *args, **kwargs: Stream())
    monkeypatch.setattr(claude, "_get_http_client", lambda: client)
    monkeypatch.setattr(claude, "_async_client_sdk", lambda: SimpleNamespace(messages=client))
    monkeypatch.setattr(claude, "get_api_key", lambda: "test")
    monkeypatch.setattr(claude, "_get_base_url", lambda: "https://example.invalid")
    monkeypatch.setattr(claude, "_should_use_http_mode", lambda: mode == "http")
    chunks = [value async for value in claude.stream_response(
        [{"role": "user", "content": "question"}], observer=observer)]
    assert chunks[0] == "answer"
    assert json.loads(chunks[-1])["input"] == {"project_id": 1}
    assert "PRIVATE_REASONING" not in "".join(chunks) + json.dumps(observer.timings())
    assert set(observer.first) == {"headers", "reasoning", "text", "tool"}


def test_content_free_phase_timings_and_real_progress_only():
    now = [0.0]
    observer = ModelStreamObserver(clock=lambda: now[0])
    now[0] = 1
    observer.mark("headers")
    assert not observer.committed
    now[0] = 59
    assert observer.heartbeat()["stage"] == "model_waiting"
    observer.mark("reasoning")
    now[0] = 70
    assert "正在思考" in observer.heartbeat()["message"]
    observer.mark("text")
    assert observer.timings() == {"provider_headers_ms": 1000, "provider_reasoning_ms": 59000, "provider_text_ms": 70000}
    assert observer.committed
    now[0] = 130
    with pytest.raises(ModelStreamIdleTimeout):
        observer.heartbeat()


def test_headers_and_local_heartbeats_never_extend_silence_deadline():
    now = [0.0]
    observer = ModelStreamObserver(clock=lambda: now[0])
    for value in (1, 20, 40, 59):
        now[0] = value
        observer.mark("headers")
        observer.heartbeat()
    now[0] = 60
    with pytest.raises(ModelStreamIdleTimeout):
        observer.heartbeat()
    assert not observer.committed


@pytest.mark.parametrize("model,content,limit,skill,configured,extras,expected", [
    ("kimi-k3", "请把上述回答压缩成两条。不超过120字。", 120, False, "low", {}, "low"),
    ("kimi-k3", "请把上述回答压缩成两条。不超过120字。", 120, False, "default", {}, ""),
    ("kimi-k3", "请把上述回答压缩成两条。不超过120字。", 120, False, "invalid", {}, ""),
    ("kimi-k2.6", "压缩成两条", 120, False, "low", {}, ""),
    ("kimi-k3", "压缩成两条", None, False, "low", {}, ""),
    ("kimi-k3", "压缩成两条", 120, True, "low", {}, ""),
    ("kimi-k3", "压缩成两条", 120, False, "low", {"file_ids": [1]}, ""),
    ("kimi-k3", "压缩成两条", 120, False, "low", {"turn_brief": {"goal": "深入分析"}}, ""),
    ("kimi-k3", "继续展开说明。不超过120字。", 120, False, "low", {}, ""),
    ("kimi-k3", "分析市场预算，不超过120字。", 120, False, "low", {}, ""),
    ("kimi-k3", "压缩成两条，并修改项目", 120, False, "low", {}, ""),
])
def test_effort_policy_is_narrow_and_never_switches_models(model, content, limit, skill, configured, extras, expected):
    req = SendMessageRequest(content=content, **extras)
    assert _bounded_rewrite_effort(req, model=model, limit=limit, has_skill=skill, configured=configured) == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("model,effort,expected", [("kimi-k3", "low", "low"), ("kimi-k3", None, None), ("kimi-k2.6", "low", None)])
async def test_kimi_observation_never_emits_reasoning_and_payload_is_model_scoped(monkeypatch, model, effort, expected):
    payloads = []
    async def stream(_client, _headers, payload, observer=None):
        payloads.append(payload)
        observer.mark("headers")
        for delta in [{"reasoning_content": "PRIVATE_THOUGHT"}, {"content": "答复"}]:
            yield "data: " + json.dumps({"choices": [{"delta": delta}]})
        yield "data: [DONE]"
    monkeypatch.setattr(openai_compat, "_stream_once", stream)
    monkeypatch.setattr(openai_compat, "get_kimi_api_key", lambda: "test")
    monkeypatch.setattr(openai_compat, "_get_http_client", lambda: object())
    observer = ModelStreamObserver()
    chunks = [value async for value in openai_compat.stream_response(
        [{"role": "user", "content": "question"}], model=model, observer=observer, reasoning_effort=effort)]
    assert chunks == ["答复"]
    assert payloads[0].get("reasoning_effort") == expected
    assert payloads[0]["model"] == model
    assert "PRIVATE_THOUGHT" not in json.dumps(observer.timings())
    assert set(observer.first) == {"headers", "reasoning", "text"}


def runtime(stream):
    return ChatRuntime(conv_id=1, selected_model="kimi-k3",
                       llm=SimpleNamespace(supports_stream_observer=True, stream_response=stream),
                       system="system", api_messages=[], rag_sources=[], tools=[], max_tokens=1024, temperature=1)


@pytest.mark.asyncio
async def test_reasoning_closes_retry_window_before_any_visible_output():
    calls = []
    async def stream(*args, observer, **kwargs):
        calls.append(kwargs)
        observer.mark("reasoning")
        raise TimeoutError("disconnected after reasoning")
        yield "unreachable"
    state = ChatSessionState()
    with pytest.raises(TimeoutError):
        _ = [item async for item in agent_loop._iter_model_stream_with_safe_retry(runtime(stream), state, [], "system", stream_label="step_0")]
    assert len(calls) == 1
    assert state.trace_events[-1]["type"] == "model_turn_retry_suppressed"
    assert state.full_text == ""


@pytest.mark.asyncio
async def test_silence_timeout_cancels_inflight_stream_without_retry(monkeypatch):
    now = [0.0]
    calls, closed = [], []
    monkeypatch.setattr(agent_loop, "ModelStreamObserver", lambda **kwargs: ModelStreamObserver(clock=lambda: now[0], **kwargs))
    original_heartbeat = agent_loop.iter_with_heartbeat
    monkeypatch.setattr(agent_loop, "iter_with_heartbeat", lambda source, **kwargs: original_heartbeat(source, seconds=0.001, **kwargs))
    async def stream(*args, observer, **kwargs):
        calls.append(1)
        try:
            observer.mark("headers")
            now[0] = 61
            await asyncio.Event().wait()
            yield "unreachable"
        finally:
            closed.append(True)
    state = ChatSessionState()
    with pytest.raises(ModelStreamIdleTimeout):
        _ = [item async for item in agent_loop._iter_model_stream_with_safe_retry(runtime(stream), state, [], "system", stream_label="step_0")]
    assert calls == [1] and closed == [True]
    assert state.trace_events[-1]["type"] == "model_stream_idle_timeout"
    assert not state.stage_timings.get("model_retry_count")


@pytest.mark.asyncio
async def test_pre_progress_retry_keeps_first_attempt_metrics_separate():
    calls = []
    async def stream(*args, observer, **kwargs):
        calls.append(1)
        observer.mark("headers")
        if len(calls) == 1:
            raise TimeoutError("before model progress")
        observer.mark("reasoning")
        observer.mark("text")
        yield "answer"
    rt, state = runtime(stream), ChatSessionState()
    rt.model_turn_retry_base_delay_ms = 0
    values = [item async for item in agent_loop._iter_model_stream_with_safe_retry(rt, state, [], "system", stream_label="step_0")]
    assert len(calls) == 2 and values[-1] == "answer"
    assert "provider_headers_ms" in state.stage_timings and "provider_text_ms" not in state.stage_timings
    observations = [event for event in state.trace_events if event["type"] == "model_response_observed"]
    assert len(observations) == 2 and "provider_text_ms" in observations[1]["timings"]


@pytest.mark.asyncio
async def test_user_cancellation_closes_observed_request_without_retry():
    started = asyncio.Event()
    closed, calls = [], []
    async def stream(*args, observer, **kwargs):
        calls.append(1)
        try:
            observer.mark("reasoning")
            started.set()
            await asyncio.Event().wait()
            yield "unreachable"
        finally:
            closed.append(True)
    state = ChatSessionState()
    async def consume():
        return [item async for item in agent_loop._iter_model_stream_with_safe_retry(runtime(stream), state, [], "system", stream_label="step_0")]
    task = asyncio.create_task(consume())
    await started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert calls == [1] and closed == [True]
    assert not any(event["type"] == "model_turn_retry_scheduled" for event in state.trace_events)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider,model", [("deepseek", "deepseek-v4-pro"), ("bigmodel", "glm-5.3"), ("mimo", "mimo-v2.5-flash")])
async def test_compatible_providers_report_hidden_progress_without_changing_payload(monkeypatch, provider, model):
    payloads = []
    async def stream(*args, observer=None):
        payloads.append(args[-1])
        observer.mark("headers")
        for delta in [{"reasoning_content": "PRIVATE_REASONING"}, {"content": "回答"}]:
            yield "data: " + json.dumps({"choices": [{"delta": delta}]})
        yield "data: [DONE]"
    monkeypatch.setattr(openai_compat, f"_stream_{provider}_once", stream)
    monkeypatch.setattr(openai_compat, f"get_{provider}_api_key", lambda: "test")
    monkeypatch.setattr(openai_compat, "_get_http_client", lambda: object())
    observer = ModelStreamObserver()
    chunks = [chunk async for chunk in openai_compat.stream_response([], model=model, observer=observer)]
    assert "回答" in chunks
    assert set(observer.first) == {"headers", "reasoning", "text"}
    assert observer.committed
    assert "reasoning_effort" not in payloads[0]
    assert "PRIVATE" not in json.dumps(observer.timings())


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["deepseek-v4-pro", "glm-5.3", "mimo-v2.5-flash", "claude-sonnet-4-6"])
async def test_all_observed_models_stop_retry_after_hidden_reasoning(model):
    calls = []
    async def stream(*args, observer, **kwargs):
        calls.append(1)
        observer.mark("reasoning")
        raise TimeoutError("after hidden progress")
        yield "unreachable"
    rt = runtime(stream)
    rt.selected_model = model
    with pytest.raises(TimeoutError):
        _ = [item async for item in agent_loop._iter_model_stream_with_safe_retry(rt, ChatSessionState(), [], "system", stream_label="step_0")]
    assert calls == [1]
