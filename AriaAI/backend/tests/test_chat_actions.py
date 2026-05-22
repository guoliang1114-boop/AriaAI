import asyncio
import json

from sqlmodel import Session, SQLModel, create_engine, select

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
