from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.chat as chat_router
import app.services.chat as chat_service
from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.turn_interrupt import (
    InterruptStatus,
    get_active_turn,
    interrupt_active_turn,
    interrupted_reply,
    register_active_turn,
    unregister_active_turn,
)
from app.services.chat.agent_step import AgentStep
from app.services.chat_tools import ChatRuntime


@pytest.mark.asyncio
async def test_active_turn_registry_cancels_only_the_matching_conversation() -> None:
    started = asyncio.Event()

    async def wait_forever() -> None:
        started.set()
        await asyncio.Event().wait()

    task = asyncio.create_task(wait_forever())
    await started.wait()
    register_active_turn("run_registry_test", 17, task=task)

    mismatch = interrupt_active_turn("run_registry_test", conversation_id=18)
    assert mismatch.status is InterruptStatus.CONVERSATION_MISMATCH
    assert task.cancelled() is False

    accepted = interrupt_active_turn("run_registry_test", conversation_id=17)
    assert accepted.status is InterruptStatus.ACCEPTED
    with pytest.raises(asyncio.CancelledError):
        await task

    assert unregister_active_turn("run_registry_test", task=task) is True
    assert get_active_turn("run_registry_test") is None


def test_interrupted_reply_keeps_partial_text_and_tool_safety_warning() -> None:
    reply = interrupted_reply(
        "已经生成的部分",
        tool_execution_possible=True,
        reason="user_interrupted",
    )

    assert reply.startswith("已经生成的部分")
    assert "本轮已由用户停止" in reply
    assert "工具可能正在执行或已经部分完成" in reply


@pytest.mark.asyncio
async def test_cancel_endpoint_authorizes_before_cancelling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = asyncio.create_task(asyncio.Event().wait())
    register_active_turn("run_endpoint_test", 23, task=target)
    authorization: dict = {}

    def fake_require_access(session, conversation_id, current_user, *, require_write=False):
        authorization.update(
            session=session,
            conversation_id=conversation_id,
            current_user=current_user,
            require_write=require_write,
        )

    monkeypatch.setattr(chat_router, "require_conversation_access", fake_require_access)
    monkeypatch.setattr(
        chat_router,
        "resolve_active_durable_run",
        lambda *_args, **_kwargs: SimpleNamespace(
            conversation_id=23,
            status="running",
            phase="run_start",
            completed_at=None,
        ),
    )
    monkeypatch.setattr(
        chat_router,
        "accept_cancel_run_input",
        lambda *_args, **_kwargs: SimpleNamespace(id=81, sequence=1),
    )
    commits: list[bool] = []
    session = SimpleNamespace(commit=lambda: commits.append(True), rollback=lambda: None)
    current_user = object()

    response = await chat_router.cancel_chat_run(
        "run_endpoint_test",
        session=session,
        current_user=current_user,
    )

    assert response["status"] == "cancellation_requested"
    assert response["delivery"] == "immediate"
    # Process-local task cancellation is only a low-latency signal. The
    # durable intent remains accepted until the stream commits ChatRun as
    # terminal=cancelled and the terminal finalizer acknowledges it.
    assert commits == [True]
    assert authorization == {
        "session": session,
        "conversation_id": 23,
        "current_user": current_user,
        "require_write": True,
    }
    with pytest.raises(asyncio.CancelledError):
        await target
    assert get_active_turn("run_endpoint_test") is None


@pytest.mark.asyncio
async def test_cancel_endpoint_does_not_cancel_when_authorization_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = asyncio.create_task(asyncio.Event().wait())
    register_active_turn("run_endpoint_forbidden", 29, task=target)

    def deny(*_args, **_kwargs):
        raise HTTPException(status_code=403, detail="forbidden")

    monkeypatch.setattr(chat_router, "require_conversation_access", deny)
    monkeypatch.setattr(
        chat_router,
        "resolve_active_durable_run",
        lambda *_args, **_kwargs: SimpleNamespace(conversation_id=29),
    )
    with pytest.raises(HTTPException) as exc_info:
        await chat_router.cancel_chat_run(
            "run_endpoint_forbidden",
            session=object(),
            current_user=object(),
        )

    assert exc_info.value.status_code == 403
    assert target.done() is False
    target.cancel()
    with pytest.raises(asyncio.CancelledError):
        await target
    unregister_active_turn("run_endpoint_forbidden", task=target)


@pytest.mark.asyncio
async def test_stream_cancellation_persists_partial_reply_and_cancelled_rollout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    persisted: dict = {}
    finalized: dict = {}

    async def blocked_impl(runtime, req, bind, state, stream_started_at):
        state.steps.append(AgentStep(index=0))
        state.full_text = "已经生成的部分"
        state.workflow_started = True
        started.set()
        await asyncio.Event().wait()
        if False:  # pragma: no cover - makes this an async generator
            yield ""

    def fake_persist(bind, conversation_id, content, request_content, metadata):
        persisted.update(
            conversation_id=conversation_id,
            content=content,
            request_content=request_content,
            metadata=metadata,
        )
        return False, 99

    def fake_finalize(bind, task_id, **kwargs):
        finalized.update(task_id=task_id, **kwargs)
        return {"status": kwargs["status"]}

    monkeypatch.setattr(chat_service, "make_run_id", lambda: "run_stream_cancel_test")
    monkeypatch.setattr(chat_service, "begin_chat_rollout", lambda *_args: 41)
    monkeypatch.setattr(chat_service, "checkpoint_chat_rollout", lambda *_args: {})
    monkeypatch.setattr(chat_service, "persist_assistant_message", fake_persist)
    monkeypatch.setattr(chat_service, "finalize_chat_rollout", fake_finalize)
    monkeypatch.setattr(chat_service, "_stream_chat_events_impl", blocked_impl)

    runtime = ChatRuntime(
        conv_id=7,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        prepare_metrics={},
    )
    req = SendMessageRequest(conversation_id=7, content="继续")

    events: list[str] = []

    async def consume() -> None:
        async for event in chat_service.stream_chat_events(runtime, req, object()):
            events.append(event)

    task = asyncio.create_task(consume())
    await started.wait()
    outcome = interrupt_active_turn("run_stream_cancel_test", conversation_id=7)
    assert outcome.status is InterruptStatus.ACCEPTED

    await task

    assert get_active_turn("run_stream_cancel_test") is None
    assert persisted["conversation_id"] == 7
    assert persisted["request_content"] == "继续"
    assert "已经生成的部分" in persisted["content"]
    assert "本轮已由用户停止" in persisted["content"]
    assert "工具可能正在执行或已经部分完成" in persisted["content"]
    assert persisted["metadata"]["turn_interrupted"]["reason"] == "user_interrupted"
    assert persisted["metadata"]["run_rollout"]["status"] == "cancelled"
    assert any('"final_status": "cancelled"' in event for event in events)
    assert finalized == {
        "task_id": 41,
        "status": "cancelled",
        "message_id": 99,
        "phase": "stream",
        "error_code": "USER_INTERRUPTED",
            "error_message": "user_interrupted",
            "retryable": False,
            "run_outputs": [],
        }


@pytest.mark.asyncio
async def test_interrupt_after_assistant_persist_reports_actual_completed_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()
    finalized: dict = {}

    async def blocked_impl(runtime, req, bind, state, stream_started_at):
        state.full_text = "already persisted"
        state.assistant_message_id = 100
        started.set()
        await asyncio.Event().wait()
        if False:  # pragma: no cover - async-generator shape
            yield ""

    def fake_finalize(bind, task_id, **kwargs):
        finalized.update(task_id=task_id, **kwargs)
        return {"status": kwargs["status"]}

    monkeypatch.setattr(chat_service, "make_run_id", lambda: "run_interrupt_after_persist")
    monkeypatch.setattr(chat_service, "begin_chat_rollout", lambda *_args: 42)
    monkeypatch.setattr(chat_service, "finalize_chat_rollout", fake_finalize)
    monkeypatch.setattr(chat_service, "finalize_durable_run_inputs", lambda *_args, **_kwargs: ())
    monkeypatch.setattr(
        chat_service,
        "persist_assistant_message",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("already-persisted interrupt must not write another message")
        ),
    )
    monkeypatch.setattr(chat_service, "_stream_chat_events_impl", blocked_impl)
    runtime = ChatRuntime(
        conv_id=7,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        prepare_metrics={},
    )
    req = SendMessageRequest(conversation_id=7, content="继续")
    events: list[str] = []

    async def consume() -> None:
        async for event in chat_service.stream_chat_events(runtime, req, object()):
            events.append(event)

    task = asyncio.create_task(consume())
    await started.wait()
    outcome = interrupt_active_turn("run_interrupt_after_persist", conversation_id=7)
    assert outcome.status is InterruptStatus.ACCEPTED
    await task

    payloads = [chat_service._sse_payload(event) for event in events]
    terminals = [
        payload
        for payload in payloads
        if payload.get("type") in {"run_done", "run_failed"}
    ]
    assert terminals == [
        {
            "type": "run_done",
            "run_id": "run_interrupt_after_persist",
            "final_status": "completed",
            "message_id": 100,
        }
    ]
    assert finalized["status"] == "completed"
    assert finalized["phase"] == "persisted_before_interrupt"


@pytest.mark.asyncio
async def test_interrupt_finalize_failure_emits_only_persistence_error_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    started = asyncio.Event()

    async def blocked_impl(runtime, req, bind, state, stream_started_at):
        state.full_text = "partial"
        started.set()
        await asyncio.Event().wait()
        if False:  # pragma: no cover - async-generator shape
            yield ""

    monkeypatch.setattr(chat_service, "make_run_id", lambda: "run_interrupt_finalize_failure")
    monkeypatch.setattr(chat_service, "begin_chat_rollout", lambda *_args: 43)
    monkeypatch.setattr(
        chat_service,
        "persist_assistant_message",
        lambda *_args, **_kwargs: (False, 101),
    )
    monkeypatch.setattr(
        chat_service,
        "finalize_chat_rollout",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("terminal database unavailable")
        ),
    )
    monkeypatch.setattr(chat_service, "finalize_durable_run_inputs", lambda *_args, **_kwargs: ())
    monkeypatch.setattr(chat_service, "_stream_chat_events_impl", blocked_impl)
    runtime = ChatRuntime(
        conv_id=7,
        selected_model="test-model",
        llm=object(),
        system="system",
        api_messages=[],
        rag_sources=[],
        tools=None,
        max_tokens=128,
        temperature=0.1,
        prepare_metrics={},
    )
    req = SendMessageRequest(conversation_id=7, content="继续")
    events: list[str] = []

    async def consume() -> None:
        async for event in chat_service.stream_chat_events(runtime, req, object()):
            events.append(event)

    task = asyncio.create_task(consume())
    await started.wait()
    outcome = interrupt_active_turn(
        "run_interrupt_finalize_failure",
        conversation_id=7,
    )
    assert outcome.status is InterruptStatus.ACCEPTED
    await task

    payloads = [chat_service._sse_payload(event) for event in events]
    terminals = [
        payload
        for payload in payloads
        if payload.get("type") in {"done", "run_done", "run_failed"}
    ]
    assert len(terminals) == 1
    assert terminals[0]["type"] == "run_failed"
    assert terminals[0]["error_code"] == "PERSISTENCE_ERROR"
