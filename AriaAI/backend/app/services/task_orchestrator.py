"""Durable task orchestration for project work.

The goal is intentionally modest: persist every run and every step before
execution so a browser refresh, SSE disconnect, or tool failure does not erase
what happened.  Executors stay small and typed; LLM-heavy planning can be added
on top without changing the task state model.
"""
from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlmodel import Session, select

from app.database import engine
from app.models.db import Project, TaskArtifact, TaskEvent, TaskRun, TaskStep
from app.routers.projects_deps import _build_project_briefing
from app.services.time_utils import utc_now_naive
from app.tools.office_documents import write_project_office_document

TASK_STATUS_TERMINAL = {"completed", "failed", "canceled"}
SUPPORTED_TASK_TYPES = {"generate_client_ppt"}
_PPT_INTENT_TERMS = ("ppt", "pptx", "powerpoint", "deck", "slides", "幻灯片", "演示文稿", "演示材料", "客户介绍")
_CREATE_INTENT_TERMS = ("准备", "生成", "创建", "做", "制作", "输出", "给客户", "介绍", "proposal", "prepare", "create", "generate", "make")


@dataclass(frozen=True)
class StepSpec:
    key: str
    title: str
    step_type: str
    retryable: bool = True


GENERATE_CLIENT_PPT_STEPS = [
    StepSpec("collect_context", "收集项目上下文", "collect_project_context"),
    StepSpec("draft_slide_spec", "生成结构化大纲", "build_slide_spec"),
    StepSpec("create_deck", "生成并保存 PPT", "write_project_office_document"),
    StepSpec("summarize_result", "整理交付结果", "summarize_result", retryable=False),
]


def detect_project_task_type(content: str) -> str | None:
    """Detect requests that should run as durable project tasks instead of a single chat turn."""
    normalized = (content or "").strip().lower()
    if not normalized:
        return None
    wants_ppt = any(term in normalized for term in _PPT_INTENT_TERMS)
    wants_create = any(term in normalized for term in _CREATE_INTENT_TERMS)
    if wants_ppt and wants_create:
        return "generate_client_ppt"
    return None


def _json_dumps(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, default=str)


def _json_loads(value: str | None, fallback: Any = None) -> Any:
    if not value:
        return {} if fallback is None else fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return {} if fallback is None else fallback


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _slugify_filename(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9\u4e00-\u9fa5._-]+", "-", value.strip()).strip("-")
    return slug or "client-introduction"


def _record_event(
    session: Session,
    task: TaskRun,
    *,
    event_type: str,
    message: str = "",
    payload: dict | None = None,
    step: TaskStep | None = None,
) -> TaskEvent:
    event = TaskEvent(
        task_run_id=task.id,
        step_id=step.id if step else None,
        event_type=event_type,
        message=message,
        payload_json=_json_dumps(payload or {}),
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


def _serialize_step(step: TaskStep) -> dict[str, Any]:
    return {
        "id": step.id,
        "task_run_id": step.task_run_id,
        "key": step.key,
        "title": step.title,
        "step_type": step.step_type,
        "status": step.status,
        "sort_order": step.sort_order,
        "input": _json_loads(step.input_json),
        "output": _json_loads(step.output_json),
        "error_code": step.error_code,
        "error_message": step.error_message,
        "retryable": step.retryable,
        "retry_count": step.retry_count,
        "created_at": _serialize_datetime(step.created_at),
        "updated_at": _serialize_datetime(step.updated_at),
        "started_at": _serialize_datetime(step.started_at),
        "completed_at": _serialize_datetime(step.completed_at),
    }


def _serialize_artifact(artifact: TaskArtifact) -> dict[str, Any]:
    return {
        "id": artifact.id,
        "task_run_id": artifact.task_run_id,
        "step_id": artifact.step_id,
        "project_file_id": artifact.project_file_id,
        "name": artifact.name,
        "file_type": artifact.file_type,
        "path": artifact.path,
        "metadata": _json_loads(artifact.metadata_json),
        "created_at": _serialize_datetime(artifact.created_at),
    }


def _serialize_event(event: TaskEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "task_run_id": event.task_run_id,
        "step_id": event.step_id,
        "event_type": event.event_type,
        "message": event.message,
        "payload": _json_loads(event.payload_json),
        "created_at": _serialize_datetime(event.created_at),
    }


def serialize_task_run(session: Session, task: TaskRun, *, include_events: bool = False) -> dict[str, Any]:
    steps = session.exec(
        select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)
    ).all()
    artifacts = session.exec(
        select(TaskArtifact).where(TaskArtifact.task_run_id == task.id).order_by(TaskArtifact.created_at)
    ).all()
    payload: dict[str, Any] = {
        "id": task.id,
        "project_id": task.project_id,
        "conversation_id": task.conversation_id,
        "parent_task_id": task.parent_task_id,
        "created_by_user_id": task.created_by_user_id,
        "task_type": task.task_type,
        "goal": task.goal,
        "status": task.status,
        "current_step_key": task.current_step_key,
        "input": _json_loads(task.input_json),
        "output": _json_loads(task.output_json),
        "error_code": task.error_code,
        "error_message": task.error_message,
        "retry_count": task.retry_count,
        "created_at": _serialize_datetime(task.created_at),
        "updated_at": _serialize_datetime(task.updated_at),
        "started_at": _serialize_datetime(task.started_at),
        "completed_at": _serialize_datetime(task.completed_at),
        "steps": [_serialize_step(step) for step in steps],
        "artifacts": [_serialize_artifact(artifact) for artifact in artifacts],
    }
    if include_events:
        events = session.exec(
            select(TaskEvent).where(TaskEvent.task_run_id == task.id).order_by(TaskEvent.created_at)
        ).all()
        payload["events"] = [_serialize_event(event) for event in events]
    return payload


def task_run_chat_summary(payload: dict[str, Any]) -> str:
    status_label = {
        "pending": "等待中",
        "running": "执行中",
        "completed": "已完成",
        "failed": "失败",
        "canceled": "已取消",
    }.get(str(payload.get("status")), str(payload.get("status") or "未知"))
    lines = [
        f"已创建可恢复任务：{payload.get('goal') or payload.get('task_type')}",
        f"任务 ID：{payload.get('id')}",
        f"当前状态：{status_label}",
        "",
        "编排日志：",
    ]
    step_status = {
        "pending": "等待",
        "running": "执行中",
        "completed": "完成",
        "failed": "失败",
        "skipped": "跳过",
    }
    for index, step in enumerate(payload.get("steps") or [], start=1):
        status = step_status.get(str(step.get("status")), str(step.get("status") or "-"))
        line = f"{index}. {step.get('title') or step.get('key')}：{status}"
        if step.get("error_message"):
            line += f"（{step.get('error_message')}）"
        elif step.get("status") == "completed":
            output = step.get("output") or {}
            if step.get("key") == "collect_context":
                project = output.get("project") or {}
                line += f"。已读取项目「{project.get('name') or '-'}」和客户「{project.get('client') or '-'}」上下文。"
            elif step.get("key") == "draft_slide_spec":
                line += f"。已生成 {len(output.get('slides') or [])} 页 PPT 结构。"
            elif step.get("key") == "create_deck":
                line += f"。已保存文件「{output.get('name') or output.get('file_name') or '-'}」。"
        lines.append(line)

    artifacts = payload.get("artifacts") or []
    if artifacts:
        lines.extend(["", "生成物："])
        for artifact in artifacts:
            lines.append(f"- {artifact.get('name')}（{str(artifact.get('file_type') or '').upper()}）已保存到项目空间")
    elif payload.get("status") == "failed":
        lines.extend(["", "你可以稍后从失败步骤重试，前面已完成的步骤不会丢失。"])
    return "\n".join(lines)


def task_step_log_message(event_type: str, step: dict[str, Any] | None = None, output: dict | None = None) -> str:
    if event_type == "task_started":
        return "编排器已启动：将按步骤执行，并记录每一步状态。"
    if event_type == "task_completed":
        return "编排器已完成：结果和生成物已保存。"
    if not step:
        return "任务状态已更新。"
    prefix = f"第 {step.get('sort_order')} 步：{step.get('title') or step.get('key')}"
    if event_type == "step_started":
        return f"{prefix}，开始执行。"
    if event_type == "step_completed":
        if step.get("key") == "collect_context":
            project = (output or {}).get("project") or {}
            return f"{prefix}，完成。已读取项目「{project.get('name') or '-'}」和客户「{project.get('client') or '-'}」资料。"
        if step.get("key") == "draft_slide_spec":
            return f"{prefix}，完成。已形成 {len((output or {}).get('slides') or [])} 页 PPT 结构。"
        if step.get("key") == "create_deck":
            return f"{prefix}，完成。PPT 文件「{(output or {}).get('name') or (output or {}).get('file_name') or '-'}」已保存到项目空间。"
        return f"{prefix}，完成。"
    if event_type == "step_failed":
        return f"{prefix}，失败：{step.get('error_message') or '未知错误'}。前面已完成步骤会保留，可从这里重试。"
    return f"{prefix}，状态更新为 {step.get('status')}。"


def create_task_run(
    session: Session,
    *,
    project_id: int | None,
    task_type: str,
    goal: str,
    input_data: dict | None = None,
    conversation_id: int | None = None,
    created_by_user_id: int | None = None,
) -> TaskRun:
    if task_type not in SUPPORTED_TASK_TYPES:
        raise ValueError(f"Unsupported task type: {task_type}")
    now = utc_now_naive()
    task = TaskRun(
        project_id=project_id,
        conversation_id=conversation_id,
        created_by_user_id=created_by_user_id,
        task_type=task_type,
        goal=goal.strip() or task_type,
        input_json=_json_dumps(input_data or {}),
        status="pending",
        created_at=now,
        updated_at=now,
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    steps = GENERATE_CLIENT_PPT_STEPS if task_type == "generate_client_ppt" else []
    for index, spec in enumerate(steps, start=1):
        session.add(
            TaskStep(
                task_run_id=task.id,
                key=spec.key,
                title=spec.title,
                step_type=spec.step_type,
                sort_order=index,
                retryable=spec.retryable,
            )
        )
    session.commit()
    _record_event(session, task, event_type="task_created", message="任务已创建", payload={"task_type": task_type})
    return task


def list_project_task_runs(session: Session, project_id: int, *, limit: int = 50) -> list[dict[str, Any]]:
    tasks = session.exec(
        select(TaskRun)
        .where(TaskRun.project_id == project_id)
        .order_by(TaskRun.created_at.desc())
        .limit(limit)
    ).all()
    return [serialize_task_run(session, task) for task in tasks]


def get_task_run_or_none(session: Session, task_id: int) -> TaskRun | None:
    return session.get(TaskRun, task_id)


def _start_step(session: Session, task: TaskRun, step: TaskStep) -> None:
    now = utc_now_naive()
    task.status = "running"
    task.current_step_key = step.key
    task.updated_at = now
    task.started_at = task.started_at or now
    step.status = "running"
    step.started_at = step.started_at or now
    step.updated_at = now
    session.add(task)
    session.add(step)
    session.commit()
    _record_event(session, task, step=step, event_type="step_started", message=f"{step.title}开始")


def _complete_step(session: Session, task: TaskRun, step: TaskStep, output: dict) -> None:
    now = utc_now_naive()
    step.status = "completed"
    step.output_json = _json_dumps(output)
    step.error_code = ""
    step.error_message = ""
    step.updated_at = now
    step.completed_at = now
    task.updated_at = now
    session.add(step)
    session.add(task)
    session.commit()
    _record_event(session, task, step=step, event_type="step_completed", message=f"{step.title}完成", payload=output)


def _fail_step(session: Session, task: TaskRun, step: TaskStep, exc: Exception) -> None:
    now = utc_now_naive()
    step.status = "failed"
    step.error_code = exc.__class__.__name__
    step.error_message = str(exc)
    step.updated_at = now
    step.completed_at = now
    task.status = "failed"
    task.current_step_key = step.key
    task.error_code = step.error_code
    task.error_message = step.error_message
    task.updated_at = now
    task.completed_at = now
    session.add(step)
    session.add(task)
    session.commit()
    _record_event(
        session,
        task,
        step=step,
        event_type="step_failed",
        message=f"{step.title}失败：{exc}",
        payload={"error_code": step.error_code, "retryable": step.retryable},
    )


def _previous_step_output(session: Session, task_id: int, key: str) -> dict[str, Any]:
    step = session.exec(
        select(TaskStep).where(TaskStep.task_run_id == task_id, TaskStep.key == key)
    ).first()
    return _json_loads(step.output_json) if step else {}


def _build_client_ppt_slides(context: dict[str, Any], goal: str) -> list[dict[str, str]]:
    project = context.get("project") or {}
    meeting_card = context.get("meeting_card") or {}
    memory = context.get("memory") or {}
    client_memory = context.get("client_memory") or {}

    def bullets(items: list[str] | None, fallback: str) -> str:
        values = [str(item).strip() for item in (items or []) if str(item).strip()]
        if not values:
            values = [fallback]
        return "\n".join(f"- {item}" for item in values[:5])

    project_name = project.get("name") or "客户项目"
    client_name = project.get("client") or "客户"
    return [
        {"type": "section", "title": f"{client_name}｜客户介绍与沟通建议", "content": goal},
        {
            "type": "content",
            "title": "项目背景与当前目标",
            "content": bullets(
                [memory.get("project_brief", ""), memory.get("current_objective", ""), project.get("description", "")],
                f"围绕 {project_name} 梳理客户沟通材料。",
            ),
        },
        {
            "type": "two_column",
            "title": "这次应该主打什么",
            "left_content": bullets(meeting_card.get("say"), "突出项目价值、客户关注点和下一步推进路径。"),
            "right_content": bullets(meeting_card.get("confirm"), "确认客户目标、决策人、预算和近期行动。"),
        },
        {
            "type": "content",
            "title": "客户侧关注与敏感点",
            "content": bullets(
                (client_memory.get("sensitive_topics") or []) + (meeting_card.get("avoid") or []),
                "暂无明确敏感点，建议先以事实和假设边界沟通。",
            ),
        },
        {
            "type": "content",
            "title": "近期进展与可交付信号",
            "content": bullets(
                (memory.get("recent_progress") or []) + (memory.get("delivery_signals") or []),
                "暂无近期进展沉淀，建议先补充项目空间资料。",
            ),
        },
        {
            "type": "content",
            "title": "风险与应对",
            "content": bullets(memory.get("key_risks"), "暂无结构化风险，建议在会中确认不确定性和责任边界。"),
        },
        {
            "type": "content",
            "title": "下一步行动",
            "content": bullets(memory.get("next_actions"), "形成会后行动清单、责任人和时间节点。"),
        },
    ]


async def _execute_step(session: Session, task: TaskRun, step: TaskStep) -> dict[str, Any]:
    if task.task_type != "generate_client_ppt":
        raise ValueError(f"Unsupported task type: {task.task_type}")
    if task.project_id is None:
        raise ValueError("Project id is required")

    task_input = _json_loads(task.input_json)
    if step.key == "collect_context":
        briefing = _build_project_briefing(session, task.project_id)
        return {
            "project": briefing.get("project", {}),
            "memory": briefing.get("memory", {}),
            "client_memory": briefing.get("client_memory", {}),
            "meeting_card": briefing.get("meeting_card", {}),
            "stakeholders": briefing.get("stakeholders", []),
            "generated_at": briefing.get("generated_at"),
        }

    if step.key == "draft_slide_spec":
        context = _previous_step_output(session, task.id, "collect_context")
        slides = _build_client_ppt_slides(context, task.goal)
        return {"title": task_input.get("title") or context.get("project", {}).get("name") or task.goal, "slides": slides}

    if step.key == "create_deck":
        slide_spec = _previous_step_output(session, task.id, "draft_slide_spec")
        project = session.get(Project, task.project_id)
        title = str(task_input.get("title") or slide_spec.get("title") or task.goal)
        file_name = str(task_input.get("file_name") or f"{_slugify_filename(title)}.pptx")
        result = await write_project_office_document(
            project_id=task.project_id,
            file_type="pptx",
            file_name=file_name,
            title=title,
            slides=slide_spec.get("slides") or [],
            folder_id=task_input.get("folder_id"),
            summary=task_input.get("summary") or f"AI generated client introduction PPT for {project.client if project else 'client'}",
        )
        artifact = TaskArtifact(
            task_run_id=task.id,
            step_id=step.id,
            project_file_id=result.get("id"),
            name=result.get("name") or file_name,
            file_type=result.get("file_type") or "pptx",
            path=result.get("path") or "",
            metadata_json=_json_dumps(result),
        )
        session.add(artifact)
        session.commit()
        return result

    if step.key == "summarize_result":
        deck = _previous_step_output(session, task.id, "create_deck")
        return {
            "message": f"任务完成，已生成 {deck.get('name') or deck.get('file_name') or 'PPT'} 并保存到项目空间。",
            "artifact": deck,
        }

    raise ValueError(f"Unsupported step: {step.key}")


async def execute_task_run_in_session(session: Session, task_id: int) -> None:
    async for _ in stream_execute_task_run_in_session(session, task_id):
        pass


async def stream_execute_task_run_in_session(session: Session, task_id: int) -> AsyncIterator[dict[str, Any]]:
    task = session.get(TaskRun, task_id)
    if task is None or task.status in TASK_STATUS_TERMINAL:
        return
    _record_event(session, task, event_type="task_started", message="任务开始执行")
    yield {
        "event_type": "task_started",
        "message": task_step_log_message("task_started"),
        "task": serialize_task_run(session, task, include_events=True),
    }
    steps = session.exec(
        select(TaskStep).where(TaskStep.task_run_id == task.id).order_by(TaskStep.sort_order)
    ).all()
    for step in steps:
        if step.status == "completed":
            continue
        _start_step(session, task, step)
        yield {
            "event_type": "step_started",
            "step": _serialize_step(step),
            "message": task_step_log_message("step_started", _serialize_step(step)),
            "task": serialize_task_run(session, task, include_events=True),
        }
        try:
            output = await _execute_step(session, task, step)
        except Exception as exc:
            _fail_step(session, task, step, exc)
            yield {
                "event_type": "step_failed",
                "step": _serialize_step(step),
                "message": task_step_log_message("step_failed", _serialize_step(step)),
                "task": serialize_task_run(session, task, include_events=True),
            }
            return
        _complete_step(session, task, step, output)
        yield {
            "event_type": "step_completed",
            "step": _serialize_step(step),
            "message": task_step_log_message("step_completed", _serialize_step(step), output),
            "task": serialize_task_run(session, task, include_events=True),
        }

    now = utc_now_naive()
    final_output = _previous_step_output(session, task.id, "summarize_result")
    task.status = "completed"
    task.current_step_key = ""
    task.output_json = _json_dumps(final_output)
    task.error_code = ""
    task.error_message = ""
    task.updated_at = now
    task.completed_at = now
    session.add(task)
    session.commit()
    _record_event(session, task, event_type="task_completed", message="任务已完成", payload=final_output)
    yield {
        "event_type": "task_completed",
        "message": task_step_log_message("task_completed"),
        "task": serialize_task_run(session, task, include_events=True),
    }


async def execute_task_run(task_id: int) -> None:
    with Session(engine) as session:
        await execute_task_run_in_session(session, task_id)


async def retry_task_run(task_id: int) -> None:
    with Session(engine) as session:
        task = session.get(TaskRun, task_id)
        if task is None:
            return
        failed_step = session.exec(
            select(TaskStep)
            .where(TaskStep.task_run_id == task.id, TaskStep.status == "failed")
            .order_by(TaskStep.sort_order)
        ).first()
        if failed_step is None:
            return
        now = utc_now_naive()
        task.status = "pending"
        task.error_code = ""
        task.error_message = ""
        task.retry_count += 1
        task.updated_at = now
        failed_step.status = "pending"
        failed_step.error_code = ""
        failed_step.error_message = ""
        failed_step.retry_count += 1
        failed_step.updated_at = now
        failed_step.started_at = None
        failed_step.completed_at = None
        session.add(task)
        session.add(failed_step)
        session.commit()
        _record_event(session, task, step=failed_step, event_type="task_retry", message="任务从失败步骤重试")
    await execute_task_run(task_id)
