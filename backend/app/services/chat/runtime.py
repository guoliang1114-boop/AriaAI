"""Chat runtime preparation — builds the immutable ``ChatRuntime`` object used by all phases."""
from __future__ import annotations

import json
import hmac
import os
import time
from dataclasses import replace
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import (
    AGENT_TURN_MAX_STEPS,
    AGENT_TURN_MAX_TOOL_CALLS,
    AGENT_TURN_TIMEOUT_SECONDS,
    CONTEXT_HISTORY_SUMMARY_TOKENS,
    CONTEXT_WINDOW_SAFETY_MARGIN_PERCENT,
    DEFAULT_CONTEXT_WINDOW_TOKENS,
    DEFAULT_MAX_TOKENS,
    DEFAULT_TEMPERATURE,
    MODEL_ALIASES,
    MODEL_TURN_MAX_ATTEMPTS,
    MODEL_TURN_RETRY_BASE_DELAY_MS,
    MODEL_TURN_RETRY_MAX_DELAY_MS,
    TOOL_PARALLEL_MAX_CONCURRENCY,
)
from app.models.db import Conversation, Message, ProjectMember, Skill, User
from app.models.db import Setting as _Setting
from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.context_budget import (
    resolve_model_context_window,
)
from app.services.agent_harness.tool_transcript import normalize_tool_transcript
from app.services.agent_harness.knowledge_evidence import knowledge_evidence_reference
from app.services.agent_harness.project_memory_evidence import (
    project_memory_evidence_reference,
)
from app.services.agent_harness.project_world_state import (
    build_project_world_state_manifest,
    compare_project_world_states,
    format_project_world_state_change_for_prompt,
    latest_project_world_state,
)
from app.services.agent_harness.run_rollout import get_chat_rollout
from app.services.agent_harness.skill_releases import (
    SkillReleaseAssignment,
    active_skill_view,
    resolve_skill_release,
)
from app.services.agent_harness.turn_interrupt import get_active_turn
from app.services.agent_harness.durable_run_inputs import (
    DurableRunInputRejected,
    build_recovery_steering_history_messages,
    load_recovery_steering_messages,
)
from app.services.agent_harness.conversation_capsule import (
    build_conversation_capsule,
    conversation_capsule_reference,
    format_conversation_capsule_for_prompt,
)
from app.services.agent_harness.instruction_manifest import (
    build_instruction_manifest,
    format_instruction_precedence_for_prompt,
    instruction_manifest_reference,
)
from app.services.chat_store import (
    build_message_metadata,
    get_recent_message_history,
    get_or_create_conversation,
    persist_user_message,
)
from app.services.conversation_state import get_conversation_state_payload
from app.services.context_builder import (
    ContextSourceInput,
    assemble_context,
    build_chat_context,
    context_manifest_reference,
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
from app.services.chat.turn_contract import build_turn_contract, format_turn_user_request
from app.services.chat.turn_recovery import (
    TurnRecoveryConflict,
    TurnRecoveryError,
    build_turn_recovery_preview,
    find_existing_recovery_child,
    format_turn_recovery_for_prompt,
    resolve_recovery_world_state,
)
from app.services.chat.working_memory import (
    build_working_memory,
    should_continue_current_artifact,
)
from app.services.consulting_intelligence import ConsultingTurnFrame, build_consulting_turn_frame
from app.services.intent_router import IntentDecision, classify_chat_intent, classify_chat_intent_async
from app.services.policy_guards import filter_tools_for_access
from app.services.project_question_reanswer import (
    ProjectQuestionReanswerBundle,
    project_question_reanswer_manifest_reference,
    resolve_project_question_reanswer_input,
)
from app.services.skill_router import (
    SkillActivationDecision,
    auto_select_skill,
    decide_conversation_skill_activation,
    decide_skill_activation,
    is_proposal_presentation_request,
)
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

PROVIDER_API_KEY_SETTINGS = {
    "claude": "api_key",
    "kimi": "kimi_api_key",
    "deepseek": "deepseek_api_key",
    "bigmodel": "bigmodel_api_key",
    "mimo": "mimo_api_key",
}
PROVIDER_API_KEY_ENVS = {
    "claude": ("ANTHROPIC_API_KEY",),
    "kimi": ("MOONSHOT_API_KEY",),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "bigmodel": ("BIGMODEL_API_KEY", "ZHIPU_API_KEY"),
    "mimo": ("MIMO_API_KEY", "XIAOMI_API_KEY"),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _has_deepseek_api_key(session: Session) -> bool:
    setting = session.get(_Setting, "deepseek_api_key")
    if setting and setting.value.strip():
        return True
    return bool(os.environ.get("DEEPSEEK_API_KEY"))


def _provider_has_api_key(session: Session, provider: str) -> bool:
    provider = (provider or "").lower().strip()
    setting_key = PROVIDER_API_KEY_SETTINGS.get(provider)
    if setting_key:
        setting = session.get(_Setting, setting_key)
        if setting and setting.value.strip():
            return True
    return any(os.environ.get(env) for env in PROVIDER_API_KEY_ENVS.get(provider, ()))


def _setting_value(session: Session, key: str) -> str:
    setting = session.get(_Setting, key)
    return setting.value.strip() if setting and setting.value else ""


def _resolve_intent_router_model(session: Session, selected_model: str) -> tuple[str, str, str]:
    configured_model = _setting_value(session, "intent_router_model")
    configured_provider = _setting_value(session, "intent_router_provider")
    if configured_model:
        provider = configured_provider or resolve_provider_from_model(configured_model)
        provider = provider.lower().strip()
        if provider in {"anthropic", "moonshot", "xiaomi"}:
            provider = {"anthropic": "claude", "moonshot": "kimi", "xiaomi": "mimo"}[provider]
        if provider in PROVIDER_API_KEY_SETTINGS and _provider_has_api_key(session, provider):
            return configured_model, provider, "settings.intent_router_model"

    if _has_deepseek_api_key(session):
        return INTENT_ROUTER_MODEL, "deepseek", "default.deepseek"

    return selected_model, resolve_provider_from_model(selected_model), "fallback.selected_model"


def _cap_max_tokens_for_model(model: str, max_tokens: int) -> int:
    normalized = (model or "").lower()
    if normalized.startswith(("kimi-k3", "kimi-k2.6", "kimi-k2.5")):
        return min(max_tokens, 32768)
    if normalized.startswith(("glm-5", "deepseek-v4")):
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


def _validated_turn_recovery(
    session: Session,
    req: SendMessageRequest,
    *,
    conversation_id: int,
) -> dict:
    """Rebuild a recovery contract from the server-side rollout.

    Client recovery fields are navigation hints only. The durable rollout is
    authoritative for completed steps and possible side effects.
    """

    if req.turn_recovery is None:
        return {}
    source_message = session.get(Message, req.turn_recovery.source_message_id)
    if (
        source_message is None
        or source_message.role != "assistant"
        or source_message.conversation_id != conversation_id
    ):
        raise TurnRecoveryError("Turn recovery source does not belong to this conversation")
    source_run_id = req.turn_recovery.source_run_id
    if get_active_turn(source_run_id) is not None:
        raise TurnRecoveryConflict("Turn recovery source is still active")
    source_metadata = source_message.get_metadata()
    source_rollout = source_metadata.get("run_rollout")
    if (
        not isinstance(source_rollout, dict)
        or str(source_rollout.get("run_id") or "") != source_run_id
    ):
        raise TurnRecoveryError("Turn recovery source run does not match the selected message")
    rollout = get_chat_rollout(
        session,
        conversation_id,
        run_id=source_run_id,
    )
    if not rollout:
        raise TurnRecoveryError("Turn recovery rollout is no longer available")
    recovery_state = resolve_recovery_world_state(
        session,
        conversation_id=conversation_id,
        source_run_id=source_run_id,
        requested_project_id=req.project_id,
    )
    chat_run = recovery_state["chat_run"]
    if chat_run.assistant_message_id != source_message.id:
        raise TurnRecoveryError("Turn recovery message is not the ChatRun assistant result")
    if str(chat_run.status or "") not in {"cancelled", "failed", "interrupted"}:
        raise TurnRecoveryConflict("Turn recovery source is not durably terminal or interrupted")
    preview = build_turn_recovery_preview(
        rollout,
        source_message_id=int(source_message.id or 0),
        current_project_world_state=recovery_state["current_world_state"],
        project_world_state_change=recovery_state["world_state_change"],
        force_manual_review=not recovery_state["source_world_state_available"],
        unapplied_input_message_ids=recovery_state.get("unapplied_input_message_ids"),
        applied_input_message_ids=recovery_state.get("applied_input_message_ids"),
    )
    if not preview.get("can_continue"):
        raise TurnRecoveryConflict("This run has already completed and cannot be recovered")
    client_contract_sha = str(getattr(req.turn_recovery, "contract_sha256", None) or "").lower()
    if getattr(req.turn_recovery, "schema_version", None) == 2 and not client_contract_sha:
        raise TurnRecoveryConflict("Turn recovery v2 requires the reviewed contract digest")
    if client_contract_sha:
        if not hmac.compare_digest(client_contract_sha, str(preview.get("contract_sha256") or "")):
            raise TurnRecoveryConflict("Turn recovery contract changed; review the latest project state before continuing")
    else:
        # A v1/legacy client cannot attest which server preview it reviewed.
        # Preserve navigation but fail closed for every mutating tool.
        preview = build_turn_recovery_preview(
            rollout,
            source_message_id=int(source_message.id or 0),
            current_project_world_state=recovery_state["current_world_state"],
            project_world_state_change=recovery_state["world_state_change"],
            force_manual_review=True,
            unapplied_input_message_ids=recovery_state.get("unapplied_input_message_ids"),
            applied_input_message_ids=recovery_state.get("applied_input_message_ids"),
        )
    existing_child = find_existing_recovery_child(
        session,
        conversation_id=conversation_id,
        contract=preview,
        reconcile_stale_reservation=True,
    )
    if existing_child is not None:
        raise TurnRecoveryConflict("This recovery contract has already started a child run")
    return preview


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
        if has_deepseek_api_key and normalized in {"kimi-k3", "kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)
        return selected_model, min(max_tokens, CLIENT_PORTFOLIO_MAX_TOKENS)

    if chat_mode == ChatMode.WORKSPACE_INVENTORY:
        if has_deepseek_api_key and normalized in {"kimi-k3", "kimi-k2.6", "deepseek-v4-pro"}:
            return CLIENT_PORTFOLIO_FAST_MODEL, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)
        return selected_model, min(max_tokens, WORKSPACE_INVENTORY_MAX_TOKENS)

    if _is_standalone_fast_path(req, effective_skill_id, chat_mode) and normalized.startswith(("kimi-k3", "kimi-k2.6")):
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
    if getattr(req, "disable_skill", False):
        return (
            None,
            SkillActivationDecision(
                False,
                "skill_disabled_by_user",
                1.0,
                source="explicit",
                clear_conversation_skill=True,
            ),
            None,
            None,
        )
    skill = session.get(Skill, req.skill_id) if req.skill_id else None
    if skill is not None and skill.package_status == "deprecated":
        return (
            skill,
            SkillActivationDecision(
                False,
                "skill_release_deprecated",
                1.0,
                source="explicit",
                candidate_skill_id=skill.id,
                candidate_skill_name=skill.name,
                clear_conversation_skill=True,
            ),
            None,
            None,
        )
    if skill is not None:
        skill = active_skill_view(session, skill)
    auto_skill: Skill | None = None
    auto_decision: SkillActivationDecision | None = None
    conversation_decision: SkillActivationDecision | None = None
    if skill is None and req.conversation_id:
        conv = session.get(Conversation, req.conversation_id)
        if conv and conv.skill_id:
            sticky_skill = session.get(Skill, conv.skill_id)
            if sticky_skill and sticky_skill.package_status != "deprecated":
                sticky_skill = active_skill_view(session, sticky_skill)
                conversation_decision = decide_conversation_skill_activation(req.content, sticky_skill)
                if conversation_decision.apply:
                    skill = sticky_skill
                    auto_decision = conversation_decision
            elif sticky_skill:
                conversation_decision = SkillActivationDecision(
                    False,
                    "conversation_skill_release_deprecated",
                    1.0,
                    source="conversation",
                    candidate_skill_id=sticky_skill.id,
                    candidate_skill_name=sticky_skill.name,
                    clear_conversation_skill=True,
                )
    if skill is None:
        task_route = rule_based_project_task_route(req.content) if req.project_id else None
        office_output_kind = str(getattr(task_route, "output_kind", "") or "").lower() if task_route else ""
        if (
            task_route
            and task_route.task_type
            and task_route.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE
            and office_output_kind in {"pptx", "xlsx", "docx", "pdf"}
            and not is_proposal_presentation_request(req.content)
        ):
            auto_decision = SkillActivationDecision(
                False,
                f"auto_skill_skipped_task_route:{task_route.task_type}",
                task_route.confidence,
                source="task_router",
            )
        else:
            user_released_skill = bool(
                conversation_decision
                and conversation_decision.reason == "conversation_skill_released_by_user"
            )
            if user_released_skill:
                auto_decision = conversation_decision
            else:
                auto_skill, inferred_decision = auto_select_skill(session, req)
                skill = auto_skill
                auto_decision = inferred_decision if inferred_decision.apply else (conversation_decision or inferred_decision)
    if conversation_decision is not None and skill is None and not (auto_decision and auto_decision.apply):
        auto_decision = conversation_decision
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


def _should_include_history_message(message: Message) -> bool:
    if str(message.content or "").strip():
        return True
    metadata = _message_metadata(message)
    tool_calls = metadata.get("tool_calls")
    artifacts = metadata.get("artifacts")
    return (isinstance(tool_calls, list) and bool(tool_calls)) or (isinstance(artifacts, list) and bool(artifacts))


def _visible_history_messages(history: list[Message]) -> list[Message]:
    """Exclude recovery requests whose durable child never became active."""

    visible: list[Message] = []
    for message in history:
        reservation = _message_metadata(message).get("recovery_reservation")
        status = str(reservation.get("status") or "") if isinstance(reservation, dict) else ""
        if status in {"reserved", "expired"}:
            continue
        visible.append(message)
    return visible


def _api_message_from_history(message: Message) -> dict[str, str]:
    content = str(message.content or "").strip()
    if content:
        return {"role": message.role, "content": content}
    tool_summary = _format_tool_history_summary(_message_metadata(message))
    if tool_summary:
        return {"role": message.role, "content": f"[Prior structured tool execution]\n{tool_summary}"}
    return {"role": message.role, "content": ""}


def _api_messages_with_recovery_steering(
    history: list[Message],
    *,
    recovery_steering: tuple[Any, ...],
    current_user_message_id: int | None,
) -> list[dict[str, str]]:
    """Inject verified prior-run inputs once, as user messages, near the tail."""

    steering_ids = {int(item.message_id) for item in recovery_steering}
    recovery_messages = build_recovery_steering_history_messages(recovery_steering)
    filtered = [
        message
        for message in _visible_history_messages(history)
        if getattr(message, "id", None) not in steering_ids
    ]
    api_messages: list[dict[str, str]] = []
    injected = False
    for message in filtered:
        if (
            not injected
            and recovery_messages
            and getattr(message, "id", None) == current_user_message_id
        ):
            api_messages.extend(dict(item) for item in recovery_messages)
            injected = True
        if _should_include_history_message(message):
            api_messages.append(_api_message_from_history(message))
    if recovery_messages and not injected:
        api_messages.extend(dict(item) for item in recovery_messages)
    return api_messages


def _format_recent_tool_history_context(history: list[Message]) -> str:
    sections: list[str] = []
    for message in history:
        if getattr(message, "role", "") != "assistant":
            continue
        tool_summary = _format_tool_history_summary(_message_metadata(message))
        if not tool_summary:
            continue
        preview = str(getattr(message, "content", "") or "").strip().replace("\n", " ")[:120]
        heading = f"Assistant turn: {preview}" if preview else "Assistant turn"
        sections.append(f"{heading}\n{tool_summary}")
    if not sections:
        return ""
    recent_sections = sections[-4:]
    return (
        "## Recent Tool Execution Context\n"
        "Use this as structured state from prior turns. Do not quote it unless the user asks for execution details.\n\n"
        + "\n\n".join(recent_sections)
    )


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
        "skill_candidate_count": skill_decision.candidate_count,
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


def _append_capability_frame(
    system: str,
    intent_decision: IntentDecision,
    runtime_tools: list[dict] | None,
) -> str:
    """Tell the LLM what it can actually do this turn.

    Phase 3 of the routing refactor — closes the silent-downgrade
    failure mode. When the resolver drops to INJECTED_CONTEXT_ONLY
    or NONE, the LLM's tool list is empty; without this section the
    LLM has no idea why and tends to confabulate ("I don't have that
    capability"). With the frame in place, the LLM can answer
    truthfully: "this turn was classified as <reason>; to produce a
    file rephrase as ...".
    """
    tool_names = [
        str(tool.get("name") or "")
        for tool in (runtime_tools or [])
        if tool and tool.get("name")
    ]
    tool_names = [name for name in tool_names if name]
    lines = [
        "",
        "",
        "## Capability Frame",
        f"- action_policy: {intent_decision.action_policy.value}",
        f"- tool_access_policy: {intent_decision.tool_access_policy.value}",
        f"- routing_reason: {intent_decision.reason or '-'}",
        f"- tools_granted: {', '.join(tool_names) if tool_names else '(none)'}",
    ]
    if not tool_names:
        lines.extend(
            [
                "",
                "**You have NO function-calling tools for this turn.** Respond in"
                " text only. Do not claim you can save files, generate documents,"
                " or modify the project space — the user's request was routed to a"
                " read-only or direct-answer mode. If the user explicitly asked for"
                " a deliverable, say so directly and tell them how to rephrase, for"
                " example: \"本轮没有获得写工具(routing_reason 上面已列出)。"
                "如需生成文件,请改成『生成一份 md 项目报告』这样明确的措辞。\"",
            ]
        )
    elif intent_decision.tool_access_policy == ToolAccessPolicy.WRITE_ALLOWED:
        # When write/destructive tools are granted, the model must issue the
        # structured tool call directly. Modify/delete tool calls are frozen by
        # the system and shown to the user as a confirmation card (HITAS Action
        # Preview) BEFORE anything runs — so calling the tool does not execute
        # immediately. Models otherwise tend to ask "确认删除吗?" in text and
        # never call the tool, which silently blocks the whole flow.
        lines.extend(
            [
                "",
                "**To create, modify, or delete project content, CALL the"
                " appropriate tool directly — do NOT ask the user to confirm in"
                " chat first.** Modify and destructive tool calls are automatically"
                " frozen by the system and surfaced to the user as a confirmation"
                " card (Action Preview) before anything executes; issuing the tool"
                " call does not change anything by itself, it triggers that"
                " confirmation UI. Replying with a text question like"
                " \"确认删除吗?\" instead of calling the tool blocks the action and"
                " is incorrect. Make the structured tool call and let the system"
                " handle user confirmation.",
            ]
        )
    return f"{system.rstrip()}{chr(10).join(lines)}"


def _append_turn_contract_frame(system: str, turn_contract: dict) -> str:
    lines = ["", "", "## Turn Contract"]
    for key in (
        "mode",
        "user_goal",
        "user_constraints",
        "needs_tools",
        "needs_artifact",
        "artifact_type",
        "target_scope",
        "execution_scope",
        "expected_response",
        "requires_confirmation",
        "write_allowed",
        "reason",
    ):
        value = turn_contract.get(key)
        if value in ("", None, [], ()):
            continue
        lines.append(f"- {key}: {value}")
    lines.extend(
        [
            "",
            "Follow this contract exactly: if mode=plan_only, do not execute tools"
            " and clearly state that no action has been taken; if mode=execute_now,"
            " complete the requested action within the granted tools and report the"
            " actual completion state.",
        ]
    )
    return f"{system.rstrip()}{chr(10).join(lines)}"


def _accessible_project_ids(session: Session, owner_user_id: int | None) -> list[int] | None:
    """Project ids the acting user is a member of, for scoping workspace/portfolio
    memory context. Returns ``None`` when there is no acting user (internal/system
    path) — meaning no restriction. Applies to everyone, admins included:
    conversations and project memory are isolated per-user. Project creators are
    auto-added as members, so a user still sees their own projects' memory.
    """
    if owner_user_id is None:
        return None
    return list(
        session.exec(
            select(ProjectMember.project_id).where(ProjectMember.user_id == owner_user_id)
        ).all()
    )


def _accessible_client_ids(session: Session, owner_user_id: int | None) -> list[int] | None:
    """Stable client ids readable by the acting user for RAG filtering."""

    if owner_user_id is None:
        return None
    owner = session.get(User, owner_user_id)
    if owner is None:
        return []
    from app.services.client_permissions import accessible_client_ids

    allowed = accessible_client_ids(session, owner)
    return None if allowed is None else sorted(allowed)


def _resolve_requested_model(session: Session, req: SendMessageRequest) -> str:
    selected_model = get_selected_model(session)
    user_model = (req.model or "").strip()
    if user_model:
        model_lower = user_model.lower()
        known_prefixes = ("claude-", "kimi-", "moonshot-", "deepseek-", "glm-", "mimo-")
        if any(model_lower.startswith(p) for p in known_prefixes):
            selected_model = MODEL_ALIASES.get(user_model, user_model)
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
    question_reanswer_bundle: ProjectQuestionReanswerBundle | None = None

    # Re-answer evidence is a server-prepared, exact-content contract. Resolve
    # it before creating a Conversation or persisting the user Message so an
    # evidence/review drift fails as a normal 409 with no optimistic ghost Turn.
    if req.project_question_reanswer is not None:
        if not req.project_id:
            raise HTTPException(
                status_code=400,
                detail="Project-question re-answer requires a project conversation",
            )
        if req.turn_recovery is not None or req.action_confirmations:
            raise HTTPException(
                status_code=400,
                detail="Project-question re-answer cannot be combined with recovery or actions",
            )
        # A re-answer is governed by its evidence contract, not a Skill
        # workflow. Keep Skill packages available for ordinary Turns while
        # preventing auto-selection from changing this answer-only boundary.
        req.skill_id = None
        req.force_skill = False
        req.disable_skill = True
        reanswer_input = req.project_question_reanswer
        question_reanswer_bundle = resolve_project_question_reanswer_input(
            session,
            project_id=int(req.project_id),
            question=reanswer_input.question,
            question_sha256=reanswer_input.question_sha256,
            contract_sha256=reanswer_input.contract_sha256,
            attachment_ids=reanswer_input.attachment_ids,
        )
        prepare_metrics["project_question_reanswer"] = (
            project_question_reanswer_manifest_reference(
                question_reanswer_bundle.manifest
            )
        )

    # 1. Skill resolution
    _, skill_decision, effective_skill_id, effective_skill = _resolve_effective_skill(session, req)
    if intent_decision is None:
        intent_decision = classify_chat_intent(req, effective_skill_id=effective_skill_id)
    prepare_metrics["skill_decision"] = skill_decision.reason
    prepare_metrics["skill_decision_source"] = skill_decision.source
    prepare_metrics["skill_decision_confidence"] = round(skill_decision.confidence, 3)
    prepare_metrics["skill_catalog_fingerprint"] = skill_decision.catalog_fingerprint
    prepare_metrics["skill_candidate_count"] = skill_decision.candidate_count
    if skill_decision.top_candidates:
        prepare_metrics["skill_top_candidates"] = list(skill_decision.top_candidates)
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
    conversation_skill_changed = False
    if conv is not None and skill_decision.clear_conversation_skill and conv.skill_id and not effective_skill_id:
        conv.skill_id = None
        conversation_skill_changed = True
    elif conv is not None and effective_skill_id and conv.skill_id != effective_skill_id:
        conv.skill_id = effective_skill_id
        conversation_skill_changed = True
    if conversation_skill_changed:
        session.add(conv)
        if req.turn_recovery is not None:
            # Recovery reserves its child run and exact user Message in one
            # router-owned transaction. A stale/duplicate 409 must roll this
            # tentative Skill selection back as well.
            session.flush()
        else:
            session.commit()
            session.refresh(conv)
    prepare_metrics["conversation_ready_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    conv_id = int(conv.id or 0) if conv is not None else 0
    skill_release_assignment = SkillReleaseAssignment()
    if effective_skill is not None:
        effective_skill, skill_release_assignment = resolve_skill_release(
            session,
            effective_skill,
            project_id=req.project_id,
            conversation_id=conv_id or req.conversation_id,
            owner_user_id=owner_user_id,
        )
        prepare_metrics["skill_release_id"] = skill_release_assignment.release_id or ""
        prepare_metrics["skill_release_version"] = effective_skill.package_version
        prepare_metrics["skill_release_sha256"] = effective_skill.package_sha256
        prepare_metrics["skill_rollout_id"] = skill_release_assignment.rollout_id or ""
        prepare_metrics["skill_rollout_variant"] = skill_release_assignment.variant
        prepare_metrics["skill_rollout_bucket"] = (
            skill_release_assignment.bucket
            if skill_release_assignment.bucket is not None
            else ""
        )

    # 3. Persist user message and its auditable turn inputs. Build the current
    # project CAS before recovery so the v2 digest covers the exact world state
    # against which continuation was authorized.
    current_world_state: dict = {}
    world_state_change: dict = {}
    if req.project_id and conv_id:
        previous_world_state = latest_project_world_state(
            session,
            conv_id,
            project_id=req.project_id,
        )
        current_world_state = build_project_world_state_manifest(session, req.project_id)
        world_state_change = compare_project_world_states(previous_world_state, current_world_state)
    turn_recovery = (
        _validated_turn_recovery(
            session,
            req,
            conversation_id=conv_id,
        )
        if conv_id
        else {}
    )
    recovery_steering = ()
    if turn_recovery:
        try:
            recovery_steering = load_recovery_steering_messages(
                session,
                parent_run_id=str(turn_recovery.get("source_run_id") or ""),
                conversation_id=conv_id,
            )
        except DurableRunInputRejected as exc:
            raise TurnRecoveryConflict(
                "Turn recovery steering inputs changed or failed integrity validation"
            ) from exc
        unapplied_ids = [item.message_id for item in recovery_steering if item.status == "unapplied"]
        applied_ids = [item.message_id for item in recovery_steering if item.status == "applied"]
        if (
            unapplied_ids != list(turn_recovery.get("unapplied_input_message_ids") or [])
            or applied_ids != list(turn_recovery.get("applied_input_message_ids") or [])
        ):
            raise TurnRecoveryConflict("Turn recovery steering inputs changed after preview")
    metadata = build_message_metadata(
        project_id=req.project_id,
        skill_id=effective_skill_id,
        rag_doc_ids=req.rag_doc_ids,
        file_ids=req.file_ids,
        mention_context=req.mention_context.model_dump() if req.mention_context else None,
        turn_brief=req.turn_brief.model_dump() if req.turn_brief else None,
        turn_revision=req.turn_revision.model_dump() if req.turn_revision else None,
        turn_setup_trace=req.turn_setup_trace.model_dump() if req.turn_setup_trace else None,
        turn_recovery=turn_recovery or None,
        project_question_reanswer=(
            req.project_question_reanswer.model_dump()
            if req.project_question_reanswer is not None
            else None
        ),
    )
    if isinstance(metadata.get("turn_revision"), dict):
        prepare_metrics["turn_revision"] = dict(metadata["turn_revision"])
    if isinstance(metadata.get("turn_setup_trace"), dict):
        prepare_metrics["turn_setup_trace"] = dict(metadata["turn_setup_trace"])
    if isinstance(metadata.get("turn_recovery"), dict):
        prepare_metrics["turn_recovery"] = dict(metadata["turn_recovery"])
    if req.project_id and conv_id:
        if current_world_state:
            metadata["project_world_state"] = current_world_state
            prepare_metrics["project_world_state"] = current_world_state
        if world_state_change:
            metadata["project_world_state_change"] = world_state_change
            prepare_metrics["project_world_state_change"] = world_state_change
    step_started_at = time.perf_counter()
    if persist_user and conv_id:
        persisted_user_message = persist_user_message(
            session,
            conv_id,
            req.content,
            metadata,
            commit=not bool(turn_recovery),
        )
        if persisted_user_message.id is None:
            raise RuntimeError("persisted chat user message has no identity")
        prepare_metrics["source_user_message_id"] = int(persisted_user_message.id)
    prepare_metrics["user_message_saved_ms"] = round((time.perf_counter() - step_started_at) * 1000)

    # 4. Message history, working memory, and follow-up policy upgrades
    step_started_at = time.perf_counter()
    history = (
        _visible_history_messages(
            get_recent_message_history(session, conv_id, limit=CHAT_HISTORY_WINDOW)
        )
        if conv_id
        else []
    )
    persisted_conversation_state = get_conversation_state_payload(session, conv_id) if conv_id else {}
    working_memory = build_working_memory(history, req.content, persisted_state=persisted_conversation_state)
    intent_decision = _upgrade_policy_for_confirmed_followup(intent_decision, req, history)
    intent_decision = _upgrade_policy_for_artifact_continuation(intent_decision, req, working_memory)
    recovery_steering_message_ids = {item.message_id for item in recovery_steering}
    history_for_model = [
        message
        for message in history
        if getattr(message, "id", None) not in recovery_steering_message_ids
    ]
    if intent_decision.chat_mode in {ChatMode.CROSS_PROJECT_PORTFOLIO, ChatMode.WORKSPACE_INVENTORY}:
        window = MODE_CONFIG.get(intent_decision.chat_mode, MODE_CONFIG[ChatMode.PROJECT_DEEP_DIVE]).history_window
        history_for_model = history_for_model[-max(1, min(window, CHAT_HISTORY_WINDOW)) :]
    current_user_message_id = prepare_metrics.get("source_user_message_id")
    api_messages = _api_messages_with_recovery_steering(
        history_for_model,
        recovery_steering=recovery_steering,
        current_user_message_id=current_user_message_id
        if isinstance(current_user_message_id, int)
        else None,
    )
    prepare_metrics["recovery_steering_input_count"] = len(recovery_steering)
    tool_history_context = _format_recent_tool_history_context(history_for_model)
    prepare_metrics["history_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["history_message_count_loaded"] = len(api_messages)
    prepare_metrics["history_message_count"] = len(api_messages)
    prepare_metrics["working_memory"] = working_memory.to_dict()
    prepare_metrics["tool_history_context_injected"] = bool(tool_history_context)
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
    context_rag_doc_ids = list(req.rag_doc_ids or [])
    if question_reanswer_bundle is not None:
        context_file_ids.extend(question_reanswer_bundle.project_file_ids)
        context_rag_doc_ids.extend(
            question_reanswer_bundle.knowledge_document_ids
        )
        context_file_ids = list(dict.fromkeys(context_file_ids))
        context_rag_doc_ids = list(dict.fromkeys(context_rag_doc_ids))
    current_artifact = working_memory.current_artifact or {}
    current_artifact_file_id = current_artifact.get("project_file_id")
    if current_artifact_file_id and should_continue_current_artifact(working_memory):
        try:
            context_file_ids.append(int(current_artifact_file_id))
        except (TypeError, ValueError):
            pass
        context_file_ids = list(dict.fromkeys(context_file_ids))

    step_started_at = time.perf_counter()
    current_turn_request = format_turn_user_request(req)
    chat_ctx = build_chat_context(
        session=session,
        skill_id=effective_skill_id,
        project_id=req.project_id,
        knowledge_scope=req.knowledge_scope,
        rag_doc_ids=context_rag_doc_ids if context_rag_doc_ids else None,
        file_ids=context_file_ids if context_file_ids else None,
        content=current_turn_request,
        default_max_tokens=max_tokens,
        mention_context=req.mention_context.model_dump() if req.mention_context else None,
        context_mode=context_mode,
        accessible_project_ids=_accessible_project_ids(session, owner_user_id),
        accessible_client_ids=_accessible_client_ids(session, owner_user_id),
        skill_override=effective_skill,
    )
    prepare_metrics["context_loaded_ms"] = round((time.perf_counter() - step_started_at) * 1000)
    prepare_metrics["context_mode"] = context_mode
    prepare_metrics["context_receipt_base"] = dict(chat_ctx.context_receipt or {})

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
    provider_system_contract = system
    if tool_history_context:
        system = f"{system.rstrip()}\n\n{tool_history_context}\n"
    consulting_frame = build_consulting_turn_frame(
        req.content,
        project_id=req.project_id,
        skill_name=effective_skill.name if effective_skill else "",
    )
    intent_frame = _build_intent_frame(intent_decision, skill_decision, effective_skill, context_mode, consulting_frame)
    system = _append_intent_frame(system, intent_frame, consulting_frame)
    world_state_change_prompt = format_project_world_state_change_for_prompt(
        prepare_metrics.get("project_world_state_change")
    )
    if world_state_change_prompt:
        system = f"{system.rstrip()}\n\n{world_state_change_prompt}\n"
    turn_recovery_prompt = format_turn_recovery_for_prompt(
        prepare_metrics.get("turn_recovery")
    )
    if turn_recovery_prompt:
        system = f"{system.rstrip()}\n\n{turn_recovery_prompt}\n"
    question_reanswer_prompt = (
        question_reanswer_bundle.prompt
        if question_reanswer_bundle is not None
        else ""
    )
    if question_reanswer_prompt:
        system = f"{system.rstrip()}\n\n{question_reanswer_prompt}\n"

    # Filter tools BEFORE building the capability frame so the prompt
    # can list the exact tools the LLM will see (Phase 3). The
    # second filter call below is redundant but kept until we're
    # confident this path is the only filter site.
    runtime_tools = filter_tools_for_access(
        chat_ctx.tools,
        intent_decision.action_policy,
        intent_decision.tool_access_policy,
    )
    turn_contract = build_turn_contract(
        intent_decision,
        req,
        tools=runtime_tools,
        skill_applied=bool(effective_skill),
    )
    if question_reanswer_bundle is not None:
        # This contract is narrower than ordinary intent routing: even if the
        # typed request contains execution words, this exact Turn is evidence-
        # grounded answer generation only. Business writes remain in Aria's
        # explicit resolution/HITAS flows.
        runtime_tools = []
        turn_contract = replace(
            turn_contract,
            mode="answer_only",
            needs_tools=False,
            needs_artifact=False,
            artifact_type=None,
            target_scope="project",
            execution_scope="chat_only",
            expected_response="grounded_answer",
            requires_confirmation=False,
            write_allowed=False,
            source="project_question_reanswer_contract",
            reason="current accepted evidence snapshot; new answer only",
        )
    if turn_contract.mode == "plan_only" and runtime_tools:
        runtime_tools = []
        turn_contract = build_turn_contract(
            intent_decision,
            req,
            tools=runtime_tools,
            skill_applied=bool(effective_skill),
        )
    prepare_metrics["turn_contract"] = turn_contract.to_dict()
    system = _append_turn_contract_frame(system, turn_contract.to_dict())
    system = _append_capability_frame(system, intent_decision, runtime_tools)

    # Inject the current user's explicit preferences after removing saved
    # dimensions superseded by this turn. A content-free missing/selection
    # layer is still recorded when there is no usable UserMemory row.
    from app.services.chat.user_memory_prompt import (
        build_user_memory_prompt_bundle,
        load_user_memory_record,
    )

    user_memory_record = load_user_memory_record(session, owner_user_id) or {}
    user_memory_bundle = build_user_memory_prompt_bundle(
        user_memory_record.get("preferences"),
        current_turn_request,
        user_constraints=turn_contract.user_constraints,
        version=int(user_memory_record.get("version") or 0),
    )
    user_memory_section = str(user_memory_bundle.get("prompt") or "")
    user_memory_selection = dict(user_memory_bundle.get("selection") or {})
    receipt_memory = chat_ctx.context_receipt.setdefault("memory", {})
    existing_layers = sorted(
        [
            dict(layer)
            for layer in list(receipt_memory.get("layers") or [])
            if isinstance(layer, dict) and str(layer.get("scope") or "") != "user"
        ],
        key=lambda layer: {"client": 0, "project": 1}.get(
            str(layer.get("scope") or ""), 2
        ),
    )
    receipt_memory["layers"] = [user_memory_selection, *existing_layers]
    prepare_metrics["user_memory_selection"] = user_memory_selection
    prepare_metrics["context_receipt_base"] = dict(chat_ctx.context_receipt or {})
    if user_memory_section:
        system = f"{system.rstrip()}\n\n{user_memory_section}\n"
        prepare_metrics["user_memory_injected"] = True
        prepare_metrics["user_memory_chars"] = len(user_memory_section)
    if user_memory_selection.get("overridden_dimensions"):
        prepare_metrics["user_memory_overridden_dimensions"] = list(
            user_memory_selection["overridden_dimensions"]
        )

    # Conversation Capsule v1 is rebuilt from authoritative current state and
    # message metadata on every turn. It is intentionally provider-neutral and
    # replaces the old unversioned Working Memory prompt representation.
    conversation_capsule = build_conversation_capsule(
        conversation_id=conv_id,
        project_id=req.project_id,
        history=history,
        current_content=req.content,
        working_memory=working_memory,
        turn_contract=turn_contract.to_dict(),
    )
    conversation_capsule_prompt = format_conversation_capsule_for_prompt(
        conversation_capsule
    )
    if conversation_capsule_prompt:
        system = f"{system.rstrip()}\n\n{conversation_capsule_prompt}\n"

    platform_policy_layer = json.dumps(
        {
            "intent_contract": intent_contract.to_dict(),
            "turn_contract": turn_contract.to_dict(),
            "action_policy": intent_decision.action_policy.value,
            "tool_access_policy": intent_decision.tool_access_policy.value,
            "tool_names": [
                str(tool.get("name") or tool.get("function", {}).get("name") or "")
                for tool in (runtime_tools or [])
                if isinstance(tool, dict)
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    active_task_layer = json.dumps(
        {
            "active_artifact": conversation_capsule.get("active_artifact"),
            "active_task": conversation_capsule.get("active_task"),
            "turn_mode": conversation_capsule.get("turn_mode"),
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    instruction_manifest = build_instruction_manifest(
        layers={
            "platform_policy": platform_policy_layer,
            "current_user_request": current_turn_request,
            "project_scope": chat_ctx.project_context,
            "active_task_state": active_task_layer,
            "effective_skill": chat_ctx.skill_prompt,
            "user_preferences": user_memory_section,
            "workspace_evidence": "\n\n".join(
                item
                for item in (chat_ctx.rag_context, question_reanswer_prompt)
                if item
            ),
            "conversation_capsule": conversation_capsule_prompt,
        }
    )
    instruction_precedence_frame = format_instruction_precedence_for_prompt(
        instruction_manifest
    )
    if instruction_precedence_frame:
        system = f"{system.rstrip()}\n\n{instruction_precedence_frame}\n"
    prepare_metrics["conversation_capsule"] = conversation_capsule_reference(
        conversation_capsule
    )
    prepare_metrics["instruction_manifest"] = instruction_manifest_reference(
        instruction_manifest
    )

    # Aria-native context budgeting. This is intentionally provider-neutral and
    # performs no remote compaction call: system context, tool schemas, history,
    # output reserve, and a safety margin share one deterministic budget.
    runtime_max_tokens = _cap_max_tokens_for_model(runtime_model, runtime_max_tokens)
    configured_context_window = (
        get_int_setting(
            session,
            "context_window_tokens",
            DEFAULT_CONTEXT_WINDOW_TOKENS,
        )
        or DEFAULT_CONTEXT_WINDOW_TOKENS
    )
    context_window_tokens = resolve_model_context_window(
        runtime_model,
        default_tokens=configured_context_window,
    )
    context_safety_percent = (
        get_int_setting(
            session,
            "context_window_safety_margin_percent",
            CONTEXT_WINDOW_SAFETY_MARGIN_PERCENT,
        )
        or CONTEXT_WINDOW_SAFETY_MARGIN_PERCENT
    )
    history_summary_tokens = (
        get_int_setting(
            session,
            "context_history_summary_tokens",
            CONTEXT_HISTORY_SUMMARY_TOKENS,
        )
        or CONTEXT_HISTORY_SUMMARY_TOKENS
    )
    context_sources = list(getattr(chat_ctx, "context_sources", ()) or ())
    if question_reanswer_prompt:
        context_sources.append(
            ContextSourceInput(
                source_id="project_question_reanswer_evidence",
                kind="retrieval",
                trust="workspace",
                content=question_reanswer_prompt,
                metadata=project_question_reanswer_manifest_reference(
                    question_reanswer_bundle.manifest
                ),
            )
        )
    context_sources.extend(
        [
            ContextSourceInput(
                source_id="provider_system_contract",
                kind="instructions",
                trust="platform",
                content=provider_system_contract or "",
                metadata={"provider": provider, "model": runtime_model},
            ),
            ContextSourceInput(
                source_id="conversation_capsule",
                kind="memory",
                trust="workspace",
                content=conversation_capsule_prompt or "",
            ),
            ContextSourceInput(
                source_id="recent_tool_history",
                kind="execution_state",
                trust="workspace",
                content=tool_history_context or "",
            ),
            ContextSourceInput(
                source_id="intent_contract",
                kind="policy",
                trust="platform",
                content=json.dumps(
                    {
                        "intent_frame": intent_frame,
                        "consulting_frame": {
                            "job_type": consulting_frame.job_type,
                            "client_moment": consulting_frame.client_moment,
                            "memory_focus": list(consulting_frame.memory_focus),
                            "response_shape": list(consulting_frame.response_shape),
                            "agent_protocol": list(consulting_frame.agent_protocol),
                            "confidence": round(consulting_frame.confidence, 3),
                            "reason": consulting_frame.reason,
                        },
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            ),
            ContextSourceInput(
                source_id="turn_contract",
                kind="policy",
                trust="platform",
                content=json.dumps(
                    turn_contract.to_dict(),
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            ),
            ContextSourceInput(
                source_id="tool_capability_frame",
                kind="policy",
                trust="platform",
                content=json.dumps(
                    {
                        "action_policy": intent_decision.action_policy.value,
                        "tool_access_policy": intent_decision.tool_access_policy.value,
                        "tool_names": [
                            str(tool.get("name") or tool.get("function", {}).get("name") or "")
                            for tool in (runtime_tools or [])
                            if isinstance(tool, dict)
                        ],
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
            ),
            ContextSourceInput(
                source_id="user_preferences",
                kind="preferences",
                trust="user",
                content=user_memory_section or "",
            ),
            ContextSourceInput(
                source_id="instruction_manifest",
                kind="policy",
                trust="platform",
                content=instruction_precedence_frame or "",
                metadata=instruction_manifest_reference(instruction_manifest),
            ),
            ContextSourceInput(
                source_id="project_world_state_change",
                kind="execution_state",
                trust="workspace",
                content=world_state_change_prompt or "",
            ),
            ContextSourceInput(
                source_id="turn_recovery_contract",
                kind="policy",
                trust="platform",
                content=turn_recovery_prompt or "",
            ),
        ]
    )
    initial_transcript = normalize_tool_transcript(api_messages)
    api_messages = initial_transcript.messages
    if initial_transcript.changed:
        prepare_metrics["context_transcript_normalized"] = initial_transcript.metrics()

    context_assembly = assemble_context(
        system=system,
        messages=api_messages,
        tools=runtime_tools,
        sources=context_sources,
        context_window_tokens=context_window_tokens,
        max_output_tokens=runtime_max_tokens,
        safety_margin_percent=context_safety_percent,
        history_summary_tokens=history_summary_tokens,
    )
    system = context_assembly.system
    api_messages = context_assembly.messages
    runtime_tools = context_assembly.tools
    prepare_metrics["context_budget"] = context_assembly.budget_report.to_dict()
    prepare_metrics["context_compacted"] = context_assembly.budget_report.compacted
    prepare_metrics["context_window_tokens"] = context_assembly.budget_report.context_window_tokens
    prepare_metrics["context_manifest"] = context_manifest_reference(context_assembly.manifest)
    prepare_metrics["knowledge_evidence"] = knowledge_evidence_reference(
        chat_ctx.knowledge_evidence_manifest
    )
    prepare_metrics["project_memory_evidence"] = project_memory_evidence_reference(
        chat_ctx.project_memory_evidence_manifest
    )
    if question_reanswer_bundle is not None:
        prepare_metrics["project_question_reanswer"] = (
            project_question_reanswer_manifest_reference(
                question_reanswer_bundle.manifest
            )
        )
    prepare_metrics["history_message_count"] = len(api_messages)
    prepare_metrics["history_summarized_message_count"] = context_assembly.budget_report.summarized_messages
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
    # ``runtime_tools`` already computed above (before capability frame
    # was appended to the system prompt). Reusing the same filtered
    # list keeps "tools the prompt advertises" == "tools the LLM sees".

    return ChatRuntime(
        conv_id=conv_id,
        actor_user_id=owner_user_id,
        project_id=req.project_id,
        selected_model=runtime_model,
        llm=llm,
        system=system,
        api_messages=api_messages,
        rag_sources=chat_ctx.rag_sources,
        knowledge_evidence_manifest=chat_ctx.knowledge_evidence_manifest,
        project_memory_evidence_manifest=chat_ctx.project_memory_evidence_manifest,
        project_question_reanswer_evidence_manifest=(
            question_reanswer_bundle.manifest
            if question_reanswer_bundle is not None
            else None
        ),
        tools=runtime_tools,
        max_tokens=runtime_max_tokens,
        temperature=temperature,
        skill_id=effective_skill_id,
        skill_name=effective_skill.name if effective_skill else "",
        skill_version=effective_skill.package_version if effective_skill else "",
        skill_release_status=effective_skill.package_status if effective_skill else "",
        skill_release_sha256=effective_skill.package_sha256 if effective_skill else "",
        skill_release_id=skill_release_assignment.release_id,
        skill_rollout_id=skill_release_assignment.rollout_id,
        skill_rollout_variant=skill_release_assignment.variant if effective_skill else "",
        skill_rollout_bucket=skill_release_assignment.bucket,
        skill_activation_source=skill_decision.source,
        skill_activation_reason=skill_decision.reason,
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
        conversation_capsule=conversation_capsule,
        instruction_manifest=instruction_manifest,
        context_manifest=context_assembly.manifest,
        context_receipt=chat_ctx.context_receipt,
        intent_prepared_async=intent_prepared_async,
        context_window_tokens=context_window_tokens,
        context_safety_margin_percent=context_safety_percent,
        context_history_summary_tokens=history_summary_tokens,
        model_turn_max_attempts=MODEL_TURN_MAX_ATTEMPTS,
        model_turn_retry_base_delay_ms=MODEL_TURN_RETRY_BASE_DELAY_MS,
        model_turn_retry_max_delay_ms=MODEL_TURN_RETRY_MAX_DELAY_MS,
        tool_parallel_max_concurrency=TOOL_PARALLEL_MAX_CONCURRENCY,
        agent_turn_max_steps=AGENT_TURN_MAX_STEPS,
        agent_turn_max_tool_calls=AGENT_TURN_MAX_TOOL_CALLS,
        agent_turn_timeout_seconds=AGENT_TURN_TIMEOUT_SECONDS,
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

    # Use a configured cheap/fast model for intent classification, with the
    # legacy DeepSeek default and selected-model fallback kept for compatibility.
    router_model, router_provider, router_model_source = _resolve_intent_router_model(session, selected_model)
    router_llm = _load_provider_module(router_provider)

    intent_decision = await classify_chat_intent_async(
        req,
        effective_skill_id=effective_skill_id,
        llm_complete=router_llm.complete,
        model=router_model,
    )
    intent_decision.trace["router_model"] = router_model
    intent_decision.trace["router_provider"] = router_provider
    intent_decision.trace["router_model_source"] = router_model_source
    return prepare_chat_runtime(
        session,
        req,
        intent_decision=intent_decision,
        intent_prepared_async=True,
        owner_user_id=owner_user_id,
        persist_user=persist_user,
        create_conversation=create_conversation,
    )
