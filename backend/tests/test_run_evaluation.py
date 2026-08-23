from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import patch

import pytest

import app.services.chat as chat_service
from app.services.agent_harness.run_evaluation import (
    CompletionVerdict,
    evaluate_run_completion,
)
from app.services.agent_harness.run_output_record import (
    build_artifact_output_record,
    mark_run_output_failed,
)
from app.services.chat.agent_step import AgentStep
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.persist import run_persist
from app.services.chat.state import ChatSessionState


def _runtime() -> SimpleNamespace:
    return SimpleNamespace(artifact_contract=None)


def _tool_event(
    name: str,
    status: str,
    *,
    step_index: int = 0,
    tool_use_id: str = "call-1",
    retry_of_tool_use_id: str = "",
) -> dict:
    event = {
        "tool_name": name,
        "tool_use_id": tool_use_id,
        "step_index": step_index,
        "status": status,
    }
    if retry_of_tool_use_id:
        event["retry_of_tool_use_id"] = retry_of_tool_use_id
    return event


def test_text_only_answer_passes_without_tool_evidence() -> None:
    state = ChatSessionState(
        steps=[AgentStep(index=0, model_text="answer", status="completed")]
    )

    evaluation = evaluate_run_completion(
        _runtime(),
        state,
        full_text="A substantive direct answer.",
    )

    assert evaluation.verdict is CompletionVerdict.COMPLETED
    assert evaluation.score == 100
    assert evaluation.findings == ()
    assert evaluation.to_dict()["primary_finding_code"] is None


def test_missing_required_artifact_is_a_failed_verdict() -> None:
    state = ChatSessionState(
        steps=[AgentStep(index=0, model_text="draft", status="completed")]
    )

    evaluation = evaluate_run_completion(
        _runtime(),
        state,
        full_text="PPT draft",
        delivery_failed=True,
    )

    assert evaluation.verdict is CompletionVerdict.FAILED
    assert evaluation.primary_finding_code == "ARTIFACT_DELIVERY_MISSING"
    assert evaluation.checks["artifact_delivery"] == "failed"


def test_execution_truth_gate_becomes_failed_completion_evidence() -> None:
    state = ChatSessionState(
        trace_events=[
            {"type": "execution_truth_gate_blocked_completion_claim", "stage": "persist"}
        ],
        tool_call_events=[_tool_event("execution_truth_gate", "error")],
    )

    evaluation = evaluate_run_completion(
        _runtime(),
        state,
        full_text="I completed the write.",
    )

    assert evaluation.verdict is CompletionVerdict.FAILED
    assert evaluation.primary_finding_code == "EXECUTION_CLAIM_UNGROUNDED"
    assert [finding.code for finding in evaluation.findings] == [
        "EXECUTION_CLAIM_UNGROUNDED"
    ]


def test_unresolved_tool_failure_requires_explicitly_linked_recovery() -> None:
    failed_state = ChatSessionState(
        tool_call_events=[_tool_event("read_project_file", "error")]
    )
    unrelated_success_state = ChatSessionState(
        tool_call_events=[
            _tool_event("read_project_file", "error", tool_use_id="call-1"),
            _tool_event(
                "read_project_file",
                "completed",
                step_index=1,
                tool_use_id="call-2",
            ),
        ]
    )
    recovered_state = ChatSessionState(
        tool_call_events=[
            _tool_event("read_project_file", "error", tool_use_id="call-1"),
            _tool_event(
                "read_project_file",
                "completed",
                step_index=1,
                tool_use_id="call-2",
                retry_of_tool_use_id="call-1",
            ),
        ]
    )

    failed = evaluate_run_completion(
        _runtime(), failed_state, full_text="Could not inspect the file."
    )
    unrelated_success = evaluate_run_completion(
        _runtime(), unrelated_success_state, full_text="Inspected another file."
    )
    recovered = evaluate_run_completion(
        _runtime(), recovered_state, full_text="File inspected on retry."
    )

    assert failed.verdict is CompletionVerdict.FAILED
    assert failed.primary_finding_code == "TOOL_EXECUTION_UNRESOLVED"
    assert unrelated_success.verdict is CompletionVerdict.FAILED
    assert recovered.verdict is CompletionVerdict.COMPLETED
    assert recovered.score == 92
    assert recovered.findings[0].code == "TOOL_FAILURE_RECOVERED"


def test_blocked_tool_is_reported_once_as_policy_failure() -> None:
    state = ChatSessionState(
        trace_events=[{"type": "tool_blocked", "stage": "step_0"}],
        tool_call_events=[_tool_event("manage_project_files", "blocked")],
    )

    evaluation = evaluate_run_completion(
        _runtime(), state, full_text="The action was blocked."
    )

    assert evaluation.verdict is CompletionVerdict.FAILED
    assert [finding.code for finding in evaluation.findings] == ["POLICY_REJECTED"]


def test_double_truncation_and_empty_model_fallback_are_failures() -> None:
    truncated_state = ChatSessionState(
        steps=[
            AgentStep(
                index=0,
                model_text="partial",
                status="completed",
                truncated=True,
            )
        ]
    )

    truncated = evaluate_run_completion(
        _runtime(), truncated_state, full_text="partial"
    )
    empty = evaluate_run_completion(
        _runtime(),
        ChatSessionState(),
        full_text="fallback text",
        output_was_empty=True,
    )

    assert truncated.primary_finding_code == "OUTPUT_TRUNCATED"
    assert empty.primary_finding_code == "EMPTY_MODEL_OUTPUT"


def test_empty_model_text_is_allowed_when_tool_or_artifact_proves_completion() -> None:
    state = ChatSessionState(
        artifacts=[{"id": 10, "file_type": "pptx"}],
        tool_call_events=[_tool_event("generate_ppt", "completed")],
    )

    evaluation = evaluate_run_completion(
        _runtime(),
        state,
        full_text="Artifact ready: deck.pptx",
        output_was_empty=True,
    )

    assert evaluation.verdict is CompletionVerdict.COMPLETED
    assert evaluation.checks["output_completeness"] == "passed"


def test_failed_artifact_output_prevents_completion_claim() -> None:
    produced = build_artifact_output_record(
        {"name": "deck.pptx", "file_type": "pptx", "path": "generated/deck.pptx"},
        run_id="run_output_failed",
        source_tool="generate_ppt_from_skill",
        tool_use_id="call-1",
    )
    state = ChatSessionState(
        run_outputs=[
            mark_run_output_failed(
                produced,
                "ARTIFACT_FILE_MISSING",
                "File not found",
            )
        ],
        tool_call_events=[_tool_event("generate_ppt_from_skill", "completed")],
    )

    evaluation = evaluate_run_completion(
        _runtime(),
        state,
        full_text="The deck is ready to download.",
    )

    assert evaluation.verdict is CompletionVerdict.FAILED
    assert evaluation.primary_finding_code == "OUTPUT_PERSISTENCE_FAILED"
    assert evaluation.checks["output_persistence"] == "failed"
    assert evaluation.evidence["artifact_count"] == 0


def test_confirmation_is_pending_not_failed() -> None:
    state = ChatSessionState(
        confirmation_requested=True,
        pending_tool_confirmations=[{"tool_name": "manage_project_files"}],
        tool_call_events=[_tool_event("manage_project_files", "confirmation_required")],
    )

    evaluation = evaluate_run_completion(
        _runtime(), state, full_text="Waiting for confirmation."
    )

    assert evaluation.verdict is CompletionVerdict.WAITING_CONFIRMATION
    assert evaluation.score == 100
    assert evaluation.checks["confirmation"] == "pending"


def test_persisted_evidence_is_bounded_and_excludes_raw_tool_arguments() -> None:
    state = ChatSessionState(
        tool_call_events=[
            {
                **_tool_event(f"tool-{index}", "error", tool_use_id=f"call-{index}"),
                "tool_input": {"secret": f"raw-{index}"},
                "error": "x" * 2_000,
            }
            for index in range(20)
        ]
    )

    payload = evaluate_run_completion(
        _runtime(), state, full_text="partial result"
    ).to_dict()

    assert len(payload["findings"]) <= 8
    tool_names = payload["findings"][0]["evidence"]["tool_names"]
    assert len(tool_names) == 5
    rendered = str(payload)
    assert "raw-" not in rendered
    assert "x" * 100 not in rendered


@pytest.mark.asyncio
async def test_persist_stores_failed_evaluation_and_failed_rollout_snapshot() -> None:
    runtime = SimpleNamespace(
        conv_id=7,
        project_id=3,
        rag_sources=[],
        skill_name="",
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        artifact_contract=None,
        working_memory={},
        llm=SimpleNamespace(complete=lambda *_args, **_kwargs: ""),
    )
    req = SimpleNamespace(
        project_id=3,
        content="inspect",
        action_confirmations=[],
        skill_id=None,
        language=None,
    )
    state = ChatSessionState(
        run_id="run_evaluation_persist",
        full_text="I could not inspect the file.",
        steps=[
            AgentStep(
                index=0,
                model_text="I could not inspect the file.",
                tool_calls=[{"name": "read_project_file"}],
                status="failed",
            )
        ],
        tool_call_events=[_tool_event("read_project_file", "error")],
    )
    persisted: dict = {}

    def fake_persist(_bind, _conv_id, content, _request_content, metadata):
        persisted["content"] = content
        persisted["metadata"] = metadata
        return False, 91

    with patch(
        "app.services.chat.persist.persist_assistant_message", new=fake_persist
    ), patch("app.services.chat.persist.persist_chat_trace"):
        events = [
            event
            async for event in run_persist(runtime, req, object(), state)
        ]

    evaluation = persisted["metadata"]["run_evaluation"]
    assert evaluation["verdict"] == "failed"
    assert evaluation["primary_finding_code"] == "TOOL_EXECUTION_UNRESOLVED"
    assert persisted["metadata"]["delivery_failed"] is True
    assert persisted["metadata"]["run_rollout"]["status"] == "failed"
    assert "部分工具执行失败" in persisted["content"]
    assert any('"type": "done"' in event for event in events)


@pytest.mark.asyncio
async def test_orchestrator_emits_failed_terminal_event_for_evaluation_failure() -> None:
    runtime = SimpleNamespace(
        conv_id=7,
        selected_model="test-model",
        rag_sources=[],
        skill_name="",
        tools=None,
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        tool_access_policy="read_on_demand",
        intent_reason="explicit_read",
        intent_method="rule",
        chat_mode="project_qa",
        prepare_metrics={},
    )
    req = SimpleNamespace(project_id=3)
    rollout_bind = object()
    state = ChatSessionState(
        run_id="run_evaluation_terminal",
        rollout_task_id=52,
        rollout_bind=rollout_bind,
    )
    finalized: dict = {}

    async def fake_durable(_runtime, _req, _bind, _state):
        if False:  # pragma: no cover - async-generator shape
            yield ""

    async def fake_agent(_runtime, _req, _state):
        if False:  # pragma: no cover - async-generator shape
            yield ""

    async def fake_persist(_runtime, _req, _bind, run_state):
        run_state.assistant_message_id = 91
        run_state.full_text = "partial result"
        run_state.run_evaluation = {
            "verdict": "failed",
            "score": 40,
            "summary": "completion evidence failed",
            "primary_finding_code": "TOOL_EXECUTION_UNRESOLVED",
        }
        yield 'data: {"type":"done"}\n\n'

    def fake_finalize(_bind, task_id, **kwargs):
        finalized.update(task_id=task_id, **kwargs)
        return {"status": kwargs["status"]}

    with patch(
        "app.services.chat.durable_task.run_durable_task", new=fake_durable
    ), patch(
        "app.services.chat.agent_loop.run_agent_loop", new=fake_agent
    ), patch(
        "app.services.chat.persist.run_persist", new=fake_persist
    ), patch.object(
        chat_service, "finalize_chat_rollout", new=fake_finalize
    ):
        events = [
            event
            async for event in chat_service._stream_chat_events_impl(
                runtime,
                req,
                rollout_bind,
                state,
                time.perf_counter(),
            )
        ]

    rendered = "".join(events)
    assert '"error_code": "RUN_EVALUATION_FAILED"' in rendered
    assert '"type": "run_done"' not in rendered
    assert finalized == {
        "task_id": 52,
        "status": "failed",
        "message_id": 91,
        "phase": "completion_evaluation",
        "error_code": "RUN_EVALUATION_FAILED",
        "error_message": "completion evidence failed",
        "retryable": False,
        "run_outputs": [],
    }


@pytest.mark.asyncio
async def test_orchestrator_preserves_waiting_confirmation_terminal_status() -> None:
    runtime = SimpleNamespace(
        conv_id=7,
        selected_model="test-model",
        rag_sources=[],
        skill_name="",
        tools=None,
        action_policy=ActionPolicy.DESTRUCTIVE_ACTION,
        tool_access_policy="write_allowed",
        intent_reason="explicit_write",
        intent_method="rule",
        chat_mode="project_deep_dive",
        prepare_metrics={},
    )
    req = SimpleNamespace(project_id=3)
    state = ChatSessionState(
        run_id="run_evaluation_waiting",
        rollout_task_id=53,
        rollout_bind=object(),
        confirmation_requested=True,
    )
    finalized: dict = {}

    async def fake_durable(_runtime, _req, _bind, _state):
        if False:  # pragma: no cover - async-generator shape
            yield ""

    async def fake_agent(_runtime, _req, _state):
        if False:  # pragma: no cover - async-generator shape
            yield ""

    async def fake_persist(_runtime, _req, _bind, run_state):
        run_state.assistant_message_id = 92
        run_state.full_text = "Waiting for confirmation."
        run_state.run_evaluation = {
            "verdict": "waiting_confirmation",
            "score": 100,
            "summary": "completion evidence recorded",
            "primary_finding_code": None,
        }
        yield 'data: {"type":"done"}\n\n'

    def fake_finalize(_bind, task_id, **kwargs):
        finalized.update(task_id=task_id, **kwargs)
        return {"status": kwargs["status"]}

    with patch(
        "app.services.chat.durable_task.run_durable_task", new=fake_durable
    ), patch(
        "app.services.chat.agent_loop.run_agent_loop", new=fake_agent
    ), patch(
        "app.services.chat.persist.run_persist", new=fake_persist
    ), patch.object(
        chat_service, "finalize_chat_rollout", new=fake_finalize
    ):
        events = [
            event
            async for event in chat_service._stream_chat_events_impl(
                runtime,
                req,
                object(),
                state,
                time.perf_counter(),
            )
        ]

    rendered = "".join(events)
    assert '"final_status": "waiting_confirmation"' in rendered
    assert '"type": "run_failed"' not in rendered
    assert finalized == {
        "task_id": 53,
        "status": "waiting_confirmation",
        "message_id": 92,
        "phase": "persist",
        "error_code": "",
        "error_message": "",
        "retryable": False,
        "run_outputs": [],
    }
