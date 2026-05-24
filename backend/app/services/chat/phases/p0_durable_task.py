"""P0 — Durable task early-return path.

If the user's message maps to a long-running project task (e.g. data-collection,
document generation pipeline), we route it through the task orchestrator instead
of the normal chat flow.
"""
from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator

from sqlmodel import Session

from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy
from app.services.chat_tools import ChatRuntime, _to_user_friendly_error
from app.services.chat_store import persist_assistant_message
from app.services.task_orchestrator import (
    create_task_run,
    pause_task_run_in_session,
    serialize_task_run,
    stream_execute_task_run_in_session,
    task_run_chat_brief,
)
from app.services.intent_router import classify_chat_intent_async
from app.services.chat.markdown_followup import save_previous_answer_as_markdown
from app.services.title_generator import schedule_title_generation
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event, task_stream_flush_pause
from app.services.chat.trace import persist_chat_trace
from app.services.chat.workflow import workflow_status_from_task_event, task_payload_tool_calls

logger = logging.getLogger(__name__)


def _task_confirmation_reason(runtime: ChatRuntime, req: SendMessageRequest, task_route) -> str:
    policy_value = str(getattr(runtime.action_policy, "value", runtime.action_policy) or "")
    if policy_value in {ActionPolicy.MODIFY_EXISTING_FILE.value, ActionPolicy.DESTRUCTIVE_ACTION.value}:
        return "该任务可能修改或删除已有项目内容，需要先确认。"
    text = (req.content or "").lower()
    high_cost_terms = ("全面", "丰富", "完整", "详细", "大型", "全部门", "所有部门", "10", "20", "large", "comprehensive")
    output_kind = getattr(task_route, "output_kind", "")
    if output_kind in {"pptx", "xlsx", "docx", "pdf"} and any(term in text for term in high_cost_terms):
        label = {
            "pptx": "PPT",
            "xlsx": "Excel",
            "docx": "Word",
            "pdf": "PDF",
        }.get(output_kind, "文件")
        return f"该 {label} 生成任务可能耗时较长，需要先确认后执行。"
    return ""


async def run_p0_durable_task(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Attempt to route the request as a durable task.

    Yields SSE events.  If a durable task is started, sets
    ``state.durable_task_completed = True`` so the orchestrator can return early.
    """
    stream_started_at = time.perf_counter()
    if req.project_id:
        save_result = save_previous_answer_as_markdown(
            bind=bind,
            conversation_id=runtime.conv_id,
            project_id=req.project_id,
            user_content=req.content,
        )
        if save_result is not None:
            state.durable_task_completed = True
            status_ok = bool(save_result.get("ok"))
            if status_ok:
                file_name = str(save_result.get("name") or "Markdown 文件")
                full_text = f"已将上一条回复保存为 Markdown 文件：{file_name}"
                metadata = {
                    "project_id": req.project_id,
                    "tool_calls": [
                        {
                            "tool_name": "save_previous_answer_as_markdown",
                            "status": "completed",
                            "message": "已保存上一条 AI 回复为项目 Markdown 文件。",
                            "summary": file_name,
                        }
                    ],
                    "artifacts": [
                        {
                            "id": save_result.get("id"),
                            "project_file_id": save_result.get("project_file_id"),
                            "name": save_result.get("name"),
                            "file_type": "md",
                            "path": save_result.get("path"),
                            "description": "Saved previous assistant answer as Markdown.",
                        }
                    ],
                    "markdown_followup_save": save_result,
                    "stage_timings": {
                        **state.stage_timings,
                        "total_stream_ms": round((time.perf_counter() - stream_started_at) * 1000),
                    },
                }
            else:
                full_text = f"没有保存成功：{save_result.get('error') or '未找到可保存的上一条回复。'}"
                metadata = {
                    "project_id": req.project_id,
                    "tool_calls": [
                        {
                            "tool_name": "save_previous_answer_as_markdown",
                            "status": "error",
                            "message": "保存上一条 AI 回复失败。",
                            "summary": full_text,
                            "error": save_result.get("error"),
                        }
                    ],
                    "markdown_followup_save": save_result,
                    "stage_timings": {
                        **state.stage_timings,
                        "total_stream_ms": round((time.perf_counter() - stream_started_at) * 1000),
                    },
                }
            state.full_text = full_text
            state.stage_timings.update(metadata["stage_timings"])
            yield sse_event({"type": "text", "content": full_text})
            yield sse_event(
                {
                    "type": "timing",
                    "key": "total_stream_ms",
                    "duration_ms": metadata["stage_timings"]["total_stream_ms"],
                }
            )
            need_title, assistant_message_id = persist_assistant_message(
                bind,
                runtime.conv_id,
                full_text,
                req.content,
                metadata,
            )
            state.need_title = need_title
            try:
                persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
            except Exception as exc:
                logger.warning("[P0] failed to persist markdown follow-up trace: %s", exc)
            yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})
            return

    task_route = runtime.intent_task_route if req.project_id else None
    if task_route is not None and not isinstance(getattr(task_route, "task_type", None), str):
        task_route = None
    if req.project_id and not runtime.intent_prepared_async:
        route_started_at = time.perf_counter()
        intent_decision = await classify_chat_intent_async(
            req,
            llm_complete=runtime.llm.complete,
            model=runtime.selected_model,
        )
        runtime.chat_mode = intent_decision.chat_mode
        runtime.action_policy = intent_decision.action_policy
        runtime.tool_access_policy = intent_decision.tool_access_policy
        runtime.intent_method = intent_decision.method
        runtime.intent_reason = intent_decision.reason
        runtime.intent_trace = intent_decision.trace
        runtime.artifact_contract = getattr(intent_decision, "artifact_contract", None)
        task_route = intent_decision.task_route
        state.stage_timings["route_task_ms"] = round((time.perf_counter() - route_started_at) * 1000)

    durable_task_type = task_route.task_type if task_route else None
    if not durable_task_type:
        return

    try:
        runtime.chat_mode = ChatMode.TASK_ORCHESTRATION
        runtime.action_policy = ActionPolicy.DURABLE_TASK
        runtime.tool_access_policy = ToolAccessPolicy.WRITE_ALLOWED
        runtime.intent_method = task_route.method if hasattr(task_route, "method") else runtime.intent_method
        runtime.intent_reason = task_route.reason or runtime.intent_reason
        yield sse_event(
            {
                "type": "status",
                "stage": "planning",
                "message": "这需要分步骤完成，我正在准备执行计划...",
            }
        )
        await task_stream_flush_pause()

        with Session(bind) as task_session:
            confirmation_reason = _task_confirmation_reason(runtime, req, task_route)
            task_input = {
                "title": task_route.title or req.content[:80],
                "source": "project_chat",
                "router": {
                    "confidence": task_route.confidence,
                    "reason": task_route.reason,
                    "output_kind": task_route.output_kind,
                    "artifact_contract": runtime.artifact_contract.to_dict()
                    if getattr(runtime.artifact_contract, "delivery_required", False)
                    else None,
                },
            }
            if confirmation_reason:
                task_input["requires_confirmation"] = True
                task_input["confirmation_reason"] = confirmation_reason
            task = create_task_run(
                task_session,
                project_id=req.project_id,
                task_type=durable_task_type,
                goal=req.content,
                input_data=task_input,
                plan_steps=list(task_route.plan_steps),
                conversation_id=runtime.conv_id,
            )
            if confirmation_reason:
                task_payload = pause_task_run_in_session(task_session, task.id, reason=confirmation_reason)
                task_payload = task_payload or serialize_task_run(task_session, task, include_events=True)
                full_text = f"已创建任务，但不会自动执行：{confirmation_reason}\n\n请在右上角「任务」面板确认后再开始。"
                metadata = {
                    "project_id": req.project_id,
                    "task_run": task_payload,
                    "task_run_id": task_payload.get("id"),
                    "task_type": durable_task_type,
                    "requires_confirmation": True,
                    "confirmation_reason": confirmation_reason,
                    "stage_timings": {
                        **state.stage_timings,
                        "total_stream_ms": round((time.perf_counter() - stream_started_at) * 1000),
                    },
                }
                yield sse_event({"type": "task_run", "task": task_payload})
                yield sse_event({"type": "text", "content": full_text})
                state.durable_task_completed = True
                state.full_text = full_text
                state.stage_timings.update(metadata["stage_timings"])
                state.record_trace_event(
                    "task_confirmation_required",
                    task_type=durable_task_type,
                    reason=confirmation_reason,
                )
                need_title, assistant_message_id = persist_assistant_message(
                    bind,
                    runtime.conv_id,
                    full_text,
                    req.content,
                    metadata,
                )
                state.need_title = need_title
                try:
                    persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
                except Exception as exc:
                    logger.warning("[P0] failed to persist paused task trace: %s", exc)
                yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})
                if need_title and full_text:
                    schedule_title_generation(
                        conv_id=runtime.conv_id,
                        user_content=req.content,
                        bind=bind,
                        complete_fn=runtime.llm.complete,
                    )
                return
            task_payload = serialize_task_run(task_session, task, include_events=True)
            yield sse_event({"type": "task_run", "task": task_payload})
            await task_stream_flush_pause()
            yield sse_event(
                {
                    "type": "text",
                    "content": f"已创建可追踪任务：{req.content}\n\n我会在下方持续更新每一步进展。\n\n",
                }
            )
            await task_stream_flush_pause()
            yield sse_event(
                {
                    "type": "status",
                    "stage": "tools",
                    "message": "执行计划已准备好，正在开始第一步。",
                }
            )
            await task_stream_flush_pause()

            async for task_event in stream_execute_task_run_in_session(task_session, task.id):
                event_message = task_event.get("message") or "任务状态已更新。"
                workflow_event = workflow_status_from_task_event(task_event)
                if workflow_event:
                    yield sse_event(workflow_event)
                    await task_stream_flush_pause()
                yield sse_event(
                    {
                        "type": "status",
                        "stage": "tools",
                        "message": event_message,
                        "task_event": task_event.get("event_type"),
                    }
                )
                await task_stream_flush_pause()
                yield sse_event({"type": "task_run", "task": task_event.get("task")})
                await task_stream_flush_pause()

            task_session.refresh(task)
            task_payload = serialize_task_run(task_session, task, include_events=True)

        # Build final response from task payload
        full_text = task_run_chat_brief(task_payload)
        metadata = {
            "project_id": req.project_id,
            "task_run": task_payload,
            "task_run_id": task_payload.get("id"),
            "task_type": durable_task_type,
            "stage_timings": {
                **state.stage_timings,
                "total_stream_ms": round((time.perf_counter() - stream_started_at) * 1000),
            },
        }

        artifacts = []
        for artifact in task_payload.get("artifacts") or []:
            artifact_meta = artifact.get("metadata") or {}
            if artifact_meta:
                artifacts.append(
                    {
                        "id": artifact.get("id"),
                        "project_file_id": artifact.get("project_file_id"),
                        "name": artifact.get("name"),
                        "file_type": artifact.get("file_type"),
                        "path": artifact.get("path"),
                        "description": artifact_meta.get("content") or artifact_meta.get("summary") or "",
                        "created_at": artifact.get("created_at"),
                    }
                )
        if artifacts:
            metadata["artifacts"] = artifacts

        tool_call_events = task_payload_tool_calls(task_payload)
        if tool_call_events:
            metadata["tool_calls"] = tool_call_events

        yield sse_event({"type": "text", "content": full_text})
        yield sse_event({"type": "task_run", "task": task_payload})
        yield sse_event(
            {
                "type": "timing",
                "key": "total_stream_ms",
                "duration_ms": metadata["stage_timings"]["total_stream_ms"],
            }
        )

        state.durable_task_completed = True
        state.full_text = full_text
        if artifacts:
            state.artifacts = artifacts
        if tool_call_events:
            state.tool_call_events = tool_call_events
        state.stage_timings.update(metadata["stage_timings"])

        need_title, assistant_message_id = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
        state.need_title = need_title
        try:
            persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
        except Exception as exc:
            logger.warning("[P0] failed to persist chat trace: %s", exc)
        yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})

        if need_title and full_text:
            schedule_title_generation(
                conv_id=runtime.conv_id,
                user_content=req.content,
                bind=bind,
                complete_fn=runtime.llm.complete,
            )

    except Exception as exc:
        logger.error(f"[durable_task_stream error] {exc}", exc_info=True)
        yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        state.durable_task_completed = True  # prevent fallback to normal flow
