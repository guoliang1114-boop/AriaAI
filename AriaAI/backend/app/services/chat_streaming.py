from __future__ import annotations

import json
import asyncio
import time
from dataclasses import dataclass
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
from app.services.title_generator import schedule_title_generation
from app.tools import registry
from app.tools import project_markdown as _project_markdown  # noqa: F401 - register project Markdown tools
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME

_PROJECT_MARKDOWN_TOOLS = frozenset({PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME})


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

OUTPUT_TRUNCATED_MARKER = "[OUTPUT_TRUNCATED]"
STREAM_HEARTBEAT_SECONDS = 8.0
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
    """Keep long-output defaults aligned with provider/model limits."""
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


@dataclass
class ChatRuntime:
    conv_id: int
    selected_model: str
    llm: object
    system: str
    api_messages: list[dict]
    rag_sources: list
    tools: list | None
    max_tokens: int
    temperature: float
    project_id: int | None = None
    skill_name: str = ""
    prepare_metrics: dict | None = None


def _should_apply_skill(content: str, skill: Skill | None) -> bool:
    if not skill:
        return False
    text = (content or "").strip().lower()
    if not text:
        return False
    explicit_skill = any(token in text for token in ("@skill", "@ skills", "使用skill", "调用skill", "运行skill", "执行skill", "用这个能力", "用该能力"))
    deliverable_keywords = (
        "生成", "制作", "创建", "输出", "产出", "写一份", "做一份", "整理成", "形成", "设计", "规划", "制定",
        "完善", "重新生成", "导出", "下载", "交付", "ppt", "powerpoint", "deck", "slide", "slides",
        "报告", "方案", "材料", "路线图", "roadmap", "蓝图", "blueprint", "战略", "strategy", "计划",
    )
    casual_prefixes = (
        "为什么", "为啥", "怎么", "如何", "是否", "是不是", "能不能", "可以吗", "这个", "那个",
        "我问", "解释", "说明", "检查", "看一下", "你觉得", "what", "why", "how", "can", "could", "should",
    )
    deliverable_intent = any(token in text for token in deliverable_keywords)
    casual_question = text.startswith(casual_prefixes)
    long_template_like = len(text) > 180 and ("\n" in content or ":" in content or "：" in content)
    return explicit_skill or long_template_like or (deliverable_intent and not casual_question)


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


def _tool_progress_payload(tool_name: str, tool_input: dict) -> dict:
    if tool_name in ("generate_ppt", "generate_ppt_from_skill"):
        slides = tool_input.get("slides", [])
        title = tool_input.get("title", "Untitled")
        return {
            "message": f"Generating \"{title}\" ({len(slides)} slides)…",
            "total": len(slides),
            "current": 0,
        }
    if tool_name == "generate_docx":
        return {"message": f"Generating document \"{tool_input.get('title', 'Untitled')}\"…"}
    if tool_name == "generate_xlsx":
        return {"message": f"Generating spreadsheet ({len(tool_input.get('sheets', []))} sheets)…"}
    if tool_name == "generate_pdf":
        return {"message": f"Generating PDF \"{tool_input.get('title', 'Untitled')}\"…"}
    return {"message": f"Executing {tool_name}…"}


def _tool_start_progress_payload(tool_name: str) -> dict | None:
    if tool_name in ("generate_ppt", "generate_ppt_from_skill"):
        return {"message": "Generating slides... (this may take 1-2 minutes)"}
    if tool_name == PROJECT_MARKDOWN_TOOL_NAME:
        return {"message": "正在写入项目 Markdown 文件..."}
    if tool_name == READ_MARKDOWN_TOOL_NAME:
        return {"message": "正在读取项目文档…"}
    if tool_name == "generate_docx":
        return {"message": "Generating document..."}
    if tool_name == "generate_xlsx":
        return {"message": "Generating spreadsheet..."}
    if tool_name == "generate_pdf":
        return {"message": "Generating PDF..."}
    return {"message": f"Executing {tool_name}..."}


def _to_user_friendly_error(error_msg: str) -> str:
    if "429" in error_msg or "engine_overloaded" in error_msg:
        return "AI 服务当前繁忙，请稍后重试。这是临时状况，几秒钟后再试即可。"
    if "Kimi 服务当前繁忙" in error_msg or "BigModel 服务当前繁忙" in error_msg:
        return error_msg
    if "No Kimi API key" in error_msg or "No Claude API key" in error_msg or "No BigModel API key" in error_msg or "No MiMo API key" in error_msg:
        return "请先配置 API Key。前往「设置」页面添加您的 API Key。"
    if "timeout" in error_msg.lower() or "Connection refused" in error_msg:
        return "连接超时，请检查网络或稍后重试。"
    if "rate limit" in error_msg.lower():
        return "请求频率过高，请稍等片刻后重试。"
    return error_msg


def _extract_artifact(result: dict) -> dict | None:
    source = result
    if not (result.get("file_path") or result.get("path")) and isinstance(result.get("output"), dict):
        source = result["output"]

    artifact_path = source.get("file_path") or source.get("path")
    artifact_name = source.get("file_name") or source.get("name")
    artifact_type = source.get("file_type")
    if not artifact_path or not artifact_name or not artifact_type:
        return None

    return {
        "name": artifact_name,
        "file_type": artifact_type,
        "path": artifact_path,
        "description": source.get("note") or source.get("message") or source.get("description") or "",
    }


def _build_artifact_notice(artifacts: list[dict]) -> str:
    names = "、".join(str(item.get("name")) for item in artifacts if item.get("name"))
    if not names:
        return "已生成附件，可在本条回复中的下载卡片里直接下载。"
    return f"已生成附件：{names}。可在本条回复中的下载卡片里直接下载。"


def _summarize_tool_result(result: dict) -> str:
    if result.get("error"):
        return str(result.get("error"))
    if result.get("file_name"):
        return f"Created {result.get('file_name')}"
    if result.get("message"):
        return str(result.get("message"))
    if result.get("success") is True:
        return "Completed successfully"
    return ""


def _build_completed_skill_progress(tool_call_events: list[dict], full_text: str) -> list[dict]:
    tool_logs = []
    if tool_call_events:
        for event in tool_call_events:
            status = "完成" if event.get("status") == "completed" else "失败"
            message = event.get("summary") or event.get("message") or event.get("tool_name") or "工具执行"
            tool_logs.append(f"{status}: {message}")
    else:
        tool_logs.append("本次未调用文件生成工具，模型直接生成正文结果。")

    return [
        {
            "key": "prepare",
            "label": "准备上下文",
            "description": "整理会话、项目与 Skill 信息",
            "status": "done",
            "logs": ["已准备会话、项目与 Skill 上下文。"],
        },
        {
            "key": "thinking",
            "label": "模型规划",
            "description": "分析需求并判断是否需要调用工具",
            "status": "done",
            "logs": ["模型已完成需求理解与执行规划。"],
        },
        {
            "key": "tools",
            "label": "执行工具",
            "description": "生成 PPT / 文档 / 表格等交付物",
            "status": "done",
            "logs": tool_logs,
        },
        {
            "key": "final",
            "label": "整理答复",
            "description": "汇总工具结果并形成最终回复",
            "status": "done",
            "logs": [f"最终答复已生成，正文长度约 {len(full_text)} 字。"],
        },
        {
            "key": "saving",
            "label": "保存结果",
            "description": "保存回复与生成的附件",
            "status": "done",
            "logs": ["正在保存本次回复...", "回复已保存，执行完成。"],
        },
    ]


def _has_ppt_artifact(artifacts: list[dict]) -> bool:
    return any(str(item.get("file_type") or "").lower() == "pptx" for item in artifacts)


def _should_auto_generate_digital_strategy_ppt(
    runtime: ChatRuntime,
    req: SendMessageRequest,
    full_text: str,
    artifacts: list[dict],
) -> bool:
    if not req.skill_id or not full_text.strip():
        return False
    if _has_ppt_artifact(artifacts):
        return False
    return _is_digital_strategy_runtime(runtime)


def _is_digital_strategy_runtime(runtime: ChatRuntime) -> bool:
    text = f"{runtime.skill_name or ''}\n{runtime.system or ''}".lower()
    markers = (
        "digital-strategy",
        "数字化战略",
        "数字化转型战略",
        "数字化赋能",
        "数字化成熟度",
        "kimi_agent_数字化",
    )
    return any(marker in text for marker in markers)


def _looks_like_digital_strategy_tool_input(tool_input: dict) -> bool:
    text = json.dumps(tool_input, ensure_ascii=False).lower()
    markers = (
        "digital-strategy",
        "数字化战略",
        "数字化转型",
        "digital transformation",
        "digital strategy",
        "three-horizon",
        "horizon",
        "maturity",
    )
    return any(marker in text for marker in markers)


def _route_ppt_tool_for_skill(runtime: ChatRuntime, tool_name: str, tool_input: dict) -> tuple[str, dict]:
    """Force digital-strategy PPT generation through its Skill template."""
    should_route = _is_digital_strategy_runtime(runtime) or _looks_like_digital_strategy_tool_input(tool_input)
    if tool_name not in {"generate_ppt", "generate_ppt_from_skill"} or not should_route:
        return tool_name, tool_input
    routed_input = dict(tool_input)
    routed_input["skill_name"] = "digital-strategy"
    return "generate_ppt_from_skill", routed_input


def _repair_digital_strategy_ppt_tool_input(
    runtime: ChatRuntime,
    tool_name: str,
    tool_input: dict,
    source_text: str,
    force_rebuild: bool = False,
) -> dict:
    """DeepSeek can emit a tool call with empty/partial args after long planning."""
    if tool_name != "generate_ppt_from_skill" or not _is_digital_strategy_runtime(runtime):
        return tool_input

    title = str(tool_input.get("title") or "").strip()
    slides = tool_input.get("slides")
    if title and isinstance(slides, list) and slides and not force_rebuild:
        return tool_input

    fallback_title, fallback_slides = _build_slides_from_strategy_text(source_text)
    repaired = dict(tool_input)
    repaired["skill_name"] = "digital-strategy"
    if not title:
        repaired["title"] = fallback_title
    if force_rebuild or not isinstance(slides, list) or not slides:
        repaired["slides"] = fallback_slides
    if not str(repaired.get("subtitle") or "").strip():
        repaired["subtitle"] = "Generated from the digital strategy response"
    return repaired


def _clean_slide_line(line: str) -> str:
    cleaned = line.strip()
    cleaned = cleaned.lstrip("-*• ").strip()
    import re

    return re.sub(r"^\d{1,2}[.、)）]\s*", "", cleaned).strip()


def _build_slides_from_strategy_text(full_text: str) -> tuple[str, list[dict]]:
    lines = [line.strip() for line in full_text.splitlines() if line.strip()]
    title = "数字化战略方案"
    for line in lines[:10]:
        cleaned = line.strip("# ").strip()
        if (
            cleaned
            and len(cleaned) <= 60
            and not cleaned.startswith(">")
            and not cleaned[:1].isdigit()
            and not cleaned.startswith(("-", "*", "•"))
            and ("方案" in cleaned or "战略" in cleaned or "转型" in cleaned)
        ):
            title = cleaned
            break

    sections: list[tuple[str, list[str]]] = []
    current_title = ""
    current_lines: list[str] = []
    for line in lines:
        normalized = line.strip()
        heading = ""
        if normalized.startswith("#"):
            heading = normalized.strip("# ").strip()
        elif len(normalized) <= 40 and (
            normalized[:2] in ("一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、")
            or normalized.lower().startswith(("executive", "strategic", "digital", "gap", "transformation", "governance"))
        ):
            heading = normalized

        if heading:
            if current_title:
                sections.append((current_title, current_lines))
            current_title = heading
            current_lines = []
        elif current_title:
            cleaned = _clean_slide_line(normalized)
            if cleaned:
                current_lines.append(cleaned)
    if current_title:
        sections.append((current_title, current_lines))

    parsed_sections_from_text = bool(sections)
    if not sections:
        chunks = ["\n".join(lines[i : i + 8]) for i in range(0, min(len(lines), 56), 8)]
        sections = [(f"核心内容 {index + 1}", chunk.splitlines()) for index, chunk in enumerate(chunks)]

    slides: list[dict] = []
    for section_title, content_lines in sections[:14]:
        bullets = [item for item in content_lines if item and item != section_title][:8]
        if not bullets:
            bullets = ["详见战略正文。"]
        slides.append(
            {
                "type": "content",
                "title": section_title[:80],
                "content": "\n".join(f"- {bullet[:160]}" for bullet in bullets),
            }
        )

    if len(slides) < 16 and not parsed_sections_from_text:
        fallback_plan = [
            (
                "Executive Summary",
                "- Strategic thesis: digital transformation must be anchored in business value, not system replacement\n- Value ambition: define growth, efficiency and risk-control targets before solution design\n- Priority moves: focus first on data foundation, customer/operations use cases and governance cadence\n- Leadership decisions: confirm scope, funding envelope, owners and first-wave pilots\n- Success condition: every initiative must map to a measurable business KPI",
            ),
            (
                "Strategic Context and Transformation Thesis",
                "- Market pressure: customers, competitors and regulators are raising expectations for speed and transparency\n- Internal pressure: fragmented processes and data reduce decision quality and execution pace\n- Opportunity window: AI, cloud and workflow automation can now unlock cross-functional productivity\n- Transformation thesis: build reusable capabilities instead of isolated digital projects\n- Management implication: treat digital as a portfolio of value bets with quarterly steering",
            ),
            (
                "Current Digital Maturity Diagnosis",
                "- Strategy: assess whether digital priorities are explicitly linked to business goals and budget choices\n- Customer: review journey coverage, channel integration and customer data completeness\n- Operations: identify manual handoffs, duplicated approvals and automation bottlenecks\n- Organization: test decision rights, product ownership, agile adoption and digital talent depth\n- Data and technology: score governance, architecture modularity, API maturity and legacy constraints",
            ),
            (
                "Pain Point Root Causes",
                "- Process pain points often come from unclear ownership, not only missing systems\n- Data pain points usually reflect weak master data, inconsistent definitions and low accountability\n- Technology pain points come from point-to-point integration and customized legacy platforms\n- Adoption pain points come from incentives and training gaps rather than tool availability\n- Root-cause view should separate symptoms, structural causes and required management actions",
            ),
            (
                "Digital Vision and Target Ambition",
                "- Vision: become a data-driven enterprise where decisions, operations and customer engagement are continuously optimized\n- North-star metrics: revenue uplift, operating-cost reduction, cycle-time compression and risk reduction\n- Target ambition: move priority domains from L2/L3 maturity to L4 managed capability within 3 years\n- Design principle: standardize core platforms while allowing business-led innovation at the edge\n- Leadership implication: align ambition to funding and talent capacity before roadmap approval",
            ),
            (
                "Capability Blueprint",
                "- Customer intelligence: unified profiles, segmentation, journey orchestration and next-best-action triggers\n- Digital operations: workflow automation, exception management, process mining and SLA visibility\n- Data foundation: master data, data quality rules, governance roles and analytics-ready data products\n- AI decision support: forecasting, recommendation, knowledge retrieval and assisted execution\n- Platform architecture: API integration, cloud-native services, security controls and reusable components",
            ),
            (
                "Use-Case Portfolio",
                "- Growth use cases: precision marketing, sales productivity, retention prediction and pricing optimization\n- Efficiency use cases: automated reporting, workflow routing, demand planning and service operations\n- Risk use cases: compliance monitoring, anomaly detection, access governance and early-warning dashboards\n- Employee use cases: knowledge assistant, document generation, training recommendation and expert matching\n- Portfolio rule: balance quick wins, foundation enablers and strategic differentiators",
            ),
            (
                "Gap Prioritization Matrix",
                "- Quick wins: high value, low complexity and visible within 90-180 days\n- Foundations: data, architecture and governance enablers required before scaled rollout\n- Differentiators: capabilities that create customer, cost or ecosystem advantage\n- Defer items: low-value automation or technology experiments without business sponsorship\n- Decision rule: prioritize by value, feasibility, dependency and change readiness",
            ),
            (
                "Three-Horizon Roadmap",
                "- Horizon 1 Foundation: stabilize data, launch pilots, set governance and prove value\n- Horizon 2 Scale: extend validated use cases across business units and integrate platforms\n- Horizon 3 Lead: build AI-native operations, ecosystem integration and continuous innovation loops\n- Roadmap dependency: do not scale AI or advanced analytics before data ownership is working\n- Review cadence: quarterly value review and semi-annual roadmap refresh",
            ),
            (
                "Initiative Portfolio and Milestones",
                "- Each initiative should define owner, value KPI, user group, data dependency and delivery milestone\n- Year 1 milestones: maturity baseline, data governance launch, 3-5 pilots and first value dashboard\n- Year 2 milestones: platform integration, scaled workflows, business-unit rollout and talent academy\n- Year 3 milestones: AI operating model, ecosystem collaboration and continuous optimization\n- Governance checkpoint: stop, scale or redesign initiatives based on measured adoption and value",
            ),
            (
                "Target Operating Model",
                "- Steering committee owns priorities, funding trade-offs and cross-functional escalation\n- Transformation PMO manages portfolio rhythm, benefits tracking and dependency resolution\n- Product owners translate business pain points into roadmaps and adoption plans\n- Data owners govern definitions, quality, access and lifecycle management\n- Technology teams provide reusable platforms, standards and security guardrails",
            ),
            (
                "Investment and Business Case",
                "- Investment envelope should cover technology, data, talent, change and partner support\n- Suggested split: 40% technology, 30% talent/change, 20% data, 10% ecosystem experimentation\n- Benefit pools: revenue uplift, working-capital improvement, cost reduction and risk avoidance\n- Stage-gate funding: release scale investment only after pilots prove adoption and KPI movement\n- CFO view: present base, upside and downside cases with explicit assumptions",
            ),
            (
                "KPI Dashboard",
                "- Business KPIs: revenue conversion, retention, gross margin, cycle time, service cost and risk incidents\n- Adoption KPIs: active users, workflow coverage, automation rate and decision usage frequency\n- Data KPIs: completeness, accuracy, timeliness, ownership coverage and issue resolution SLA\n- Delivery KPIs: milestone hit rate, dependency closure, budget burn and value realization\n- Review mechanism: monthly PMO dashboard and quarterly executive value review",
            ),
            (
                "Risk Controls",
                "- Legacy risk: integration complexity, hidden customization and migration downtime\n- Data risk: inconsistent definitions, privacy exposure and weak ownership\n- Adoption risk: low frontline usage, insufficient incentives and training fatigue\n- Vendor risk: lock-in, unclear accountability and capability transfer gaps\n- Mitigation: phased rollout, architecture guardrails, change champions and exit criteria",
            ),
            (
                "90-Day Action Plan",
                "- Week 1-2: confirm ambition, scope, sponsor, decision forum and baseline assumptions\n- Week 3-5: run leadership interviews, maturity assessment and data/platform diagnostic\n- Week 6-8: prioritize use cases, estimate benefits and define first-wave pilots\n- Week 9-11: design operating model, investment case, KPI dashboard and roadmap dependencies\n- Week 12: align steering committee on launch plan, funding and owners",
            ),
            (
                "Appendix: Assessment and Interview Guide",
                "- Interview executives on strategic priorities, pain points, decision bottlenecks and value ambition\n- Interview business owners on process friction, customer impact and adoption barriers\n- Interview IT/data teams on architecture, data quality, security and integration constraints\n- Collect evidence: KPI baselines, process maps, system inventory, data dictionary and project portfolio\n- Use findings to replace assumptions in the next deck version",
            ),
        ]
        existing = {slide["title"] for slide in slides}
        for fallback_title, fallback_content in fallback_plan:
            if fallback_title not in existing:
                slides.append(
                    {
                        "type": "content",
                        "title": fallback_title,
                        "content": fallback_content,
                    }
                )
            if len(slides) >= 16:
                break

    return title, slides


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


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
    """Keep SSE alive while waiting for slow provider chunks."""
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
    """Yield heartbeat events until a long-running tool awaitable completes."""
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

    try:
        text_buffer = ""
        tool_use_blocks = []
        reasoning_content = ""
        p1_truncated = False

        print(f"[P1] starting stream, tools={[t.get('name') for t in (runtime.tools or [])]}", flush=True)
        prepare_context_label = "项目上下文" if req.project_id else "工作台摘要"
        yield _sse_event(
            {
                "type": "status",
                "stage": "prepare",
                "message": f"{prepare_context_label}与最近对话已加载，正在请求模型...",
            }
        )
        p1_started_at = time.perf_counter()
        yield _sse_event(
            {
                "type": "status",
                "stage": "thinking",
                "message": "正在理解你的需求，并准备调用模型生成方案...",
            }
        )
        if runtime.tools:
            yield _sse_event(
                {
                    "type": "status",
                    "stage": "planning",
                    "message": f"已加载 {len(runtime.tools)} 个可用工具，正在判断是否需要调用。",
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
            message="模型仍在生成中，请稍候...",
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
                        "message": "模型输出较长，已触发长度上限，正在尝试继续生成...",
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
                                "message": f"模型已规划调用工具：{block.get('name')}",
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
                    "content": "请从上一条回复被截断的位置继续，补齐后续内容和关键论证。不要重复已经写过的内容，不要调用工具。",
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
                message="正在继续生成长回复，请稍候...",
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
                    text_buffer += "\n\n（内容较长，已达到单次回复长度上限。你可以继续发送“继续”，我会从这里接着展开。）"
                    yield _sse_event(
                        {
                            "type": "text",
                            "content": "\n\n（内容较长，已达到单次回复长度上限。你可以继续发送“继续”，我会从这里接着展开。）",
                        }
                    )
                    break
                if not chunk:
                    continue
                text_buffer += chunk
                yield _sse_event({"type": "text", "content": chunk})

        if tool_use_blocks:
            yield _sse_event({"type": "status", "stage": "tools", "message": "模型已完成初稿规划，正在执行所需工具..."})
        elif not text_buffer.strip():
            yield _sse_event({"type": "status", "stage": "finalizing", "message": "模型已返回，正在整理结果..."})

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
            if tool_name == PROJECT_MARKDOWN_TOOL_NAME and runtime.project_id is not None:
                markdown_content = str(tool_input.get("content") or "").strip()
                if markdown_content:
                    if text_buffer.strip():
                        text_buffer = f"{text_buffer.rstrip()}\n\n{markdown_content}"
                        yield _sse_event({"type": "text", "content": f"\n\n{markdown_content}"})
                    else:
                        text_buffer = markdown_content
                        yield _sse_event({"type": "text", "content": markdown_content})
                # Directly execute the write instead of pending for confirmation
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
                            "message": "已写入项目 Markdown 文件。",
                            "summary": "已保存到项目 Markdown 文件",
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
                            "message": f"写入失败: {exc}",
                            "summary": "写入项目 Markdown 文件失败",
                            "error": str(exc),
                        }
                    )
                # CRITICAL FIX: Add tool result to tool_result_blocks so P3 follow-up works
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
                    message=f"{tool_name} 正在执行中，文件生成类任务可能需要 1-2 分钟...",
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
            yield _sse_event({"type": "status", "stage": "follow_up", "message": "工具结果已返回，正在生成最终答复..."})
            p3_truncated = False
            p3_tool_use_blocks = []
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
                message="工具结果已返回，模型正在整理最终答复...",
            ):
                if isinstance(item, dict):
                    yield _sse_event(item)
                    continue
                chunk = item
                stripped = chunk.strip()

                # Detect [TOOL_START:...] markers from stream_response
                if stripped.startswith("[TOOL_START:") and stripped.endswith("]"):
                    tool_name = stripped[12:-1]
                    progress_payload = _tool_start_progress_payload(tool_name)
                    if progress_payload:
                        yield _sse_event({"type": "tool_executing", "tool_name": tool_name, **progress_payload})
                    continue

                # Detect tool_use JSON blocks (Claude sometimes outputs these as plain text in follow-up)
                if '"type"' in stripped and '"tool_use"' in stripped:
                    block = None
                    if stripped.startswith("{") and stripped.endswith("}"):
                        try:
                            block = json.loads(stripped)
                        except json.JSONDecodeError:
                            block = None
                    if block is None:
                        block = _try_extract_tool_use_json(stripped)
                    if block and block.get("type") == "tool_use":
                        print(f"[P3] tool_use detected in follow-up: {block.get('name')}, id={block.get('id')}", flush=True)
                        p3_tool_use_blocks.append(block)
                        yield _sse_event({"type": "status", "stage": "tool_planned", "message": f"模型已规划调用工具：{block.get('name')}"})
                        continue

                chunk, was_truncated = _strip_truncation_marker(chunk)
                if was_truncated:
                    p3_truncated = True
                    yield _sse_event(
                        {
                            "type": "status",
                            "stage": "continuing",
                            "message": "最终答复较长，正在尝试继续生成...",
                        }
                    )
                    if not chunk:
                        continue
                follow_up_text += chunk
                yield _sse_event({"type": "text", "content": chunk})

            # Execute any tool_use blocks detected during P3 follow-up
            p3_tool_result_blocks = []
            if p3_tool_use_blocks:
                print(f"[P3] executing {len(p3_tool_use_blocks)} detected tool_use blocks", flush=True)
                yield _sse_event({"type": "status", "stage": "tools", "message": "检测到后续工具调用，正在执行..."})
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
                    if tool_name in _PROJECT_MARKDOWN_TOOLS and runtime.project_id is not None:
                        tool_input = {**tool_input, "project_id": runtime.project_id}
                    # Handle markdown write tool (most common P3 scenario)
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
                                    "message": "已写入项目 Markdown 文件。",
                                    "summary": "已保存到项目 Markdown 文件",
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
                                    "message": f"写入失败: {exc}",
                                    "summary": "写入项目 Markdown 文件失败",
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
                        # Other tools: simple execution
                        try:
                            result = await registry.execute(tool_name, tool_input)
                            tool_call_events.append(
                                {
                                    "tool_name": tool_name,
                                    "status": "completed",
                                    "message": f"工具 {tool_name} 执行完成。",
                                    "summary": f"工具 {tool_name} 执行完成",
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

                # Re-follow-up: send tool_results back to model so it can generate a proper final response
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
                        {"role": "assistant", "content": p3_assistant_content},
                        {"role": "user", "content": p3_tool_result_blocks},
                    ]

                    print(f"[P3] re-follow-up after tool execution. messages={len(p3_re_follow_messages)}", flush=True)
                    yield _sse_event({"type": "status", "stage": "follow_up", "message": "工具结果已返回，正在生成最终答复..."})
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
                        message="工具结果已返回，模型正在整理最终答复...",
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
                                    "message": "最终答复较长，正在尝试继续生成...",
                                }
                            )
                            if not chunk:
                                continue
                        re_follow_text += chunk
                        yield _sse_event({"type": "text", "content": chunk})
                    follow_up_text = re_follow_text

            if p3_truncated and follow_up_text.strip():
                p3_continuation_messages = continuation_messages + [
                    {"role": "assistant", "content": follow_up_text.strip()},
                    {
                        "role": "user",
                        "content": "请从上一条最终答复被截断的位置继续，直接续写正文，不要重复已经写过的内容。",
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
                    message="最终答复较长，正在继续生成...",
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
                        # 截断提示只 yield 给前端，不保存到数据库
                        yield _sse_event(
                            {
                                "type": "text",
                                "content": "\n\n（内容较长，已达到单次回复长度上限。你可以继续发送“继续”，我会从这里接着展开。）",
                            }
                        )
                        break
                    if not chunk:
                        continue
                    follow_up_text += chunk
                    yield _sse_event({"type": "text", "content": chunk})
            print(f"[P3] done. follow_up_text_len={len(follow_up_text)}", flush=True)
            stage_timings["follow_up_ms"] = round((time.perf_counter() - follow_up_started_at) * 1000)
            yield _sse_event({"type": "timing", "key": "follow_up_ms", "duration_ms": stage_timings["follow_up_ms"]})

        full_text = text_buffer.strip()
        if follow_up_text.strip():
            full_text = (full_text + "\n\n" + follow_up_text.strip()).strip()

        if _should_auto_generate_digital_strategy_ppt(runtime, req, full_text, artifacts):
            ppt_title, ppt_slides = _build_slides_from_strategy_text(full_text)
            tool_name = "generate_ppt_from_skill"
            tool_input = {
                "skill_name": "digital-strategy",
                "title": ppt_title,
                "subtitle": "自动根据数字化战略正文生成",
                "slides": ppt_slides,
            }
            yield _sse_event({"type": "status", "stage": "tools", "message": "检测到数字化战略 Skill 未生成 PPT，正在自动创建可下载材料..."})
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
            yield _sse_event({"type": "status", "stage": "follow_up", "message": "PPT 已生成，正在保存正文和附件..."})

        print(f"[P4] persisting. full_text_len={len(full_text)}", flush=True)
        yield _sse_event({"type": "status", "stage": "saving", "message": "正在保存本次回复..."})
        save_started_at = time.perf_counter()
        response_metadata = {}
        if artifacts:
            artifacts = persist_generated_artifacts(bind, runtime.conv_id, artifacts, req.project_id)
        artifact_notice = _build_artifact_notice(artifacts) if artifacts else ""
        if not full_text and artifact_notice:
            full_text = artifact_notice
        elif artifact_notice and artifact_notice not in full_text:
            full_text = f"{full_text}\n\n{artifact_notice}".strip()

        if not full_text:
            full_text = (
                "抱歉，AI 服务暂时未能生成回复。可能原因包括：\n\n"
                "1. API 服务当前繁忙或暂时不可用\n"
                "2. 模型上下文过长，超出处理限制\n"
                "3. API Key 配置异常或余额不足\n\n"
                "建议稍后重试，或前往「设置」检查 API Key 配置。"
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
