"""P0 — Durable task early-return path.

If the user's message maps to a long-running project task (e.g. data-collection,
document generation pipeline), we route it through the task orchestrator instead
of the normal chat flow.
"""
from __future__ import annotations

import logging
import json
import time
from collections.abc import AsyncIterator
from datetime import timedelta

from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.models.db import PendingToolAction, ProjectFile
from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.approval_envelope import (
    APPROVAL_ENVELOPE_PREFIX,
    approval_envelope_hash,
)
from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy
from app.services.chat.pending_actions import tool_confirmation_token
from app.services.chat_tools import ChatRuntime
from app.services.chat.working_memory import should_continue_current_artifact
from app.services.chat_store import persist_assistant_message
from app.services.project_documents import ensure_markdown_filename, read_project_document_content
from app.services.time_utils import utc_now_naive
from app.services.task_orchestrator import (
    create_task_run,
    pause_task_run_in_session,
    serialize_task_run,
    stream_execute_task_run_in_session,
    task_run_chat_brief,
)
from app.services.intent_router import classify_chat_intent_async
from app.services.chat.markdown_followup import save_previous_answer_as_markdown
from app.services.title_generator import generate_conversation_title
from app.services.chat.state import ChatSessionState
from app.services.chat.product_run_events import (
    ToolProgressStatus,
    task_update as _task_update_event,
)
from app.services.chat.sse import sse_event, task_stream_flush_pause


_V1_TASK_STATUS_MAP = {
    "pending": ToolProgressStatus.PENDING,
    "paused": ToolProgressStatus.PENDING,
    "running": ToolProgressStatus.RUNNING,
    "completed": ToolProgressStatus.COMPLETED,
    "failed": ToolProgressStatus.FAILED,
    "canceled": ToolProgressStatus.FAILED,
}


def _v1_task_update_from_payload(run_id: str, task_payload: dict | None) -> str | None:
    """Build a Product Run Event v1 ``task_update`` SSE frame from a TaskRun payload.

    Returns ``None`` if the run isn't tracked (legacy / no run_id), the payload
    is unusable, or the TaskRun's status doesn't map to a v1 enum value. Used at
    every site in this module that emits the legacy ``task_run`` event so v1
    consumers see a parallel, well-typed progress signal.
    """
    if not run_id or not isinstance(task_payload, dict):
        return None
    task_id = task_payload.get("id")
    if task_id is None:
        return None
    raw_status = str(task_payload.get("status") or "").lower()
    v1_status = _V1_TASK_STATUS_MAP.get(raw_status)
    if v1_status is None:
        return None

    steps = [s for s in (task_payload.get("steps") or []) if isinstance(s, dict)]
    total = len(steps)
    completed = sum(
        1 for s in steps if str(s.get("status") or "").lower() == "completed"
    )

    kwargs: dict = {}
    if total > 0:
        kwargs["total_steps"] = total
        kwargs["progress_pct"] = min(100, max(0, round(completed / total * 100)))

    current_key = task_payload.get("current_step_key")
    if current_key:
        for idx, step in enumerate(steps, start=1):
            if step.get("step_key") == current_key:
                if total > 0:
                    kwargs["current_step"] = idx
                title = step.get("title") or step.get("step_title")
                if title:
                    kwargs["step_title"] = str(title)
                break

    return sse_event(_task_update_event(run_id, task_id, v1_status, **kwargs))
from app.services.chat.trace import persist_chat_trace
from app.services.chat.workflow import workflow_status_from_task_event, task_payload_tool_calls
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME

logger = logging.getLogger(__name__)


def _runtime_turn_contract(runtime: ChatRuntime) -> dict:
    prepare_metrics = getattr(runtime, "prepare_metrics", None)
    if not isinstance(prepare_metrics, dict):
        return {}
    turn_contract = prepare_metrics.get("turn_contract")
    return dict(turn_contract) if isinstance(turn_contract, dict) else {}


def _attach_turn_contract_metadata(metadata: dict, runtime: ChatRuntime) -> dict:
    turn_contract = _runtime_turn_contract(runtime)
    if turn_contract:
        metadata["turn_contract"] = turn_contract
    prepare_metrics = getattr(runtime, "prepare_metrics", None)
    turn_revision = prepare_metrics.get("turn_revision") if isinstance(prepare_metrics, dict) else None
    if isinstance(turn_revision, dict) and turn_revision:
        metadata["turn_revision"] = dict(turn_revision)
    if isinstance(prepare_metrics, dict):
        for audit_key in (
            "turn_recovery",
            "project_world_state_change",
        ):
            audit_value = prepare_metrics.get(audit_key)
            if isinstance(audit_value, dict) and audit_value:
                metadata[audit_key] = dict(audit_value)
    return metadata


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


def _p0_approval_batch_id(conversation_id: int, confirmation_token: str) -> str:
    return f"hitas-{conversation_id}-{confirmation_token.split(':')[-1]}"


def _persist_markdown_continuation_action(
    bind,
    *,
    runtime: ChatRuntime,
    req: SendMessageRequest,
    project_file: ProjectFile,
    revised_content: str,
    details: list[str],
) -> tuple[int | None, dict, dict]:
    tool_input = {
        "project_id": req.project_id,
        "mode": "replace",
        "file_id": project_file.id,
        "file_name": project_file.name,
        "content": revised_content,
    }
    confirmation_token = tool_confirmation_token(PROJECT_MARKDOWN_TOOL_NAME, tool_input)
    pending_confirmation = {
        "confirmation_token": confirmation_token,
        "tool_name": PROJECT_MARKDOWN_TOOL_NAME,
        "tool_input": tool_input,
        "tool_use_id": f"markdown-continuation-{confirmation_token[-12:]}",
        "details": details,
        "summary": "需要确认后才会覆盖当前 Markdown 文件。",
        "stage": "p0_markdown_continuation_preview",
        "can_confirm": True,
    }
    action_payload = {
        "action_type": "modify_document",
        "title": "确认修改 Markdown 文档",
        "description": "即将用 AI 生成的新版内容覆盖当前项目 Markdown 文件。",
        "details": details,
        "tool_name": PROJECT_MARKDOWN_TOOL_NAME,
        "tool_input": tool_input,
        "confirmation_token": confirmation_token,
    }

    with Session(bind) as session:
        tool_input_json = json.dumps(tool_input, ensure_ascii=False, default=str)
        policy_at_creation = str(
            getattr(runtime.action_policy, "value", runtime.action_policy) or ""
        )
        approval_batch_id = _p0_approval_batch_id(runtime.conv_id, confirmation_token)
        existing = session.exec(
            select(PendingToolAction)
            .where(PendingToolAction.conversation_id == runtime.conv_id)
            .where(PendingToolAction.tool_name == PROJECT_MARKDOWN_TOOL_NAME)
            .where(PendingToolAction.tool_input_json == tool_input_json)
            .where(PendingToolAction.status == "pending")
            .order_by(PendingToolAction.created_at.desc(), PendingToolAction.id.desc())
        ).first()
        if existing:
            if not existing.tool_input_hash.startswith(APPROVAL_ENVELOPE_PREFIX):
                existing.action_type = "modify_document"
                existing.risk_level = "high"
                existing.policy_at_creation = policy_at_creation
                existing.approval_batch_id = approval_batch_id
                existing.tool_input_hash = approval_envelope_hash(
                    tool_name=existing.tool_name,
                    tool_input=tool_input,
                    project_id=existing.project_id,
                    action_type=existing.action_type,
                    risk_level=existing.risk_level,
                    policy_at_creation=existing.policy_at_creation,
                    approval_batch_id=existing.approval_batch_id,
                    sequence_index=existing.sequence_index,
                )
                session.add(existing)
                session.commit()
            return existing.id, pending_confirmation, action_payload

        action = PendingToolAction(
            trace_id=str(getattr(runtime, "trace_id", "") or f"conv-{runtime.conv_id}"),
            conversation_id=runtime.conv_id,
            project_id=req.project_id,
            tool_name=PROJECT_MARKDOWN_TOOL_NAME,
            tool_input_json=tool_input_json,
            action_type="modify_document",
            risk_level="high",
            policy_at_creation=policy_at_creation,
            tool_input_hash=approval_envelope_hash(
                tool_name=PROJECT_MARKDOWN_TOOL_NAME,
                tool_input=tool_input,
                project_id=req.project_id,
                action_type="modify_document",
                risk_level="high",
                policy_at_creation=policy_at_creation,
                approval_batch_id=approval_batch_id,
                sequence_index=0,
            ),
            approval_batch_id=approval_batch_id,
            sequence_index=0,
            title="确认修改 Markdown 文档",
            description="即将用 AI 生成的新版内容覆盖当前项目 Markdown 文件。",
            details_json=json.dumps(details, ensure_ascii=False, default=str),
            status="pending",
            expires_at=utc_now_naive() + timedelta(hours=24),
        )
        session.add(action)
        session.commit()
        session.refresh(action)
        return action.id, pending_confirmation, action_payload


def _attach_pending_action_message(bind, action_id: int | None, message_id: int | None) -> None:
    if not action_id or not message_id:
        return
    with Session(bind) as session:
        action = session.get(PendingToolAction, action_id)
        if action and action.message_id is None:
            action.message_id = message_id
            session.add(action)
            session.commit()


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
    policy_value = str(getattr(runtime.action_policy, "value", runtime.action_policy) or "")
    if policy_value == ActionPolicy.DESTRUCTIVE_ACTION.value:
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
            state.replace_tool_execution_records(metadata["tool_calls"])
            metadata["tool_calls"] = state.tool_call_events
            state.full_text = full_text
            yield sse_event({"type": "text", "content": full_text})
            _attach_turn_contract_metadata(metadata, runtime)
            _, assistant_message_id = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
            state.assistant_message_id = assistant_message_id
            yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})
            return

        details = [
            f"目标文件：{project_file.name}（ID {project_file.id}）",
            "确认后将用 AI 生成的完整新版 Markdown 覆盖当前文件。",
            f"新版内容长度：{len(revised_content)} 字符。",
        ]
        action_id, pending_confirmation, action_payload = _persist_markdown_continuation_action(
            bind,
            runtime=runtime,
            req=req,
            project_file=project_file,
            revised_content=revised_content,
            details=details,
        )
        state.durable_task_completed = True
        state.confirmation_requested = True
        full_text = (
            f"已生成 {project_file.name} 的新版 Markdown 修改预览，但还没有写入文件。\n\n"
            "请在 Action Preview 中确认后，我再执行覆盖更新。"
        )
        tool_call_event = {
            "tool_name": PROJECT_MARKDOWN_TOOL_NAME,
            "status": "confirmation_required",
            "message": "已生成 Markdown 续改预览，等待用户确认后再写入项目文件。",
            "summary": "需要确认后才会覆盖当前 Markdown 文件。",
            "confirmation_token": pending_confirmation["confirmation_token"],
            "details": details,
        }
        state.pending_tool_confirmations = [pending_confirmation]
        state.pending_tool_actions = [action_payload]
        metadata = {
            "project_id": req.project_id,
            "working_memory": {
                **memory,
                "current_artifact": {
                    "project_file_id": project_file.id,
                    "name": project_file.name,
                    "file_type": "md",
                    "path": project_file.path,
                    "folder_id": project_file.folder_id,
                    "source": "markdown_continuation_preview",
                },
            },
            "tool_calls": [tool_call_event],
            "pending_tool_confirmations": [pending_confirmation],
            "pending_action_ids": [action_id] if action_id else [],
            "stage_timings": {
                **state.stage_timings,
                "total_stream_ms": round((time.perf_counter() - stream_started_at) * 1000),
            },
        }
        state.full_text = full_text
        state.replace_tool_execution_records([tool_call_event])
        metadata["tool_calls"] = state.tool_call_events
        state.stage_timings.update(metadata["stage_timings"])
        yield sse_event({"type": "text", "content": full_text})
        yield sse_event(
            {
                "type": "tool_result",
                "result": {
                    "status": "confirmation_required",
                    "tool_name": PROJECT_MARKDOWN_TOOL_NAME,
                    "confirmation_token": pending_confirmation["confirmation_token"],
                    "details": details,
                    "summary": "Markdown 修改预览已冻结，等待确认后执行。",
                },
            }
        )
        _attach_turn_contract_metadata(metadata, runtime)
        need_title, assistant_message_id = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
        _attach_pending_action_message(bind, action_id, assistant_message_id)
        state.need_title = need_title
        state.assistant_message_id = assistant_message_id
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
        explicit_target_is_write=bool(memory.get("explicit_target_is_write")),
        continuation_requested=bool(memory.get("continuation_requested")),
        last_user_request=str(memory.get("last_user_request") or ""),
        last_assistant_summary=str(memory.get("last_assistant_summary") or ""),
        summary=str(memory.get("summary") or ""),
        user_constraints=[
            str(item).strip()
            for item in (memory.get("user_constraints") if isinstance(memory.get("user_constraints"), list) else [])[:12]
            if item is not None and str(item).strip() and str(item).strip().lower() != "none"
        ],
        decisions=[
            item
            for item in (memory.get("decisions") if isinstance(memory.get("decisions"), list) else [])[:12]
            if isinstance(item, dict)
        ],
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


async def _stream_conversation_title(runtime: ChatRuntime, req, bind):
    """Generate the conversation title in-band and yield a ``conversation_title``
    SSE event so the open page updates live.

    The durable-task stream used to fire-and-forget ``schedule_title_generation``,
    which writes the title to the DB but never tells the client — so the open
    conversation kept showing the ``对话 #<id>`` placeholder until a hard refresh.
    Mirror the regular chat path (persist.py) instead: generate in-band, push the
    typed event. The frontend keeps reading past ``done`` until the stream closes,
    so emitting after ``done`` is fine.
    """
    try:
        generated = await generate_conversation_title(
            conv_id=runtime.conv_id,
            user_content=req.content,
            session_factory=lambda: Session(bind),
            complete_fn=runtime.llm.complete,
            language=getattr(req, "language", None),
        )
    except Exception as exc:  # pragma: no cover - non-fatal, fallback title stays
        logger.warning("[durable_task] auto-title generation failed: %s", exc)
        return
    if generated:
        yield sse_event(
            {
                "type": "conversation_title",
                "conversation_id": runtime.conv_id,
                "title": generated,
            }
        )


async def run_durable_task(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    bind,
    state: ChatSessionState,
) -> AsyncIterator[str]:
    """Attempt to route the request as a durable task.

    Yields SSE events.  If a durable task is started, sets
    ``state.durable_task_completed = True`` so the orchestrator can return early.
    """
    turn_contract = _runtime_turn_contract(runtime)
    if turn_contract.get("mode") == "plan_only":
        return

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
            state.replace_tool_execution_records(metadata["tool_calls"])
            metadata["tool_calls"] = state.tool_call_events
            state.artifacts = list(metadata.get("artifacts") or [])
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
            _attach_turn_contract_metadata(metadata, runtime)
            need_title, assistant_message_id = persist_assistant_message(
                bind,
                runtime.conv_id,
                full_text,
                req.content,
                metadata,
            )
            state.need_title = need_title
            state.assistant_message_id = assistant_message_id
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
            task_goal = str(turn_contract.get("user_goal") or req.content).strip() or req.content
            user_constraints = [
                str(item).strip()
                for item in list(turn_contract.get("user_constraints") or [])
                if str(item).strip()
            ][:8]
            if user_constraints:
                task_goal = f"{task_goal}\n\n明确约束：\n" + "\n".join(
                    f"- {item}" for item in user_constraints
                )
            task_input = {
                "title": task_title,
                "source": "project_chat",
                "turn_brief": {
                    "goal": str(turn_contract.get("user_goal") or ""),
                    "constraints": user_constraints,
                },
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
                goal=task_goal,
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
                v1_evt = _v1_task_update_from_payload(state.run_id, task_payload)
                if v1_evt:
                    yield v1_evt
                yield sse_event({"type": "text", "content": full_text})
                state.durable_task_completed = True
                state.confirmation_requested = True
                state.full_text = full_text
                state.stage_timings.update(metadata["stage_timings"])
                state.record_trace_event(
                    "task_confirmation_required",
                    task_type=durable_task_type,
                    reason=confirmation_reason,
                )
                _attach_turn_contract_metadata(metadata, runtime)
                need_title, assistant_message_id = persist_assistant_message(
                    bind,
                    runtime.conv_id,
                    full_text,
                    req.content,
                    metadata,
                )
                state.need_title = need_title
                state.assistant_message_id = assistant_message_id
                try:
                    persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
                except Exception as exc:
                    logger.warning("[P0] failed to persist paused task trace: %s", exc)
                yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})
                if need_title and full_text:
                    async for title_evt in _stream_conversation_title(runtime, req, bind):
                        yield title_evt
                return
            task_payload = serialize_task_run(task_session, task, include_events=True)
            yield sse_event({"type": "task_run", "task": task_payload})
            v1_evt = _v1_task_update_from_payload(state.run_id, task_payload)
            if v1_evt:
                yield v1_evt
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
                v1_evt = _v1_task_update_from_payload(state.run_id, task_event.get("task"))
                if v1_evt:
                    yield v1_evt
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
            state.replace_tool_execution_records(tool_call_events)
            tool_call_events = state.tool_call_events
            metadata["tool_calls"] = tool_call_events

        yield sse_event({"type": "text", "content": full_text})
        yield sse_event({"type": "task_run", "task": task_payload})
        v1_evt = _v1_task_update_from_payload(state.run_id, task_payload)
        if v1_evt:
            yield v1_evt
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
        state.stage_timings.update(metadata["stage_timings"])

        _attach_turn_contract_metadata(metadata, runtime)
        need_title, assistant_message_id = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
        state.need_title = need_title
        state.assistant_message_id = assistant_message_id
        try:
            persist_chat_trace(bind, runtime, state, message_id=assistant_message_id)
        except Exception as exc:
            logger.warning("[P0] failed to persist chat trace: %s", exc)
        yield sse_event({"type": "done", **metadata, "assistant_message_id": assistant_message_id})

        if need_title and full_text:
            async for title_evt in _stream_conversation_title(runtime, req, bind):
                yield title_evt

    except Exception as exc:
        logger.error(f"[durable_task_stream error] {exc}", exc_info=True)
        raise
