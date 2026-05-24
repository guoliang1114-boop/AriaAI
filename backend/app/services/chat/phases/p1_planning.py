"""P1 — Initial LLM streaming / planning phase.

Streams the first LLM response, detects ``tool_use`` blocks, reasoning content,
and ``[OUTPUT_TRUNCATED]``.  If truncated once, automatically continues; if
truncated twice, emits a ``{"type": "truncated", "can_continue": true}`` event
so the UI can show a "Continue" button.
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_tools import (
    ChatRuntime,
    _strip_internal_tool_markers,
    _tool_start_progress_payload,
)
from app.services.policy_guards import policy_allows_tool
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event, iter_with_heartbeat
from app.services.chat.truncation import strip_truncation_marker
from app.services.chat.tool_repair import extract_tool_use_json_blocks

logger = logging.getLogger(__name__)


async def run_p1_planning(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Execute the P1 planning phase.

    Yields SSE events.  On completion the following *state* fields are populated:

    * ``state.text_buffer``      – accumulated display text
    * ``state.tool_use_blocks``  – detected ``tool_use`` JSON blocks
    * ``state.reasoning_content`` – reasoning payload (if any)
    * ``state.p1_truncated``     – True if truncated at least once
    * ``state.p1_double_truncated`` – True if truncated twice (continuation also hit limit)
    * ``state.first_model_event_recorded`` – timing flag
    * ``state.stage_timings["planning_ms"]`` – total P1 duration
    """
    text_buffer = ""
    tool_use_blocks: list[dict] = []
    reasoning_content = ""
    p1_truncated = False
    p1_double_truncated = False

    logger.info(f"[P1] starting stream, tools={[t.get('name') for t in (runtime.tools or [])]}")

    prepare_context_label = "项目上下文" if req.project_id else "工作台摘要"
    yield sse_event(
        {
            "type": "status",
            "stage": "prepare",
            "message": f"{prepare_context_label}与最近对话已加载，正在请求模型...",
        }
    )

    p1_started_at = time.perf_counter()
    yield sse_event(
        {
            "type": "status",
            "stage": "thinking",
            "message": "正在理解你的需求，并准备调用模型生成方案...",
        }
    )

    if runtime.tools:
        yield sse_event(
            {
                "type": "status",
                "stage": "planning",
                "message": f"已加载 {len(runtime.tools)} 个可用工具，正在判断是否需要调用。",
            }
        )

    # ------------------------------------------------------------------
    # Primary stream
    # ------------------------------------------------------------------
    async for item in iter_with_heartbeat(
        runtime.llm.stream_response(
            runtime.api_messages,
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

        chunk = item
        if not state.first_model_event_recorded:
            state.first_model_event_recorded = True
            state.stage_timings["model_first_event_ms"] = round((time.perf_counter() - p1_started_at) * 1000)
            yield sse_event(
                {
                    "type": "timing",
                    "key": "model_first_event_ms",
                    "duration_ms": state.stage_timings["model_first_event_ms"],
                }
            )

        chunk, was_truncated = strip_truncation_marker(chunk)
        if was_truncated:
            p1_truncated = True
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
        if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
            tool_name = stripped[12:-1]
            allowed, reason, required = policy_allows_tool(runtime.action_policy, tool_name, {})
            if not allowed:
                logger.warning(
                    "[P1] suppressed tool progress marker by action policy. tool=%s required=%s reason=%s",
                    tool_name,
                    required.value,
                    reason,
                )
                state.record_trace_event(
                    "tool_marker_suppressed",
                    stage="p1",
                    tool_name=tool_name,
                    reason=reason,
                    required_policy=required.value,
                    current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
                )
                continue
            progress_payload = _tool_start_progress_payload(tool_name)
            if progress_payload:
                yield sse_event({"type": "tool_executing", "tool_name": tool_name, **progress_payload})
            continue

        chunk = _strip_internal_tool_markers(chunk)
        if not chunk:
            continue
        stripped = chunk.strip()

        mixed_tool_blocks, cleaned_chunk = extract_tool_use_json_blocks(chunk)
        if mixed_tool_blocks:
            for block in mixed_tool_blocks:
                allowed, reason, required = policy_allows_tool(
                    runtime.action_policy,
                    str(block.get("name") or ""),
                    block.get("input") if isinstance(block.get("input"), dict) else {},
                )
                if not allowed:
                    state.record_tool_use_via_text("p1", block, status="blocked")
                    logger.warning(
                        "[P1] blocked mixed-text tool by action policy. tool=%s required=%s reason=%s",
                        block.get("name"),
                        required.value,
                        reason,
                    )
                    state.record_trace_event(
                        "tool_blocked",
                        stage="p1",
                        tool_name=str(block.get("name") or ""),
                        reason=reason,
                        required_policy=required.value,
                        current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
                    )
                    continue
                state.record_tool_use_via_text("p1", block, status="planned")
                logger.info(
                    f"[P1] tool_use detected in mixed text: {block.get('name')}, "
                    f"id={block.get('id')}, input_keys={list((block.get('input') or {}).keys())}"
                )
                tool_use_blocks.append(block)
                yield sse_event(
                    {
                        "type": "status",
                        "stage": "tool_planned",
                        "message": f"模型已规划调用工具：{block.get('name')}",
                    }
                )
            if cleaned_chunk:
                text_buffer += cleaned_chunk
                yield sse_event({"type": "text", "content": cleaned_chunk})
            continue

        if stripped.startswith("{") and stripped.endswith("}") and '"type"' in stripped:
            try:
                block = json.loads(stripped)
                if block.get("type") == "tool_use":
                    allowed, reason, required = policy_allows_tool(
                        runtime.action_policy,
                        str(block.get("name") or ""),
                        block.get("input") if isinstance(block.get("input"), dict) else {},
                    )
                    if not allowed:
                        logger.warning(
                            "[P1] blocked JSON tool by action policy. tool=%s required=%s reason=%s",
                            block.get("name"),
                            required.value,
                            reason,
                        )
                        state.record_trace_event(
                            "tool_blocked",
                            stage="p1",
                            tool_name=str(block.get("name") or ""),
                            reason=reason,
                            required_policy=required.value,
                            current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
                        )
                        continue
                    logger.info(
                        f"[P1] tool_use detected: {block.get('name')}, "
                        f"id={block.get('id')}, input_keys={list((block.get('input') or {}).keys())}"
                    )
                    if not state.first_model_event_recorded:
                        state.first_model_event_recorded = True
                        state.stage_timings["model_first_event_ms"] = round(
                            (time.perf_counter() - p1_started_at) * 1000
                        )
                        yield sse_event(
                            {
                                "type": "timing",
                                "key": "model_first_event_ms",
                                "duration_ms": state.stage_timings["model_first_event_ms"],
                            }
                        )
                    tool_use_blocks.append(block)
                    yield sse_event(
                        {
                            "type": "status",
                            "stage": "tool_planned",
                            "message": f"模型已规划调用工具：{block.get('name')}",
                        }
                    )
                    continue
                if block.get("type") == "reasoning_content":
                    reasoning_content = block.get("content", "")
                    continue
            except json.JSONDecodeError:
                pass

        text_buffer += chunk
        yield sse_event({"type": "text", "content": chunk})

    logger.info(f"[P1] done. text_len={len(text_buffer)}, tool_use_count={len(tool_use_blocks)}")
    state.stage_timings["planning_ms"] = round((time.perf_counter() - p1_started_at) * 1000)
    yield sse_event(
        {"type": "timing", "key": "planning_ms", "duration_ms": state.stage_timings["planning_ms"]}
    )

    # ------------------------------------------------------------------
    # Auto-continuation if truncated once
    # ------------------------------------------------------------------
    if p1_truncated and text_buffer.strip():
        continuation_messages = runtime.api_messages + [
            {"role": "assistant", "content": text_buffer.strip()},
            {
                "role": "user",
                "content": "请从上一条回复被截断的位置继续，补齐后续内容和关键论证。不要重复已经写过的内容，不要调用工具。",
            },
        ]
        async for item in iter_with_heartbeat(
            runtime.llm.stream_response(
                continuation_messages,
                system=runtime.system,
                model=runtime.selected_model,
                tools=runtime.tools,
                max_tokens=runtime.max_tokens,
                temperature=runtime.temperature,
            ),
            stage="continuing",
            message="正在继续生成长回复，请稍候...",
        ):
            if isinstance(item, dict):
                yield sse_event(item)
                continue
            chunk = item
            chunk, was_truncated = strip_truncation_marker(chunk)
            if was_truncated:
                if chunk:
                    text_buffer += chunk
                    yield sse_event({"type": "text", "content": chunk})
                p1_double_truncated = True
                yield sse_event({"type": "truncated", "can_continue": True})
                break
            if not chunk:
                continue
            text_buffer += chunk
            yield sse_event({"type": "text", "content": chunk})

    # ------------------------------------------------------------------
    # Write back to shared state
    # ------------------------------------------------------------------
    state.text_buffer = text_buffer
    state.tool_use_blocks = tool_use_blocks
    state.reasoning_content = reasoning_content
    state.p1_truncated = p1_truncated
    state.p1_double_truncated = p1_double_truncated
