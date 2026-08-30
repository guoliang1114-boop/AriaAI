import asyncio
import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.database import get_session
from app.models.db import Conversation, Message, Milestone, PendingToolAction, Project, ProjectFile, ProjectMember, User
from app.routers.chat import router as chat_router
from app.routers import chat_actions
from app.routers.chat_actions import ConfirmActionRequest
from app.routers.chat_schemas import SendMessageRequest
from app.routers.auth import get_current_user
from app.services.agent_harness.approval_envelope import (
    RECOVERY_HITAS_ACTION_TYPE,
    approval_envelope_hash,
)
from app.services.agent_harness.project_world_state import build_project_world_state_manifest
from app.services.chat.action_executor import execute_tool_by_name
from app.services.chat.action_metrics import build_hitas_action_metrics
from app.services.chat.action_reaper import STALE_EXECUTING_MESSAGE, reap_stale_executing_actions
from app.services.chat.mode_registry import ActionPolicy
from app.services.chat.pending_actions import (
    RECOVERY_ACTION_GUARD_KEY,
    build_project_file_cleanup_pending_action,
    build_recovery_action_guard,
    embed_recovery_action_guard,
)
from app.services.time_utils import utc_now_naive
from app.services.chat.persist import run_persist
from app.services.chat.state import ChatSessionState
from app.services.chat_tools import ChatRuntime
from app.tools import office_documents


def _session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _admin(session: Session) -> User:
    # Idempotent: a test may build the conversation (owned by this admin) and
    # later fetch the same acting user. Conversations are isolated per-user even
    # for admins, so the acting user must actually own the conversation.
    existing = session.exec(select(User).where(User.email == "admin@example.com")).first()
    if existing:
        return existing
    user = User(email="admin@example.com", password_hash="x", is_admin=True)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _conversation(session: Session) -> Conversation:
    owner = _admin(session)
    conversation = Conversation(title="Approval flow", owner_user_id=owner.id)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


def test_hitas_routes_are_registered_once_under_chat_prefix():
    paths = [getattr(route, "path", "") for route in chat_router.routes]

    assert "/chat/conversations/{conversation_id}/pending-actions" in paths
    assert "/chat/actions/{action_id}/confirm" in paths
    assert "/chat/actions/{action_id}/reject" in paths
    assert "/chat/actions/metrics" in paths
    assert "/chat/actions/batches/{batch_id}/confirm" in paths
    assert "/chat/actions/batches/{batch_id}/reject" in paths
    assert not any(path.startswith("/chat/chat/") for path in paths)


def test_confirm_action_executes_once_and_writes_result_message(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    calls: list[tuple[str, dict]] = []

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        return {"success": True, "output": {"message": "删除完成"}}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="save_text",
        tool_input_json=json.dumps({"title": "客户报告"}),
        action_type="generate_pdf",
        title="生成 PDF",
        description="生成客户报告",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    conversation_id = conversation.id

    user = _admin(session)
    user_id = user.id
    first = asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, user))
    second = asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, session.get(User, user_id)))

    assert first.status == "completed"
    assert second.status == "completed"
    assert calls == [("save_text", {"title": "客户报告"})]

    messages = session.exec(select(Message).where(Message.conversation_id == conversation_id)).all()
    assert len(messages) == 1
    assert "已执行：生成 PDF" in messages[0].content
    assert "删除完成" in messages[0].content


def test_pending_action_project_scope_rejects_boolean_identifier():
    action = PendingToolAction(
        conversation_id=1,
        project_id=1,
        tool_name="manage_project_folders",
        tool_input_json="{}",
        action_type="modify_folders",
        title="Invalid scope",
    )

    with pytest.raises(Exception) as captured:
        chat_actions._validate_tool_input_scope(
            action,
            {"project_id": True, "action": "rename"},
        )

    assert getattr(captured.value, "status_code", None) == 400
    assert "invalid project scope" in str(getattr(captured.value, "detail", "")).lower()


def test_recovery_forced_approval_without_world_guard_fails_closed():
    session = _session()
    tool_input = {"title": "Recovered report"}
    action = PendingToolAction(
        conversation_id=1,
        project_id=7,
        tool_name="save_text",
        tool_input_json=json.dumps(tool_input),
        action_type=RECOVERY_HITAS_ACTION_TYPE,
        risk_level="medium",
        policy_at_creation="write_artifact",
        title="Recovery write",
    )
    action.tool_input_hash = approval_envelope_hash(
        tool_name=action.tool_name,
        tool_input=tool_input,
        project_id=action.project_id,
        action_type=action.action_type,
        risk_level=action.risk_level,
        policy_at_creation=action.policy_at_creation,
        approval_batch_id=action.approval_batch_id,
        sequence_index=action.sequence_index,
    )

    with pytest.raises(Exception) as captured:
        chat_actions._validated_execution_tool_input(session, action)

    assert getattr(captured.value, "status_code", None) == 409
    assert "missing its project-state cas" in str(
        getattr(captured.value, "detail", "")
    ).lower()


def _recovery_guarded_action(session: Session) -> tuple[PendingToolAction, dict, int]:
    owner = _admin(session)
    project = Project(name="Recovery approval", client="Client")
    session.add(project)
    session.flush()
    conversation = Conversation(
        title="Recovery approval",
        project_id=int(project.id or 0),
        owner_user_id=owner.id,
    )
    session.add(conversation)
    session.flush()
    project_id = int(project.id or 0)
    baseline = build_project_world_state_manifest(session, project_id)
    guard = build_recovery_action_guard(
        {
            "schema_version": 2,
            "source_run_id": "run_recovery_source",
            "contract_sha256": "c" * 64,
            "project_world_state": baseline,
        },
        project_id=project_id,
    )
    execution_input = {
        "project_id": project_id,
        "action": "delete",
        "file_ids": [999],
    }
    stored_input = embed_recovery_action_guard(execution_input, guard)
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=project_id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps(stored_input),
        action_type="delete_files",
        risk_level="destructive",
        policy_at_creation="destructive_action",
        title="Recovery delete",
    )
    action.tool_input_hash = approval_envelope_hash(
        tool_name=action.tool_name,
        tool_input=stored_input,
        project_id=project_id,
        action_type=action.action_type,
        risk_level=action.risk_level,
        policy_at_creation=action.policy_at_creation,
        approval_batch_id=action.approval_batch_id,
        sequence_index=action.sequence_index,
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    return action, execution_input, project_id


def _recovery_guarded_batch(
    session: Session,
    *,
    batch_id: str,
) -> tuple[list[PendingToolAction], list[dict], int]:
    owner = _admin(session)
    project = Project(name=f"Recovery batch {batch_id}", client="Client")
    session.add(project)
    session.flush()
    project_id = int(project.id or 0)
    conversation = Conversation(
        title="Recovery batch approval",
        project_id=project_id,
        owner_user_id=owner.id,
    )
    session.add(conversation)
    session.flush()
    baseline = build_project_world_state_manifest(session, project_id)
    guard = build_recovery_action_guard(
        {
            "schema_version": 2,
            "source_run_id": "run_recovery_batch_source",
            "contract_sha256": "d" * 64,
            "project_world_state": baseline,
        },
        project_id=project_id,
    )

    actions: list[PendingToolAction] = []
    execution_inputs: list[dict] = []
    for sequence_index in range(2):
        execution_input = {
            "project_id": project_id,
            "action": "rename",
            "folder_id": 100 + sequence_index,
            "new_name": f"Recovery folder {sequence_index + 1}",
        }
        stored_input = embed_recovery_action_guard(execution_input, guard)
        action = PendingToolAction(
            conversation_id=int(conversation.id or 0),
            project_id=project_id,
            approval_batch_id=batch_id,
            sequence_index=sequence_index,
            tool_name="manage_project_folders",
            tool_input_json=json.dumps(stored_input),
            action_type="modify_folders",
            risk_level="high",
            policy_at_creation="modify_existing_file",
            title=f"Create recovery folder {sequence_index + 1}",
        )
        action.tool_input_hash = approval_envelope_hash(
            tool_name=action.tool_name,
            tool_input=stored_input,
            project_id=project_id,
            action_type=action.action_type,
            risk_level=action.risk_level,
            policy_at_creation=action.policy_at_creation,
            approval_batch_id=batch_id,
            sequence_index=sequence_index,
        )
        session.add(action)
        actions.append(action)
        execution_inputs.append(execution_input)
    session.commit()
    for action in actions:
        session.refresh(action)
    return actions, execution_inputs, project_id


def test_recovery_pending_action_persistence_binds_hidden_world_guard(monkeypatch):
    session = _session()
    owner = _admin(session)
    project = Project(name="Persist recovery guard", client="Client")
    session.add(project)
    session.flush()
    conversation = Conversation(
        title="Persist recovery guard",
        project_id=int(project.id or 0),
        owner_user_id=owner.id,
    )
    session.add(conversation)
    session.commit()
    project_id = int(project.id or 0)
    baseline = build_project_world_state_manifest(session, project_id)
    recovery = {
        "schema_version": 2,
        "source_run_id": "run_persist_recovery",
        "contract_sha256": "a" * 64,
        "project_world_state": baseline,
    }
    runtime = ChatRuntime(
        conv_id=int(conversation.id or 0),
        selected_model="test",
        llm=SimpleNamespace(complete=None),
        system="",
        api_messages=[],
        rag_sources=[],
        tools=[],
        max_tokens=128,
        temperature=0.0,
        project_id=project_id,
        actor_user_id=int(owner.id or 0),
        action_policy=ActionPolicy.DESTRUCTIVE_ACTION,
        prepare_metrics={"turn_recovery": recovery},
    )
    tool_input = {"project_id": project_id, "action": "delete", "file_ids": [99]}
    state = ChatSessionState(
        run_id="run_recovery_child",
        full_text="等待用户确认后执行。",
        confirmation_requested=True,
        pending_tool_actions=[
            {
                "tool_name": "manage_project_files",
                "tool_input": tool_input,
                "action_type": "delete_files",
                "risk_level": "destructive",
                "title": "确认删除",
                "description": "等待确认",
                "details": ["文件 99"],
            }
        ],
        pending_tool_confirmations=[
            {
                "tool_name": "manage_project_files",
                "tool_input": tool_input,
                "confirmation_token": "tool:test",
            }
        ],
    )
    monkeypatch.setattr(
        "app.services.chat.persist.persist_assistant_message",
        lambda *_args, **_kwargs: (False, None),
    )
    monkeypatch.setattr("app.services.chat.persist.persist_chat_trace", lambda *_args, **_kwargs: None)

    async def persist() -> None:
        async for _event in run_persist(
            runtime,
            SendMessageRequest(
                conversation_id=int(conversation.id or 0),
                project_id=project_id,
                content="delete after confirmation",
            ),
            session.get_bind(),
            state,
        ):
            pass

    asyncio.run(persist())
    stored = session.exec(select(PendingToolAction)).one()
    stored_input = json.loads(stored.tool_input_json)
    assert stored_input[RECOVERY_ACTION_GUARD_KEY]["project_fingerprint"] == baseline["fingerprint"]
    assert chat_actions._pending_action_item(stored).tool_input == tool_input


def test_recovery_pending_action_guard_failure_clears_waiting_state(monkeypatch):
    session = _session()
    owner = _admin(session)
    project = Project(name="Missing recovery guard", client="Client")
    session.add(project)
    session.flush()
    conversation = Conversation(
        title="Missing recovery guard",
        project_id=int(project.id or 0),
        owner_user_id=owner.id,
    )
    session.add(conversation)
    session.commit()
    project_id = int(project.id or 0)
    runtime = ChatRuntime(
        conv_id=int(conversation.id or 0),
        selected_model="test",
        llm=SimpleNamespace(complete=None),
        system="",
        api_messages=[],
        rag_sources=[],
        tools=[],
        max_tokens=128,
        temperature=0.0,
        project_id=project_id,
        action_policy=ActionPolicy.WRITE_ARTIFACT,
        prepare_metrics={
            "turn_recovery": {
                "schema_version": 2,
                "source_run_id": "run_missing_guard",
                "contract_sha256": "b" * 64,
                "project_world_state": {},
            }
        },
    )
    tool_input = {"title": "Recovered report"}
    state = ChatSessionState(
        run_id="run_recovery_guard_failure",
        full_text="等待确认。",
        confirmation_requested=True,
        pending_tool_actions=[
            {
                "tool_name": "generate_pdf",
                "tool_input": tool_input,
                "action_type": RECOVERY_HITAS_ACTION_TYPE,
                "risk_level": "medium",
                "title": "确认生成",
                "description": "等待确认",
                "details": [],
            }
        ],
        pending_tool_confirmations=[
            {
                "tool_name": "generate_pdf",
                "tool_input": tool_input,
                "confirmation_token": "tool:recovery",
            }
        ],
    )
    persisted: dict = {}

    def fake_persist(_bind, _conv_id, content, _request_content, metadata):
        persisted["content"] = content
        persisted["metadata"] = metadata
        return False, None

    monkeypatch.setattr("app.services.chat.persist.persist_assistant_message", fake_persist)
    monkeypatch.setattr("app.services.chat.persist.persist_chat_trace", lambda *_args, **_kwargs: None)

    async def persist() -> None:
        async for _event in run_persist(
            runtime,
            SendMessageRequest(
                conversation_id=int(conversation.id or 0),
                project_id=project_id,
                content="continue recovery",
            ),
            session.get_bind(),
            state,
        ):
            pass

    asyncio.run(persist())

    assert state.confirmation_requested is False
    assert state.pending_tool_actions == []
    assert state.pending_tool_confirmations == []
    assert any(
        event.get("tool_name") == "hitas" and event.get("status") == "error"
        for event in state.tool_call_events
    )
    assert any(
        event.get("type") == "pending_action_persist_failed"
        for event in state.trace_events
    )
    assert "审批动作保存失败" in persisted["content"]
    assert persisted["metadata"]["run_rollout"]["status"] != "waiting_confirmation"
    assert "pending_action_ids" not in persisted["metadata"]
    assert session.exec(select(PendingToolAction)).all() == []


def test_recovery_hitas_non_atomic_project_write_fails_closed_without_registry(monkeypatch):
    session = _session()
    action, _execution_input, _project_id = _recovery_guarded_action(session)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    result = asyncio.run(
        chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, _admin(session))
    )

    assert result.status == "failed"
    assert result.error_message == chat_actions._RECOVERY_WRITE_REQUIRES_FRESH_ACTION
    assert calls == []
    assert RECOVERY_ACTION_GUARD_KEY not in chat_actions._pending_action_item(action).tool_input


def test_recovery_hitas_final_authorized_writer_requires_fresh_action(monkeypatch):
    session = _session()
    owner = _admin(session)
    project = Project(name="Atomic recovery writer", client="Client")
    session.add(project)
    session.flush()
    project_id = int(project.id or 0)
    conversation = Conversation(
        title="Atomic recovery writer",
        project_id=project_id,
        owner_user_id=owner.id,
    )
    session.add(conversation)
    session.flush()
    baseline = build_project_world_state_manifest(session, project_id)
    guard = build_recovery_action_guard(
        {
            "schema_version": 2,
            "source_run_id": "run_atomic_recovery",
            "contract_sha256": "e" * 64,
            "project_world_state": baseline,
        },
        project_id=project_id,
    )
    execution_input = {
        "project_id": project_id,
        "mode": "create",
        "file_name": "recovered.md",
        "content": "# Recovered",
    }
    stored_input = embed_recovery_action_guard(execution_input, guard)
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=project_id,
        tool_name="update_project_markdown_document",
        tool_input_json=json.dumps(stored_input),
        action_type=RECOVERY_HITAS_ACTION_TYPE,
        risk_level="medium",
        policy_at_creation="write_artifact",
        title="Atomic recovery write",
    )
    action.tool_input_hash = approval_envelope_hash(
        tool_name=action.tool_name,
        tool_input=stored_input,
        project_id=project_id,
        action_type=action.action_type,
        risk_level=action.risk_level,
        policy_at_creation=action.policy_at_creation,
        approval_batch_id=action.approval_batch_id,
        sequence_index=action.sequence_index,
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    final_calls: list[tuple[str, dict]] = []

    async def fake_final_authorized(
        _bind,
        action_id: int,
        tool_name: str,
        tool_input: dict,
        *,
        emit_message: bool,
    ) -> dict:
        final_calls.append((tool_name, tool_input))
        return {
            "status": "completed",
            "result": {"success": True},
            "action_id": action_id,
            "message_id": 91 if emit_message else None,
        }

    monkeypatch.setattr(
        chat_actions,
        "_execute_final_authorized_project_write",
        fake_final_authorized,
    )
    result = asyncio.run(
        chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, owner)
    )

    assert result.status == "failed"
    assert result.error_message == chat_actions._RECOVERY_WRITE_REQUIRES_FRESH_ACTION
    assert final_calls == []
    assert session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all() == []


def test_recovery_non_atomic_write_remains_blocked_if_state_drifts_after_boundary(monkeypatch):
    session = _session()
    action, _execution_input, project_id = _recovery_guarded_action(session)
    bind = session.get_bind()
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    original_boundary = chat_actions._action_boundary_error_before_execution

    def boundary_then_drift(*args, **kwargs) -> str:
        error = original_boundary(*args, **kwargs)
        assert error == ""
        with Session(bind) as drift_session:
            drift_session.add(
                Milestone(project_id=project_id, title="Changed after recovery boundary")
            )
            drift_session.commit()
        return error

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    monkeypatch.setattr(
        chat_actions,
        "_action_boundary_error_before_execution",
        boundary_then_drift,
    )
    result = asyncio.run(
        chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, _admin(session))
    )

    assert result.status == "failed"
    assert result.error_message == chat_actions._RECOVERY_WRITE_REQUIRES_FRESH_ACTION
    assert calls == []
    with Session(bind) as check:
        assert check.exec(select(Milestone).where(Milestone.project_id == project_id)).one()


def test_recovery_hitas_project_drift_fails_closed_before_business_write(monkeypatch):
    session = _session()
    action, _execution_input, project_id = _recovery_guarded_action(session)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    session.add(Milestone(project_id=project_id, title="Changed after approval preview"))
    session.commit()

    with pytest.raises(Exception) as captured:
        asyncio.run(
            chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, _admin(session))
        )

    assert getattr(captured.value, "status_code", None) == 409
    assert str(getattr(captured.value, "detail", "")) == chat_actions._RECOVERY_PROJECT_STATE_CONFLICT
    session.refresh(action)
    assert action.status == "failed"
    assert calls == []


def test_recovery_hitas_rechecks_after_claim_before_registry(monkeypatch):
    session = _session()
    action, _execution_input, project_id = _recovery_guarded_action(session)
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    original_commit = session.commit
    injected_drift = False

    def commit_then_change_project() -> None:
        nonlocal injected_drift
        original_commit()
        if not injected_drift:
            injected_drift = True
            session.add(Milestone(project_id=project_id, title="Changed after HITAS claim"))
            original_commit()

    monkeypatch.setattr(session, "commit", commit_then_change_project)
    result = asyncio.run(
        chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, _admin(session))
    )

    assert result.status == "failed"
    assert result.error_message == chat_actions._RECOVERY_PROJECT_STATE_CONFLICT
    assert calls == []


def test_project_hitas_rechecks_current_write_access_after_claim(monkeypatch):
    session = _session()
    actor = User(email="revoked-writer@example.com", password_hash="x")
    project = Project(name="Revoke after claim", client="Client")
    session.add(actor)
    session.add(project)
    session.flush()
    member = ProjectMember(
        project_id=int(project.id or 0),
        user_id=int(actor.id or 0),
        role="editor",
    )
    conversation = Conversation(
        title="Revoke after claim",
        project_id=int(project.id or 0),
        owner_user_id=int(actor.id or 0),
    )
    session.add(member)
    session.add(conversation)
    session.flush()
    tool_input = {
        "project_id": int(project.id or 0),
        "action": "rename",
        "folder_id": 88,
        "new_name": "Renamed",
    }
    action = PendingToolAction(
        conversation_id=int(conversation.id or 0),
        project_id=int(project.id or 0),
        tool_name="manage_project_folders",
        tool_input_json=json.dumps(tool_input),
        action_type="modify_folders",
        title="Rename folder",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    action_id = int(action.id or 0)
    actor_id = int(actor.id or 0)
    member_id = int(member.id or 0)
    bind = session.get_bind()
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, frozen_input: dict):
        calls.append(frozen_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    original_commit = session.commit
    revoked = False

    def commit_then_revoke() -> None:
        nonlocal revoked
        original_commit()
        if not revoked:
            revoked = True
            current_member = session.get(ProjectMember, member_id)
            assert current_member is not None
            session.delete(current_member)
            original_commit()

    monkeypatch.setattr(session, "commit", commit_then_revoke)
    result = asyncio.run(
        chat_actions.confirm_action(
            action_id,
            ConfirmActionRequest(),
            session,
            session.get(User, actor_id),
        )
    )

    assert result.status == "failed"
    assert "membership required" in (result.error_message or "").lower()
    assert calls == []
    with Session(bind) as check:
        stored = check.get(PendingToolAction, action_id)
        assert stored is not None
        assert stored.status == "failed"


def test_recovery_hitas_multi_action_batch_fails_closed_before_registry(monkeypatch):
    session = _session()
    batch_id = "hitas-recovery-must-split"
    actions, _execution_inputs, _project_id = _recovery_guarded_batch(
        session,
        batch_id=batch_id,
    )
    bind = session.get_bind()
    calls: list[dict] = []

    async def fake_execute(_tool_name: str, tool_input: dict):
        calls.append(tool_input)
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    result = asyncio.run(
        chat_actions.confirm_action(
            int(actions[0].id or 0),
            ConfirmActionRequest(),
            session,
            _admin(session),
        )
    )

    assert result.status == "failed"
    assert result.error_message == chat_actions._RECOVERY_MULTI_ACTION_BATCH_UNSAFE
    assert calls == []
    with Session(bind) as check:
        stored = check.exec(
            select(PendingToolAction)
            .where(PendingToolAction.approval_batch_id == batch_id)
            .order_by(PendingToolAction.sequence_index)
        ).all()
        assert [action.status for action in stored] == ["failed", "skipped"]
        assert chat_actions._RECOVERY_MULTI_ACTION_BATCH_UNSAFE in (stored[0].error_message or "")
        assert "fresh non-recovery actions" in (stored[1].error_message or "")


def test_confirm_action_with_batch_executes_all_actions_once(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    calls: list[tuple[str, dict]] = []

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        return {"success": True, "output": {"message": f"{tool_input['step']} 完成"}}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    batch_id = "hitas-test-batch"
    a1 = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id=batch_id,
        sequence_index=0,
        tool_name="save_text",
        tool_input_json=json.dumps({"title": "first", "step": "first"}),
        action_type="generate_pdf",
        title="生成 PDF",
        description="",
    )
    a2 = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id=batch_id,
        sequence_index=1,
        tool_name="save_json",
        tool_input_json=json.dumps({"title": "second", "step": "second"}),
        action_type="generate_xlsx",
        title="生成 Excel",
        description="",
    )
    session.add(a1)
    session.add(a2)
    session.commit()
    session.refresh(a1)
    conversation_id = conversation.id

    user = _admin(session)
    result = asyncio.run(chat_actions.confirm_action(a1.id, ConfirmActionRequest(), session, user))

    assert result.status == "completed"
    assert result.approval_batch_id == batch_id
    assert calls == [
        ("save_text", {"title": "first", "step": "first"}),
        ("save_json", {"title": "second", "step": "second"}),
    ]
    with Session(session.get_bind()) as check:
        stored = check.exec(select(PendingToolAction).where(PendingToolAction.approval_batch_id == batch_id)).all()
        assert {item.status for item in stored} == {"completed"}
        messages = check.exec(select(Message).where(Message.conversation_id == conversation_id)).all()
        assert len(messages) == 1
        assert "本次确认流程" in messages[0].content
        metadata = json.loads(messages[0].metadata_json or "{}")
        assert metadata["tool_action_batch_result"]["approval_batch_id"] == batch_id


def test_long_running_action_is_queued_for_background_execution(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    scheduled: list[tuple[str, object]] = []

    def fake_schedule(job_name: str, job_factory):
        scheduled.append((job_name, job_factory))

    async def fake_execute(tool_name: str, tool_input: dict):
        raise AssertionError("Background action should not execute inline")

    monkeypatch.setattr(chat_actions, "schedule_background_job", fake_schedule)
    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="generate_pdf",
        tool_input_json=json.dumps({"title": "客户汇报"}),
        action_type="generate_pdf",
        title="生成 PDF",
        description="",
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    result = asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, _admin(session)))

    assert result.status == "executing"
    assert result.result == {"success": True, "queued": True, "background": True}
    assert scheduled and scheduled[0][0] == f"hitas-action-{action.id}"
    with Session(session.get_bind()) as check:
        stored = check.get(PendingToolAction, action.id)
        assert stored is not None
        assert stored.status == "executing"


def test_confirm_action_batch_stops_after_first_failure(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    calls: list[tuple[str, dict]] = []

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        if tool_input["step"] == "first":
            return {"success": False, "error": "first failed"}
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    batch_id = "hitas-stop-on-failure"
    a1 = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id=batch_id,
        sequence_index=0,
        tool_name="save_text",
        tool_input_json=json.dumps({"title": "first", "step": "first"}),
        action_type="generate_pdf",
        title="生成 PDF",
        description="",
    )
    a2 = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id=batch_id,
        sequence_index=1,
        tool_name="save_json",
        tool_input_json=json.dumps({"title": "second", "step": "second"}),
        action_type="generate_xlsx",
        title="生成 Excel",
        description="",
    )
    session.add(a1)
    session.add(a2)
    session.commit()
    session.refresh(a1)
    conversation_id = conversation.id

    result = asyncio.run(chat_actions.confirm_action(a1.id, ConfirmActionRequest(), session, _admin(session)))

    assert result.status == "failed"
    assert calls == [("save_text", {"title": "first", "step": "first"})]
    with Session(session.get_bind()) as check:
        stored = check.exec(select(PendingToolAction).where(PendingToolAction.approval_batch_id == batch_id)).all()
        statuses = {item.sequence_index: item.status for item in stored}
        assert statuses == {0: "failed", 1: "skipped"}
        messages = check.exec(select(Message).where(Message.conversation_id == conversation_id)).all()
        assert len(messages) == 1
        assert "已跳过" in messages[0].content


def test_hitas_metrics_reports_failure_rate_stale_actions_and_partial_batches():
    session = _session()
    conversation = _conversation(session)
    completed = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id="batch-partial",
        sequence_index=0,
        tool_name="manage_project_files",
        tool_input_json="{}",
        action_type="delete_files",
        title="完成",
        status="completed",
        confirmed_at=utc_now_naive(),
    )
    failed = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id="batch-partial",
        sequence_index=1,
        tool_name="manage_project_files",
        tool_input_json="{}",
        action_type="delete_files",
        title="失败",
        status="failed",
        confirmed_at=utc_now_naive(),
    )
    stale = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="write_project_office_document",
        tool_input_json="{}",
        action_type="write_office_document",
        title="卡住",
        status="executing",
        confirmed_at=utc_now_naive() - timedelta(minutes=60),
    )
    session.add(completed)
    session.add(failed)
    session.add(stale)
    session.commit()

    metrics = build_hitas_action_metrics(
        session,
        stale_after_minutes=30,
        failure_rate_alert_threshold=0.2,
        min_resolved_for_failure_rate_alert=2,
    )

    assert metrics["resolved_actions"] == 2
    assert metrics["failed_actions"] == 1
    assert metrics["confirmation_failure_rate"] == 0.5
    assert metrics["stale_executing_actions"] == 1
    assert metrics["partial_failed_batches"] == 1
    assert {alert["code"] for alert in metrics["alerts"]} == {
        "hitas_confirmation_failure_rate_high",
        "hitas_stale_executing_actions",
        "hitas_batch_partial_failures",
    }


def test_persist_batch_results_marks_dangling_executing_action_failed():
    session = _session()
    conversation = _conversation(session)
    batch_id = "hitas-dangling-executing"
    a1 = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id=batch_id,
        sequence_index=0,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "step": "first"}),
        action_type="delete_files",
        title="删除文件",
        status="executing",
    )
    a2 = PendingToolAction(
        conversation_id=conversation.id,
        approval_batch_id=batch_id,
        sequence_index=1,
        tool_name="manage_project_folders",
        tool_input_json=json.dumps({"action": "delete", "step": "second"}),
        action_type="delete_folder",
        title="删除文件夹",
        status="executing",
    )
    session.add(a1)
    session.add(a2)
    session.commit()
    session.refresh(a1)
    session.refresh(a2)

    result = chat_actions._persist_batch_action_results(
        session.get_bind(),
        batch_id,
        [
            {
                "pending_action_id": a1.id,
                "tool_name": "manage_project_files",
                "result": {"success": True},
            }
        ],
    )

    assert result.status == "failed"
    assert result.result["completed_count"] == 1
    assert result.result["failed_count"] == 1
    with Session(session.get_bind()) as check:
        stored = check.exec(select(PendingToolAction).where(PendingToolAction.approval_batch_id == batch_id)).all()
        statuses = {item.sequence_index: item.status for item in stored}
        assert statuses == {0: "completed", 1: "failed"}
        dangling = next(item for item in stored if item.sequence_index == 1)
        assert "Missing execution result" in (dangling.error_message or "")


def test_confirm_action_fails_closed_on_invalid_stored_tool_input(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    calls: list[tuple[str, dict]] = []

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json="[1, 2]",
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    try:
        asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, _admin(session)))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400
    else:
        raise AssertionError("Expected invalid tool input to fail")

    session.refresh(action)
    assert action.status == "failed"
    assert action.error_message == "Stored tool input must be an object"
    assert calls == []


def test_confirm_action_fails_closed_when_versioned_approval_input_was_modified(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    calls: list[tuple[str, dict]] = []
    original_input = {"title": "Original report"}

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="save_text",
        tool_input_json=json.dumps(original_input),
        action_type="generate_pdf",
        risk_level="medium",
        policy_at_creation="write_artifact",
        title="生成 PDF",
        description="生成客户报告",
    )
    action.tool_input_hash = approval_envelope_hash(
        tool_name=action.tool_name,
        tool_input=original_input,
        project_id=action.project_id,
        action_type=action.action_type,
        risk_level=action.risk_level,
        policy_at_creation=action.policy_at_creation,
        approval_batch_id=action.approval_batch_id,
        sequence_index=action.sequence_index,
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    action.tool_input_json = json.dumps({"title": "Tampered report"})
    session.add(action)
    session.commit()

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            chat_actions.confirm_action(
                action.id,
                ConfirmActionRequest(),
                session,
                _admin(session),
            )
        )

    assert getattr(exc_info.value, "status_code", None) == 409
    session.refresh(action)
    assert action.status == "failed"
    assert "Approval snapshot validation failed" in (action.error_message or "")
    assert calls == []


def test_confirm_batch_fails_before_claim_when_versioned_sequence_was_modified(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    batch_id = "hitas-bound-batch"
    calls: list[tuple[str, dict]] = []

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    actions: list[PendingToolAction] = []
    for sequence_index, tool_input in enumerate(
        (
            {"title": "Report 1"},
            {"title": "Report 2"},
        )
    ):
        action = PendingToolAction(
            conversation_id=conversation.id,
            approval_batch_id=batch_id,
            sequence_index=sequence_index,
            tool_name="generate_pdf",
            tool_input_json=json.dumps(tool_input),
            action_type="generate_pdf",
            risk_level="medium",
            policy_at_creation="write_artifact",
            title=f"生成报告 {sequence_index}",
        )
        action.tool_input_hash = approval_envelope_hash(
            tool_name=action.tool_name,
            tool_input=tool_input,
            project_id=action.project_id,
            action_type=action.action_type,
            risk_level=action.risk_level,
            policy_at_creation=action.policy_at_creation,
            approval_batch_id=action.approval_batch_id,
            sequence_index=action.sequence_index,
        )
        actions.append(action)
        session.add(action)
    session.commit()
    for action in actions:
        session.refresh(action)

    actions[1].sequence_index = 9
    session.add(actions[1])
    session.commit()

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            chat_actions.confirm_action(
                actions[0].id,
                ConfirmActionRequest(),
                session,
                _admin(session),
            )
        )

    assert getattr(exc_info.value, "status_code", None) == 409
    assert calls == []
    with Session(session.get_bind()) as check:
        stored = check.exec(
            select(PendingToolAction).where(
                PendingToolAction.approval_batch_id == batch_id
            )
        ).all()
        assert {item.sequence_index: item.status for item in stored} == {
            0: "failed",
            9: "failed",
        }


def test_non_project_member_cannot_confirm_action(monkeypatch):
    session = _session()
    project = Project(name="Client Project", client="Client")
    member_user = User(email="member@example.com", password_hash="x")
    outsider = User(email="outsider@example.com", password_hash="x")
    session.add(project)
    session.add(member_user)
    session.add(outsider)
    session.commit()
    session.refresh(project)
    session.refresh(member_user)
    session.refresh(outsider)
    session.add(ProjectMember(project_id=project.id, user_id=member_user.id))
    conversation = Conversation(title="Approval flow", project_id=project.id)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    action = PendingToolAction(
        conversation_id=conversation.id,
        project_id=project.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1, 2]}),
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    async def fake_execute(tool_name: str, tool_input: dict):
        raise AssertionError("Unauthorized action must not execute")

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    try:
        asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, outsider))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403
    else:
        raise AssertionError("Expected non-member to be rejected")

    session.refresh(action)
    assert action.status == "pending"


def test_standalone_conversation_owner_can_confirm_action(monkeypatch):
    session = _session()
    owner = User(email="owner@example.com", password_hash="x")
    session.add(owner)
    session.commit()
    session.refresh(owner)
    conversation = Conversation(title="Standalone approval", owner_user_id=owner.id)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="save_text",
        tool_input_json=json.dumps({"title": "Standalone report"}),
        action_type="generate_pdf",
        title="生成 PDF",
        description="",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    action_id = action.id

    async def fake_execute(tool_name: str, tool_input: dict):
        return {"success": True, "output": {"message": "生成完成"}}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    result = asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, owner))

    assert result.status == "completed"
    with Session(session.get_bind()) as check:
        stored = check.get(PendingToolAction, action_id)
        assert stored is not None
        assert stored.status == "completed"


def test_viewer_project_member_cannot_confirm_destructive_action(monkeypatch):
    session = _session()
    project = Project(name="Client Project", client="Client")
    viewer = User(email="viewer@example.com", password_hash="x")
    session.add(project)
    session.add(viewer)
    session.commit()
    session.refresh(project)
    session.refresh(viewer)
    session.add(ProjectMember(project_id=project.id, user_id=viewer.id, role="viewer"))
    conversation = Conversation(title="Approval flow", project_id=project.id)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    action = PendingToolAction(
        conversation_id=conversation.id,
        project_id=project.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"project_id": project.id, "action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    async def fake_execute(tool_name: str, tool_input: dict):
        raise AssertionError("Viewer action must not execute")

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    try:
        asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, viewer))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403
        assert "write permission" in str(getattr(exc, "detail", ""))
    else:
        raise AssertionError("Expected viewer to be rejected")

    session.refresh(action)
    assert action.status == "pending"


def test_confirm_action_rejects_mismatched_project_scope(monkeypatch):
    session = _session()
    project = Project(name="Client Project", client="Client")
    session.add(project)
    session.commit()
    session.refresh(project)
    admin = _admin(session)
    session.add(ProjectMember(project_id=project.id, user_id=admin.id))
    session.commit()
    conversation = Conversation(title="Approval flow", project_id=project.id)
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    action = PendingToolAction(
        conversation_id=conversation.id,
        project_id=project.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"project_id": project.id + 999, "action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    async def fake_execute(tool_name: str, tool_input: dict):
        raise AssertionError("Mismatched scope must not execute")

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    try:
        asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, _admin(session)))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403
    else:
        raise AssertionError("Expected mismatched project scope to fail")

    session.refresh(action)
    assert action.status == "failed"
    assert "scope mismatch" in (action.error_message or "")


def test_reject_action_sets_status_and_prevents_execution(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    calls: list[tuple[str, dict]] = []

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    user = _admin(session)
    result = asyncio.run(chat_actions.reject_action(action.id, ConfirmActionRequest(approved=False, reason="不需要了"), session, user))

    assert result.status == "rejected"
    session.refresh(action)
    assert action.status == "rejected"
    assert action.confirmed_by_user_id == user.id
    assert calls == []  # Tool must NOT execute after reject
    assert result.message_id is not None
    messages = session.exec(select(Message).where(Message.conversation_id == conversation.id)).all()
    assert len(messages) == 1
    assert "已取消：删除项目文件" in messages[0].content
    assert "不需要了" in messages[0].content


def test_direct_action_executor_treats_ok_false_as_failure(monkeypatch):
    class Tool:
        def handler(self):
            return {"ok": False, "error": "not allowed"}

    monkeypatch.setattr("app.services.chat.action_executor.registry.get", lambda name: Tool())
    result = asyncio.run(execute_tool_by_name("mock_tool", {}))
    assert result["success"] is False
    assert result["ok"] is False


def test_list_pending_actions_returns_only_pending_and_non_expired():
    session = _session()
    conversation = _conversation(session)
    user = _admin(session)

    # Pending non-expired
    a1 = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="待确认",
        description="",
    )
    # Already completed
    a2 = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json="{}",
        action_type="delete_files",
        title="已完成",
        description="",
        status="completed",
    )
    # Already rejected
    a3 = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json="{}",
        action_type="delete_files",
        title="已拒绝",
        description="",
        status="rejected",
    )
    session.add(a1)
    session.add(a2)
    session.add(a3)
    session.commit()

    resp = asyncio.run(chat_actions.list_pending_actions(conversation.id, session, user))
    assert len(resp.items) == 1
    assert resp.items[0].title == "待确认"
    assert resp.has_pending is True


def test_expired_action_cannot_be_confirmed():
    session = _session()
    conversation = _conversation(session)
    user = _admin(session)

    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="过期操作",
        description="",
        expires_at=utc_now_naive() - timedelta(hours=1),
    )
    session.add(action)
    session.commit()
    session.refresh(action)

    try:
        asyncio.run(chat_actions.confirm_action(action.id, ConfirmActionRequest(), session, user))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 400
    else:
        raise AssertionError("Expected expired action to be rejected")

    session.refresh(action)
    assert action.status == "failed"
    assert "expired" in (action.error_message or "").lower()


def test_concurrent_confirm_prevents_double_execution(monkeypatch, tmp_path):
    """Two different DB sessions race to confirm the same action; only one should execute."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'race.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)

    # Create shared data in a parent session
    parent = Session(engine)
    user = User(email="race@example.com", password_hash="x", is_admin=True)
    parent.add(user)
    parent.commit()
    parent.refresh(user)
    user_id = user.id
    conversation = Conversation(title="Race test", owner_user_id=user.id)
    parent.add(conversation)
    parent.commit()
    parent.refresh(conversation)

    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="save_text",
        tool_input_json=json.dumps({"title": "Race report"}),
        action_type="generate_pdf",
        title="Race",
        description="",
    )
    parent.add(action)
    parent.commit()
    parent.refresh(action)
    action_id = action.id
    parent.close()

    calls: list[tuple[str, dict]] = []

    async def fake_execute(tool_name: str, tool_input: dict):
        calls.append((tool_name, tool_input))
        return {"success": True}

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)

    def _race_session():
        return Session(engine)

    import threading
    results: list[ConfirmActionResponse] = []
    errors: list[Exception] = []

    def _run_confirm():
        try:
            s = _race_session()
            resp = asyncio.run(chat_actions.confirm_action(action_id, ConfirmActionRequest(), s, s.get(User, user_id)))
            results.append(resp)
        except Exception as exc:
            errors.append(exc)

    t1 = threading.Thread(target=_run_confirm)
    t2 = threading.Thread(target=_run_confirm)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    # Exactly one execution
    assert errors == []
    assert len(calls) <= 1, f"Tool executed {len(calls)} times, expected at most 1"

    # At least one result is completed, the other may be the same completed result
    statuses = [r.status for r in results]
    assert "completed" in statuses, f"Expected at least one completed, got {statuses}"

    # Verify DB state
    check = Session(engine)
    final = check.get(PendingToolAction, action_id)
    assert final is not None
    assert final.status == "completed"
    check.close()


def test_confirm_action_persists_failure_when_tool_raises(monkeypatch):
    session = _session()
    conversation = _conversation(session)
    user = _admin(session)

    async def fake_execute(tool_name: str, tool_input: dict):
        raise RuntimeError("disk full")

    monkeypatch.setattr(chat_actions, "execute_tool_by_name", fake_execute)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="save_text",
        tool_input_json=json.dumps({"title": "Failure report"}),
        action_type="generate_pdf",
        title="生成 PDF",
        description="生成失败测试",
    )
    session.add(action)
    session.commit()
    session.refresh(action)
    action_id = action.id

    resp = asyncio.run(chat_actions.confirm_action(action_id, ConfirmActionRequest(), session, user))

    assert resp.status == "failed"
    assert "disk full" in (resp.error_message or "")
    with Session(session.get_bind()) as check:
        stored = check.get(PendingToolAction, action_id)
        assert stored is not None
        assert stored.status == "failed"
        messages = check.exec(select(Message).where(Message.conversation_id == stored.conversation_id)).all()
        assert len(messages) == 1
        assert "disk full" in messages[0].content


def test_reaper_marks_stale_executing_action_as_failed_without_retry():
    session = _session()
    conversation = _conversation(session)
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
        status="executing",
        confirmed_at=utc_now_naive() - timedelta(minutes=60),
    )
    fresh = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [2]}),
        action_type="delete_files",
        title="仍在执行",
        description="",
        status="executing",
        confirmed_at=utc_now_naive(),
    )
    session.add(action)
    session.add(fresh)
    session.commit()
    session.refresh(action)
    session.refresh(fresh)

    count = reap_stale_executing_actions(session, stale_after_minutes=30)

    assert count == 1
    session.refresh(action)
    session.refresh(fresh)
    assert action.status == "failed"
    assert action.error_message == STALE_EXECUTING_MESSAGE
    assert fresh.status == "executing"
    messages = session.exec(select(Message).where(Message.conversation_id == conversation.id)).all()
    assert len(messages) == 1
    assert "人工核查" in messages[0].content


def test_cleanup_hitas_api_flow_fails_closed_before_legacy_project_write(monkeypatch, tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'api.db'}", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()

    with Session(engine) as session:
        project = Project(name="Client Project", client="Client")
        user = User(email="member@example.com", password_hash="x")
        session.add(project)
        session.add(user)
        session.commit()
        session.refresh(project)
        session.refresh(user)
        session.add(ProjectMember(project_id=project.id, user_id=user.id))
        conversation = Conversation(title="Cleanup", project_id=project.id)
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

        relative_path = f"projects/{project.id}/duplicate-old.md"
        kept_relative_path = f"projects/{project.id}/duplicate-new.md"
        full_path = uploads_dir / relative_path
        kept_full_path = uploads_dir / kept_relative_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text("duplicate old", encoding="utf-8")
        kept_full_path.write_text("duplicate new", encoding="utf-8")
        project_file = ProjectFile(
            project_id=project.id,
            name="重复方案.md",
            file_type="md",
            path=relative_path,
            origin="ai_generated",
        )
        kept_project_file = ProjectFile(
            project_id=project.id,
            name="重复方案.md",
            file_type="md",
            path=kept_relative_path,
            origin="ai_generated",
        )
        session.add(project_file)
        session.add(kept_project_file)
        session.commit()
        session.refresh(project_file)
        session.refresh(kept_project_file)
        old_file_id = project_file.id
        new_file_id = kept_project_file.id

        pending = build_project_file_cleanup_pending_action(
            session,
            project_id=project.id,
            user_content="现在空间里面有特别多的垃圾文件，清除",
            action_policy="destructive_action",
            require_candidates=False,
        )
        assert pending is not None
        assert pending["can_confirm"] is True
        assert isinstance(pending["tool_input"], dict)
        action = PendingToolAction(
            trace_id=f"conv-{conversation.id}",
            conversation_id=conversation.id,
            project_id=project.id,
            tool_name=str(pending["tool_name"]),
            tool_input_json=json.dumps(pending["tool_input"], ensure_ascii=False),
            action_type="delete_files",
            title="确认删除项目文件",
            description=str(pending["summary"]),
            details_json=json.dumps(pending["details"], ensure_ascii=False),
            status="pending",
            expires_at=utc_now_naive() + timedelta(hours=24),
        )
        session.add(action)
        session.commit()
        session.refresh(action)
        action_id = action.id
        conversation_id = conversation.id
        user_id = user.id
        delete_file_id = pending["tool_input"]["file_ids"][0]
        keep_file_id = new_file_id if delete_file_id == old_file_id else old_file_id

    monkeypatch.setattr(office_documents, "engine", engine)
    monkeypatch.setattr(office_documents, "UPLOADS_DIR", uploads_dir)

    app = FastAPI()
    app.include_router(chat_router)

    def override_session():
        with Session(engine) as session:
            yield session

    def override_user():
        with Session(engine) as session:
            return session.get(User, user_id)

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user

    client = TestClient(app)
    listed = client.get(f"/chat/conversations/{conversation_id}/pending-actions")
    assert listed.status_code == 200
    assert listed.json()["has_pending"] is True
    assert listed.json()["items"][0]["id"] == action_id

    confirmed = client.post(f"/chat/actions/{action_id}/confirm", json={"approved": True})
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "failed"
    assert confirmed.json()["error_message"] == chat_actions._PROJECT_ACTION_NON_ATOMIC_UNSAFE
    assert confirmed.json()["message_id"]

    with Session(engine) as session:
        deleted_file = session.get(ProjectFile, delete_file_id)
        assert deleted_file is not None
        assert deleted_file.deleted_at is None
        assert session.get(ProjectFile, keep_file_id) is not None
        stored = session.get(PendingToolAction, action_id)
        assert stored is not None
        assert stored.status == "failed"
        messages = session.exec(select(Message).where(Message.conversation_id == conversation_id)).all()
        assert len(messages) == 1
        assert "执行失败" in messages[0].content
        assert chat_actions._PROJECT_ACTION_NON_ATOMIC_UNSAFE in messages[0].content
    assert full_path.exists()
    assert kept_full_path.exists()
