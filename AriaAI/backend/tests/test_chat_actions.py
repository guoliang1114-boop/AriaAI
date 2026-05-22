import asyncio
import json

from sqlmodel import Session, SQLModel, create_engine, select
from sqlalchemy.pool import StaticPool

from app.models.db import Conversation, Message, PendingToolAction, Project, ProjectMember, User
from app.routers.chat import router as chat_router
from app.routers import chat_actions
from app.routers.chat_actions import ConfirmActionRequest


def _session():
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _conversation(session: Session) -> Conversation:
    conversation = Conversation(title="Approval flow")
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    return conversation


def _admin(session: Session) -> User:
    user = User(email="admin@example.com", password_hash="x", is_admin=True)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_hitas_routes_are_registered_once_under_chat_prefix():
    paths = [getattr(route, "path", "") for route in chat_router.routes]

    assert "/chat/conversations/{conversation_id}/pending-actions" in paths
    assert "/chat/actions/{action_id}/confirm" in paths
    assert "/chat/actions/{action_id}/reject" in paths
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
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1, 2]}),
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
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
    assert calls == [("manage_project_files", {"action": "delete", "file_ids": [1, 2]})]

    messages = session.exec(select(Message).where(Message.conversation_id == conversation_id)).all()
    assert len(messages) == 1
    assert "已执行：删除项目文件" in messages[0].content
    assert "删除完成" in messages[0].content


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
    assert action.error_message == "Invalid stored tool input"
    assert calls == []


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

    from datetime import datetime, timedelta
    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="过期操作",
        description="",
        expires_at=datetime.utcnow() - timedelta(hours=1),
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
    conversation = Conversation(title="Race test")
    parent.add(conversation)
    parent.commit()
    parent.refresh(conversation)
    user = User(email="race@example.com", password_hash="x", is_admin=True)
    parent.add(user)
    parent.commit()
    parent.refresh(user)
    user_id = user.id

    action = PendingToolAction(
        conversation_id=conversation.id,
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1]}),
        action_type="delete_files",
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
        tool_name="manage_project_files",
        tool_input_json=json.dumps({"action": "delete", "file_ids": [1]}),
        action_type="delete_files",
        title="删除项目文件",
        description="删除重复文件",
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
