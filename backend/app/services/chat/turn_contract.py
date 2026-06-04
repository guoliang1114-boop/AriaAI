"""Product-level contract for one chat turn.

Intent routing answers "what policy is allowed?".  The turn contract answers a
more user-facing question: "is this turn an answer, a plan, or an execution?".
Keeping that contract explicit makes plan mode, capability diagnostics, and
execution truth checks speak the same language.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy


TURN_MODES = {"answer_only", "plan_only", "execute_now", "plan_then_execute"}

_PLAN_ONLY_TERMS = (
    "先给我计划",
    "先列计划",
    "先规划",
    "只要计划",
    "不要执行",
    "先不要执行",
    "不执行",
    "plan only",
    "do not execute",
    "don't execute",
)
_PLAN_THEN_EXECUTE_TERMS = (
    "先计划再执行",
    "先规划再执行",
    "先给计划再执行",
    "plan then execute",
)


@dataclass(frozen=True)
class TurnContract:
    mode: str
    user_goal: str
    needs_tools: bool
    needs_artifact: bool
    artifact_type: str | None = None
    target_scope: str = "chat"
    execution_scope: str = "chat_only"
    expected_response: str = "answer"
    requires_confirmation: bool = False
    write_allowed: bool = False
    confidence: float = 0.0
    source: str = ""
    reason: str = ""
    missing_info: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "user_goal": self.user_goal,
            "needs_tools": self.needs_tools,
            "needs_artifact": self.needs_artifact,
            "artifact_type": self.artifact_type,
            "target_scope": self.target_scope,
            "execution_scope": self.execution_scope,
            "expected_response": self.expected_response,
            "requires_confirmation": self.requires_confirmation,
            "write_allowed": self.write_allowed,
            "confidence": self.confidence,
            "source": self.source,
            "reason": self.reason,
            "missing_info": list(self.missing_info),
        }


def _policy_value(item: Any) -> str:
    return str(getattr(item, "value", item) or "")


def _coerce_turn_mode(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in TURN_MODES else ""


def _infer_turn_mode(content: str, *, write_allowed: bool, delivery_required: bool) -> str:
    text = (content or "").strip().lower()
    if any(term in text for term in _PLAN_THEN_EXECUTE_TERMS):
        return "plan_then_execute"
    if any(term in text for term in _PLAN_ONLY_TERMS):
        return "plan_only"
    if write_allowed or delivery_required:
        return "execute_now"
    return "answer_only"


def build_turn_contract(
    intent_decision,
    req,
    *,
    tools: list[dict] | None = None,
    skill_applied: bool = False,
) -> TurnContract:
    """Build a single structured product contract for this turn."""

    artifact_contract = getattr(intent_decision, "artifact_contract", None)
    delivery_required = bool(getattr(artifact_contract, "delivery_required", False))
    artifact_type = str(getattr(artifact_contract, "output_kind", "") or "") or None
    access = getattr(intent_decision, "tool_access_policy", ToolAccessPolicy.NONE)
    policy = getattr(intent_decision, "action_policy", ActionPolicy.DIRECT_ANSWER)
    mode = getattr(intent_decision, "chat_mode", ChatMode.STANDALONE_QA)
    write_allowed = access == ToolAccessPolicy.WRITE_ALLOWED or _policy_value(access) == ToolAccessPolicy.WRITE_ALLOWED.value
    has_tools = bool(tools)
    explicit_mode = _coerce_turn_mode(getattr(intent_decision, "turn_mode", ""))
    turn_mode = explicit_mode or _infer_turn_mode(
        getattr(req, "content", ""),
        write_allowed=write_allowed,
        delivery_required=delivery_required,
    )

    if mode == ChatMode.TASK_ORCHESTRATION or _policy_value(mode) == ChatMode.TASK_ORCHESTRATION.value:
        expected_response = "artifact_with_progress"
    elif turn_mode == "plan_only":
        expected_response = "plan_without_execution"
    elif skill_applied or mode == ChatMode.SKILL_EXECUTION or _policy_value(mode) == ChatMode.SKILL_EXECUTION.value:
        expected_response = "skill_workflow_result"
    elif delivery_required:
        expected_response = f"{artifact_type or 'artifact'}_deliverable"
    elif has_tools:
        expected_response = "grounded_answer"
    else:
        expected_response = "direct_answer"

    if getattr(req, "project_id", None):
        target_scope = "project"
    elif mode in {ChatMode.CROSS_PROJECT_PORTFOLIO, ChatMode.WORKSPACE_INVENTORY} or _policy_value(mode) in {
        ChatMode.CROSS_PROJECT_PORTFOLIO.value,
        ChatMode.WORKSPACE_INVENTORY.value,
    }:
        target_scope = "workspace"
    else:
        target_scope = "chat"

    if write_allowed:
        execution_scope = "project_write" if getattr(req, "project_id", None) else "workspace_write"
    elif has_tools:
        execution_scope = "read_tools"
    elif target_scope == "project":
        execution_scope = "injected_project_context"
    else:
        execution_scope = "chat_only"

    requires_confirmation = policy in {
        ActionPolicy.MODIFY_EXISTING_FILE,
        ActionPolicy.DESTRUCTIVE_ACTION,
    } or _policy_value(policy) in {
        ActionPolicy.MODIFY_EXISTING_FILE.value,
        ActionPolicy.DESTRUCTIVE_ACTION.value,
    }

    return TurnContract(
        mode=turn_mode,
        user_goal=str(getattr(req, "content", "") or "").strip()[:240],
        needs_tools=has_tools,
        needs_artifact=delivery_required,
        artifact_type=artifact_type,
        target_scope=target_scope,
        execution_scope=execution_scope,
        expected_response=expected_response,
        requires_confirmation=requires_confirmation,
        write_allowed=write_allowed,
        confidence=float(getattr(intent_decision, "confidence", 0.0) or 0.0),
        source=str(getattr(intent_decision, "method", "") or ""),
        reason=str(getattr(intent_decision, "reason", "") or ""),
    )
