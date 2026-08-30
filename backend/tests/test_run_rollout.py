from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import yaml
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ChatRun, Conversation, Message
from app.services.agent_harness.run_rollout import (
    begin_chat_rollout,
    build_in_memory_rollout_snapshot,
    build_step_checkpoint,
    reconstruct_rollout,
)
from app.routers.chat_schemas import SendMessageRequest
from app.services.artifact_intent import ArtifactContract
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import execute_tool_with_policy
from app.services.chat_tools import ChatRuntime


def _golden_cases() -> list[dict]:
    fixture = Path(__file__).parent / "golden_chat_set" / "rollout_cases.yaml"
    payload = yaml.safe_load(fixture.read_text(encoding="utf-8"))
    return list(payload["cases"])


def test_rollout_reconstruction_golden_cases() -> None:
    for case in _golden_cases():
        snapshot = reconstruct_rollout(
            case["records"],
            task_status=case["task_status"],
        )
        expected = case["expected"]
        recovery = snapshot["recovery"]

        assert snapshot["status"] == expected["status"], case["name"]
        assert recovery["action"] == expected["recovery_action"], case["name"]
        assert recovery["can_resume"] is expected["can_resume"], case["name"]
        assert recovery["can_retry"] is expected["can_retry"], case["name"]
        assert recovery["completed_steps"] == expected["completed_steps"], case["name"]
        if "retry_step" in expected:
            assert recovery["retry_step"] == expected["retry_step"], case["name"]
        if "resume_from_step" in expected:
            assert recovery["resume_from_step"] == expected["resume_from_step"], case["name"]


def test_reconstruction_is_deterministic_for_out_of_order_storage_reads() -> None:
    records = _golden_cases()[0]["records"]

    chronological = reconstruct_rollout(records)
    reversed_read = reconstruct_rollout(list(reversed(records)))

    assert chronological == reversed_read
    assert chronological["snapshot_sha256"] == reversed_read["snapshot_sha256"]


def test_reconstruction_keeps_newest_duplicate_ordinal_and_reports_it() -> None:
    snapshot = reconstruct_rollout(
        [
            {"event_type": "run_started", "payload": {"ordinal": 1, "run_id": "run_dupe"}},
            {
                "event_type": "step_checkpoint",
                "payload": {
                    "ordinal": 2,
                    "run_id": "run_dupe",
                    "checkpoint": {"step_index": 0, "status": "failed", "retryable": False},
                },
            },
            {
                "event_type": "step_checkpoint",
                "payload": {
                    "ordinal": 2,
                    "run_id": "run_dupe",
                    "checkpoint": {"step_index": 0, "status": "completed", "retryable": False},
                },
            },
        ]
    )

    assert snapshot["steps"][0]["status"] == "completed"
    assert "duplicate ordinal 2; newest record kept" in snapshot["integrity"]["warnings"]


def test_step_checkpoint_hashes_arguments_and_never_persists_raw_tool_input() -> None:
    step = SimpleNamespace(
        index=0,
        status="failed",
        retryable=True,
        retry_count=1,
        duration_ms=42,
        truncated=False,
        error="temporary timeout",
        model_text="working",
        tool_calls=[
            {
                "id": "tool_1",
                "name": "read_project_file",
                "input": {"file_id": 7, "secret_note": "must-not-leak"},
            }
        ],
    )
    state = SimpleNamespace(
        tool_call_events=[
            {
                "tool_use_id": "tool_1",
                "tool_name": "read_project_file",
                "step_index": 0,
                "status": "error",
                "error": "temporary timeout",
                "attempt_count": 2,
                "max_attempts": 2,
                "retryable": True,
            }
        ]
    )

    checkpoint = build_step_checkpoint(step, state)

    assert checkpoint["retry_count"] == 1
    assert checkpoint["retryable"] is True
    assert checkpoint["tool_calls"][0]["input_sha256"]
    assert "secret_note" not in str(checkpoint)
    assert "must-not-leak" not in str(checkpoint)


def test_in_memory_snapshot_matches_terminal_confirmation_semantics() -> None:
    state = SimpleNamespace(
        run_id="run_confirm",
        steps=[
            SimpleNamespace(
                index=0,
                status="waiting_confirmation",
                retryable=False,
                retry_count=0,
                duration_ms=10,
                truncated=False,
                error="",
                model_text="",
                tool_calls=[],
            )
        ],
        tool_call_events=[],
    )

    snapshot = build_in_memory_rollout_snapshot(
        state,
        status="waiting_confirmation",
        phase="persist",
    )

    assert snapshot["status"] == "waiting_confirmation"
    assert snapshot["recovery"]["action"] == "wait_for_confirmation"


def _read_runtime() -> ChatRuntime:
    return ChatRuntime(
        conv_id=1,
        selected_model="test-model",
        llm=SimpleNamespace(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=[],
        max_tokens=512,
        temperature=0.1,
        project_id=7,
        action_policy=ActionPolicy.READ_ONLY_TOOL,
        tool_access_policy="read_on_demand",
    )


def test_transient_read_failure_retries_inside_same_step_and_records_attempts() -> None:
    failed = {
        "type": "tool_result",
        "tool_name": "read_project_file",
        "status": "error",
        "error": "temporary timeout",
    }
    succeeded = {
        "type": "tool_result",
        "tool_name": "read_project_file",
        "status": "completed",
        "output": {"content": "ok"},
    }
    state = ChatSessionState()

    with patch(
        "app.services.chat.tool_executor.registry.execute",
        new=AsyncMock(side_effect=[failed, succeeded]),
    ) as execute_mock:
        asyncio.run(
            execute_tool_with_policy(
                _read_runtime(),
                state,
                {"id": "tool_read", "name": "read_project_file", "input": {"file_id": 7}},
                req=SendMessageRequest(content="read it", project_id=7),
                step_text="",
                step_truncated=False,
                step_index=0,
            )
        )

    assert execute_mock.await_count == 2
    assert state.tool_call_events[-1]["status"] == "completed"
    assert state.tool_call_events[-1]["attempt_count"] == 2
    assert any(event["type"] == "tool_retry" for event in state.trace_events)


def test_non_transient_read_failure_is_not_blindly_replayed() -> None:
    denied = {
        "type": "tool_result",
        "tool_name": "read_project_file",
        "status": "error",
        "error": "file does not exist",
    }
    state = ChatSessionState()

    with patch(
        "app.services.chat.tool_executor.registry.execute",
        new=AsyncMock(return_value=denied),
    ) as execute_mock:
        asyncio.run(
            execute_tool_with_policy(
                _read_runtime(),
                state,
                {"id": "tool_read", "name": "read_project_file", "input": {"file_id": 404}},
                req=SendMessageRequest(content="read it", project_id=7),
                step_text="",
                step_truncated=False,
                step_index=0,
            )
        )

    assert execute_mock.await_count == 1
    assert state.tool_call_events[-1]["status"] == "error"
    assert state.tool_call_events[-1]["retryable"] is False


def test_artifact_failure_with_persisted_path_is_not_replayed() -> None:
    ambiguous = {
        "type": "tool_result",
        "tool_name": "generate_pdf",
        "status": "error",
        "error": "response interrupted after save",
        "output": {
            "path": "generated/already-there.pdf",
            "file_name": "already-there.pdf",
            "file_type": "pdf",
        },
    }
    runtime = _read_runtime()
    runtime.action_policy = ActionPolicy.WRITE_ARTIFACT
    runtime.artifact_contract = ArtifactContract(
        delivery_required=True,
        output_kind="pdf",
        allowed_tools=("generate_pdf",),
    )
    state = ChatSessionState()

    with patch(
        "app.services.chat.tool_executor.registry.execute",
        new=AsyncMock(return_value=ambiguous),
    ) as execute_mock:
        asyncio.run(
            execute_tool_with_policy(
                runtime,
                state,
                {"id": "tool_pdf", "name": "generate_pdf", "input": {"title": "Report"}},
                req=SendMessageRequest(content="make a PDF"),
                step_text="",
                step_truncated=False,
                step_index=0,
            )
        )

    assert execute_mock.await_count == 1
    assert state.tool_call_events[-1]["retryable"] is False


def test_begin_rollout_binds_exact_persisted_user_message_not_latest() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            conversation = Conversation(title="Concurrent source")
            session.add(conversation)
            session.flush()
            exact = Message(conversation_id=int(conversation.id or 0), role="user", content="exact")
            session.add(exact)
            session.flush()
            later = Message(conversation_id=int(conversation.id or 0), role="user", content="later")
            session.add(later)
            session.commit()
            exact_id = int(exact.id or 0)
            conversation_id = int(conversation.id or 0)

        runtime = _read_runtime()
        runtime.conv_id = conversation_id
        runtime.prepare_metrics = {"source_user_message_id": exact_id}
        begin_chat_rollout(engine, runtime, "exact", "run_exact_source")

        with Session(engine) as session:
            chat_run = session.exec(select(ChatRun).where(ChatRun.run_id == "run_exact_source")).one()
            assert chat_run.source_message_id == exact_id
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()
