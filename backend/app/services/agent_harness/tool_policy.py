"""Tri-state tool policy evaluation for the Aria agent loop.

The ``allow / prompt / forbidden`` decision model is adapted from OpenAI
Codex's ``codex-rs/execpolicy/src/decision.rs`` at upstream commit
``343074d4207d572809bd8cea15f4be1d09d98e0b`` (Apache License 2.0).

Modified for AriaAI on 2026-08-22: the decision is evaluated against Aria's
domain-level ``ActionPolicy`` and HITAS rules, not shell commands or a Codex
sandbox. This module does not communicate with Codex.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from app.services.chat.mode_registry import ActionPolicy
from app.services.policy_guards import policy_allows_tool


class PolicyDecision(str, Enum):
    ALLOW = "allow"
    PROMPT = "prompt"
    FORBIDDEN = "forbidden"


_PROMPT_POLICIES = frozenset(
    {
        ActionPolicy.MODIFY_EXISTING_FILE,
        ActionPolicy.DESTRUCTIVE_ACTION,
    }
)


@dataclass(frozen=True)
class ToolPolicyEvaluation:
    decision: PolicyDecision
    reason: str
    required_policy: ActionPolicy

    @property
    def may_plan(self) -> bool:
        return self.decision is not PolicyDecision.FORBIDDEN

    @property
    def requires_confirmation(self) -> bool:
        return self.decision is PolicyDecision.PROMPT


def evaluate_tool_policy(
    action_policy: ActionPolicy | str,
    tool_name: str,
    tool_input: dict[str, Any] | None = None,
) -> ToolPolicyEvaluation:
    """Return one explicit policy outcome for a proposed Aria tool action."""

    allowed, reason, required_policy = policy_allows_tool(
        action_policy,
        tool_name,
        tool_input,
    )
    if not allowed:
        return ToolPolicyEvaluation(
            decision=PolicyDecision.FORBIDDEN,
            reason=reason,
            required_policy=required_policy,
        )
    if required_policy in _PROMPT_POLICIES:
        return ToolPolicyEvaluation(
            decision=PolicyDecision.PROMPT,
            reason="hitas_confirmation_required",
            required_policy=required_policy,
        )
    return ToolPolicyEvaluation(
        decision=PolicyDecision.ALLOW,
        reason="allowed",
        required_policy=required_policy,
    )
