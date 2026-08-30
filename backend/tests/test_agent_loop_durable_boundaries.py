from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

import app.routers.chat as chat_router
import app.services.chat as chat_service
import app.services.chat.agent_loop as agent_loop_module
from app.models.db import ChatRun, ChatRunInput, Conversation, Message, TaskRun
from app.routers.chat_schemas import SendMessageRequest, SteerChatRunRequest
from app.services.agent_harness.durable_run_inputs import (
    DurableRunInputRejected,
    accept_cancel_run_input,
    accept_steering_run_input,
    content_sha256,
    durable_run_accepts_cancel,
    durable_run_accepts_local_cancel,
    finalize_durable_run_inputs,
)
from app.services.agent_harness.turn_interrupt import (
    register_active_turn,
    unregister_active_turn,
)
from app.services.agent_harness.tool_policy import PolicyDecision
from app.services.chat.agent_loop import _drain_steering_boundary, run_agent_loop
from app.services.chat.persist import run_persist
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime
from app.services.context_builder.assembly import assemble_context


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_phase_error_message_persist_failure_keeps_product_failure_last(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime = ChatRuntime(
        conv_id=1,
        selected_model="test-model",
        llm=SimpleNamespace(complete=None),
        system="system",
        api_messages=[{"role": "user", "content": "question"}],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.0,
    )
    state = ChatSessionState(run_id="run_phase_error_persist_failed")

    def fail_persist(*_args, **_kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(chat_service, "persist_assistant_message", fail_persist)
    events = chat_service._persist_phase_error_events(
        runtime=runtime,
        req=SendMessageRequest(content="question"),
        bind=object(),
        state=state,
        phase="agent_loop",
        exc=RuntimeError("provider failed"),
    )
    payloads = [chat_service._sse_payload(event) for event in events]

    assert [payload.get("type") for payload in payloads] == ["error", "run_failed"]
    assert payloads[-1]["error_code"] == "PERSISTENCE_ERROR"


def _create_run(engine, run_id: str) -> tuple[int, int]:
    with Session(engine) as session:
        conversation = Conversation(title="Durable Agent Loop boundary")
        session.add(conversation)
        session.flush()
        task = TaskRun(
            conversation_id=int(conversation.id),
            task_type="chat_rollout",
            status="running",
            current_step_key="agent_loop",
        )
        session.add(task)
        session.flush()
        session.add(
            ChatRun(
                run_id=run_id,
                task_run_id=int(task.id),
                conversation_id=int(conversation.id),
                action_policy="direct_answer",
                status="running",
                phase="run_start",
            )
        )
        session.commit()
        return int(conversation.id), int(task.id)


def _accept_steering(
    session: Session,
    *,
    run_id: str,
    conversation_id: int,
    content: str,
) -> ChatRunInput:
    message = Message(
        conversation_id=conversation_id,
        role="user",
        content=content,
        metadata_json="{}",
    )
    session.add(message)
    session.flush()
    item = accept_steering_run_input(
        session,
        run_id=run_id,
        conversation_id=conversation_id,
        message_id=int(message.id),
        content_digest=content_sha256(content),
    )
    message.set_metadata(
        {
            "run_steering": {
                "schema_version": "aria.run_steering.v1",
                "status": "accepted",
                "run_id": run_id,
                "expected_run_id": run_id,
                "steering_id": f"steer_boundary_{item.sequence}",
                "sequence": item.sequence,
                "input_id": item.id,
            }
        }
    )
    session.add(message)
    session.commit()
    session.refresh(item)
    return item


def _runtime(conversation_id: int, llm, *, max_steps: int = 3):
    assembly = assemble_context(
        system="system",
        messages=[{"role": "user", "content": "先回答一版"}],
        tools=None,
        sources=[],
        context_window_tokens=4_096,
        max_output_tokens=256,
    )
    return SimpleNamespace(
        conv_id=conversation_id,
        llm=llm,
        system=assembly.system,
        selected_model="test-model",
        tools=assembly.tools,
        max_tokens=256,
        temperature=0.0,
        api_messages=assembly.messages,
        context_manifest=assembly.manifest,
        action_policy="direct_answer",
        tool_access_policy="none",
        agent_turn_max_steps=max_steps,
        agent_turn_max_tool_calls=8,
        agent_turn_timeout_seconds=60,
    )


class _TwoAnswerLLM:
    def __init__(self) -> None:
        self.requests: list[list[dict]] = []

    async def stream_response(self, messages, **_kwargs):
        self.requests.append(list(messages))
        yield "初稿" if len(self.requests) == 1 else "已按追加要求修订"


@pytest.mark.asyncio
async def test_claimed_durable_steering_requires_a_base_context_manifest() -> None:
    engine = _engine()
    run_id = "run_missing_base_context_manifest"
    conversation_id, task_id = _create_run(engine, run_id)
    with Session(engine) as session:
        _accept_steering(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
            content="这条已提交 steering 不得绕过 context manifest",
        )

    llm = _TwoAnswerLLM()
    runtime = _runtime(conversation_id, llm, max_steps=1)
    runtime.context_manifest = None
    state = ChatSessionState(
        run_id=run_id,
        rollout_task_id=task_id,
        rollout_bind=engine,
    )

    with pytest.raises(
        RuntimeError,
        match="missing_base_manifest_for_post_assembly_input",
    ):
        async for _ in run_agent_loop(
            runtime,
            SendMessageRequest(content="先回答一版"),
            state,
        ):
            pass

    assert llm.requests == []
    assert any(
        event.get("type") == "context_assembly_request_rejected"
        and event.get("reason") == "missing_base_manifest_for_post_assembly_input"
        for event in state.trace_events
    )


class _ManifestAnswerLLM:
    def __init__(self) -> None:
        self.requests: list[tuple[list[dict], dict]] = []

    async def stream_response(self, messages, **kwargs):
        self.requests.append((list(messages), dict(kwargs)))
        yield "manifest-safe answer"


def _context_assembly():
    return assemble_context(
        system="strict baseline system",
        messages=[{"role": "user", "content": "baseline request"}],
        tools=[
            {
                "name": "read_project_file",
                "description": "read one project file",
                "input_schema": {"type": "object", "properties": {}},
            }
        ],
        sources=[],
        context_window_tokens=4_096,
        max_output_tokens=256,
    )


@pytest.mark.parametrize(
    ("max_steps", "steering_content", "restrictive"),
    [
        (2, "改成董事会口径", False),
        (1, "不要执行任何工具，只分析", True),
    ],
)
@pytest.mark.asyncio
async def test_verified_pre_model_steering_derives_real_context_manifest_request(
    max_steps: int,
    steering_content: str,
    restrictive: bool,
) -> None:
    engine = _engine()
    run_id = f"run_manifest_delta_{max_steps}"
    conversation_id, task_id = _create_run(engine, run_id)
    with Session(engine) as session:
        item = _accept_steering(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
            content=steering_content,
        )
        input_id = int(item.id)

    assembly = _context_assembly()
    llm = _ManifestAnswerLLM()
    runtime = ChatRuntime(
        conv_id=conversation_id,
        selected_model="test-model",
        llm=llm,
        system=assembly.system,
        api_messages=assembly.messages,
        rag_sources=[],
        tools=assembly.tools,
        max_tokens=256,
        temperature=0.0,
        context_manifest=assembly.manifest,
        context_window_tokens=4_096,
        agent_turn_max_steps=max_steps,
    )
    state = ChatSessionState(
        run_id=run_id,
        rollout_task_id=task_id,
        rollout_bind=engine,
        context_manifest=assembly.manifest,
    )
    events = [
        event
        async for event in run_agent_loop(
            runtime,
            SendMessageRequest(content="baseline request"),
            state,
        )
    ]

    assert len(llm.requests) == 1
    request_messages, request_kwargs = llm.requests[0]
    assert steering_content in json.dumps(request_messages, ensure_ascii=False)
    if restrictive:
        assert request_kwargs["tools"] == []
        assert "Current Run Steering Safety Override" in request_kwargs["system"]
    else:
        assert len(request_kwargs["tools"]) == 1
        assert request_kwargs["system"] == assembly.system
    assert any('"type": "steering_applied"' in event for event in events)

    baseline_events = [
        item
        for item in state.trace_events
        if item.get("type") == "context_assembly_baseline_validated"
    ]
    derived_events = [
        item
        for item in state.trace_events
        if item.get("type") == "context_assembly_derived_request_validated"
    ]
    assert len(baseline_events) == 1
    assert len(derived_events) == 1
    derived = derived_events[0]["derived_manifest"]
    assert derived["base_manifest_sha256"] == assembly.manifest["manifest_sha256"]
    assert derived["durable_inputs"] == [
        {
            "run_id": run_id,
            "steering_id": f"steer_boundary_{item.sequence}",
            "sequence": item.sequence,
            "message_id": item.message_id,
            "content_sha256": content_sha256(steering_content),
        }
    ]
    assert steering_content not in json.dumps(derived, ensure_ascii=False)
    assert derived["model_input"]["tools"]["tool_count"] == (0 if restrictive else 1)
    with Session(engine) as session:
        stored = session.get(ChatRunInput, input_id)
        assert stored.status == "applied"


@pytest.mark.parametrize("tamper", ("content", "message_reference"))
@pytest.mark.asyncio
async def test_invalid_durable_steering_is_retracted_before_manifest_delta(
    tamper: str,
) -> None:
    engine = _engine()
    run_id = f"run_manifest_invalid_{tamper}"
    conversation_id, task_id = _create_run(engine, run_id)
    with Session(engine) as session:
        item = _accept_steering(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
            content="trusted before tamper",
        )
        input_id = int(item.id)
        message_id = int(item.message_id)
        if tamper == "content":
            message = session.get(Message, message_id)
            message.content = "tampered after acceptance"
            session.add(message)
        else:
            unrelated = Message(
                conversation_id=conversation_id,
                role="user",
                content="unrelated message reference",
            )
            session.add(unrelated)
            session.flush()
            item.message_id = int(unrelated.id)
            session.add(item)
        session.commit()

    assembly = _context_assembly()
    llm = _ManifestAnswerLLM()
    runtime = ChatRuntime(
        conv_id=conversation_id,
        selected_model="test-model",
        llm=llm,
        system=assembly.system,
        api_messages=assembly.messages,
        rag_sources=[],
        tools=assembly.tools,
        max_tokens=256,
        temperature=0.0,
        context_manifest=assembly.manifest,
        context_window_tokens=4_096,
        agent_turn_max_steps=1,
    )
    state = ChatSessionState(
        run_id=run_id,
        rollout_task_id=task_id,
        rollout_bind=engine,
        context_manifest=assembly.manifest,
    )
    async for _event in run_agent_loop(
        runtime,
        SendMessageRequest(content="baseline request"),
        state,
    ):
        pass

    assert len(llm.requests) == 1
    rendered_request = json.dumps(llm.requests[0][0], ensure_ascii=False)
    assert "trusted before tamper" not in rendered_request
    assert "tampered after acceptance" not in rendered_request
    assert not any(
        item.get("type") == "context_assembly_derived_request_validated"
        for item in state.trace_events
    )
    with Session(engine) as session:
        stored = session.get(ChatRunInput, input_id)
        assert stored.status == "retracted"


class _TwoBoundarySteeringLLM:
    def __init__(self, engine, *, run_id: str, conversation_id: int) -> None:
        self.engine = engine
        self.run_id = run_id
        self.conversation_id = conversation_id
        self.requests: list[list[dict]] = []

    async def stream_response(self, messages, **_kwargs):
        self.requests.append(list(messages))
        if len(self.requests) == 1:
            for index in range(12):
                with Session(self.engine) as session:
                    _accept_steering(
                        session,
                        run_id=self.run_id,
                        conversation_id=self.conversation_id,
                        content=f"first boundary {index}",
                    )
            yield "first answer"
            return
        yield "second answer"


@pytest.mark.asyncio
async def test_derived_manifest_bounds_two_full_steering_batches() -> None:
    engine = _engine()
    run_id = "run_manifest_two_full_batches"
    conversation_id, task_id = _create_run(engine, run_id)
    assembly = _context_assembly()
    llm = _TwoBoundarySteeringLLM(
        engine,
        run_id=run_id,
        conversation_id=conversation_id,
    )
    runtime = ChatRuntime(
        conv_id=conversation_id,
        selected_model="test-model",
        llm=llm,
        system=assembly.system,
        api_messages=assembly.messages,
        rag_sources=[],
        tools=assembly.tools,
        max_tokens=256,
        temperature=0.0,
        context_manifest=assembly.manifest,
        context_window_tokens=4_096,
        agent_turn_max_steps=2,
    )
    state = ChatSessionState(
        run_id=run_id,
        rollout_task_id=task_id,
        rollout_bind=engine,
        context_manifest=assembly.manifest,
    )
    second_batch_inserted = False
    async for event in run_agent_loop(
        runtime,
        SendMessageRequest(content="baseline request"),
        state,
    ):
        if (
            not second_batch_inserted
            and '"type": "step_completed"' in event
            and '"step_index": 1' in event
        ):
            for index in range(12):
                with Session(engine) as session:
                    _accept_steering(
                        session,
                        run_id=run_id,
                        conversation_id=conversation_id,
                        content=f"second boundary {index}",
                    )
            second_batch_inserted = True

    assert second_batch_inserted is True
    assert len(llm.requests) == 2
    rendered_second = json.dumps(llm.requests[1], ensure_ascii=False)
    assert all(f"first boundary {index}" in rendered_second for index in range(12))
    assert all(f"second boundary {index}" in rendered_second for index in range(12))
    derived_events = [
        item
        for item in state.trace_events
        if item.get("type") == "context_assembly_derived_request_validated"
    ]
    assert len(derived_events) == 1
    assert len(derived_events[0]["derived_manifest"]["durable_inputs"]) == 24


@pytest.mark.asyncio
async def test_registry_absent_steer_before_done_close_is_replanned_then_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pre-lock 202 is consumed; a post-close request is a ghost-free 409."""

    engine = _engine()
    run_id = "run_done_close_race"
    conversation_id, task_id = _create_run(engine, run_id)
    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    llm = _TwoAnswerLLM()
    state = ChatSessionState(
        run_id=run_id,
        rollout_task_id=task_id,
        rollout_bind=engine,
    )
    accepted = None
    events: list[str] = []

    async for event in run_agent_loop(
        _runtime(conversation_id, llm),
        SendMessageRequest(content="先回答一版"),
        state,
    ):
        events.append(event)
        if accepted is None and '"type": "step_completed"' in event:
            # The generator is paused after its checkpoint but before the
            # agent_loop_done lock. No process-local registry is registered.
            with Session(engine) as remote_session:
                accepted = await chat_router.steer_chat_run(
                    run_id,
                    SteerChatRunRequest(
                        expected_run_id=run_id,
                        content="改成董事会口径",
                    ),
                    session=remote_session,
                    current_user=object(),
                )

    assert accepted is not None
    assert accepted["status"] == "steering_accepted"
    assert len(llm.requests) == 2
    assert "改成董事会口径" in json.dumps(llm.requests[1], ensure_ascii=False)
    assert any('"type": "steering_applied"' in event for event in events)

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        inputs = session.exec(select(ChatRunInput)).all()
        assert run.phase == "persist"
        assert [item.status for item in inputs] == ["applied"]
        assert len(session.exec(select(Message)).all()) == 1

    with Session(engine) as closed_session:
        with pytest.raises(HTTPException) as rejected:
            await chat_router.steer_chat_run(
                run_id,
                SteerChatRunRequest(
                    expected_run_id=run_id,
                    content="关闭后不能形成幽灵消息",
                ),
                session=closed_session,
                current_user=object(),
            )
        assert rejected.value.status_code == 409
        assert len(closed_session.exec(select(Message)).all()) == 1
        assert len(closed_session.exec(select(ChatRunInput)).all()) == 1


@pytest.mark.asyncio
async def test_persist_close_does_not_fake_apply_late_steering(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine()
    run_id = "run_persist_close"
    conversation_id, _ = _create_run(engine, run_id)
    with Session(engine) as session:
        item = _accept_steering(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
            content="保存前刚提交的要求",
        )
        input_id = int(item.id)

    runtime = SimpleNamespace(conv_id=conversation_id)
    state = ChatSessionState(run_id=run_id, rollout_bind=engine)
    claimed, events = _drain_steering_boundary(
        runtime,
        state,
        stage="before_persist",
        close_phase="persist",
        force_close=True,
        claim_steering=False,
    )
    assert claimed == ()
    assert events == []
    assert state.steering_inputs == []

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        stored = session.get(ChatRunInput, input_id)
        assert run.phase == "persist"
        assert stored.status == "accepted"
        assert stored.applied_at is None

    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    with Session(engine) as closed_session:
        with pytest.raises(HTTPException) as rejected:
            await chat_router.steer_chat_run(
                run_id,
                SteerChatRunRequest(
                    expected_run_id=run_id,
                    content="persist 后应直接冲突",
                ),
                session=closed_session,
                current_user=object(),
            )
        assert rejected.value.status_code == 409
        assert len(closed_session.exec(select(Message)).all()) == 1

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        run.status = "completed"
        run.completed_at = run.updated_at
        session.add(run)
        session.commit()
    assert finalize_durable_run_inputs(engine, run_id=run_id) == (input_id,)
    with Session(engine) as session:
        stored = session.get(ChatRunInput, input_id)
        assert stored.status == "unapplied"
        assert stored.applied_at is None


def test_persist_close_observes_cancel_but_defers_terminal_ack() -> None:
    engine = _engine()
    run_id = "run_persist_cancel_deferred_ack"
    conversation_id, _ = _create_run(engine, run_id)
    with Session(engine) as session:
        cancel = accept_cancel_run_input(
            session,
            run_id=run_id,
            conversation_id=conversation_id,
        )
        session.commit()
        cancel_id = int(cancel.id)

    runtime = SimpleNamespace(conv_id=conversation_id)
    state = ChatSessionState(run_id=run_id, rollout_bind=engine)
    with pytest.raises(asyncio.CancelledError, match="aria_user_interrupted"):
        _drain_steering_boundary(
            runtime,
            state,
            stage="before_persist",
            close_phase="persist",
            force_close=True,
            claim_steering=False,
        )

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        stored = session.get(ChatRunInput, cancel_id)
        assert run.phase == "persist"
        assert stored.status == "accepted"
        assert stored.applied_at is None
        run.status = "cancelled"
        run.completed_at = run.updated_at
        session.add(run)
        session.commit()

    assert finalize_durable_run_inputs(engine, run_id=run_id) == (cancel_id,)
    with Session(engine) as session:
        stored = session.get(ChatRunInput, cancel_id)
        assert stored.status == "applied"
        assert stored.applied_at is not None


class _ConfirmationPlanLLM:
    def __init__(self) -> None:
        self.requests: list[list[dict]] = []

    async def stream_response(self, messages, **_kwargs):
        self.requests.append(list(messages))
        if len(self.requests) == 1:
            yield json.dumps(
                {
                    "type": "tool_use",
                    "id": "call_stale_confirmation",
                    "name": "manage_project_files",
                    "input": {"action": "delete", "file_id": 7},
                }
            )
            return
        yield "旧确认计划已取消，已按新要求回答"


@pytest.mark.asyncio
async def test_committed_steering_supersedes_confirmation_before_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine()
    run_id = "run_confirmation_close"
    conversation_id, task_id = _create_run(engine, run_id)
    inserted = False

    def plan_with_remote_commit(tool_calls, **_kwargs):
        nonlocal inserted
        if not inserted:
            with Session(engine) as remote_session:
                _accept_steering(
                    remote_session,
                    run_id=run_id,
                    conversation_id=conversation_id,
                    content="不要删除，改为只说明风险",
                )
            inserted = True
        return SimpleNamespace(
            batches=(
                SimpleNamespace(
                    indexes=(0,),
                    parallel=False,
                    lane=SimpleNamespace(value="serial"),
                ),
            ),
            to_trace_dict=lambda: {},
        )

    async def must_not_execute(*_args, **_kwargs):
        raise AssertionError("superseded confirmation tool must not execute")

    monkeypatch.setattr(agent_loop_module, "plan_tool_execution", plan_with_remote_commit)
    monkeypatch.setattr(
        agent_loop_module,
        "evaluate_tool_policy",
        lambda *_args, **_kwargs: SimpleNamespace(decision=PolicyDecision.PROMPT),
    )
    monkeypatch.setattr(agent_loop_module, "execute_tool_with_policy", must_not_execute)

    llm = _ConfirmationPlanLLM()
    state = ChatSessionState(
        run_id=run_id,
        rollout_task_id=task_id,
        rollout_bind=engine,
    )
    events = [
        event
        async for event in run_agent_loop(
            _runtime(conversation_id, llm),
            SendMessageRequest(content="删除文件"),
            state,
        )
    ]

    assert inserted is True
    assert len(llm.requests) == 2
    assert "不要删除，改为只说明风险" in json.dumps(
        llm.requests[1],
        ensure_ascii=False,
    )
    assert state.confirmation_requested is False
    assert state.pending_tool_actions == []
    assert any(
        item.get("type") == "confirmation_superseded_by_steering"
        for item in state.trace_events
    )
    assert not any('"type": "confirmation_required"' in event for event in events)


@pytest.mark.parametrize(
    ("action_policy", "phase", "status", "expected"),
    [
        ("direct_answer", "run_start", "running", True),
        ("direct_answer", "agent_step_1", "running", True),
        ("durable_task", "non_steerable_execution", "running", True),
        ("direct_answer", "agent_loop_final_step", "running", False),
        ("direct_answer", "confirmation_tool", "running", False),
        ("direct_answer", "agent_loop_done", "running", False),
        ("direct_answer", "persist", "running", False),
        ("direct_answer", "waiting_confirmation", "running", False),
        ("durable_task", "durable_task_done", "running", False),
        ("destructive_action", "run_start", "running", False),
        ("durable_task", "durable_task", "completed", False),
    ],
)
def test_registry_absent_cancel_requires_a_future_durable_poll(
    action_policy: str,
    phase: str,
    status: str,
    expected: bool,
) -> None:
    run = SimpleNamespace(
        action_policy=action_policy,
        phase=phase,
        status=status,
        completed_at=None,
    )
    assert durable_run_accepts_cancel(run) is expected


def test_process_local_cancel_cannot_reopen_durable_task_done() -> None:
    run = SimpleNamespace(
        action_policy="durable_task",
        phase="durable_task_done",
        status="running",
        completed_at=None,
    )
    assert durable_run_accepts_local_cancel(run) is False


@pytest.mark.asyncio
async def test_registry_absent_cancel_after_closed_phase_is_ghost_free_409(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine()
    run_id = "run_remote_cancel_closed"
    conversation_id, _ = _create_run(engine, run_id)
    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        run.phase = "persist"
        session.add(run)
        session.commit()

    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    with Session(engine) as session:
        with pytest.raises(HTTPException) as rejected:
            await chat_router.cancel_chat_run(
                run_id,
                session=session,
                current_user=object(),
            )
        assert rejected.value.status_code == 409
        assert session.exec(select(ChatRunInput)).all() == []

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        assert int(run.conversation_id) == conversation_id
        assert run.phase == "persist"
        assert session.exec(select(ChatRunInput)).all() == []


@pytest.mark.asyncio
async def test_local_cancel_is_rejected_after_real_assistant_persist_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine()
    run_id = "run_real_persist_cancel_closed"
    conversation_id, task_id = _create_run(engine, run_id)
    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        run.phase = "persist"
        session.add(run)
        session.commit()

    runtime = ChatRuntime(
        conv_id=conversation_id,
        selected_model="test-model",
        llm=SimpleNamespace(complete=None),
        system="system",
        api_messages=[{"role": "user", "content": "question"}],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.0,
    )
    request = SendMessageRequest(
        conversation_id=conversation_id,
        content="question",
    )
    state = ChatSessionState(
        run_id=run_id,
        rollout_task_id=task_id,
        rollout_bind=engine,
        full_text="durably persisted answer",
        stream_started_at=time.perf_counter(),
    )
    persisted = asyncio.Event()
    release = asyncio.Event()
    events: list[str] = []

    async def consume_persist() -> None:
        async for event in run_persist(runtime, request, engine, state):
            events.append(event)
            if '"type": "message_persisted"' in event:
                persisted.set()
                await release.wait()

    monkeypatch.setattr(
        "app.services.chat.persist.persist_chat_trace",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.chat.persist.schedule_title_generation",
        lambda **_kwargs: None,
    )
    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    consumer = asyncio.create_task(consume_persist())
    register_active_turn(run_id, conversation_id, task=consumer)
    try:
        await asyncio.wait_for(persisted.wait(), timeout=2)
        assert state.assistant_message_id is not None
        assert consumer.done() is False
        with Session(engine) as session:
            assistant = session.get(Message, int(state.assistant_message_id))
            assert assistant is not None
            assert assistant.role == "assistant"
            with pytest.raises(HTTPException) as rejected:
                await chat_router.cancel_chat_run(
                    run_id,
                    session=session,
                    current_user=object(),
                )
            assert rejected.value.status_code == 409
            assert session.exec(select(ChatRunInput)).all() == []

        assert consumer.done() is False
        release.set()
        await consumer
        assert any('"type": "done"' in event for event in events)
    finally:
        release.set()
        unregister_active_turn(run_id, task=consumer)
        if not consumer.done():
            consumer.cancel()
            with pytest.raises(asyncio.CancelledError):
                await consumer


@pytest.mark.asyncio
async def test_local_active_cancel_at_confirmation_phase_is_db_first_then_finalized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine()
    run_id = "run_local_cancel_closed"
    conversation_id, _ = _create_run(engine, run_id)
    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        # A confirmation barrier rejects remote mailbox-only cancellation, but
        # a process-local live task can still be cancelled before persistence.
        run.phase = "confirmation_tool"
        session.add(run)
        session.commit()

    started = asyncio.Event()

    async def wait_forever() -> None:
        started.set()
        await asyncio.Event().wait()

    target = asyncio.create_task(wait_forever())
    await started.wait()
    register_active_turn(run_id, conversation_id, task=target)
    monkeypatch.setattr(
        chat_router,
        "require_conversation_access",
        lambda *_args, **_kwargs: None,
    )
    real_interrupt = chat_router.interrupt_active_turn
    committed_before_interrupt: list[int] = []

    def verify_commit_then_interrupt(*args, **kwargs):
        with Session(engine) as verifier:
            item = verifier.exec(select(ChatRunInput)).one()
            assert item.kind == "cancel"
            assert item.status == "accepted"
            assert item.applied_at is None
            committed_before_interrupt.append(int(item.id))
        return real_interrupt(*args, **kwargs)

    monkeypatch.setattr(
        chat_router,
        "interrupt_active_turn",
        verify_commit_then_interrupt,
    )
    try:
        with Session(engine) as session:
            response = await chat_router.cancel_chat_run(
                run_id,
                session=session,
                current_user=object(),
            )

        assert response["delivery"] == "immediate"
        assert response["status"] == "cancellation_requested"
        assert committed_before_interrupt == [int(response["input_id"])]
        with pytest.raises(asyncio.CancelledError):
            await target

        with Session(engine) as session:
            item = session.get(ChatRunInput, int(response["input_id"]))
            assert item is not None
            assert item.status == "accepted"
            assert item.applied_at is None
            run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
            run.status = "cancelled"
            run.completed_at = run.updated_at
            session.add(run)
            session.commit()

        assert finalize_durable_run_inputs(engine, run_id=run_id) == (
            int(response["input_id"]),
        )
        with Session(engine) as session:
            item = session.get(ChatRunInput, int(response["input_id"]))
            assert item is not None
            assert item.status == "applied"
            assert item.applied_at is not None
    finally:
        unregister_active_turn(run_id, task=target)
        if not target.done():
            target.cancel()
            with pytest.raises(asyncio.CancelledError):
                await target


def test_cancel_acceptance_refreshes_stale_projection_under_lock() -> None:
    engine = _engine()
    run_id = "run_cancel_locked_refresh"
    conversation_id, _ = _create_run(engine, run_id)

    with Session(engine, expire_on_commit=False) as stale_session:
        stale_run = stale_session.exec(
            select(ChatRun).where(ChatRun.run_id == run_id)
        ).one()
        assert stale_run.phase == "run_start"

        with Session(engine) as closer:
            current = closer.exec(
                select(ChatRun).where(ChatRun.run_id == run_id)
            ).one()
            current.phase = "persist"
            closer.add(current)
            closer.commit()

        # The caller's identity-map projection is stale. The acceptance helper
        # must refresh it inside the authoritative row lock before deciding.
        assert stale_run.phase == "run_start"
        with pytest.raises(DurableRunInputRejected) as rejected:
            accept_cancel_run_input(
                stale_session,
                run_id=run_id,
                conversation_id=conversation_id,
                allow_closed_phase=True,
            )
        assert rejected.value.code == "run_not_cancellable"
        stale_session.rollback()

    with Session(engine) as session:
        run = session.exec(select(ChatRun).where(ChatRun.run_id == run_id)).one()
        assert run.phase == "persist"
        assert session.exec(select(ChatRunInput)).all() == []
