"""Tests for the capability frame appended to the chat system prompt.

The frame closes the silent-downgrade failure mode: when the LLM has
no tools available, the prompt now states that explicitly and tells
the LLM how to respond honestly instead of confabulating.
"""
from __future__ import annotations

from app.services.chat.mode_registry import ActionPolicy, ChatMode, ToolAccessPolicy
from app.services.chat.runtime import _append_capability_frame
from app.services.intent_router import IntentDecision


def _decision(
    *,
    action_policy: ActionPolicy = ActionPolicy.READ_ONLY_TOOL,
    tool_access_policy: ToolAccessPolicy = ToolAccessPolicy.READ_ON_DEMAND,
    reason: str = "test_reason",
) -> IntentDecision:
    return IntentDecision(
        chat_mode=ChatMode.PROJECT_DEEP_DIVE,
        action_policy=action_policy,
        task_route=None,
        confidence=0.9,
        reason=reason,
        method="policy_guard",
        tool_access_policy=tool_access_policy,
    )


BASE_PROMPT = "System base prompt content."


def test_frame_lists_tools_when_present():
    decision = _decision(
        action_policy=ActionPolicy.WRITE_ARTIFACT,
        tool_access_policy=ToolAccessPolicy.WRITE_ALLOWED,
        reason="explicit_write",
    )
    tools = [
        {"name": "update_project_markdown_document"},
        {"name": "generate_ppt"},
    ]
    out = _append_capability_frame(BASE_PROMPT, decision, tools)
    assert "## Capability Frame" in out
    assert "action_policy: write_artifact" in out
    assert "tool_access_policy: write_allowed" in out
    assert "routing_reason: explicit_write" in out
    assert "update_project_markdown_document" in out
    assert "generate_ppt" in out
    # Tools present → no "no function-calling tools" message
    assert "NO function-calling tools" not in out


def test_frame_warns_loud_when_no_tools():
    decision = _decision(
        action_policy=ActionPolicy.DIRECT_ANSWER,
        tool_access_policy=ToolAccessPolicy.INJECTED_CONTEXT_ONLY,
        reason="concise_project_summary",
    )
    out = _append_capability_frame(BASE_PROMPT, decision, [])
    assert "## Capability Frame" in out
    assert "tools_granted: (none)" in out
    # The honesty contract — the LLM must not confabulate capability
    assert "NO function-calling tools" in out
    assert "rephrase" in out.lower() or "改成" in out
    assert "concise_project_summary" in out


def test_frame_handles_none_tools_argument():
    decision = _decision(tool_access_policy=ToolAccessPolicy.NONE)
    out = _append_capability_frame(BASE_PROMPT, decision, None)
    assert "tools_granted: (none)" in out
    assert "NO function-calling tools" in out


def test_frame_filters_unnamed_tool_entries():
    # Defensive: a malformed tool dict without a 'name' key should
    # not crash and should not produce a stray empty entry.
    decision = _decision(
        action_policy=ActionPolicy.WRITE_ARTIFACT,
        tool_access_policy=ToolAccessPolicy.WRITE_ALLOWED,
    )
    tools = [
        {"name": "generate_ppt"},
        {},
        {"name": ""},
        {"name": "update_project_markdown_document"},
    ]
    out = _append_capability_frame(BASE_PROMPT, decision, tools)
    assert "generate_ppt" in out
    assert "update_project_markdown_document" in out
    # No double commas (the dropped entries shouldn't leave gaps)
    assert ",," not in out


def test_frame_appends_without_mutating_base():
    decision = _decision()
    out = _append_capability_frame(BASE_PROMPT, decision, None)
    assert out.startswith(BASE_PROMPT)
    assert "## Capability Frame" in out
