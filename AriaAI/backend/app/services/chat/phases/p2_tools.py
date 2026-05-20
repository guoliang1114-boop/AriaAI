"""P2 — Tool execution phase.

Executes every ``tool_use`` block detected in P1, handles Markdown / Office / PPT
special cases, collects artifacts, and manages workflow status events.
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_tools import (
    ChatRuntime,
    _summarize_tool_result,
    _tool_progress_payload,
)
from app.services.chat_artifacts import (
    _extract_artifact,
    _repair_digital_strategy_ppt_tool_input,
    _route_ppt_tool_for_skill,
)
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event, await_with_heartbeat
from app.services.chat.workflow import workflow_status, workflow_plan_events
from app.services.chat.tool_repair import repair_project_office_tool_input
from app.tools import registry
from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME

logger = logging.getLogger(__name__)

_PROJECT_MARKDOWN_TOOLS = frozenset({PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME})
_PROJECT_OFFICE_TOOLS = frozenset({WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME})


async def run_p2_tools(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Execute all tools planned in P1.

    Populates:
    * ``state.tool_result_blocks``
    * ``state.tool_call_events``
    * ``state.artifacts``
    * ``state.pending_markdown_saves``
    * ``state.workflow_started``
    * ``state.stage_timings["tools_total_ms"]``
    """
    state.workflow_started = True

    for workflow_event in workflow_plan_events():
        yield sse_event(workflow_event)

    yield sse_event(
        workflow_status(
            step_index=3,
            step_total=4,
            title="执行 Skill / 工具",
            stage="tools",
            message="第 3 步：正在执行规划好的 Skill 或工具调用。",
        )
    )
    yield sse_event(
        {"type": "status", "stage": "tools", "message": "模型已完成初稿规划，正在执行所需工具..."}
    )

    tool_result_blocks: list[dict] = []
    tools_started_at = time.perf_counter()

    for tool_data in state.tool_use_blocks:
        tool_name = tool_data.get("name", "")
        tool_input = tool_data.get("input", {})
        tool_id = tool_data.get("id", "")

        if not tool_name or not isinstance(tool_input, dict):
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps({"error": "Invalid tool name or input"}, ensure_ascii=False),
                }
            )
            continue

        # Route / repair tool input
        tool_name, tool_input = _route_ppt_tool_for_skill(runtime, tool_name, tool_input)
        tool_input = _repair_digital_strategy_ppt_tool_input(
            runtime, tool_name, tool_input, state.text_buffer, force_rebuild=state.p1_truncated
        )
        if tool_name in _PROJECT_MARKDOWN_TOOLS and runtime.project_id is not None:
            tool_input = {**tool_input, "project_id": runtime.project_id}
        if tool_name in _PROJECT_OFFICE_TOOLS and runtime.project_id is not None:
            tool_input = {**tool_input, "project_id": runtime.project_id}
            tool_input, repaired_changes = repair_project_office_tool_input(req.content, tool_input)
            if repaired_changes:
                yield sse_event(
                    workflow_status(
                        step_index=3,
                        step_total=4,
                        title="执行 Skill / 工具",
                        stage="tools",
                        message=f"第 3 步：已补齐文件生成参数（{'；'.join(repaired_changes)}）。",
                    )
                )

        # ---- Markdown write tool (special inline handling) ----
        if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None:
            markdown_content = str(tool_input.get("content") or "").strip()
            if markdown_content:
                if state.text_buffer.strip():
                    state.text_buffer = f"{state.text_buffer.rstrip()}\n\n{markdown_content}"
                    yield sse_event({"type": "text", "content": f"\n\n{markdown_content}"})
                else:
                    state.text_buffer = markdown_content
                    yield sse_event({"type": "text", "content": markdown_content})

            write_result = None
            try:
                write_result = await registry.execute(tool_name, tool_input)
                artifact = _extract_artifact(write_result)
                if artifact:
                    state.artifacts.append(artifact)

                write_failed = write_result.get("status") == "error" or write_result.get("success") is False
                output = write_result.get("output", write_result)
                if write_failed:
                    state.tool_call_events.append(
                        {
                            "tool_name": tool_name,
                            "status": "error",
                            "message": "写入项目 Markdown 文件失败。",
                            "summary": _summarize_tool_result(write_result),
                            "error": str(
                                write_result.get("error")
                                or (output.get("error") if isinstance(output, dict) else "")
                            ),
                        }
                    )
                else:
                    state.pending_markdown_saves.append(
                        {
                            "tool_use_id": tool_id,
                            "project_id": runtime.project_id,
                            "file_id": output.get("project_file_id") or output.get("id")
                            if isinstance(output, dict)
                            else tool_input.get("file_id"),
                            "file_name": output.get("name") if isinstance(output, dict) else tool_input.get("file_name"),
                            "mode": tool_input.get("mode"),
                            "content": markdown_content,
                            "summary": tool_input.get("summary"),
                            "folder_id": output.get("folder_id") if isinstance(output, dict) else tool_input.get("folder_id"),
                            "saved": True,
                            "original_content": output.get("original_content") if isinstance(output, dict) else None,
                        }
                    )
                    state.tool_call_events.append(
                        {
                            "tool_name": tool_name,
                            "status": "completed",
                            "message": "已写入项目 Markdown 文件。",
                            "summary": _summarize_tool_result(write_result),
                        }
                    )
                yield sse_event({"type": "tool_result", "result": write_result})
            except Exception as exc:
                write_result = {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "status": "error",
                    "error": str(exc),
                }
                state.tool_call_events.append(
                    {
                        "tool_name": tool_name,
                        "status": "error",
                        "message": f"写入失败: {exc}",
                        "summary": "写入项目 Markdown 文件失败",
                        "error": str(exc),
                    }
                )
                yield sse_event({"type": "tool_result", "result": write_result})

            output = write_result.get("output", write_result) if write_result else {"error": "No result"}
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(output, ensure_ascii=False),
                }
            )
            continue

        # ---- Normal tool execution ----
        yield sse_event(
            {"type": "tool_executing", "tool_name": tool_name, **_tool_progress_payload(tool_name, tool_input)}
        )
        logger.info(f"[P2] executing tool: {tool_name}, input_keys={list(tool_input.keys())}")

        tool_started_at = time.perf_counter()
        try:
            result = None
            async for event in await_with_heartbeat(
                registry.execute(tool_name, tool_input),
                stage="tool_running",
                message=f"{tool_name} 正在执行中，文件生成类任务可能需要 1-2 分钟...",
            ):
                if event.get("type") == "result":
                    result = event.get("result")
                else:
                    yield sse_event(event)
            if result is None:
                result = {
                    "type": "tool_result",
                    "tool_name": tool_name,
                    "status": "error",
                    "error": "Tool returned no result",
                }
        except Exception as exc:
            result = {"type": "tool_result", "tool_name": tool_name, "status": "error", "error": str(exc)}

        logger.info(f"[P2] tool result: status={result.get('status')}, keys={list(result.keys())}")
        yield sse_event({"type": "tool_result", "result": result})
        tool_duration_ms = round((time.perf_counter() - tool_started_at) * 1000)
        yield sse_event(
            {"type": "timing", "key": f"tool:{tool_name}", "duration_ms": tool_duration_ms}
        )

        state.tool_call_events.append(
            {
                "tool_name": tool_name,
                "status": "error"
                if result.get("status") == "error" or result.get("success") is False
                else "completed",
                "message": _tool_progress_payload(tool_name, tool_input).get("message", ""),
                "summary": _summarize_tool_result(result),
                "duration_ms": tool_duration_ms,
                **({"error": str(result.get("error"))} if result.get("error") else {}),
            }
        )

        artifact = _extract_artifact(result)
        if artifact:
            state.artifacts.append(artifact)

        output = result.get("output", result)
        tool_result_blocks.append(
            {
                "type": "tool_result",
                "tool_use_id": tool_id,
                "content": json.dumps(output, ensure_ascii=False),
            }
        )

    logger.info(f"[P2] done. tool_result_blocks={len(tool_result_blocks)}")
    if state.tool_use_blocks:
        state.stage_timings["tools_total_ms"] = round((time.perf_counter() - tools_started_at) * 1000)
        yield sse_event(
            {
                "type": "timing",
                "key": "tools_total_ms",
                "duration_ms": state.stage_timings["tools_total_ms"],
            }
        )
        has_tool_error = any(event.get("status") == "error" for event in state.tool_call_events)
        yield sse_event(
            workflow_status(
                step_index=3,
                step_total=4,
                title="执行 Skill / 工具",
                stage="tools",
                status="error" if has_tool_error else "completed",
                message=(
                    "第 3 步：工具执行遇到错误，正在整理可恢复信息。"
                    if has_tool_error
                    else "第 3 步：Skill / 工具调用已完成。"
                ),
            )
        )
    elif not state.text_buffer.strip():
        yield sse_event(
            {"type": "status", "stage": "finalizing", "message": "模型已返回，正在整理结果..."}
        )

    state.tool_result_blocks = tool_result_blocks
