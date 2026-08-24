from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.routers.chat as chat_router
from app.models.db import Conversation, Message
from app.routers.chat_schemas import SendMessageRequest, SteerChatRunRequest
from app.services.agent_harness.turn_interrupt import (
    SteeringStatus,
    drain_active_turn_steering,
    get_active_turn,
    register_active_turn,
    set_active_turn_stage,
    submit_active_turn_steering,
    unregister_active_turn,
)
from app.services.chat.agent_loop import run_agent_loop
from app.services.chat.state import ChatSessionState


@pytest.mark.asyncio
async def test_registry_binds_steering_to_expected_active_run() -> None:
    task = asyncio.create_task(asyncio.Event().wait())
    register_active_turn("run_steering_registry", 17, task=task)
    set_active_turn_stage(
        "run_steering_registry",
        stage="agent_loop",
        steerable=True,
    )

    mismatch = submit_active_turn_steering(
        "run_steering_registry",
        expected_run_id="run_another",
        conversation_id=17,
        content="控制在十页",
    )
    assert mismatch.status is SteeringStatus.EXPECTED_RUN_MISMATCH

    wrong_conversation = submit_active_turn_steering(
        "run_steering_registry",
        expected_run_id="run_steering_registry",
        conversation_id=18,
        content="控制在十页",
    )
    assert wrong_conversation.status is SteeringStatus.CONVERSATION_MISMATCH

    accepted = submit_active_turn_steering(
        "run_steering_registry",
        expected_run_id="run_steering_registry",
        conversation_id=17,
        content="控制在十页",
        message_id=91,
    )
    assert accepted.status is SteeringStatus.ACCEPTED
    assert accepted.steering is not None
    assert accepted.steering.sequence == 1
    assert accepted.steering.message_id == 91
    assert get_active_turn("run_steering_registry").pending_steering_count == 1

    drained = drain_active_turn_steering(
        "run_steering_registry",
        conversation_id=17,
    )
    assert [item.content for item in drained] == ["控制在十页"]
    assert drain_active_turn_steering("run_steering_registry", conversation_id=17) == ()

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    unregister_active_turn("run_steering_registry", task=task)


@pytest.mark.asyncio
async def test_registry_rejects_non_steerable_terminal_phase() -> None:
    task = asyncio.create_task(asyncio.Event().wait())
    register_active_turn("run_steering_closed", 19, task=task)
    set_active_turn_stage("run_steering_closed", stage="persist", steerable=False)

    outcome = submit_active_turn_steering(
        "run_steering_closed",
        expected_run_id="run_steering_closed",
        conversation_id=19,
        content="换成董事会口径",
    )
    assert outcome.status is SteeringStatus.NOT_STEERABLE

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    unregister_active_turn("run_steering_closed", task=task)


class _FakeSession:
    def __init__(self, conversation_id: int) -> None:
        self.conversation = SimpleNamespace(id=conversation_id, updated_at=None)
        self.added: list[object] = []
        self.committed = False
        self.rolled_back = False

    def add(self, item: object) -> None:
        self.added.append(item)

    def get(self, model, key):
        if model is Conversation and key == self.conversation.id:
            return self.conversation
        return None

    def flush(self) -> None:
        message = next(item for item in self.added if isinstance(item, Message))
        message.id = 73

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True


@pytest.mark.asyncio
async def test_steer_endpoint_authorizes_persists_and_enqueues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = asyncio.create_task(asyncio.Event().wait())
    register_active_turn("run_steering_endpoint", 23, task=task)
    set_active_turn_stage("run_steering_endpoint", stage="agent_loop", steerable=True)
    authorization: dict = {}

    def allow(session, conversation_id, current_user, *, require_write=False):
        authorization.update(
            conversation_id=conversation_id,
            current_user=current_user,
            require_write=require_write,
        )

    monkeypatch.setattr(chat_router, "require_conversation_access", allow)
    session = _FakeSession(23)
    user = object()
    response = await chat_router.steer_chat_run(
        "run_steering_endpoint",
        SteerChatRunRequest(
            expected_run_id="run_steering_endpoint",
            content="换成董事会口径",
        ),
        session=session,
        current_user=user,
    )

    assert response["status"] == "steering_accepted"
    assert response["message_id"] == 73
    assert session.committed is True
    assert authorization == {
        "conversation_id": 23,
        "current_user": user,
        "require_write": True,
    }
    message = next(item for item in session.added if isinstance(item, Message))
    metadata = json.loads(message.metadata_json)
    assert metadata["run_steering"]["run_id"] == "run_steering_endpoint"

    drained = drain_active_turn_steering("run_steering_endpoint", conversation_id=23)
    assert [item.message_id for item in drained] == [73]
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    unregister_active_turn("run_steering_endpoint", task=task)


@pytest.mark.asyncio
async def test_steer_endpoint_rejects_wrong_expected_run_before_persist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = asyncio.create_task(asyncio.Event().wait())
    register_active_turn("run_steering_expected", 29, task=task)
    set_active_turn_stage("run_steering_expected", stage="agent_loop", steerable=True)
    monkeypatch.setattr(chat_router, "require_conversation_access", lambda *_a, **_k: None)
    session = _FakeSession(29)

    with pytest.raises(HTTPException) as raised:
        await chat_router.steer_chat_run(
            "run_steering_expected",
            SteerChatRunRequest(expected_run_id="run_wrong", content="追加要求"),
            session=session,
            current_user=object(),
        )
    assert raised.value.status_code == 409
    assert not any(isinstance(item, Message) for item in session.added)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    unregister_active_turn("run_steering_expected", task=task)


@pytest.mark.asyncio
async def test_steer_endpoint_does_not_enqueue_when_authorization_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    task = asyncio.create_task(asyncio.Event().wait())
    register_active_turn("run_steering_forbidden", 30, task=task)
    set_active_turn_stage("run_steering_forbidden", stage="agent_loop", steerable=True)

    def deny(*_args, **_kwargs):
        raise HTTPException(status_code=403, detail="forbidden")

    monkeypatch.setattr(chat_router, "require_conversation_access", deny)
    session = _FakeSession(30)
    with pytest.raises(HTTPException) as raised:
        await chat_router.steer_chat_run(
            "run_steering_forbidden",
            SteerChatRunRequest(
                expected_run_id="run_steering_forbidden",
                content="不应入队",
            ),
            session=session,
            current_user=object(),
        )
    assert raised.value.status_code == 403
    assert not any(isinstance(item, Message) for item in session.added)
    assert get_active_turn("run_steering_forbidden").pending_steering_count == 0

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    unregister_active_turn("run_steering_forbidden", task=task)


class _SteeringLLM:
    def __init__(self) -> None:
        self.first_chunk_sent = asyncio.Event()
        self.release_first = asyncio.Event()
        self.requests: list[list[dict]] = []

    async def stream_response(self, messages, **_kwargs):
        self.requests.append(list(messages))
        if len(self.requests) == 1:
            yield "旧口径答案"
            self.first_chunk_sent.set()
            await self.release_first.wait()
            return
        yield "已按董事会口径修订"


@pytest.mark.asyncio
async def test_agent_loop_applies_mid_stream_steering_to_next_model_boundary() -> None:
    llm = _SteeringLLM()
    runtime = SimpleNamespace(
        conv_id=31,
        llm=llm,
        system="system",
        selected_model="test-model",
        tools=[{"name": "generate_docx"}],
        max_tokens=256,
        temperature=0.0,
        api_messages=[{"role": "user", "content": "先写一版"}],
        action_policy="write_artifact",
        tool_access_policy="write_allowed",
        agent_turn_max_steps=3,
        agent_turn_max_tool_calls=4,
        agent_turn_timeout_seconds=60,
    )
    state = ChatSessionState(run_id="run_steering_loop")

    async def consume() -> list[str]:
        return [
            event
            async for event in run_agent_loop(
                runtime,
                SendMessageRequest(content="先写一版"),
                state,
            )
        ]

    consumer = asyncio.create_task(consume())
    register_active_turn("run_steering_loop", 31, task=consumer)
    set_active_turn_stage("run_steering_loop", stage="agent_loop", steerable=True)
    await llm.first_chunk_sent.wait()
    outcome = submit_active_turn_steering(
        "run_steering_loop",
        expected_run_id="run_steering_loop",
        conversation_id=31,
        content="换成董事会口径，只分析不要修改",
        message_id=81,
    )
    assert outcome.accepted
    llm.release_first.set()
    events = await consumer
    unregister_active_turn("run_steering_loop", task=consumer)

    assert len(llm.requests) == 2
    assert "换成董事会口径，只分析不要修改" in json.dumps(llm.requests[1], ensure_ascii=False)
    assert state.full_text == "旧口径答案\n\n已按董事会口径修订"
    assert state.steering_inputs[0]["message_id"] == 81
    assert "content" not in state.steering_audit_records()[0]
    assert state.steering_audit_records()[0]["content_preview"] == "换成董事会口径，只分析不要修改"
    assert runtime.action_policy == "direct_answer"
    assert runtime.tool_access_policy == "none"
    assert runtime.tools == []
    assert any(
        event["type"] == "turn_steering_capability_restricted"
        for event in state.trace_events
    )
    assert any('"type": "steering_applied"' in event for event in events)


class _ToolPlanningSteeringLLM:
    def __init__(self) -> None:
        self.plan_sent = asyncio.Event()
        self.release_plan = asyncio.Event()
        self.requests: list[list[dict]] = []

    async def stream_response(self, messages, **_kwargs):
        self.requests.append(list(messages))
        if len(self.requests) == 1:
            yield json.dumps(
                {
                    "type": "tool_use",
                    "id": "call_old_plan",
                    "name": "read_project_file",
                    "input": {"action": "list"},
                }
            )
            self.plan_sent.set()
            await self.release_plan.wait()
            return
        yield "已按新范围重新规划"


@pytest.mark.asyncio
async def test_steering_supersedes_unexecuted_tool_plan(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    llm = _ToolPlanningSteeringLLM()
    execute_calls: list[dict] = []

    async def should_not_execute(*_args, **_kwargs):
        execute_calls.append({"called": True})
        raise AssertionError("superseded tool plan must not execute")

    monkeypatch.setattr(
        "app.services.chat.agent_loop.execute_tool_with_policy",
        should_not_execute,
    )
    runtime = SimpleNamespace(
        conv_id=33,
        llm=llm,
        system="system",
        selected_model="test-model",
        tools=None,
        max_tokens=256,
        temperature=0.0,
        api_messages=[{"role": "user", "content": "读取全部文件"}],
        action_policy="read_only_tool",
        agent_turn_max_steps=3,
        agent_turn_max_tool_calls=4,
        agent_turn_timeout_seconds=60,
    )
    state = ChatSessionState(run_id="run_steering_tool_plan")

    async def consume() -> list[str]:
        return [
            event
            async for event in run_agent_loop(
                runtime,
                SendMessageRequest(content="读取全部文件"),
                state,
            )
        ]

    consumer = asyncio.create_task(consume())
    register_active_turn("run_steering_tool_plan", 33, task=consumer)
    set_active_turn_stage("run_steering_tool_plan", stage="agent_loop", steerable=True)
    await llm.plan_sent.wait()
    assert submit_active_turn_steering(
        "run_steering_tool_plan",
        expected_run_id="run_steering_tool_plan",
        conversation_id=33,
        content="只看风险登记册，不要读取其他文件",
    ).accepted
    llm.release_plan.set()
    await consumer
    unregister_active_turn("run_steering_tool_plan", task=consumer)

    assert execute_calls == []
    assert len(llm.requests) == 2
    assert "只看风险登记册" in json.dumps(llm.requests[1], ensure_ascii=False)
    assert any(
        event["type"] == "planned_tools_superseded_by_steering"
        for event in state.trace_events
    )
