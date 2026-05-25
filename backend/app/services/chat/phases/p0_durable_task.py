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

from app.config import UPLOADS_DIR
from app.models.db import ProjectFile
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy
from app.services.chat_tools import ChatRuntime, _to_user_friendly_error
from app.services.chat.working_memory import should_continue_current_artifact
from app.services.chat_store import persist_assistant_message
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import init_default_project_folders
from app.services.project_documents import ensure_markdown_filename, read_project_document_content, update_project_document_record
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


def _revision_prompt(existing: str, instruction: str, file_name: str) -> str:
    return (
        "你正在更新一个项目 Markdown 文件。请基于用户最新要求，直接输出完整的新版 Markdown 正文。\n"
        "要求：\n"
        "1. 保留与项目相关的事实，不要编造客户已确认的信息。\n"
        "2. 如果用户要求加强、深化、补充，请显著提升分析深度，而不是只改标题。\n"
        "3. 输出必须是完整 Markdown，不要解释过程，不要包裹代码块。\n\n"
        f"目标文件：{file_name}\n\n"
        f"用户最新要求：{instruction}\n\n"
        "当前文件内容：\n"
        f"{existing}"
    )


def _clean_markdown_response(text: str) -> str:
    value = str(text or "").strip()
    if value.startswith("```"):
        value = value.removeprefix("```markdown").removeprefix("```md").removeprefix("```").strip()
        if value.endswith("```"):
            value = value[:-3].strip()
    return value


async def _handle_markdown_artifact_continuation(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
    stream_started_at: float,
) -> AsyncIterator[str]:
    memory = getattr(runtime, "working_memory", None) or {}
    artifact = memory.get("current_artifact") if isinstance(memory, dict) else None
    if not req.project_id or not isinstance(artifact, dict):
        return
    file_id = artifact.get("project_file_id") or artifact.get("file_id")
    file_name = str(artifact.get("name") or memory.get("explicit_target_filename") or "").strip()
    file_type = str(artifact.get("file_type") or "").lower()
    if not file_id or not (file_type == "md" or file_name.lower().endswith(".md")):
        return
    if not should_continue_current_artifact(build_working_memory_placeholder(memory)):
        return

    with Session(bind) as session:
        project_file = session.get(ProjectFile, int(file_id))
        if not project_file or project_file.project_id != req.project_id or project_file.deleted_at:
            return
        if project_file.file_type.lower() != "md":
            return
        existing = read_project_document_content(project_file, uploads_dir=UPLOADS_DIR)
        prompt = _revision_prompt(existing, req.content, project_file.name)

        yield sse_event({"type": "status", "stage": "tools", "message": f"正在更新 {project_file.name}..."})
        revised = await runtime.llm.complete(
            [{"role": "user", "content": prompt}],
            system="你是严谨的咨询交付物编辑助手，只输出新版 Markdown 正文。",
            model=runtime.selected_model,
            max_tokens=runtime.max_tokens,
            temperature=min(float(runtime.temperature or 0.2), 0.4),
        )
        revised_content = _clean_markdown_response(revised)
        if len(revised_content) < 80 or revised_content == existing.strip():
            state.durable_task_completed = True
            full_text = "没有成功更新文件：模型没有生成有效的新版 Markdown 内容。请补充更具体的修改要求后重试。"
            metadata = {
                "project_id": req.project_id,
                "working_memory": memory,
                "delivery_failed": {
                    "reason": "empty_or_unchanged_revision",
                    "target_file_id": project_file.id,
                    "target_file_name": project_file.name,
                },
                "tool_calls": [
                    {
                        "tool_name": "update_project_markdown_document",
                        "status": "error",
                        "message": "Markdown 续改失败：没有生成有效新版内容。",
                        "error": "empty_or_unchanged_revision",
                    }
                ],
                "stage_timings": {
                    **state.stage_timings,
                    "total_stream_ms": round((time.perf_counter() - stream_started_at) * 1000),
                },
            }
            state.full_text = full_text
            yield sse_event({"type": "text", "content": full_text})
            _, assistant_message_id = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
            yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})
            return

        result = update_project_document_record(
            session,
            req.project_id,
            project_file.id,
            uploads_dir=UPLOADS_DIR,
            init_default_folders=init_default_project_folders,
            content=revised_content,
        )
        mark_project_memory_stale(session, req.project_id, trigger="chat_markdown_continuation_update")
        state.durable_task_completed = True
        full_text = f"已更新项目 Markdown 文件：{result.get('name')}"
        metadata = {
            "project_id": req.project_id,
            "working_memory": {
                **memory,
                "current_artifact": {
                    "project_file_id": result.get("project_file_id") or result.get("id"),
                    "name": result.get("name"),
                    "file_type": "md",
                    "path": result.get("path"),
                    "folder_id": result.get("folder_id"),
                    "source": "markdown_continuation_update",
                },
            },
            "tool_calls": [
                {
                    "tool_name": "update_project_markdown_document",
                    "status": "completed",
                    "message": "已根据多轮上下文更新当前 Markdown 文件。",
                    "summary": f"Updated {result.get('name')}",
                }
            ],
            "artifacts": [
                {
                    "project_file_id": result.get("project_file_id") or result.get("id"),
                    "id": result.get("id"),
                    "name": result.get("name"),
                    "file_type": "md",
                    "path": result.get("path"),
                    "description": revised_content[:1200],
                }
            ],
            "stage_timings": {
                **state.stage_timings,
                "total_stream_ms": round((time.perf_counter() - stream_started_at) * 1000),
            },
        }
        state.full_text = full_text
        state.tool_call_events = metadata["tool_calls"]
        state.artifacts = metadata["artifacts"]
        state.stage_timings.update(metadata["stage_timings"])
        yield sse_event({"type": "text", "content": full_text})
        yield sse_event({"type": "tool_result", "result": {"status": "completed", "tool_name": "update_project_markdown_document", "output": result}})
        need_title, assistant_message_id = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
        state.need_title = need_title
        try:
            persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
        except Exception as exc:
            logger.warning("[P0] failed to persist markdown continuation trace: %s", exc)
        yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})


def build_working_memory_placeholder(memory: dict):
    from app.services.chat.working_memory import WorkingMemory

    return WorkingMemory(
        current_artifact=memory.get("current_artifact"),
        current_task=memory.get("current_task"),
        explicit_target_filename=str(memory.get("explicit_target_filename") or ""),
        continuation_requested=bool(memory.get("continuation_requested")),
        last_user_request=str(memory.get("last_user_request") or ""),
        last_assistant_summary=str(memory.get("last_assistant_summary") or ""),
    )


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
    memory = getattr(runtime, "working_memory", None) or {}
    if isinstance(memory, dict) and memory.get("continuation_requested") and memory.get("current_artifact"):
        async for event in _handle_markdown_artifact_continuation(runtime, req, bind, state, stream_started_at):
            yield event
        if state.durable_task_completed:
            return

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
            contract = runtime.artifact_contract if getattr(runtime.artifact_contract, "delivery_required", False) else None
            contract_title = str(getattr(contract, "title", "") or "").strip()
            task_title = contract_title or task_route.title or req.content[:80]
            task_input = {
                "title": task_title,
                "source": "project_chat",
                "router": {
                    "confidence": task_route.confidence,
                    "reason": task_route.reason,
                    "output_kind": task_route.output_kind,
                    "artifact_contract": contract.to_dict() if contract else None,
                },
            }
            if contract and str(contract.output_kind or "").lower() == "md" and task_title:
                task_input["file_name"] = ensure_markdown_filename(task_title)
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
