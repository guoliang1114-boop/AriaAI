"""Agent loop — the unified streaming + tool-execution core.

Replaces the P1 → P2 → P3 cascade with a single ``while`` loop that mirrors
how Claude Code and similar agents drive a tool-using LLM:

    repeat up to MAX_AGENT_STEPS times:
        text, tool_calls = stream one LLM turn
        if no tool_calls: break
        for each tool_call: execute via tool_executor → tool_result
        append tool_results back into the messages list
        emit ``agent_step`` event

Behavioral contract preserved from the old pipeline:
    * tool_use JSON blocks are extracted from both native and mixed-text formats
    * truncation auto-continues once at step 0 when no tool was emitted
    * markdown inline-display text is streamed before tool execution returns
    * HITAS confirmation halts the loop and persists pending actions
    * SSE events emitted are a superset of what P1+P2+P3 emit today
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.agent_step import AgentStep, build_agent_step_event
from app.services.chat.sse import iter_with_heartbeat, sse_event
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import execute_tool_with_policy
from app.services.chat.tool_repair import extract_tool_use_json_blocks
from app.services.chat.truncation import strip_truncation_marker
from app.services.chat.workflow import workflow_plan_events
from app.services.chat_tools import (
    ChatRuntime,
    _strip_internal_tool_markers,
    _tool_start_progress_payload,
)
from app.services.policy_guards import policy_allows_tool

logger = logging.getLogger(__name__)

MAX_AGENT_STEPS = 8
_CONTINUATION_PROMPT = (
    "请从上一条回复被截断的位置继续，补齐后续内容和关键论证。"
    "不要重复已经写过的内容，不要调用工具。"
)


# ----------------------------------------------------------------------
# Stream consumption — one LLM call → text + tool_calls
# ----------------------------------------------------------------------


@dataclass
class _StreamResult:
    """Aggregates produced while draining one LLM stream.

    Events are *yielded* live by ``_consume_stream``; these fields hold the
    end-of-turn rollup the caller needs (final text, planned tool calls,
    extended-thinking reasoning, and whether the output was truncated).
    """

    text: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    reasoning: str = ""
    truncated: bool = False


async def _consume_stream(
    runtime: ChatRuntime,
    state: ChatSessionState,
    messages: list[dict],
    *,
    step_index: int,
    stream_label: str,
    result: _StreamResult,
) -> AsyncIterator[str]:
    """Drain a single ``stream_response`` call, yielding SSE frames as they arrive.

    Text deltas, heartbeats and status frames are yielded the moment the model
    produces them, so the frontend renders the reply progressively instead of in
    one burst at end-of-turn. User-visible text, planned tool calls, reasoning
    and the truncation flag are accumulated into ``result`` for the caller.
    """
    started_at = time.perf_counter()

    async for item in iter_with_heartbeat(
        runtime.llm.stream_response(
            messages,
            system=runtime.system,
            model=runtime.selected_model,
            tools=runtime.tools,
            max_tokens=runtime.max_tokens,
            temperature=runtime.temperature,
        ),
        stage="thinking",
        message="模型仍在生成中，请稍候...",
    ):
        if isinstance(item, dict):
            yield sse_event(item)
            continue

        chunk: str = item
        if not state.first_model_event_recorded:
            state.first_model_event_recorded = True
            state.stage_timings["model_first_event_ms"] = round((time.perf_counter() - started_at) * 1000)
            yield sse_event(
                {
                    "type": "timing",
                    "key": "model_first_event_ms",
                    "duration_ms": state.stage_timings["model_first_event_ms"],
                }
            )

        chunk, was_truncated = strip_truncation_marker(chunk)
        if was_truncated:
            result.truncated = True
            yield sse_event(
                {
                    "type": "status",
                    "stage": "continuing",
                    "message": "模型输出较长，已触发长度上限，正在尝试继续生成...",
                }
            )
            if not chunk:
                continue

        stripped = chunk.strip()

        # Internal "[TOOL_START:name]" progress marker
        if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
            tool_name = stripped[12:-1]
            allowed, reason, required = policy_allows_tool(runtime.action_policy, tool_name, {})
            if not allowed:
                state.record_trace_event(
                    "tool_marker_suppressed",
                    stage=stream_label,
                    tool_name=tool_name,
                    reason=reason,
                    required_policy=required.value,
                    current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
                )
                continue
            progress = _tool_start_progress_payload(tool_name)
            if progress:
                yield sse_event({"type": "tool_executing", "tool_name": tool_name, **progress})
            continue

        chunk = _strip_internal_tool_markers(chunk)
        if not chunk:
            continue
        stripped = chunk.strip()

        # Mixed-text tool_use JSON blocks
        mixed, cleaned = extract_tool_use_json_blocks(chunk)
        if mixed:
            for block in mixed:
                if _accept_tool_block(runtime, state, block, stream_label, source="text"):
                    result.tool_calls.append(block)
                    yield sse_event(
                        {
                            "type": "status",
                            "stage": "tool_planned",
                            "message": f"模型已规划调用工具：{block.get('name')}",
                        }
                    )
            if cleaned:
                result.text += cleaned
                yield sse_event({"type": "text", "content": cleaned})
            continue

        # Pure JSON tool_use / reasoning_content envelope
        if stripped.startswith("{") and stripped.endswith("}") and '"type"' in stripped:
            try:
                block = json.loads(stripped)
            except json.JSONDecodeError:
                block = None
            if isinstance(block, dict):
                if block.get("type") == "tool_use":
                    if _accept_tool_block(runtime, state, block, stream_label, source="json"):
                        result.tool_calls.append(block)
                        yield sse_event(
                            {
                                "type": "status",
                                "stage": "tool_planned",
                                "message": f"模型已规划调用工具：{block.get('name')}",
                            }
                        )
                    continue
                if block.get("type") == "reasoning_content":
                    result.reasoning += str(block.get("content") or "")
                    continue

        result.text += chunk
        yield sse_event({"type": "text", "content": chunk})


def _accept_tool_block(
    runtime: ChatRuntime,
    state: ChatSessionState,
    block: dict,
    stream_label: str,
    *,
    source: str,
) -> bool:
    """Run the policy gate on a tool_use block. Record trace events on rejection."""
    name = str(block.get("name") or "")
    raw_input = block.get("input") if isinstance(block.get("input"), dict) else {}
    allowed, reason, required = policy_allows_tool(runtime.action_policy, name, raw_input)
    if not allowed:
        if source == "text":
            state.record_tool_use_via_text(stream_label, block, status="blocked")
        state.record_trace_event(
            "tool_blocked",
            stage=stream_label,
            tool_name=name,
            reason=reason,
            required_policy=required.value,
            current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
        )
        return False
    if source == "text":
        state.record_tool_use_via_text(stream_label, block, status="planned")
    return True


# ----------------------------------------------------------------------
# Message construction helpers
# ----------------------------------------------------------------------


def _build_assistant_message(text: str, tool_calls: list[dict], reasoning: str) -> dict:
    """Compose the assistant message dict to append to the LLM history."""
    content: list[dict] = []
    if text.strip():
        content.append({"type": "text", "text": text.strip()})
    for tc in tool_calls:
        content.append(
            {
                "type": "tool_use",
                "id": str(tc.get("id") or ""),
                "name": str(tc.get("name") or ""),
                "input": tc.get("input") or {},
            }
        )
    msg: dict[str, Any] = {"role": "assistant", "content": content}
    if reasoning:
        msg["reasoning_content"] = reasoning
    return msg


def _skipped_pending_result_block(tool_call: dict) -> dict:
    """Construct a synthetic tool_result for tool calls skipped after confirmation gate."""
    payload = {
        "ok": False,
        "success": False,
        "skipped": True,
        "status": "pending_confirmation",
        "reason": "前一个工具调用需要用户确认，本次未执行。",
    }
    return {
        "type": "tool_result",
        "tool_use_id": str(tool_call.get("id") or ""),
        "content": json.dumps(payload, ensure_ascii=False),
    }


def _append_text(existing: str, addition: str) -> str:
    if not addition:
        return existing
    if not existing:
        return addition
    return f"{existing.rstrip()}\n\n{addition}".strip()


# ----------------------------------------------------------------------
# Public entry point
# ----------------------------------------------------------------------


async def run_agent_loop(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Drive the LLM through up to ``MAX_AGENT_STEPS`` tool turns.

    On exit the following ``state`` fields are populated for the persist step:

    * ``state.full_text``                  — concatenated user-visible text
    * ``state.steps``                      — per-iteration audit records
    * ``state.tool_call_events``           — UI summary of every tool execution
    * ``state.tool_result_blocks``         — last batch fed back to the LLM
    * ``state.artifacts``                  — collected via tool_executor
    * ``state.pending_markdown_saves``     — collected via tool_executor
    * ``state.pending_tool_actions``       — HITAS rows to persist
    * ``state.pending_tool_confirmations`` — frontend confirmation cards
    * ``state.confirmation_requested``     — early-exit signal for persist
    * ``state.trace_events``               — diagnostic stream
    """
    messages: list[dict] = list(runtime.api_messages)
    accumulated_text = ""
    workflow_announced = False
    loop_started_at = time.perf_counter()

    for step_index in range(MAX_AGENT_STEPS):
        step = AgentStep(index=step_index)
        state.steps.append(step)
        step_started_at = time.perf_counter()

        # ---------- one LLM turn (events stream out live as the model writes) ----------
        result = _StreamResult()
        async for ev in _consume_stream(
            runtime,
            state,
            messages,
            step_index=step_index,
            stream_label=f"step_{step_index}",
            result=result,
        ):
            yield ev
        text = result.text
        tool_calls = result.tool_calls
        reasoning = result.reasoning
        truncated = result.truncated

        # ---------- truncation auto-continue (any step that ended on a cut-off
        # final answer, i.e. no tools emitted) ----------
        if truncated and not tool_calls and text.strip():
            cont_messages = messages + [
                {"role": "assistant", "content": text.strip()},
                {"role": "user", "content": _CONTINUATION_PROMPT},
            ]
            cont_result = _StreamResult()
            async for ev in _consume_stream(
                runtime,
                state,
                cont_messages,
                step_index=step_index,
                stream_label=f"step_{step_index}_continuation",
                result=cont_result,
            ):
                yield ev
            text += cont_result.text
            reasoning += cont_result.reasoning
            tool_calls.extend(cont_result.tool_calls)
            if cont_result.truncated:
                yield sse_event({"type": "truncated", "can_continue": True})
                truncated = True
            else:
                truncated = False
        elif truncated:
            # Truncated while still planning tools — no clean continuation path,
            # so surface it to the UI instead of auto-continuing.
            yield sse_event({"type": "truncated", "can_continue": True})

        step.model_text = text
        step.reasoning = reasoning
        step.truncated = truncated
        step.tool_calls = list(tool_calls)
        accumulated_text = _append_text(accumulated_text, text)

        if not tool_calls:
            step.duration_ms = round((time.perf_counter() - step_started_at) * 1000)
            break

        # ---------- announce workflow once when we know tools will run ----------
        if not workflow_announced:
            for evt in workflow_plan_events():
                yield sse_event(evt)
            workflow_announced = True
            state.workflow_started = True

        # ---------- build assistant message + execute tools ----------
        messages.append(_build_assistant_message(text, tool_calls, reasoning))

        tool_result_blocks: list[dict] = []
        for tc_index, tool_call in enumerate(tool_calls):
            outcome = await execute_tool_with_policy(
                runtime,
                state,
                tool_call,
                req=req,
                step_text=text,
                step_truncated=truncated,
                step_index=step_index,
            )
            for ev in outcome.events:
                yield ev

            # Markdown tools also stream their content as user-visible text.
            if outcome.markdown_inline_text:
                accumulated_text = _append_text(accumulated_text, outcome.markdown_inline_text)
                yield sse_event({"type": "text", "content": outcome.markdown_inline_text})

            tool_result_blocks.append(outcome.result_block)

            if outcome.confirmation_required:
                # Synthesize tool_results for the remaining un-executed calls so
                # the message list stays well-formed even if we were to feed it
                # back to the LLM later (and so audit consumers see them).
                for remaining in tool_calls[tc_index + 1 :]:
                    tool_result_blocks.append(_skipped_pending_result_block(remaining))
                break

        messages.append({"role": "user", "content": tool_result_blocks})
        state.tool_result_blocks = tool_result_blocks
        step.tool_results = tool_result_blocks
        step.duration_ms = round((time.perf_counter() - step_started_at) * 1000)

        yield sse_event(build_agent_step_event(step))

        if state.confirmation_requested:
            break
    else:
        # Loop hit MAX_AGENT_STEPS without breaking — record and exit gracefully.
        state.record_trace_event(
            "agent_loop_max_steps",
            stage="agent_loop",
            max_steps=MAX_AGENT_STEPS,
        )
        yield sse_event(
            {
                "type": "status",
                "stage": "agent_loop",
                "message": f"已达到 {MAX_AGENT_STEPS} 步工具循环上限，正在整理已生成的内容。",
            }
        )

    state.full_text = accumulated_text
    state.stage_timings["agent_loop_ms"] = round((time.perf_counter() - loop_started_at) * 1000)
    yield sse_event(
        {"type": "timing", "key": "agent_loop_ms", "duration_ms": state.stage_timings["agent_loop_ms"]}
    )
