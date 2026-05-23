"""Chat runtime preparation — builds the immutable ``ChatRuntime`` object used by all phases."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from dataclasses import replace

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
)
from app.services.provider_selector import (
    _load_provider_module,
    get_selected_model,
    resolve_provider_from_model,
)
from app.services.settings_helper import get_float_setting, get_int_setting
from app.services.chat_tools import ChatRuntime
from app.services.chat.mode_registry import ActionPolicy, ChatMode, MODE_CONFIG, ToolAccessPolicy
from app.services.intent_router import IntentDecision, classify_chat_intent, classify_chat_intent_async
from app.services.policy_guards import filter_tools_for_access

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
SHORT_CONFIRMATION_TERMS = (
    "执行",
    "确认",
    "确定",
    "按你的要求",
    "按你说的",
    "就这样",
    "可以",
    "继续",
    "do it",
    "confirm",
    "proceed",
    "go ahead",
)
DELETION_PLAN_MARKERS = (
    "删除清单",
    "待删除",
    "删除文件",
    "清理清单",
    "file_id",
    "file ids",
)

# Cheap model used exclusively by the IntentRouter.
# DeepSeek is preferred because it is fast, cheap, and good enough for
# enum classification (chat_mode + action_policy).
INTENT_ROUTER_MODEL = "deepseek-chat"
INTENT_ROUTER_MAX_TOKENS = 500
INTENT_ROUTER_TEMPERATURE = 0


@dataclass(frozen=True)
class SkillActivationDecision:
    """Structured decision for applying a selected Skill to the current turn."""

    apply: bool
    reason: str
    confidence: float = 0.0


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


def _is_standalone_fast_path(req: SendMessageRequest, effective_skill_id: int | None, chat_mode: ChatMode) -> bool:
    return (
        chat_mode == ChatMode.STANDALONE_QA
        and
        req.project_id is None
        and effective_skill_id is None
        and not req.rag_doc_ids
        and not req.file_ids
        and len((req.content or "").strip()) <= 280
    )


def _looks_like_confirmation_followup(content: str) -> bool:
    normalized = (content or "").strip().lower()
    if not normalized:
        return False
    return len(normalized) <= 40 and any(term in normalized for term in SHORT_CONFIRMATION_TERMS)


def _recent_assistant_has_deletion_plan(history: list) -> bool:
    for msg in reversed(history):
        if getattr(msg, "role", "") != "assistant":
            continue
        content = str(getattr(msg, "content", "") or "").lower()
        if any(marker.lower() in content for marker in DELETION_PLAN_MARKERS):
            return True
        return False
    return False


def _upgrade_policy_for_confirmed_followup(
    intent_decision: IntentDecision,
    req: SendMessageRequest,
    history: list,
) -> IntentDecision:
    if intent_decision.action_policy == ActionPolicy.DESTRUCTIVE_ACTION:
        return intent_decision
    if req.project_id and _looks_like_confirmation_followup(req.content) and _recent_assistant_has_deletion_plan(history):
        return replace(
            intent_decision,
            action_policy=ActionPolicy.DESTRUCTIVE_ACTION,
            tool_access_policy=ToolAccessPolicy.WRITE_ALLOWED,
            confidence=max(intent_decision.confidence, 0.86),
            reason="confirmation_followup_after_deletion_plan",
            method=f"{intent_decision.method}+confirmation_followup",
            trace={**(intent_decision.trace or {}), "policy_upgrade": "confirmation_followup_after_deletion_plan"},
        )
    return intent_decision


def _resolve_runtime_model_and_tokens(
    req: SendMessageRequest,
    selected_model: str,
    max_tokens: int,
    effective_skill_id: int | None,
    *,
    has_deepseek_api_key: bool = False,
    chat_mode: ChatMode = ChatMode.PROJECT_DEEP_DIVE,
) -> tuple[str, int]:
    normalized = (selected_model or "").lower()

    if chat_mode == ChatMode.CROSS_PROJECT_PORTFOLIO:
        if has_deepseek_api_key and normalized in {"kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)
        return selected_model, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)

    if chat_mode == ChatMode.WORKSPACE_INVENTORY:
        if has_deepseek_api_key and normalized in {"kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)
        return selected_model, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)

    if _is_standalone_fast_path(req, effective_skill_id, chat_mode) and normalized.startswith("kimi-k2.6"):
        return STANDALONE_FAST_PATH_MODEL, min(max_tokens, STANDALONE_FAST_PATH_MAX_TOKENS)

    if req.project_id is None and effective_skill_id is None:
        return selected_model, min(max_tokens, STANDALONE_CHAT_MAX_TOKENS)

    return selected_model, max_tokens


def _context_mode_from_decision(chat_mode: ChatMode) -> str:
    if chat_mode == ChatMode.CROSS_PROJECT_PORTFOLIO:
        return "client_portfolio"
    if chat_mode == ChatMode.WORKSPACE_INVENTORY:
        return "workspace_inventory"
    if chat_mode == ChatMode.PROJECT_DEEP_DIVE:
        return "project"
    if chat_mode == ChatMode.SKILL_EXECUTION:
        return "skill"
    return "workspace_brief"


def decide_skill_activation(content: str, skill: Skill | None, *, force_skill: bool = False) -> SkillActivationDecision:
    """Decide whether a selected Skill should run for this message.

    A Skill is an execution contract, not a passive context hint. It should only
    run when the user explicitly arms it in the UI/API or invokes the Skill in
    the message. Broad deliverable keywords such as "方案" or "报告" are handled
    by the project task router instead of silently activating a selected Skill.
    """
    if not skill:
        return SkillActivationDecision(False, "no_skill", 0.0)
    if force_skill:
        return SkillActivationDecision(True, "forced_by_user", 1.0)
    text = (content or "").strip().lower()
    if not text:
        return SkillActivationDecision(False, "empty_message", 0.0)

    explicit_skill = any(
        token in text
        for token in (
            "@skill", "@ skills", "使用skill", "调用skill", "运行skill", "执行skill",
            "用这个能力", "用该能力",
        )
    )
    if explicit_skill:
        return SkillActivationDecision(True, "explicit_skill_invocation", 0.96)

    return SkillActivationDecision(False, "selected_skill_not_armed", 0.8)


def _should_apply_skill(content: str, skill: Skill | None) -> bool:
    """Backward-compatible boolean wrapper around ``decide_skill_activation``."""

    return decide_skill_activation(content, skill).apply


def _resolve_effective_skill(session: Session, req: SendMessageRequest) -> tuple[Skill | None, SkillActivationDecision, int | None, Skill | None]:
    skill = session.get(Skill, req.skill_id) if req.skill_id else None
    skill_decision = decide_skill_activation(req.content, skill, force_skill=req.force_skill)
    effective_skill_id = req.skill_id if skill and skill_decision.apply else None
    effective_skill = skill if effective_skill_id else None
    return skill, skill_decision, effective_skill_id, effective_skill


def _resolve_requested_model(session: Session, req: SendMessageRequest) -> str:
    selected_model = get_selected_model(session)
    user_model = (req.model or "").strip()
    if user_model:
        model_lower = user_model.lower()
        known_prefixes = ("claude-", "kimi-", "moonshot-", "deepseek-", "glm-", "mimo-")
        if any(model_lower.startswith(p) for p in known_prefixes):
            selected_model = user_model
    return selected_model


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def prepare_chat_runtime(
    session: Session,
    req: SendMessageRequest,
    *,
    intent_decision: IntentDecision | None = None,
    intent_prepared_async: bool = False,
    owner_user_id: int | None = None,
    persist_user: bool = True,
    create_conversation: bool = True,
) -> ChatRuntime:
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
    prepare_metrics: dict[str, int | str | dict] = {}

    # 1. Skill resolution
    _, skill_decision, effective_skill_id, effective_skill = _resolve_effective_skill(session, req)
    if intent_decision is None:
        intent_decision = classify_chat_intent(req, effective_skill_id=effective_skill_id)
    prepare_metrics["skill_decision"] = skill_decision.reason
    prepare_metrics["chat_mode"] = intent_decision.chat_mode.value
    prepare_metrics["action_policy"] = intent_decision.action_policy.value
    prepare_metrics["tool_access_policy"] = intent_decision.tool_access_policy.value
    prepare_metrics["intent_reason"] = intent_decision.reason
    prepare_metrics["intent_method"] = intent_decision.method
    prepare_metrics["intent_trace"] = intent_decision.trace
    if intent_decision.artifact_contract.delivery_required:
        prepare_metrics["artifact_contract"] = intent_decision.artifact_contract.to_dict()
    prepare_metrics["resolve_skill_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 2. Conversation
    step_started_at = time.perf_counter()
    if req.conversation_id:
        conv = get_or_create_conversation(
            session,
            req.conversation_id,
            project_id=req.project_id,
            skill_id=effective_skill_id,
            owner_user_id=owner_user_id,
        )
    elif create_conversation:
        conv = get_or_create_conversation(
            session,
            req.conversation_id,
            project_id=req.project_id,
            skill_id=effective_skill_id,
            owner_user_id=owner_user_id,
        )
    else:
        conv = None
    prepare_metrics["conversation_ready_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    conv_id = int(conv.id or 0) if conv is not None else 0

    # 3. Persist user message
    metadata = build_message_metadata(
        project_id=req.project_id,
        skill_id=effective_skill_id,
        rag_doc_ids=req.rag_doc_ids,
        file_ids=req.file_ids,
    )
    step_started_at = time.perf_counter()
    if persist_user and conv_id:
        persist_user_message(session, conv_id, req.content, metadata)
    prepare_metrics["user_message_saved_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 4. Settings & context
    max_tokens = get_int_setting(session, "max_tokens", DEFAULT_MAX_TOKENS) or DEFAULT_MAX_TOKENS
    temperature = get_float_setting(session, "temperature", DEFAULT_TEMPERATURE) or DEFAULT_TEMPERATURE
    context_mode = _context_mode_from_decision(intent_decision.chat_mode)

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
        context_mode=context_mode,
    )
    prepare_metrics["context_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 5. Model & provider resolution
    step_started_at = time.perf_counter()
    selected_model = _resolve_requested_model(session, req)

    runtime_model, runtime_max_tokens = _resolve_runtime_model_and_tokens(
        req,
        selected_model,
        chat_ctx.max_tokens,
        effective_skill_id,
        has_deepseek_api_key=_has_deepseek_api_key(session),
        chat_mode=intent_decision.chat_mode,
    )
    provider = resolve_provider_from_model(runtime_model)
    llm = _load_provider_module(provider)
    system = llm.build_system_prompt(
        chat_ctx.skill_prompt,
        chat_ctx.rag_context,
        chat_ctx.project_context,
        chat_mode=intent_decision.chat_mode,
    )
    prepare_metrics["model_ready_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["selected_model"] = selected_model
    prepare_metrics["runtime_model"] = runtime_model

    # 6. Message history
    step_started_at = time.perf_counter()
    history = get_recent_message_history(session, conv_id, limit=CHAT_HISTORY_WINDOW) if conv_id else []
    api_messages = [
        {"role": msg.role, "content": msg.content}
        for msg in history
        if msg.content.strip()
    ]
    if intent_decision.chat_mode in {ChatMode.CROSS_PROJECT_PORTFOLIO, ChatMode.WORKSPACE_INVENTORY}:
        window = MODE_CONFIG.get(intent_decision.chat_mode, MODE_CONFIG[ChatMode.PROJECT_DEEP_DIVE]).history_window
        api_messages = api_messages[-max(1, min(window, CHAT_HISTORY_WINDOW)) :]
    intent_decision = _upgrade_policy_for_confirmed_followup(intent_decision, req, history)
    prepare_metrics["history_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["history_message_count"] = len(api_messages)
    prepare_metrics["action_policy"] = intent_decision.action_policy.value
    prepare_metrics["tool_access_policy"] = intent_decision.tool_access_policy.value
    prepare_metrics["intent_reason"] = intent_decision.reason
    prepare_metrics["intent_method"] = intent_decision.method
    prepare_metrics["intent_trace"] = intent_decision.trace
    prepare_metrics["context_mode"] = context_mode
    prepare_metrics["prepare_total_ms"] = round((time.perf_counter() - prepare_started_at) * 1000)
    runtime_tools = filter_tools_for_access(
        chat_ctx.tools,
        intent_decision.action_policy,
        intent_decision.tool_access_policy,
    )

    return ChatRuntime(
        conv_id=conv_id,
        project_id=req.project_id,
        selected_model=runtime_model,
        llm=llm,
        system=system,
        api_messages=api_messages,
        rag_sources=chat_ctx.rag_sources,
        tools=runtime_tools,
        max_tokens=_cap_max_tokens_for_model(runtime_model, runtime_max_tokens),
        temperature=temperature,
        skill_name=effective_skill.name if effective_skill else "",
        prepare_metrics=prepare_metrics,
        chat_mode=intent_decision.chat_mode,
        action_policy=intent_decision.action_policy,
        tool_access_policy=intent_decision.tool_access_policy,
        intent_reason=intent_decision.reason,
        intent_method=intent_decision.method,
        intent_trace=intent_decision.trace,
        intent_task_route=intent_decision.task_route,
        artifact_contract=intent_decision.artifact_contract,
        intent_prepared_async=intent_prepared_async,
    )


async def prepare_chat_runtime_async(
    session: Session,
    req: SendMessageRequest,
    *,
    owner_user_id: int | None = None,
    persist_user: bool = True,
    create_conversation: bool = True,
) -> ChatRuntime:
    """Build ``ChatRuntime`` after a full async IntentRouter pre-route.

    This is the canonical path for API requests.  It lets the LLM-assisted
    router affect the prompt, context mode, model budget, and tool policy before
    any context is assembled, while the synchronous ``prepare_chat_runtime``
    remains as a deterministic compatibility baseline for older tests and
    utility callers.
    """

    _, _, effective_skill_id, _ = _resolve_effective_skill(session, req)
    selected_model = _resolve_requested_model(session, req)

    # Use a cheap, fast model for intent classification.
    # DeepSeek is preferred; fall back to the user's selected model if
    # DeepSeek is not configured.
    if _has_deepseek_api_key(session):
        router_model = INTENT_ROUTER_MODEL
        router_llm = _load_provider_module("deepseek")
    else:
        router_model = selected_model
        router_llm = _load_provider_module(resolve_provider_from_model(selected_model))

    intent_decision = await classify_chat_intent_async(
        req,
        effective_skill_id=effective_skill_id,
        llm_complete=router_llm.complete,
        model=router_model,
    )
    return prepare_chat_runtime(
        session,
        req,
        intent_decision=intent_decision,
        intent_prepared_async=True,
        owner_user_id=owner_user_id,
        persist_user=persist_user,
        create_conversation=create_conversation,
    )
