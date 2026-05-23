"""Unified intent-router facade for chat and durable task routing.

This module is the single routing boundary for project chat turns.  It combines
three layers:

1. deterministic policy guards for high-confidence safety and UX decisions;
2. deterministic task routing for explicit deliverable / office generation;
3. an optional structured LLM router for ambiguous chat-mode cases.

The important invariant is conservative control: an LLM route can clarify an
ambiguous mode, but it cannot silently upgrade a turn into write, destructive,
or durable execution without deterministic evidence from the user request.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from app.routers.chat_schemas import SendMessageRequest
from app.services.artifact_intent import (
    ArtifactContract,
    allowed_tools_for_output_kind,
    contract_from_artifact_intent,
    contract_from_llm_payload,
    detect_artifact_intent,
)
from app.services.chat.mode_registry import ActionPolicy, ChatMode
from app.services.policy_guards import POLICY_RANK, classify_chat_mode_and_policy
from app.tools.office_documents import WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME

logger = logging.getLogger(__name__)

RULE_FIRST_OVERRIDE_CONFIDENCE = 0.85
LLM_ROUTER_MIN_CONFIDENCE = 0.55
LLM_ARTIFACT_UPGRADE_MIN_CONFIDENCE = 0.78
_CHAT_MODE_VALUES = {mode.value: mode for mode in ChatMode}
_ACTION_POLICY_VALUES = {policy.value: policy for policy in ActionPolicy}
_SAFE_ARTIFACT_TOOLS = {WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME, PROJECT_MARKDOWN_TOOL_NAME}


@dataclass(frozen=True)
class IntentDecision:
    chat_mode: ChatMode
    action_policy: ActionPolicy
    task_route: Any | None
    confidence: float
    reason: str
    method: str
    artifact_contract: ArtifactContract = field(default_factory=ArtifactContract)
    trace: dict[str, Any] = field(default_factory=dict)


def _decision_trace(
    *,
    method: str,
    rule: "IntentDecision | None" = None,
    llm_payload: dict[str, Any] | None = None,
    final_chat_mode: ChatMode | None = None,
    final_action_policy: ActionPolicy | None = None,
    artifact_contract: ArtifactContract | None = None,
    confidence: float | None = None,
    reason: str = "",
) -> dict[str, Any]:
    trace: dict[str, Any] = {
        "method": method,
        "final_chat_mode": final_chat_mode.value if final_chat_mode else "",
        "final_action_policy": final_action_policy.value if final_action_policy else "",
        "confidence": confidence,
        "reason": reason,
    }
    if rule:
        trace["rule_baseline"] = {
            "chat_mode": rule.chat_mode.value,
            "action_policy": rule.action_policy.value,
            "confidence": rule.confidence,
            "reason": rule.reason,
            "method": rule.method,
            "task_type": getattr(rule.task_route, "task_type", None),
            "artifact_contract": rule.artifact_contract.to_dict() if rule.artifact_contract.delivery_required else None,
        }
    if artifact_contract and artifact_contract.delivery_required:
        trace["artifact_contract"] = artifact_contract.to_dict()
    if llm_payload is not None:
        trace["llm_payload"] = llm_payload
    return trace


def _json_object_from_text(text: str) -> dict[str, Any]:
    if not text:
        return {}
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        value = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _coerce_chat_mode(value: Any, fallback: ChatMode) -> ChatMode:
    if isinstance(value, ChatMode):
        return value
    return _CHAT_MODE_VALUES.get(str(value or "").strip(), fallback)


def _coerce_action_policy(value: Any, fallback: ActionPolicy) -> ActionPolicy:
    if isinstance(value, ActionPolicy):
        return value
    return _ACTION_POLICY_VALUES.get(str(value or "").strip(), fallback)


def _confidence(value: Any, fallback: float) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return fallback


def _route_for_rules(content: str) -> Any | None:
    """Return the deterministic project route, including direct-answer guards."""
    from app.services.task_orchestrator import rule_based_project_task_route

    return rule_based_project_task_route(content)


def _task_route_for_rules(content: str) -> Any | None:
    """Return a deterministic task route when the user explicitly asks for one."""
    route = _route_for_rules(content)
    if route.task_type and route.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE:
        return route
    return None


def _task_route_for_contract(contract: ArtifactContract, content: str) -> Any | None:
    if not contract.delivery_required:
        return None
    from app.services.task_orchestrator import task_route_for_artifact_contract

    route = task_route_for_artifact_contract(contract, content)
    return route if getattr(route, "task_type", None) else None


def _clamp_policy(rule_policy: ActionPolicy, proposed_policy: ActionPolicy) -> ActionPolicy:
    """Prevent an LLM from escalating side effects beyond deterministic intent."""
    if POLICY_RANK[proposed_policy] <= POLICY_RANK[rule_policy]:
        return proposed_policy
    if rule_policy in {
        ActionPolicy.WRITE_ARTIFACT,
        ActionPolicy.MODIFY_EXISTING_FILE,
        ActionPolicy.DURABLE_TASK,
        ActionPolicy.DESTRUCTIVE_ACTION,
    }:
        return proposed_policy
    return rule_policy


def _policy_for_high_confidence_direct_route(route: Any, fallback: ActionPolicy) -> ActionPolicy:
    """Remove tools for deterministic answers that should use injected context.

    Project-memory summaries and analyses are already supported by the assembled
    structured project context.  Keeping READ_ONLY_TOOL here exposes read tools
    to the model and encourages unnecessary file inspection before answering.
    """
    reason = str(getattr(route, "reason", "") or "")
    if reason in {
        "rule:direct_memory_summary",
        "rule:direct_project_memory_analysis",
        "rule:direct_diagnostic",
    }:
        return ActionPolicy.DIRECT_ANSWER
    return fallback


def _rule_decision(req: SendMessageRequest, *, effective_skill_id: int | None = None) -> IntentDecision:
    rule_route = None
    if req.force_skill or effective_skill_id:
        task_route = None
    else:
        rule_route = _route_for_rules(req.content) if req.project_id else None
        task_route = (
            rule_route
            if rule_route and rule_route.task_type and rule_route.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE
            else None
        )
    artifact_contract = ArtifactContract()
    if task_route:
        artifact_contract = ArtifactContract(
            delivery_required=True,
            output_kind=getattr(task_route, "output_kind", "") or "",
            title=getattr(task_route, "title", "") or "",
            allowed_tools=allowed_tools_for_output_kind(getattr(task_route, "output_kind", "") or ""),
            confidence=getattr(task_route, "confidence", 0.0) or 0.0,
            reason=getattr(task_route, "reason", "") or "rule_task_router",
            source="rule_task_router",
        )
    if task_route:
        return IntentDecision(
            chat_mode=ChatMode.TASK_ORCHESTRATION,
            action_policy=ActionPolicy.DURABLE_TASK,
            task_route=task_route,
            artifact_contract=artifact_contract,
            confidence=task_route.confidence,
            reason=task_route.reason or "rule:durable_task",
            method="rule_task_router",
            trace=_decision_trace(
                method="rule_task_router",
                final_chat_mode=ChatMode.TASK_ORCHESTRATION,
                final_action_policy=ActionPolicy.DURABLE_TASK,
                artifact_contract=artifact_contract,
                confidence=task_route.confidence,
                reason=task_route.reason or "rule:durable_task",
            ),
        )

    decision = classify_chat_mode_and_policy(
        req.content,
        project_id=req.project_id,
        skill_id=effective_skill_id,
        force_skill=req.force_skill,
    )
    artifact_contract = contract_from_artifact_intent(detect_artifact_intent(req.content), source=decision.method)
    if (
        rule_route
        and not task_route
        and rule_route.response_mode in {"direct", "answer", "analyze", "chat"}
        and rule_route.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE
    ):
        final_policy = _policy_for_high_confidence_direct_route(rule_route, decision.action_policy)
        return IntentDecision(
            chat_mode=decision.chat_mode,
            action_policy=final_policy,
            task_route=None,
            artifact_contract=artifact_contract,
            confidence=rule_route.confidence,
            reason=rule_route.reason,
            method="rule_direct_router",
            trace=_decision_trace(
                method="rule_direct_router",
                final_chat_mode=decision.chat_mode,
                final_action_policy=final_policy,
                artifact_contract=artifact_contract,
                confidence=rule_route.confidence,
                reason=rule_route.reason,
            ),
        )
    return IntentDecision(
        chat_mode=decision.chat_mode,
        action_policy=decision.action_policy,
        task_route=None,
        artifact_contract=artifact_contract,
        confidence=decision.confidence,
        reason=decision.reason,
        method=decision.method,
        trace=_decision_trace(
            method=decision.method,
            final_chat_mode=decision.chat_mode,
            final_action_policy=decision.action_policy,
            artifact_contract=artifact_contract,
            confidence=decision.confidence,
            reason=decision.reason,
        ),
    )


def _can_llm_upgrade_to_artifact(contract: ArtifactContract, confidence: float, req: SendMessageRequest) -> bool:
    if not req.project_id or not contract.delivery_required:
        return False
    if confidence < LLM_ARTIFACT_UPGRADE_MIN_CONFIDENCE:
        return False
    if not contract.output_kind or not contract.allowed_tools:
        return False
    if not set(contract.allowed_tools).issubset(_SAFE_ARTIFACT_TOOLS):
        return False
    return True


def classify_chat_intent(req: SendMessageRequest, *, effective_skill_id: int | None = None) -> IntentDecision:
    """Synchronous deterministic baseline used during runtime preparation."""
    return _rule_decision(req, effective_skill_id=effective_skill_id)


async def classify_chat_intent_async(
    req: SendMessageRequest,
    *,
    effective_skill_id: int | None = None,
    llm_complete: Callable[..., Awaitable[str]] | None = None,
    model: str = "",
) -> IntentDecision:
    """Return the unified route decision.

    High-confidence deterministic routes win immediately.  The LLM router only
    handles ambiguous mode selection and is intentionally prevented from
    escalating side-effect policy.
    """
    rule = _rule_decision(req, effective_skill_id=effective_skill_id)
    if rule.chat_mode == ChatMode.TASK_ORCHESTRATION or rule.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE:
        return rule
    if llm_complete is None:
        return rule

    system = (
        "You are a strict intent router for a project chat assistant. Return only JSON. "
        "Classify the user's turn into chat_mode and action_policy. "
        f"Allowed chat_mode values: {', '.join(sorted(_CHAT_MODE_VALUES))}. "
        f"Allowed action_policy values: {', '.join(sorted(_ACTION_POLICY_VALUES))}. "
        "Use direct_answer for short answers that do not need tools. "
        "Use read_only_tool when the assistant may read project context or files. "
        "Use write_artifact / modify_existing_file / destructive_action only when the user explicitly asks for that side effect. "
        "Use task_orchestration + durable_task for explicit file or office deliverable workflows. "
        "For ambiguous non-destructive deliverable requests, you may return artifact_contract with delivery_required=true, "
        "output_kind, title, and allowed_tools. Only do this when the user wants a real file delivered. "
        "Never infer destructive or write permissions from vague analysis requests."
    )
    prompt = {
        "user_message": req.content,
        "has_project_context": bool(req.project_id),
        "force_skill": bool(req.force_skill or effective_skill_id),
        "rule_baseline": {
            "chat_mode": rule.chat_mode.value,
            "action_policy": rule.action_policy.value,
            "confidence": rule.confidence,
            "reason": rule.reason,
        },
        "response_schema": {
            "chat_mode": "standalone_qa|project_deep_dive|cross_project_portfolio|workspace_inventory|skill_execution|task_orchestration",
            "action_policy": "direct_answer|read_only_tool|write_artifact|modify_existing_file|durable_task|destructive_action",
            "confidence": "number 0-1",
            "reason": "short string",
            "artifact_contract": {
                "delivery_required": "boolean; true only when a real file/artifact must be created",
                "output_kind": "pptx|xlsx|docx|pdf|md",
                "title": "short artifact title, if clear",
                "allowed_tools": [
                    WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
                    PROJECT_MARKDOWN_TOOL_NAME,
                ],
            },
        },
    }
    try:
        raw = await llm_complete(
            [{"role": "user", "content": json.dumps(prompt, ensure_ascii=False)}],
            system=system,
            model=model,
            max_tokens=500,
            temperature=0,
        )
        data = _json_object_from_text(raw or "")
    except Exception as exc:
        logger.warning("Intent LLM router failed; using rule decision: %s", exc)
        return rule

    proposed_mode = _coerce_chat_mode(data.get("chat_mode"), rule.chat_mode)
    proposed_policy = _coerce_action_policy(data.get("action_policy"), rule.action_policy)
    confidence = _confidence(data.get("confidence"), rule.confidence)
    if confidence < LLM_ROUTER_MIN_CONFIDENCE:
        return IntentDecision(
            chat_mode=rule.chat_mode,
            action_policy=rule.action_policy,
            task_route=rule.task_route,
            artifact_contract=rule.artifact_contract,
            confidence=rule.confidence,
            reason=rule.reason,
            method=rule.method,
            trace=_decision_trace(
                method="llm_low_confidence_fallback",
                rule=rule,
                llm_payload=data,
                final_chat_mode=rule.chat_mode,
                final_action_policy=rule.action_policy,
                artifact_contract=rule.artifact_contract,
                confidence=rule.confidence,
                reason=rule.reason,
            ),
        )

    final_policy = _clamp_policy(rule.action_policy, proposed_policy)
    proposed_contract = contract_from_llm_payload(data)
    proposed_route = None
    if _can_llm_upgrade_to_artifact(proposed_contract, confidence, req):
        proposed_route = _task_route_for_contract(proposed_contract, req.content)
        if proposed_route is not None:
            proposed_mode = ChatMode.TASK_ORCHESTRATION
            final_policy = ActionPolicy.DURABLE_TASK
    if proposed_mode == ChatMode.TASK_ORCHESTRATION and final_policy != ActionPolicy.DURABLE_TASK:
        proposed_mode = rule.chat_mode
        proposed_route = None
    if rule.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE and (
        proposed_mode != rule.chat_mode or final_policy != rule.action_policy
    ):
        logger.warning(
            "Intent router disagreement; using high-confidence rule decision",
            extra={
                "rule_chat_mode": rule.chat_mode.value,
                "rule_action_policy": rule.action_policy.value,
                "rule_confidence": rule.confidence,
                "llm_chat_mode": proposed_mode.value,
                "llm_action_policy": proposed_policy.value,
                "llm_confidence": confidence,
                "request_preview": (req.content or "")[:120],
            },
        )
        return IntentDecision(
            chat_mode=rule.chat_mode,
            action_policy=rule.action_policy,
            task_route=rule.task_route,
            artifact_contract=rule.artifact_contract,
            confidence=rule.confidence,
            reason=rule.reason,
            method=rule.method,
            trace=_decision_trace(
                method="rule_override_llm",
                rule=rule,
                llm_payload=data,
                final_chat_mode=rule.chat_mode,
                final_action_policy=rule.action_policy,
                artifact_contract=rule.artifact_contract,
                confidence=rule.confidence,
                reason=rule.reason,
            ),
        )

    final_contract = proposed_contract if proposed_route is not None else rule.artifact_contract
    return IntentDecision(
        chat_mode=proposed_mode,
        action_policy=final_policy,
        task_route=proposed_route,
        artifact_contract=final_contract,
        confidence=confidence,
        reason=str(data.get("reason") or rule.reason or "llm_router"),
        method="llm_router",
        trace=_decision_trace(
            method="llm_router",
            rule=rule,
            llm_payload=data,
            final_chat_mode=proposed_mode,
            final_action_policy=final_policy,
            artifact_contract=final_contract,
            confidence=confidence,
            reason=str(data.get("reason") or rule.reason or "llm_router"),
        ),
    )


async def route_task_intent(
    content: str,
    *,
    llm_complete: Callable[..., Awaitable[str]] | None = None,
    model: str = "",
) -> Any:
    from app.services.task_orchestrator import route_project_task_request

    return await route_project_task_request(content, llm_complete=llm_complete, model=model)
