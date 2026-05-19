"""Chat streaming service — SSE orchestration and main entry point.

Tool execution and artifact helpers live in sub-modules:
  - chat_tools.py
  - chat_artifacts.py
"""
from __future__ import annotations

import json
import asyncio
import re
import time
from collections.abc import AsyncIterator

from sqlmodel import Session

from app.config import DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE
from app.models.db import Skill
from app.models.db import Setting as _Setting
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_store import (
    build_message_metadata,
    get_recent_message_history,
    get_or_create_conversation,
    persist_assistant_message,
    persist_generated_artifacts,
    persist_user_message,
)
from app.services.context_builder import (
    build_chat_context,
    is_client_project_portfolio_query,
    is_workspace_project_inventory_query,
)
from app.services.provider_selector import (
    _load_provider_module,
    get_selected_model,
    resolve_provider_from_model,
)
from app.services.settings_helper import get_float_setting, get_int_setting
from app.services.task_orchestrator import (
    create_task_run,
    detect_project_task_type,
    route_project_task_request,
    serialize_task_run,
    stream_execute_task_run_in_session,
    task_run_chat_brief,
)
from app.services.title_generator import schedule_title_generation
from app.tools import registry
from app.tools import project_markdown as _project_markdown  # noqa: F401 - register project Markdown tools
from app.tools import office_documents as _office_documents  # noqa: F401 - register project Office tools
from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME

# Sub-module imports
from app.services.chat_tools import (  # noqa: F401
    ChatRuntime,
    _build_completed_skill_progress,
    _summarize_tool_result,
    _to_user_friendly_error,
    _tool_progress_payload,
    _tool_start_progress_payload,
)
from app.services.chat_artifacts import (  # noqa: F401
    _build_artifact_notice,
    _build_slides_from_strategy_text,
    _clean_slide_line,
    _extract_artifact,
    _has_ppt_artifact,
    _is_digital_strategy_runtime,
    _looks_like_digital_strategy_tool_input,
    _repair_digital_strategy_ppt_tool_input,
    _route_ppt_tool_for_skill,
    _should_auto_generate_digital_strategy_ppt,
)

_PROJECT_MARKDOWN_TOOLS = frozenset({PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME})
_PROJECT_OFFICE_TOOLS = frozenset({WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME})
TOOL_WORKFLOW_STEP_TOTAL = 4


def _try_extract_tool_use_json(text: str) -> dict | None:
    """Try to extract a tool_use JSON block from text that may contain mixed content."""
    idx = text.find('{"type"')
    while idx != -1:
        depth = 0
        for i, ch in enumerate(text[idx:], start=idx):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        block = json.loads(text[idx:i + 1])
                        if block.get("type") == "tool_use":
                            return block
                    except json.JSONDecodeError:
                        break
        idx = text.find('{"type"', idx + 1)
    return None


def _extract_tool_use_json_blocks(text: str) -> tuple[list[dict], str]:
    """Extract all complete tool_use JSON objects and return the remaining display text."""
    decoder = json.JSONDecoder()
    blocks: list[dict] = []
    spans: list[tuple[int, int]] = []
    idx = text.find("{")
    while idx != -1:
        try:
            block, end = decoder.raw_decode(text[idx:])
        except json.JSONDecodeError:
            idx = text.find("{", idx + 1)
            continue
        absolute_end = idx + end
        if isinstance(block, dict) and block.get("type") == "tool_use":
            blocks.append(block)
            spans.append((idx, absolute_end))
            idx = text.find("{", absolute_end)
        else:
            idx = text.find("{", idx + 1)

    if not spans:
        return [], text

    cleaned_parts: list[str] = []
    cursor = 0
    for start, end in spans:
        cleaned_parts.append(text[cursor:start])
        cursor = end
    cleaned_parts.append(text[cursor:])
    return blocks, "".join(cleaned_parts)


OUTPUT_TRUNCATED_MARKER = "[OUTPUT_TRUNCATED]"
STREAM_HEARTBEAT_SECONDS = 8.0
STREAM_TASK_EVENT_PAUSE_SECONDS = 0.18
CHAT_HISTORY_WINDOW = 24
STANDALONE_FAST_PATH_MODEL = "moonshot-v1-8k"
STANDALONE_FAST_PATH_MAX_TOKENS = 1536
STANDALONE_CHAT_MAX_TOKENS = 2048
CLIENT_PORTFOLIO_FAST_MODEL = "deepseek-v4-flash"
CLIENT_PORTFOLIO_MAX_TOKENS = 4096
WORKSPACE_INVENTORY_MAX_TOKENS = 6144


def _has_deepseek_api_key(session: Session) -> bool:
    setting = session.get(_Setting, "deepseek_api_key")
    if setting and setting.value.strip():
        return True
    import os

    return bool(os.environ.get("DEEPSEEK_API_KEY"))


def _cap_max_tokens_for_model(model: str, max_tokens: int) -> int:
    normalized = (model or "").lower()
    if normalized.startswith(("kimi-k2.6", "kimi-k2.5")):
        return min(max_tokens, 32768)
    if normalized.startswith("moonshot-v1-8k"):
        return min(max_tokens, 4096)
    if normalized.startswith("claude-"):
        return min(max_tokens, 8192)
    return min(max_tokens, 8192)


def _is_standalone_fast_path(req: SendMessageRequest, effective_skill_id: int | None) -> bool:
    return (
        req.project_id is None
        and effective_skill_id is None
        and not req.rag_doc_ids
        and not req.file_ids
        and not is_client_project_portfolio_query(req.content)
        and not is_workspace_project_inventory_query(req.content)
        and len((req.content or "").strip()) <= 280
    )


def _resolve_runtime_model_and_tokens(
    req: SendMessageRequest,
    selected_model: str,
    max_tokens: int,
    effective_skill_id: int | None,
    *,
    has_deepseek_api_key: bool = False,
    project_context: str = "",
) -> tuple[str, int]:
    normalized = (selected_model or "").lower()
    has_client_portfolio_context = project_context.startswith("# Client Project Portfolio Context")
    has_workspace_inventory_context = project_context.startswith("# Workspace Project Inventory Context")
    if has_client_portfolio_context:
        if has_deepseek_api_key and normalized in {"kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)
        return selected_model, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)
    if has_workspace_inventory_context:
        if has_deepseek_api_key and normalized in {"kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)
        return selected_model, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)
    if _is_standalone_fast_path(req, effective_skill_id) and normalized.startswith("kimi-k2.6"):
        return STANDALONE_FAST_PATH_MODEL, min(max_tokens, STANDALONE_FAST_PATH_MAX_TOKENS)
    if is_client_project_portfolio_query(req.content):
        if has_deepseek_api_key and normalized in {"kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)
        return selected_model, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)
    if is_workspace_project_inventory_query(req.content):
        if has_deepseek_api_key and normalized in {"kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)
        return selected_model, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)
    if req.project_id is None and effective_skill_id is None:
        return selected_model, min(max_tokens, STANDALONE_CHAT_MAX_TOKENS)
    return selected_model, max_tokens


def _should_apply_skill(content: str, skill: Skill | None) -> bool:
    if not skill:
        return False
    text = (content or "").strip().lower()
    if not text:
        return False
    explicit_skill = any(token in text for token in ("@skill", "@ skills", "\u4f7f\u7528skill", "\u8c03\u7528skill", "\u8fd0\u884cskill", "\u6267\u884cskill", "\u7528\u8fd9\u4e2a\u80fd\u529b", "\u7528\u8be5\u80fd\u529b"))
    deliverable_keywords = (
        "\u751f\u6210", "\u5236\u4f5c", "\u521b\u5efa", "\u8f93\u51fa", "\u4ea7\u51fa", "\u5199\u4e00\u4efd", "\u505a\u4e00\u4efd", "\u6574\u7406\u6210", "\u5f62\u6210", "\u8bbe\u8ba1", "\u89c4\u5212", "\u5236\u5b9a",
        "\u5b8c\u5584", "\u91cd\u65b0\u751f\u6210", "\u5bfc\u51fa", "\u4e0b\u8f7d", "\u4ea4\u4ed8", "ppt", "powerpoint", "deck", "slide", "slides",
        "excel", "xlsx", "xls", "word", "docx", "pdf", "\u8868\u683c", "\u5de5\u4f5c\u7c3f", "\u6587\u6863", "\u6587\u4ef6",
        "\u62a5\u544a", "\u65b9\u6848", "\u6750\u6599", "\u8def\u7ebf\u56fe", "roadmap", "\u84dd\u56fe", "blueprint", "\u6218\u7565", "strategy", "\u8ba1\u5212",
    )
    casual_prefixes = (
        "\u4e3a\u4ec0\u4e48", "\u4e3a\u5565", "\u600e\u4e48", "\u5982\u4f55", "\u662f\u5426", "\u662f\u4e0d\u662f", "\u80fd\u4e0d\u80fd", "\u53ef\u4ee5\u5417", "\u8fd9\u4e2a", "\u90a3\u4e2a",
        "\u6211\u95ee", "\u89e3\u91ca", "\u8bf4\u660e", "\u68c0\u67e5", "\u770b\u4e00\u4e0b", "\u4f60\u89c9\u5f97", "what", "why", "how", "can", "could", "should",
    )
    deliverable_intent = any(token in text for token in deliverable_keywords)
    casual_question = text.startswith(casual_prefixes)
    long_template_like = len(text) > 180 and ("\n" in content or ":" in content or "\uff1a" in content)
    return explicit_skill or long_template_like or (deliverable_intent and not casual_question)


def _slugify_deliverable_name(value: str, fallback: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9\u4e00-\u9fa5._-]+", "-", str(value or "").strip()).strip("-")
    return slug[:48].strip("-") or fallback


def _infer_office_file_type(content: str, tool_input: dict) -> str:
    explicit = str(tool_input.get("file_type") or "").strip().lower()
    if explicit:
        return explicit
    text = f"{content}\n{json.dumps(tool_input, ensure_ascii=False)}".lower()
    if any(token in text for token in ("excel", "xlsx", "xls", "表格", "访谈表", "清单", "台账")):
        return "xlsx"
    if any(token in text for token in ("ppt", "pptx", "powerpoint", "deck", "幻灯片", "演示")):
        return "pptx"
    if "pdf" in text:
        return "pdf"
    return "docx"


def _default_xlsx_sheets_for_request(content: str) -> list[dict]:
    text = (content or "").lower()
    if any(token in text for token in ("访谈", "interview")):
        return [
            {
                "name": "访谈计划",
                "headers": ["访谈对象", "角色/部门", "访谈主题", "核心问题", "时间", "负责人", "状态", "备注"],
                "data": [
                    ["", "", "背景与目标", "当前最需要确认的业务目标是什么？", "", "", "待安排", ""],
                    ["", "", "现状与痛点", "现有流程、系统或协作中最大的阻塞是什么？", "", "", "待安排", ""],
                    ["", "", "决策与下一步", "后续决策需要哪些材料、数据或参与人？", "", "", "待安排", ""],
                ],
            },
            {
                "name": "访谈记录",
                "headers": ["日期", "访谈对象", "关键观点", "风险/分歧", "待补充资料", "下一步动作", "负责人"],
                "data": [],
            },
        ]
    return [{"name": "工作表", "headers": ["事项", "说明", "负责人", "状态", "备注"], "data": []}]


def _repair_project_office_tool_input(content: str, tool_input: dict) -> tuple[dict, list[str]]:
    repaired = dict(tool_input or {})
    changes: list[str] = []
    file_type = _infer_office_file_type(content, repaired)
    if not repaired.get("file_type"):
        repaired["file_type"] = file_type
        changes.append(f"补齐文件类型：{file_type.upper()}")
    if not str(repaired.get("file_name") or "").strip():
        title_for_name = str(repaired.get("title") or content or "project-deliverable")
        repaired["file_name"] = f"{_slugify_deliverable_name(title_for_name, 'project-deliverable')}.{file_type}"
        changes.append(f"补齐文件名：{repaired['file_name']}")
    if not str(repaired.get("title") or "").strip():
        repaired["title"] = str(content or repaired["file_name"]).strip()[:80]
        changes.append("补齐标题")
    if file_type == "xlsx" and not repaired.get("sheets"):
        repaired["sheets"] = _default_xlsx_sheets_for_request(content)
        changes.append("生成默认 Excel 工作表结构")
    return repaired, changes


def _workflow_status(
    *,
    step_index: int,
    step_total: int,
    title: str,
    message: str,
    stage: str,
    status: str = "running",
) -> dict:
    return {
        "type": "status",
        "stage": stage,
        "message": message,
        "step_index": step_index,
        "step_total": step_total,
        "step_title": title,
        "step_status": status,
    }


def _workflow_status_from_task_event(task_event: dict) -> dict | None:
    step = task_event.get("step") or {}
    if not step:
        return None
    task = task_event.get("task") or {}
    steps = task.get("steps") or []
    step_total = len(steps) or int(step.get("sort_order") or 1)
    event_type = str(task_event.get("event_type") or "")
    status = "running"
    if event_type == "step_completed":
        status = "completed"
    elif event_type == "step_failed":
        status = "error"
    return _workflow_status(
        step_index=int(step.get("sort_order") or 1),
        step_total=step_total,
        title=str(step.get("title") or step.get("key") or "执行步骤"),
        stage="tools",
        status=status,
        message=str(task_event.get("message") or ""),
    )


def _task_event_time(value) -> str:
    text = str(value or "")
    if " " in text and len(text) >= 19:
        return text.split(" ", 1)[1][:8]
    if "T" in text and len(text) >= 19:
        return text.split("T", 1)[1][:8]
    return text[:8] if text else ""


def _task_event_payload_summary(payload: dict | None) -> str:
    payload = payload or {}
    details: list[str] = []
    project = payload.get("project")
    if isinstance(project, dict):
        name = str(project.get("name") or "").strip()
        client = str(project.get("client") or "").strip()
        if name or client:
            details.append(f"项目：{' / '.join(item for item in (name, client) if item)}")
    task_type = str(payload.get("task_type") or "").strip()
    if task_type:
        details.append(f"任务类型：{task_type}")
    file_type = str(payload.get("file_type") or "").strip()
    if file_type:
        details.append(f"文件类型：{file_type.upper()}")
    file_name = str(payload.get("file_name") or payload.get("name") or "").strip()
    if file_name:
        details.append(f"文件：{file_name}")
    slide_count = payload.get("slide_count")
    if isinstance(slide_count, int):
        details.append(f"页数：{slide_count}")
    sheets = payload.get("sheets")
    if isinstance(sheets, list):
        sheet_names = [
            str(sheet.get("name") if isinstance(sheet, dict) else sheet).strip()
            for sheet in sheets
        ]
        sheet_names = [name for name in sheet_names if name]
        if sheet_names:
            details.append(f"工作表：{'、'.join(sheet_names[:4])}")
    error_code = str(payload.get("error_code") or "").strip()
    if error_code:
        details.append(f"错误：{error_code}")
    if "retryable" in payload:
        details.append("可重试" if payload.get("retryable") else "不可重试")
    message = str(payload.get("message") or "").strip()
    if message:
        details.append(message)
    return "；".join(details)


def _task_event_detail(event: dict) -> str:
    prefix = _task_event_time(event.get("created_at"))
    message = str(event.get("message") or event.get("event_type") or "任务状态更新").strip()
    payload_summary = _task_event_payload_summary(event.get("payload") if isinstance(event.get("payload"), dict) else {})
    detail = f"{message}（{payload_summary}）" if payload_summary else message
    return f"[{prefix}] {detail}" if prefix else detail


def _task_step_output_details(output: dict | None) -> list[str]:
    output = output or {}
    details: list[str] = []
    project_name = str(output.get("project_name") or "").strip()
    client = str(output.get("client") or "").strip()
    if project_name or client:
        details.append(f"上下文：{' / '.join(item for item in (project_name, client) if item)}")
    file_type = str(output.get("file_type") or "").strip()
    if file_type:
        details.append(f"输出类型：{file_type.upper()}")
    file_name = str(output.get("file_name") or "").strip()
    if file_name:
        details.append(f"输出文件：{file_name}")
    title = str(output.get("title") or "").strip()
    if title:
        details.append(f"标题：{title}")
    sections_count = output.get("sections_count")
    if isinstance(sections_count, int):
        details.append(f"章节数：{sections_count}")
    slide_count = output.get("slide_count")
    if isinstance(slide_count, int):
        details.append(f"页数：{slide_count}")
    sheets = output.get("sheets")
    if isinstance(sheets, list):
        sheet_names = [
            str(sheet.get("name") if isinstance(sheet, dict) else sheet).strip()
            for sheet in sheets
        ]
        sheet_names = [name for name in sheet_names if name]
        if sheet_names:
            details.append(f"工作表：{'、'.join(sheet_names[:4])}")
    return details


def _task_payload_tool_calls(task_payload: dict) -> list[dict]:
    steps = task_payload.get("steps") or []
    events = task_payload.get("events") or []
    total = len(steps)
    status_map = {
        "completed": "completed",
        "skipped": "completed",
        "failed": "error",
        "running": "running",
        "pending": "pending",
    }
    events_by_step_id: dict[int, list[dict]] = {}
    for event in events:
        step_id = event.get("step_id") if isinstance(event, dict) else None
        if isinstance(step_id, int):
            events_by_step_id.setdefault(step_id, []).append(event)

    calls: list[dict] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        sort_order = int(step.get("sort_order") or len(calls) + 1)
        title = str(step.get("title") or step.get("key") or "执行步骤")
        status = status_map.get(str(step.get("status") or "running"), "running")
        details = _task_step_output_details(step.get("output") if isinstance(step.get("output"), dict) else {})
        step_id = step.get("id")
        if isinstance(step_id, int):
            details.extend(_task_event_detail(event) for event in events_by_step_id.get(step_id, []))
        error_message = str(step.get("error_message") or "").strip()
        calls.append(
            {
                "tool_name": f"步骤 {sort_order}/{total or sort_order}：{title}",
                "status": status,
                "message": (
                    "该步骤已完成。"
                    if status == "completed"
                    else error_message or "该步骤执行失败，请打开任务面板处理。"
                    if status == "error"
                    else "该步骤正在执行。"
                    if status == "running"
                    else "该步骤等待前序步骤完成。"
                ),
                "error": error_message if status == "error" and error_message else None,
                "details": details,
                "step_index": sort_order,
                "step_total": total or sort_order,
                "step_title": title,
            }
        )
    return calls


def _workflow_plan_events(*, step_total: int = TOOL_WORKFLOW_STEP_TOTAL) -> list[dict]:
    return [
        _workflow_status(
            step_index=1,
            step_total=step_total,
            title="判断执行方式",
            stage="planning",
            status="completed",
            message="第 1 步：已判断这是需要调用 Skill / 工具的执行型任务。",
        ),
        _workflow_status(
            step_index=2,
            step_total=step_total,
            title="准备参数与上下文",
            stage="planning",
            status="completed",
            message="第 2 步：项目上下文、历史对话和工具参数已准备。",
        ),
    ]


def prepare_chat_runtime(session: Session, req: SendMessageRequest) -> ChatRuntime:
    prepare_started_at = time.perf_counter()
    step_started_at = prepare_started_at
    prepare_metrics: dict[str, int | str] = {}
    is_portfolio_query = is_client_project_portfolio_query(req.content)
    is_workspace_inventory_query = is_workspace_project_inventory_query(req.content)

    skill = session.get(Skill, req.skill_id) if req.skill_id else None
    effective_skill_id = req.skill_id if skill and (req.force_skill or _should_apply_skill(req.content, skill)) else None
    effective_skill = skill if effective_skill_id else None
    prepare_metrics["resolve_skill_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    step_started_at = time.perf_counter()
    conv = get_or_create_conversation(
        session,
        req.conversation_id,
        project_id=req.project_id,
        skill_id=effective_skill_id,
    )
    prepare_metrics["conversation_ready_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    metadata = build_message_metadata(
        project_id=req.project_id,
        skill_id=effective_skill_id,
        rag_doc_ids=req.rag_doc_ids,
        file_ids=req.file_ids,
    )
    step_started_at = time.perf_counter()
    persist_user_message(session, conv.id, req.content, metadata)
    prepare_metrics["user_message_saved_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    max_tokens = get_int_setting(session, "max_tokens", DEFAULT_MAX_TOKENS) or DEFAULT_MAX_TOKENS
    temperature = get_float_setting(session, "temperature", DEFAULT_TEMPERATURE) or DEFAULT_TEMPERATURE

    step_started_at = time.perf_counter()
    chat_ctx = build_chat_context(
        session=session,
        skill_id=effective_skill_id,
        project_id=req.project_id,
        knowledge_scope=req.knowledge_scope,
        rag_doc_ids=req.rag_doc_ids if req.rag_doc_ids else None,
        file_ids=req.file_ids if req.file_ids else None,
        content=req.content,
        default_max_tokens=max_tokens,
    )
    expanded_query_allowed = req.project_id is None or (req.knowledge_scope or "project") != "project"
    has_client_portfolio_context = chat_ctx.project_context.startswith("# Client Project Portfolio Context") or (
        expanded_query_allowed and is_portfolio_query
    )
    has_workspace_inventory_context = chat_ctx.project_context.startswith("# Workspace Project Inventory Context") or (
        expanded_query_allowed and is_workspace_inventory_query
    )
    prepare_metrics["context_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    step_started_at = time.perf_counter()
    selected_model = get_selected_model(session)
    runtime_model, runtime_max_tokens = _resolve_runtime_model_and_tokens(
        req,
        selected_model,
        chat_ctx.max_tokens,
        effective_skill_id,
        has_deepseek_api_key=_has_deepseek_api_key(session),
        project_context=chat_ctx.project_context,
    )
    provider = resolve_provider_from_model(runtime_model)
    llm = _load_provider_module(provider)
    system = llm.build_system_prompt(
        chat_ctx.skill_prompt,
        chat_ctx.rag_context,
        chat_ctx.project_context,
    )
    prepare_metrics["model_ready_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["selected_model"] = selected_model
    prepare_metrics["runtime_model"] = runtime_model

    step_started_at = time.perf_counter()
    history = get_recent_message_history(session, conv.id, limit=CHAT_HISTORY_WINDOW)
    api_messages = [
        {"role": msg.role, "content": msg.content}
        for msg in history
        if msg.content.strip()
    ]
    if has_client_portfolio_context or has_workspace_inventory_context:
        api_messages = [{"role": "user", "content": req.content}]
    prepare_metrics["history_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["history_message_count"] = len(api_messages)
    prepare_metrics["context_mode"] = (
        "client_portfolio"
        if has_client_portfolio_context
        else "workspace_inventory"
        if has_workspace_inventory_context
        else "project" if req.project_id else "workspace_brief"
    )
    prepare_metrics["prepare_total_ms"] = round((time.perf_counter() - prepare_started_at) * 1000)

    return ChatRuntime(
        conv_id=conv.id,
        project_id=req.project_id,
        selected_model=runtime_model,
        llm=llm,
        system=system,
        api_messages=api_messages,
        rag_sources=chat_ctx.rag_sources,
        tools=chat_ctx.tools,
        max_tokens=_cap_max_tokens_for_model(runtime_model, runtime_max_tokens),
        temperature=temperature,
        skill_name=effective_skill.name if effective_skill else "",
        prepare_metrics=prepare_metrics,
    )


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


async def _task_stream_flush_pause() -> None:
    """Give browsers/proxies a short chance to paint fast task progress events."""
    await asyncio.sleep(STREAM_TASK_EVENT_PAUSE_SECONDS)


def _strip_truncation_marker(chunk: str) -> tuple[str, bool]:
    if OUTPUT_TRUNCATED_MARKER not in chunk:
        return chunk, False
    return chunk.replace(OUTPUT_TRUNCATED_MARKER, "").strip(), True


async def _iter_with_heartbeat(
    source: AsyncIterator[str],
    *,
    stage: str,
    message: str,
    seconds: float = STREAM_HEARTBEAT_SECONDS,
) -> AsyncIterator[str | dict]:
    iterator = source.__aiter__()
    pending = asyncio.create_task(iterator.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=seconds)
            if not done:
                yield {"type": "status", "stage": stage, "message": message}
                continue
            try:
                yield pending.result()
            except StopAsyncIteration:
                break
            pending = asyncio.create_task(iterator.__anext__())
    finally:
        if not pending.done():
            pending.cancel()
            try:
                await pending
            except (asyncio.CancelledError, StopAsyncIteration):
                pass


async def _await_with_heartbeat(
    awaitable,
    *,
    stage: str,
    message: str,
    seconds: float = STREAM_HEARTBEAT_SECONDS,
) -> AsyncIterator[dict]:
    task = asyncio.create_task(awaitable)
    try:
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=seconds)
            if not done:
                yield {"type": "status", "stage": stage, "message": message}
        yield {"type": "result", "result": task.result()}
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


async def stream_chat_events(runtime: ChatRuntime, req: SendMessageRequest, bind):
    stream_started_at = time.perf_counter()
    stage_timings: dict[str, int | str] = dict(runtime.prepare_metrics or {})
    first_model_event_recorded = False
    yield _sse_event({"type": "conversation_id", "id": runtime.conv_id})
    if runtime.rag_sources:
        yield _sse_event({"type": "references", "references": runtime.rag_sources})
    for metric_key in (
        "conversation_ready_ms",
        "user_message_saved_ms",
        "context_loaded_ms",
        "history_loaded_ms",
        "model_ready_ms",
        "prepare_total_ms",
    ):
        if metric_key in stage_timings:
            yield _sse_event({"type": "timing", "key": metric_key, "duration_ms": stage_timings[metric_key]})

    full_text = ""
    need_title = False
    tool_call_events = []
    artifacts = []
    pending_markdown_saves = []
    workflow_started = False

    task_route = None
    if req.project_id:
        task_route = await route_project_task_request(
            req.content,
            llm_complete=runtime.llm.complete,
            model=runtime.selected_model,
        )
    durable_task_type = task_route.task_type if task_route else None
    if durable_task_type:
        try:
            yield _sse_event(
                {
                    "type": "status",
                    "stage": "planning",
                    "message": "这需要分步骤完成，我正在准备执行计划...",
                }
            )
            await _task_stream_flush_pause()
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
                yield _sse_event({"type": "task_run", "task": task_payload})
                await _task_stream_flush_pause()
                yield _sse_event(
                    {
                        "type": "text",
                        "content": f"我会把这件事拆成几个可追踪步骤处理：{req.content}\n\n",
                    }
                )
                await _task_stream_flush_pause()
                yield _sse_event(
                    {
                        "type": "status",
                        "stage": "tools",
                        "message": "执行计划已准备好，正在开始第一步。",
                    }
                )
                await _task_stream_flush_pause()
                async for task_event in stream_execute_task_run_in_session(task_session, task.id):
                    event_message = task_event.get("message") or "任务状态已更新。"
                    workflow_event = _workflow_status_from_task_event(task_event)
                    if workflow_event:
                        yield _sse_event(workflow_event)
                        await _task_stream_flush_pause()
                    yield _sse_event(
                        {
                            "type": "status",
                            "stage": "tools",
                            "message": event_message,
                            "task_event": task_event.get("event_type"),
                        }
                    )
                    await _task_stream_flush_pause()
                    yield _sse_event({"type": "task_run", "task": task_event.get("task")})
                    await _task_stream_flush_pause()
                task_session.refresh(task)
                task_payload = serialize_task_run(task_session, task, include_events=True)

            full_text = task_run_chat_brief(task_payload)
            metadata = {
                "project_id": req.project_id,
                "task_run": task_payload,
                "task_run_id": task_payload.get("id"),
                "task_type": durable_task_type,
                "stage_timings": {
                    **stage_timings,
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
            tool_call_events = _task_payload_tool_calls(task_payload)
            if tool_call_events:
                metadata["tool_calls"] = tool_call_events
            yield _sse_event({"type": "text", "content": full_text})
            yield _sse_event({"type": "task_run", "task": task_payload})
            yield _sse_event({"type": "timing", "key": "total_stream_ms", "duration_ms": metadata["stage_timings"]["total_stream_ms"]})
            need_title = persist_assistant_message(bind, runtime.conv_id, full_text, req.content, metadata)
            yield _sse_event({"type": "done", **metadata})
            if need_title and full_text:
                schedule_title_generation(
                    conv_id=runtime.conv_id,
                    user_content=req.content,
                    bind=bind,
                    complete_fn=runtime.llm.complete,
                )
            return
        except Exception as exc:
            import traceback

            print(f"[durable_task_stream error] {exc}\n{traceback.format_exc()}", flush=True)
            yield _sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
            return

    try:
        text_buffer = ""
        tool_use_blocks = []
        reasoning_content = ""
        p1_truncated = False

        print(f"[P1] starting stream, tools={[t.get('name') for t in (runtime.tools or [])]}", flush=True)
        prepare_context_label = "\u9879\u76ee\u4e0a\u4e0b\u6587" if req.project_id else "\u5de5\u4f5c\u53f0\u6458\u8981"
        yield _sse_event(
            {
                "type": "status",
                "stage": "prepare",
                "message": f"{prepare_context_label}\u4e0e\u6700\u8fd1\u5bf9\u8bdd\u5df2\u52a0\u8f7d\uff0c\u6b63\u5728\u8bf7\u6c42\u6a21\u578b...",
            }
        )
        p1_started_at = time.perf_counter()
        yield _sse_event(
            {
                "type": "status",
                "stage": "thinking",
                "message": "\u6b63\u5728\u7406\u89e3\u4f60\u7684\u9700\u6c42\uff0c\u5e76\u51c6\u5907\u8c03\u7528\u6a21\u578b\u751f\u6210\u65b9\u6848...",
            }
        )
        if runtime.tools:
            yield _sse_event(
                {
                    "type": "status",
                    "stage": "planning",
                    "message": f"\u5df2\u52a0\u8f7d {len(runtime.tools)} \u4e2a\u53ef\u7528\u5de5\u5177\uff0c\u6b63\u5728\u5224\u65ad\u662f\u5426\u9700\u8981\u8c03\u7528\u3002",
                }
            )
        async for item in _iter_with_heartbeat(
            runtime.llm.stream_response(
                runtime.api_messages,
                system=runtime.system,
                model=runtime.selected_model,
                tools=runtime.tools,
                max_tokens=runtime.max_tokens,
                temperature=runtime.temperature,
            ),
            stage="thinking",
            message="\u6a21\u578b\u4ecd\u5728\u751f\u6210\u4e2d\uff0c\u8bf7\u7a0d\u5019...",
        ):
            if isinstance(item, dict):
                yield _sse_event(item)
                continue
            chunk = item
            if not first_model_event_recorded:
                first_model_event_recorded = True
                stage_timings["model_first_event_ms"] = round((time.perf_counter() - p1_started_at) * 1000)
                yield _sse_event({"type": "timing", "key": "model_first_event_ms", "duration_ms": stage_timings["model_first_event_ms"]})
            chunk, was_truncated = _strip_truncation_marker(chunk)
            if was_truncated:
                p1_truncated = True
                yield _sse_event(
                    {
                        "type": "status",
                        "stage": "continuing",
                        "message": "\u6a21\u578b\u8f93\u51fa\u8f83\u957f\uff0c\u5df2\u89e6\u53d1\u957f\u5ea6\u4e0a\u9650\uff0c\u6b63\u5728\u5c1d\u8bd5\u7ee7\u7eed\u751f\u6210...",
                    }
                )
                if not chunk:
                    continue
            stripped = chunk.strip()
            if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
                tool_name = stripped[12:-1]
                progress_payload = _tool_start_progress_payload(tool_name)
                if progress_payload:
                    yield _sse_event({"type": "tool_executing", "tool_name": tool_name, **progress_payload})
                continue

            mixed_tool_blocks, cleaned_chunk = _extract_tool_use_json_blocks(chunk)
            if mixed_tool_blocks:
                for block in mixed_tool_blocks:
                    print(
                        f"[P1] tool_use detected in mixed text: {block.get('name')}, id={block.get('id')}, input_keys={list((block.get('input') or {}).keys())}",
                        flush=True,
                    )
                    tool_use_blocks.append(block)
                    yield _sse_event(
                        {
                            "type": "status",
                            "stage": "tool_planned",
                            "message": f"\u6a21\u578b\u5df2\u89c4\u5212\u8c03\u7528\u5de5\u5177\uff1a{block.get('name')}",
                        }
                    )
                if cleaned_chunk:
                    text_buffer += cleaned_chunk
                    yield _sse_event({"type": "text", "content": cleaned_chunk})
                continue

            if stripped.startswith("{") and stripped.endswith("}") and '"type"' in stripped:
                try:
                    block = json.loads(stripped)
                    if block.get("type") == "tool_use":
                        print(
                            f"[P1] tool_use detected: {block.get('name')}, id={block.get('id')}, input_keys={list((block.get('input') or {}).keys())}",
                            flush=True,
                        )
                        if not first_model_event_recorded:
                            first_model_event_recorded = True
                            stage_timings["model_first_event_ms"] = round((time.perf_counter() - p1_started_at) * 1000)
                            yield _sse_event({"type": "timing", "key": "model_first_event_ms", "duration_ms": stage_timings["model_first_event_ms"]})
                        tool_use_blocks.append(block)
                        yield _sse_event(
                            {
                                "type": "status",
                                "stage": "tool_planned",
                                "message": f"\u6a21\u578b\u5df2\u89c4\u5212\u8c03\u7528\u5de5\u5177\uff1a{block.get('name')}",
                            }
                        )
                        continue
                    if block.get("type") == "reasoning_content":
                        reasoning_content = block.get("content", "")
                        continue
                except json.JSONDecodeError:
                    pass

            text_buffer += chunk
            yield _sse_event({"type": "text", "content": chunk})

        print(f"[P1] done. text_len={len(text_buffer)}, tool_use_count={len(tool_use_blocks)}", flush=True)
        stage_timings["planning_ms"] = round((time.perf_counter() - p1_started_at) * 1000)
        yield _sse_event({"type": "timing", "key": "planning_ms", "duration_ms": stage_timings["planning_ms"]})
        if p1_truncated and text_buffer.strip():
            continuation_messages = runtime.api_messages + [
                {"role": "assistant", "content": text_buffer.strip()},
                {
                    "role": "user",
                    "content": "\u8bf7\u4ece\u4e0a\u4e00\u6761\u56de\u590d\u88ab\u622a\u65ad\u7684\u4f4d\u7f6e\u7ee7\u7eed\uff0c\u8865\u9f50\u540e\u7eed\u5185\u5bb9\u548c\u5173\u952e\u8bba\u8bc1\u3002\u4e0d\u8981\u91cd\u590d\u5df2\u7ecf\u5199\u8fc7\u7684\u5185\u5bb9\uff0c\u4e0d\u8981\u8c03\u7528\u5de5\u5177\u3002",
                },
            ]
            async for item in _iter_with_heartbeat(
                runtime.llm.stream_response(
                    continuation_messages,
                    system=runtime.system,
                    model=runtime.selected_model,
                    tools=runtime.tools,
                    max_tokens=runtime.max_tokens,
                    temperature=runtime.temperature,
                ),
                stage="continuing",
                message="\u6b63\u5728\u7ee7\u7eed\u751f\u6210\u957f\u56de\u590d\uff0c\u8bf7\u7a0d\u5019...",
            ):
                if isinstance(item, dict):
                    yield _sse_event(item)
                    continue
                chunk = item
                chunk, was_truncated = _strip_truncation_marker(chunk)
                if was_truncated:
                    if chunk:
                        text_buffer += chunk
                        yield _sse_event({"type": "text", "content": chunk})
                    text_buffer += "\n\n\uff08\u5185\u5bb9\u8f83\u957f\uff0c\u5df2\u8fbe\u5230\u5355\u6b21\u56de\u590d\u957f\u5ea6\u4e0a\u9650\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u53d1\u9001\u201c\u7ee7\u7eed\u201d\uff0c\u6211\u4f1a\u4ece\u8fd9\u91cc\u63a5\u7740\u5c55\u5f00\u3002\uff09"
                    yield _sse_event(
                        {
                            "type": "text",
                            "content": "\n\n\uff08\u5185\u5bb9\u8f83\u957f\uff0c\u5df2\u8fbe\u5230\u5355\u6b21\u56de\u590d\u957f\u5ea6\u4e0a\u9650\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u53d1\u9001\u201c\u7ee7\u7eed\u201d\uff0c\u6211\u4f1a\u4ece\u8fd9\u91cc\u63a5\u7740\u5c55\u5f00\u3002\uff09",
                        }
                    )
                    break
                if not chunk:
                    continue
                text_buffer += chunk
                yield _sse_event({"type": "text", "content": chunk})

        if tool_use_blocks:
            workflow_started = True
            for workflow_event in _workflow_plan_events():
                yield _sse_event(workflow_event)
            yield _sse_event(
                _workflow_status(
                    step_index=3,
                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
                    title="执行 Skill / 工具",
                    stage="tools",
                    message="第 3 步：正在执行规划好的 Skill 或工具调用。",
                )
            )
            yield _sse_event({"type": "status", "stage": "tools", "message": "\u6a21\u578b\u5df2\u5b8c\u6210\u521d\u7a3f\u89c4\u5212\uff0c\u6b63\u5728\u6267\u884c\u6240\u9700\u5de5\u5177..."})
        elif not text_buffer.strip():
            yield _sse_event({"type": "status", "stage": "finalizing", "message": "\u6a21\u578b\u5df2\u8fd4\u56de\uff0c\u6b63\u5728\u6574\u7406\u7ed3\u679c..."})

        tool_result_blocks = []
        tools_started_at = time.perf_counter()
        for tool_data in tool_use_blocks:
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
            tool_name, tool_input = _route_ppt_tool_for_skill(runtime, tool_name, tool_input)
            tool_input = _repair_digital_strategy_ppt_tool_input(
                runtime,
                tool_name,
                tool_input,
                text_buffer,
                force_rebuild=p1_truncated,
            )
            if tool_name in _PROJECT_MARKDOWN_TOOLS and runtime.project_id is not None:
                tool_input = {**tool_input, "project_id": runtime.project_id}
            if tool_name in _PROJECT_OFFICE_TOOLS and runtime.project_id is not None:
                tool_input = {**tool_input, "project_id": runtime.project_id}
                tool_input, repaired_changes = _repair_project_office_tool_input(req.content, tool_input)
                if repaired_changes:
                    yield _sse_event(
                        _workflow_status(
                            step_index=3,
                            step_total=TOOL_WORKFLOW_STEP_TOTAL,
                            title="执行 Skill / 工具",
                            stage="tools",
                            message=f"第 3 步：已补齐文件生成参数（{'；'.join(repaired_changes)}）。",
                        )
                    )
            if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None:
                markdown_content = str(tool_input.get("content") or "").strip()
                if markdown_content:
                    if text_buffer.strip():
                        text_buffer = f"{text_buffer.rstrip()}\n\n{markdown_content}"
                        yield _sse_event({"type": "text", "content": f"\n\n{markdown_content}"})
                    else:
                        text_buffer = markdown_content
                        yield _sse_event({"type": "text", "content": markdown_content})
                write_result = None
                try:
                    write_result = await registry.execute(tool_name, tool_input)
                    pending_markdown_saves.append(
                        {
                            "tool_use_id": tool_id,
                            "project_id": runtime.project_id,
                            "file_id": tool_input.get("file_id"),
                            "file_name": tool_input.get("file_name"),
                            "mode": tool_input.get("mode"),
                            "content": markdown_content,
                            "summary": tool_input.get("summary"),
                            "folder_id": tool_input.get("folder_id"),
                            "saved": True,
                        }
                    )
                    tool_call_events.append(
                        {
                            "tool_name": tool_name,
                            "status": "completed",
                            "message": "\u5df2\u5199\u5165\u9879\u76ee Markdown \u6587\u4ef6\u3002",
                            "summary": "\u5df2\u4fdd\u5b58\u5230\u9879\u76ee Markdown \u6587\u4ef6",
                        }
                    )
                    yield _sse_event({"type": "tool_result", "result": write_result})
                except Exception as exc:
                    write_result = {
                        "type": "tool_result",
                        "tool_name": tool_name,
                        "status": "error",
                        "error": str(exc),
                    }
                    tool_call_events.append(
                        {
                            "tool_name": tool_name,
                            "status": "error",
                            "message": f"\u5199\u5165\u5931\u8d25: {exc}",
                            "summary": "\u5199\u5165\u9879\u76ee Markdown \u6587\u4ef6\u5931\u8d25",
                            "error": str(exc),
                        }
                    )
                output = write_result.get("output", write_result) if write_result else {"error": "No result"}
                tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps(output, ensure_ascii=False),
                    }
                )
                continue

            yield _sse_event({"type": "tool_executing", "tool_name": tool_name, **_tool_progress_payload(tool_name, tool_input)})

            print(f"[P2] executing tool: {tool_name}, input_keys={list(tool_input.keys())}", flush=True)
            tool_started_at = time.perf_counter()
            try:
                result = None
                async for event in _await_with_heartbeat(
                    registry.execute(tool_name, tool_input),
                    stage="tool_running",
                    message=f"{tool_name} \u6b63\u5728\u6267\u884c\u4e2d\uff0c\u6587\u4ef6\u751f\u6210\u7c7b\u4efb\u52a1\u53ef\u80fd\u9700\u8981 1-2 \u5206\u949f...",
                ):
                    if event.get("type") == "result":
                        result = event.get("result")
                    else:
                        yield _sse_event(event)
                if result is None:
                    result = {"type": "tool_result", "tool_name": tool_name, "status": "error", "error": "Tool returned no result"}
            except Exception as exc:
                result = {"type": "tool_result", "tool_name": tool_name, "status": "error", "error": str(exc)}

            print(f"[P2] tool result: status={result.get('status')}, keys={list(result.keys())}", flush=True)
            yield _sse_event({"type": "tool_result", "result": result})
            tool_duration_ms = round((time.perf_counter() - tool_started_at) * 1000)
            yield _sse_event({"type": "timing", "key": f"tool:{tool_name}", "duration_ms": tool_duration_ms})

            tool_call_events.append(
                {
                    "tool_name": tool_name,
                    "status": "error" if result.get("status") == "error" or result.get("success") is False else "completed",
                    "message": _tool_progress_payload(tool_name, tool_input).get("message", ""),
                    "summary": _summarize_tool_result(result),
                    "duration_ms": tool_duration_ms,
                    **({"error": str(result.get("error"))} if result.get("error") else {}),
                }
            )

            artifact = _extract_artifact(result)
            if artifact:
                artifacts.append(artifact)

            output = result.get("output", result)
            tool_result_blocks.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps(output, ensure_ascii=False),
                }
            )

        print(f"[P2] done. tool_result_blocks={len(tool_result_blocks)}", flush=True)
        if tool_use_blocks:
            stage_timings["tools_total_ms"] = round((time.perf_counter() - tools_started_at) * 1000)
            yield _sse_event({"type": "timing", "key": "tools_total_ms", "duration_ms": stage_timings["tools_total_ms"]})
            has_tool_error = any(event.get("status") == "error" for event in tool_call_events)
            yield _sse_event(
                _workflow_status(
                    step_index=3,
                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
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

        follow_up_text = ""
        if tool_use_blocks and tool_result_blocks:
            assistant_content: list = []
            if text_buffer.strip():
                assistant_content.append({"type": "text", "text": text_buffer.strip()})
            for tool_block in tool_use_blocks:
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
                    **({"reasoning_content": reasoning_content} if reasoning_content else {}),
                },
                {"role": "user", "content": tool_result_blocks},
            ]

            print(f"[P3] starting follow-up. continuation_messages={len(continuation_messages)}", flush=True)
            follow_up_started_at = time.perf_counter()
            yield _sse_event(
                _workflow_status(
                    step_index=4,
                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
                    title="整理最终回复",
                    stage="follow_up",
                    message="第 4 步：工具结果已返回，正在整理最终说明和交付链接。",
                )
            )
            yield _sse_event({"type": "status", "stage": "follow_up", "message": "\u5de5\u5177\u7ed3\u679c\u5df2\u8fd4\u56de\uff0c\u6b63\u5728\u751f\u6210\u6700\u7ec8\u7b54\u590d..."})
            p3_truncated = False
            p3_tool_use_blocks = []
            p3_reasoning_content = ""
            async for item in _iter_with_heartbeat(
                runtime.llm.stream_response(
                    continuation_messages,
                    system=runtime.system,
                    model=runtime.selected_model,
                    tools=runtime.tools,
                    max_tokens=runtime.max_tokens,
                    temperature=runtime.temperature,
                ),
                stage="follow_up",
                message="\u5de5\u5177\u7ed3\u679c\u5df2\u8fd4\u56de\uff0c\u6a21\u578b\u6b63\u5728\u6574\u7406\u6700\u7ec8\u7b54\u590d...",
            ):
                if isinstance(item, dict):
                    yield _sse_event(item)
                    continue
                chunk = item
                stripped = chunk.strip()

                if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
                    tool_name = stripped[12:-1]
                    progress_payload = _tool_start_progress_payload(tool_name)
                    if progress_payload:
                        yield _sse_event({"type": "tool_executing", "tool_name": tool_name, **progress_payload})
                    continue

                mixed_tool_blocks, cleaned_chunk = _extract_tool_use_json_blocks(chunk)
                if mixed_tool_blocks:
                    for block in mixed_tool_blocks:
                        print(f"[P3] tool_use detected in follow-up: {block.get('name')}, id={block.get('id')}", flush=True)
                        p3_tool_use_blocks.append(block)
                        yield _sse_event({"type": "status", "stage": "tool_planned", "message": f"\u6a21\u578b\u5df2\u89c4\u5212\u8c03\u7528\u5de5\u5177\uff1a{block.get('name')}"})
                    if cleaned_chunk:
                        follow_up_text += cleaned_chunk
                        yield _sse_event({"type": "text", "content": cleaned_chunk})
                    continue

                if stripped.startswith("{") and stripped.endswith("}") and '"type"' in stripped:
                    try:
                        block = json.loads(stripped)
                        if block.get("type") == "reasoning_content":
                            p3_reasoning_content = block.get("content", "")
                            continue
                    except json.JSONDecodeError:
                        pass

                chunk, was_truncated = _strip_truncation_marker(chunk)
                if was_truncated:
                    p3_truncated = True
                    yield _sse_event(
                        {
                            "type": "status",
                            "stage": "continuing",
                            "message": "\u6700\u7ec8\u7b54\u590d\u8f83\u957f\uff0c\u6b63\u5728\u5c1d\u8bd5\u7ee7\u7eed\u751f\u6210...",
                        }
                    )
                    if not chunk:
                        continue
                follow_up_text += chunk
                yield _sse_event({"type": "text", "content": chunk})

            p3_tool_result_blocks = []
            if p3_tool_use_blocks:
                print(f"[P3] executing {len(p3_tool_use_blocks)} detected tool_use blocks", flush=True)
                yield _sse_event({"type": "status", "stage": "tools", "message": "\u68c0\u6d4b\u5230\u540e\u7eed\u5de5\u5177\u8c03\u7528\uff0c\u6b63\u5728\u6267\u884c..."})
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
                        runtime,
                        tool_name,
                        tool_input,
                        follow_up_text,
                        force_rebuild=p3_truncated,
                    )
                    if tool_name in _PROJECT_MARKDOWN_TOOLS and runtime.project_id is not None:
                        tool_input = {**tool_input, "project_id": runtime.project_id}
                    if tool_name in _PROJECT_OFFICE_TOOLS and runtime.project_id is not None:
                        tool_input = {**tool_input, "project_id": runtime.project_id}
                        tool_input, repaired_changes = _repair_project_office_tool_input(req.content, tool_input)
                        if repaired_changes:
                            yield _sse_event(
                                _workflow_status(
                                    step_index=3,
                                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
                                    title="执行 Skill / 工具",
                                    stage="tools",
                                    message=f"第 3 步：已补齐后续文件生成参数（{'；'.join(repaired_changes)}）。",
                                )
                            )
                    if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None:
                        markdown_content = str(tool_input.get("content") or "").strip()
                        if markdown_content and markdown_content not in follow_up_text:
                            follow_up_text = f"{follow_up_text.rstrip()}\n\n{markdown_content}".strip()
                        write_result = None
                        try:
                            write_result = await registry.execute(tool_name, tool_input)
                            pending_markdown_saves.append(
                                {
                                    "tool_use_id": tool_id,
                                    "project_id": runtime.project_id,
                                    "file_id": tool_input.get("file_id"),
                                    "file_name": tool_input.get("file_name"),
                                    "mode": tool_input.get("mode"),
                                    "content": markdown_content,
                                    "summary": tool_input.get("summary"),
                                    "folder_id": tool_input.get("folder_id"),
                                    "saved": True,
                                }
                            )
                            tool_call_events.append(
                                {
                                    "tool_name": tool_name,
                                    "status": "completed",
                                    "message": "\u5df2\u5199\u5165\u9879\u76ee Markdown \u6587\u4ef6\u3002",
                                    "summary": "\u5df2\u4fdd\u5b58\u5230\u9879\u76ee Markdown \u6587\u4ef6",
                                }
                            )
                            yield _sse_event({"type": "tool_result", "result": write_result})
                        except Exception as exc:
                            write_result = {
                                "type": "tool_result",
                                "tool_name": tool_name,
                                "status": "error",
                                "error": str(exc),
                            }
                            tool_call_events.append(
                                {
                                    "tool_name": tool_name,
                                    "status": "error",
                                    "message": f"\u5199\u5165\u5931\u8d25: {exc}",
                                    "summary": "\u5199\u5165\u9879\u76ee Markdown \u6587\u4ef6\u5931\u8d25",
                                    "error": str(exc),
                                }
                            )
                        output = write_result.get("output", write_result) if write_result else {"error": "No result"}
                        p3_tool_result_blocks.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_id,
                                "content": json.dumps(output, ensure_ascii=False),
                            }
                        )
                    else:
                        try:
                            result = await registry.execute(tool_name, tool_input)
                            artifact = _extract_artifact(result)
                            if artifact:
                                artifacts.append(artifact)
                            tool_call_events.append(
                                {
                                    "tool_name": tool_name,
                                    "status": "completed",
                                    "message": f"\u5de5\u5177 {tool_name} \u6267\u884c\u5b8c\u6210\u3002",
                                    "summary": f"\u5de5\u5177 {tool_name} \u6267\u884c\u5b8c\u6210",
                                }
                            )
                            yield _sse_event({"type": "tool_result", "result": result})
                            p3_tool_result_blocks.append(
                                {
                                    "type": "tool_result",
                                    "tool_use_id": tool_id,
                                    "content": json.dumps(result.get("output", result), ensure_ascii=False),
                                }
                            )
                        except Exception as exc:
                            tool_call_events.append(
                                {
                                    "tool_name": tool_name,
                                    "status": "error",
                                    "message": f"\u5de5\u5177\u6267\u884c\u5931\u8d25: {exc}",
                                    "summary": f"\u5de5\u5177 {tool_name} \u6267\u884c\u5931\u8d25",
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
                            **({"reasoning_content": reasoning_content} if reasoning_content else {}),
                        },
                        {"role": "user", "content": tool_result_blocks},
                        {
                            "role": "assistant",
                            "content": p3_assistant_content,
                            **({"reasoning_content": p3_reasoning_content} if p3_reasoning_content else {}),
                        },
                        {"role": "user", "content": p3_tool_result_blocks},
                    ]

                    print(f"[P3] re-follow-up after tool execution. messages={len(p3_re_follow_messages)}", flush=True)
                    yield _sse_event({"type": "status", "stage": "follow_up", "message": "\u5de5\u5177\u7ed3\u679c\u5df2\u8fd4\u56de\uff0c\u6b63\u5728\u751f\u6210\u6700\u7ec8\u7b54\u590d..."})
                    re_follow_text = ""
                    async for item in _iter_with_heartbeat(
                        runtime.llm.stream_response(
                            p3_re_follow_messages,
                            system=runtime.system,
                            model=runtime.selected_model,
                            tools=runtime.tools,
                            max_tokens=runtime.max_tokens,
                            temperature=runtime.temperature,
                        ),
                        stage="follow_up",
                        message="\u5de5\u5177\u7ed3\u679c\u5df2\u8fd4\u56de\uff0c\u6a21\u578b\u6b63\u5728\u6574\u7406\u6700\u7ec8\u7b54\u590d...",
                    ):
                        if isinstance(item, dict):
                            yield _sse_event(item)
                            continue
                        chunk = item
                        chunk, was_truncated = _strip_truncation_marker(chunk)
                        if was_truncated:
                            yield _sse_event(
                                {
                                    "type": "status",
                                    "stage": "continuing",
                                    "message": "\u6700\u7ec8\u7b54\u590d\u8f83\u957f\uff0c\u6b63\u5728\u5c1d\u8bd5\u7ee7\u7eed\u751f\u6210...",
                                }
                            )
                            if not chunk:
                                continue
                        stripped_chunk = chunk.strip()
                        leaked_tool_blocks, cleaned_chunk = _extract_tool_use_json_blocks(chunk)
                        if leaked_tool_blocks:
                            for block in leaked_tool_blocks:
                                print(
                                    f"[P3] suppressed leaked tool_use in re-follow-up: {block.get('name')}, id={block.get('id')}",
                                    flush=True,
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
                        yield _sse_event({"type": "text", "content": chunk})
                    follow_up_text = re_follow_text

            if p3_truncated and follow_up_text.strip():
                p3_continuation_messages = continuation_messages + [
                    {"role": "assistant", "content": follow_up_text.strip()},
                    {
                        "role": "user",
                        "content": "\u8bf7\u4ece\u4e0a\u4e00\u6761\u6700\u7ec8\u7b54\u590d\u88ab\u622a\u65ad\u7684\u4f4d\u7f6e\u7ee7\u7eed\uff0c\u76f4\u63a5\u7eed\u5199\u6b63\u6587\uff0c\u4e0d\u8981\u91cd\u590d\u5df2\u7ecf\u5199\u8fc7\u7684\u5185\u5bb9\u3002",
                    },
                ]
                async for item in _iter_with_heartbeat(
                    runtime.llm.stream_response(
                        p3_continuation_messages,
                        system=runtime.system,
                        model=runtime.selected_model,
                        tools=runtime.tools,
                        max_tokens=runtime.max_tokens,
                        temperature=runtime.temperature,
                    ),
                    stage="continuing",
                    message="\u6700\u7ec8\u7b54\u590d\u8f83\u957f\uff0c\u6b63\u5728\u7ee7\u7eed\u751f\u6210...",
                ):
                    if isinstance(item, dict):
                        yield _sse_event(item)
                        continue
                    chunk = item
                    chunk, was_truncated = _strip_truncation_marker(chunk)
                    if was_truncated:
                        if chunk:
                            follow_up_text += chunk
                            yield _sse_event({"type": "text", "content": chunk})
                        yield _sse_event(
                            {
                                "type": "text",
                                "content": "\n\n\uff08\u5185\u5bb9\u8f83\u957f\uff0c\u5df2\u8fbe\u5230\u5355\u6b21\u56de\u590d\u957f\u5ea6\u4e0a\u9650\u3002\u4f60\u53ef\u4ee5\u7ee7\u7eed\u53d1\u9001\u201c\u7ee7\u7eed\u201d\uff0c\u6211\u4f1a\u4ece\u8fd9\u91cc\u63a5\u7740\u5c55\u5f00\u3002\uff09",
                            }
                        )
                        break
                    if not chunk:
                        continue
                    follow_up_text += chunk
                    yield _sse_event({"type": "text", "content": chunk})
            if not follow_up_text.strip() and not p3_tool_use_blocks:
                follow_up_text = "\u6a21\u578b\u6b63\u5728\u601d\u8003\u4e2d\uff0c\u5c1a\u672a\u751f\u6210\u6700\u7ec8\u7b54\u590d\u3002\u4f60\u53ef\u4ee5\u5c1d\u8bd5\u8865\u5145\u66f4\u5177\u4f53\u7684\u77eb\u6b63\u8981\u6c42\uff0c\u6216\u7a0d\u540e\u518d\u8bd5\u3002"
                yield _sse_event({"type": "text", "content": follow_up_text})

            print(f"[P3] done. follow_up_text_len={len(follow_up_text)}", flush=True)
            stage_timings["follow_up_ms"] = round((time.perf_counter() - follow_up_started_at) * 1000)
            yield _sse_event({"type": "timing", "key": "follow_up_ms", "duration_ms": stage_timings["follow_up_ms"]})
            yield _sse_event(
                _workflow_status(
                    step_index=4,
                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
                    title="整理最终回复",
                    stage="follow_up",
                    status="completed",
                    message="第 4 步：最终说明已整理完成。",
                )
            )

        full_text = text_buffer.strip()
        if follow_up_text.strip():
            full_text = (full_text + "\n\n" + follow_up_text.strip()).strip()
        if not tool_use_blocks:
            yield _sse_event({"type": "status", "stage": "finalizing", "message": "模型回复已整理完成。"})
        leaked_tool_blocks, cleaned_full_text = _extract_tool_use_json_blocks(full_text)
        if leaked_tool_blocks:
            print(f"[SAVE] suppressed {len(leaked_tool_blocks)} leaked tool_use JSON block(s) from assistant text", flush=True)
            full_text = cleaned_full_text.strip()

        if _should_auto_generate_digital_strategy_ppt(runtime, req, full_text, artifacts):
            if not workflow_started:
                workflow_started = True
                for workflow_event in _workflow_plan_events():
                    yield _sse_event(workflow_event)
            ppt_title, ppt_slides = _build_slides_from_strategy_text(full_text)
            tool_name = "generate_ppt_from_skill"
            tool_input = {
                "skill_name": "digital-strategy",
                "title": ppt_title,
                "subtitle": "\u81ea\u52a8\u6839\u636e\u6570\u5b57\u5316\u6218\u7565\u6b63\u6587\u751f\u6210",
                "slides": ppt_slides,
            }
            yield _sse_event(
                _workflow_status(
                    step_index=3,
                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
                    title="执行 Skill / 工具",
                    stage="tools",
                    message="第 3 步：检测到 Skill 没有生成 PPT，正在自动创建可下载材料。",
                )
            )
            yield _sse_event({"type": "status", "stage": "tools", "message": "\u68c0\u6d4b\u5230\u6570\u5b57\u5316\u6218\u7565 Skill \u672a\u751f\u6210 PPT\uff0c\u6b63\u5728\u81ea\u52a8\u521b\u5efa\u53ef\u4e0b\u8f7d\u6750\u6599..."})
            yield _sse_event({"type": "tool_executing", "tool_name": tool_name, **_tool_progress_payload(tool_name, tool_input)})
            print(f"[P2-fallback] executing tool: {tool_name}, slides={len(ppt_slides)}", flush=True)
            try:
                result = await registry.execute(tool_name, tool_input)
            except Exception as exc:
                result = {"type": "tool_result", "tool_name": tool_name, "status": "error", "error": str(exc)}

            yield _sse_event({"type": "tool_result", "result": result})
            tool_call_events.append(
                {
                    "tool_name": tool_name,
                    "status": "error" if result.get("status") == "error" or result.get("success") is False else "completed",
                    "message": _tool_progress_payload(tool_name, tool_input).get("message", ""),
                    "summary": _summarize_tool_result(result),
                    **({"error": str(result.get("error"))} if result.get("error") else {}),
                }
            )
            artifact = _extract_artifact(result)
            if artifact:
                artifacts.append(artifact)
            yield _sse_event({"type": "status", "stage": "follow_up", "message": "PPT \u5df2\u751f\u6210\uff0c\u6b63\u5728\u4fdd\u5b58\u6b63\u6587\u548c\u9644\u4ef6..."})

        print(f"[P4] persisting. full_text_len={len(full_text)}", flush=True)
        if workflow_started:
            yield _sse_event(
                _workflow_status(
                    step_index=4,
                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
                    title="整理结果与链接",
                    stage="saving",
                    message="第 4 步：正在保存回复、附件和项目空间链接。",
                )
            )
        yield _sse_event({"type": "status", "stage": "saving", "message": "\u6b63\u5728\u4fdd\u5b58\u672c\u6b21\u56de\u590d..."})
        save_started_at = time.perf_counter()
        response_metadata = {}
        if artifacts:
            artifacts = persist_generated_artifacts(bind, runtime.conv_id, artifacts, req.project_id)
        artifact_notice = _build_artifact_notice(artifacts) if artifacts else ""
        if not full_text and artifact_notice:
            full_text = artifact_notice
            yield _sse_event({"type": "text", "content": artifact_notice})
        elif artifact_notice and artifact_notice not in full_text:
            full_text = f"{full_text}\n\n{artifact_notice}".strip()
            yield _sse_event({"type": "text", "content": f"\n\n{artifact_notice}"})

        if not full_text:
            full_text = (
                "\u62b1\u6b49\uff0cAI \u670d\u52a1\u6682\u65f6\u672a\u80fd\u751f\u6210\u56de\u590d\u3002\u53ef\u80fd\u539f\u56e0\u5305\u62ec\uff1a\n\n"
                "1. API \u670d\u52a1\u5f53\u524d\u7e41\u5fd9\u6216\u6682\u65f6\u4e0d\u53ef\u7528\n"
                "2. \u6a21\u578b\u4e0a\u4e0b\u6587\u8fc7\u957f\uff0c\u8d85\u51fa\u5904\u7406\u9650\u5236\n"
                "3. API Key \u914d\u7f6e\u5f02\u5e38\u6216\u4f59\u989d\u4e0d\u8db3\n\n"
                "\u5efa\u8bae\u7a0d\u540e\u91cd\u8bd5\uff0c\u6216\u524d\u5f80\u300c\u8bbe\u7f6e\u300d\u68c0\u67e5 API Key \u914d\u7f6e\u3002"
            )
            print(f"[P4] WARNING: empty response detected, using fallback message", flush=True)

        metadata = {}
        if runtime.rag_sources:
            metadata["references"] = runtime.rag_sources
        if tool_call_events:
            metadata["tool_calls"] = tool_call_events
        if artifacts:
            metadata["artifacts"] = artifacts
        if pending_markdown_saves:
            metadata["pending_markdown_saves"] = pending_markdown_saves
        if req.project_id:
            metadata["project_id"] = req.project_id
        if runtime.skill_name:
            metadata["skill_id"] = req.skill_id
            metadata["skill_progress"] = _build_completed_skill_progress(tool_call_events, full_text)
        stage_timings["save_ms"] = round((time.perf_counter() - save_started_at) * 1000)
        stage_timings["total_stream_ms"] = round((time.perf_counter() - stream_started_at) * 1000)
        metadata["stage_timings"] = stage_timings
        response_metadata = metadata
        yield _sse_event({"type": "timing", "key": "save_ms", "duration_ms": stage_timings["save_ms"]})
        yield _sse_event({"type": "timing", "key": "total_stream_ms", "duration_ms": stage_timings["total_stream_ms"]})
        if workflow_started:
            yield _sse_event(
                _workflow_status(
                    step_index=4,
                    step_total=TOOL_WORKFLOW_STEP_TOTAL,
                    title="整理结果与链接",
                    stage="saving",
                    status="completed",
                    message="第 4 步：回复和生成物已保存完成。",
                )
            )

        need_title = persist_assistant_message(
            bind,
            runtime.conv_id,
            full_text,
            req.content,
            metadata or None,
        )

    except Exception as exc:
        import traceback

        print(f"[event_stream error] {exc}\n{traceback.format_exc()}", flush=True)
        yield _sse_event({"type": "error", "message": _to_user_friendly_error(str(exc))})
        return

    print(f"[chat timing] conv={runtime.conv_id} metrics={stage_timings}", flush=True)
    yield _sse_event({"type": "done", **response_metadata})

    if need_title and full_text:
        schedule_title_generation(
            conv_id=runtime.conv_id,
            user_content=req.content,
            bind=bind,
            complete_fn=runtime.llm.complete,
        )
