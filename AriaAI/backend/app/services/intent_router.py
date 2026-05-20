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
from app.services.chat.mode_registry import ActionPolicy, ChatMode
from app.services.policy_guards import POLICY_RANK, classify_chat_mode_and_policy

logger = logging.getLogger(__name__)

RULE_FIRST_OVERRIDE_CONFIDENCE = 0.85
LLM_ROUTER_MIN_CONFIDENCE = 0.55
_CHAT_MODE_VALUES = {mode.value: mode for mode in ChatMode}
_ACTION_POLICY_VALUES = {policy.value: policy for policy in ActionPolicy}


@dataclass(frozen=True)
class IntentDecision:
    chat_mode: ChatMode
    action_policy: ActionPolicy
    task_route: Any | None
    confidence: float
    reason: str
    method: str
    trace: dict[str, Any] = field(default_factory=dict)


def _decision_trace(
    *,
    method: str,
    rule: "IntentDecision | None" = None,
    llm_payload: dict[str, Any] | None = None,
    final_chat_mode: ChatMode | None = None,
    final_action_policy: ActionPolicy | None = None,
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
        }
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


def _task_route_for_rules(content: str) -> Any | None:
    """Return a deterministic task route when the user explicitly asks for one."""
    from app.services.task_orchestrator import rule_based_project_task_route

    route = rule_based_project_task_route(content)
    if route.task_type and route.confidence >= RULE_FIRST_OVERRIDE_CONFIDENCE:
        return route
    return None


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


def _rule_decision(req: SendMessageRequest, *, effective_skill_id: int | None = None) -> IntentDecision:
    task_route = _task_route_for_rules(req.content) if req.project_id else None
    if task_route:
        return IntentDecision(
            chat_mode=ChatMode.TASK_ORCHESTRATION,
            action_policy=ActionPolicy.DURABLE_TASK,
            task_route=task_route,
            confidence=task_route.confidence,
            reason=task_route.reason or "rule:durable_task",
            method="rule_task_router",
            trace=_decision_trace(
                method="rule_task_router",
                final_chat_mode=ChatMode.TASK_ORCHESTRATION,
                final_action_policy=ActionPolicy.DURABLE_TASK,
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
    return IntentDecision(
        chat_mode=decision.chat_mode,
        action_policy=decision.action_policy,
        task_route=None,
        confidence=decision.confidence,
        reason=decision.reason,
        method=decision.method,
        trace=_decision_trace(
            method=decision.method,
            final_chat_mode=decision.chat_mode,
            final_action_policy=decision.action_policy,
            confidence=decision.confidence,
            reason=decision.reason,
        ),
    )


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
            confidence=rule.confidence,
            reason=rule.reason,
            method=rule.method,
            trace=_decision_trace(
                method="llm_low_confidence_fallback",
                rule=rule,
                llm_payload=data,
                final_chat_mode=rule.chat_mode,
                final_action_policy=rule.action_policy,
                confidence=rule.confidence,
                reason=rule.reason,
            ),
        )

    final_policy = _clamp_policy(rule.action_policy, proposed_policy)
    if proposed_mode == ChatMode.TASK_ORCHESTRATION and final_policy != ActionPolicy.DURABLE_TASK:
        proposed_mode = rule.chat_mode
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
            confidence=rule.confidence,
            reason=rule.reason,
            method=rule.method,
            trace=_decision_trace(
                method="rule_override_llm",
                rule=rule,
                llm_payload=data,
                final_chat_mode=rule.chat_mode,
                final_action_policy=rule.action_policy,
                confidence=rule.confidence,
                reason=rule.reason,
            ),
        )

    return IntentDecision(
        chat_mode=proposed_mode,
        action_policy=final_policy,
        task_route=None,
        confidence=confidence,
        reason=str(data.get("reason") or rule.reason or "llm_router"),
        method="llm_router",
        trace=_decision_trace(
            method="llm_router",
            rule=rule,
            llm_payload=data,
            final_chat_mode=proposed_mode,
            final_action_policy=final_policy,
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
