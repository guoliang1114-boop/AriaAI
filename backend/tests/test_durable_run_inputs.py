from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ChatRun,
    ChatRunInput,
    Conversation,
    Message,
    Project,
    TaskEvent,
    TaskRun,
    TaskStep,
    User,
)
from app.services.agent_harness.durable_run_inputs import (
    DurableRunInputRejected,
    acknowledge_durable_run_cancel_after_terminal,
    accept_cancel_run_input,
    accept_steering_run_input,
    build_recovery_steering_history_messages,
    claim_durable_run_cancel,
    claim_durable_run_inputs,
    claim_durable_run_inputs_in_session,
    content_sha256,
    finalize_durable_run_inputs,
    load_recovery_steering_messages,
    recovery_run_identity_from_runtime,
)
from app.services.agent_harness.run_rollout import finalize_chat_rollout
from app.services.chat.agent_loop import DurableRunInputBoundaryError, _drain_steering_boundary
from app.services.chat.durable_task import (
    DurableTaskControlBoundaryError,
    _raise_if_durable_chat_cancelled,
    run_durable_task,
)
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime
from app.services.task_orchestrator import TaskRoute


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _create_run(session: Session, run_id: str = "run_durable") -> tuple[int, ChatRun]:
    conversation = Conversation(title="Durable mailbox")
    session.add(conversation)
    session.flush()
    task = TaskRun(
        conversation_id=int(conversation.id),
        task_type="chat_rollout",
        status="running",
    )
    session.add(task)
    session.flush()
    run = ChatRun(
        run_id=run_id,
        task_run_id=int(task.id),
        conversation_id=int(conversation.id),
        status="running",
    )
    session.add(run)
    session.commit()
    session.refresh(run)
    return int(conversation.id), run


def _accept_steering(
    session: Session,
    run: ChatRun,
    content: str,
) -> tuple[Message, ChatRunInput]:
    message = Message(
        conversation_id=int(run.conversation_id),
        role="user",
        content=content,
    )
    session.add(message)
    session.flush()
    item = accept_steering_run_input(
        session,
        run_id=run.run_id,
        conversation_id=int(run.conversation_id),
        message_id=int(message.id),
        content_digest=content_sha256(content),
    )
    message.set_metadata(
        {
            "run_steering": {
                "schema_version": "aria.run_steering.v1",
                "status": "accepted",
                "run_id": run.run_id,
                "expected_run_id": run.run_id,
                "steering_id": f"steer_test_{item.sequence}",
                "sequence": item.sequence,
                "input_id": item.id,
            }
        }
    )
    session.add(message)
    return message, item


def test_restart_boundary_claims_message_body_once_from_database() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session)
        message, item = _accept_steering(session, run, "换成董事会口径")
        session.commit()
        message_id = int(message.id)
        input_id = int(item.id)

    runtime = SimpleNamespace(
        conv_id=conversation_id,
        system="system",
        tools=[],
        action_policy="direct_answer",
        tool_access_policy="none",
    )
    state = ChatSessionState(run_id="run_durable", rollout_bind=engine)
    claimed, events = _drain_steering_boundary(
        runtime,
        state,
        stage="restart_boundary",
    )
    assert [item.content for item in claimed] == ["换成董事会口径"]
    assert claimed[0].message_id == message_id
    assert any('"type": "steering_applied"' in event for event in events)
    assert _drain_steering_boundary(runtime, state, stage="next_boundary") == ((), [])

    with Session(engine) as session:
        stored = session.get(ChatRunInput, input_id)
        assert stored is not None
        assert stored.status == "applied"
        assert stored.applied_at is not None
        assert "换成董事会口径" not in str(stored.model_dump())


def test_in_session_claim_can_share_atomic_phase_transaction() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_atomic_phase_claim")
        _, item = _accept_steering(session, run, "原子领取后可与 phase 一起提交")
        session.commit()
        input_id = int(item.id)

    with Session(engine) as session:
        batch = claim_durable_run_inputs_in_session(
            session,
            run_id="run_atomic_phase_claim",
            conversation_id=conversation_id,
        )
        assert [entry.content for entry in batch.steering] == [
            "原子领取后可与 phase 一起提交"
        ]
        locked_run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_atomic_phase_claim")
        ).one()
        locked_run.phase = "agent_loop_done"
        session.add(locked_run)
        session.rollback()

    with Session(engine) as session:
        assert session.get(ChatRunInput, input_id).status == "accepted"
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_atomic_phase_claim")
        ).one()
        assert run.phase == "run_start"


def test_mailbox_claim_failure_aborts_before_model_or_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    runtime = SimpleNamespace(
        conv_id=7,
        system="system",
        tools=[],
        action_policy="direct_answer",
        tool_access_policy="none",
    )
    state = ChatSessionState(run_id="run_mailbox_unavailable", rollout_bind=object())

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        "app.services.chat.agent_loop.claim_durable_run_inputs",
        unavailable,
    )

    with pytest.raises(DurableRunInputBoundaryError, match="temporarily unavailable"):
        _drain_steering_boundary(runtime, state, stage="before_tool_commit")
    assert any(
        item.get("type") == "durable_run_input_claim_failed"
        for item in state.trace_events
    )


def test_cancel_wins_and_keeps_skipped_steering_for_recovery() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_cancel_durable")
        _message, steering = _accept_steering(session, run, "补充未消费要求")
        cancel = accept_cancel_run_input(
            session,
            run_id=run.run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        steering_id = int(steering.id)
        cancel_id = int(cancel.id)

    batch = claim_durable_run_inputs(
        engine,
        run_id="run_cancel_durable",
        conversation_id=conversation_id,
    )
    assert batch.cancel_requested is True
    assert batch.steering == ()
    assert batch.input_ids == (cancel_id,)
    with Session(engine) as session:
        stored_cancel = session.get(ChatRunInput, cancel_id)
        assert stored_cancel.status == "accepted"
        assert stored_cancel.applied_at is None
        assert session.get(ChatRunInput, steering_id).status == "unapplied"
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_cancel_durable")
        ).one()
        run.status = "cancelled"
        run.completed_at = run.updated_at
        session.add(run)
        session.commit()

    assert finalize_durable_run_inputs(engine, run_id="run_cancel_durable") == (
        cancel_id,
    )
    with Session(engine) as session:
        stored_cancel = session.get(ChatRunInput, cancel_id)
        assert stored_cancel.status == "applied"
        assert stored_cancel.applied_at is not None


def test_general_claim_retracts_tampered_cancel_without_stopping_run() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_tampered_cancel")
        cancel = accept_cancel_run_input(
            session,
            run_id=run.run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        cancel_id = int(cancel.id)
        cancel = session.get(ChatRunInput, cancel_id)
        cancel.content_sha256 = "0" * 64
        session.add(cancel)
        session.commit()

    batch = claim_durable_run_inputs(
        engine,
        run_id="run_tampered_cancel",
        conversation_id=conversation_id,
    )
    assert batch.cancel_requested is False
    assert batch.input_ids == ()
    with Session(engine) as session:
        stored = session.get(ChatRunInput, cancel_id)
        assert stored.status == "retracted"
        assert stored.applied_at is None


@pytest.mark.parametrize(
    "mutation",
    ("expected_run_id", "input_id", "steering_id"),
)
def test_claim_retracts_mismatched_steering_envelope(mutation: str) -> None:
    engine = _engine()
    run_id = f"run_invalid_steering_{mutation}"
    with Session(engine) as session:
        conversation_id, run = _create_run(
            session,
            run_id,
        )
        message, item = _accept_steering(session, run, "verified body")
        session.commit()
        message_id = int(message.id)
        input_id = int(item.id)
        message = session.get(Message, message_id)
        metadata = message.get_metadata()
        envelope = metadata["run_steering"]
        if mutation == "expected_run_id":
            envelope["expected_run_id"] = "run_wrong_parent"
        elif mutation == "input_id":
            envelope["input_id"] = input_id + 1
        else:
            envelope["steering_id"] = "steer_invalid!"
        message.set_metadata(metadata)
        session.add(message)
        session.commit()

    batch = claim_durable_run_inputs(
        engine,
        run_id=run_id,
        conversation_id=conversation_id,
    )
    assert batch.steering == ()
    assert batch.input_ids == ()
    with Session(engine) as session:
        stored = session.get(ChatRunInput, input_id)
        assert stored.status == "retracted"
        assert stored.applied_at is None


def test_polled_agent_loop_cancel_becomes_unapplied_if_run_does_not_cancel() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_cancel_terminal_failure")
        cancel = accept_cancel_run_input(
            session,
            run_id=run.run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        cancel_id = int(cancel.id)

    batch = claim_durable_run_inputs(
        engine,
        run_id="run_cancel_terminal_failure",
        conversation_id=conversation_id,
    )
    assert batch.cancel_requested is True
    with Session(engine) as session:
        stored = session.get(ChatRunInput, cancel_id)
        assert stored.status == "accepted"
        assert stored.applied_at is None
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_cancel_terminal_failure")
        ).one()
        run.status = "failed"
        run.completed_at = run.updated_at
        session.add(run)
        session.commit()

    assert finalize_durable_run_inputs(
        engine,
        run_id="run_cancel_terminal_failure",
    ) == (cancel_id,)
    with Session(engine) as session:
        stored = session.get(ChatRunInput, cancel_id)
        assert stored.status == "unapplied"
        assert stored.applied_at is None


def test_cancel_only_claim_does_not_consume_accepted_steering() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_cancel_only_boundary")
        _, steering = _accept_steering(session, run, "耐久任务不应消费这条 steering")
        session.commit()
        steering_id = int(steering.id)

    batch = claim_durable_run_cancel(
        engine,
        run_id="run_cancel_only_boundary",
        conversation_id=conversation_id,
    )

    assert batch.authoritative is True
    assert batch.cancel_requested is False
    assert batch.steering == ()
    assert batch.input_ids == ()
    with Session(engine) as session:
        stored = session.get(ChatRunInput, steering_id)
        assert stored is not None
        assert stored.status == "accepted"
        assert stored.applied_at is None


def test_durable_task_cancel_boundary_cancels_linked_task_run() -> None:
    engine = _engine()
    with Session(engine) as session:
        actor = User(
            email="durable-cancel@example.com",
            password_hash="test",
            is_admin=True,
        )
        project = Project(name="Durable cancel", client="Client", status="active")
        session.add(actor)
        session.add(project)
        session.flush()
        conversation_id, chat_run = _create_run(session, "run_durable_task_cancel")
        task = TaskRun(
            project_id=int(project.id),
            conversation_id=conversation_id,
            created_by_user_id=int(actor.id),
            task_type="generate_project_excel",
            status="pending",
        )
        session.add(task)
        session.flush()
        step = TaskStep(
            task_run_id=int(task.id),
            key="collect_context",
            title="收集上下文",
            step_type="collect_project_context",
            status="pending",
        )
        session.add(step)
        accept_cancel_run_input(
            session,
            run_id=chat_run.run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        actor_id = int(actor.id)
        task_id = int(task.id)

    runtime = SimpleNamespace(conv_id=conversation_id, actor_user_id=actor_id)
    state = ChatSessionState(
        run_id="run_durable_task_cancel",
        rollout_bind=engine,
    )
    with pytest.raises(asyncio.CancelledError, match="aria_user_interrupted"):
        _raise_if_durable_chat_cancelled(
            engine,
            runtime=runtime,
            state=state,
            stage="test_remote_boundary",
            task_id=task_id,
        )

    with Session(engine) as session:
        stored_task = session.get(TaskRun, task_id)
        stored_step = session.exec(
            select(TaskStep).where(TaskStep.task_run_id == task_id)
        ).one()
        events = session.exec(
            select(TaskEvent).where(TaskEvent.task_run_id == task_id)
        ).all()
        cancel_input = session.exec(
            select(ChatRunInput).where(
                ChatRunInput.run_id == "run_durable_task_cancel",
                ChatRunInput.kind == "cancel",
            )
        ).one()
        assert stored_task.status == "canceled"
        assert stored_task.error_code == "canceled"
        assert stored_step.status == "skipped"
        assert cancel_input.status == "applied"
        assert any(item.event_type == "task_canceled" for item in events)
        assert not any(item.event_type == "task_completed" for item in events)


def test_linked_task_cancel_failure_rolls_back_mailbox_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.services.chat.durable_task as durable_task_module

    engine = _engine()
    with Session(engine) as session:
        actor = User(
            email="durable-cancel-failure@example.com",
            password_hash="test",
            is_admin=True,
        )
        project = Project(name="Atomic cancel", client="Client", status="active")
        session.add(actor)
        session.add(project)
        session.flush()
        conversation_id, chat_run = _create_run(session, "run_atomic_cancel_failure")
        task = TaskRun(
            project_id=int(project.id),
            conversation_id=conversation_id,
            created_by_user_id=int(actor.id),
            task_type="generate_project_excel",
            status="pending",
        )
        session.add(task)
        session.flush()
        session.add(
            TaskStep(
                task_run_id=int(task.id),
                key="collect_context",
                title="收集上下文",
                step_type="collect_project_context",
                status="pending",
            )
        )
        cancel = accept_cancel_run_input(
            session,
            run_id=chat_run.run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        actor_id = int(actor.id)
        task_id = int(task.id)
        cancel_id = int(cancel.id)

    def fail_cancel(*_args, **_kwargs):
        raise RuntimeError("injected task cancel failure")

    monkeypatch.setattr(
        durable_task_module,
        "cancel_task_run_in_session",
        fail_cancel,
    )
    runtime = SimpleNamespace(conv_id=conversation_id, actor_user_id=actor_id)
    state = ChatSessionState(run_id="run_atomic_cancel_failure", rollout_bind=engine)

    with pytest.raises(DurableTaskControlBoundaryError, match="temporarily unavailable"):
        _raise_if_durable_chat_cancelled(
            engine,
            runtime=runtime,
            state=state,
            stage="injected_atomic_failure",
            task_id=task_id,
        )

    with Session(engine) as session:
        stored_cancel = session.get(ChatRunInput, cancel_id)
        stored_task = session.get(TaskRun, task_id)
        stored_step = session.exec(
            select(TaskStep).where(TaskStep.task_run_id == task_id)
        ).one()
        assert stored_cancel.status == "accepted"
        assert stored_cancel.applied_at is None
        assert stored_task.status == "pending"
        assert stored_step.status == "pending"


def test_missing_or_mismatched_control_identity_fails_closed() -> None:
    engine = _engine()
    with pytest.raises(DurableRunInputRejected) as missing:
        claim_durable_run_cancel(
            engine,
            run_id="run_missing_control_identity",
            conversation_id=1,
        )
    assert missing.value.code == "run_not_found"

    with Session(engine) as session:
        conversation_id, _ = _create_run(session, "run_mismatched_control_identity")
    with pytest.raises(DurableRunInputRejected) as mismatch:
        claim_durable_run_inputs(
            engine,
            run_id="run_mismatched_control_identity",
            conversation_id=conversation_id + 1,
        )
    assert mismatch.value.code == "conversation_mismatch"


@pytest.mark.asyncio
async def test_remote_cancel_stops_durable_stream_before_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.services.chat.durable_task as durable_task_module

    engine = _engine()
    with Session(engine) as session:
        actor = User(
            email="durable-stream-cancel@example.com",
            password_hash="test",
            is_admin=True,
        )
        project = Project(name="Durable stream", client="Client", status="active")
        session.add(actor)
        session.add(project)
        session.flush()
        conversation_id, _ = _create_run(session, "run_durable_stream_cancel")
        conversation = session.get(Conversation, conversation_id)
        conversation.project_id = int(project.id)
        conversation.owner_user_id = int(actor.id)
        session.add(conversation)
        session.commit()
        actor_id = int(actor.id)
        project_id = int(project.id)

    resumed_after_cancel = False

    async def remote_cancel_stream(task_session, task_id, **_kwargs):
        nonlocal resumed_after_cancel
        task_session.rollback()
        with Session(engine) as control_session:
            accept_cancel_run_input(
                control_session,
                run_id="run_durable_stream_cancel",
                conversation_id=conversation_id,
            )
            control_session.commit()
        yield {
            "event_type": "task_completed",
            "message": "不应向外发送的完成事件",
            "task": {"id": task_id, "status": "completed", "steps": []},
        }
        resumed_after_cancel = True

    monkeypatch.setattr(
        durable_task_module,
        "stream_execute_task_run_in_session",
        remote_cancel_stream,
    )
    runtime = ChatRuntime(
        conv_id=conversation_id,
        actor_user_id=actor_id,
        project_id=project_id,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        action_policy="direct_answer",
        intent_prepared_async=True,
        intent_task_route=TaskRoute(
            task_type="generate_project_excel",
            confidence=0.99,
            reason="test durable route",
            title="访谈表格",
            output_kind="xlsx",
        ),
    )
    state = ChatSessionState(
        run_id="run_durable_stream_cancel",
        rollout_bind=engine,
    )
    req = SimpleNamespace(
        project_id=project_id,
        content="生成访谈表格",
    )
    events: list[str] = []

    with pytest.raises(asyncio.CancelledError, match="aria_user_interrupted"):
        async for event in run_durable_task(runtime, req, engine, state):
            events.append(event)

    assert resumed_after_cancel is False
    assert not any('"type": "done"' in event for event in events)
    assert not any("不应向外发送的完成事件" in event for event in events)
    with Session(engine) as session:
        durable_task = session.exec(
            select(TaskRun).where(TaskRun.task_type == "generate_project_excel")
        ).one()
        assistant_messages = session.exec(
            select(Message).where(
                Message.conversation_id == conversation_id,
                Message.role == "assistant",
            )
        ).all()
        chat_run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_durable_stream_cancel")
        ).one()
        assert durable_task.status == "canceled"
        assert assistant_messages == []
        assert chat_run.action_policy == "durable_task"
        assert chat_run.phase == "durable_task"


@pytest.mark.asyncio
async def test_durable_task_mailbox_failure_aborts_before_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.services.chat.durable_task as durable_task_module

    writes: list[str] = []

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("database unavailable")

    def unexpected_write(**_kwargs):
        writes.append("markdown_followup")
        return None

    monkeypatch.setattr(
        durable_task_module,
        "claim_durable_run_cancel",
        unavailable,
    )
    monkeypatch.setattr(
        durable_task_module,
        "save_previous_answer_as_markdown",
        unexpected_write,
    )
    runtime = SimpleNamespace(
        conv_id=7,
        action_policy="direct_answer",
        prepare_metrics={},
        working_memory={},
    )
    state = ChatSessionState(run_id="run_mailbox_failure")
    req = SimpleNamespace(project_id=3, content="保存上一条回复")

    with pytest.raises(
        DurableTaskControlBoundaryError,
        match="temporarily unavailable",
    ):
        async for _ in run_durable_task(runtime, req, object(), state):
            pass
    assert writes == []
    assert any(
        event.get("type") == "durable_task_control_claim_failed"
        for event in state.trace_events
    )


@pytest.mark.asyncio
async def test_recovery_bypasses_all_durable_and_markdown_fast_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.services.chat.durable_task as durable_task_module

    calls: list[str] = []

    def unexpected_save(**_kwargs):
        calls.append("markdown_save")
        return {"ok": True}

    def unexpected_create(*_args, **_kwargs):
        calls.append("durable_task_create")
        raise AssertionError("recovery must not create a P0 durable task")

    async def unexpected_markdown(*_args, **_kwargs):
        calls.append("markdown_continuation")
        if False:
            yield ""

    monkeypatch.setattr(
        durable_task_module,
        "save_previous_answer_as_markdown",
        unexpected_save,
    )
    monkeypatch.setattr(durable_task_module, "create_task_run", unexpected_create)
    monkeypatch.setattr(
        durable_task_module,
        "_handle_markdown_artifact_continuation",
        unexpected_markdown,
    )
    runtime = SimpleNamespace(
        conv_id=9,
        prepare_metrics={
            "turn_recovery": {
                "schema_version": 2,
                "source_run_id": "run_recovery_parent",
            }
        },
        action_policy="durable_task",
        working_memory={
            "continuation_requested": True,
            "current_artifact": {"project_file_id": 7, "file_type": "md"},
        },
        intent_prepared_async=True,
        intent_task_route=TaskRoute(task_type="generate_project_excel"),
    )
    state = ChatSessionState(run_id="run_recovery_child")
    req = SimpleNamespace(project_id=3, content="恢复并继续生成")

    events = [
        event
        async for event in run_durable_task(runtime, req, object(), state)
    ]
    assert events == []
    assert calls == []
    assert state.durable_task_completed is False


@pytest.mark.asyncio
async def test_markdown_followup_publishes_non_steerable_phase_before_handling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.services.chat.durable_task as durable_task_module

    engine = _engine()
    with Session(engine) as session:
        project = Project(name="Markdown phase", client="Client", status="active")
        session.add(project)
        session.flush()
        conversation_id, _ = _create_run(session, "run_markdown_followup_phase")
        conversation = session.get(Conversation, conversation_id)
        conversation.project_id = int(project.id)
        session.add(conversation)
        session.add(
            Message(
                conversation_id=conversation_id,
                role="assistant",
                content="上一条分析",
            )
        )
        session.commit()
        project_id = int(project.id)

    monkeypatch.setattr(
        durable_task_module,
        "save_previous_answer_as_markdown",
        lambda **_kwargs: {"ok": False, "error": "test boundary"},
    )
    runtime = ChatRuntime(
        conv_id=conversation_id,
        project_id=project_id,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        action_policy="write_artifact",
        intent_prepared_async=True,
    )
    state = ChatSessionState(
        run_id="run_markdown_followup_phase",
        rollout_bind=engine,
    )
    req = SimpleNamespace(
        project_id=project_id,
        content="把上一条回复保存为 Markdown",
    )

    events = [event async for event in run_durable_task(runtime, req, engine, state)]
    assert any('"type": "done"' in event for event in events)
    with Session(engine) as session:
        chat_run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_markdown_followup_phase")
        ).one()
        assert chat_run.action_policy == "write_artifact"
        assert chat_run.status == "completed"
        assert chat_run.phase == "durable_task_done"
        assert chat_run.completed_at is not None
        assert state.rollout_finalized is True


@pytest.mark.asyncio
async def test_durable_task_cancel_before_completion_close_never_emits_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.routers.chat as chat_router
    import app.services.chat.durable_task as durable_task_module

    engine = _engine()
    with Session(engine) as session:
        project = Project(name="Before done race", client="Client", status="active")
        session.add(project)
        session.flush()
        conversation_id, run = _create_run(session, "run_cancel_before_durable_done")
        conversation = session.get(Conversation, conversation_id)
        conversation.project_id = int(project.id)
        session.add(conversation)
        session.commit()
        project_id = int(project.id)
        rollout_task_id = int(run.task_run_id)

    monkeypatch.setattr(
        durable_task_module,
        "save_previous_answer_as_markdown",
        lambda **_kwargs: {"ok": False, "error": "controlled pre-done window"},
    )
    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    runtime = ChatRuntime(
        conv_id=conversation_id,
        project_id=project_id,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        action_policy="write_artifact",
        intent_prepared_async=True,
    )
    state = ChatSessionState(
        run_id="run_cancel_before_durable_done",
        rollout_task_id=rollout_task_id,
        rollout_bind=engine,
    )
    req = SimpleNamespace(
        project_id=project_id,
        content="把上一条回复保存为 Markdown",
    )
    stream = run_durable_task(runtime, req, engine, state).__aiter__()
    events: list[str] = []

    while True:
        event = await stream.__anext__()
        events.append(event)
        if '"type": "timing"' in event:
            break

    with Session(engine) as session:
        response = await chat_router.cancel_chat_run(
            state.run_id,
            session=session,
            current_user=object(),
        )
    assert response["delivery"] == "durable_boundary"

    with pytest.raises(asyncio.CancelledError, match="aria_user_interrupted"):
        await stream.__anext__()
    assert not any('"type": "done"' in event for event in events)
    assert state.assistant_message_id is None
    assert state.rollout_finalized is False

    # Model the outer stream's terminal cancellation finalizer.  The cancel
    # intent becomes applied only once ChatRun status proves that cancellation
    # won; no completed projection was ever persisted or emitted.
    finalize_chat_rollout(
        engine,
        rollout_task_id,
        status="cancelled",
        phase="durable_task_cancelled",
    )
    finalize_durable_run_inputs(engine, run_id=state.run_id)
    with Session(engine) as session:
        chat_run = session.exec(
            select(ChatRun).where(ChatRun.run_id == state.run_id)
        ).one()
        cancel_input = session.exec(
            select(ChatRunInput).where(
                ChatRunInput.run_id == state.run_id,
                ChatRunInput.kind == "cancel",
            )
        ).one()
        assert chat_run.status == "cancelled"
        assert chat_run.status != "completed"
        assert cancel_input.status == "applied"
        assert session.exec(
            select(Message).where(
                Message.conversation_id == conversation_id,
                Message.role == "assistant",
            )
        ).all() == []


@pytest.mark.asyncio
async def test_durable_task_done_is_terminal_before_done_and_rejects_late_cancel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.routers.chat as chat_router
    import app.services.chat.durable_task as durable_task_module

    engine = _engine()
    with Session(engine) as session:
        project = Project(name="After done race", client="Client", status="active")
        session.add(project)
        session.flush()
        conversation_id, run = _create_run(session, "run_cancel_after_durable_done")
        conversation = session.get(Conversation, conversation_id)
        conversation.project_id = int(project.id)
        session.add(conversation)
        session.commit()
        project_id = int(project.id)
        rollout_task_id = int(run.task_run_id)

    monkeypatch.setattr(
        durable_task_module,
        "save_previous_answer_as_markdown",
        lambda **_kwargs: {"ok": False, "error": "controlled post-done window"},
    )
    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    runtime = ChatRuntime(
        conv_id=conversation_id,
        project_id=project_id,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        action_policy="write_artifact",
        intent_prepared_async=True,
    )
    state = ChatSessionState(
        run_id="run_cancel_after_durable_done",
        rollout_task_id=rollout_task_id,
        rollout_bind=engine,
    )
    req = SimpleNamespace(
        project_id=project_id,
        content="把上一条回复保存为 Markdown",
    )

    stream = run_durable_task(runtime, req, engine, state).__aiter__()
    while True:
        event = await stream.__anext__()
        if '"type": "done"' in event:
            break

    assert state.rollout_finalized is True
    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == state.run_id)
        ).one()
        assert run.status == "completed"
        assert run.phase == "durable_task_done"
        assert run.completed_at is not None
        with pytest.raises(HTTPException) as rejected:
            await chat_router.cancel_chat_run(
                state.run_id,
                session=session,
                current_user=object(),
            )
        assert rejected.value.status_code == 409
        assert session.exec(select(ChatRunInput)).all() == []


@pytest.mark.asyncio
async def test_durable_task_finalize_failure_suppresses_legacy_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.services.chat.durable_task as durable_task_module

    engine = _engine()
    with Session(engine) as session:
        project = Project(name="Finalize failure", client="Client", status="active")
        session.add(project)
        session.flush()
        conversation_id, run = _create_run(session, "run_durable_finalize_failure")
        conversation = session.get(Conversation, conversation_id)
        conversation.project_id = int(project.id)
        session.add(conversation)
        session.commit()
        project_id = int(project.id)
        rollout_task_id = int(run.task_run_id)

    monkeypatch.setattr(
        durable_task_module,
        "save_previous_answer_as_markdown",
        lambda **_kwargs: {"ok": False, "error": "injected finalize failure"},
    )
    monkeypatch.setattr(
        durable_task_module,
        "finalize_chat_rollout",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("db finalize failed")),
    )
    runtime = ChatRuntime(
        conv_id=conversation_id,
        project_id=project_id,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        action_policy="write_artifact",
        intent_prepared_async=True,
    )
    state = ChatSessionState(
        run_id="run_durable_finalize_failure",
        rollout_task_id=rollout_task_id,
        rollout_bind=engine,
    )
    req = SimpleNamespace(
        project_id=project_id,
        content="把上一条回复保存为 Markdown",
    )
    events: list[str] = []

    with pytest.raises(
        DurableTaskControlBoundaryError,
        match="terminal state could not be persisted",
    ):
        async for event in run_durable_task(runtime, req, engine, state):
            events.append(event)

    assert not any('"type": "done"' in event for event in events)
    assert state.rollout_finalized is False
    assert state.assistant_message_id is not None
    with Session(engine) as session:
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == state.run_id)
        ).one()
        assert run.status == "running"
        assert run.phase == "durable_task_done"
        assert run.completed_at is None


def test_finalizer_marks_pending_unapplied_and_v2_snapshot_binds_message_ids() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_recovery_parent")
        message, item = _accept_steering(session, run, "恢复时继续使用")
        run.status = "failed"
        run.completed_at = run.created_at
        session.add(run)
        session.commit()
        input_id = int(item.id)
        message_id = int(message.id)

    assert finalize_durable_run_inputs(
        engine,
        run_id="run_recovery_parent",
    ) == (input_id,)
    runtime = SimpleNamespace(
        conv_id=conversation_id,
        prepare_metrics={
            "turn_recovery": {
                "schema_version": 2,
                "source_run_id": "run_recovery_parent",
                "contract_sha256": "a" * 64,
            }
        },
    )
    with Session(engine) as session:
        identity = recovery_run_identity_from_runtime(
            runtime,
            session=session,
            conversation_id=conversation_id,
        )
    assert identity.parent_run_id == "run_recovery_parent"
    assert identity.unapplied_message_ids == (message_id,)
    assert len(identity.recovery_snapshot_sha256) == 64

    runtime.prepare_metrics["turn_recovery"]["contract_sha256"] = "b" * 64
    with Session(engine) as session:
        changed = recovery_run_identity_from_runtime(runtime, session=session)
    assert changed.recovery_snapshot_sha256 != identity.recovery_snapshot_sha256


def test_finalizer_rejects_running_run_and_preserves_accepted_inputs() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_still_running")
        _, steering = _accept_steering(session, run, "仍在运行时不能伪造未应用")
        cancel = accept_cancel_run_input(
            session,
            run_id=run.run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        steering_id = int(steering.id)
        cancel_id = int(cancel.id)

    with pytest.raises(DurableRunInputRejected) as rejected:
        finalize_durable_run_inputs(engine, run_id="run_still_running")
    assert rejected.value.code == "run_not_terminal"
    with Session(engine) as session:
        assert session.get(ChatRunInput, steering_id).status == "accepted"
        assert session.get(ChatRunInput, cancel_id).status == "accepted"


def test_terminal_cancel_ack_is_applied_only_after_cancelled_status() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_terminal_cancel_ack")
        cancel = accept_cancel_run_input(
            session,
            run_id=run.run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        cancel_id = int(cancel.id)

    with pytest.raises(DurableRunInputRejected) as early:
        acknowledge_durable_run_cancel_after_terminal(
            engine,
            run_id="run_terminal_cancel_ack",
        )
    assert early.value.code == "run_not_terminal"
    with Session(engine) as session:
        assert session.get(ChatRunInput, cancel_id).status == "accepted"
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_terminal_cancel_ack")
        ).one()
        run.status = "cancelled"
        run.completed_at = run.created_at
        session.add(run)
        session.commit()

    assert acknowledge_durable_run_cancel_after_terminal(
        engine,
        run_id="run_terminal_cancel_ack",
    ) == (cancel_id,)
    with Session(engine) as session:
        stored = session.get(ChatRunInput, cancel_id)
        assert stored.status == "applied"
        assert stored.applied_at is not None


def test_recovery_surfaces_claimed_input_identity_and_verified_body() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_claim_crash_window")
        message, _ = _accept_steering(session, run, "已领取但回执未知")
        session.commit()
        message_id = int(message.id)
    batch = claim_durable_run_inputs(
        engine,
        run_id="run_claim_crash_window",
        conversation_id=conversation_id,
    )
    assert batch.steering

    runtime = SimpleNamespace(
        conv_id=conversation_id,
        prepare_metrics={
            "turn_recovery": {
                "schema_version": 2,
                "source_run_id": "run_claim_crash_window",
                "contract_sha256": "d" * 64,
            }
        },
    )
    with Session(engine) as session:
        identity = recovery_run_identity_from_runtime(runtime, session=session)
        recovered = load_recovery_steering_messages(
            session,
            parent_run_id="run_claim_crash_window",
            conversation_id=conversation_id,
        )
    assert identity.unapplied_message_ids == ()
    assert identity.applied_message_ids == (message_id,)
    assert recovered[0].status == "applied"
    assert recovered[0].content == "已领取但回执未知"
    history_messages = build_recovery_steering_history_messages(recovered)
    assert history_messages[0]["role"] == "user"
    assert "provider receipt is not guaranteed" in history_messages[0]["content"]
    assert history_messages[0]["content"].count("已领取但回执未知") == 1

    with Session(engine) as session:
        message = session.get(Message, message_id)
        message.content = "被篡改"
        session.add(message)
        session.commit()
        with pytest.raises(DurableRunInputRejected) as invalid:
            load_recovery_steering_messages(
                session,
                parent_run_id="run_claim_crash_window",
                conversation_id=conversation_id,
            )
        assert invalid.value.code == "recovery_input_invalid"


def test_accept_fails_closed_for_cross_conversation_terminal_and_full_queue() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_closed_inputs")
        with pytest.raises(DurableRunInputRejected, match="conversation mismatch"):
            accept_cancel_run_input(
                session,
                run_id=run.run_id,
                conversation_id=conversation_id + 1,
            )
        session.rollback()
        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_closed_inputs")
        ).one()
        for index in range(12):
            _accept_steering(session, run, f"pending {index}")
        with pytest.raises(DurableRunInputRejected) as full:
            _accept_steering(session, run, "pending overflow")
        assert full.value.code == "queue_full"
        session.rollback()

        run = session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_closed_inputs")
        ).one()
        run.status = "completed"
        session.add(run)
        session.commit()
        with pytest.raises(DurableRunInputRejected) as terminal:
            accept_cancel_run_input(
                session,
                run_id=run.run_id,
                conversation_id=conversation_id,
            )
        assert terminal.value.code == "run_not_active"


def test_steering_is_rejected_after_durable_cancel_intent() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, run = _create_run(session, "run_stopping_inputs")
        accept_cancel_run_input(
            session,
            run_id=run.run_id,
            conversation_id=conversation_id,
        )
        message = Message(
            conversation_id=conversation_id,
            role="user",
            content="取消后不应接受",
        )
        session.add(message)
        session.flush()
        with pytest.raises(DurableRunInputRejected) as stopping:
            accept_steering_run_input(
                session,
                run_id=run.run_id,
                conversation_id=conversation_id,
                message_id=int(message.id),
                content_digest=content_sha256(message.content),
            )
        assert stopping.value.code == "run_stopping"


def test_parent_snapshot_unique_constraint_blocks_duplicate_recovery_child() -> None:
    engine = _engine()
    with Session(engine) as session:
        conversation_id, parent = _create_run(session, "run_parent_unique")
        for index in range(2):
            task = TaskRun(
                conversation_id=conversation_id,
                task_type="chat_rollout",
                status="running",
            )
            session.add(task)
            session.flush()
            session.add(
                ChatRun(
                    run_id=f"run_child_{index}",
                    task_run_id=int(task.id),
                    parent_run_id=parent.run_id,
                    recovery_snapshot_sha256="c" * 64,
                    conversation_id=conversation_id,
                )
            )
            if index == 0:
                session.commit()
            else:
                with pytest.raises(IntegrityError):
                    session.commit()
                session.rollback()


@pytest.mark.parametrize(
    ("action_policy", "phase"),
    [
        ("durable_task", "run_start"),
        ("destructive_action", "run_start"),
        ("direct_answer", "non_steerable_execution"),
    ],
)
@pytest.mark.asyncio
async def test_remote_steer_rejects_persisted_non_steerable_run_without_writes(
    monkeypatch: pytest.MonkeyPatch,
    action_policy: str,
    phase: str,
) -> None:
    import app.routers.chat as chat_router
    from app.routers.chat_schemas import SteerChatRunRequest

    engine = _engine()
    run_id = f"run_remote_closed_{action_policy}_{phase}"
    with Session(engine) as session:
        _, run = _create_run(session, run_id)
        run.action_policy = action_policy
        run.phase = phase
        session.add(run)
        session.commit()

    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    with Session(engine) as session:
        with pytest.raises(HTTPException) as raised:
            await chat_router.steer_chat_run(
                run_id,
                SteerChatRunRequest(
                    expected_run_id=run_id,
                    content="这条输入不能进入非 steerable 运行",
                ),
                session=session,
                current_user=object(),
            )
        assert raised.value.status_code == 409
        assert session.exec(select(Message)).all() == []
        assert session.exec(select(ChatRunInput)).all() == []


def test_locked_steering_accept_reloads_non_steerable_projection() -> None:
    engine = _engine()
    stale_session = Session(engine, expire_on_commit=False)
    try:
        conversation_id, run = _create_run(stale_session, "run_steer_phase_race")
        stale_run = stale_session.exec(
            select(ChatRun).where(ChatRun.run_id == "run_steer_phase_race")
        ).one()
        assert stale_run.action_policy == ""
        stale_session.commit()

        with Session(engine) as phase_session:
            current = phase_session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_steer_phase_race")
            ).one()
            current.action_policy = "durable_task"
            current.phase = "durable_task"
            phase_session.add(current)
            phase_session.commit()

        message = Message(
            conversation_id=conversation_id,
            role="user",
            content="并发边界后的输入",
        )
        stale_session.add(message)
        stale_session.flush()
        with pytest.raises(DurableRunInputRejected) as rejected:
            accept_steering_run_input(
                stale_session,
                run_id=run.run_id,
                conversation_id=conversation_id,
                message_id=int(message.id),
                content_digest=content_sha256(message.content),
            )
        assert rejected.value.code == "run_not_steerable"
        stale_session.rollback()
    finally:
        stale_session.close()

    with Session(engine) as session:
        assert session.exec(select(ChatRunInput)).all() == []


@pytest.mark.asyncio
async def test_steer_route_accepts_without_local_registry_and_boundary_consumes_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.routers.chat as chat_router
    from app.routers.chat_schemas import SteerChatRunRequest

    engine = _engine()
    with Session(engine) as session:
        conversation_id, _ = _create_run(session, "run_remote_steering")

    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    with Session(engine) as session:
        response = await chat_router.steer_chat_run(
            "run_remote_steering",
            SteerChatRunRequest(
                expected_run_id="run_remote_steering",
                content="由另一 Worker 接收",
            ),
            session=session,
            current_user=object(),
        )
    assert response["status"] == "steering_accepted"

    runtime = SimpleNamespace(
        conv_id=conversation_id,
        system="system",
        tools=[],
        action_policy="direct_answer",
        tool_access_policy="none",
    )
    state = ChatSessionState(run_id="run_remote_steering", rollout_bind=engine)
    first, _ = _drain_steering_boundary(runtime, state, stage="remote_worker")
    second, _ = _drain_steering_boundary(runtime, state, stage="remote_worker_again")
    assert [item.content for item in first] == ["由另一 Worker 接收"]
    assert second == ()


@pytest.mark.asyncio
async def test_cancel_route_accepts_without_local_registry_for_remote_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.routers.chat as chat_router

    engine = _engine()
    with Session(engine) as session:
        conversation_id, _ = _create_run(session, "run_remote_cancel")

    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    with Session(engine) as session:
        response = await chat_router.cancel_chat_run(
            "run_remote_cancel",
            session=session,
            current_user=object(),
        )
    assert response["status"] == "cancellation_requested"
    assert response["delivery"] == "durable_boundary"

    runtime = SimpleNamespace(conv_id=conversation_id)
    state = ChatSessionState(run_id="run_remote_cancel", rollout_bind=engine)
    with pytest.raises(asyncio.CancelledError, match="aria_user_interrupted"):
        _drain_steering_boundary(runtime, state, stage="remote_cancel_boundary")
    with Session(engine) as session:
        item = session.exec(
            select(ChatRunInput).where(
                ChatRunInput.run_id == "run_remote_cancel",
                ChatRunInput.kind == "cancel",
            )
        ).one()
        assert item.status == "accepted"
        assert item.applied_at is None
