from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services.agent_harness.turn_retry import (
    ModelProviderHTTPError,
    TurnRetryCategory,
    decide_turn_retry,
    deterministic_backoff_ms,
    normalize_max_attempts,
    parse_retry_after_ms,
)
from app.services.chat.agent_loop import _iter_model_stream_with_safe_retry
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime


def _runtime(stream_response, *, max_attempts: int = 2) -> ChatRuntime:
    return ChatRuntime(
        conv_id=1,
        selected_model="test-model",
        llm=SimpleNamespace(stream_response=stream_response),
        system="system",
        api_messages=[{"role": "user", "content": "hello"}],
        rag_sources=[],
        tools=None,
        max_tokens=512,
        temperature=0.2,
        model_turn_max_attempts=max_attempts,
        model_turn_retry_base_delay_ms=0,
        model_turn_retry_max_delay_ms=5_000,
    )


def test_deterministic_backoff_and_attempt_clamp() -> None:
    assert deterministic_backoff_ms(1, base_delay_ms=500, max_delay_ms=5_000) == 500
    assert deterministic_backoff_ms(2, base_delay_ms=500, max_delay_ms=5_000) == 1_000
    assert deterministic_backoff_ms(8, base_delay_ms=500, max_delay_ms=5_000) == 5_000
    assert normalize_max_attempts(0) == 1
    assert normalize_max_attempts(99) == 3


def test_retry_after_parses_seconds_and_http_date() -> None:
    assert parse_retry_after_ms("1.5") == 1_500
    now = datetime(2026, 8, 23, 0, 0, 0, tzinfo=timezone.utc)
    assert parse_retry_after_ms("Sun, 23 Aug 2026 00:00:02 GMT", now=now) == 2_000


def test_temporary_rate_limit_honors_retry_after() -> None:
    exc = ModelProviderHTTPError(
        "Kimi",
        429,
        body='{"error":{"code":"rate_limit_exceeded"}}',
        headers={"Retry-After": "1.25"},
    )

    decision = decide_turn_retry(exc, attempt=1, max_attempts=2)

    assert decision.retryable is True
    assert decision.category is TurnRetryCategory.RATE_LIMIT
    assert decision.delay_ms == 1_250
    assert decision.retry_after_ms == 1_250
    assert decision.status_code == 429


@pytest.mark.parametrize(
    ("exc", "reason"),
    [
        (ModelProviderHTTPError("provider", 401, body="invalid api key"), "invalid_request"),
        (
            ModelProviderHTTPError("provider", 429, body='{"code":"insufficient_quota"}'),
            "quota_or_billing",
        ),
        (ValueError("context_length_exceeded"), "invalid_request"),
    ],
)
def test_permanent_errors_are_not_retried(exc: Exception, reason: str) -> None:
    decision = decide_turn_retry(exc, attempt=1, max_attempts=2)

    assert decision.retryable is False
    assert decision.category is TurnRetryCategory.NON_RETRYABLE
    assert decision.reason == reason


def test_transient_failures_are_bounded() -> None:
    first = decide_turn_retry(TimeoutError("timed out"), attempt=1, max_attempts=2)
    exhausted = decide_turn_retry(TimeoutError("timed out"), attempt=2, max_attempts=2)
    overloaded = decide_turn_retry(
        ModelProviderHTTPError("provider", 529),
        attempt=1,
        max_attempts=2,
    )
    headerless_rate_limit = decide_turn_retry(
        RuntimeError("rate_limit_exceeded: try again in 20ms"),
        attempt=1,
        max_attempts=2,
    )

    assert first.retryable is True
    assert exhausted.retryable is False
    assert exhausted.reason == "attempts_exhausted"
    assert overloaded.retryable is True
    assert overloaded.category is TurnRetryCategory.TRANSIENT
    assert headerless_rate_limit.retryable is True
    assert headerless_rate_limit.delay_ms == 20


def test_retry_after_beyond_wait_budget_is_not_replayed_early() -> None:
    exc = ModelProviderHTTPError("provider", 429, headers={"Retry-After": "30"})
    decision = decide_turn_retry(
        exc,
        attempt=1,
        max_attempts=2,
        max_delay_ms=5_000,
    )

    assert decision.retryable is False
    assert decision.reason == "retry_after_exceeds_budget"
    assert decision.retry_after_ms == 30_000


def test_committed_response_is_never_retried() -> None:
    decision = decide_turn_retry(
        ModelProviderHTTPError("provider", 503),
        attempt=1,
        max_attempts=3,
        response_committed=True,
    )

    assert decision.retryable is False
    assert decision.reason == "response_committed"
    assert decision.response_committed is True


@pytest.mark.asyncio
async def test_agent_loop_retries_pre_output_failure_with_same_request() -> None:
    calls: list[tuple[list[dict], str]] = []

    async def stream_response(messages, *, system, **_kwargs):
        calls.append((messages, system))
        if len(calls) == 1:
            raise TimeoutError("connection timed out")
        yield "recovered"

    runtime = _runtime(stream_response)
    state = ChatSessionState()
    request_messages = [{"role": "user", "content": "same request"}]
    items = [
        item
        async for item in _iter_model_stream_with_safe_retry(
            runtime,
            state,
            request_messages,
            "same system",
            stream_label="agent_step_0",
        )
    ]

    assert len(calls) == 2
    assert calls[0][0] is request_messages
    assert calls[1][0] is request_messages
    assert calls[0][1] == calls[1][1] == "same system"
    assert items[-1] == "recovered"
    assert items[0]["stage"] == "model_retry"
    assert state.stage_timings["model_retry_count"] == 1
    assert state.trace_events[-1]["type"] == "model_turn_retry_scheduled"


@pytest.mark.asyncio
async def test_aria_heartbeat_does_not_close_retry_window(monkeypatch) -> None:
    import app.services.chat.agent_loop as agent_loop

    calls = 0

    async def stream_response(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise TimeoutError("server disconnected")
        yield "ok"

    async def heartbeat_then_source(source, **_kwargs):
        yield {"type": "status", "stage": "thinking", "message": "heartbeat"}
        async for item in source:
            yield item

    monkeypatch.setattr(agent_loop, "iter_with_heartbeat", heartbeat_then_source)
    runtime = _runtime(stream_response)
    state = ChatSessionState()
    items = [
        item
        async for item in _iter_model_stream_with_safe_retry(
            runtime,
            state,
            runtime.api_messages,
            runtime.system,
            stream_label="agent_step_0",
        )
    ]

    assert calls == 2
    assert [item for item in items if item == "ok"] == ["ok"]
    assert sum(isinstance(item, dict) and item.get("stage") == "model_retry" for item in items) == 1


@pytest.mark.asyncio
async def test_partial_text_closes_retry_window_and_is_not_duplicated() -> None:
    calls = 0

    async def stream_response(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        yield "partial"
        raise TimeoutError("server disconnected")

    runtime = _runtime(stream_response, max_attempts=3)
    state = ChatSessionState()
    items: list[str | dict] = []

    with pytest.raises(TimeoutError):
        async for item in _iter_model_stream_with_safe_retry(
            runtime,
            state,
            runtime.api_messages,
            runtime.system,
            stream_label="agent_step_0",
        ):
            items.append(item)

    assert calls == 1
    assert items == ["partial"]
    assert state.trace_events[-1]["type"] == "model_turn_retry_suppressed"
    assert state.trace_events[-1]["response_committed"] is True


@pytest.mark.asyncio
async def test_tool_plan_event_closes_retry_window_before_execution() -> None:
    calls = 0
    tool_plan = '{"type":"tool_use","id":"call_1","name":"write_file","input":{}}'

    async def stream_response(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        yield tool_plan
        raise TimeoutError("connection reset")

    runtime = _runtime(stream_response, max_attempts=3)
    state = ChatSessionState()
    items: list[str | dict] = []

    with pytest.raises(TimeoutError):
        async for item in _iter_model_stream_with_safe_retry(
            runtime,
            state,
            runtime.api_messages,
            runtime.system,
            stream_label="agent_step_0",
        ):
            items.append(item)

    assert calls == 1
    assert items == [tool_plan]
    assert state.trace_events[-1]["reason"] == "response_committed"


@pytest.mark.asyncio
async def test_cancellation_is_propagated_without_retry() -> None:
    calls = 0

    async def stream_response(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise asyncio.CancelledError()
        yield "unreachable"  # pragma: no cover

    runtime = _runtime(stream_response, max_attempts=3)
    state = ChatSessionState()

    with pytest.raises(asyncio.CancelledError):
        async for _item in _iter_model_stream_with_safe_retry(
            runtime,
            state,
            runtime.api_messages,
            runtime.system,
            stream_label="agent_step_0",
        ):
            pass

    assert calls == 1
    assert state.trace_events == []


class _FakeStreamResponse:
    def __init__(self, *, status_code: int = 200, lines: list[str] | None = None) -> None:
        self.status_code = status_code
        self.headers = {"Retry-After": "1"}
        self._lines = list(lines or [])

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def aread(self) -> bytes:
        return b'{"error":{"code":"rate_limit_exceeded"}}'

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _FakeStreamClient:
    def __init__(self, response: _FakeStreamResponse) -> None:
        self.response = response
        self.calls = 0

    def stream(self, *_args, **_kwargs):
        self.calls += 1
        return self.response


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["kimi", "deepseek", "mimo", "bigmodel"])
async def test_openai_compatible_provider_streams_make_one_attempt(provider: str) -> None:
    from app.services import openai_compat

    client = _FakeStreamClient(_FakeStreamResponse(status_code=429))
    if provider == "kimi":
        source = openai_compat._stream_once(client, {}, {})
    elif provider == "deepseek":
        source = openai_compat._stream_deepseek_once(client, {}, {})
    elif provider == "mimo":
        source = openai_compat._stream_mimo_once(client, "https://example.test", {}, {})
    else:
        source = openai_compat._stream_bigmodel_once(client, {}, {})

    with pytest.raises(ModelProviderHTTPError) as raised:
        async for _line in source:
            pass

    assert client.calls == 1
    assert raised.value.status_code == 429
    assert raised.value.headers["Retry-After"] == "1"
