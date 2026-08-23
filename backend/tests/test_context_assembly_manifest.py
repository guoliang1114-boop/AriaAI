from __future__ import annotations

import json
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.services.agent_harness.run_evaluation import (
    CompletionVerdict,
    evaluate_run_completion,
)
from app.services.agent_harness.run_rollout import reconstruct_rollout
from app.services.agent_harness.conversation_capsule import build_conversation_capsule
from app.services.agent_harness.instruction_manifest import build_instruction_manifest
from app.services.chat.working_memory import WorkingMemory
from app.services.chat.state import ChatSessionState
from app.services.chat.trace import build_chat_trace_payload
from app.services.chat.agent_loop import run_agent_loop
from app.services.chat_tools import ChatRuntime
from app.routers.chat_schemas import SendMessageRequest
from app.services.context_builder.assembly import (
    CONTEXT_ASSEMBLY_SCHEMA_VERSION,
    ContextSourceInput,
    assemble_context,
    validate_context_assembly_manifest,
    validate_context_assembly_request,
)


def _assembly(*, oversized: bool = False):
    secret = "PRIVATE-CUSTOMER-ALPHA"
    system = "system instructions\n" + (("long context 机密 " * 8_000) if oversized else secret)
    messages = [
        {"role": "user", "content": f"current request {secret}"},
        {"role": "assistant", "content": "prior answer"},
    ]
    tools = [
        {
            "name": "read_project_file",
            "description": "read one project file",
            "input_schema": {"type": "object", "properties": {}},
        }
    ]
    return assemble_context(
        system=system,
        messages=messages,
        tools=tools,
        sources=[
            ContextSourceInput(
                source_id="workspace_context",
                kind="workspace",
                trust="workspace",
                content=f"customer facts {secret}",
                metadata={"project_scoped": True},
            ),
            ContextSourceInput(
                source_id="retrieved_knowledge",
                kind="retrieval",
                trust="retrieved",
                content="retrieved evidence",
                metadata={"reference_count": 1},
            ),
        ],
        context_window_tokens=4_096,
        max_output_tokens=512,
        safety_margin_percent=8,
        history_summary_tokens=256,
    )


def test_context_assembly_manifest_is_bounded_private_and_matches_request() -> None:
    assembly = _assembly()
    manifest = assembly.manifest

    assert manifest["schema_version"] == CONTEXT_ASSEMBLY_SCHEMA_VERSION
    assert [source["source_id"] for source in manifest["sources"]] == [
        "workspace_context",
        "retrieved_knowledge",
        "conversation_history",
        "tool_catalog",
    ]
    assert manifest["summary"]["source_count"] == 4
    assert manifest["model_input"]["messages"]["message_count"] == 2
    assert manifest["model_input"]["tools"]["tool_count"] == 1
    assert "PRIVATE-CUSTOMER-ALPHA" not in json.dumps(manifest, ensure_ascii=False)
    assert validate_context_assembly_manifest(manifest) == (True, "valid")
    assert validate_context_assembly_request(
        manifest,
        system=assembly.system,
        messages=assembly.messages,
        tools=assembly.tools,
    ) == (True, "valid")

    changed_messages = deepcopy(assembly.messages)
    changed_messages[-1]["content"] = "tampered"
    assert validate_context_assembly_request(
        manifest,
        system=assembly.system,
        messages=changed_messages,
        tools=assembly.tools,
    ) == (False, "messages_request_mismatch")


def test_context_assembly_compacts_before_fingerprinting_final_request() -> None:
    assembly = _assembly(oversized=True)

    assert assembly.manifest["summary"]["compacted"] is True
    assert assembly.manifest["summary"]["system_compacted"] is True
    assert (
        assembly.manifest["budget"]["estimated_total_after"]
        <= assembly.manifest["budget"]["context_window_tokens"]
        - assembly.manifest["budget"]["safety_margin_tokens"]
    )
    assert validate_context_assembly_manifest(assembly.manifest) == (True, "valid")
    assert validate_context_assembly_request(
        assembly.manifest,
        system=assembly.system,
        messages=assembly.messages,
        tools=assembly.tools,
    ) == (True, "valid")


def test_context_assembly_rejects_duplicate_source_ids_and_tampering() -> None:
    duplicate = ContextSourceInput(
        source_id="workspace_context",
        kind="workspace",
        trust="workspace",
        content="one",
    )
    with pytest.raises(ValueError, match="duplicate context source id"):
        assemble_context(
            system="system",
            messages=[],
            tools=None,
            sources=[duplicate, duplicate],
            context_window_tokens=4_096,
            max_output_tokens=512,
        )

    manifest = deepcopy(_assembly().manifest)
    manifest["sources"][0]["chars"] += 1
    assert validate_context_assembly_manifest(manifest) == (
        False,
        "manifest_fingerprint_mismatch",
    )


def test_trace_and_rollout_reuse_the_same_context_manifest() -> None:
    assembly = _assembly()
    runtime = ChatRuntime(
        conv_id=7,
        selected_model="test-model",
        llm=object(),
        system=assembly.system,
        api_messages=assembly.messages,
        rag_sources=[],
        tools=assembly.tools,
        max_tokens=512,
        temperature=0,
        context_manifest=assembly.manifest,
    )
    state = ChatSessionState(context_manifest=assembly.manifest)
    payload = build_chat_trace_payload(runtime, state)

    assert payload["metadata"]["context_manifest"] == assembly.manifest
    assert payload["metadata"]["context_manifest_ref"]["valid"] is True
    assert payload["prompt_layers"][0]["name"] == "workspace_context"
    assert "PRIVATE-CUSTOMER-ALPHA" not in json.dumps(payload, ensure_ascii=False)

    rollout = reconstruct_rollout(
        [
            {
                "event_type": "run_started",
                "payload": {
                    "ordinal": 1,
                    "run_id": "run_context_manifest",
                    "context_manifest": assembly.manifest,
                },
            },
            {
                "event_type": "run_completed",
                "payload": {"ordinal": 2, "run_id": "run_context_manifest"},
            },
        ],
        task_status="completed",
    )
    assert rollout["context_manifest"] == assembly.manifest
    assert rollout["status"] == "completed"


def test_completion_evaluation_checks_context_manifest_integrity() -> None:
    assembly = _assembly()
    state = SimpleNamespace(
        tool_call_events=[],
        steps=[],
        trace_events=[],
        artifacts=[],
        pending_tool_confirmations=[],
        pending_tool_actions=[],
        confirmation_requested=False,
        budget_exhausted=False,
    )
    valid = evaluate_run_completion(
        SimpleNamespace(context_manifest=assembly.manifest),
        state,
        full_text="completed answer",
    )
    assert valid.verdict is CompletionVerdict.COMPLETED
    assert valid.checks["context_assembly"] == "passed"
    assert (
        valid.evidence["context_manifest"]["manifest_sha256"]
        == assembly.manifest["manifest_sha256"]
    )

    tampered = deepcopy(assembly.manifest)
    tampered["model_input"]["system"]["chars"] += 1
    invalid = evaluate_run_completion(
        SimpleNamespace(context_manifest=tampered),
        state,
        full_text="completed answer",
    )
    assert invalid.verdict is CompletionVerdict.FAILED
    assert invalid.checks["context_assembly"] == "failed"
    assert invalid.primary_finding_code == "CONTEXT_ASSEMBLY_INVALID"


def test_completion_evaluation_checks_capsule_and_instruction_integrity() -> None:
    capsule = build_conversation_capsule(
        conversation_id=7,
        project_id=3,
        history=[],
        current_content="继续分析",
        working_memory=WorkingMemory(user_constraints=["输出为 Markdown"]),
        turn_contract={"mode": "answer_only", "user_goal": "继续分析"},
    )
    instruction_manifest = build_instruction_manifest(
        layers={
            "platform_policy": "policy",
            "current_user_request": "继续分析",
            "conversation_capsule": capsule["capsule_sha256"],
        }
    )
    state = SimpleNamespace(
        tool_call_events=[],
        steps=[],
        trace_events=[],
        artifacts=[],
        pending_tool_confirmations=[],
        pending_tool_actions=[],
        confirmation_requested=False,
        budget_exhausted=False,
    )
    valid = evaluate_run_completion(
        SimpleNamespace(
            context_manifest=None,
            conversation_capsule=capsule,
            instruction_manifest=instruction_manifest,
        ),
        state,
        full_text="completed answer",
    )

    assert valid.verdict is CompletionVerdict.COMPLETED
    assert valid.checks["conversation_capsule"] == "passed"
    assert valid.checks["instruction_manifest"] == "passed"

    tampered_capsule = deepcopy(capsule)
    tampered_capsule["next_goal"] = "tampered"
    invalid = evaluate_run_completion(
        SimpleNamespace(
            context_manifest=None,
            conversation_capsule=tampered_capsule,
            instruction_manifest=instruction_manifest,
        ),
        state,
        full_text="completed answer",
    )
    assert invalid.verdict is CompletionVerdict.FAILED
    assert invalid.checks["conversation_capsule"] == "failed"
    assert invalid.primary_finding_code == "CONVERSATION_CAPSULE_INVALID"


@pytest.mark.asyncio
async def test_agent_loop_rejects_manifest_request_mismatch_before_provider() -> None:
    assembly = _assembly()

    class NeverCalledProvider:
        def __init__(self) -> None:
            self.called = False

        async def stream_response(self, *_args, **_kwargs):
            self.called = True
            if False:
                yield "unreachable"

    provider = NeverCalledProvider()
    runtime = ChatRuntime(
        conv_id=7,
        selected_model="test-model",
        llm=provider,
        system=f"{assembly.system}\ntampered after assembly",
        api_messages=assembly.messages,
        rag_sources=[],
        tools=assembly.tools,
        max_tokens=512,
        temperature=0,
        context_manifest=assembly.manifest,
        context_window_tokens=4_096,
        agent_turn_max_steps=1,
    )
    state = ChatSessionState(context_manifest=assembly.manifest)

    with pytest.raises(RuntimeError, match="context assembly request rejected"):
        async for _ in run_agent_loop(
            runtime,
            SendMessageRequest(content="request"),
            state,
        ):
            pass

    assert provider.called is False
    assert any(
        event.get("type") == "context_assembly_request_rejected"
        for event in state.trace_events
    )
