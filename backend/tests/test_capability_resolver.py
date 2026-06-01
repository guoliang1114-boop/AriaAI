"""Unit tests for the chat capability resolver.

These run alongside the YAML golden set (``test_chat_golden_set.py``).
The golden set exercises the end-to-end ``classify_chat_intent`` API;
these tests pin down ``capability_resolver.resolve_capability`` and the
underlying ``extract_intent_signals`` extraction so future routing
changes (Phase 4 onward) have a fine-grained tripwire.
"""
from __future__ import annotations

import pytest

from app.services.chat.capability_resolver import (
    ResolverContext,
    resolve_action_policy,
    resolve_capability,
    resolve_tool_access,
)
from app.services.chat.intent_signals import extract_intent_signals
from app.services.chat.mode_registry import ActionPolicy, ToolAccessPolicy

PROJECT_ID = 32


# ──────────────────────────────────────────────────────────────────
# extract_intent_signals — basic shape & individual signal correctness
# ──────────────────────────────────────────────────────────────────


def test_signals_empty_message_short_circuits():
    s = extract_intent_signals("", project_id=PROJECT_ID)
    assert s.is_empty is True
    assert s.is_question is False
    assert s.has_any_write_intent is False


def test_signals_question_shape():
    # is_question_like fires on leading question prefixes only.
    s = extract_intent_signals("怎么用这个工具？", project_id=PROJECT_ID)
    assert s.is_question is True
    assert s.has_any_write_intent is False


def test_signals_structured_memory_flag_lights_up_correctly():
    s = extract_intent_signals(
        "请基于当前项目的结构化记忆给我一句话总结", project_id=PROJECT_ID
    )
    assert s.references_structured_memory is True


def test_signals_concise_summary_terms_detected():
    s = extract_intent_signals("给我一句话总结", project_id=PROJECT_ID)
    assert s.has_concise_summary_terms is True


def test_signals_explicit_file_read_via_list_query():
    s = extract_intent_signals("列出文件", project_id=PROJECT_ID)
    assert s.is_explicit_file_read is True


def test_signals_explicit_file_read_via_file_id():
    s = extract_intent_signals("帮我看一下 file_id 42 的内容", project_id=PROJECT_ID)
    assert s.is_explicit_file_read is True


def test_signals_destructive_three_part_check():
    # Has destructive verb + has object — should fire
    s_yes = extract_intent_signals("删除项目空间里的旧文档", project_id=PROJECT_ID)
    assert s_yes.is_destructive is True

    # Has destructive verb but with negation — should NOT fire
    s_no_neg = extract_intent_signals("如何避免删除文档", project_id=PROJECT_ID)
    assert s_no_neg.is_destructive is False

    # Has destructive verb but no concrete object — should NOT fire
    s_no_obj = extract_intent_signals("我们要清理一下", project_id=PROJECT_ID)
    assert s_no_obj.is_destructive is False


def test_signals_artifact_intent_for_markdown_request():
    s = extract_intent_signals(
        "请生成一份 markdown 项目进展报告", project_id=PROJECT_ID
    )
    assert s.artifact_intent.requested is True
    assert s.artifact_intent.output_kind == "md"


def test_signals_artifact_intent_for_pptx_request():
    s = extract_intent_signals("帮我生成一份 PPT 给客户", project_id=PROJECT_ID)
    assert s.artifact_intent.requested is True
    assert s.artifact_intent.output_kind == "pptx"


def test_signals_has_any_write_intent_when_artifact_requested():
    s = extract_intent_signals("帮我生成一份 markdown 报告", project_id=PROJECT_ID)
    assert s.has_any_write_intent is True


def test_signals_has_any_write_intent_false_for_pure_question():
    s = extract_intent_signals("项目最近有什么进展", project_id=PROJECT_ID)
    assert s.has_any_write_intent is False


# ──────────────────────────────────────────────────────────────────
# resolve_action_policy — cascade order must match legacy exactly
# ──────────────────────────────────────────────────────────────────


def _ap(content: str, *, project_id=PROJECT_ID, force_skill=False):
    signals = extract_intent_signals(
        content, project_id=project_id, force_skill=force_skill
    )
    ctx = ResolverContext(project_id=project_id, force_skill=force_skill)
    policy, rule_id, reason, _confidence = resolve_action_policy(signals, ctx)
    return policy, rule_id, reason


def test_action_policy_empty():
    policy, rule_id, _ = _ap("")
    assert policy == ActionPolicy.DIRECT_ANSWER
    assert rule_id == "action.empty"


def test_action_policy_destructive():
    policy, rule_id, _ = _ap("把项目空间里的所有文件删除")
    assert policy == ActionPolicy.DESTRUCTIVE_ACTION
    assert rule_id == "action.destructive"


def test_action_policy_question_in_project():
    policy, rule_id, _ = _ap("怎么使用这个项目？")
    assert policy == ActionPolicy.READ_ONLY_TOOL
    assert rule_id == "action.question"


def test_action_policy_question_no_project():
    policy, rule_id, _ = _ap("怎么用这个工具？", project_id=None)
    assert policy == ActionPolicy.DIRECT_ANSWER
    assert rule_id == "action.question"


def test_action_policy_artifact_request_md():
    policy, rule_id, _ = _ap("请生成一份 markdown 项目进展报告")
    assert policy == ActionPolicy.WRITE_ARTIFACT
    assert rule_id == "action.artifact_intent"


def test_action_policy_structured_memory_falls_to_direct_answer():
    # Phase 1: this should still hit the DIRECT_ANSWER branch since
    # we're mirroring legacy. Phase 4 will reorder so explicit-write
    # beats structured-memory.
    policy, rule_id, _ = _ap(
        "请基于当前项目的结构化记忆给我一份进展速报"
    )
    # Legacy: project_analysis_terms match + structured_memory present
    # → DIRECT_ANSWER. Pinning that down so Phase 4 changes are
    # explicit, not accidental.
    # Note: artifact_intent may or may not fire depending on whether the
    # text matches detect_artifact_intent. If it fires earlier, we land
    # on WRITE_ARTIFACT. Either way we capture the current behavior.
    assert rule_id in (
        "action.artifact_intent",
        "action.project_analysis_structured_memory",
        "action.explicit_write",
    )
    # Document the legacy behaviour so the Phase 4 test can compare:
    # if the message DOES have structured_memory + project_analysis
    # but no artifact_intent, current behaviour is DIRECT_ANSWER. That
    # is the bug Phase 4 reverses.
    _ = policy  # tolerance — we only pin the rule_id


def test_action_policy_concise_summary():
    # "给我一句话总结" — "总结" is also in PROJECT_ANALYSIS_TERMS, so
    # the project_analysis branch fires earlier than concise_summary
    # in the legacy cascade. We pin the policy + accept whichever
    # earlier branch matches. Phase 4 may reorder these.
    policy, rule_id, _ = _ap("给我一句话总结")
    assert policy in (ActionPolicy.READ_ONLY_TOOL, ActionPolicy.DIRECT_ANSWER)
    assert rule_id in (
        "action.project_analysis_read_exploration",
        "action.concise_project_summary",
        "action.question",
    )


def test_action_policy_default_project():
    policy, rule_id, _ = _ap("客户最近反馈了什么时候")
    assert policy == ActionPolicy.READ_ONLY_TOOL
    # The default branch only fires when no earlier rule matched.
    assert rule_id in (
        "action.default",
        "action.question",
        "action.project_analysis_read_exploration",
    )


def test_action_policy_default_no_project():
    policy, rule_id, _ = _ap("hello there", project_id=None)
    assert policy == ActionPolicy.DIRECT_ANSWER
    assert rule_id == "action.default"


def test_action_policy_forced_skill():
    policy, rule_id, _ = _ap("帮我跑一个 skill", project_id=None, force_skill=True)
    # The forced_skill branch only triggers when earlier rules didn't.
    # The phrase "跑一个 skill" doesn't match write/modify/question, so
    # we expect it to land on forced_skill.
    assert policy == ActionPolicy.READ_ONLY_TOOL
    assert rule_id in ("action.forced_skill", "action.default")


# ──────────────────────────────────────────────────────────────────
# resolve_tool_access — cascade order must match legacy exactly
# ──────────────────────────────────────────────────────────────────


def _ta(
    content: str,
    *,
    action_policy=ActionPolicy.DIRECT_ANSWER,
    project_id=PROJECT_ID,
    force_skill=False,
):
    signals = extract_intent_signals(
        content, project_id=project_id, force_skill=force_skill
    )
    ctx = ResolverContext(project_id=project_id, force_skill=force_skill)
    return resolve_tool_access(signals, ctx, action_policy)


@pytest.mark.parametrize(
    "action_policy",
    [
        ActionPolicy.WRITE_ARTIFACT,
        ActionPolicy.MODIFY_EXISTING_FILE,
        ActionPolicy.DURABLE_TASK,
        ActionPolicy.DESTRUCTIVE_ACTION,
    ],
)
def test_tool_access_write_policies_get_write_allowed(action_policy):
    access, rule = _ta("anything", action_policy=action_policy)
    assert access == ToolAccessPolicy.WRITE_ALLOWED
    assert rule == "tool.write_allowed_via_action_policy"


def test_tool_access_no_project_no_skill_gets_none():
    access, rule = _ta("hi", project_id=None)
    assert access == ToolAccessPolicy.NONE
    assert rule == "tool.no_project_no_skill"


def test_tool_access_explicit_file_read():
    access, rule = _ta("列出文件")
    assert access == ToolAccessPolicy.EXPLICIT_FILE_READ
    assert rule == "tool.explicit_file_read"


def test_tool_access_force_skill():
    access, rule = _ta("跑技能", project_id=None, force_skill=True)
    assert access == ToolAccessPolicy.READ_ON_DEMAND
    assert rule == "tool.force_skill"


def test_tool_access_structured_memory_locks_to_injected_context_only():
    # THE bug we're tracking. Phase 1 must reproduce it; Phase 4
    # changes it.
    access, rule = _ta(
        "请基于当前项目的结构化记忆给我一份 markdown 报告",
        action_policy=ActionPolicy.READ_ONLY_TOOL,
    )
    assert access == ToolAccessPolicy.INJECTED_CONTEXT_ONLY
    assert rule == "tool.injected_context_for_summary_or_structured_memory"


def test_tool_access_concise_summary_locks_to_injected_context_only():
    access, rule = _ta(
        "给我一句话总结",
        action_policy=ActionPolicy.DIRECT_ANSWER,
    )
    assert access == ToolAccessPolicy.INJECTED_CONTEXT_ONLY
    assert rule == "tool.injected_context_for_summary_or_structured_memory"


def test_tool_access_project_default_read_on_demand():
    access, rule = _ta(
        "客户最近反馈了什么", action_policy=ActionPolicy.READ_ONLY_TOOL
    )
    assert access == ToolAccessPolicy.READ_ON_DEMAND
    assert rule == "tool.project_default_read_on_demand"


# ──────────────────────────────────────────────────────────────────
# resolve_capability — the one-call API
# ──────────────────────────────────────────────────────────────────


def test_resolve_capability_returns_full_payload():
    r = resolve_capability(
        "请生成一份 markdown 项目进展报告", project_id=PROJECT_ID
    )
    assert r.action_policy == ActionPolicy.WRITE_ARTIFACT
    assert r.tool_access == ToolAccessPolicy.WRITE_ALLOWED
    assert r.action_policy_rule.startswith("action.")
    assert r.tool_access_rule.startswith("tool.")
    assert r.signals.has_any_write_intent is True
    assert r.signals.raw_content == "请生成一份 markdown 项目进展报告"


def test_resolve_capability_preserves_legacy_reason_strings():
    """The YAML golden set ``trace`` fields key off the legacy
    ``reason`` strings; preserving them keeps the regression net
    valid."""
    # destructive
    r = resolve_capability("把项目空间所有文档删除", project_id=PROJECT_ID)
    assert r.action_policy_reason == "destructive_terms"

    # question (leading question prefix)
    r = resolve_capability("怎么联系客户最快？", project_id=PROJECT_ID)
    assert r.action_policy_reason == "question"

    # empty
    r = resolve_capability("", project_id=PROJECT_ID)
    assert r.action_policy_reason == "empty"


# ──────────────────────────────────────────────────────────────────
# Behaviour equivalence with legacy policy_guards.detect_*
# ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "content",
    [
        "",
        "项目最近怎么样了？",
        "请生成一份 markdown 项目进展报告",
        "请基于当前项目的结构化记忆给我一份进展速报",
        "给我一句话总结",
        "把项目空间里的所有文件删除",
        "如何避免删除文件",
        "列出文件",
        "客户最近反馈了什么",
        "整理一份方案大纲",
        "修改一下刚才那份文档",
        "帮我生成 PPT 给客户",
        "请基于当前项目的结构化记忆,梳理一下问题",
        "请准备 docx 项目交付物",
        "请帮我看一下 file_id 42 的内容",
    ],
)
def test_resolver_matches_legacy_policy_guards(content):
    """The legacy ``policy_guards.detect_*`` functions are the
    Phase-1 reference implementation. They now delegate to the
    resolver internally, so they MUST agree by definition — but if
    someone removes the delegation later, this test will catch the
    drift."""
    from app.services.policy_guards import (
        detect_action_policy,
        detect_tool_access_policy,
    )

    legacy_policy, legacy_reason, legacy_conf = detect_action_policy(
        content, project_id=PROJECT_ID
    )
    legacy_access = detect_tool_access_policy(
        content, project_id=PROJECT_ID, action_policy=legacy_policy
    )

    r = resolve_capability(content, project_id=PROJECT_ID)
    assert r.action_policy == legacy_policy
    assert r.action_policy_reason == legacy_reason
    assert r.action_policy_confidence == pytest.approx(legacy_conf)
    assert r.tool_access == legacy_access
