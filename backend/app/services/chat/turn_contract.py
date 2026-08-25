"""Product-level contract for one chat turn.

Intent routing answers "what policy is allowed?".  The turn contract answers a
more user-facing question: "is this turn an answer, a plan, or an execution?".
Keeping that contract explicit makes plan mode, capability diagnostics, and
execution truth checks speak the same language.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy


TURN_MODES = {"answer_only", "plan_only", "execute_now", "plan_then_execute"}
MAX_TURN_BRIEF_CONSTRAINTS = 8
MAX_TURN_BRIEF_CONSTRAINT_CHARS = 160

_PLAN_ONLY_TERMS = (
    "先给我计划",
    "先列计划",
    "先规划",
    "只要计划",
    "不要执行",
    "先不要执行",
    "不执行",
    "只分析",
    "只回答",
    "不要修改",
    "不修改项目",
    "不要写入",
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
    user_constraints: tuple[str, ...] = field(default_factory=tuple)
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
            "user_constraints": list(self.user_constraints),
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


def _compact_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _turn_brief_values(req) -> tuple[str, tuple[str, ...]]:
    brief = getattr(req, "turn_brief", None)
    explicit_goal = _compact_text(getattr(brief, "goal", ""), 240)
    constraints: list[str] = []
    for item in list(getattr(brief, "constraints", None) or []):
        normalized = _compact_text(item, MAX_TURN_BRIEF_CONSTRAINT_CHARS)
        if normalized and normalized not in constraints:
            constraints.append(normalized)
        if len(constraints) >= MAX_TURN_BRIEF_CONSTRAINTS:
            break
    goal = explicit_goal or _compact_text(getattr(req, "content", ""), 240)
    return goal, tuple(constraints)


def format_turn_user_request(req) -> str:
    """Compose the model/context-facing request without changing policy input."""

    content = str(getattr(req, "content", "") or "").strip()
    brief = getattr(req, "turn_brief", None)
    explicit_goal = _compact_text(getattr(brief, "goal", ""), 240)
    _, constraints = _turn_brief_values(req)
    sections = [content]
    if explicit_goal and explicit_goal not in content:
        sections.append(f"明确本轮目标：{explicit_goal}")
    if constraints:
        sections.append("明确本轮约束：\n" + "\n".join(f"- {item}" for item in constraints))
    return "\n\n".join(section for section in sections if section)


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
    user_goal, user_constraints = _turn_brief_values(req)
    explicit_mode = _coerce_turn_mode(getattr(intent_decision, "turn_mode", ""))
    turn_text = "\n".join([
        str(getattr(req, "content", "") or ""),
        user_goal,
        *user_constraints,
    ])
    restrictive_plan_only = any(term in turn_text.lower() for term in _PLAN_ONLY_TERMS)
    inferred_mode = _infer_turn_mode(
        turn_text,
        write_allowed=write_allowed,
        delivery_required=delivery_required,
    )
    turn_mode = "plan_only" if restrictive_plan_only else explicit_mode or inferred_mode
    if turn_mode == "plan_only":
        write_allowed = False

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

    requires_confirmation = turn_mode != "plan_only" and (
        policy in {
            ActionPolicy.MODIFY_EXISTING_FILE,
            ActionPolicy.DESTRUCTIVE_ACTION,
        }
        or _policy_value(policy) in {
            ActionPolicy.MODIFY_EXISTING_FILE.value,
            ActionPolicy.DESTRUCTIVE_ACTION.value,
        }
    )

    return TurnContract(
        mode=turn_mode,
        user_goal=user_goal,
        user_constraints=user_constraints,
        needs_tools=has_tools,
        needs_artifact=delivery_required and turn_mode != "plan_only",
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
