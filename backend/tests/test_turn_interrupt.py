from __future__ import annotations

import asyncio

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
    session = object()
    current_user = object()

    response = await chat_router.cancel_chat_run(
        "run_endpoint_test",
        session=session,
        current_user=current_user,
    )

    assert response["status"] == "cancellation_requested"
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
    }
