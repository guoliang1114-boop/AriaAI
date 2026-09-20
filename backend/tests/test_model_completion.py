from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import claude, openai_compat
from app.services.model_completion import ModelCompletionError, anthropic_completion_text, completion_text


def _result(content=None, *, reasoning="PRIVATE_REASONING", finish="stop", calls=None):
    return {"choices": [{"finish_reason": finish, "message": {
        "content": content, "reasoning_content": reasoning, "tool_calls": calls,
    }}]}


def _call(arguments='{"query":"客户资料"}', call_id="call_1"):
    return {"id": call_id, "type": "function", "function": {
        "name": "search", "arguments": arguments,
    }}


@pytest.mark.parametrize("model,key_getter", [
    ("kimi-k3", "get_kimi_api_key"),
    ("deepseek-v4-pro", "get_deepseek_api_key"),
    ("mimo-v2.5-pro", "get_mimo_api_key"),
    ("glm-5", "get_bigmodel_api_key"),
])
@pytest.mark.parametrize("case", ["text", "tool", "reasoning_only", "truncated", "bad_tool"])
def test_provider_boundary_validates_final_output(monkeypatch, caplog, model, key_getter, case):
    response = _result("最终答复")
    expected_error = None
    if case == "tool":
        response = _result(finish="tool_calls", calls=[_call()])
    elif case == "reasoning_only":
        response = _result(reasoning='{"client_profile":"PRIVATE_REASONING"}')
        expected_error = "model_completion_no_final_content"
    elif case == "truncated":
        response = _result('{"client_profile":"looks complete"}', finish="length")
        expected_error = "model_completion_truncated"
    elif case == "bad_tool":
        response = _result("Partial answer", finish="tool_calls", calls=[_call('{"secret":"PRIVATE_ARGUMENT"')])
        expected_error = "model_completion_invalid_tool_input"
    post = AsyncMock(return_value=SimpleNamespace(status_code=200, json=lambda: response))
    monkeypatch.setattr(openai_compat, key_getter, lambda: "test-key")
    monkeypatch.setattr(openai_compat, "_get_http_client", lambda: SimpleNamespace(post=post))

    async def run():
        return await openai_compat.complete([{"role": "user", "content": "test"}], model=model)

    if expected_error:
        with pytest.raises(ModelCompletionError, match=f"^{expected_error}$"):
            asyncio.run(run())
    else:
        output = asyncio.run(run())
        assert "PRIVATE_REASONING" not in output
        if case == "text":
            assert output == "最终答复"
        else:
            assert json.loads(output) == {
                "type": "tool_use", "id": "call_1", "name": "search", "input": {"query": "客户资料"},
            }
    assert post.await_count == 1
    assert "PRIVATE_REASONING" not in caplog.text
    assert "PRIVATE_ARGUMENT" not in caplog.text


@pytest.mark.parametrize("arguments", [
    "", "null", "[]", "true", '"text"', '{"x":1,"x":2}',
    '{"nested":{"x":1,"x":2}}', '{"x":NaN}', '{"x":Infinity}',
    '{"x":-Infinity}', '{"x":1e400}', {"x": 1}, None,
])
def test_tool_arguments_fail_closed_instead_of_becoming_empty_input(arguments):
    with pytest.raises(ModelCompletionError):
        completion_text(_result("Do not return partial text", calls=[_call(arguments)]))


def test_duplicate_tool_ids_reject_entire_batch():
    with pytest.raises(ModelCompletionError, match="model_completion_duplicate_tool_id"):
        completion_text(_result(calls=[_call(), _call('{"query":"second"}')]))


@pytest.mark.parametrize("result", [
    None, [], {}, {"choices": []}, {"choices": [None]}, {"choices": [{"message": []}]},
    _result(" " ), _result([{"text": "unsupported"}]), _result("filtered", finish="content_filter"),
    _result("paused", finish="pause_turn"), _result(finish="tool_calls"),
    _result(calls={}), _result(calls=[None]), _result(calls=[{"function": {}}]),
    {"choices": [{"message": {"content": "ignored", "refusal": "refused"}}]},
])
def test_incomplete_or_invalid_response_fails_closed(result):
    with pytest.raises(ModelCompletionError):
        completion_text(result)


def test_legacy_response_without_finish_reason_still_accepts_final_content():
    assert completion_text({"choices": [{"message": {"content": "Valid final"}}]}) == "Valid final"


def test_valid_text_and_multiple_tools_preserve_order_and_exact_inputs():
    output = completion_text(_result("Answer", calls=[_call(), _call('{"n":1.5,"ok":true}', "call_2")]))
    parts = output.splitlines()
    assert parts[0] == "Answer"
    assert [json.loads(part)["id"] for part in parts[1:]] == ["call_1", "call_2"]
    assert json.loads(parts[2])["input"] == {"n": 1.5, "ok": True}


@pytest.mark.parametrize("http", [True, False])
@pytest.mark.parametrize("case", ["text", "tool", "reasoning_only", "truncated", "paused", "bad_tool"])
def test_claude_http_and_sdk_share_final_output_contract(monkeypatch, caplog, http, case):
    from anthropic.types import Message

    response = {
        "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-test",
        "usage": {"input_tokens": 10, "output_tokens": 20}, "stop_reason": "end_turn",
        "content": [{"type": "thinking", "thinking": "PRIVATE_REASONING", "signature": "sig"}],
    }
    expected_error = None
    if case == "text":
        response["content"] += [{"type": "text", "text": "First"}, {"type": "text", "text": "Second"}]
    elif case in ("tool", "bad_tool"):
        response["stop_reason"] = "tool_use"
        response["content"].append({"type": "tool_use", "id": "call_1", "name": "search", "input": {"query": "ok"} if case == "tool" else []})
        if case == "bad_tool":
            expected_error = "model_completion_invalid_tool_input"
    elif case == "truncated":
        response["stop_reason"] = "max_tokens"
        response["content"].append({"type": "text", "text": '{"client_profile":"looks complete"}'})
        expected_error = "model_completion_truncated"
    elif case == "paused":
        response["stop_reason"] = "pause_turn"
        expected_error = "model_completion_not_completed"
    else:
        expected_error = "model_completion_no_final_content"

    post = AsyncMock(return_value=SimpleNamespace(status_code=200, json=lambda: response))
    create = AsyncMock(return_value=Message.model_construct(**response))
    monkeypatch.setattr(claude, "_should_use_http_mode", lambda: http)
    monkeypatch.setattr(claude, "get_api_key", lambda: "test-key")
    monkeypatch.setattr(claude, "_get_base_url", lambda: "https://example.invalid")
    monkeypatch.setattr(claude, "_get_http_client", lambda: SimpleNamespace(post=post))
    monkeypatch.setattr(claude, "_async_client_sdk", lambda: SimpleNamespace(messages=SimpleNamespace(create=create)))
    if expected_error:
        with pytest.raises(ModelCompletionError, match=f"^{expected_error}$"):
            asyncio.run(claude.complete([{"role": "user", "content": "test"}]))
    else:
        output = asyncio.run(claude.complete([{"role": "user", "content": "test"}]))
        assert "PRIVATE_REASONING" not in output
        if case == "text":
            assert output == "First\nSecond"
        else:
            assert json.loads(output) == {"type": "tool_use", "id": "call_1", "name": "search", "input": {"query": "ok"}}
    assert (post.await_count, create.await_count) == ((1, 0) if http else (0, 1))
    assert "PRIVATE_REASONING" not in caplog.text


@pytest.mark.parametrize("input_value", [None, [], float("nan"), {"x": float("inf")}])
def test_claude_rejects_invalid_tool_objects(input_value):
    with pytest.raises(ModelCompletionError):
        anthropic_completion_text({"stop_reason": "tool_use", "content": [{
            "type": "tool_use", "id": "call_1", "name": "write", "input": input_value,
        }]})


@pytest.mark.parametrize("stop_reason", [[], {}, 12])
def test_claude_rejects_malformed_completion_status(stop_reason):
    with pytest.raises(ModelCompletionError, match="model_completion_invalid_response"):
        anthropic_completion_text({"stop_reason": stop_reason, "content": [{"type": "text", "text": "partial"}]})
