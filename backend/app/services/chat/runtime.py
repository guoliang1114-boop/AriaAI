"""Chat runtime preparation — builds the immutable ``ChatRuntime`` object used by all phases."""
from __future__ import annotations

import json
import os
import time
from dataclasses import replace

from sqlmodel import Session

from app.config import DEFAULT_MAX_TOKENS, DEFAULT_TEMPERATURE
from app.models.db import Conversation, Message, Skill
from app.models.db import Setting as _Setting
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_store import (
    build_message_metadata,
    get_recent_message_history,
    get_or_create_conversation,
    persist_user_message,
)
from app.services.conversation_state import get_conversation_state_payload
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
from app.services.chat.intent_contract import build_chat_intent_contract
from app.services.chat.mode_registry import ActionPolicy, ChatMode, MODE_CONFIG, ToolAccessPolicy
from app.services.chat.working_memory import (
    build_working_memory,
    format_working_memory_for_prompt,
    should_continue_current_artifact,
)
from app.services.consulting_intelligence import ConsultingTurnFrame, build_consulting_turn_frame
from app.services.intent_router import IntentDecision, classify_chat_intent, classify_chat_intent_async
from app.services.policy_guards import filter_tools_for_access
from app.services.skill_router import SkillActivationDecision, auto_select_skill, decide_skill_activation
from app.services.task_orchestrator import RULE_FIRST_OVERRIDE_CONFIDENCE, rule_based_project_task_route
from app.services.artifact_intent import ArtifactContract
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME

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


def _upgrade_policy_for_artifact_continuation(
    intent_decision: IntentDecision,
    req: SendMessageRequest,
    working_memory,
) -> IntentDecision:
    if intent_decision.action_policy == ActionPolicy.DESTRUCTIVE_ACTION:
        return intent_decision
    if not req.project_id or not should_continue_current_artifact(working_memory):
        return intent_decision
    artifact = working_memory.current_artifact or {}
    artifact_name = str(artifact.get("name") or working_memory.explicit_target_filename or "")
    artifact_type = str(artifact.get("file_type") or "").lower()
    is_markdown = artifact_type == "md" or artifact_name.lower().endswith(".md") or bool(working_memory.explicit_target_filename)
    if not is_markdown:
        return replace(
            intent_decision,
            action_policy=ActionPolicy.MODIFY_EXISTING_FILE,
            tool_access_policy=ToolAccessPolicy.WRITE_ALLOWED,
            confidence=max(intent_decision.confidence, 0.88),
            reason="working_memory_artifact_continuation",
            method=f"{intent_decision.method}+working_memory",
            trace={
                **(intent_decision.trace or {}),
                "policy_upgrade": "artifact_continuation",
                "current_artifact": artifact,
            },
        )

    title = (working_memory.explicit_target_filename or artifact_name or "项目文档.md").removesuffix(".md")
    contract = ArtifactContract(
        delivery_required=True,
        output_kind="md",
        title=title,
        allowed_tools=(PROJECT_MARKDOWN_TOOL_NAME,),
        confidence=0.92,
        reason="working_memory_artifact_continuation",
        source="working_memory",
    )
    return replace(
        intent_decision,
        chat_mode=ChatMode.PROJECT_DEEP_DIVE,
        action_policy=ActionPolicy.MODIFY_EXISTING_FILE,
        tool_access_policy=ToolAccessPolicy.WRITE_ALLOWED,
        task_route=None,
        artifact_contract=contract,
        confidence=max(intent_decision.confidence, 0.92),
        reason="working_memory_artifact_continuation",
        method=f"{intent_decision.method}+working_memory",
        trace={
            **(intent_decision.trace or {}),
            "policy_upgrade": "artifact_continuation",
            "current_artifact": artifact,
            "artifact_contract": contract.to_dict(),
        },
    )


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


def _should_apply_skill(content: str, skill: Skill | None) -> bool:
    """Backward-compatible boolean wrapper around ``decide_skill_activation``."""

    return decide_skill_activation(content, skill).apply


def _resolve_effective_skill(session: Session, req: SendMessageRequest) -> tuple[Skill | None, SkillActivationDecision, int | None, Skill | None]:
    skill = session.get(Skill, req.skill_id) if req.skill_id else None
    auto_skill: Skill | None = None
    auto_decision: SkillActivationDecision | None = None
    if skill is None and req.conversation_id:
        conv = session.get(Conversation, req.conversation_id)
        if conv and conv.skill_id:
            sticky_skill = session.get(Skill, conv.skill_id)
            if sticky_skill:
                skill = sticky_skill
                auto_decision = SkillActivationDecision(
                    True,
                    "sticky_conversation_skill",
                    0.88,
                    source="conversation",
                    candidate_skill_id=sticky_skill.id,
                    candidate_skill_name=sticky_skill.name,
                )
    if skill is None:
        task_route = rule_based_project_task_route(req.content) if req.project_id else None
        office_output_kind = str(getattr(task_route, "output_kind", "") or "").lower() if task_route else ""
        if (
            task_route
            and task_route.task_type
            and task_route.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE
            and office_output_kind in {"pptx", "xlsx", "docx", "pdf"}
        ):
            auto_decision = SkillActivationDecision(
                False,
                f"auto_skill_skipped_task_route:{task_route.task_type}",
                task_route.confidence,
                source="task_router",
            )
        else:
            auto_skill, auto_decision = auto_select_skill(session, req)
            skill = auto_skill
    skill_decision = auto_decision or decide_skill_activation(req.content, skill, force_skill=req.force_skill)
    effective_skill_id = req.skill_id if skill and skill_decision.apply else None
    if effective_skill_id is None and skill and skill_decision.apply:
        effective_skill_id = skill.id
    effective_skill = skill if effective_skill_id else None
    return skill, skill_decision, effective_skill_id, effective_skill


def _message_metadata(message: Message) -> dict:
    try:
        parsed = json.loads(message.metadata_json or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _format_tool_history_summary(metadata: dict) -> str:
    lines: list[str] = []
    tool_calls = metadata.get("tool_calls")
    if isinstance(tool_calls, list) and tool_calls:
        lines.append("Tool history from this assistant turn:")
        for item in tool_calls[:8]:
            if not isinstance(item, dict):
                continue
            tool_name = str(item.get("tool_name") or item.get("name") or "").strip()
            status = str(item.get("status") or "").strip()
            summary = str(item.get("summary") or item.get("message") or item.get("error") or "").strip()
            output = item.get("output") if isinstance(item.get("output"), dict) else item.get("artifact")
            artifact_bits: list[str] = []
            if isinstance(output, dict):
                for key in ("project_file_id", "id", "name", "file_name", "file_type", "path"):
                    value = output.get(key)
                    if value:
                        artifact_bits.append(f"{key}={value}")
            detail = "; ".join(part for part in (summary, ", ".join(artifact_bits)) if part)
            lines.append(f"- {tool_name or 'tool'} status={status or '-'}{f': {detail}' if detail else ''}")
    for key, label in (("artifacts", "Artifacts"), ("pending_markdown_saves", "Pending markdown saves")):
        values = metadata.get(key)
        if not isinstance(values, list) or not values:
            continue
        lines.append(f"{label}:")
        for item in values[:6]:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("file_name") or "-"
            file_id = item.get("project_file_id") or item.get("file_id") or item.get("id") or "-"
            file_type = item.get("file_type") or "md"
            lines.append(f"- name={name}, file_type={file_type}, project_file_id={file_id}")
    if metadata.get("delivery_failed"):
        lines.append("Delivery status: failed; do not treat this turn as a completed artifact.")
    return "\n".join(lines)


def _api_message_from_history(message: Message) -> dict[str, str]:
    content = str(message.content or "").strip()
    tool_summary = _format_tool_history_summary(_message_metadata(message))
    if tool_summary:
        content = f"{content}\n\n[Structured execution metadata]\n{tool_summary}".strip()
    return {"role": message.role, "content": content}


def _response_contract_for_intent(intent_decision: IntentDecision, skill_decision: SkillActivationDecision) -> str:
    if intent_decision.chat_mode == ChatMode.SKILL_EXECUTION or skill_decision.apply:
        return "follow_the_selected_skill_workflow_and_answer_with_the_requested_deliverable"
    if intent_decision.action_policy == ActionPolicy.READ_ONLY_TOOL:
        return "answer_in_chat_and_use_read_only_tools_only_when_injected_context_is_insufficient"
    if intent_decision.action_policy in {ActionPolicy.WRITE_ARTIFACT, ActionPolicy.MODIFY_EXISTING_FILE}:
        return "produce_the_requested_artifact_or_file_update_without_destructive_actions"
    if intent_decision.action_policy == ActionPolicy.DURABLE_TASK:
        return "plan_or_run_the_durable_task_with_clear_progress_and_result_state"
    if intent_decision.action_policy == ActionPolicy.DESTRUCTIVE_ACTION:
        return "perform_only_the_confirmed_destructive_action_scope"
    return "answer_directly_from_available_context_without_unnecessary_tool_calls"


def _exploration_contract_for_intent(intent_decision: IntentDecision) -> str:
    if intent_decision.tool_access_policy == ToolAccessPolicy.EXPLICIT_FILE_READ:
        return "list_or_read_the_named_project_files_before_answering"
    if intent_decision.tool_access_policy == ToolAccessPolicy.READ_ON_DEMAND:
        return "first_use_injected_context_then_read_project_files_only_when_the_answer_depends_on_missing_document_details"
    if intent_decision.tool_access_policy == ToolAccessPolicy.INJECTED_CONTEXT_ONLY:
        return "use_injected_project_memory_as_source_of_truth_do_not_call_tools"
    if intent_decision.tool_access_policy == ToolAccessPolicy.WRITE_ALLOWED:
        return "use_write_tools_only_within_the_confirmed_scope_and_summarize_the_created_or_changed_artifact"
    return "no_tools_available_answer_from_conversation_only"


def _build_intent_frame(
    intent_decision: IntentDecision,
    skill_decision: SkillActivationDecision,
    effective_skill: Skill | None,
    context_mode: str,
    consulting_frame: ConsultingTurnFrame,
) -> dict[str, str | float | int]:
    return {
        "chat_mode": intent_decision.chat_mode.value,
        "action_policy": intent_decision.action_policy.value,
        "tool_access_policy": intent_decision.tool_access_policy.value,
        "context_mode": context_mode,
        "intent_reason": intent_decision.reason,
        "intent_method": intent_decision.method,
        "skill_decision": skill_decision.reason,
        "skill_decision_source": skill_decision.source,
        "skill_decision_confidence": round(skill_decision.confidence, 3),
        "effective_skill_id": int(effective_skill.id or 0) if effective_skill else 0,
        "effective_skill_name": effective_skill.name if effective_skill else "",
        "response_contract": _response_contract_for_intent(intent_decision, skill_decision),
        "context_exploration_contract": _exploration_contract_for_intent(intent_decision),
        "consulting_job_type": consulting_frame.job_type,
        "client_moment": consulting_frame.client_moment,
        "consulting_frame_confidence": round(consulting_frame.confidence, 3),
        "consulting_frame_reason": consulting_frame.reason,
    }


def _append_intent_frame(
    system: str,
    intent_frame: dict[str, str | float | int],
    consulting_frame: ConsultingTurnFrame,
) -> str:
    lines = ["", "", "## Intent Frame"]
    for key, value in intent_frame.items():
        if value in ("", 0):
            continue
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Consulting Turn Frame"])
    lines.extend(consulting_frame.to_prompt_lines())
    return f"{system.rstrip()}{chr(10).join(lines)}"


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
    prepare_metrics: dict[str, object] = {}

    # 1. Skill resolution
    _, skill_decision, effective_skill_id, effective_skill = _resolve_effective_skill(session, req)
    if intent_decision is None:
        intent_decision = classify_chat_intent(req, effective_skill_id=effective_skill_id)
    prepare_metrics["skill_decision"] = skill_decision.reason
    prepare_metrics["skill_decision_source"] = skill_decision.source
    prepare_metrics["skill_decision_confidence"] = round(skill_decision.confidence, 3)
    prepare_metrics["effective_skill_id"] = effective_skill_id or ""
    prepare_metrics["effective_skill_name"] = effective_skill.name if effective_skill else ""
    prepare_metrics["chat_mode"] = intent_decision.chat_mode.value
    prepare_metrics["action_policy"] = intent_decision.action_policy.value
    prepare_metrics["tool_access_policy"] = intent_decision.tool_access_policy.value
    prepare_metrics["intent_reason"] = intent_decision.reason
    prepare_metrics["intent_method"] = intent_decision.method
    prepare_metrics["intent_trace"] = intent_decision.trace
    if intent_decision.artifact_contract.delivery_required:
        prepare_metrics["artifact_contract"] = intent_decision.artifact_contract.to_dict()
    intent_contract = build_chat_intent_contract(
        intent_decision,
        req,
        skill_applied=bool(effective_skill),
    )
    prepare_metrics["intent_contract"] = intent_contract.to_dict()
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
    if conv is not None and effective_skill_id and not conv.skill_id:
        conv.skill_id = effective_skill_id
        session.add(conv)
        session.commit()
        session.refresh(conv)
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

    # 4. Message history, working memory, and follow-up policy upgrades
    step_started_at = time.perf_counter()
    history = get_recent_message_history(session, conv_id, limit=CHAT_HISTORY_WINDOW) if conv_id else []
    persisted_conversation_state = get_conversation_state_payload(session, conv_id) if conv_id else {}
    working_memory = build_working_memory(history, req.content, persisted_state=persisted_conversation_state)
    intent_decision = _upgrade_policy_for_confirmed_followup(intent_decision, req, history)
    intent_decision = _upgrade_policy_for_artifact_continuation(intent_decision, req, working_memory)
    api_messages = [_api_message_from_history(msg) for msg in history if str(msg.content or "").strip()]
    if intent_decision.chat_mode in {ChatMode.CROSS_PROJECT_PORTFOLIO, ChatMode.WORKSPACE_INVENTORY}:
        window = MODE_CONFIG.get(intent_decision.chat_mode, MODE_CONFIG[ChatMode.PROJECT_DEEP_DIVE]).history_window
        api_messages = api_messages[-max(1, min(window, CHAT_HISTORY_WINDOW)) :]
    prepare_metrics["history_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["history_message_count"] = len(api_messages)
    prepare_metrics["working_memory"] = working_memory.to_dict()
    if persisted_conversation_state:
        prepare_metrics["conversation_state_loaded"] = True
    prepare_metrics["action_policy"] = intent_decision.action_policy.value
    prepare_metrics["tool_access_policy"] = intent_decision.tool_access_policy.value
    prepare_metrics["intent_reason"] = intent_decision.reason
    prepare_metrics["intent_method"] = intent_decision.method
    prepare_metrics["intent_trace"] = intent_decision.trace
    if intent_decision.artifact_contract.delivery_required:
        prepare_metrics["artifact_contract"] = intent_decision.artifact_contract.to_dict()
    intent_contract = build_chat_intent_contract(
        intent_decision,
        req,
        skill_applied=bool(effective_skill),
    )
    prepare_metrics["intent_contract"] = intent_contract.to_dict()

    # 5. Settings & context
    max_tokens = get_int_setting(session, "max_tokens", DEFAULT_MAX_TOKENS) or DEFAULT_MAX_TOKENS
    temperature = get_float_setting(session, "temperature", DEFAULT_TEMPERATURE) or DEFAULT_TEMPERATURE
    context_mode = _context_mode_from_decision(intent_decision.chat_mode)
    context_file_ids = list(req.file_ids or [])
    current_artifact = working_memory.current_artifact or {}
    current_artifact_file_id = current_artifact.get("project_file_id")
    if current_artifact_file_id and should_continue_current_artifact(working_memory):
        try:
            context_file_ids.append(int(current_artifact_file_id))
        except (TypeError, ValueError):
            pass
        context_file_ids = list(dict.fromkeys(context_file_ids))

    step_started_at = time.perf_counter()
    chat_ctx = build_chat_context(
        session=session,
        skill_id=effective_skill_id,
        project_id=req.project_id,
        knowledge_scope=req.knowledge_scope,
        rag_doc_ids=req.rag_doc_ids if req.rag_doc_ids else None,
        file_ids=context_file_ids if context_file_ids else None,
        content=req.content,
        default_max_tokens=max_tokens,
        mention_context=req.mention_context.model_dump() if req.mention_context else None,
        context_mode=context_mode,
    )
    prepare_metrics["context_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["context_mode"] = context_mode

    # 6. Model & provider resolution
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
    working_memory_prompt = format_working_memory_for_prompt(working_memory)
    if working_memory_prompt:
        system = f"{system.rstrip()}\n\n{working_memory_prompt}\n"
    consulting_frame = build_consulting_turn_frame(
        req.content,
        project_id=req.project_id,
        skill_name=effective_skill.name if effective_skill else "",
    )
    intent_frame = _build_intent_frame(intent_decision, skill_decision, effective_skill, context_mode, consulting_frame)
    system = _append_intent_frame(system, intent_frame, consulting_frame)
    prepare_metrics["intent_frame"] = intent_frame
    prepare_metrics["consulting_frame"] = {
        "job_type": consulting_frame.job_type,
        "client_moment": consulting_frame.client_moment,
        "memory_focus": list(consulting_frame.memory_focus),
        "response_shape": list(consulting_frame.response_shape),
        "agent_protocol": list(consulting_frame.agent_protocol),
        "confidence": round(consulting_frame.confidence, 3),
        "reason": consulting_frame.reason,
    }
    prepare_metrics["model_ready_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["selected_model"] = selected_model
    prepare_metrics["runtime_model"] = runtime_model

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
        working_memory=working_memory.to_dict(),
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
