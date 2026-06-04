"""Capability resolution — the single decision point that turns
``IntentSignals`` + context into ``(ActionPolicy, ToolAccessPolicy)``.

Phase 1 of the routing refactor: this module **exactly mirrors** the
legacy first-match cascade in ``policy_guards.detect_action_policy``
and ``policy_guards.detect_tool_access_policy``. The point of Phase 1
is to consolidate scattered decision logic into a single, testable
ladder without changing behaviour — so the existing
``backend/tests/golden_chat_set/router_cases.yaml`` regression set
keeps passing.

Phase 4 will reorder the rules to give explicit write intent priority
over read hints (the "结构化记忆 → INJECTED_CONTEXT_ONLY" silent
downgrade bug). Doing the reorder in a separate commit lets us prove
that the *refactor* is harmless before changing *semantics*.

Each rule emits a ``rule_id`` string the observability layer (Phase 2)
logs and surfaces over SSE — that's the canonical answer to "why did
this turn get those tools?".
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.artifact_intent import primary_user_request_text
from app.services.chat.intent_signals import IntentSignals, extract_intent_signals
from app.services.chat.mode_registry import ActionPolicy, ToolAccessPolicy


@dataclass(frozen=True)
class ResolverContext:
    """Inputs the resolver needs beyond the user's text itself."""

    project_id: int | None = None
    force_skill: bool = False
    # Used by ``resolve_tool_access`` when the caller has already
    # computed an action policy (the legacy two-step API). When None,
    # the resolver computes it from signals.
    hint_action_policy: ActionPolicy | None = None


@dataclass(frozen=True)
class ResolvedCapability:
    """Output of a full resolve. Carries both decisions and the
    rule_ids that produced them so observability can log a single
    structured line per request."""

    action_policy: ActionPolicy
    action_policy_rule: str
    action_policy_reason: str
    action_policy_confidence: float
    tool_access: ToolAccessPolicy
    tool_access_rule: str
    signals: IntentSignals


# ──────────────────────────────────────────────────────────────────
# Action policy ladder — mirrors policy_guards.detect_action_policy.
# Each step returns (policy, rule_id, reason, confidence) or None to
# fall through. The original code mixed (policy, reason, confidence);
# we add a stable rule_id for observability.
# ──────────────────────────────────────────────────────────────────


def resolve_action_policy(
    signals: IntentSignals, ctx: ResolverContext
) -> tuple[ActionPolicy, str, str, float]:
    """Mirror of ``policy_guards.detect_action_policy`` cascade order.

    Returns (policy, rule_id, reason, confidence). ``reason`` is the
    legacy reason string preserved verbatim so the YAML golden set
    keeps matching; ``rule_id`` is the new stable identifier.
    """
    if signals.is_empty:
        return ActionPolicy.DIRECT_ANSWER, "action.empty", "empty", 0.99

    if signals.is_destructive:
        return (
            ActionPolicy.DESTRUCTIVE_ACTION,
            "action.destructive",
            "destructive_terms",
            0.98,
        )

    if ctx.project_id and signals.has_project_space_organization_intent:
        return (
            ActionPolicy.MODIFY_EXISTING_FILE,
            "action.project_space_organization",
            "project_space_organization",
            0.94,
        )

    if signals.is_question:
        policy = (
            ActionPolicy.READ_ONLY_TOOL if ctx.project_id else ActionPolicy.DIRECT_ANSWER
        )
        return policy, "action.question", "question", 0.86

    # Explicit modify intent wins over the file-read heuristic (Phase 4:
    # explicit write/modify intent has priority over read hints). A clear
    # edit verb + a document target ("更新一下 plan.md", "把…改成…") must
    # not be downgraded to READ_ONLY just because the message also mentions
    # a file — otherwise the markdown-edit tool is rank-blocked and the edit
    # silently no-ops. Checked before ``is_explicit_file_read`` for that
    # reason; questions are still handled by the earlier ``is_question`` rule.
    if signals.has_explicit_modify_intent:
        return (
            ActionPolicy.MODIFY_EXISTING_FILE,
            "action.explicit_modify",
            "explicit_modify",
            0.93,
        )

    if ctx.project_id and signals.is_explicit_file_read:
        return (
            ActionPolicy.READ_ONLY_TOOL,
            "action.explicit_read",
            "explicit_read",
            0.9,
        )

    if signals.artifact_intent.requested:
        return (
            ActionPolicy.WRITE_ARTIFACT,
            "action.artifact_intent",
            signals.artifact_intent.reason,
            signals.artifact_intent.confidence,
        )

    if signals.has_write_terms or signals.has_create_verbs_with_doc_target:
        return (
            ActionPolicy.WRITE_ARTIFACT,
            "action.explicit_write",
            "explicit_write",
            0.9,
        )

    # Phase 4 — explicit save intent overrides read hints. The
    # legacy cascade silently downgraded "save as X" / "另存为 X"
    # phrasing to DIRECT_ANSWER when it co-occurred with a read hint
    # like "结构化记忆". This rule escalates to WRITE_ARTIFACT so
    # the user actually gets a file out instead of in-chat text.
    if signals.has_save_action_terms:
        return (
            ActionPolicy.WRITE_ARTIFACT,
            "action.save_intent_overrides_read_hints",
            "save_intent",
            0.88,
        )

    if (
        ctx.project_id
        and signals.has_project_analysis_terms
        and not signals.is_explicit_file_read
    ):
        if not signals.references_structured_memory:
            return (
                ActionPolicy.READ_ONLY_TOOL,
                "action.project_analysis_read_exploration",
                "project_analysis_read_exploration",
                0.82,
            )
        return (
            ActionPolicy.DIRECT_ANSWER,
            "action.project_analysis_structured_memory",
            "project_analysis",
            0.82,
        )

    if ctx.project_id and signals.has_concise_summary_terms:
        return (
            ActionPolicy.DIRECT_ANSWER,
            "action.concise_project_summary",
            "concise_project_summary",
            0.88,
        )

    if ctx.force_skill:
        return (
            ActionPolicy.READ_ONLY_TOOL,
            "action.forced_skill",
            "forced_skill",
            0.86,
        )

    return (
        ActionPolicy.READ_ONLY_TOOL if ctx.project_id else ActionPolicy.DIRECT_ANSWER,
        "action.default",
        "default",
        0.72,
    )


# ──────────────────────────────────────────────────────────────────
# Tool access ladder — mirrors policy_guards.detect_tool_access_policy.
# Takes a pre-computed action_policy because the legacy API does;
# downstream callers in ``resolve_capability`` always pass the
# resolver-computed one for consistency.
# ──────────────────────────────────────────────────────────────────

_WRITE_LEANING_ACTION_POLICIES = frozenset(
    {
        ActionPolicy.WRITE_ARTIFACT,
        ActionPolicy.MODIFY_EXISTING_FILE,
        ActionPolicy.DURABLE_TASK,
        ActionPolicy.DESTRUCTIVE_ACTION,
    }
)


def resolve_tool_access(
    signals: IntentSignals, ctx: ResolverContext, action_policy: ActionPolicy
) -> tuple[ToolAccessPolicy, str]:
    """Mirror of ``policy_guards.detect_tool_access_policy`` cascade.

    Returns (tool_access, rule_id). The legacy function only returned
    the policy enum; the rule_id is new and exists for observability.
    """
    if action_policy in _WRITE_LEANING_ACTION_POLICIES:
        return ToolAccessPolicy.WRITE_ALLOWED, "tool.write_allowed_via_action_policy"

    if not ctx.project_id and not ctx.force_skill:
        return ToolAccessPolicy.NONE, "tool.no_project_no_skill"

    if signals.is_explicit_file_read:
        return ToolAccessPolicy.EXPLICIT_FILE_READ, "tool.explicit_file_read"

    if ctx.force_skill:
        return ToolAccessPolicy.READ_ON_DEMAND, "tool.force_skill"

    if ctx.project_id:
        # Phase 4 — second-line guard. If the action ladder didn't
        # escalate (perhaps the artifact_intent detector missed) but
        # signals still carry an explicit write intent, never
        # silently drop to INJECTED_CONTEXT_ONLY. The user asked for
        # something; let the model see tools.
        if signals.has_any_write_intent:
            return (
                ToolAccessPolicy.WRITE_ALLOWED,
                "tool.explicit_write_overrides_read_hints",
            )
        if signals.has_concise_summary_terms or signals.references_structured_memory:
            return (
                ToolAccessPolicy.INJECTED_CONTEXT_ONLY,
                "tool.injected_context_for_summary_or_structured_memory",
            )
        return ToolAccessPolicy.READ_ON_DEMAND, "tool.project_default_read_on_demand"

    return ToolAccessPolicy.NONE, "tool.fallback_none"


# ──────────────────────────────────────────────────────────────────
# One-call API — preferred entry point. Older callers that need only
# one half of the decision keep using detect_action_policy /
# detect_tool_access_policy (the policy_guards wrappers still work).
# ──────────────────────────────────────────────────────────────────


def resolve_capability(
    content: str,
    *,
    project_id: int | None = None,
    force_skill: bool = False,
) -> ResolvedCapability:
    """Extract signals + run both ladders. Single entry point that
    Phase 2 instruments and Phase 3 reads to inject the capability
    frame into the system prompt."""
    signals = extract_intent_signals(
        content, project_id=project_id, force_skill=force_skill
    )
    return _resolve_from_signals(signals, project_id=project_id, force_skill=force_skill)


def resolve_capability_from_routing_content(
    routing_content: str,
    *,
    project_id: int | None = None,
    force_skill: bool = False,
) -> ResolvedCapability:
    """Variant for callers that already ran ``primary_user_request_text``
    and want to avoid re-running it. Behaviour is identical."""
    # extract_intent_signals re-runs primary_user_request_text
    # internally; that's idempotent so calling again is safe and keeps
    # the signal contract honest.
    del routing_content  # pulled fresh inside extract
    return resolve_capability(
        primary_user_request_text(routing_content)
        if routing_content
        else "",
        project_id=project_id,
        force_skill=force_skill,
    )


def _resolve_from_signals(
    signals: IntentSignals,
    *,
    project_id: int | None,
    force_skill: bool,
) -> ResolvedCapability:
    ctx = ResolverContext(project_id=project_id, force_skill=force_skill)
    action_policy, action_rule, action_reason, action_confidence = resolve_action_policy(
        signals, ctx
    )
    tool_access, tool_rule = resolve_tool_access(signals, ctx, action_policy)
    return ResolvedCapability(
        action_policy=action_policy,
        action_policy_rule=action_rule,
        action_policy_reason=action_reason,
        action_policy_confidence=action_confidence,
        tool_access=tool_access,
        tool_access_rule=tool_rule,
        signals=signals,
    )
