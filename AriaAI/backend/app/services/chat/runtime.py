"""Chat runtime preparation — builds the immutable ``ChatRuntime`` object used by all phases."""
from __future__ import annotations

import os
import time

from sqlmodel import Session

from app.config import DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE
from app.models.db import Skill
from app.models.db import Setting as _Setting
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_store import (
    build_message_metadata,
    get_recent_message_history,
    get_or_create_conversation,
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
from app.services.chat_tools import ChatRuntime

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
CHAT_HISTORY_WINDOW = 24
STANDALONE_FAST_PATH_MODEL = "moonshot-v1-8k"
STANDALONE_FAST_PATH_MAX_TOKENS = 1536
STANDALONE_CHAT_MAX_TOKENS = 2048
CLIENT_PORTFOLIO_FAST_MODEL = "deepseek-v4-flash"
CLIENT_PORTFOLIO_MAX_TOKENS = 4096
WORKSPACE_INVENTORY_MAX_TOKENS = 6144


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _has_deepseek_api_key(session: Session) -> bool:
    setting = session.get(_Setting, "deepseek_api_key")
    if setting and setting.value.strip():
        return True
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

    explicit_skill = any(
        token in text
        for token in (
            "@skill", "@ skills", "使用skill", "调用skill", "运行skill", "执行skill",
            "用这个能力", "用该能力",
        )
    )

    deliverable_keywords = (
        "生成", "制作", "创建", "输出", "产出", "写一份", "做一份", "整理成", "形成", "设计", "规划", "制定",
        "完善", "重新生成", "导出", "下载", "交付", "ppt", "powerpoint", "deck", "slide", "slides",
        "excel", "xlsx", "xls", "word", "docx", "pdf", "表格", "工作簿", "文档", "文件",
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


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def prepare_chat_runtime(session: Session, req: SendMessageRequest) -> ChatRuntime:
    """Build a fully-populated ``ChatRuntime`` from a user request.

    Steps performed:
    1. Resolve effective skill (if any).
    2. Get or create conversation.
    3. Persist user message.
    4. Build chat context (project / workspace / RAG).
    5. Resolve model & provider.
    6. Build system prompt & API message history.
    """
    prepare_started_at = time.perf_counter()
    step_started_at = prepare_started_at
    prepare_metrics: dict[str, int | str] = {}

    is_portfolio_query = is_client_project_portfolio_query(req.content)
    is_workspace_inventory_query = is_workspace_project_inventory_query(req.content)

    # 1. Skill resolution
    skill = session.get(Skill, req.skill_id) if req.skill_id else None
    effective_skill_id = req.skill_id if skill and (req.force_skill or _should_apply_skill(req.content, skill)) else None
    effective_skill = skill if effective_skill_id else None
    prepare_metrics["resolve_skill_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 2. Conversation
    step_started_at = time.perf_counter()
    conv = get_or_create_conversation(
        session,
        req.conversation_id,
        project_id=req.project_id,
        skill_id=effective_skill_id,
    )
    prepare_metrics["conversation_ready_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 3. Persist user message
    metadata = build_message_metadata(
        project_id=req.project_id,
        skill_id=effective_skill_id,
        rag_doc_ids=req.rag_doc_ids,
        file_ids=req.file_ids,
    )
    step_started_at = time.perf_counter()
    persist_user_message(session, conv.id, req.content, metadata)
    prepare_metrics["user_message_saved_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 4. Settings & context
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
        mention_context=req.mention_context.model_dump() if req.mention_context else None,
    )
    expanded_query_allowed = req.project_id is None or (req.knowledge_scope or "project") != "project"
    has_client_portfolio_context = chat_ctx.project_context.startswith("# Client Project Portfolio Context") or (
        expanded_query_allowed and is_portfolio_query
    )
    has_workspace_inventory_context = chat_ctx.project_context.startswith("# Workspace Project Inventory Context") or (
        expanded_query_allowed and is_workspace_inventory_query
    )
    prepare_metrics["context_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 5. Model & provider resolution
    step_started_at = time.perf_counter()
    selected_model = get_selected_model(session)
    user_model = (req.model or "").strip()
    if user_model:
        model_lower = user_model.lower()
        known_prefixes = ("claude-", "kimi-", "moonshot-", "deepseek-", "glm-", "mimo-")
        if any(model_lower.startswith(p) for p in known_prefixes):
            selected_model = user_model

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

    # 6. Message history
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
        else "project"
        if req.project_id
        else "workspace_brief"
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
