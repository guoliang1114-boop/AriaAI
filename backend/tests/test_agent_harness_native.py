from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.agent_harness.context_budget import (
    apply_context_budget,
    approx_token_count,
    resolve_model_context_window,
    truncate_middle_with_token_budget,
)
from app.services.agent_harness.output_buffer import HeadTailBuffer, serialize_tool_output
from app.services.agent_harness.skill_package import (
    SkillPackageError,
    load_skill_package_prompt,
    parse_skill_document,
)
from app.services.agent_harness.tool_policy import PolicyDecision, evaluate_tool_policy
from app.services.chat.mode_registry import ActionPolicy
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME


def test_token_estimator_and_middle_truncation_follow_codex_byte_budget() -> None:
    assert approx_token_count("abcd") == 1
    assert approx_token_count("战略规划") == 3

    text = "prefix-" + ("中" * 100) + "-suffix"
    truncated, original_tokens = truncate_middle_with_token_budget(text, 24)

    assert original_tokens == approx_token_count(text)
    assert truncated.startswith("prefix")
    assert truncated.endswith("suffix")
    assert "tokens truncated" in truncated
    assert approx_token_count(truncated) <= 24


def test_model_context_window_uses_explicit_suffix_before_default() -> None:
    assert resolve_model_context_window("moonshot-v1-8k", default_tokens=32_768) == 8_000
    assert resolve_model_context_window("provider-model-128k-preview", default_tokens=32_768) == 128_000
    assert resolve_model_context_window("claude-sonnet", default_tokens=32_768) == 32_768


def test_context_budget_leaves_short_requests_unchanged() -> None:
    messages = [
        {"role": "user", "content": "Please summarize the project."},
        {"role": "assistant", "content": "Here is the summary."},
    ]
    result = apply_context_budget(
        system="You are AriaAI.",
        messages=messages,
        tools=None,
        context_window_tokens=8_000,
        max_output_tokens=1_000,
    )

    assert result.system == "You are AriaAI."
    assert result.messages == messages
    assert result.messages is not messages
    assert result.report.compacted is False
    assert result.report.history_messages_after == 2
    assert result.report.compaction_strategy == "none"
    assert result.report.summary_injected is False
    assert result.report.oldest_retained_message_index == 0


def test_context_budget_does_not_preemptively_truncate_large_system_that_fits() -> None:
    system = "SYSTEM-START\n" + ("policy " * 1_800) + "\nSYSTEM-END"
    messages = [{"role": "user", "content": "CURRENT-REQUEST"}]

    result = apply_context_budget(
        system=system,
        messages=messages,
        tools=None,
        context_window_tokens=8_000,
        max_output_tokens=1_000,
    )

    assert result.system == system
    assert result.messages == messages
    assert result.report.compacted is False
    assert result.report.estimated_total_after == result.report.estimated_total_before


def test_context_budget_compacts_old_history_and_preserves_latest_tail() -> None:
    messages = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"message-{index}-" + ("detail " * 300),
        }
        for index in range(12)
    ]
    messages[-1]["content"] += "LATEST-END"
    result = apply_context_budget(
        system="Aria system instructions. " + ("policy " * 300),
        messages=messages,
        tools=None,
        context_window_tokens=4_096,
        max_output_tokens=512,
        minimum_recent_messages=4,
        history_summary_tokens=512,
    )

    assert result.report.compacted is True
    assert result.report.summarized_messages > 0
    assert result.report.compaction_strategy == "recent_turns_with_bounded_excerpts"
    assert result.report.summary_injected is True
    assert "older_history_summarized" in result.report.compaction_reason_codes
    assert result.report.oldest_retained_message_index == result.report.summarized_messages
    assert result.report.history_messages_after >= 4
    assert result.messages[-1]["content"].endswith("LATEST-END")
    assert "Earlier Conversation — Compacted Excerpts" in result.system
    assert result.report.estimated_total_after <= (
        result.report.context_window_tokens - result.report.safety_margin_tokens
    )


def test_context_budget_truncates_oversized_system_and_counts_tools() -> None:
    tools = [
        {
            "name": "read_project_file",
            "description": "Read a project file " + ("safely " * 100),
            "input_schema": {"type": "object", "properties": {"file_id": {"type": "integer"}}},
        }
    ]
    result = apply_context_budget(
        system="SYSTEM-START\n" + ("project context " * 2_000) + "\nSYSTEM-END",
        messages=[{"role": "user", "content": "CURRENT-REQUEST"}],
        tools=tools,
        context_window_tokens=4_096,
        max_output_tokens=512,
    )

    assert result.report.system_tokens_after < result.report.system_tokens_before
    assert result.report.tool_tokens > 0
    assert result.system.startswith("SYSTEM-START")
    assert result.system.endswith("SYSTEM-END")
    assert result.messages[-1]["content"] == "CURRENT-REQUEST"
    assert result.report.estimated_total_after <= (
        result.report.context_window_tokens - result.report.safety_margin_tokens
    )


def test_context_budget_keeps_short_tool_batch_structured_and_deep_copied() -> None:
    messages = [
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "call_1",
                    "name": "search",
                    "input": {"query": "Aria"},
                }
            ],
            "reasoning_content": "Need current evidence.",
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "call_1",
                    "content": '{"ok":true}',
                }
            ],
        },
    ]

    result = apply_context_budget(
        system="system",
        messages=messages,
        tools=None,
        context_window_tokens=8_000,
        max_output_tokens=512,
    )

    assert result.messages == messages
    assert result.messages[0]["content"] is not messages[0]["content"]
    assert result.report.compacted is False
    assert result.report.structured_messages_before == 2
    assert result.report.structured_messages_after == 2
    assert result.report.tool_batches_before == 1
    assert result.report.tool_batches_after == 1


def test_context_budget_compacts_large_tool_output_without_breaking_pair() -> None:
    messages = [
        {
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"history-{index}-" + ("context " * 350),
        }
        for index in range(6)
    ]
    messages.extend(
        [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "call_large",
                        "name": "read_project_file",
                        "input": {"file_id": 7, "selection": "detail " * 1_000},
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "call_large",
                        "content": json.dumps(
                            {"ok": True, "content": "RESULT-START " + ("data " * 8_000) + " RESULT-END"}
                        ),
                    }
                ],
            },
        ]
    )

    result = apply_context_budget(
        system="Aria system " + ("policy " * 400),
        messages=messages,
        tools=None,
        context_window_tokens=4_096,
        max_output_tokens=512,
        minimum_recent_messages=2,
        history_summary_tokens=256,
    )

    assert result.report.compacted is True
    assert result.report.tool_batches_before == 1
    assert result.report.tool_batches_after == 1
    assistant, tool_output = result.messages[-2:]
    assert isinstance(assistant["content"], list)
    assert assistant["content"][0]["type"] == "tool_use"
    assert assistant["content"][0]["id"] == "call_large"
    assert isinstance(assistant["content"][0]["input"], dict)
    assert isinstance(tool_output["content"], list)
    assert tool_output["content"][0]["type"] == "tool_result"
    assert tool_output["content"][0]["tool_use_id"] == "call_large"
    compacted_payload = json.loads(tool_output["content"][0]["content"])
    assert compacted_payload["_aria_compacted"] is True
    assert result.report.estimated_total_after <= (
        result.report.context_window_tokens - result.report.safety_margin_tokens
    )


def test_context_budget_drops_old_tool_batch_as_one_history_unit() -> None:
    messages = [
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "old_call",
                    "name": "search",
                    "input": {"query": "old " * 2_000},
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "old_call",
                    "content": "old result " * 3_000,
                }
            ],
        },
    ]
    messages.extend(
        {"role": "user" if index % 2 == 0 else "assistant", "content": "recent " * 500}
        for index in range(6)
    )

    result = apply_context_budget(
        system="system " + ("policy " * 300),
        messages=messages,
        tools=None,
        context_window_tokens=4_096,
        max_output_tokens=512,
        minimum_recent_messages=4,
        history_summary_tokens=256,
    )

    retained = json.dumps(result.messages, ensure_ascii=False)
    assert "old_call" not in retained
    assert result.report.tool_batches_before == 1
    assert result.report.tool_batches_after == 0
    assert result.report.summarized_messages >= 2


def test_context_budget_counts_and_truncates_reasoning_content() -> None:
    reasoning = "REASONING-START " + ("analysis " * 8_000) + " REASONING-END"
    messages = [
        {
            "role": "assistant",
            "content": "Working on the request.",
            "reasoning_content": reasoning,
        },
        {"role": "user", "content": "Give me the conclusion."},
    ]

    result = apply_context_budget(
        system="system",
        messages=messages,
        tools=None,
        context_window_tokens=4_096,
        max_output_tokens=512,
        minimum_recent_messages=2,
        history_summary_tokens=0,
    )

    compacted_reasoning = result.messages[0]["reasoning_content"]
    assert result.report.compacted is True
    assert len(compacted_reasoning) < len(reasoning)
    assert "tokens truncated" in compacted_reasoning
    assert result.report.estimated_total_after <= (
        result.report.context_window_tokens - result.report.safety_margin_tokens
    )


def test_head_tail_buffer_preserves_stable_prefix_and_latest_suffix() -> None:
    buffer = HeadTailBuffer(max_bytes=10)
    buffer.push_chunk(b"abcdef")
    buffer.push_chunk(b"ghijkl")

    assert buffer.to_bytes() == b"abcdehijkl"
    assert buffer.retained_bytes == 10
    assert buffer.omitted_bytes == 2
    assert buffer.total_bytes == 12
    assert "2 bytes omitted" in buffer.to_text()


def test_serialize_tool_output_keeps_small_payload_unchanged() -> None:
    encoded = serialize_tool_output({"ok": True, "message": "done"}, max_bytes=128)
    assert json.loads(encoded) == {"ok": True, "message": "done"}


def test_serialize_tool_output_compacts_only_model_feedback_copy() -> None:
    payload = {"content": "start-" + ("x" * 200) + "-end"}
    encoded = serialize_tool_output(payload, max_bytes=40)
    compacted = json.loads(encoded)

    assert compacted["aria_truncated_tool_output"] is True
    assert compacted["omitted_bytes"] > 0
    assert "start" in compacted["preview"]
    assert "end" in compacted["preview"]


def test_tool_policy_uses_explicit_allow_prompt_forbidden_outcomes() -> None:
    allowed = evaluate_tool_policy(
        ActionPolicy.READ_ONLY_TOOL,
        READ_MARKDOWN_TOOL_NAME,
        {"action": "read"},
    )
    prompt = evaluate_tool_policy(
        ActionPolicy.MODIFY_EXISTING_FILE,
        PROJECT_MARKDOWN_TOOL_NAME,
        {"mode": "replace"},
    )
    forbidden = evaluate_tool_policy(
        ActionPolicy.DIRECT_ANSWER,
        PROJECT_MARKDOWN_TOOL_NAME,
        {"mode": "create"},
    )

    assert allowed.decision is PolicyDecision.ALLOW
    assert prompt.decision is PolicyDecision.PROMPT
    assert prompt.requires_confirmation is True
    assert forbidden.decision is PolicyDecision.FORBIDDEN
    assert forbidden.may_plan is False


def test_parse_skill_document_repairs_ambiguous_description_scalar() -> None:
    document = parse_skill_document(
        """---
name: aws-helper
description: Build for AWS: ECS
metadata:
  short-description: AWS deployment helper
---
Follow the approved deployment workflow.
""",
        default_name="fallback",
    )

    assert document.name == "aws-helper"
    assert document.description == "Build for AWS: ECS"
    assert document.short_description == "AWS deployment helper"
    assert document.instructions == "Follow the approved deployment workflow."


def test_all_repository_skill_packages_satisfy_native_contract() -> None:
    skills_root = Path(__file__).resolve().parents[2] / "skills"
    skill_paths = sorted(skills_root.glob("*/SKILL.md"))

    assert skill_paths
    for skill_path in skill_paths:
        parse_skill_document(
            skill_path.read_text(encoding="utf-8"),
            default_name=skill_path.parent.name,
        )


def test_load_skill_package_prompt_adds_selected_reference(tmp_path: Path) -> None:
    skill_dir = tmp_path / "demo"
    references_dir = skill_dir / "references"
    references_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        """---
name: demo
description: Demonstration skill
---
Main instructions.
""",
        encoding="utf-8",
    )
    (references_dir / "guide.md").write_text("Reference details.", encoding="utf-8")

    prompt = load_skill_package_prompt(skill_dir, ["guide.md"])

    assert prompt.startswith("Main instructions.")
    assert "## Bundled Reference: guide.md" in prompt
    assert "Reference details." in prompt


def test_load_skill_package_prompt_rejects_reference_escape(tmp_path: Path) -> None:
    skill_dir = tmp_path / "demo"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        """---
name: demo
description: Demonstration skill
---
Main instructions.
""",
        encoding="utf-8",
    )
    (tmp_path / "outside.md").write_text("secret", encoding="utf-8")

    with pytest.raises(SkillPackageError, match="escapes skill package root"):
        load_skill_package_prompt(skill_dir, ["../outside.md"])
