from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import Conversation, PendingToolAction, Project, ProjectMember, User
from app.routers import chat_actions
from app.routers.chat_actions import ConfirmActionRequest
from app.routers.chat_schemas import SendMessageRequest
from app.services.agent_harness.approval_envelope import APPROVAL_ENVELOPE_PREFIX
from app.services.chat import tool_executor
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.pending_actions import (
    PendingActionProjectScopeError,
    require_pending_action_project_scope,
)
from app.services.chat.persist import run_persist
from app.services.chat.state import ChatSessionState
from app.services.chat.tool_executor import execute_tool_with_policy
from app.services.chat_tools import ChatRuntime
from app.services.context_builder.skill_context import _merge_project_chat_tools


def _session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _runtime(
    conversation_id: int,
    *,
    actor_user_id: int | None,
    project_id: int | None,
) -> ChatRuntime:
    return ChatRuntime(
        conv_id=conversation_id,
        selected_model="test",
        llm=SimpleNamespace(),
        system="",
        api_messages=[],
        rag_sources=[],
        tools=[],
        max_tokens=128,
        temperature=0.0,
        actor_user_id=actor_user_id,
        project_id=project_id,
        action_policy=ActionPolicy.DESTRUCTIVE_ACTION,
    )


@pytest.mark.parametrize("project_id", [None, True, False, 0, -1, "7"])
def test_standalone_skill_does_not_expose_project_scoped_tools(project_id) -> None:
    tools = [
        {"name": "manage_project_files", "input_schema": {"type": "object"}},
        {"name": "read_project_markdown_document", "input_schema": {"type": "object"}},
        {"name": "generate_pdf", "input_schema": {"type": "object"}},
    ]

    filtered = _merge_project_chat_tools(tools, project_id)

    assert [tool["name"] for tool in filtered or []] == ["generate_pdf"]


@pytest.mark.parametrize("value", [None, True, False, 0, -1, "7", 7.0])
def test_project_scoped_approval_requires_exact_positive_runtime_scope(value) -> None:
    with pytest.raises(PendingActionProjectScopeError):
        require_pending_action_project_scope(
            "manage_project_files",
            {"project_id": 7, "action": "delete", "file_ids": [1]},
            runtime_project_id=value,
        )


@pytest.mark.parametrize("value", [None, True, False, 0, -1, "7", 7.0, 8])
def test_project_scoped_approval_requires_exact_matching_input_scope(value) -> None:
    with pytest.raises(PendingActionProjectScopeError):
        require_pending_action_project_scope(
            "manage_project_files",
            {"project_id": value, "action": "delete", "file_ids": [1]},
            runtime_project_id=7,
        )


@pytest.mark.parametrize("tool_name", ["save_text", "unclassified_extension_tool"])
@pytest.mark.parametrize("value", [None, True, False, 0, -1, "7", 7, 7.0])
def test_non_project_tool_rejects_every_top_level_project_identifier(
    tool_name,
    value,
) -> None:
    with pytest.raises(
        PendingActionProjectScopeError,
        match="cannot include project_id",
    ):
        require_pending_action_project_scope(
            tool_name,
            {"project_id": value, "filename": "audit", "content": "blocked"},
            runtime_project_id=None,
        )

    action = PendingToolAction(
        conversation_id=1,
        project_id=None,
        tool_name=tool_name,
        tool_input_json="{}",
        action_type="save_text",
        title="Forged global input",
    )
    with pytest.raises(HTTPException, match="cannot include project_id"):
        chat_actions._validate_tool_input_scope(
            action,
            {"project_id": value, "filename": "audit", "content": "blocked"},
        )


def test_standalone_tool_proposal_cannot_create_project_pending_action(monkeypatch) -> None:
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        yield {"type": "result", "result": {"success": True}}

    monkeypatch.setattr(tool_executor.registry, "execute", fake_execute)
    state = ChatSessionState(run_id="run_scope_block")
    outcome = asyncio.run(
        execute_tool_with_policy(
            _runtime(1, actor_user_id=1, project_id=None),
            state,
            {
                "id": "tool_scope_block",
                "name": "manage_project_files",
                "input": {"project_id": 999, "action": "delete", "file_ids": [1]},
            },
            req=SendMessageRequest(content="delete", project_id=None),
            step_text="",
            step_truncated=False,
            step_index=0,
        )
    )

    assert outcome.confirmation_required is False
    assert state.confirmation_requested is False
    assert state.pending_tool_actions == []
    assert state.pending_tool_confirmations == []
    assert calls == []
    assert state.tool_call_events[-1]["status"] == "blocked"
    assert "runtime project scope" in state.tool_call_events[-1]["summary"]


@pytest.mark.parametrize("value", [None, True, False, 0, -1, "7", 7, 7.0])
def test_standalone_global_tool_proposal_cannot_smuggle_project_scope(
    monkeypatch,
    value,
) -> None:
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        yield {"type": "result", "result": {"success": True}}

    monkeypatch.setattr(tool_executor.registry, "execute", fake_execute)
    state = ChatSessionState(run_id="run_global_scope_block")
    outcome = asyncio.run(
        execute_tool_with_policy(
            _runtime(1, actor_user_id=1, project_id=None),
            state,
            {
                "id": "tool_global_scope_block",
                "name": "save_text",
                "input": {
                    "filename": "audit",
                    "content": "blocked",
                    "project_id": value,
                },
            },
            req=SendMessageRequest(content="save", project_id=None),
            step_text="",
            step_truncated=False,
            step_index=0,
        )
    )

    assert outcome.confirmation_required is False
    assert state.confirmation_requested is False
    assert state.pending_tool_actions == []
    assert state.pending_tool_confirmations == []
    assert calls == []
    assert state.tool_call_events[-1]["status"] == "blocked"
    assert "cannot include project_id" in state.tool_call_events[-1]["summary"]


def test_project_tool_proposal_is_rebound_to_runtime_scope(monkeypatch) -> None:
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        yield {"type": "result", "result": {"success": True}}

    monkeypatch.setattr(tool_executor.registry, "execute", fake_execute)
    state = ChatSessionState(run_id="run_scope_rebind")
    outcome = asyncio.run(
        execute_tool_with_policy(
            _runtime(1, actor_user_id=3, project_id=7),
            state,
            {
                "id": "tool_scope_rebind",
                "name": "manage_project_files",
                "input": {"project_id": 999, "action": "delete", "file_ids": [1]},
            },
            req=SendMessageRequest(content="delete", project_id=7),
            step_text="",
            step_truncated=False,
            step_index=0,
        )
    )

    assert outcome.confirmation_required is True
    assert state.pending_tool_actions[0]["tool_input"]["project_id"] == 7
    assert state.pending_tool_confirmations[0]["tool_input"]["project_id"] == 7
    assert calls == []


def test_pending_action_signing_rechecks_actor_project_write_access(monkeypatch) -> None:
    session = _session()
    actor = User(email="scope-outsider@example.com", password_hash="x")
    project = Project(name="Protected scope", client="Client")
    session.add(actor)
    session.add(project)
    session.flush()
    conversation = Conversation(
        title="Protected scope",
        project_id=project.id,
        owner_user_id=actor.id,
    )
    session.add(conversation)
    session.commit()
    runtime = _runtime(
        int(conversation.id or 0),
        actor_user_id=int(actor.id or 0),
        project_id=int(project.id or 0),
    )
    tool_input = {
        "project_id": int(project.id or 0),
        "action": "delete",
        "file_ids": [1],
    }
    state = ChatSessionState(
        run_id="run_scope_signing",
        full_text="Waiting for confirmation.",
        confirmation_requested=True,
        pending_tool_actions=[
            {
                "tool_name": "manage_project_files",
                "tool_input": tool_input,
                "action_type": "delete_files",
                "risk_level": "destructive",
                "title": "Delete file",
                "description": "Await confirmation",
                "details": ["file 1"],
            }
        ],
        pending_tool_confirmations=[
            {
                "tool_name": "manage_project_files",
                "tool_input": tool_input,
                "confirmation_token": "tool:scope",
            }
        ],
    )
    monkeypatch.setattr(
        "app.services.chat.persist.persist_assistant_message",
        lambda *_args, **_kwargs: (False, None),
    )
    monkeypatch.setattr(
        "app.services.chat.persist.persist_chat_trace",
        lambda *_args, **_kwargs: None,
    )

    async def persist() -> None:
        async for _event in run_persist(
            runtime,
            SendMessageRequest(
                conversation_id=int(conversation.id or 0),
                project_id=int(project.id or 0),
                content="delete",
            ),
            session.get_bind(),
            state,
        ):
            pass

    asyncio.run(persist())

    assert session.exec(select(PendingToolAction)).all() == []
    assert state.confirmation_requested is False
    assert state.pending_tool_actions == []
    assert state.pending_tool_confirmations == []
    assert any(
        item.get("tool_name") == "hitas" and item.get("status") == "error"
        for item in state.tool_call_events
    )


def test_pending_action_signature_binds_authorized_actor_and_exact_project(monkeypatch) -> None:
    session = _session()
    actor = User(email="scope-editor@example.com", password_hash="x")
    project = Project(name="Authorized scope", client="Client")
    session.add(actor)
    session.add(project)
    session.flush()
    project_id = int(project.id or 0)
    actor_id = int(actor.id or 0)
    session.add(ProjectMember(project_id=project_id, user_id=actor_id, role="editor"))
    conversation = Conversation(
        title="Authorized scope",
        project_id=project_id,
        owner_user_id=actor_id,
    )
    session.add(conversation)
    session.commit()
    runtime = _runtime(
        int(conversation.id or 0),
        actor_user_id=actor_id,
        project_id=project_id,
    )
    tool_input = {"project_id": project_id, "action": "delete", "file_ids": [1]}
    state = ChatSessionState(
        run_id="run_scope_signed",
        full_text="Waiting for confirmation.",
        confirmation_requested=True,
        pending_tool_actions=[
            {
                "tool_name": "manage_project_files",
                "tool_input": tool_input,
                "action_type": "delete_files",
                "risk_level": "destructive",
                "title": "Delete file",
                "description": "Await confirmation",
                "details": ["file 1"],
            }
        ],
        pending_tool_confirmations=[
            {
                "tool_name": "manage_project_files",
                "tool_input": tool_input,
                "confirmation_token": "tool:scope:signed",
            }
        ],
    )
    monkeypatch.setattr(
        "app.services.chat.persist.persist_assistant_message",
        lambda *_args, **_kwargs: (False, None),
    )
    monkeypatch.setattr(
        "app.services.chat.persist.persist_chat_trace",
        lambda *_args, **_kwargs: None,
    )

    async def persist() -> None:
        async for _event in run_persist(
            runtime,
            SendMessageRequest(
                conversation_id=int(conversation.id or 0),
                project_id=project_id,
                content="delete",
            ),
            session.get_bind(),
            state,
        ):
            pass

    asyncio.run(persist())

    stored = session.exec(select(PendingToolAction)).one()
    assert stored.project_id == project_id
    assert json.loads(stored.tool_input_json)["project_id"] == project_id
    assert stored.tool_input_hash.startswith(APPROVAL_ENVELOPE_PREFIX)
    assert state.confirmation_requested is True


def test_pending_action_persist_rejects_global_tool_project_scope_smuggling(monkeypatch) -> None:
    session = _session()
    actor = User(email="global-scope-persist@example.com", password_hash="x")
    session.add(actor)
    session.flush()
    conversation = Conversation(title="Standalone persist", owner_user_id=actor.id)
    session.add(conversation)
    session.commit()
    runtime = _runtime(
        int(conversation.id or 0),
        actor_user_id=int(actor.id or 0),
        project_id=None,
    )
    tool_input = {
        "filename": "audit",
        "content": "blocked",
        "project_id": 999,
    }
    state = ChatSessionState(
        run_id="run_global_scope_persist",
        full_text="Waiting for confirmation.",
        confirmation_requested=True,
        pending_tool_actions=[
            {
                "tool_name": "save_text",
                "tool_input": tool_input,
                "action_type": "save_text",
                "risk_level": "medium",
                "title": "Save text",
                "description": "Await confirmation",
                "details": [],
            }
        ],
        pending_tool_confirmations=[
            {
                "tool_name": "save_text",
                "tool_input": tool_input,
                "confirmation_token": "tool:global-scope",
            }
        ],
    )
    monkeypatch.setattr(
        "app.services.chat.persist.persist_assistant_message",
        lambda *_args, **_kwargs: (False, None),
    )
    monkeypatch.setattr(
        "app.services.chat.persist.persist_chat_trace",
        lambda *_args, **_kwargs: None,
    )

    async def persist() -> None:
        async for _event in run_persist(
            runtime,
            SendMessageRequest(
                conversation_id=int(conversation.id or 0),
                content="save",
            ),
            session.get_bind(),
            state,
        ):
            pass

    asyncio.run(persist())

    assert session.exec(select(PendingToolAction)).all() == []
    assert state.confirmation_requested is False
    assert state.pending_tool_actions == []
    assert state.pending_tool_confirmations == []
    assert any(
        item.get("tool_name") == "hitas" and item.get("status") == "error"
        for item in state.tool_call_events
    )


def test_standalone_confirm_rejects_unbound_project_action_without_registry(monkeypatch) -> None:
    session = _session()
    owner = User(email="scope-owner@example.com", password_hash="x")
    session.add(owner)
    session.flush()
    conversation = Conversation(title="Standalone", owner_user_id=owner.id)
    session.add(conversation)
    session.flush()
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=None,
        tool_name="manage_project_files",
        tool_input_json=json.dumps(
            {"project_id": 999, "action": "delete", "file_ids": [1]}
        ),
        action_type="delete_files",
        title="Forged project delete",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            chat_actions.confirm_action(
                int(action.id or 0),
                ConfirmActionRequest(),
                session,
                owner,
            )
        )

    assert captured.value.status_code == 400
    assert calls == []
    session.refresh(action)
    assert action.status == "failed"


def test_standalone_confirm_rejects_global_tool_project_scope_smuggling(monkeypatch) -> None:
    session = _session()
    owner = User(email="global-scope-owner@example.com", password_hash="x")
    session.add(owner)
    session.flush()
    conversation = Conversation(title="Standalone global", owner_user_id=owner.id)
    session.add(conversation)
    session.flush()
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=None,
        tool_name="save_text",
        tool_input_json=json.dumps(
            {"filename": "audit", "content": "blocked", "project_id": 999}
        ),
        action_type="save_text",
        title="Forged global input",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    with pytest.raises(HTTPException, match="cannot include project_id"):
        asyncio.run(
            chat_actions.confirm_action(
                int(action.id or 0),
                ConfirmActionRequest(),
                session,
                owner,
            )
        )

    assert calls == []
    session.refresh(action)
    assert action.status == "failed"


def test_batch_confirm_rejects_unbound_project_actions_without_registry(monkeypatch) -> None:
    session = _session()
    owner = User(email="scope-batch-owner@example.com", password_hash="x")
    session.add(owner)
    session.flush()
    conversation = Conversation(title="Standalone batch", owner_user_id=owner.id)
    session.add(conversation)
    session.flush()
    batch_id = "scope-forged-batch"
    actions: list[PendingToolAction] = []
    for sequence_index in range(2):
        action = PendingToolAction(
            conversation_id=int(conversation.id or 0),
            project_id=None,
            tool_name="manage_project_files",
            tool_input_json=json.dumps(
                {
                    "project_id": 999,
                    "action": "delete",
                    "file_ids": [sequence_index + 1],
                }
            ),
            action_type="delete_files",
            approval_batch_id=batch_id,
            sequence_index=sequence_index,
            title=f"Forged project delete {sequence_index}",
        )
        session.add(action)
        actions.append(action)
    session.commit()
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    with pytest.raises(HTTPException) as captured:
        asyncio.run(
            chat_actions.confirm_action_batch(
                batch_id,
                ConfirmActionRequest(),
                session,
                owner,
            )
        )

    assert captured.value.status_code == 400
    assert calls == []
    for action in actions:
        session.refresh(action)
        assert action.status == "failed"


def test_batch_confirm_rejects_global_tool_project_scope_smuggling(monkeypatch) -> None:
    session = _session()
    owner = User(email="global-scope-batch@example.com", password_hash="x")
    session.add(owner)
    session.flush()
    conversation = Conversation(title="Standalone global batch", owner_user_id=owner.id)
    session.add(conversation)
    session.flush()
    batch_id = "global-scope-forged-batch"
    actions: list[PendingToolAction] = []
    for sequence_index in range(2):
        action = PendingToolAction(
            conversation_id=int(conversation.id or 0),
            project_id=None,
            tool_name="save_text",
            tool_input_json=json.dumps(
                {
                    "filename": f"audit-{sequence_index}",
                    "content": "blocked",
                    "project_id": 999,
                }
            ),
            action_type="save_text",
            approval_batch_id=batch_id,
            sequence_index=sequence_index,
            title=f"Forged global input {sequence_index}",
        )
        session.add(action)
        actions.append(action)
    session.commit()
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    with pytest.raises(HTTPException, match="cannot include project_id"):
        asyncio.run(
            chat_actions.confirm_action_batch(
                batch_id,
                ConfirmActionRequest(),
                session,
                owner,
            )
        )

    assert calls == []
    for action in actions:
        session.refresh(action)
        assert action.status == "failed"


def test_background_executor_rechecks_project_scope_before_registry(monkeypatch) -> None:
    session = _session()
    owner = User(email="scope-worker@example.com", password_hash="x")
    session.add(owner)
    session.flush()
    conversation = Conversation(title="Standalone worker", owner_user_id=owner.id)
    session.add(conversation)
    session.flush()
    tool_input = {"project_id": 999, "action": "delete", "file_ids": [1]}
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=None,
        confirmed_by_user_id=int(owner.id or 0),
        status="executing",
        tool_name="manage_project_files",
        tool_input_json=json.dumps(tool_input),
        action_type="delete_files",
        title="Forged background delete",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, frozen_input: dict):
        calls.append(frozen_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    asyncio.run(
        chat_actions._execute_action_in_background(
            session.get_bind(),
            int(action.id or 0),
            action.tool_name,
            tool_input,
        )
    )

    assert calls == []
    session.refresh(action)
    assert action.status == "failed"


def test_background_executor_rejects_global_tool_project_scope_smuggling(monkeypatch) -> None:
    session = _session()
    owner = User(email="global-scope-worker@example.com", password_hash="x")
    session.add(owner)
    session.flush()
    conversation = Conversation(title="Standalone global worker", owner_user_id=owner.id)
    session.add(conversation)
    session.flush()
    tool_input = {"filename": "audit", "content": "blocked", "project_id": 999}
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=None,
        confirmed_by_user_id=int(owner.id or 0),
        status="executing",
        tool_name="save_text",
        tool_input_json=json.dumps(tool_input),
        action_type="save_text",
        title="Forged global background input",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, frozen_input: dict):
        calls.append(frozen_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    asyncio.run(
        chat_actions._execute_action_in_background(
            session.get_bind(),
            int(action.id or 0),
            action.tool_name,
            tool_input,
        )
    )

    assert calls == []
    session.refresh(action)
    assert action.status == "failed"


def test_global_tool_without_project_id_still_executes_in_standalone_confirm(monkeypatch) -> None:
    session = _session()
    owner = User(email="global-no-scope@example.com", password_hash="x")
    session.add(owner)
    session.flush()
    conversation = Conversation(title="Standalone global safe", owner_user_id=owner.id)
    session.add(conversation)
    session.flush()
    tool_input = {"filename": "safe", "content": "approved"}
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=None,
        tool_name="save_text",
        tool_input_json=json.dumps(tool_input),
        action_type="save_text",
        title="Safe global action",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, frozen_input: dict):
        calls.append(frozen_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    response = asyncio.run(
        chat_actions.confirm_action(
            int(action.id or 0),
            ConfirmActionRequest(),
            session,
            owner,
        )
    )

    assert response.status == "completed"
    assert calls == [tool_input]
