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
from typing import Any, Awaitable, Callable

from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import engine
from app.models.db import Project, TaskArtifact, TaskEvent, TaskRun, TaskStep
from app.routers.projects_deps import _build_project_briefing
from app.services.project_core import init_default_project_folders
from app.services.project_documents import create_project_document_record
from app.services.time_utils import utc_now_naive
from app.tools.office_documents import write_project_office_document

TASK_STATUS_TERMINAL = {"completed", "failed", "canceled"}
TASK_STATUS_PAUSED = "paused"
SUPPORTED_TASK_TYPES = {
    "generate_client_ppt",
    "generate_project_excel",
    "generate_project_docx",
    "generate_project_pdf",
    "create_text_artifact",
}
_PPT_INTENT_TERMS = ("ppt", "pptx", "powerpoint", "deck", "slides", "幻灯片", "演示文稿", "演示材料", "客户介绍")
_EXCEL_INTENT_TERMS = ("excel", "xlsx", "xls", "spreadsheet", "表格", "工作簿", "访谈表", "台账")
_DOCX_INTENT_TERMS = ("word", "docx", "文档", "报告", "方案", "材料")
_PDF_INTENT_TERMS = ("pdf",)
_CREATE_INTENT_TERMS = (
    "准备", "生成", "创建", "制作", "输出", "导出", "整理", "整理成", "形成", "写一份", "做一份",
    "proposal", "prepare", "create", "generate", "make", "export", "draft",
)


@dataclass(frozen=True)
class StepSpec:
    key: str
    title: str
    step_type: str
    retryable: bool = True


@dataclass(frozen=True)
class TaskRoute:
    task_type: str | None
    confidence: float = 0.0
    reason: str = ""
    title: str = ""
    output_kind: str = ""
    plan_steps: tuple[StepSpec, ...] = ()


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

CREATE_TEXT_ARTIFACT_STEPS = [
    StepSpec("collect_context", "收集项目上下文", "collect_project_context"),
    StepSpec("draft_text_artifact", "生成文本交付内容", "draft_text_artifact"),
    StepSpec("summarize_result", "整理交付结果", "summarize_result", retryable=False),
]

ALLOWED_STEP_TYPES = {
    "collect_project_context",
    "build_slide_spec",
    "build_document_spec",
    "write_project_office_document",
    "draft_text_artifact",
    "summarize_result",
}

STEP_TYPE_ALIASES = {
    "collect_context": "collect_project_context",
    "load_context": "collect_project_context",
    "build_document": "build_document_spec",
    "build_qa_spec": "build_document_spec",
    "draft_document": "build_document_spec",
    "draft_text": "draft_text_artifact",
    "finalize": "summarize_result",
    "summary": "summarize_result",
    "write_document": "write_project_office_document",
    "create_file": "write_project_office_document",
    "generate_file": "write_project_office_document",
    "create_document": "write_project_office_document",
    "create_deck": "write_project_office_document",
}


def _normalize_step_type(raw_step_type: str, task_type: str) -> str:
    step_type = str(raw_step_type or "").strip()
    if step_type in {"build_spec", "draft_spec"}:
        return "build_slide_spec" if task_type == "generate_client_ppt" else "build_document_spec"
    return STEP_TYPE_ALIASES.get(step_type, step_type)


def detect_project_task_type(content: str) -> str | None:
    """Detect requests that should run as durable project tasks instead of a single chat turn."""
    return _rule_based_task_route(content).task_type


def _rule_based_task_route(content: str) -> TaskRoute:
    normalized = (content or "").strip().lower()
    if not normalized:
        return TaskRoute(None, reason="empty")
    wants_ppt = any(term in normalized for term in _PPT_INTENT_TERMS)
    wants_excel = any(term in normalized for term in _EXCEL_INTENT_TERMS)
    wants_pdf = any(term in normalized for term in _PDF_INTENT_TERMS)
    wants_docx = any(term in normalized for term in _DOCX_INTENT_TERMS)
    wants_create = any(term in normalized for term in _CREATE_INTENT_TERMS)
    if wants_ppt and wants_create:
        return TaskRoute("generate_client_ppt", confidence=0.86, reason="rule:ppt", output_kind="pptx")
    if wants_excel and wants_create:
        return TaskRoute("generate_project_excel", confidence=0.86, reason="rule:excel", output_kind="xlsx")
    if wants_pdf and wants_create:
        return TaskRoute("generate_project_pdf", confidence=0.86, reason="rule:pdf", output_kind="pdf")
    if wants_docx and wants_create:
        return TaskRoute("generate_project_docx", confidence=0.82, reason="rule:docx", output_kind="docx")
    text_deliverable_terms = ("整理", "梳理", "总结", "形成", "准备", "起草", "写", "输出", "清单", "要点", "分析", "计划", "建议", "复盘")
    question_prefixes = ("为什么", "怎么", "如何", "是否", "是不是", "解释", "介绍一下", "这个", "你觉得")
    wants_text_artifact = wants_create and any(term in normalized for term in text_deliverable_terms)
    if wants_text_artifact and not normalized.startswith(question_prefixes):
        return TaskRoute("create_text_artifact", confidence=0.68, reason="rule:text_artifact", output_kind="md")
    return TaskRoute(None, reason="rule:no_task")


def _extract_json_object(text: str) -> dict[str, Any] | None:
    decoder = json.JSONDecoder()
    idx = text.find("{")
    while idx != -1:
        try:
            value, _ = decoder.raw_decode(text[idx:])
        except json.JSONDecodeError:
            idx = text.find("{", idx + 1)
            continue
        if isinstance(value, dict):
            return value
        idx = text.find("{", idx + 1)
    return None


def _normalize_planned_steps(raw_steps: Any, task_type: str) -> tuple[StepSpec, ...]:
    if not isinstance(raw_steps, list):
        return ()
    steps: list[StepSpec] = []
    seen_keys: set[str] = set()
    for index, item in enumerate(raw_steps[:8], start=1):
        if not isinstance(item, dict):
            continue
        step_type = _normalize_step_type(str(item.get("step_type") or ""), task_type)
        if step_type not in ALLOWED_STEP_TYPES:
            continue
        key = _slugify_filename(str(item.get("key") or step_type or f"step-{index}")).replace(".", "-")[:40]
        if not key or key in seen_keys:
            key = f"{step_type}-{index}"
        seen_keys.add(key)
        title = str(item.get("title") or step_type).strip()[:80]
        retryable = bool(item.get("retryable", step_type != "summarize_result"))
        steps.append(StepSpec(key=key, title=title, step_type=step_type, retryable=retryable))
    required_first = steps and steps[0].step_type == "collect_project_context"
    has_finish = any(step.step_type == "summarize_result" for step in steps)
    if len(steps) < 2 or not required_first or not has_finish:
        return ()
    if task_type.startswith("generate_") and not any(step.step_type == "write_project_office_document" for step in steps):
        return ()
    if task_type == "create_text_artifact" and not any(step.step_type == "draft_text_artifact" for step in steps):
        return ()
    return tuple(steps)


async def route_project_task_request(
    content: str,
    *,
    llm_complete: Callable[..., Awaitable[str]] | None = None,
    model: str = "",
) -> TaskRoute:
    fallback = _rule_based_task_route(content)
    if llm_complete is None:
        return fallback
    system = (
        "You are an intent router for a project assistant. Return only JSON. "
        "Decide whether a user message needs a durable task. Ordinary questions should use task_type null. "
        "Allowed task_type values: generate_client_ppt, generate_project_excel, generate_project_docx, "
        "generate_project_pdf, create_text_artifact. Use create_text_artifact for structured Markdown "
        "deliverables that should be saved to project space rather than as an Office file. "
        "Include plan_steps when a task is needed. Allowed step_type values: collect_project_context, "
        "build_slide_spec, build_document_spec, write_project_office_document, draft_text_artifact, summarize_result."
    )
    prompt = {
        "user_message": content,
        "response_schema": {
            "task_type": "string|null",
            "confidence": "number 0-1",
            "reason": "short string",
            "title": "short title",
            "output_kind": "pptx|xlsx|docx|pdf|md|null",
            "plan_steps": [{"key": "string", "title": "string", "step_type": "string", "retryable": True}],
        },
    }
    try:
        raw = await llm_complete(
            [{"role": "user", "content": json.dumps(prompt, ensure_ascii=False)}],
            system=system,
            model=model,
            max_tokens=900,
            temperature=0,
        )
        data = _extract_json_object(raw or "") or {}
    except Exception:
        return fallback
    task_type = data.get("task_type")
    if task_type not in SUPPORTED_TASK_TYPES:
        if fallback.task_type and fallback.confidence >= 0.8:
            return fallback
        return TaskRoute(None, confidence=float(data.get("confidence") or 0), reason=str(data.get("reason") or "llm:no_task"))
    confidence = float(data.get("confidence") or 0)
    if confidence < 0.55:
        return fallback if fallback.task_type else TaskRoute(None, confidence=confidence, reason=str(data.get("reason") or "low_confidence"))
    plan_steps = _normalize_planned_steps(data.get("plan_steps"), task_type)
    return TaskRoute(
        task_type=task_type,
        confidence=confidence,
        reason=str(data.get("reason") or "llm"),
        title=str(data.get("title") or "").strip(),
        output_kind=str(data.get("output_kind") or "").strip(),
        plan_steps=plan_steps,
    )


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


def _clean_ppt_request_title(value: str) -> str:
    text = re.sub(r"\s+", " ", (value or "").strip())
    if not text:
        return ""
    text = re.sub(
        r"(页数要求|至少|不少于|不低于|超过|大于|more\s+than|at\s+least)\s*\d{1,2}\s*(?:页|頁|p|page|pages|slide|slides)?\s*(?:以上|起|\+|plus|or\s+more)?",
        "",
        text,
        flags=re.IGNORECASE,
    )
    cleanup_patterns = [
        r"^(好的?|请|麻烦|帮我|帮忙|给我|我想要|我要|需要|可以)?\s*",
        r"(内容不够丰富|对这个\s*ppt\s*进行|对这个\s*PPT\s*进行|这个\s*ppt|这个\s*PPT)",
        r"(重新生成|全面丰富|生成|准备|制作|输出|创建|整理|完善|丰富|修正|优化)",
        r"(一个|一份|一下|版本|版)",
        r"(好的?|请|麻烦|帮我|帮忙|给我|我想要|我要|需要|可以)",
        r"(给客户介绍|给客户|客户介绍)",
        r"(pptx|powerpoint|ppt|PPT)",
        r"的",
        r"(。|，|,|；|;|：|:)",
    ]
    for pattern in cleanup_patterns:
        text = re.sub(pattern, " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", "", text).strip("-_｜|/ ")
    generic_values = {"", "客户", "介绍", "方案", "沟通", "初步沟通", "客户沟通", "访谈", "材料"}
    if text in generic_values or len(text) < 3:
        return ""
    return text[:40]


def _client_ppt_delivery_title(context: dict[str, Any] | None, goal: str, explicit_title: str | None = None) -> str:
    context = context or {}
    project = context.get("project") or {}
    project_name = str(project.get("name") or "").strip()
    client_name = str(project.get("client") or "").strip()

    def dedupe_project_name(title: str) -> str:
        if not project_name or project_name not in title:
            return title
        first_index = title.find(project_name)
        head = title[: first_index + len(project_name)]
        tail = title[first_index + len(project_name) :].replace(project_name, "")
        return f"{head}{tail}".strip("-_｜|/ ")

    for candidate in (explicit_title, goal):
        cleaned = _clean_ppt_request_title(str(candidate or ""))
        if cleaned:
            cleaned = dedupe_project_name(cleaned)
            if cleaned in {project_name, client_name}:
                return f"{project_name or client_name}客户沟通建议"
            if project_name and project_name not in cleaned and len(cleaned) <= 18:
                cleaned = f"{project_name}-{cleaned}"
            if any(token in cleaned for token in ("沟通", "访谈", "介绍", "方案", "建议", "策略")):
                return cleaned
            return f"{cleaned}客户沟通建议"

    base = project_name or client_name or "客户项目"
    if len(base) > 34:
        base = base[:34]
    return f"{base}客户沟通建议"


def _client_ppt_file_name(title: str) -> str:
    stem = _slugify_filename(title)[:80].strip("-_.")
    if not stem:
        stem = "client-introduction"
    return f"{stem}.pptx"


def _extract_requested_slide_count(text: str) -> int | None:
    """Extract a user-requested minimum slide/page count from a PPT request."""
    value = text or ""
    patterns = (
        r"(\d{1,2})\s*(?:页|頁|p|page|pages|slide|slides)\s*(?:以上|起|至少|\+|plus|or\s+more)?",
        r"(?:至少|不少于|不低于|超过|大于|more\s+than|at\s+least)\s*(\d{1,2})\s*(?:页|頁|p|page|pages|slide|slides)?",
    )
    matches: list[int] = []
    for pattern in patterns:
        for match in re.finditer(pattern, value, flags=re.IGNORECASE):
            try:
                matches.append(int(match.group(1)))
            except (TypeError, ValueError):
                continue
    if not matches:
        return None
    # Keep generated decks usable while honoring explicit user asks.
    return max(4, min(max(matches), 40))


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
            if artifact.get("file_type") == "text":
                lines.append(f"- {artifact.get('name')}（文本）已生成，可在任务详情中查看")
            else:
                lines.append(f"- {artifact.get('name')}（{str(artifact.get('file_type') or '').upper()}）已保存到项目空间")
    elif payload.get("status") == "failed":
        lines.extend(["", "你可以稍后从失败步骤重试，前面已完成的步骤不会丢失。"])
    return "\n".join(lines)


def task_run_chat_brief(payload: dict[str, Any]) -> str:
    goal = payload.get("goal") or payload.get("task_type") or "任务"
    status = str(payload.get("status") or "")
    steps = [step for step in (payload.get("steps") or []) if isinstance(step, dict)]
    failed_step = next((step for step in steps if step.get("status") == "failed"), None)
    artifacts = [artifact for artifact in (payload.get("artifacts") or []) if isinstance(artifact, dict)]

    if status == "completed":
        if artifacts:
            names = "、".join(str(artifact.get("name") or "交付物") for artifact in artifacts[:3])
            return f"任务已完成：{goal}\n\n生成物：{names}\n\n下方卡片可以直接打开，完整执行记录在右上角「任务」面板。"
        return f"任务已完成：{goal}\n\n执行步骤和结果已记录在下方卡片与右上角「任务」面板。"

    if failed_step:
        step_index = failed_step.get("sort_order") or "-"
        title = failed_step.get("title") or failed_step.get("key") or "执行步骤"
        error = str(failed_step.get("error_message") or "").strip()
        error_line = f"\n\n失败原因：{error}" if error else ""
        return (
            f"任务在第 {step_index} 步「{title}」暂停，需要处理。"
            f"{error_line}\n\n请点击失败步骤卡片里的「打开任务面板处理」，可从失败处重试、取消任务或查看完整日志。"
        )

    return f"任务已创建：{goal}\n\n我会按下方步骤执行，完整记录可在右上角「任务」面板查看。"


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
    plan_steps: list[StepSpec] | tuple[StepSpec, ...] | None = None,
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

    steps = list(plan_steps or [])
    if not steps:
        if task_type == "generate_client_ppt":
            steps = GENERATE_CLIENT_PPT_STEPS
        elif task_type == "create_text_artifact":
            steps = CREATE_TEXT_ARTIFACT_STEPS
        else:
            steps = GENERATE_PROJECT_DOCUMENT_STEPS
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
    _record_event(
        session,
        task,
        event_type="task_created",
        message="任务已创建",
        payload={"task_type": task_type, "planned_steps": [{"key": step.key, "step_type": step.step_type} for step in steps]},
    )
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


def _previous_step_output_by_type(session: Session, task_id: int, step_type: str) -> dict[str, Any]:
    step = session.exec(
        select(TaskStep)
        .where(TaskStep.task_run_id == task_id, TaskStep.step_type == step_type, TaskStep.status == "completed")
        .order_by(TaskStep.sort_order.desc())
    ).first()
    return _json_loads(step.output_json) if step else {}


def _previous_context_output(session: Session, task_id: int) -> dict[str, Any]:
    return _previous_step_output(session, task_id, "collect_context") or _previous_step_output_by_type(
        session, task_id, "collect_project_context"
    )


def _previous_document_spec_output(session: Session, task_id: int) -> dict[str, Any]:
    return _previous_step_output(session, task_id, "draft_document_spec") or _previous_step_output_by_type(
        session, task_id, "build_document_spec"
    )


def _previous_slide_spec_output(session: Session, task_id: int) -> dict[str, Any]:
    return _previous_step_output(session, task_id, "draft_slide_spec") or _previous_step_output_by_type(
        session, task_id, "build_slide_spec"
    )


def _previous_office_output(session: Session, task_id: int) -> dict[str, Any]:
    return (
        _previous_step_output(session, task_id, "create_deck")
        or _previous_step_output(session, task_id, "create_document")
        or _previous_step_output_by_type(session, task_id, "write_project_office_document")
    )


def _build_client_ppt_slides(
    context: dict[str, Any],
    goal: str,
    target_slide_count: int | None = None,
    deck_title: str | None = None,
) -> list[dict[str, str]]:
    project = context.get("project") or {}
    meeting_card = context.get("meeting_card") or {}
    memory = context.get("memory") or {}
    client_memory = context.get("client_memory") or {}

    def bullets(items: list[str] | None, fallback: str) -> str:
        values = [str(item).strip() for item in (items or []) if str(item).strip()]
        if not values:
            values = [fallback]
        return "\n".join(f"- {item}" for item in values[:5])

    def combined_bullets(*groups: list[str] | None, fallback: str) -> str:
        values: list[str] = []
        for group in groups:
            values.extend(str(item).strip() for item in (group or []) if str(item).strip())
        return bullets(values, fallback)

    project_name = project.get("name") or "客户项目"
    client_name = project.get("client") or "客户"
    deck_title = deck_title or _client_ppt_delivery_title(context, goal)
    target_slide_count = target_slide_count or _extract_requested_slide_count(goal)
    base_slides: list[dict[str, str]] = [
        {"type": "section", "title": deck_title, "content": f"{client_name}｜客户沟通建议"},
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
            "content": combined_bullets(
                memory.get("recent_progress"),
                memory.get("delivery_signals"),
                fallback="暂无近期进展沉淀，建议先补充项目空间资料。",
            ),
        },
        {
            "type": "content",
            "title": "机会判断与进入假设",
            "content": bullets(
                [
                    f"围绕 {project_name} 的目标先形成可验证的赛道假设，而不是直接进入大规模投入。",
                    "优先判断品牌调性、渠道复用、产品可信度和组织承接能力。",
                    "用小范围访谈和桌面研究验证客户内部是否存在一致的机会认知。",
                    "把结论拆成可进入、需观察、暂不进入三类，方便管理层决策。",
                ],
                "先形成可验证机会假设，再决定是否进入下一阶段。",
            ),
        },
        {
            "type": "two_column",
            "title": "初步沟通路径",
            "left_content": bullets(
                [
                    "先确认客户对新业务方向的真实目标和内部决策背景。",
                    "再澄清约束条件：品牌边界、预算节奏、渠道可用性和时间窗口。",
                    "最后对齐本次项目要交付的判断框架、阶段成果和决策节点。",
                ],
                "先对齐目标，再澄清约束，最后确认交付边界。",
            ),
            "right_content": bullets(
                [
                    "建议采用 60-90 分钟闭门沟通，避免一开始就进入方案销售。",
                    "用问题清单引导客户表达，而不是直接呈现结论。",
                    "会后输出机会假设、关键分歧和下一步资料需求。",
                ],
                "以问题驱动沟通，形成下一步资料和判断框架。",
            ),
        },
        {
            "type": "content",
            "title": "风险与应对",
            "content": bullets(memory.get("key_risks"), "暂无结构化风险，建议在会中确认不确定性和责任边界。"),
        },
        {
            "type": "content",
            "title": "需要客户确认的问题",
            "content": combined_bullets(
                memory.get("open_questions"),
                [
                    "本次新业务探索的决策人、影响人和最终拍板机制是什么？",
                    "客户希望项目优先解决机会判断、进入路径，还是商业验证？",
                    "哪些既有品牌、渠道、供应链资源可以被新业务复用？",
                ],
                fallback="建议在首次沟通中确认目标、边界、决策人和资料需求。",
            ),
        },
        {
            "type": "content",
            "title": "下一步行动",
            "content": bullets(memory.get("next_actions"), "形成会后行动清单、责任人和时间节点。"),
        },
    ]
    target = max(len(base_slides), int(target_slide_count or 0))
    if len(base_slides) >= target:
        _upgrade_client_ppt_slide_specs(base_slides)
        return base_slides

    context_points = [
        str(item).strip()
        for group in (
            memory.get("recent_progress"),
            memory.get("delivery_signals"),
            memory.get("key_risks"),
            memory.get("open_questions"),
            memory.get("next_actions"),
            client_memory.get("sensitive_topics"),
            meeting_card.get("say"),
            meeting_card.get("confirm"),
            meeting_card.get("avoid"),
        )
        for item in (group or [])
        if str(item).strip()
    ]

    def contextual_items(fallbacks: list[str], offset: int = 0) -> list[str]:
        selected = context_points[offset : offset + 3]
        values = selected + fallbacks
        deduped: list[str] = []
        for item in values:
            if item and item not in deduped:
                deduped.append(item)
        return deduped[:5]

    supplemental_slides: list[dict[str, str]] = [
        {
            "type": "content",
            "title": "项目事实与资料基础",
            "content": bullets(
                contextual_items(
                    [
                        f"项目名称：{project_name}",
                        f"客户主体：{client_name}",
                        "优先基于项目空间、项目记忆和客户记忆整理事实，避免直接跳到结论。",
                        "把事实、假设和待验证问题分层呈现，方便客户快速校准。",
                    ]
                ),
                "先补齐项目事实、客户背景和资料来源。",
            ),
        },
        {
            "type": "two_column",
            "title": "资料收集计划",
            "left_content": bullets(
                [
                    "已知资料：项目背景、当前目标、近期进展、风险和开放问题。",
                    "待补资料：客户组织结构、决策链、历史尝试、预算约束和渠道数据。",
                    "外部资料：行业增长、竞品动作、渠道趋势、监管和消费者洞察。",
                ],
                "围绕已知资料、待补资料和外部资料建立收集清单。",
            ),
            "right_content": bullets(
                [
                    "先用项目空间资料形成第一版判断。",
                    "再通过访谈补齐客户内部视角。",
                    "最后用桌面研究校验市场假设和机会边界。",
                ],
                "资料收集要服务于判断，而不是堆材料。",
            ),
        },
        {
            "type": "content",
            "title": "客户决策链与影响路径",
            "content": bullets(
                contextual_items(
                    [
                        "识别最终拍板人、业务发起人、资源提供方和潜在反对方。",
                        "把每类干系人的诉求、担忧、影响力和需要的证据分别列清。",
                        "优先设计能让不同部门同时接受的共同问题，而不是单点说服。",
                    ],
                    2,
                ),
                "先画清决策链，再设计沟通顺序。",
            ),
        },
        {
            "type": "two_column",
            "title": "客户价值主张",
            "left_content": bullets(
                [
                    "业务价值：识别可进入的新增长机会。",
                    "管理价值：降低跨界探索的不确定性。",
                    "组织价值：让品牌、渠道、产品和战略团队形成同一套判断语言。",
                ],
                "价值主张需要同时覆盖业务、管理和组织协同。",
            ),
            "right_content": bullets(
                [
                    "用事实框架替代主观判断。",
                    "用最小验证路径替代一次性大投入。",
                    "用阶段门机制替代模糊推进。",
                ],
                "让客户看到低风险推进路径。",
            ),
        },
        {
            "type": "content",
            "title": "机会空间拆解",
            "content": bullets(
                [
                    "赛道吸引力：规模、增长、利润、竞争和监管。",
                    "客户适配度：品牌资产、渠道能力、产品可信度和组织资源。",
                    "进入难度：供应链、研发、合规、获客成本和试错周期。",
                    "优先级：先识别高确定性、低试错成本的切入点。",
                ],
                "从吸引力、适配度和进入难度拆解机会。",
            ),
        },
        {
            "type": "two_column",
            "title": "进入路径选项",
            "left_content": bullets(
                [
                    "路径 A：自有品牌延伸，利于沉淀长期资产。",
                    "路径 B：联合品牌或渠道试点，利于降低初期风险。",
                    "路径 C：先做概念验证和小样测试，利于快速学习。",
                ],
                "给客户可选择的进入路径，而不是单一路径。",
            ),
            "right_content": bullets(
                [
                    "评估标准：投入强度、品牌风险、速度、组织复杂度和数据可得性。",
                    "建议先用小范围场景验证，再决定是否扩大投入。",
                    "每条路径都要明确停止条件，防止沉没成本扩大。",
                ],
                "每条路径必须带评估标准和停止条件。",
            ),
        },
        {
            "type": "content",
            "title": "商业验证假设",
            "content": bullets(
                [
                    "客户需求假设：目标人群是否真的接受该品类和品牌联想。",
                    "渠道假设：既有渠道是否能触达并转化目标客户。",
                    "产品假设：功效、定价、包装和体验是否能形成差异化。",
                    "组织假设：内部团队是否能承接试点和快速复盘。",
                ],
                "把机会判断转成可验证假设。",
            ),
        },
        {
            "type": "content",
            "title": "风险分级与控制",
            "content": bullets(
                contextual_items(
                    [
                        "高风险：品牌稀释、合规不确定、组织资源不足。",
                        "中风险：渠道效率、供应链响应、消费者教育成本。",
                        "低风险：沟通节奏、资料完整度和会议推进方式。",
                        "每类风险都要绑定监控指标和应对动作。",
                    ],
                    4,
                ),
                "风险要分级管理，并绑定应对动作。",
            ),
        },
        {
            "type": "two_column",
            "title": "初步访谈设计",
            "left_content": bullets(
                [
                    "战略/业务负责人：确认目标、边界、决策标准。",
                    "品牌/渠道负责人：确认资源、限制和客户触点。",
                    "产品/供应链负责人：确认可行性、成本和周期。",
                ],
                "访谈对象应覆盖目标、资源和可行性。",
            ),
            "right_content": bullets(
                [
                    "问题从事实开始，再进入判断，最后确认行动。",
                    "每场访谈沉淀关键观点、分歧、证据和待补资料。",
                    "访谈后要形成可追踪的问题闭环。",
                ],
                "访谈不是收集观点，而是收敛判断。",
            ),
        },
        {
            "type": "content",
            "title": "沟通话术建议",
            "content": bullets(
                [
                    "开场先说明本次材料是初步判断框架，不是最终结论。",
                    "强调目标是帮助客户降低新业务探索的不确定性。",
                    "遇到争议时回到事实、假设和验证方式。",
                    "避免过早承诺市场规模、收入目标或确定性结论。",
                ],
                "用假设验证语言替代确定性销售语言。",
            ),
        },
        {
            "type": "two_column",
            "title": "阶段性交付物",
            "left_content": bullets(
                [
                    "第一阶段：项目事实包、问题清单和访谈提纲。",
                    "第二阶段：机会评估框架、进入路径和风险清单。",
                    "第三阶段：试点方案、资源需求和决策建议。",
                ],
                "交付物按阶段递进，避免一次性过重。",
            ),
            "right_content": bullets(
                [
                    "每一阶段都应有明确输入、输出和客户确认点。",
                    "客户确认后再进入下一阶段，降低返工。",
                    "项目空间持续沉淀所有版本和会议记录。",
                ],
                "用阶段确认机制提升推进质量。",
            ),
        },
        {
            "type": "content",
            "title": "会议议程建议",
            "content": bullets(
                [
                    "5 分钟：确认会议目标和材料边界。",
                    "15 分钟：回顾项目背景、现有事实和关键问题。",
                    "25 分钟：讨论机会假设、路径选项和主要风险。",
                    "15 分钟：确认待补资料、责任人和下一步时间表。",
                ],
                "会议要围绕校准判断和确认下一步设计。",
            ),
        },
        {
            "type": "content",
            "title": "需要客户提前准备的资料",
            "content": bullets(
                [
                    "现有品牌、渠道、消费者和产品相关资料。",
                    "历史新业务尝试、合作案例和内部复盘材料。",
                    "预算、时间窗口、组织资源和决策流程说明。",
                    "客户认为必须规避的品牌、合规或商业风险。",
                ],
                "提前收集资料能显著提高会议质量。",
            ),
        },
        {
            "type": "two_column",
            "title": "会后推进机制",
            "left_content": bullets(
                [
                    "输出会议纪要：共识、分歧、证据和待补资料。",
                    "更新项目空间：文件、访谈记录、版本和任务。",
                    "形成下一轮材料：围绕客户反馈补强判断。",
                ],
                "会后必须把讨论转成可追踪资产。",
            ),
            "right_content": bullets(
                [
                    "设置 24 小时内纪要回传。",
                    "设置 3-5 个工作日资料补齐窗口。",
                    "设置下一次决策会议或专题访谈。",
                ],
                "用时间节点推动闭环。",
            ),
        },
        {
            "type": "content",
            "title": "管理层决策看板",
            "content": bullets(
                [
                    "机会吸引力：市场空间、增长、利润和竞争。",
                    "客户适配度：品牌、渠道、产品和组织能力。",
                    "验证成本：投入、周期、资源和失败代价。",
                    "推荐动作：推进、观察、暂停或补充验证。",
                ],
                "管理层需要一页能判断是否继续投入的看板。",
            ),
        },
    ]

    while len(base_slides) < target:
        template = supplemental_slides[(len(base_slides) - 10) % len(supplemental_slides)]
        slide = dict(template)
        if len(base_slides) >= 10 + len(supplemental_slides):
            slide["title"] = f"{slide['title']}（补充视角 {len(base_slides) + 1}）"
        base_slides.append(slide)
    _upgrade_client_ppt_slide_specs(base_slides)
    return base_slides


def _upgrade_client_ppt_slide_specs(slides: list[dict[str, Any]]) -> None:
    """Attach consulting-style layout hints so PPT rendering is more executive-ready."""
    layout_by_title = {
        "项目背景与当前目标": "strategic_context",
        "这次应该主打什么": "current_target",
        "客户侧关注与敏感点": "risk_register",
        "近期进展与可交付信号": "initiative_milestones",
        "机会判断与进入假设": "prioritization_matrix",
        "初步沟通路径": "roadmap",
        "风险与应对": "risk_register",
        "需要客户确认的问题": "action_plan",
        "下一步行动": "action_plan",
        "项目事实与资料基础": "strategic_context",
        "资料收集计划": "roadmap",
        "客户决策链与影响路径": "operating_model",
        "客户价值主张": "executive_summary",
        "机会空间拆解": "portfolio_matrix",
        "进入路径选项": "current_target",
        "商业验证假设": "prioritization_matrix",
        "风险分级与控制": "risk_register",
        "初步访谈设计": "customer_journey",
        "沟通话术建议": "action_plan",
        "阶段性交付物": "initiative_milestones",
        "会议议程建议": "roadmap",
        "需要客户提前准备的资料": "action_plan",
        "会后推进机制": "operating_model",
        "管理层决策看板": "investment_kpi",
    }
    insight_by_layout = {
        "executive_summary": "本页先给管理层一个可判断、可取舍、可推进的核心答案。",
        "strategic_context": "先把事实、触发因素和管理含义讲清，避免直接进入方案堆砌。",
        "current_target": "把现状约束和目标动作并排呈现，帮助客户快速校准方向。",
        "risk_register": "风险页必须同时呈现风险、触发条件和缓释动作，才能进入真实治理。",
        "initiative_milestones": "把内容拆成阶段性里程碑，便于客户理解推进节奏和交付边界。",
        "prioritization_matrix": "用价值和可行性组织判断，避免所有机会看起来同等重要。",
        "roadmap": "路线图要说明先后顺序、依赖关系和阶段门，而不是简单排时间。",
        "operating_model": "组织和责任机制决定项目能否从讨论进入执行。",
        "portfolio_matrix": "机会组合需要同时看吸引力、适配度、进入难度和验证成本。",
        "customer_journey": "访谈和客户旅程设计应服务于假设验证，而不是泛泛收集观点。",
        "investment_kpi": "管理层需要看到判断标准、关键指标和下一步决策动作。",
        "action_plan": "行动页要把问题转成责任人、输入、输出和时间节点。",
    }
    for slide in slides:
        title = str(slide.get("title") or "").split("（补充视角")[0]
        layout_key = layout_by_title.get(title)
        if layout_key:
            slide.setdefault("layout_key", layout_key)
            slide.setdefault("visualization_type", layout_key)
            slide.setdefault("insight", insight_by_layout.get(layout_key, "本页需要形成清晰判断、证据要求和下一步动作。"))
            slide.setdefault("page_rhythm", "anchor" if layout_key in {"executive_summary", "current_target"} else "dense")


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


def _build_text_artifact(context: dict[str, Any], goal: str) -> dict[str, Any]:
    project = context.get("project") or {}
    memory = context.get("memory") or {}
    client_memory = context.get("client_memory") or {}

    def list_block(title: str, values: list[Any] | None, fallback: str) -> str:
        items = [str(item).strip() for item in (values or []) if str(item).strip()]
        if not items:
            items = [fallback]
        return f"## {title}\n" + "\n".join(f"- {item}" for item in items[:8])

    title = goal.strip()[:80] or "项目文本交付"
    sections = [
        f"# {title}",
        f"## 项目背景\n{memory.get('project_brief') or project.get('description') or '暂无项目背景，建议补充项目空间资料。'}",
        f"## 当前目标\n{memory.get('current_objective') or goal}",
        list_block("关键风险", memory.get("key_risks"), "暂无结构化风险。"),
        list_block("开放问题", memory.get("open_questions"), "暂无开放问题。"),
        list_block("客户关注", client_memory.get("sensitive_topics"), "暂无客户侧敏感点。"),
        list_block("下一步动作", memory.get("next_actions"), "确认责任人、时间节点和后续资料补充。"),
    ]
    content = "\n\n".join(sections)
    return {
        "title": title,
        "file_type": "md",
        "content": content,
        "summary": f"已生成 Markdown 交付：{title}",
    }


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
    if step.step_type == "collect_project_context":
        briefing = _build_project_briefing(session, task.project_id)
        return {
            "project": briefing.get("project", {}),
            "memory": briefing.get("memory", {}),
            "client_memory": briefing.get("client_memory", {}),
            "meeting_card": briefing.get("meeting_card", {}),
            "stakeholders": briefing.get("stakeholders", []),
            "generated_at": briefing.get("generated_at"),
        }

    if step.step_type == "build_slide_spec":
        context = _previous_context_output(session, task.id)
        target_slide_count = task_input.get("target_slide_count") or _extract_requested_slide_count(task.goal)
        title = _client_ppt_delivery_title(context, task.goal, str(task_input.get("title") or ""))
        slides = _build_client_ppt_slides(context, task.goal, int(target_slide_count or 0) or None, title)
        return {
            "title": title,
            "slides": slides,
            "target_slide_count": target_slide_count,
        }

    if step.step_type == "build_document_spec":
        context = _previous_context_output(session, task.id)
        title = str(task_input.get("title") or task.goal or context.get("project", {}).get("name") or "项目交付物")
        file_type = str(task_input.get("file_type") or _document_file_type_for_task(task.task_type))
        return _build_project_document_spec(context, task.goal, file_type, title)

    if step.step_type == "draft_text_artifact":
        context = _previous_context_output(session, task.id)
        result = _build_text_artifact(context, task.goal)
        project_file = create_project_document_record(
            session,
            task.project_id,
            name=result.get("title") or task.goal[:80] or "项目文本交付",
            content=str(result.get("content") or ""),
            uploads_dir=UPLOADS_DIR,
            init_default_folders=init_default_project_folders,
            folder_id=task_input.get("folder_id"),
            summary=str(result.get("summary") or "AI generated Markdown deliverable"),
            auto_assign_folder=True,
        )
        result.update(
            {
                "id": project_file.id,
                "project_file_id": project_file.id,
                "name": project_file.name,
                "file_name": project_file.name,
                "file_type": project_file.file_type,
                "path": project_file.path,
            }
        )
        artifact = TaskArtifact(
            task_run_id=task.id,
            step_id=step.id,
            project_file_id=project_file.id,
            name=project_file.name,
            file_type=project_file.file_type,
            path=project_file.path,
            metadata_json=_json_dumps(result),
        )
        session.add(artifact)
        session.commit()
        return result

    if step.step_type == "write_project_office_document" and task.task_type == "generate_client_ppt":
        slide_spec = _previous_slide_spec_output(session, task.id)
        project = session.get(Project, task.project_id)
        context = _previous_context_output(session, task.id)
        title = str(slide_spec.get("title") or _client_ppt_delivery_title(context, task.goal, str(task_input.get("title") or "")))
        file_name = str(task_input.get("file_name") or _client_ppt_file_name(title))
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

    if step.step_type == "write_project_office_document":
        document_spec = _previous_document_spec_output(session, task.id)
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

    if step.step_type == "summarize_result":
        deck = (
            _previous_office_output(session, task.id)
            or _previous_step_output(session, task.id, "draft_text_artifact")
            or _previous_step_output_by_type(session, task.id, "draft_text_artifact")
        )
        return {
            "message": f"任务完成，已生成 {deck.get('name') or deck.get('file_name') or '文件'} 并保存到项目空间。",
            "artifact": deck,
        }

    raise ValueError(f"Unsupported step: {step.step_type or step.key}")


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
    final_output = _previous_step_output(session, task.id, "summarize_result") or _previous_step_output_by_type(
        session, task.id, "summarize_result"
    )
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
