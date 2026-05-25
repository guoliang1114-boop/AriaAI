"""Durable task orchestration for project work.

The goal is intentionally modest: persist every run and every step before
execution so a browser refresh, SSE disconnect, or tool failure does not erase
what happened.  Executors stay small and typed; LLM-heavy planning can be added
on top without changing the task state model.
"""
from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable

from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import engine
from app.models.db import Project, TaskArtifact, TaskEvent, TaskRun, TaskStep
from app.routers.projects_deps import _build_project_briefing
from app.services.consulting_capabilities import (
    ConsultingCapability,
    build_capability_protocol,
    capability_output_schema_markdown,
    clean_requested_heading,
    extract_requested_headings,
    match_consulting_capability,
    should_create_text_artifact_for_capability,
    validate_capability_markdown,
)
from app.services.artifact_intent import ArtifactContract, detect_artifact_intent, primary_user_request_text
from app.services.deliverable_naming import file_name_for_deliverable, normalize_deliverable_title
from app.services.project_core import init_default_project_folders
from app.services.project_documents import create_project_document_record, ensure_markdown_filename
from app.services.time_utils import utc_now_naive
from app.tools.office_documents import write_project_office_document

logger = logging.getLogger(__name__)

TASK_STATUS_TERMINAL = {"completed", "failed", "canceled"}
TASK_STATUS_PAUSED = "paused"
RULE_FIRST_OVERRIDE_CONFIDENCE = 0.85
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
_MARKDOWN_INTENT_TERMS = ("markdown", ".md", " md", "md ", "md文档", "markdown文档")
_CREATE_INTENT_TERMS = (
    "准备", "生成", "创建", "制作", "输出", "导出", "整理", "整理成", "形成", "写一份", "做一份",
    "proposal", "prepare", "create", "generate", "make", "export", "draft",
)
_READ_FILE_TERMS = ("读取", "查看", "打开", "引用", "基于文件", "基于文档", "read", "open", "inspect")
_READ_TARGET_TERMS = (
    "文件", "文档", "资料", "markdown", ".md", " md", "ppt", "pptx", "word", "docx",
    "excel", "xlsx", "pdf", "项目空间", "file", "document", "attachment",
)
_FILE_LIST_TERMS = (
    "文件列表", "有哪些文件", "有什么文件", "列出文件", "项目空间文件", "空间文件",
    "markdown 文件", "markdown文档", "list files", "show files",
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
    response_mode: str = "direct"


@dataclass(frozen=True)
class RouterDecision:
    """Structured intent decision before any durable task is created."""

    response_mode: str
    task_type: str | None = None
    confidence: float = 0.0
    reason: str = ""
    title: str = ""
    output_kind: str = "chat"
    plan_steps: tuple[StepSpec, ...] = ()


DIRECT_RESPONSE_MODES = {"direct", "answer", "analyze", "chat"}
TASK_RESPONSE_MODES = {"artifact", "orchestrated", "workflow", "edit"}


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
    StepSpec("plan_text_artifact", "规划文本结构", "plan_text_artifact"),
    StepSpec("draft_text_artifact", "生成并校验文本交付", "draft_text_artifact"),
    StepSpec("summarize_result", "整理交付结果", "summarize_result", retryable=False),
]


def _consulting_capability_steps(capability: ConsultingCapability | None) -> tuple[StepSpec, ...]:
    name = capability.name if capability else "文本交付"
    return (
        StepSpec("collect_context", "收集项目上下文", "collect_project_context"),
        StepSpec("plan_text_artifact", f"规划{name}结构", "plan_text_artifact"),
        StepSpec("draft_text_artifact", f"生成并校验{name}", "draft_text_artifact"),
        StepSpec("summarize_result", "校验并交付结果", "summarize_result", retryable=False),
    )

ALLOWED_STEP_TYPES = {
    "collect_project_context",
    "build_slide_spec",
    "build_document_spec",
    "write_project_office_document",
    "plan_text_artifact",
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
    "plan_text": "plan_text_artifact",
    "plan_text_artifact": "plan_text_artifact",
    "build_text_spec": "plan_text_artifact",
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


def _task_route_from_decision(decision: RouterDecision) -> TaskRoute:
    if decision.response_mode in DIRECT_RESPONSE_MODES:
        return TaskRoute(
            None,
            confidence=decision.confidence,
            reason=decision.reason,
            title=decision.title,
            output_kind=decision.output_kind or "chat",
            plan_steps=(),
            response_mode=decision.response_mode,
        )
    task_type = decision.task_type if decision.task_type in SUPPORTED_TASK_TYPES else None
    if not task_type:
        return TaskRoute(
            None,
            confidence=decision.confidence,
            reason=decision.reason or "structured:no_task",
            output_kind=decision.output_kind,
            response_mode=decision.response_mode,
        )
    return TaskRoute(
        task_type,
        confidence=decision.confidence,
        reason=decision.reason,
        title=decision.title,
        output_kind=decision.output_kind,
        plan_steps=decision.plan_steps,
        response_mode=decision.response_mode,
    )


def _rule_based_router_decision(content: str) -> RouterDecision:
    routing_content = primary_user_request_text(content)
    normalized = (routing_content or "").strip().lower()
    if not normalized:
        return RouterDecision("direct", confidence=0.99, reason="empty", output_kind="chat")
    if _looks_like_file_read_answer_request(routing_content):
        return RouterDecision("answer", confidence=0.93, reason="rule:file_read_answer", output_kind="chat")
    if _looks_like_direct_memory_summary(routing_content):
        return RouterDecision("direct", confidence=0.94, reason="rule:direct_memory_summary", output_kind="chat")
    if _looks_like_direct_project_memory_analysis(routing_content):
        return RouterDecision("analyze", confidence=0.95, reason="rule:direct_project_memory_analysis", output_kind="chat")
    if _looks_like_direct_diagnostic(routing_content):
        return RouterDecision("analyze", confidence=0.95, reason="rule:direct_diagnostic", output_kind="chat")
    if _looks_like_existing_artifact_modify(routing_content):
        return RouterDecision("direct", confidence=0.93, reason="rule:modify_existing_file", output_kind="chat")

    consulting_capability = match_consulting_capability(routing_content)
    artifact_intent = detect_artifact_intent(routing_content)
    if artifact_intent.requested:
        task_type = _infer_task_type_from_output_kind(artifact_intent.output_kind)
        if task_type:
            return RouterDecision(
                "artifact",
                task_type,
                artifact_intent.confidence,
                f"rule:{artifact_intent.output_kind}",
                output_kind=artifact_intent.output_kind,
            )
    wants_ppt = any(term in normalized for term in _PPT_INTENT_TERMS)
    wants_excel = any(term in normalized for term in _EXCEL_INTENT_TERMS)
    wants_pdf = any(term in normalized for term in _PDF_INTENT_TERMS)
    wants_markdown = any(term in normalized for term in _MARKDOWN_INTENT_TERMS)
    wants_docx = any(term in normalized for term in _DOCX_INTENT_TERMS)
    wants_create = any(term in normalized for term in _CREATE_INTENT_TERMS)
    if wants_ppt and wants_create:
        return RouterDecision("artifact", "generate_client_ppt", 0.86, "rule:ppt", output_kind="pptx")
    if wants_excel and wants_create:
        return RouterDecision("artifact", "generate_project_excel", 0.86, "rule:excel", output_kind="xlsx")
    if wants_pdf and wants_create:
        return RouterDecision("artifact", "generate_project_pdf", 0.86, "rule:pdf", output_kind="pdf")
    if wants_markdown and wants_create:
        return RouterDecision("artifact", "create_text_artifact", 0.84, "rule:markdown", output_kind="md")
    if wants_docx and wants_create:
        return RouterDecision("artifact", "generate_project_docx", 0.82, "rule:docx", output_kind="docx")
    if should_create_text_artifact_for_capability(routing_content, consulting_capability):
        return RouterDecision(
            "artifact",
            "create_text_artifact",
            0.86,
            f"capability:{consulting_capability.id if consulting_capability else 'text'}",
            title=consulting_capability.default_title if consulting_capability else "",
            output_kind="md",
            plan_steps=_consulting_capability_steps(consulting_capability),
        )

    text_deliverable_terms = ("整理", "梳理", "总结", "形成", "准备", "起草", "写", "输出", "清单", "要点", "分析", "计划", "建议", "复盘")
    question_prefixes = ("为什么", "怎么", "如何", "是否", "是不是", "解释", "介绍一下", "这个", "你觉得")
    wants_text_artifact = wants_create and any(term in normalized for term in text_deliverable_terms)
    if wants_text_artifact and not normalized.startswith(question_prefixes):
        return RouterDecision("artifact", "create_text_artifact", 0.68, "rule:text_artifact", output_kind="md")
    return RouterDecision("direct", confidence=0.75, reason="rule:no_task", output_kind="chat")


def _rule_based_task_route(content: str) -> TaskRoute:
    return _ensure_task_route_protocol_steps(_task_route_from_decision(_rule_based_router_decision(content)), content)


def rule_based_project_task_route(content: str) -> TaskRoute:
    """Public deterministic task route for upstream intent routing.

    ``IntentRouter`` needs a cheap, side-effect-free way to detect explicit
    deliverable requests before it spends an LLM call on ambiguous chat-mode
    classification.  Keep the private helper for internal composition, but
    expose this wrapper so callers do not depend on underscored implementation
    details.
    """
    return _rule_based_task_route(content)


def task_route_for_artifact_contract(contract: ArtifactContract, content: str) -> TaskRoute:
    """Build a durable task route from a validated artifact contract."""
    if not contract.delivery_required:
        return TaskRoute(None, confidence=contract.confidence, reason=contract.reason, output_kind=contract.output_kind)
    task_type = _infer_task_type_from_output_kind(contract.output_kind)
    if not task_type:
        return TaskRoute(None, confidence=contract.confidence, reason="contract:unsupported_output", output_kind=contract.output_kind)
    return _ensure_task_route_protocol_steps(
        TaskRoute(
            task_type=task_type,
            confidence=contract.confidence,
            reason=contract.reason or "artifact_contract",
            title=contract.title,
            output_kind=contract.output_kind,
            response_mode="artifact",
        ),
        content,
    )


def _is_high_confidence_text_capability_route(route: TaskRoute) -> bool:
    return (
        route.task_type == "create_text_artifact"
        and route.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE
        and route.reason.startswith("capability:")
    )


def _ensure_task_route_protocol_steps(route: TaskRoute, content: str) -> TaskRoute:
    if route.task_type != "create_text_artifact":
        return route
    if any(step.step_type == "plan_text_artifact" for step in route.plan_steps):
        return route
    capability = match_consulting_capability(content)
    steps = _consulting_capability_steps(capability) if capability else tuple(CREATE_TEXT_ARTIFACT_STEPS)
    return TaskRoute(
        task_type=route.task_type,
        confidence=route.confidence,
        reason=route.reason,
        title=route.title,
        output_kind=route.output_kind or "md",
        plan_steps=steps,
        response_mode=route.response_mode,
    )


def _should_rule_route_override_llm(fallback: TaskRoute, route: TaskRoute) -> bool:
    """Return True when a high-confidence deterministic route should win.

    LLM routing is useful for fuzzy edge cases, but it should not downgrade or
    redirect a rule-backed consulting capability / file-deliverable match.
    """
    if not fallback.task_type or fallback.confidence < RULE_FIRST_OVERRIDE_CONFIDENCE:
        return False
    if route.response_mode in DIRECT_RESPONSE_MODES:
        return True
    return bool(route.task_type and route.task_type != fallback.task_type)


def _log_router_disagreement(content: str, fallback: TaskRoute, route: TaskRoute) -> None:
    logger.warning(
        "Project task router disagreement; using high-confidence rule route",
        extra={
            "rule_task_type": fallback.task_type,
            "rule_response_mode": fallback.response_mode,
            "rule_confidence": fallback.confidence,
            "rule_reason": fallback.reason,
            "llm_task_type": route.task_type,
            "llm_response_mode": route.response_mode,
            "llm_confidence": route.confidence,
            "llm_reason": route.reason,
            "request_preview": (content or "")[:120],
        },
    )


def _looks_like_direct_diagnostic(content: str) -> bool:
    text = (content or "").strip().lower()
    if not text:
        return False
    diagnostic_terms = (
        "看一下", "看看", "检查", "排查", "分析原因", "为什么", "是不是", "有没有问题",
        "哪里不对", "哪里有问题", "复盘一下", "review", "debug", "inspect", "why",
    )
    explicit_deliverable_terms = (
        "创建", "制作", "导出", "保存", "输出文件", "生成报告", "生成文档", "生成材料",
        "ppt", "pptx", "excel", "xlsx", "word", "docx", "pdf", "markdown", "md",
    )
    return any(term in text for term in diagnostic_terms) and not any(term in text for term in explicit_deliverable_terms)


def _looks_like_file_read_answer_request(content: str) -> bool:
    text = (content or "").strip().lower()
    if not text:
        return False
    if any(term in text for term in _FILE_LIST_TERMS):
        return True
    if "file_id" in text or "文件 id" in text or "文件id" in text:
        return True
    if any(term in text for term in _READ_FILE_TERMS) and any(term in text for term in _READ_TARGET_TERMS):
        return True
    return False


def _looks_like_existing_artifact_modify(content: str) -> bool:
    text = (content or "").strip().lower()
    if not text:
        return False
    modify_terms = (
        "修改", "更新", "替换", "追加", "重写", "修正", "矫正", "改一下", "调整", "覆盖",
        "重命名", "update", "modify", "replace", "append", "rewrite", "rename", "fix",
    )
    artifact_terms = (
        "文档", "文件", "markdown", " md", ".md", "报告", "材料", "清单", "交付物",
        "项目空间", "ppt", "pptx", "word", "docx", "excel", "xlsx", "pdf",
        "document", "file", "deliverable",
    )
    existing_terms = ("刚才的", "现有", "已有", "当前", "previous", "existing", "last", "current")
    return any(term in text for term in modify_terms) and (
        any(term in text for term in artifact_terms) or any(term in text for term in existing_terms)
    )


def _looks_like_direct_memory_summary(content: str) -> bool:
    text = (content or "").strip().lower()
    if not text:
        return False
    summary_terms = ("摘要", "概览", "总结", "overview", "summary")
    memory_terms = ("结构化记忆", "当前项目", "项目记忆", "project memory", "structured memory")
    concise_terms = ("条以内", "5 条", "5条", "bullet", "bullets", "以内")
    file_terms = (
        "生成文件", "保存", "导出", "下载", "md", "markdown", "文档", "报告",
        "ppt", "pptx", "excel", "xlsx", "word", "docx", "pdf",
    )
    if any(term in text for term in file_terms):
        return False
    return (
        any(term in text for term in summary_terms)
        and any(term in text for term in memory_terms)
        and (any(term in text for term in concise_terms) or "风险" in text or "下一步" in text)
    )


def _looks_like_direct_project_memory_analysis(content: str) -> bool:
    text = (content or "").strip().lower()
    if not text:
        return False
    memory_terms = ("结构化记忆", "当前项目", "项目记忆", "project memory", "structured memory")
    analysis_terms = (
        "分析", "指出", "识别", "评估", "判断", "盘点", "看一下", "看看", "复盘",
        "analyze", "assess", "review",
    )
    progress_terms = (
        "里程碑", "推进", "进展", "完成", "已完成", "延迟", "延期", "滞后",
        "事项", "当前阶段", "当前状态", "下一步", "接下来", "milestone",
        "progress", "delay", "status", "next step", "风险", "阻塞", "阻塞点",
        "缓解", "动作", "建议", "risk", "blocker", "mitigation", "recommendation",
    )
    explicit_deliverable_terms = (
        "生成文件", "输出文件", "生成文档", "生成报告", "生成材料", "创建文档", "保存",
        "导出", "下载", "保存为", "写成文档", "整理成文档", "形成文档", "起草文档",
        "交付物", "ppt", "pptx", "excel", "xlsx", "word", "docx", "pdf", "markdown",
        "md", "生成一个", "生成一份", "创建一个", "创建一份", "制作一个", "制作一份",
        "准备一份", "写一份", "做一份", "起草一份", "输出一份",
    )
    if any(term in text for term in explicit_deliverable_terms):
        return False
    return (
        any(term in text for term in memory_terms)
        and any(term in text for term in analysis_terms)
        and any(term in text for term in progress_terms)
    )


def _normalize_response_mode(value: Any) -> str:
    mode = str(value or "").strip().lower()
    aliases = {
        "": "direct",
        "chat_only": "direct",
        "chat": "direct",
        "answer": "direct",
        "analysis": "analyze",
        "file": "artifact",
        "deliverable": "artifact",
        "task": "orchestrated",
        "workflow_task": "orchestrated",
    }
    return aliases.get(mode, mode)


def _infer_task_type_from_output_kind(output_kind: str) -> str | None:
    kind = (output_kind or "").strip().lower().lstrip(".")
    if kind == "ppt":
        kind = "pptx"
    if kind in {"xls", "spreadsheet"}:
        kind = "xlsx"
    if kind in {"markdown", "txt", "text"}:
        kind = "md"
    return {
        "pptx": "generate_client_ppt",
        "xlsx": "generate_project_excel",
        "docx": "generate_project_docx",
        "pdf": "generate_project_pdf",
        "md": "create_text_artifact",
    }.get(kind)


def _decision_from_llm_payload(data: dict[str, Any], task_type: str | None) -> RouterDecision:
    output_kind = str(data.get("output_kind") or ("chat" if not task_type else "")).strip().lower()
    raw_response_mode = data.get("response_mode")
    response_mode = (
        _normalize_response_mode(raw_response_mode)
        if raw_response_mode is not None
        else ("artifact" if task_type or output_kind in {"md", "markdown", "pptx", "xlsx", "docx", "pdf"} else "direct")
    )
    if response_mode in DIRECT_RESPONSE_MODES:
        return RouterDecision(
            response_mode,
            None,
            confidence=float(data.get("confidence") or 0),
            reason=str(data.get("reason") or "llm:direct"),
            title=str(data.get("title") or "").strip(),
            output_kind=output_kind or "chat",
        )
    if response_mode not in TASK_RESPONSE_MODES:
        response_mode = "artifact" if task_type or output_kind in {"md", "markdown", "pptx", "xlsx", "docx", "pdf"} else "direct"
    if not task_type:
        task_type = _infer_task_type_from_output_kind(output_kind)
    return RouterDecision(
        response_mode,
        task_type,
        confidence=float(data.get("confidence") or 0),
        reason=str(data.get("reason") or "llm"),
        title=str(data.get("title") or "").strip(),
        output_kind=output_kind,
        plan_steps=_normalize_planned_steps(data.get("plan_steps"), task_type or ""),
    )


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
    if fallback.response_mode in DIRECT_RESPONSE_MODES and fallback.confidence >= 0.9:
        return fallback
    if _is_high_confidence_text_capability_route(fallback):
        return fallback
    if llm_complete is None:
        return fallback
    system = (
        "You are an intent router for a project assistant. Return only JSON. "
        "First decide response_mode, then task_type. "
        "response_mode must be one of: direct, analyze, artifact, orchestrated, edit. "
        "Use direct/analyze for ordinary questions, explanations, concise summaries, diagnostics, or project-memory overview answers. "
        "Only use artifact/orchestrated/edit when the user explicitly asks to create, save, export, download, update, or regenerate a deliverable/file, "
        "or when a multi-step persisted workflow is clearly required. "
        "Allowed task_type values: generate_client_ppt, generate_project_excel, generate_project_docx, "
        "generate_project_pdf, create_text_artifact. Use create_text_artifact for structured Markdown "
        "deliverables that should be saved to project space rather than as an Office file. "
        "If response_mode is direct or analyze, task_type must be null and output_kind must be chat. "
        "Include plan_steps when a task is needed. Allowed step_type values: collect_project_context, "
        "build_slide_spec, build_document_spec, write_project_office_document, draft_text_artifact, summarize_result."
    )
    prompt = {
        "user_message": content,
        "response_schema": {
            "response_mode": "direct|analyze|artifact|orchestrated|edit",
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
    raw_task_type = data.get("task_type")
    task_type = str(raw_task_type) if raw_task_type in SUPPORTED_TASK_TYPES else None
    decision = _decision_from_llm_payload(data, task_type)
    route = _ensure_task_route_protocol_steps(_task_route_from_decision(decision), content)
    if _should_rule_route_override_llm(fallback, route):
        _log_router_disagreement(content, fallback, route)
        return fallback
    if route.response_mode in DIRECT_RESPONSE_MODES:
        if fallback.task_type and fallback.confidence >= 0.8:
            return fallback
        return route
    if route.confidence < 0.55:
        return fallback if fallback.task_type else TaskRoute(None, confidence=route.confidence, reason=route.reason or "low_confidence")
    if not route.task_type:
        if fallback.task_type and fallback.confidence >= 0.8:
            return fallback
        return TaskRoute(None, confidence=route.confidence, reason=route.reason or "structured:no_task")
    return route


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
        r"(页数要求|至少|不少于|不低于|超过|大于|more\s+than|at\s+least)\s*\d{1,3}\s*(?:页|頁|p|page|pages|slide|slides)?\s*(?:以上|起|\+|plus|or\s+more)?",
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

    def dedupe_project_name(value: str) -> str:
        if not project_name:
            return value
        first_index = value.find(project_name)
        if first_index < 0:
            return value
        head = value[: first_index + len(project_name)]
        tail = value[first_index + len(project_name) :].replace(project_name, "")
        return f"{head}{tail}".strip("-_｜|/ ")

    return normalize_deliverable_title(
        content=dedupe_project_name(goal),
        explicit_title=dedupe_project_name(explicit_title or ""),
        file_type="pptx",
        client_name=client_name,
    )


def _client_ppt_file_name(title: str) -> str:
    return file_name_for_deliverable(title, "pptx", fallback="client-presentation")


def _extract_requested_slide_count(text: str) -> int | None:
    """Extract a user-requested minimum slide/page count from a PPT request."""
    value = text or ""
    patterns = (
        r"(\d{1,3})\s*(?:页|頁|p|page|pages|slide|slides)\s*(?:以上|起|至少|\+|plus|or\s+more)?",
        r"(?:至少|不少于|不低于|超过|大于|more\s+than|at\s+least)\s*(\d{1,3})\s*(?:页|頁|p|page|pages|slide|slides)?",
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
    # Keep generated decks usable while honoring explicit user asks. 80 is a
    # practical upper bound for one synchronous project artifact, not a silent
    # downgrade of common asks such as 50 pages.
    return max(4, min(max(matches), 80))


def _dedupe_nonempty(items: list[Any] | tuple[Any, ...] | None, *, limit: int | None = None) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for item in items or []:
        value = re.sub(r"\s+", " ", str(item or "").strip())
        if not value or value in seen:
            continue
        seen.add(value)
        values.append(value)
        if limit and len(values) >= limit:
            break
    return values


def _extract_requested_chapter_count(text: str, *, default: int = 0) -> int:
    value = text or ""
    patterns = (
        r"(?:至少|不少于|不低于|超过|大于|more\s+than|at\s+least)\s*(\d{1,2})\s*(?:个)?\s*(?:章节|章|部分|目录|chapter|chapters)",
        r"(\d{1,2})\s*(?:个)?\s*(?:章节|章|部分|目录|chapter|chapters)\s*(?:以上|起|至少|\+|plus|or\s+more)?",
    )
    matches: list[int] = []
    for pattern in patterns:
        for match in re.finditer(pattern, value, flags=re.IGNORECASE):
            try:
                matches.append(int(match.group(1)))
            except (TypeError, ValueError):
                continue
    if not matches:
        return default
    return max(1, min(max(matches), 30))


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
    if payload.get("required_sections") is not None:
        sections = [str(section) for section in (payload.get("required_sections") or []) if str(section)]
        return "必需章节：" + "、".join(sections[:6])
    if payload.get("duration_ms") is not None:
        return f"耗时：{payload.get('duration_ms')}ms"
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
        f"已准备处理：{payload.get('goal') or payload.get('task_type')}",
        f"任务 ID：{payload.get('id')}",
        f"当前状态：{status_label}",
        "",
        "执行进展：",
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
            return f"已完成：{goal}\n\n生成物：{names}\n\n下方卡片可以直接打开，完整执行记录在右上角「任务」面板。"
        return f"已完成：{goal}\n\n执行步骤和结果已记录在下方卡片与右上角「任务」面板。"

    if failed_step:
        step_index = failed_step.get("sort_order") or "-"
        title = failed_step.get("title") or failed_step.get("key") or "执行步骤"
        error = str(failed_step.get("error_message") or "").strip()
        error_line = f"\n\n失败原因：{error}" if error else ""
        return (
            f"任务在第 {step_index} 步「{title}」暂停，需要处理。"
            f"{error_line}\n\n请点击失败步骤卡片里的「打开任务面板处理」，可从失败处重试、取消任务或查看完整日志。"
        )

    return f"已准备执行：{goal}\n\n我会按下方步骤更新进展，完整记录可在右上角「任务」面板查看。"


def task_step_log_message(event_type: str, step: dict[str, Any] | None = None, output: dict | None = None) -> str:
    if event_type == "task_started":
        return "已开始处理：会按步骤更新进展，并记录每一步状态。"
    if event_type == "task_completed":
        return "处理完成：结果和生成物已保存。"
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
    if event_type == "step_progress":
        return str((output or {}).get("message") or f"{prefix}，正在处理。")
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
        if step.get("step_type") == "plan_text_artifact":
            sections = (output or {}).get("required_sections") or []
            if sections:
                return f"{prefix}，完成。已识别 {len(sections)} 个必需章节：{'、'.join(str(item) for item in sections[:6])}。"
            return f"{prefix}，完成。文本交付结构已确认。"
        if step.get("step_type") == "draft_text_artifact":
            return f"{prefix}，完成。Markdown 交付物「{(output or {}).get('name') or (output or {}).get('title') or '-'}」已保存到项目空间。"
        return f"{prefix}，完成。"
    if event_type == "step_failed":
        return f"{prefix}，失败：{step.get('error_message') or '未知错误'}。前面已完成步骤会保留，可从这里重试。"
    if event_type == "step_retry":
        return f"{prefix}，首次执行失败，正在自动重试。"
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


def _fail_step(session: Session, task: TaskRun, step: TaskStep, exc: Exception, *, duration_ms: int | None = None) -> None:
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
        payload={"error_code": step.error_code, "retryable": step.retryable, "duration_ms": duration_ms},
    )


def _retry_step_after_failure(
    session: Session,
    task: TaskRun,
    step: TaskStep,
    exc: Exception,
    *,
    duration_ms: int | None = None,
) -> None:
    now = utc_now_naive()
    step.retry_count += 1
    step.error_code = exc.__class__.__name__
    step.error_message = str(exc)
    step.updated_at = now
    task.retry_count += 1
    task.status = "running"
    task.error_code = ""
    task.error_message = ""
    task.updated_at = now
    session.add(step)
    session.add(task)
    session.commit()
    _record_event(
        session,
        task,
        step=step,
        event_type="step_retry",
        message=f"{step.title}失败，正在自动重试第 {step.retry_count} 次：{exc}",
        payload={
            "error_code": step.error_code,
            "retryable": step.retryable,
            "retry_count": step.retry_count,
            "duration_ms": duration_ms,
        },
    )


def _progress_step(session: Session, task: TaskRun, step: TaskStep, message: str, payload: dict | None = None) -> None:
    _record_event(
        session,
        task,
        step=step,
        event_type="step_progress",
        message=message,
        payload={"message": message, **(payload or {})},
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


def _previous_text_plan_output(session: Session, task_id: int) -> dict[str, Any]:
    return _previous_step_output(session, task_id, "plan_text_artifact") or _previous_step_output_by_type(
        session, task_id, "plan_text_artifact"
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


def _step_progress_payload(task: TaskRun, step: TaskStep) -> dict[str, Any]:
    task_input = _json_loads(task.input_json)
    if step.step_type == "collect_project_context":
        return {"message": "正在读取项目背景、结构化记忆、客户信息和近期上下文。"}
    if step.step_type == "plan_text_artifact":
        return {"message": "正在识别交付类型、必需章节和输出结构约束。"}
    if step.step_type == "draft_text_artifact":
        return {"message": "正在按规划结构生成内容，并在保存前校验章节完整性。"}
    if step.step_type == "build_slide_spec":
        return {"message": "正在生成 PPT 故事线、页数结构和每页要点。"}
    if step.step_type == "build_document_spec":
        file_type = str(task_input.get("file_type") or _document_file_type_for_task(task.task_type)).upper()
        return {"message": f"正在规划 {file_type} 文件结构和内容字段。"}
    if step.step_type == "write_project_office_document":
        return {"message": "正在生成文件并保存到项目空间。"}
    if step.step_type == "summarize_result":
        return {"message": "正在整理最终说明、生成物链接和任务记录。"}
    return {"message": "正在处理当前步骤。"}


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
        values = _dedupe_nonempty(items)
        if not values:
            values = [fallback]
        return "\n".join(f"- {item}" for item in values[:5])

    def combined_bullets(*groups: list[str] | None, fallback: str) -> str:
        values: list[str] = []
        for group in groups:
            values.extend(str(item).strip() for item in (group or []) if str(item).strip())
        return bullets(_dedupe_nonempty(values), fallback)

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
    context_points = _dedupe_nonempty(context_points)

    def contextual_items(fallbacks: list[str], offset: int = 0) -> list[str]:
        selected = context_points[offset : offset + 3]
        values = selected + fallbacks
        return _dedupe_nonempty(values, limit=5)

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

    deepening_topics: list[dict[str, Any]] = [
        {
            "title": "赛道宏观吸引力",
            "layout_key": "strategic_context",
            "bullets": ["市场规模和增长速度", "利润池与价格带", "监管边界和准入要求", "客户资产可迁移程度"],
        },
        {
            "title": "消费者需求场景",
            "layout_key": "customer_journey",
            "bullets": ["目标客群是谁", "核心痛点和购买触发", "现有解决方案不足", "可验证的首批场景"],
        },
        {
            "title": "竞品与替代方案",
            "layout_key": "portfolio_matrix",
            "bullets": ["直接竞品打法", "替代品类威胁", "渠道资源差异", "可借鉴和需规避动作"],
        },
        {
            "title": "品牌延展边界",
            "layout_key": "risk_register",
            "bullets": ["主品牌调性保护", "新品类信任背书", "高端化一致性", "避免稀释核心认知"],
        },
        {
            "title": "渠道复用假设",
            "layout_key": "prioritization_matrix",
            "bullets": ["既有渠道触达能力", "私域和会员资产", "线下终端转化效率", "新增渠道投入强度"],
        },
        {
            "title": "产品组合方向",
            "layout_key": "portfolio_matrix",
            "bullets": ["入门试点产品", "高价值明星单品", "套组和复购设计", "功效证据和合规表达"],
        },
        {
            "title": "试点市场选择",
            "layout_key": "prioritization_matrix",
            "bullets": ["先选高反馈市场", "控制投放成本", "兼顾渠道代表性", "明确停止和扩大条件"],
        },
        {
            "title": "最小验证路径",
            "layout_key": "roadmap",
            "bullets": ["两周完成假设清单", "四周完成访谈和桌研", "六周形成试点方案", "八周进入管理层决策"],
        },
        {
            "title": "组织协同机制",
            "layout_key": "operating_model",
            "bullets": ["战略部牵头", "品牌和渠道共同评审", "产品与合规提前介入", "管理层设置阶段门"],
        },
        {
            "title": "投资与资源需求",
            "layout_key": "investment_kpi",
            "bullets": ["人力投入", "外部研究预算", "试点费用", "管理层审批材料"],
        },
        {
            "title": "关键指标体系",
            "layout_key": "investment_kpi",
            "bullets": ["需求验证指标", "渠道转化指标", "品牌风险指标", "商业回报指标"],
        },
        {
            "title": "沟通对象分层",
            "layout_key": "customer_journey",
            "bullets": ["决策层看投入产出", "业务方看落地路径", "品牌方看调性风险", "渠道方看转化抓手"],
        },
        {
            "title": "访谈问题设计",
            "layout_key": "customer_journey",
            "bullets": ["先问事实再问判断", "先问资源再问约束", "先问历史再问未来", "每题绑定决策用途"],
        },
        {
            "title": "资料清单与证据等级",
            "layout_key": "action_plan",
            "bullets": ["内部资料", "市场资料", "消费者资料", "竞品资料"],
        },
        {
            "title": "主要不确定性",
            "layout_key": "risk_register",
            "bullets": ["品类认知不确定", "渠道效率不确定", "组织承接不确定", "投入节奏不确定"],
        },
        {
            "title": "风险缓释动作",
            "layout_key": "risk_register",
            "bullets": ["设置阶段门", "小样本验证", "限定预算池", "提前设定退出条件"],
        },
        {
            "title": "客户会议开场",
            "layout_key": "executive_summary",
            "bullets": ["说明材料是初步框架", "强调共同验证", "避免过早定结论", "聚焦下一步输入"],
        },
        {
            "title": "客户会议议程",
            "layout_key": "roadmap",
            "bullets": ["背景校准", "假设讨论", "分歧确认", "行动闭环"],
        },
        {
            "title": "会后输出包",
            "layout_key": "initiative_milestones",
            "bullets": ["会议纪要", "问题清单", "资料需求", "下一版判断框架"],
        },
        {
            "title": "下一阶段工作计划",
            "layout_key": "roadmap",
            "bullets": ["第 1 周资料收集", "第 2 周访谈", "第 3 周机会评估", "第 4 周管理层汇报"],
        },
        {
            "title": "决策门与退出条件",
            "layout_key": "investment_kpi",
            "bullets": ["继续推进条件", "补充验证条件", "暂停条件", "退出条件"],
        },
        {
            "title": "项目成功标准",
            "layout_key": "executive_summary",
            "bullets": ["形成清晰机会判断", "明确进入路径", "验证关键风险", "客户愿意进入下一阶段"],
        },
        {
            "title": "管理层汇报口径",
            "layout_key": "investment_kpi",
            "bullets": ["一句话结论", "三个关键证据", "两类主要风险", "一个下一步请求"],
        },
        {
            "title": "项目空间沉淀方式",
            "layout_key": "operating_model",
            "bullets": ["资料版本可追踪", "会议记录可复用", "生成物可直接打开", "任务日志可回溯"],
        },
        {
            "title": "最终沟通收束",
            "layout_key": "action_plan",
            "bullets": ["确认共识", "确认分歧", "确认责任人", "确认下一次节点"],
        },
    ]

    used_titles = {str(slide.get("title") or "") for slide in base_slides}
    extension_queue: list[dict[str, Any]] = supplemental_slides + [
        {
            "type": "content" if index % 3 else "two_column",
            "title": topic["title"],
            "content": bullets(topic["bullets"], "补充该专题的事实、判断和下一步动作。"),
            "left_content": bullets(topic["bullets"][:2], "说明该专题的事实基础。"),
            "right_content": bullets(topic["bullets"][2:], "说明该专题的判断和动作。"),
            "layout_key": topic["layout_key"],
            "visualization_type": topic["layout_key"],
            "page_rhythm": "dense",
        }
        for index, topic in enumerate(deepening_topics, start=1)
    ]

    queue_index = 0
    while len(base_slides) < target:
        if queue_index < len(extension_queue):
            slide = dict(extension_queue[queue_index])
            queue_index += 1
        else:
            chapter = len(base_slides) + 1
            slide = {
                "type": "content",
                "title": f"专题深化 {chapter}：待验证问题与行动",
                "content": bullets(
                    [
                        "明确本页服务的判断问题。",
                        "补齐需要客户确认的事实和证据。",
                        "记录对应责任人、资料来源和时间节点。",
                        "在下一轮沟通中更新为正式结论页。",
                    ],
                    "围绕新增专题补齐判断和行动。",
                ),
                "layout_key": "action_plan",
                "visualization_type": "action_plan",
                "page_rhythm": "dense",
            }
        if slide["title"] in used_titles:
            continue
        used_titles.add(slide["title"])
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
        layout_key = layout_by_title.get(title) or str(slide.get("layout_key") or "")
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


def _interview_questionnaire_sheet(
    name: str,
    department: str,
    questions: list[tuple[str, str, str, str, str]],
) -> dict[str, Any]:
    return {
        "name": name,
        "headers": ["序号", "问题分类", "核心问题", "追问/深挖方向", "优先级", "建议填写部门", "预期产出", "访谈记录"],
        "data": [
            [f"{name[:1]}{index:02d}", category, question, probe, priority, department, output, ""]
            for index, (category, question, probe, priority, output) in enumerate(questions, start=1)
        ],
    }


def _comprehensive_interview_questionnaire_sheets(goal: str, context: dict[str, Any]) -> list[dict[str, Any]]:
    project = context.get("project") or {}
    memory = context.get("memory") or {}
    project_name = project.get("name") or "当前项目"
    client_name = project.get("client") or "客户"
    brief = memory.get("project_brief") or project.get("description") or goal

    sheet_specs: list[tuple[str, str, list[tuple[str, str, str, str, str]]]] = [
        (
            "战略部问卷",
            "战略部",
            [
                ("战略动机", "公司为什么在这个时间点考虑进入该新业务方向？", "触发因素是增长压力、竞品动作、董事会要求，还是主动布局？", "P0", "明确项目必要性与紧迫性"),
                ("战略定位", "新业务在集团整体战略中承担什么角色？", "第二增长曲线、品牌延伸、防御性布局、资本运作选项分别占多大权重？", "P0", "判断战略地位"),
                ("增长目标", "未来 3-5 年对新业务的收入、利润或市场地位有何目标？", "是否已有内部测算、董事会共识或预算口径？", "P0", "锚定目标与预期"),
                ("赛道边界", "目前希望重点研究哪些细分赛道，哪些方向明确排除？", "产品、价格带、人群、渠道、监管边界如何定义？", "P0", "缩小研究范围"),
                ("进入方式", "更倾向自建、并购、合资、授权、渠道合作还是先试点？", "各路径的偏好、红线、预算上限和决策门槛是什么？", "P0", "形成进入路径假设"),
                ("决策机制", "该项目的关键决策人、影响人和审批节点是什么？", "总办会、董事会、战略委员会分别关注什么？", "P0", "识别决策链"),
                ("内部共识", "高层及核心部门对新业务方向的支持度如何？", "支持方、保留方和反对方各自的顾虑是什么？", "P1", "评估组织阻力"),
                ("已有工作", "公司已经完成哪些研究、接触、试点或内部讨论？", "是否有报告、会议纪要、标的名单、合作方材料可提供？", "P1", "避免重复工作"),
                ("时间窗口", "项目推进是否绑定年度预算、战略会或董事会节点？", "最晚何时需要阶段性结论和 go/no-go 建议？", "P0", "倒排工作计划"),
                ("停止条件", "什么情况下公司会暂停或放弃该方向？", "预算、合规、品牌风险、ROI 或组织能力的止损线是什么？", "P1", "明确风险边界"),
            ],
        ),
        (
            "品牌市场问卷",
            "品牌部/市场部",
            [
                ("品牌资产", "现有品牌最核心的消费者认知和信任来源是什么？", "药企背景、滋补文化、老字号、功效认知分别如何影响新品类？", "P0", "判断品牌迁移基础"),
                ("品牌边界", "品牌延伸到新赛道的边界和红线是什么？", "哪些品类、价格带、渠道或表达方式会稀释主品牌？", "P0", "明确品牌风险"),
                ("人群匹配", "现有核心消费者与目标赛道人群的重叠度如何？", "年龄、城市、消费能力、需求场景、触媒习惯是否匹配？", "P1", "评估人群迁移"),
                ("品牌架构", "新业务应使用主品牌、子品牌、背书品牌还是独立品牌？", "主品牌露出到什么程度最合适？", "P0", "形成品牌架构选项"),
                ("定位叙事", "最有潜力的品牌故事线是什么？", "如何把现有信任资产转译为新品类的功效、场景和情绪价值？", "P1", "构建价值主张"),
                ("竞品参考", "内部认为哪些品牌或跨界案例最值得参考？", "具体学习其定位、产品、渠道、内容还是组织打法？", "P1", "识别审美标杆"),
                ("内容能力", "团队是否具备目标赛道所需的内容营销能力？", "小红书、抖音、达人、医学背书、私域运营的能力短板在哪里？", "P1", "评估能力缺口"),
                ("预算机制", "品牌营销预算如何分配，能否支持新业务试点？", "预算是共享、增量，还是独立孵化预算？", "P1", "评估启动资源"),
                ("风险顾虑", "品牌部最担心新业务带来哪些负面影响？", "功效争议、客诉、定价、渠道错配、主品牌稀释如何管理？", "P0", "识别品牌红旗"),
                ("成功标准", "从品牌视角，试点成功应看哪些指标？", "认知、转化、复购、口碑、内容声量和渠道反馈如何排序？", "P1", "定义品牌 KPI"),
            ],
        ),
        (
            "渠道销售问卷",
            "渠道部/销售部/电商部",
            [
                ("渠道结构", "现有渠道结构、收入占比和增长趋势如何？", "线上、线下、药店、经销、直营、私域分别表现如何？", "P0", "盘点渠道家底"),
                ("复用潜力", "哪些现有渠道可以承载新业务，哪些需要新建？", "渠道客群、销售逻辑、货架位置和导购能力是否匹配？", "P0", "评估渠道复用度"),
                ("药店渠道", "药店渠道是否适合销售新业务产品？", "门店覆盖、陈列、培训、合规、毛利和动销要求是什么？", "P0", "判断药店可行性"),
                ("电商能力", "天猫、京东、抖音等平台的运营能力和资源如何？", "自营/代运营模式、投放能力、内容能力和会员资产如何？", "P1", "评估线上能力"),
                ("医美渠道", "是否了解或拥有医美机构、皮肤科、专业渠道资源？", "合作门槛、分成模式、合规风险和品牌风险如何？", "P0", "评估专业渠道"),
                ("经销商态度", "现有经销商对引入新品类的态度如何？", "是否具备类似品类经验，是否会产生资源冲突？", "P1", "预判渠道阻力"),
                ("私域会员", "会员数据库规模、画像、活跃度和触达能力如何？", "能否用于试用招募、问卷、复购和交叉销售？", "P1", "评估低成本试点"),
                ("渠道经济性", "各渠道的毛利、费用、获客成本和回款周期如何？", "新品类是否能达到渠道期望的利润和周转？", "P1", "建立渠道模型"),
                ("终端改造", "若进入新业务，终端陈列、体验、培训需要哪些改造？", "是否需要样品、体验装、检测服务或专家背书？", "P2", "估算落地投入"),
                ("销售组织", "现有销售团队能否承担新品类销售？", "需要哪些新岗位、培训、激励和管理机制？", "P1", "识别组织缺口"),
            ],
        ),
        (
            "研发技术问卷",
            "研发中心/技术部",
            [
                ("研发基础", "现有研发团队规模、专业背景和核心能力是什么？", "哪些能力可迁移到新业务，哪些必须外部补足？", "P0", "评估研发起点"),
                ("技术储备", "是否有可用于新业务的技术、专利、配方或原料研究？", "成熟度、验证数据、知识产权归属和商业化难点是什么？", "P0", "盘点差异化资产"),
                ("功效验证", "是否具备功效评价、测试、临床或第三方验证资源？", "不同功效宣称需要哪些测试、周期和费用？", "P0", "判断背书可行性"),
                ("产品开发", "从概念到上市的标准开发流程和周期是什么？", "最快 MVP 需要多久，风险点在哪些环节？", "P1", "估算上市周期"),
                ("外部合作", "是否有高校、科研机构、ODM/OEM 或专家资源？", "合作模式、历史经验、筛选标准和议价能力如何？", "P1", "评估外部杠杆"),
                ("配方能力", "是否具备目标品类配方开发和稳定性测试能力？", "如不具备，哪些环节适合外包，哪些必须自控？", "P1", "定义自研边界"),
                ("原料故事", "现有核心原料或技术如何形成消费者可理解的功效叙事？", "是否有科学证据支持，是否存在夸大风险？", "P1", "构建产品卖点"),
                ("研发资源", "新业务研发预算、人力和实验资源如何分配？", "会不会与主业研发形成资源竞争？", "P1", "评估资源约束"),
                ("质量标准", "新业务应采用哪些质量、稳定性和安全性标准？", "现有体系需要补哪些 SOP、检测和文档？", "P0", "明确质量门槛"),
                ("知识产权", "相关商标、专利、成分、包装和功效宣称是否有侵权风险？", "是否需要 FTO、商标预检或专利布局？", "P2", "识别 IP 风险"),
            ],
        ),
        (
            "供应链生产问卷",
            "供应链/采购/生产",
            [
                ("生产资质", "现有资质能否覆盖目标品类生产和销售？", "缺失资质的申请周期、成本和关键条件是什么？", "P0", "识别准入门槛"),
                ("生产路径", "自建生产、委托生产、联合开发分别可行性如何？", "各路径的投入、速度、质量控制和风险是什么？", "P0", "形成生产路径"),
                ("供应商资源", "是否已有适配目标品类的原料、包材、代工供应商？", "供应商能力、认证、价格、交期和合作稳定性如何？", "P1", "盘点供应生态"),
                ("成本结构", "目标产品的原料、加工、包材、物流成本大致如何？", "成本敏感项和规模化降本空间在哪里？", "P1", "支持毛利测算"),
                ("质量控制", "现有品控体系如何适配新业务？", "来料、过程、成品、留样、追溯和客诉如何管理？", "P0", "评估品控能力"),
                ("产能弹性", "如果试点成功，供应链放量能力如何？", "扩产周期、最小起订量、库存风险和资金占用如何？", "P1", "判断规模化能力"),
                ("包装能力", "是否具备目标品类所需的包装设计、打样和供应资源？", "包装成本、合规标识、环保要求和货架表现如何？", "P2", "评估包材路径"),
                ("物流仓储", "仓储物流是否有温控、效期、批次和退换货要求？", "现有系统和仓库能否支持？", "P2", "识别履约改造"),
                ("ESG 风险", "核心原料、动物福利、环保或溯源是否可能引发争议？", "是否已有可披露的 ESG 管理和供应链审计机制？", "P2", "预判外部风险"),
                ("供应链节奏", "试点、小批量和规模化阶段的供应链准备周期分别多久？", "每个阶段的关键里程碑和决策点是什么？", "P1", "支撑路线图"),
            ],
        ),
        (
            "财务投资问卷",
            "财务部/投资部",
            [
                ("预算框架", "公司对新业务孵化的预算框架和资金来源是什么？", "第一年、前三年、试点阶段分别可承受的投入是多少？", "P0", "明确预算天花板"),
                ("回报要求", "公司对 ROI、投资回收期、利润率和现金流有什么要求？", "能否接受前期亏损换增长，容忍期多长？", "P0", "明确财务门槛"),
                ("投资节奏", "预算释放应按什么里程碑分阶段？", "市场验证、产品验证、渠道验证、组织搭建分别对应什么拨款条件？", "P1", "设计投资门"),
                ("商业模型", "目标业务的收入、毛利、费用、库存和回款模型如何假设？", "哪些假设最需要验证？", "P1", "建立测算框架"),
                ("并购偏好", "是否考虑并购、参股或合资？", "标的规模、估值、控制权、整合风险和审批机制如何？", "P1", "评估资本路径"),
                ("成本口径", "品牌、研发、渠道、组织、系统投入如何归集？", "哪些费用可共享，哪些必须新增？", "P1", "统一测算口径"),
                ("风险准备", "公司如何看待试错成本和止损机制？", "失败预算、库存减值、商誉风险和合规罚款如何管理？", "P1", "识别财务风险"),
                ("绩效指标", "财务视角的试点成功指标是什么？", "收入、毛利、复购、CAC、库存周转和现金回款如何排序？", "P0", "定义财务 KPI"),
                ("审批流程", "新业务预算和投资项目需要经过哪些审批节点？", "资料要求、时间周期和关键关注点是什么？", "P0", "明确决策流程"),
                ("资源约束", "当前年度预算和组织资源是否支持新增业务？", "是否存在其他战略项目竞争预算？", "P1", "评估机会成本"),
            ],
        ),
        (
            "组织人才问卷",
            "人力资源部/组织发展",
            [
                ("组织归属", "新业务应放在现有事业部、战略部孵化，还是成立独立团队？", "各方案的权责、资源、速度和协同风险是什么？", "P0", "明确组织模式"),
                ("关键岗位", "启动新业务最关键的岗位有哪些？", "产品、研发、品牌、渠道、电商、供应链、合规负责人如何配置？", "P0", "定义岗位地图"),
                ("人才储备", "公司内部是否有相关品类或新业务孵化经验人才？", "可调配性、激励诉求和能力短板是什么？", "P1", "盘点内部人才"),
                ("外部招聘", "外部招聘目标人才的难度、周期和薪酬区间如何？", "是否需要行业顾问、合伙人或项目制专家？", "P1", "估算补才成本"),
                ("激励机制", "新业务团队需要怎样的绩效和激励机制？", "是否区别于主业考核，是否允许长期激励或项目奖金？", "P1", "设计激励原则"),
                ("协同机制", "跨部门推进最容易卡在哪里？", "资源优先级、审批、预算、数据和责任归属如何解决？", "P0", "预判协同阻力"),
                ("决策节奏", "新业务需要怎样的会议、PMO 和复盘机制？", "周会、月度评审、里程碑评审谁参加？", "P1", "设计治理机制"),
                ("文化适配", "公司文化是否支持快速试错和新品类孵化？", "哪些流程或习惯会限制速度？", "P2", "识别文化约束"),
                ("培训转型", "现有团队需要哪些培训才能支持新业务？", "产品知识、内容营销、渠道打法、合规要求如何培训？", "P2", "规划能力建设"),
                ("外部伙伴", "哪些能力适合通过外部伙伴补足？", "顾问、代运营、ODM、专家委员会的使用原则是什么？", "P1", "确定外部协作"),
            ],
        ),
        (
            "合规法务问卷",
            "法务/合规/质量法规",
            [
                ("准入法规", "目标品类涉及哪些生产、备案、注册、宣传和销售法规？", "最关键的合规门槛和时间周期是什么？", "P0", "明确法规路径"),
                ("功效宣称", "哪些功效宣称可以使用，哪些存在高风险？", "需要哪些证据、测试、备案或审查支持？", "P0", "控制宣传风险"),
                ("标签包装", "包装、标签、说明书、成分表有哪些强制要求？", "现有团队是否熟悉相关规范？", "P1", "明确包装合规"),
                ("渠道合规", "药店、电商、医美、私域销售分别有哪些限制？", "医美渠道和专业背书是否有额外风险？", "P0", "识别渠道红线"),
                ("品牌风险", "跨品类延伸是否会带来商标、授权、消费者投诉或主业声誉风险？", "如何设置审核机制和危机预案？", "P1", "建立风控机制"),
                ("数据合规", "会员数据、问卷、试用招募和私域运营涉及哪些数据合规要求？", "授权、留存、脱敏和跨部门使用如何管理？", "P1", "保障数据使用"),
                ("合同模板", "与 ODM/OEM、渠道、达人、专家、检测机构合作需要哪些合同模板？", "知识产权、保密、质量责任和违约责任如何约定？", "P1", "支撑合作落地"),
                ("审批流程", "新产品上市前的内部合规审批流程是什么？", "谁审核，审核材料和周期是什么？", "P0", "明确上市流程"),
                ("历史事件", "公司过去是否发生过宣传、质量或渠道合规问题？", "经验教训和现行管控措施是什么？", "P2", "吸取历史教训"),
                ("风险等级", "从合规视角，新业务最大三类风险是什么？", "发生概率、影响程度、预防措施和责任人如何定义？", "P0", "形成风险清单"),
            ],
        ),
        (
            "市场竞争问卷",
            "战略部/市场部/外部研究",
            [
                ("市场判断", "公司如何判断目标赛道的增长空间和窗口期？", "内部已有数据、外部报告和关键假设是什么？", "P0", "校准市场吸引力"),
                ("细分机会", "最看好的细分品类、价格带和人群是什么？", "依据是需求增长、竞争空白、品牌适配还是渠道优势？", "P0", "识别机会池"),
                ("竞争格局", "重点关注哪些竞品、替代品和跨界玩家？", "其定位、产品、渠道、价格、营销和组织打法是什么？", "P1", "建立竞品框架"),
                ("客户需求", "目标消费者的核心痛点、购买动因和信任门槛是什么？", "哪些需求已被满足，哪些仍有未满足空间？", "P1", "定义价值主张"),
                ("价格带", "公司希望进入哪个价格带？", "现有品牌资产能否支撑溢价，低价是否损害品牌？", "P1", "形成定价假设"),
                ("产品组合", "适合从单品、套装、系列还是解决方案切入？", "首批 SKU 应如何控制复杂度？", "P1", "设计产品入口"),
                ("验证方式", "最小市场验证应如何设计？", "试用、内测、渠道小批量、会员招募、专家评估如何组合？", "P0", "形成验证计划"),
                ("数据来源", "后续研究还需要哪些外部数据、访谈或专家输入？", "优先级、获取方式和时间要求是什么？", "P1", "列出资料清单"),
                ("差异化", "公司最可能建立的差异化优势是什么？", "品牌、原料、研发、渠道、合规或组织哪项最可信？", "P0", "明确战略抓手"),
                ("失败风险", "哪些市场假设一旦不成立会导致项目不可行？", "如何快速验证这些假设？", "P0", "识别关键假设"),
            ],
        ),
        (
            "协同推进问卷",
            "战略部汇总/各部门",
            [
                ("资料清单", "各部门能提供哪些现成资料、数据和联系人？", "资料负责人、交付时间、保密等级和缺口是什么？", "P0", "建立资料台账"),
                ("部门诉求", "各部门希望项目解决哪些问题，避免哪些影响？", "诉求之间是否存在冲突？", "P1", "识别利益相关方"),
                ("决策输入", "每个部门认为 go/no-go 决策必须回答哪些问题？", "哪些问题必须用数据验证，哪些可通过管理判断？", "P0", "形成决策问题清单"),
                ("资源承诺", "若进入下一阶段，各部门能承诺哪些资源？", "人员、预算、渠道、样品、专家和时间窗口分别如何？", "P1", "评估落地资源"),
                ("优先级冲突", "新业务与现有重点项目是否存在资源冲突？", "如何排序，谁有协调权？", "P1", "提前处理冲突"),
                ("治理机制", "跨部门项目组应如何设立？", "Sponsor、PMO、工作组、例会和汇报机制如何安排？", "P0", "设计治理架构"),
                ("阶段目标", "下一阶段最应该完成哪些里程碑？", "30/60/90 天分别产出什么？", "P0", "形成行动计划"),
                ("风险闭环", "各部门最担心的三项风险是什么？", "责任部门、预警指标和缓释动作是什么？", "P0", "形成风险台账"),
                ("沟通机制", "战略部如何向所有部门传达本次访谈和后续工作？", "统一口径、材料模板、反馈节奏和升级机制如何？", "P1", "提高协同效率"),
                ("下一步", "访谈完成后，各部门期待看到怎样的输出？", "报告、路演、决策会材料、行动清单分别如何使用？", "P1", "明确交付形态"),
            ],
        ),
    ]

    overview = {
        "name": "访谈总览",
        "headers": ["字段", "内容"],
        "data": [
            ["项目名称", project_name],
            ["客户", client_name],
            ["访谈目的", f"围绕“{brief}”系统扫描战略意图、内部资源、能力缺口、风险约束与推进条件。"],
            ["使用方式", "战略部统筹分发，各部门填写本部门 Sheet；P0 必答，P1 重要补充，P2 视时间深挖。"],
            ["建议节奏", "战略部 90 分钟；品牌/渠道/研发/供应链/财务各 45-60 分钟；组织/合规/协同各 30-45 分钟。"],
            ["输出要求", "每题尽量填写事实、数据来源、判断依据、负责人和可提供材料。"],
        ],
    }
    index = {
        "name": "Sheet索引",
        "headers": ["Sheet", "模块", "建议填写部门", "题量", "用途"],
        "data": [
            [index + 3, name, department, len(questions), "收集该职能对新业务机会、约束和落地条件的判断"]
            for index, (name, department, questions) in enumerate(sheet_specs)
        ],
    }
    sheets = [overview, index]
    sheets.extend(_interview_questionnaire_sheet(name, department, questions) for name, department, questions in sheet_specs)
    return sheets


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
        if any(token in text for token in ("问卷", "全面", "丰富", "所有部门", "全部门", "各部门", "战略部")):
            return _comprehensive_interview_questionnaire_sheets(goal, context)
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


def _build_text_artifact_plan(goal: str) -> dict[str, Any]:
    normalized_goal = re.sub(r"\s+", " ", (goal or "").strip())
    capability = match_consulting_capability(normalized_goal)
    requested_headings = extract_requested_headings(normalized_goal)
    requested_chapter_count = _extract_requested_chapter_count(
        normalized_goal,
        default=(
            capability.default_chapter_count
            if capability and capability.requires_hierarchy and ("章节" in normalized_goal or "目录" in normalized_goal)
            else 0
        ),
    )
    protocol = (
        build_capability_protocol(
            normalized_goal,
            capability,
            requested_headings=requested_headings,
            requested_chapter_count=requested_chapter_count,
        )
        if capability
        else None
    )
    return {
        "capability_id": capability.id if capability else "",
        "capability_name": capability.name if capability else "",
        "artifact_kind": capability.artifact_kind if capability else "md",
        "required_sections": list(protocol.required_sections) if protocol else [],
        "quality_rules": list(protocol.quality_rules) if protocol else [],
        "min_chapter_count": protocol.min_chapter_count if protocol else 0,
        "requires_hierarchy": protocol.requires_hierarchy if protocol else False,
        "output_schema": capability_output_schema_markdown(protocol) if protocol else "",
    }


def _build_text_artifact(context: dict[str, Any], goal: str) -> dict[str, Any]:
    project = context.get("project") or {}
    memory = context.get("memory") or {}
    client_memory = context.get("client_memory") or {}
    stakeholders = context.get("stakeholders") or []

    def list_block(title: str, values: list[Any] | None, fallback: str) -> str:
        items = [str(item).strip() for item in (values or []) if str(item).strip()]
        if not items:
            items = [fallback]
        return f"## {title}\n" + "\n".join(f"- {item}" for item in items[:8])

    def context_sentence() -> str:
        brief = str(memory.get("project_brief") or project.get("description") or "").strip()
        objective = str(memory.get("current_objective") or "").strip()
        return brief or objective or "本次会议需要围绕项目目标、客户关注和后续推进方式达成共识。"

    def agenda_items() -> list[str]:
        items = [
            "确认会议目标和预期产出：先说明本次不是直接卖方案，而是共创进入机会判断、合作边界和下一步验证路径。",
            "校准项目背景与业务假设：围绕功能性护肤品/医美抗衰方向，确认客户为什么现在考虑、希望解决什么增长问题。",
            "拆解机会吸引力和适配度：讨论赛道空间、东阿阿胶品牌资产、渠道复用、产品可信度和组织承接能力。",
            "聚焦关键分歧和敏感点：把品牌调性、主业压力、原料供应、投入产出和试错成本逐项放到桌面上。",
            "确认最小验证路径：明确先访谈谁、补哪些资料、用什么标准判断“继续推进/补充验证/暂停”。",
            "锁定会后动作：确定责任人、资料清单、时间节点和下一次决策会议安排。",
        ]
        open_questions = [str(item).strip() for item in (memory.get("open_questions") or []) if str(item).strip()]
        return _dedupe_nonempty(items + open_questions, limit=8)

    def stakeholder_lines() -> list[str]:
        values: list[str] = []
        for item in stakeholders[:5]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or item.get("role") or "").strip()
            role = str(item.get("role") or item.get("influence_type") or "").strip()
            note = str(item.get("note") or item.get("concern") or "").strip()
            if name:
                values.append(f"{name}{f'（{role}）' if role and role != name else ''}：先回应其核心关切，再用事实和下一步验证动作承接。{note}")
        if values:
            return values
        return [
            "战略/新业务负责人：用“机会假设 + 最小验证路径 + 阶段门”的语言沟通，强调先验证再投入，避免把早期探索说成确定性结论。",
            "品牌负责人：围绕“品牌调性一致性、功效背书边界、是否稀释主品牌”展开，主动提出风险控制口径。",
            "渠道负责人：围绕“既有渠道能否复用、首批试点场景、转化指标和渠道投入”展开，避免只谈宏观市场机会。",
            "产品/供应链/合规相关方：重点确认功效表达、研发周期、合规边界和供应链可行性，把不可行条件提前暴露。",
            "高管/决策层：突出投入产出、试错成本、停止条件和下一阶段所需决策，帮助其快速判断是否值得继续推进。",
        ]

    def action_items() -> list[str]:
        next_actions = [str(item).strip() for item in (memory.get("next_actions") or []) if str(item).strip()]
        defaults = [
            "会后 24 小时内输出会议纪要，标注已达成共识、待确认问题和责任人。",
            "补齐业务进入假设所需资料，包括赛道规模、竞品路径、渠道资产、品牌边界、试点预算和合规要求。",
            "形成一页机会判断框架，把“赛道吸引力、客户适配度、进入难度、验证成本”作为统一决策语言。",
            "安排 3-5 位关键人访谈，覆盖战略、新业务、品牌、渠道、产品/合规等角色。",
            "约定下一次推进会时间，并在会前完成关键假设、风险清单和资料缺口更新。",
        ]
        return _dedupe_nonempty(next_actions + defaults, limit=8)

    def build_capability_sections(capability: ConsultingCapability, headings: list[str] | None = None) -> str:
        selected_headings = headings or list(capability.default_sections)
        lines = [f"# {title}"]
        for heading in selected_headings:
            lines.append("")
            lines.append(f"## {heading}")
            lines.append(default_section_content(heading))
        return "\n".join(lines).strip()

    def build_storyline_outline(chapter_count: int) -> str:
        project_label = project.get("name") or "本项目"
        client_label = project.get("client") or "客户"

        def subsection_content(item: str) -> str:
            if "为什么" in item or "动因" in item or "背景" in item:
                return f"说明{client_label}当前为什么需要讨论该议题，并把讨论落到「{project_label}」的业务进入判断上。"
            if "品牌" in item or "渠道" in item or "资产" in item:
                return "评估东阿阿胶现有品牌信任、渠道触点、会员资产和组织能力能否低成本迁移到新业务。"
            if "机会" in item or "赛道" in item or "市场" in item:
                return "从规模、增速、利润池、竞争密度和监管边界拆解机会质量，并标注哪些判断仍需要数据验证。"
            if "目标" in item or "获得什么" in item:
                return "明确本次沟通要形成的共识、待验证问题和下一步决策输入，避免会议只停留在泛泛交流。"
            if "风险" in item or "分歧" in item or "敏感" in item:
                return "把潜在阻力前置讨论，区分必须规避的红线、可以试点验证的不确定性和需要管理层拍板的问题。"
            if "路径" in item or "方案" in item or "选项" in item:
                return "给出可比较的进入路径，并明确每条路径的适用条件、资源要求、优势、风险和停止条件。"
            if "访谈" in item or "资料" in item or "证据" in item:
                return "列清需要补充的客户输入、外部资料和关键人访谈问题，让下一阶段工作有明确抓手。"
            if "行动" in item or "会后" in item or "交付" in item or "责任" in item:
                return "把讨论转成责任人、时间节点、交付物和下一次会议安排，确保会后可以持续推进。"
            if "决策" in item or "指标" in item or "看板" in item:
                return "定义管理层可以使用的判断标准，把机会判断转化为推进、补充验证、暂停或退出的决策。"
            return "说明本小节的核心判断、所需证据、客户需要确认的问题，以及进入下一阶段前必须完成的动作。"

        chapters = [
            (
                "项目背景与沟通目标",
                [
                    f"为什么现在讨论「{project_label}」",
                    f"{client_label}希望通过本次沟通获得什么判断",
                    "本材料要解决的核心问题和不解决的问题",
                ],
            ),
            (
                "客户现状与战略动因",
                [
                    "客户增长压力与新业务孵化职责",
                    "功能性护肤品/医美抗衰方向的战略相关性",
                    "现有品牌、渠道和组织能力的可迁移资产",
                ],
            ),
            (
                "赛道机会与市场吸引力",
                [
                    "目标赛道的增长逻辑、利润池和竞争密度",
                    "消费者需求场景与购买触发因素",
                    "监管、功效表达和渠道变化带来的窗口期",
                ],
            ),
            (
                "东阿阿胶的适配度假设",
                [
                    "品牌信任资产能否迁移到新赛道",
                    "渠道、会员、终端资源能否复用",
                    "产品、供应链和合规能力的承接边界",
                ],
            ),
            (
                "进入机会的初步判断框架",
                [
                    "用赛道吸引力、客户适配度、进入难度、验证成本四象限判断",
                    "区分可优先进入、需要观察、暂不进入的机会类型",
                    "把每个机会拆成事实、假设、证据和待验证问题",
                ],
            ),
            (
                "关键分歧与敏感风险",
                [
                    "品牌调性和主品牌稀释风险",
                    "投入产出、试错成本和组织资源占用",
                    "供应链、合规和消费者教育成本",
                ],
            ),
            (
                "进入路径与方案选项",
                [
                    "路径 A：自有品牌延伸，适合沉淀长期资产",
                    "路径 B：联合品牌/渠道试点，适合降低初期风险",
                    "路径 C：概念验证和小样测试，适合快速学习",
                ],
            ),
            (
                "最小验证计划",
                [
                    "关键人访谈：战略、品牌、渠道、产品/合规和管理层",
                    "桌面研究：赛道、竞品、渠道、价格带和监管口径",
                    "试点设计：样本、预算、指标和停止条件",
                ],
            ),
            (
                "客户会议沟通方式",
                [
                    "开场先说明这是共同验证框架，不是最终结论",
                    "用问题牵引客户表达，避免过早销售方案",
                    "对不同关键人使用不同表达重点",
                ],
            ),
            (
                "会后行动与下一阶段交付",
                [
                    "24 小时内输出会议纪要、共识、分歧和资料缺口",
                    "3-5 个工作日内补齐资料并形成机会判断框架",
                    "下一次会议进入路径选择、风险评估和试点决策",
                ],
            ),
        ]
        extra_topics = [
            "证据体系与资料清单",
            "管理层决策看板",
            "项目组织与协同机制",
            "阶段门与退出条件",
            "最终汇报结构",
            "预算与资源测算",
            "竞品案例对标",
            "消费者验证设计",
            "试点复盘机制",
            "长期能力沉淀",
        ]
        while len(chapters) < chapter_count:
            extra_title = extra_topics[(len(chapters) - 10) % len(extra_topics)]
            chapters.append(
                (
                    extra_title,
                    [
                        f"本章要回答的核心管理问题：{extra_title}如何支撑进入判断",
                        "需要补齐的事实、数据和客户输入",
                        "可交付结论、责任人和后续动作",
                    ],
                )
            )

        lines = [f"# {title}", ""]
        lines.extend(
            [
                "## 使用说明",
                "以下结构按一级目录和二级目录组织。一级目录对应客户沟通的主要章节，二级目录对应每章需要展开的判断点、证据和行动。",
                "",
            ]
        )
        for index, (chapter_title, sub_items) in enumerate(chapters[:chapter_count], start=1):
            lines.append(f"# {index:02d}. {chapter_title}")
            for sub_index, item in enumerate(sub_items, start=1):
                lines.append(f"## {index}.{sub_index} {item}")
                lines.append(subsection_content(item))
            lines.append("")
        return "\n".join(lines).strip()

    def default_section_content(heading: str) -> str:
        normalized = clean_requested_heading(heading)
        if "开场" in normalized or "话术" in normalized:
            return (
                f"各位好，今天我们围绕「{project.get('name') or '本项目'}」做一次大前期沟通。"
                f"我们不会在还没有充分验证前直接给一个确定结论，而是先把机会假设、客户资产、关键风险和下一步验证方式放到同一张桌面上。"
                f"今天希望达成三件事：第一，对齐为什么要看功能性护肤品/医美抗衰这类新方向；第二，确认哪些判断需要客户内部资料和关键人访谈支持；第三，明确会后谁补什么资料、什么时候进入下一次决策讨论。"
            )
        if "议题" in normalized or "顺序" in normalized or "流程" in normalized:
            return "\n".join(f"{index}. {item}" for index, item in enumerate(agenda_items(), start=1))
        if "关键人" in normalized or "干系人" in normalized or "表达" in normalized:
            return "\n".join(f"- {item}" for item in stakeholder_lines())
        if "行动" in normalized or "清单" in normalized or "会后" in normalized:
            return "\n".join(f"- [ ] {item}" for item in action_items())
        if "背景" in normalized:
            return context_sentence()
        if "风险" in normalized:
            risks = [str(item).strip() for item in (memory.get("key_risks") or []) if str(item).strip()]
            concerns = [str(item).strip() for item in (client_memory.get("sensitive_topics") or []) if str(item).strip()]
            values = risks + concerns
            return "\n".join(f"- {item}" for item in values[:6]) if values else "暂无结构化风险，建议在会上主动确认客户关注和内部决策约束。"
        return f"围绕「{project.get('name') or '本项目'}」补充该部分内容。参考背景：{context_sentence()}"

    def build_project_background_diagnostic() -> str:
        project_label = project.get("name") or "本项目"
        client_label = project.get("client") or "客户"
        project_brief = str(memory.get("project_brief") or project.get("description") or "").strip()
        objective = str(memory.get("current_objective") or "").strip()
        risk_items = [str(item).strip() for item in (memory.get("key_risks") or []) if str(item).strip()]
        open_items = [str(item).strip() for item in (memory.get("open_questions") or []) if str(item).strip()]
        next_items = [str(item).strip() for item in (memory.get("next_actions") or []) if str(item).strip()]
        user_context = normalized_goal[:1200]

        lines = [
            f"# {title}",
            "",
            "## 一、背景事实",
            (
                f"{client_label}当前围绕「{project_label}」的核心问题，不是简单判断“要不要开发”，"
                "而是要先确认新业务机会、组织承接能力、品牌边界、投入产出和风险控制是否具备进入条件。"
            ),
            f"- 项目已知背景：{project_brief or '项目空间暂未形成完整背景，需要通过访谈和资料补充进一步确认。'}",
            f"- 当前目标：{objective or '先把机会假设、风险约束和下一步验证路径整理清楚。'}",
            f"- 用户本轮要求：{user_context}",
            "",
            "## 二、深层动因",
            "- 客户并不只是需要一个开发排期，而是需要在业务进入前降低决策不确定性，避免把战略探索误判成确定性建设任务。",
            "- 如果在客户需求、内部共识、商业假设和治理边界尚未明确时直接进入开发，后续很容易出现范围蔓延、反复返工和责任边界不清。",
            "- 咨询公司的价值在于先把问题定义、证据体系、决策标准和阶段门搭起来，让客户知道每一步为什么做、做到什么程度可以继续。",
            "",
            "## 三、辩证判断",
            "- 一方面，提前讨论系统或平台建设是有价值的，因为它能倒逼客户把流程、数据、角色和指标讲清楚。",
            "- 另一方面，过早承诺开发会把商业问题技术化，容易让客户以为“系统上线”本身就是结果，而忽略新业务验证和组织协同。",
            "- 因此更合理的判断是：先完成咨询诊断和机会验证，再把被验证过的流程、数据和角色沉淀为可开发的产品需求。",
            "",
            "## 四、为什么不宜立即执行开发",
            "- 需求尚未闭环：如果关键场景、用户角色、审批流程和数据口径没有确认，开发只能依赖假设推进。",
            "- 投入产出尚未量化：如果没有明确收益指标、试点范围和停止条件，客户很难判断预算是否值得投入。",
            "- 组织协同尚未成形：新业务通常涉及战略、品牌、渠道、产品、合规和财务多方，任何一方约束缺失都会影响落地。",
            "- 风险责任尚未界定：合规边界、品牌延展、供应链可行性、数据治理和项目决策权都需要先被明确。",
            "",
            "## 五、咨询公司介入价值",
            "- 帮客户把“想做什么”转化成“为什么做、先验证什么、由谁决策、何时停止或进入下一阶段”。",
            "- 通过访谈、资料清单、机会判断框架和阶段门机制，把隐性分歧提前暴露，降低后期开发返工风险。",
            "- 输出可复用的业务蓝图、流程蓝图、数据口径、角色权限和需求优先级，为后续系统建设提供稳定输入。",
            "",
            "## 六、当前风险与待验证问题",
        ]
        if risk_items:
            lines.extend(f"- 风险：{item}" for item in risk_items[:8])
        else:
            lines.extend(
                [
                    "- 风险：客户可能把探索性新业务直接推进为建设项目，导致商业假设未验证、技术投入提前发生。",
                    "- 风险：不同干系人对目标、预算、收益和风险的理解不一致，后续容易在执行阶段集中爆发。",
                ]
            )
        if open_items:
            lines.extend(f"- 待确认：{item}" for item in open_items[:8])
        else:
            lines.extend(
                [
                    "- 待确认：客户真正希望解决的是增长、效率、客户经营、渠道协同，还是管理层可视化。",
                    "- 待确认：第一阶段可接受的试点范围、预算上限、成功指标和停止条件是什么。",
                ]
            )
        lines.extend(["", "## 七、建议的下一步"])
        if next_items:
            lines.extend(f"- [ ] {item}" for item in next_items[:8])
        else:
            lines.extend(
                [
                    "- [ ] 先做关键人访谈，覆盖战略、新业务、品牌、渠道、产品/合规和财务视角。",
                    "- [ ] 整理业务进入假设、风险清单、资料缺口和阶段门判断标准。",
                    "- [ ] 输出一版“咨询诊断优先，开发后置”的推进路线，明确何时进入原型或系统需求阶段。",
                    "- [ ] 将验证后的流程、数据、角色和指标沉淀成后续系统建设的需求输入。",
                ]
            )
        return "\n".join(lines).strip()

    project_name = str(project.get("name") or "").strip()
    normalized_goal = re.sub(r"\s+", " ", goal.strip())
    capability = match_consulting_capability(normalized_goal)
    requested_headings = list(extract_requested_headings(normalized_goal))
    is_storyline_request = bool(capability and capability.id == "consulting_storyline")
    requested_chapter_count = _extract_requested_chapter_count(
        normalized_goal,
        default=(capability.default_chapter_count if capability and capability.requires_hierarchy and ("章节" in normalized_goal or "目录" in normalized_goal) else 0),
    )
    protocol = (
        build_capability_protocol(
            normalized_goal,
            capability,
            requested_headings=tuple(requested_headings),
            requested_chapter_count=requested_chapter_count,
        )
        if capability
        else None
    )
    if requested_headings:
        title_core = (
            "客户会议准备"
            if any("会议" in heading or "开场" in heading or "议题" in heading for heading in requested_headings)
            else "项目文本交付"
        )
    elif is_storyline_request:
        title_core = capability.default_title if capability else "客户战略沟通故事线大纲"
    elif capability:
        title_core = capability.default_title
    elif "客户会议" in normalized_goal or "会议" in normalized_goal:
        title_core = "客户会议准备"
    elif "风险" in normalized_goal:
        title_core = "项目风险清单"
    elif "背景" in normalized_goal:
        title_core = "项目背景"
    elif "行动" in normalized_goal or "清单" in normalized_goal:
        title_core = "行动清单"
    else:
        title_core = normalized_goal[:36] or "项目文本交付"
    title = f"{project_name}-{title_core}" if project_name and project_name not in title_core else title_core
    title = title[:80] or "项目文本交付"
    if requested_headings:
        body_sections = [f"## {heading}\n{default_section_content(heading)}" for heading in requested_headings]
        content = "\n\n".join([f"# {title}", *body_sections])
        missing = [heading for heading in requested_headings if f"## {heading}" not in content]
        if missing:
            raise ValueError(f"Text artifact missing requested sections: {', '.join(missing)}")
    elif is_storyline_request:
        content = build_storyline_outline(max(requested_chapter_count, 10))
    elif capability:
        content = build_capability_sections(capability)
    elif any(term in normalized_goal for term in ("背景", "辩证", "深度", "不希望立即执行开发", "咨询公司介入", "开发前", "为什么不")):
        content = build_project_background_diagnostic()
    else:
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
    validation = validate_capability_markdown(title=title, content=content, protocol=protocol)
    if not validation.ok:
        raise ValueError("Text artifact failed capability validation: " + "；".join(validation.errors))

    return {
        "title": title,
        "file_type": "md",
        "content": content,
        "summary": f"已生成 Markdown 交付：{title}",
        "text_spec": {
            "sections": list(protocol.required_sections) if protocol else requested_headings,
            "capability_id": capability.id if capability else "",
            "capability_name": capability.name if capability else "",
            "quality_rules": list(capability.quality_rules) if capability else [],
            "strict_sections": bool(requested_headings),
            "chapter_count": requested_chapter_count or None,
            "hierarchy": "h1_h2" if is_storyline_request else "",
            "output_schema": capability_output_schema_markdown(protocol) if protocol else "",
            "validation_errors": list(validation.errors),
        },
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

    if step.step_type == "plan_text_artifact":
        return _build_text_artifact_plan(task.goal)

    if step.step_type == "draft_text_artifact":
        context = _previous_context_output(session, task.id)
        result = _build_text_artifact(context, task.goal)
        text_plan = _previous_text_plan_output(session, task.id)
        if text_plan:
            result.setdefault("text_spec", {}).update({"plan": text_plan})
        target_name = str(task_input.get("file_name") or task_input.get("title") or result.get("title") or "项目文本交付").strip()
        if target_name.lower().endswith(".md"):
            target_name = ensure_markdown_filename(target_name)
        project_file = create_project_document_record(
            session,
            task.project_id,
            name=target_name,
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
        title = normalize_deliverable_title(
            content=task.goal,
            explicit_title=str(task_input.get("title") or document_spec.get("title") or ""),
            file_type=file_type,
            client_name=project.client if project and project.client else "",
        )
        file_name = str(task_input.get("file_name") or file_name_for_deliverable(title, file_type))
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
        progress_payload = _step_progress_payload(task, step)
        _progress_step(session, task, step, str(progress_payload.get("message") or ""), progress_payload)
        yield {
            "event_type": "step_progress",
            "step": _serialize_step(step),
            "message": task_step_log_message("step_progress", _serialize_step(step), progress_payload),
            "task": serialize_task_run(session, task, include_events=True),
            "payload": progress_payload,
        }
        while True:
            step_started_at = time.perf_counter()
            try:
                output = await _execute_step(session, task, step)
                break
            except Exception as exc:
                duration_ms = round((time.perf_counter() - step_started_at) * 1000)
                session.rollback()
                refreshed_task = session.get(TaskRun, task.id)
                refreshed_step = session.get(TaskStep, step.id)
                if refreshed_task is not None:
                    task = refreshed_task
                if refreshed_step is not None:
                    step = refreshed_step
                if step.retryable and step.retry_count < 1:
                    _retry_step_after_failure(session, task, step, exc, duration_ms=duration_ms)
                    yield {
                        "event_type": "step_retry",
                        "step": _serialize_step(step),
                        "message": task_step_log_message("step_retry", _serialize_step(step)),
                        "task": serialize_task_run(session, task, include_events=True),
                        "duration_ms": duration_ms,
                    }
                    continue
                _fail_step(session, task, step, exc, duration_ms=duration_ms)
                yield {
                    "event_type": "step_failed",
                    "step": _serialize_step(step),
                    "message": task_step_log_message("step_failed", _serialize_step(step)),
                    "task": serialize_task_run(session, task, include_events=True),
                    "duration_ms": duration_ms,
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
        duration_ms = round((time.perf_counter() - step_started_at) * 1000)
        if isinstance(output, dict):
            output = {**output, "duration_ms": duration_ms}
        _complete_step(session, task, step, output)
        yield {
            "event_type": "step_completed",
            "step": _serialize_step(step),
            "message": task_step_log_message("step_completed", _serialize_step(step), output),
            "task": serialize_task_run(session, task, include_events=True),
            "duration_ms": duration_ms,
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
