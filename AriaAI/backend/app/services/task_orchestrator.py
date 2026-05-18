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
TASK_STATUS_PAUSED = "paused"
SUPPORTED_TASK_TYPES = {
    "generate_client_ppt",
    "generate_project_excel",
    "generate_project_docx",
    "generate_project_pdf",
}
_PPT_INTENT_TERMS = ("ppt", "pptx", "powerpoint", "deck", "slides", "幻灯片", "演示文稿", "演示材料", "客户介绍")
_EXCEL_INTENT_TERMS = ("excel", "xlsx", "xls", "spreadsheet", "表格", "工作簿", "访谈表", "清单", "台账")
_DOCX_INTENT_TERMS = ("word", "docx", "文档", "报告", "方案", "材料")
_PDF_INTENT_TERMS = ("pdf",)
_CREATE_INTENT_TERMS = (
    "准备", "生成", "创建", "制作", "输出", "导出", "整理成", "形成", "写一份", "做一份",
    "proposal", "prepare", "create", "generate", "make", "export", "draft",
)


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

GENERATE_PROJECT_DOCUMENT_STEPS = [
    StepSpec("collect_context", "收集项目上下文", "collect_project_context"),
    StepSpec("draft_document_spec", "生成交付物结构", "build_document_spec"),
    StepSpec("create_document", "生成并保存文件", "write_project_office_document"),
    StepSpec("summarize_result", "整理交付结果", "summarize_result", retryable=False),
]


def detect_project_task_type(content: str) -> str | None:
    """Detect requests that should run as durable project tasks instead of a single chat turn."""
    normalized = (content or "").strip().lower()
    if not normalized:
        return None
    wants_ppt = any(term in normalized for term in _PPT_INTENT_TERMS)
    wants_excel = any(term in normalized for term in _EXCEL_INTENT_TERMS)
    wants_pdf = any(term in normalized for term in _PDF_INTENT_TERMS)
    wants_docx = any(term in normalized for term in _DOCX_INTENT_TERMS)
    wants_create = any(term in normalized for term in _CREATE_INTENT_TERMS)
    if wants_ppt and wants_create:
        return "generate_client_ppt"
    if wants_excel and wants_create:
        return "generate_project_excel"
    if wants_pdf and wants_create:
        return "generate_project_pdf"
    if wants_docx and wants_create:
        return "generate_project_docx"
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


def _format_log_time(value: str | None) -> str:
    if not value:
        return "--:--:--"
    try:
        return datetime.fromisoformat(value).strftime("%H:%M:%S")
    except ValueError:
        return str(value)[11:19] if len(str(value)) >= 19 else str(value)


def _summarize_event_payload(payload: dict[str, Any]) -> str:
    if not payload:
        return ""
    if payload.get("task_type"):
        return f"任务类型：{payload.get('task_type')}"
    if payload.get("error_code") or payload.get("retryable") is not None:
        retry_text = "可重试" if payload.get("retryable") else "不可重试"
        return f"{payload.get('error_code') or '错误'}，{retry_text}"
    if payload.get("project"):
        project = payload.get("project") or {}
        return f"项目：{project.get('name') or '-'}；客户：{project.get('client') or '-'}"
    if payload.get("slides") is not None:
        return f"结构页数：{len(payload.get('slides') or [])}"
    if payload.get("sheets") is not None:
        sheet_names = [str(sheet.get("name") or "") for sheet in payload.get("sheets") or [] if isinstance(sheet, dict)]
        return "工作表：" + "、".join(sheet_names[:6])
    if payload.get("sections") is not None:
        return f"章节数：{len(payload.get('sections') or [])}"
    if payload.get("name") or payload.get("file_name"):
        return f"文件：{payload.get('name') or payload.get('file_name')}"
    if payload.get("message"):
        return str(payload.get("message"))
    return ""


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
    steps = payload.get("steps") or []
    events = payload.get("events") or []
    events_by_step_id: dict[int, list[dict[str, Any]]] = {}
    task_level_events: list[dict[str, Any]] = []
    for event in events:
        step_id = event.get("step_id")
        if step_id is None:
            task_level_events.append(event)
            continue
        try:
            normalized_step_id = int(step_id)
        except (TypeError, ValueError):
            task_level_events.append(event)
            continue
        events_by_step_id.setdefault(normalized_step_id, []).append(event)

    for index, step in enumerate(steps, start=1):
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
            elif step.get("key") == "draft_document_spec":
                line += f"。已生成 {str(output.get('file_type') or '').upper()} 交付物结构。"
            elif step.get("key") == "create_document":
                line += f"。已保存文件「{output.get('name') or output.get('file_name') or '-'}」。"
        lines.append(line)

    if events:
        lines.extend(["", "详细执行日志："])
        for event in task_level_events:
            message = event.get("message") or event.get("event_type") or "任务事件"
            detail = _summarize_event_payload(event.get("payload") or {})
            suffix = f"（{detail}）" if detail else ""
            lines.append(f"- [{_format_log_time(event.get('created_at'))}] {message}{suffix}")
        for index, step in enumerate(steps, start=1):
            step_events = events_by_step_id.get(step.get("id"), [])
            if not step_events:
                continue
            lines.append(f"- 第 {index} 步「{step.get('title') or step.get('key')}」")
            for event in step_events:
                message = event.get("message") or event.get("event_type") or "步骤事件"
                detail = _summarize_event_payload(event.get("payload") or {})
                suffix = f"（{detail}）" if detail else ""
                lines.append(f"  - [{_format_log_time(event.get('created_at'))}] {message}{suffix}")

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
    if event_type == "task_canceled":
        return "任务已取消：已完成步骤会保留，未执行步骤不再继续。"
    if event_type == "task_paused":
        return "任务已暂停：当前已完成步骤会保留，恢复后继续后续步骤。"
    if event_type == "task_resumed":
        return "任务已恢复：将从下一个未完成步骤继续执行。"
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
        if step.get("key") == "draft_document_spec":
            return f"{prefix}，完成。已形成 {str((output or {}).get('file_type') or '').upper()} 文件结构。"
        if step.get("key") == "create_document":
            return f"{prefix}，完成。文件「{(output or {}).get('name') or (output or {}).get('file_name') or '-'}」已保存到项目空间。"
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

    steps = GENERATE_CLIENT_PPT_STEPS if task_type == "generate_client_ppt" else GENERATE_PROJECT_DOCUMENT_STEPS
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


def _skip_step(session: Session, task: TaskRun, step: TaskStep, *, reason: str = "任务已取消") -> None:
    now = utc_now_naive()
    step.status = "skipped"
    step.error_code = "canceled"
    step.error_message = reason
    step.updated_at = now
    step.completed_at = now
    session.add(step)
    session.commit()
    _record_event(session, task, step=step, event_type="step_skipped", message=f"{step.title}跳过", payload={"message": reason})


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


def _document_file_type_for_task(task_type: str) -> str:
    return {
        "generate_project_excel": "xlsx",
        "generate_project_docx": "docx",
        "generate_project_pdf": "pdf",
    }.get(task_type, "docx")


def _default_xlsx_sheets(goal: str, context: dict[str, Any]) -> list[dict[str, Any]]:
    text = (goal or "").lower()
    project = context.get("project") or {}
    memory = context.get("memory") or {}
    client_memory = context.get("client_memory") or {}
    meeting_card = context.get("meeting_card") or {}
    stakeholders = context.get("stakeholders") or []

    def list_items(values: list[Any] | None, fallback: list[str]) -> list[str]:
        items = [str(item).strip() for item in (values or []) if str(item).strip()]
        return items or fallback

    if any(token in text for token in ("访谈", "interview")):
        stakeholder_rows = []
        for item in stakeholders[:8]:
            if isinstance(item, dict):
                stakeholder_rows.append(
                    [
                        item.get("name") or item.get("title") or "",
                        item.get("role") or item.get("department") or "",
                        item.get("influence_level") or item.get("attitude") or "",
                        item.get("note") or item.get("description") or "",
                    ]
                )
        if not stakeholder_rows:
            stakeholder_rows = [
                ["项目负责人/业务方", "项目目标与决策输入", "高", "确认目标、边界、约束和成功标准"],
                ["客户品牌/渠道相关方", "落地可行性与资源", "中高", "确认品牌、渠道、数据和协作限制"],
                ["项目执行团队", "交付路径与风险", "中", "确认资料、时间表和行动闭环"],
            ]

        interview_topics = [
            ("项目背景与目标", memory.get("project_brief") or project.get("description") or goal),
            ("当前目标", memory.get("current_objective") or "确认本次项目的核心目标、范围与成功标准。"),
            ("近期进展", "；".join(list_items(memory.get("recent_progress"), ["补充近期推进情况"]))),
            ("关键风险", "；".join(list_items(memory.get("key_risks"), ["识别决策、资源、范围、时间表等风险"]))),
            ("开放问题", "；".join(list_items(memory.get("open_questions"), ["确认仍未闭合的问题和资料缺口"]))),
            ("下一步动作", "；".join(list_items(memory.get("next_actions"), ["形成会后行动清单、负责人和时间点"]))),
            ("客户敏感点", "；".join(list_items(client_memory.get("sensitive_topics"), ["确认客户侧敏感话题和沟通边界"]))),
            ("会议建议", "；".join(list_items(meeting_card.get("confirm"), ["确认决策链、预算、资料、时间表和下一次会议安排"]))),
        ]
        question_rows = [
            ["业务负责人/客户相关方", "", topic, f"围绕“{basis}”，请确认当前事实、判断依据、主要分歧和下一步动作。", "", "", "待安排", ""]
            for topic, basis in interview_topics
        ]
        question_rows.extend(
            [
                ["决策人", "", "决策标准", "最终判断本项目是否推进时，最重要的 3 个标准是什么？", "", "", "待安排", ""],
                ["执行负责人", "", "资源与时间", "若进入下一阶段，需要哪些资源、资料和时间窗口？", "", "", "待安排", ""],
                ["风险相关方", "", "风险边界", "哪些前提不成立会导致项目暂停、延期或调整范围？", "", "", "待安排", ""],
            ]
        )
        return [
            {
                "name": "访谈计划",
                "headers": ["访谈对象", "角色/部门", "访谈主题", "核心问题", "时间", "负责人", "状态", "备注"],
                "data": question_rows,
            },
            {
                "name": "关键干系人",
                "headers": ["姓名/群体", "角色/部门", "影响/态度", "访谈重点"],
                "data": stakeholder_rows,
            },
            {
                "name": "项目上下文",
                "headers": ["维度", "内容"],
                "data": [
                    ["项目名称", project.get("name") or ""],
                    ["客户", project.get("client") or ""],
                    ["项目背景", memory.get("project_brief") or project.get("description") or ""],
                    ["当前目标", memory.get("current_objective") or ""],
                    ["关键风险", "；".join(list_items(memory.get("key_risks"), []))],
                    ["开放问题", "；".join(list_items(memory.get("open_questions"), []))],
                    ["下一步动作", "；".join(list_items(memory.get("next_actions"), []))],
                ],
            },
            {
                "name": "访谈记录",
                "headers": ["日期", "访谈对象", "关键观点", "风险/分歧", "待补充资料", "下一步动作", "负责人"],
                "data": [],
            },
        ]
    memory = context.get("memory") or {}
    return [
        {
            "name": "项目清单",
            "headers": ["事项", "说明", "负责人", "状态", "备注"],
            "data": [
                ["当前目标", memory.get("current_objective") or "待补充", "", "待确认", ""],
                ["下一步动作", "；".join((memory.get("next_actions") or [])[:3]) or "待补充", "", "待推进", ""],
            ],
        }
    ]


def _default_document_sections(goal: str, context: dict[str, Any]) -> list[dict[str, Any]]:
    project = context.get("project") or {}
    memory = context.get("memory") or {}
    client_memory = context.get("client_memory") or {}

    def join_items(items: list[str] | None, fallback: str) -> str:
        values = [str(item).strip() for item in (items or []) if str(item).strip()]
        return "\n".join(f"- {item}" for item in values[:6]) if values else fallback

    return [
        {
            "heading": "项目背景",
            "level": 1,
            "content": memory.get("project_brief") or project.get("description") or goal,
        },
        {
            "heading": "当前目标",
            "level": 1,
            "content": memory.get("current_objective") or "围绕本次请求形成可交付材料，并保存到项目空间。",
        },
        {
            "heading": "客户关注与风险",
            "level": 1,
            "content": "\n".join(
                [
                    join_items(client_memory.get("sensitive_topics"), "暂无明确客户敏感点。"),
                    join_items(memory.get("key_risks"), "暂无结构化风险。"),
                ]
            ),
        },
        {
            "heading": "建议下一步",
            "level": 1,
            "content": join_items(memory.get("next_actions"), "确认责任人、时间节点和后续资料补充。"),
        },
    ]


def _build_project_document_spec(context: dict[str, Any], goal: str, file_type: str, title: str) -> dict[str, Any]:
    if file_type == "xlsx":
        return {"title": title, "file_type": file_type, "sheets": _default_xlsx_sheets(goal, context)}
    sections = _default_document_sections(goal, context)
    content = "\n\n".join(f"# {item['heading']}\n{item['content']}" for item in sections)
    return {
        "title": title,
        "file_type": file_type,
        "sections": sections,
        "content": content,
    }


async def _execute_step(session: Session, task: TaskRun, step: TaskStep) -> dict[str, Any]:
    if task.task_type not in SUPPORTED_TASK_TYPES:
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

    if step.key == "draft_document_spec":
        context = _previous_step_output(session, task.id, "collect_context")
        title = str(task_input.get("title") or task.goal or context.get("project", {}).get("name") or "项目交付物")
        file_type = str(task_input.get("file_type") or _document_file_type_for_task(task.task_type))
        return _build_project_document_spec(context, task.goal, file_type, title)

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

    if step.key == "create_document":
        document_spec = _previous_step_output(session, task.id, "draft_document_spec")
        project = session.get(Project, task.project_id)
        file_type = str(document_spec.get("file_type") or task_input.get("file_type") or _document_file_type_for_task(task.task_type))
        title = str(task_input.get("title") or document_spec.get("title") or task.goal)
        file_name = str(task_input.get("file_name") or f"{_slugify_filename(title)}.{file_type}")
        result = await write_project_office_document(
            project_id=task.project_id,
            file_type=file_type,
            file_name=file_name,
            title=title,
            content=str(document_spec.get("content") or ""),
            sections=document_spec.get("sections"),
            sheets=document_spec.get("sheets"),
            slides=document_spec.get("slides"),
            folder_id=task_input.get("folder_id"),
            summary=task_input.get("summary") or f"AI generated {file_type.upper()} document for {project.client if project else 'project'}",
        )
        artifact = TaskArtifact(
            task_run_id=task.id,
            step_id=step.id,
            project_file_id=result.get("id"),
            name=result.get("name") or file_name,
            file_type=result.get("file_type") or file_type,
            path=result.get("path") or "",
            metadata_json=_json_dumps(result),
        )
        session.add(artifact)
        session.commit()
        return result

    if step.key == "summarize_result":
        deck = _previous_step_output(session, task.id, "create_deck") or _previous_step_output(session, task.id, "create_document")
        return {
            "message": f"任务完成，已生成 {deck.get('name') or deck.get('file_name') or '文件'} 并保存到项目空间。",
            "artifact": deck,
        }

    raise ValueError(f"Unsupported step: {step.key}")


async def execute_task_run_in_session(session: Session, task_id: int) -> None:
    async for _ in stream_execute_task_run_in_session(session, task_id):
        pass


async def stream_execute_task_run_in_session(session: Session, task_id: int) -> AsyncIterator[dict[str, Any]]:
    task = session.get(TaskRun, task_id)
    if task is None or task.status in TASK_STATUS_TERMINAL or task.status == TASK_STATUS_PAUSED:
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
        session.refresh(task)
        if task.status == "canceled":
            yield {
                "event_type": "task_canceled",
                "message": task_step_log_message("task_canceled"),
                "task": serialize_task_run(session, task, include_events=True),
            }
            return
        if task.status == TASK_STATUS_PAUSED:
            yield {
                "event_type": "task_paused",
                "message": task_step_log_message("task_paused"),
                "task": serialize_task_run(session, task, include_events=True),
            }
            return
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
        session.refresh(task)
        if task.status == "canceled":
            _skip_step(session, task, step, reason=task.error_message or "用户取消任务")
            yield {
                "event_type": "task_canceled",
                "step": _serialize_step(step),
                "message": task_step_log_message("task_canceled"),
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


def cancel_task_run_in_session(session: Session, task_id: int, *, reason: str = "用户取消任务") -> dict[str, Any] | None:
    task = session.get(TaskRun, task_id)
    if task is None:
        return None
    if task.status in {"completed", "canceled"}:
        return serialize_task_run(session, task, include_events=True)

    now = utc_now_naive()
    task.status = "canceled"
    task.current_step_key = ""
    task.error_code = "canceled"
    task.error_message = reason
    task.updated_at = now
    task.completed_at = now
    pending_steps = session.exec(
        select(TaskStep)
        .where(TaskStep.task_run_id == task.id, TaskStep.status == "pending")
        .order_by(TaskStep.sort_order)
    ).all()
    for step in pending_steps:
        step.status = "skipped"
        step.error_code = "canceled"
        step.error_message = reason
        step.updated_at = now
        step.completed_at = now
        session.add(step)
    session.add(task)
    session.commit()
    _record_event(session, task, event_type="task_canceled", message=reason)
    return serialize_task_run(session, task, include_events=True)


def pause_task_run_in_session(session: Session, task_id: int, *, reason: str = "用户暂停任务") -> dict[str, Any] | None:
    task = session.get(TaskRun, task_id)
    if task is None:
        return None
    if task.status in TASK_STATUS_TERMINAL:
        return serialize_task_run(session, task, include_events=True)
    now = utc_now_naive()
    task.status = TASK_STATUS_PAUSED
    task.updated_at = now
    session.add(task)
    session.commit()
    _record_event(session, task, event_type="task_paused", message=reason)
    return serialize_task_run(session, task, include_events=True)


def resume_task_run_in_session(session: Session, task_id: int, *, reason: str = "任务恢复执行") -> dict[str, Any] | None:
    task = session.get(TaskRun, task_id)
    if task is None:
        return None
    if task.status != TASK_STATUS_PAUSED:
        return serialize_task_run(session, task, include_events=True)
    now = utc_now_naive()
    task.status = "pending"
    task.error_code = ""
    task.error_message = ""
    task.updated_at = now
    session.add(task)
    session.commit()
    _record_event(session, task, event_type="task_resumed", message=reason)
    return serialize_task_run(session, task, include_events=True)


async def resume_task_run(task_id: int) -> None:
    with Session(engine) as session:
        payload = resume_task_run_in_session(session, task_id)
        if payload is None or payload.get("status") != "pending":
            return
    await execute_task_run(task_id)
