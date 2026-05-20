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
from app.services.chat_tools import ChatRuntime, _to_user_friendly_error
from app.services.chat_store import persist_assistant_message
from app.services.task_orchestrator import (
    create_task_run,
    route_project_task_request,
    serialize_task_run,
    stream_execute_task_run_in_session,
    task_run_chat_brief,
)
from app.services.title_generator import schedule_title_generation
from app.services.chat.state import ChatSessionState
from app.services.chat.sse import sse_event, task_stream_flush_pause
from app.services.chat.workflow import workflow_status_from_task_event, task_payload_tool_calls

logger = logging.getLogger(__name__)


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
    task_route = None
    if req.project_id:
        route_started_at = time.perf_counter()
        task_route = await route_project_task_request(
            req.content,
            llm_complete=runtime.llm.complete,
            model=runtime.selected_model,
        )
        state.stage_timings["route_task_ms"] = round((time.perf_counter() - route_started_at) * 1000)

    durable_task_type = task_route.task_type if task_route else None
    if not durable_task_type:
        return

    try:
        yield sse_event(
            {
                "type": "status",
                "stage": "planning",
                "message": "这需要分步骤完成，我正在准备执行计划...",
            }
        )
        await task_stream_flush_pause()

        with Session(bind) as task_session:
            task = create_task_run(
                task_session,
                project_id=req.project_id,
                task_type=durable_task_type,
                goal=req.content,
                input_data={
                    "title": task_route.title or req.content[:80],
                    "source": "project_chat",
                    "router": {
                        "confidence": task_route.confidence,
                        "reason": task_route.reason,
                        "output_kind": task_route.output_kind,
                    },
                },
                plan_steps=list(task_route.plan_steps),
                conversation_id=runtime.conv_id,
            )
            task_payload = serialize_task_run(task_session, task, include_events=True)
            yield sse_event({"type": "task_run", "task": task_payload})
            await task_stream_flush_pause()
            yield sse_event(
                {
                    "type": "text",
                    "content": f"我会把这件事拆成几个可追踪步骤处理：{req.content}\n\n",
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

        need_title = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
        yield sse_event({"type": "done", **metadata})

        if need_title and full_text:
            schedule_title_generation(
                conv_id=runtime.conv_id,
                user_content=req.content,
                bind=bind,
                complete_fn=runtime.llm.complete,
            )

        state.durable_task_completed = True
        state.full_text = full_text
        state.need_title = need_title
        if artifacts:
            state.artifacts = artifacts
        if tool_call_events:
            state.tool_call_events = tool_call_events

    except Exception as exc:
        logger.error(f"[durable_task_stream error] {exc}", exc_info=True)
        yield sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        state.durable_task_completed = True  # prevent fallback to normal flow
