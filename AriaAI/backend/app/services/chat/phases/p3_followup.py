"""P3 — Follow-up / final-reply generation phase.

Streams a follow-up response after tool results are injected back into the
message history.  Handles additional tool calls (``p3_tool_use_blocks``),
re-follow-up loops, and truncation (with auto-continuation).
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from collections.abc import AsyncIterator

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_tools import (
    ChatRuntime,
    _summarize_tool_result,
    _strip_internal_tool_markers,
    _tool_start_progress_payload,
)
from app.services.chat.mode_registry import ActionPolicy
from app.services.policy_guards import policy_allows_tool
from app.services.chat_artifacts import (
    _extract_artifact,
    _repair_digital_strategy_ppt_tool_input,
    _route_ppt_tool_for_skill,
)
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event, iter_with_heartbeat
from app.services.chat.truncation import strip_truncation_marker
from app.services.chat.tool_repair import extract_tool_use_json_blocks
from app.services.chat.workflow import workflow_status
from app.services.chat.tool_repair import repair_project_office_tool_input
from app.tools import registry
from app.tools.office_documents import (
    MANAGE_PROJECT_FILES_TOOL_NAME,
    MANAGE_PROJECT_FOLDERS_TOOL_NAME,
    WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
)
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME

logger = logging.getLogger(__name__)

_PROJECT_MARKDOWN_TOOLS = frozenset({PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME})
_PROJECT_OFFICE_TOOLS = frozenset({WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME})
_PROJECT_SPACE_MANAGEMENT_TOOLS = frozenset({MANAGE_PROJECT_FILES_TOOL_NAME, MANAGE_PROJECT_FOLDERS_TOOL_NAME})
_CONFIRMATION_POLICIES = {ActionPolicy.MODIFY_EXISTING_FILE, ActionPolicy.DESTRUCTIVE_ACTION}


def _action_policy_value(value) -> str:
    return str(getattr(value, "value", value) or "")


def _tool_confirmation_token(tool_name: str, tool_input: dict) -> str:
    operation = str(
        tool_input.get("mode")
        or tool_input.get("action")
        or tool_input.get("operation")
        or ""
    ).strip()
    normalized = json.dumps(tool_input or {}, ensure_ascii=False, sort_keys=True, default=str)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    parts = ["tool", tool_name]
    if operation:
        parts.append(operation)
    parts.append(digest)
    return ":".join(parts)


def _tool_requires_confirmation(
    required_policy: ActionPolicy,
    tool_name: str,
    tool_input: dict,
    req: SendMessageRequest,
) -> bool:
    if required_policy not in _CONFIRMATION_POLICIES:
        return False
    confirmations = set(getattr(req, "action_confirmations", []) or [])
    return _tool_confirmation_token(tool_name, tool_input) not in confirmations


def _tool_confirmation_details(tool_name: str, tool_input: dict) -> list[str]:
    if tool_name == MANAGE_PROJECT_FILES_TOOL_NAME and str(tool_input.get("action") or "").lower() == "delete":
        ids = tool_input.get("file_ids") or []
        if tool_input.get("file_id") is not None:
            ids = [*ids, tool_input["file_id"]]
        details = [f"待删除文件 ID：{', '.join(str(item) for item in ids)}"] if ids else []
        if tool_input.get("reason"):
            details.append(f"删除原因：{tool_input['reason']}")
        return details
    return []


def _repair_project_markdown_tool_input(tool_name: str, tool_input: dict) -> tuple[dict, list[str]]:
    repaired = dict(tool_input or {})
    changes: list[str] = []
    if tool_name == READ_MARKDOWN_TOOL_NAME and not repaired.get("action"):
        repaired["action"] = "read" if repaired.get("file_id") is not None or repaired.get("file_name") else "list"
        changes.append(f"补齐 Markdown 读取动作：{repaired['action']}")
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME and not repaired.get("mode"):
        repaired["mode"] = "replace" if repaired.get("file_id") is not None else "create"
        changes.append(f"补齐 Markdown 写入模式：{repaired['mode']}")
    return repaired, changes


async def run_p3_followup(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Generate the follow-up response after tool execution.

    Populates:
    * ``state.follow_up_text``
    * ``state.p3_tool_use_blocks`` / ``state.p3_reasoning_content``
    * ``state.p3_truncated`` / ``state.p3_double_truncated``
    * ``state.tool_result_blocks`` (updated for re-follow-up)
    * ``state.tool_call_events`` / ``state.artifacts`` / ``state.pending_markdown_saves``
    * ``state.stage_timings["follow_up_ms"]``
    """
    if not state.tool_use_blocks or not state.tool_result_blocks:
        # Nothing to follow up on
        return

    follow_up_text = ""
    p3_truncated = False
    p3_double_truncated = False
    p3_tool_use_blocks: list[dict] = []
    p3_reasoning_content = ""

    # Build assistant content with tool_use blocks
    assistant_content: list = []
    if state.text_buffer.strip():
        assistant_content.append({"type": "text", "text": state.text_buffer.strip()})
    for tool_block in state.tool_use_blocks:
        assistant_content.append(
            {
                "type": "tool_use",
                "id": tool_block["id"],
                "name": tool_block["name"],
                "input": tool_block.get("input", {}),
            }
        )

    continuation_messages = runtime.api_messages + [
        {
            "role": "assistant",
            "content": assistant_content,
            **({"reasoning_content": state.reasoning_content} if state.reasoning_content else {}),
        },
        {"role": "user", "content": state.tool_result_blocks},
    ]

    logger.info(f"[P3] starting follow-up. continuation_messages={len(continuation_messages)}")
    follow_up_started_at = time.perf_counter()

    yield sse_event(
        workflow_status(
            step_index=4,
            step_total=4,
            title="整理最终回复",
            stage="follow_up",
            message="第 4 步：工具结果已返回，正在整理最终说明和交付链接。",
        )
    )
    yield sse_event(
        {"type": "status", "stage": "follow_up", "message": "工具结果已返回，正在生成最终答复..."}
    )

    # ------------------------------------------------------------------
    # Primary follow-up stream
    # ------------------------------------------------------------------
    async for item in iter_with_heartbeat(
        runtime.llm.stream_response(
            continuation_messages,
            system=runtime.system,
            model=runtime.selected_model,
            tools=runtime.tools,
            max_tokens=runtime.max_tokens,
            temperature=runtime.temperature,
        ),
        stage="follow_up",
        message="工具结果已返回，模型正在整理最终答复...",
    ):
        if isinstance(item, dict):
            yield sse_event(item)
            continue
        chunk = item
        stripped = chunk.strip()

        if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
            tool_name = stripped[12:-1]
            allowed, reason, required = policy_allows_tool(runtime.action_policy, tool_name, {})
            if not allowed:
                logger.warning(
                    "[P3] suppressed tool progress marker by action policy. tool=%s required=%s reason=%s",
                    tool_name,
                    required.value,
                    reason,
                )
                state.record_trace_event(
                    "tool_marker_suppressed",
                    stage="p3",
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
                    state.record_tool_use_via_text("p3", block, status="blocked")
                    logger.warning(
                        "[P3] blocked follow-up tool by action policy. tool=%s required=%s reason=%s",
                        block.get("name"),
                        required.value,
                        reason,
                    )
                    state.record_trace_event(
                        "tool_blocked",
                        stage="p3",
                        tool_name=str(block.get("name") or ""),
                        reason=reason,
                        required_policy=required.value,
                        current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
                    )
                    continue
                state.record_tool_use_via_text("p3", block, status="planned")
                logger.info(f"[P3] tool_use detected in follow-up: {block.get('name')}, id={block.get('id')}")
                p3_tool_use_blocks.append(block)
                yield sse_event(
                    {
                        "type": "status",
                        "stage": "tool_planned",
                        "message": f"模型已规划调用工具：{block.get('name')}",
                    }
                )
            if cleaned_chunk:
                follow_up_text += cleaned_chunk
                yield sse_event({"type": "text", "content": cleaned_chunk})
            continue

        if stripped.startswith("{") and stripped.endswith("}") and '"type"' in stripped:
            try:
                block = json.loads(stripped)
                if block.get("type") == "reasoning_content":
                    p3_reasoning_content = block.get("content", "")
                    continue
            except json.JSONDecodeError:
                pass

        chunk, was_truncated = strip_truncation_marker(chunk)
        if was_truncated:
            p3_truncated = True
            yield sse_event(
                {
                    "type": "status",
                    "stage": "continuing",
                    "message": "最终答复较长，正在尝试继续生成...",
                }
            )
            if not chunk:
                continue
        follow_up_text += chunk
        yield sse_event({"type": "text", "content": chunk})

    # ------------------------------------------------------------------
    # Re-follow-up: execute additional tools detected in P3
    # ------------------------------------------------------------------
    p3_tool_result_blocks: list[dict] = []
    if p3_tool_use_blocks:
        logger.info(f"[P3] executing {len(p3_tool_use_blocks)} detected tool_use blocks")
        yield sse_event(
            {"type": "status", "stage": "tools", "message": "检测到后续工具调用，正在执行..."}
        )

        for tool_data in p3_tool_use_blocks:
            tool_name = tool_data.get("name", "")
            tool_input = tool_data.get("input", {})
            tool_id = tool_data.get("id", "")
            if not tool_name or not isinstance(tool_input, dict):
                p3_tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps({"error": "Invalid tool name or input"}, ensure_ascii=False),
                    }
                )
                continue

            tool_name, tool_input = _route_ppt_tool_for_skill(runtime, tool_name, tool_input)
            tool_input = _repair_digital_strategy_ppt_tool_input(
                runtime, tool_name, tool_input, follow_up_text, force_rebuild=p3_truncated
            )
            if tool_name in _PROJECT_MARKDOWN_TOOLS and runtime.project_id is not None:
                tool_input = {**tool_input, "project_id": runtime.project_id}
                tool_input, repaired_changes = _repair_project_markdown_tool_input(tool_name, tool_input)
                if repaired_changes:
                    state.record_trace_event(
                        "tool_input_repaired",
                        stage="p3",
                        tool_name=tool_name,
                        changes=repaired_changes,
                    )
                    yield sse_event(
                        workflow_status(
                            step_index=3,
                            step_total=4,
                            title="执行 Skill / 工具",
                            stage="tools",
                            message=f"第 3 步：已补齐后续 Markdown 工具参数（{'；'.join(repaired_changes)}）。",
                        )
                    )
            if tool_name in _PROJECT_OFFICE_TOOLS and runtime.project_id is not None:
                tool_input = {**tool_input, "project_id": runtime.project_id}
                tool_input, repaired_changes = repair_project_office_tool_input(req.content, tool_input)
                if repaired_changes:
                    state.record_trace_event(
                        "tool_input_repaired",
                        stage="p3",
                        tool_name=tool_name,
                        changes=repaired_changes,
                    )
                    yield sse_event(
                        workflow_status(
                            step_index=3,
                            step_total=4,
                            title="执行 Skill / 工具",
                            stage="tools",
                            message=f"第 3 步：已补齐后续文件生成参数（{'；'.join(repaired_changes)}）。",
                        )
                    )
            if tool_name in _PROJECT_SPACE_MANAGEMENT_TOOLS and runtime.project_id is not None:
                tool_input = {**tool_input, "project_id": runtime.project_id}

            allowed, block_reason, required_policy = policy_allows_tool(runtime.action_policy, tool_name, tool_input)
            if not allowed:
                logger.warning(
                    "[P3] blocked re-follow-up tool by action policy. tool=%s required=%s policy=%s reason=%s",
                    tool_name,
                    required_policy.value,
                    runtime.action_policy,
                    block_reason,
                )
                skipped_output = {
                    "skipped": True,
                    "reason": block_reason,
                    "required_policy": required_policy.value,
                    "current_policy": str(getattr(runtime.action_policy, "value", runtime.action_policy)),
                }
                p3_tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps(skipped_output, ensure_ascii=False),
                    }
                )
                state.tool_call_events.append(
                    {
                        "tool_name": tool_name,
                        "status": "blocked",
                        "message": "后续工具调用已被本轮 ActionPolicy 阻止。",
                        "summary": block_reason,
                        "required_policy": required_policy.value,
                    }
                )
                state.record_trace_event(
                    "tool_blocked",
                    stage="p3",
                    tool_name=tool_name,
                    reason=block_reason,
                    required_policy=required_policy.value,
                    current_policy=str(getattr(runtime.action_policy, "value", runtime.action_policy)),
                )
                yield sse_event(
                    {
                        "type": "tool_result",
                        "result": {
                            "type": "tool_result",
                            "tool_name": tool_name,
                            "status": "skipped",
                            "success": True,
                            "output": skipped_output,
                        },
                    }
                )
                continue

            if _tool_requires_confirmation(required_policy, tool_name, tool_input, req):
                state.confirmation_requested = True
                confirmation_token = _tool_confirmation_token(tool_name, tool_input)
                confirmation_details = _tool_confirmation_details(tool_name, tool_input)
                confirmation_output = {
                    "skipped": True,
                    "requires_confirmation": True,
                    "confirmation_token": confirmation_token,
                    "reason": "需要用户确认后才能执行修改或危险操作。",
                    "current_policy": _action_policy_value(runtime.action_policy),
                }
                p3_tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps(confirmation_output, ensure_ascii=False),
                    }
                )
                state.tool_call_events.append(
                    {
                        "tool_name": tool_name,
                        "status": "confirmation_required",
                        "message": "该后续工具会修改或删除项目内容，已暂停等待用户确认。",
                        "summary": confirmation_output["reason"],
                        "confirmation_token": confirmation_token,
                        "details": confirmation_details,
                    }
                )
                state.record_trace_event(
                    "tool_confirmation_required",
                    stage="p3",
                    tool_name=tool_name,
                    confirmation_token=confirmation_token,
                    current_policy=_action_policy_value(runtime.action_policy),
                )
                yield sse_event(
                    workflow_status(
                        step_index=3,
                        step_total=4,
                        title="执行 Skill / 工具",
                        stage="tools",
                        status="confirmation_required",
                        message="第 3 步：后续工具调用涉及修改或删除，等待确认后再执行。",
                    )
                )
                yield sse_event(
                    {
                        "type": "tool_result",
                        "result": {
                            "type": "tool_result",
                            "tool_name": tool_name,
                            "status": "confirmation_required",
                            "summary": confirmation_output["reason"],
                            "confirmation_token": confirmation_token,
                            "details": confirmation_details,
                            "output": confirmation_output,
                        },
                    }
                )
                break

            if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None:
                markdown_content = str(tool_input.get("content") or "").strip()
                if markdown_content and markdown_content not in follow_up_text:
                    follow_up_text = f"{follow_up_text.rstrip()}\n\n{markdown_content}".strip()

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
                p3_tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps(output, ensure_ascii=False),
                    }
                )
                continue

            # Normal tool in re-follow-up
            try:
                result = await registry.execute(tool_name, tool_input)
                artifact = _extract_artifact(result)
                if artifact:
                    state.artifacts.append(artifact)
                state.tool_call_events.append(
                    {
                        "tool_name": tool_name,
                        "status": "completed",
                        "message": f"工具 {tool_name} 执行完成。",
                        "summary": f"工具 {tool_name} 执行完成",
                    }
                )
                yield sse_event({"type": "tool_result", "result": result})
                p3_tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps(result.get("output", result), ensure_ascii=False),
                    }
                )
            except Exception as exc:
                state.tool_call_events.append(
                    {
                        "tool_name": tool_name,
                        "status": "error",
                        "message": f"工具执行失败: {exc}",
                        "summary": f"工具 {tool_name} 执行失败",
                        "error": str(exc),
                    }
                )
                p3_tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps({"error": str(exc)}, ensure_ascii=False),
                    }
                )

        # ------------------------------------------------------------------
        # Re-follow-up stream after P3 tools
        # ------------------------------------------------------------------
        if state.confirmation_requested:
            state.follow_up_text = follow_up_text.strip()
            return

        if p3_tool_result_blocks:
            p3_assistant_content = []
            if follow_up_text.strip():
                p3_assistant_content.append({"type": "text", "text": follow_up_text.strip()})
            for block in p3_tool_use_blocks:
                p3_assistant_content.append(
                    {
                        "type": "tool_use",
                        "id": block["id"],
                        "name": block["name"],
                        "input": block.get("input", {}),
                    }
                )

            p3_re_follow_messages = runtime.api_messages + [
                {
                    "role": "assistant",
                    "content": assistant_content,
                    **({"reasoning_content": state.reasoning_content} if state.reasoning_content else {}),
                },
                {"role": "user", "content": state.tool_result_blocks},
                {
                    "role": "assistant",
                    "content": p3_assistant_content,
                    **({"reasoning_content": p3_reasoning_content} if p3_reasoning_content else {}),
                },
                {"role": "user", "content": p3_tool_result_blocks},
            ]

            logger.info(f"[P3] re-follow-up after tool execution. messages={len(p3_re_follow_messages)}")
            yield sse_event(
                {"type": "status", "stage": "follow_up", "message": "工具结果已返回，正在生成最终答复..."}
            )

            re_follow_text = ""
            async for item in iter_with_heartbeat(
                runtime.llm.stream_response(
                    p3_re_follow_messages,
                    system=runtime.system,
                    model=runtime.selected_model,
                    tools=runtime.tools,
                    max_tokens=runtime.max_tokens,
                    temperature=runtime.temperature,
                ),
                stage="follow_up",
                message="工具结果已返回，模型正在整理最终答复...",
            ):
                if isinstance(item, dict):
                    yield sse_event(item)
                    continue
                chunk = item
                chunk, was_truncated = strip_truncation_marker(chunk)
                if was_truncated:
                    p3_double_truncated = True
                    yield sse_event(
                        {
                            "type": "status",
                            "stage": "continuing",
                            "message": "最终答复较长，正在尝试继续生成...",
                        }
                    )
                    if not chunk:
                        continue
                stripped_chunk = chunk.strip()
                leaked_tool_blocks, cleaned_chunk = extract_tool_use_json_blocks(chunk)
                if leaked_tool_blocks:
                    for block in leaked_tool_blocks:
                        state.record_tool_use_via_text("p3_re_follow", block, status="suppressed")
                        logger.info(
                            f"[P3] suppressed leaked tool_use in re-follow-up: "
                            f"{block.get('name')}, id={block.get('id')}"
                        )
                        state.record_trace_event(
                            "tool_block_suppressed",
                            stage="p3_re_follow",
                            tool_name=str(block.get("name") or ""),
                            reason="tool_use leaked after tool execution; suppressed to keep final answer stable",
                        )
                    chunk = cleaned_chunk
                    stripped_chunk = chunk.strip()
                    if not chunk:
                        continue
                if stripped_chunk.startswith("{") and stripped_chunk.endswith("}") and '"type"' in stripped_chunk:
                    try:
                        block = json.loads(stripped_chunk)
                        if block.get("type") == "reasoning_content":
                            continue
                    except json.JSONDecodeError:
                        pass
                re_follow_text += chunk
                yield sse_event({"type": "text", "content": chunk})

            follow_up_text = re_follow_text

    # ------------------------------------------------------------------
    # Auto-continuation if P3 was truncated
    # ------------------------------------------------------------------
    if p3_truncated and follow_up_text.strip():
        p3_continuation_messages = continuation_messages + [
            {"role": "assistant", "content": follow_up_text.strip()},
            {
                "role": "user",
                "content": "请从上一条最终答复被截断的位置继续，直接续写正文，不要重复已经写过的内容。",
            },
        ]
        async for item in iter_with_heartbeat(
            runtime.llm.stream_response(
                p3_continuation_messages,
                system=runtime.system,
                model=runtime.selected_model,
                tools=runtime.tools,
                max_tokens=runtime.max_tokens,
                temperature=runtime.temperature,
            ),
            stage="continuing",
            message="最终答复较长，正在继续生成...",
        ):
            if isinstance(item, dict):
                yield sse_event(item)
                continue
            chunk = item
            chunk, was_truncated = strip_truncation_marker(chunk)
            if was_truncated:
                if chunk:
                    follow_up_text += chunk
                    yield sse_event({"type": "text", "content": chunk})
                p3_double_truncated = True
                yield sse_event({"type": "truncated", "can_continue": True})
                break
            if not chunk:
                continue
            follow_up_text += chunk
            yield sse_event({"type": "text", "content": chunk})

    # Empty-response fallback
    if not follow_up_text.strip() and not p3_tool_use_blocks:
        follow_up_text = "模型正在思考中，尚未生成最终答复。你可以尝试补充更具体的矫正要求，或稍后再试。"
        yield sse_event({"type": "text", "content": follow_up_text})

    logger.info(f"[P3] done. follow_up_text_len={len(follow_up_text)}")
    state.stage_timings["follow_up_ms"] = round((time.perf_counter() - follow_up_started_at) * 1000)
    yield sse_event(
        {"type": "timing", "key": "follow_up_ms", "duration_ms": state.stage_timings["follow_up_ms"]}
    )
    yield sse_event(
        workflow_status(
            step_index=4,
            step_total=4,
            title="整理最终回复",
            stage="follow_up",
            status="completed",
            message="第 4 步：最终说明已整理完成。",
        )
    )

    # Write back
    state.follow_up_text = follow_up_text
    state.p3_truncated = p3_truncated
    state.p3_double_truncated = p3_double_truncated
    state.p3_tool_use_blocks = p3_tool_use_blocks
    state.p3_reasoning_content = p3_reasoning_content
