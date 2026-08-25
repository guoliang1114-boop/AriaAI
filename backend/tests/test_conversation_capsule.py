from __future__ import annotations

import json
import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services.agent_harness.conversation_capsule import (
    advance_conversation_capsule,
    build_conversation_capsule,
    conversation_capsule_reference,
    format_conversation_capsule_for_prompt,
    validate_conversation_capsule,
)
from app.services.chat.working_memory import WorkingMemory
from app.services.chat.persist import run_persist
from app.services.chat.state import ChatSessionState
from app.services.conversation_state import merge_user_constraints
from app.services.agent_harness.instruction_manifest import build_instruction_manifest


def _memory(**overrides):
    values = {
        "current_artifact": {
            "project_file_id": 183,
            "name": "项目背景.md",
            "file_type": "md",
            "path": "/private/path/must-not-persist",
        },
        "current_task": {"id": 7, "task_type": "analysis", "status": "running"},
        "last_assistant_summary": "已经完成现状分析。",
        "user_constraints": ["必须使用正式语气", "输出为 Markdown"],
        "decisions": [{"message_id": 9, "summary": ["已读取项目材料"]}],
    }
    values.update(overrides)
    return WorkingMemory(**values)


def _contract(goal: str = "继续完善项目背景") -> dict:
    return {"mode": "execute_now", "user_goal": goal}


def test_capsule_is_deterministic_bounded_and_current_constraint_wins() -> None:
    history = [
        SimpleNamespace(
            id=10,
            role="assistant",
            metadata_json=json.dumps(
                {
                    "tool_calls": [
                        {
                            "tool_use_id": "call-read-1",
                            "tool_name": "read_project_file",
                            "status": "completed",
                            "summary": "读取完成",
                            "input": {"secret": "must-not-persist"},
                            "output": {"secret": "must-not-persist"},
                        }
                    ]
                },
                ensure_ascii=False,
            ),
        )
    ]

    first = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=history,
        current_content="不用正式语气，改成简洁口语；仍输出为 Markdown",
        working_memory=_memory(),
        turn_contract=_contract(),
    )
    second = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=history,
        current_content="不用正式语气，改成简洁口语；仍输出为 Markdown",
        working_memory=_memory(),
        turn_contract=_contract(),
    )

    assert first == second
    assert validate_conversation_capsule(first) == (True, "valid")
    assert first["confirmed_constraints"][:3] == [
        "不用正式语气",
        "改成简洁口语",
        "仍输出为 Markdown",
    ]
    assert "必须使用正式语气" not in first["confirmed_constraints"]
    assert "输出为 Markdown" not in first["confirmed_constraints"]
    assert first["active_artifact"]["name"] == "项目背景.md"
    assert "path" not in first["active_artifact"]
    rendered = json.dumps(first, ensure_ascii=False)
    assert "must-not-persist" not in rendered
    assert "input" not in first["tool_outcomes"][0]
    assert "output" not in first["tool_outcomes"][0]


def test_capsule_fingerprint_rejects_tampering_and_prompt_marks_authority_boundary() -> None:
    capsule = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=[],
        current_content="继续",
        working_memory=_memory(),
        turn_contract=_contract(),
    )
    prompt = format_conversation_capsule_for_prompt(capsule)

    assert "untrusted historical continuation state" in prompt
    assert "current user's explicit request overrides" in prompt
    assert capsule["capsule_sha256"] in prompt

    tampered = deepcopy(capsule)
    tampered["active_goal"] = "tampered"
    assert validate_conversation_capsule(tampered) == (
        False,
        "capsule_fingerprint_mismatch",
    )
    assert conversation_capsule_reference(tampered)["valid"] is False

    extra_field = deepcopy(capsule)
    extra_field["raw_tool_input"] = {"secret": "no"}
    assert validate_conversation_capsule(extra_field) == (
        False,
        "capsule_fields_mismatch",
    )


def test_capsule_chains_same_project_but_rejects_cross_project_state() -> None:
    first = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=[],
        current_content="分析项目 A",
        working_memory=_memory(),
        turn_contract=_contract("分析项目 A"),
    )
    first = advance_conversation_capsule(
        first,
        tool_events=[
            {
                "tool_use_id": "call-a",
                "tool_name": "read_project_file",
                "status": "completed",
                "summary": "项目 A 已读取",
            }
        ],
        assistant_summary="项目 A 分析完成",
    )
    message = SimpleNamespace(
        id=20,
        role="assistant",
        metadata_json=json.dumps({"conversation_capsule": first}, ensure_ascii=False),
    )

    same_project = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=[message],
        current_content="继续",
        working_memory=_memory(),
        turn_contract=_contract(),
    )
    other_project = build_conversation_capsule(
        conversation_id=4,
        project_id=23,
        history=[message],
        current_content="分析项目 B",
        working_memory=_memory(),
        turn_contract=_contract("分析项目 B"),
    )

    assert same_project["previous_capsule_sha256"] == first["capsule_sha256"]
    assert same_project["tool_outcomes"][0]["summary"] == "项目 A 已读取"
    assert 20 in same_project["source_message_ids"]
    assert other_project["previous_capsule_sha256"] == ""
    assert other_project["tool_outcomes"] == []


def test_capsule_only_clears_failure_with_explicit_linked_recovery() -> None:
    capsule = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=[],
        current_content="更新材料",
        working_memory=_memory(),
        turn_contract=_contract("更新材料"),
    )
    failed = advance_conversation_capsule(
        capsule,
        tool_events=[
            {
                "tool_use_id": "call-write-1",
                "tool_name": "write_project_file",
                "status": "error",
                "summary": "写入失败",
            }
        ],
    )
    unrelated_success = advance_conversation_capsule(
        failed,
        tool_events=[
            {
                "tool_use_id": "call-write-2",
                "tool_name": "write_project_file",
                "status": "completed",
                "summary": "另一文件写入完成",
            }
        ],
    )
    recovered = advance_conversation_capsule(
        unrelated_success,
        tool_events=[
            {
                "tool_use_id": "call-write-3",
                "retry_of_tool_use_id": "call-write-1",
                "tool_name": "write_project_file",
                "status": "completed",
                "summary": "重试成功",
            }
        ],
    )

    assert failed and len(failed["blockers"]) == 1
    assert unrelated_success and len(unrelated_success["blockers"]) == 1
    assert recovered and recovered["blockers"] == []


def test_capsule_confirmation_blocker_clears_after_matching_resolution() -> None:
    pending = SimpleNamespace(
        id=30,
        role="assistant",
        metadata_json=json.dumps(
            {
                "pending_tool_confirmations": [
                    {"confirmation_token": "confirm-write-1"}
                ]
            }
        ),
    )
    resolved = SimpleNamespace(
        id=31,
        role="assistant",
        metadata_json=json.dumps(
            {"resolved_action_confirmations": ["confirm-write-1"]}
        ),
    )

    waiting = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=[pending],
        current_content="继续",
        working_memory=_memory(),
        turn_contract=_contract(),
    )
    cleared = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=[pending, resolved],
        current_content="继续",
        working_memory=_memory(),
        turn_contract=_contract(),
    )

    assert any(blocker["kind"] == "waiting_confirmation" for blocker in waiting["blockers"])
    assert not any(blocker["kind"] == "waiting_confirmation" for blocker in cleared["blockers"])


def test_constraint_merge_preserves_unrelated_dimensions_and_retires_superseded_tone() -> None:
    merged = merge_user_constraints(
        ["必须使用正式语气", "输出为 Markdown"],
        "不用正式语气，改成简洁口语",
    )

    assert merged == ["不用正式语气", "改成简洁口语", "输出为 Markdown"]


def test_structured_constraints_are_retained_without_keyword_guessing() -> None:
    merged = merge_user_constraints(
        ["使用口语", "输出为 Markdown"],
        "继续分析",
        structured_constraints=["使用正式专业语气", "沿用董事会风险分级"],
    )

    assert merged == ["使用正式专业语气", "沿用董事会风险分级", "输出为 Markdown"]


def test_persist_finalizes_capsule_and_saves_instruction_manifest() -> None:
    capsule = build_conversation_capsule(
        conversation_id=4,
        project_id=22,
        history=[],
        current_content="更新材料",
        working_memory=_memory(),
        turn_contract=_contract("更新材料"),
    )
    instruction_manifest = build_instruction_manifest(
        layers={"platform_policy": "policy", "current_user_request": "更新材料"}
    )
    runtime = MagicMock()
    runtime.conv_id = 4
    runtime.project_id = 22
    runtime.rag_sources = None
    runtime.knowledge_evidence_manifest = {}
    runtime.skill_name = ""
    runtime.action_policy = "direct_answer"
    runtime.artifact_contract = None
    runtime.working_memory = {}
    runtime.conversation_capsule = capsule
    runtime.instruction_manifest = instruction_manifest
    runtime.context_manifest = None
    runtime.prepare_metrics = {}
    req = SimpleNamespace(
        project_id=22,
        content="更新材料",
        action_confirmations=[],
    )
    state = ChatSessionState()
    state.full_text = "已给出更新建议。"
    state.record_tool_execution(
        {
            "tool_use_id": "call-read-2",
            "tool_name": "read_project_file",
            "status": "completed",
            "summary": "读取完成",
        }
    )

    async def _run() -> dict:
        with patch("app.services.chat.persist.persist_assistant_message") as mock_persist, \
             patch("app.services.chat.persist.persist_run_artifacts") as mock_artifacts, \
             patch("app.services.chat.persist.persist_chat_trace"):
            mock_persist.return_value = (False, 99)
            mock_artifacts.return_value = []
            async for _ in run_persist(runtime, req, MagicMock(), state):
                pass
            return mock_persist.call_args.args[4]

    metadata = asyncio.run(_run())

    persisted_capsule = metadata["conversation_capsule"]
    assert validate_conversation_capsule(persisted_capsule) == (True, "valid")
    assert persisted_capsule["tool_outcomes"][-1]["tool_use_id"] == "call-read-2"
    assert persisted_capsule["last_assistant_summary"] == "已给出更新建议。"
    assert metadata["instruction_manifest"] == instruction_manifest
