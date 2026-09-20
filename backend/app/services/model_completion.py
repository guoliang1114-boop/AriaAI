"""Validate final output at the non-streaming model-provider boundary."""
from __future__ import annotations

import json
import math
from typing import Any


class ModelCompletionError(ValueError):
    """Content-free failure suitable for native error receipts and logs."""


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ModelCompletionError("model_completion_ambiguous_tool_input")
        result[key] = value
    return result


def _invalid_constant(_value: str) -> None:
    raise ModelCompletionError("model_completion_invalid_tool_input")


def _finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ModelCompletionError("model_completion_invalid_tool_input")
    return parsed


def completion_text(result: Any) -> str:
    """Return final text/tool calls, never reasoning or a partial completion.

    A complete response is not business authorization. Native tool policy,
    HITAS, scope checks, and final write authorization still apply downstream.
    """
    choices = result.get("choices") if isinstance(result, dict) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ModelCompletionError("model_completion_invalid_response")
    choice = choices[0]
    finish_reason = choice.get("finish_reason")
    if finish_reason == "length":
        raise ModelCompletionError("model_completion_truncated")
    if finish_reason not in (None, "stop", "tool_calls"):
        raise ModelCompletionError("model_completion_not_completed")
    message = choice.get("message")
    if not isinstance(message, dict):
        raise ModelCompletionError("model_completion_invalid_response")
    if message.get("refusal"):
        raise ModelCompletionError("model_completion_refused")
    text = message.get("content")
    if text is not None and not isinstance(text, str):
        raise ModelCompletionError("model_completion_invalid_content")
    # reasoning_content is internal provider state, including when content is
    # empty. It must never become an answer, summary, or persisted memory.
    parts = [text] if text and text.strip() else []
    calls = message.get("tool_calls")
    if calls is None:
        calls = []
    if not isinstance(calls, list):
        raise ModelCompletionError("model_completion_invalid_tool_call")
    if finish_reason == "tool_calls" and not calls:
        raise ModelCompletionError("model_completion_invalid_tool_call")
    seen_ids: set[str] = set()
    for call in calls:
        function = call.get("function") if isinstance(call, dict) else None
        if not isinstance(function, dict) or call.get("type", "function") != "function":
            raise ModelCompletionError("model_completion_invalid_tool_call")
        call_id = call.get("id")
        name = function.get("name")
        if not isinstance(call_id, str) or not call_id.strip() or not isinstance(name, str) or not name.strip():
            raise ModelCompletionError("model_completion_invalid_tool_call")
        if call_id in seen_ids:
            raise ModelCompletionError("model_completion_duplicate_tool_id")
        seen_ids.add(call_id)
        arguments = function.get("arguments")
        if not isinstance(arguments, str):
            raise ModelCompletionError("model_completion_invalid_tool_input")
        try:
            parsed = json.loads(arguments, object_pairs_hook=_strict_object, parse_constant=_invalid_constant, parse_float=_finite_float)
        except ModelCompletionError:
            raise
        except (ValueError, RecursionError):
            raise ModelCompletionError("model_completion_invalid_tool_input") from None
        if not isinstance(parsed, dict):
            raise ModelCompletionError("model_completion_invalid_tool_input")
        parts.append(json.dumps({"type": "tool_use", "id": call_id, "name": name, "input": parsed}, ensure_ascii=False))
    if not parts:
        raise ModelCompletionError("model_completion_no_final_content")
    return "\n".join(parts)


def anthropic_completion_text(result: Any) -> str:
    """Apply the same final-output contract to Claude HTTP and SDK responses."""
    if not isinstance(result, dict):
        raise ModelCompletionError("model_completion_invalid_response")
    stop_reason = result.get("stop_reason")
    if stop_reason is not None and not isinstance(stop_reason, str):
        raise ModelCompletionError("model_completion_invalid_response")
    finish_reason = {
        "end_turn": "stop", "stop_sequence": "stop",
        "tool_use": "tool_calls", "max_tokens": "length",
    }.get(stop_reason, stop_reason)
    # Validate completion status before examining any potentially partial block.
    if finish_reason == "length":
        raise ModelCompletionError("model_completion_truncated")
    if finish_reason not in (None, "stop", "tool_calls"):
        raise ModelCompletionError("model_completion_not_completed")
    blocks = result.get("content")
    if not isinstance(blocks, list):
        raise ModelCompletionError("model_completion_invalid_response")
    texts, calls = [], []
    for block in blocks:
        if not isinstance(block, dict):
            raise ModelCompletionError("model_completion_invalid_content")
        block_type = block.get("type")
        if block_type == "text":
            if not isinstance(block.get("text"), str):
                raise ModelCompletionError("model_completion_invalid_content")
            texts.append(block["text"])
        elif block_type == "tool_use":
            try:
                arguments = json.dumps(block.get("input"), ensure_ascii=False, allow_nan=False)
            except (TypeError, ValueError, RecursionError):
                raise ModelCompletionError("model_completion_invalid_tool_input") from None
            calls.append({"id": block.get("id"), "type": "function", "function": {
                "name": block.get("name"), "arguments": arguments,
            }})
        elif block_type not in ("thinking", "redacted_thinking"):
            raise ModelCompletionError("model_completion_invalid_content")
    return completion_text({"choices": [{"finish_reason": finish_reason, "message": {
        "content": "\n".join(texts), "tool_calls": calls,
    }}]})
