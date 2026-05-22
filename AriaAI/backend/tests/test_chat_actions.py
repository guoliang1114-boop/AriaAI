import asyncio
import json
from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.database import get_session
from app.models.db import Conversation, Message, PendingToolAction, Project, ProjectFile, ProjectMember, User
from app.routers.chat import router as chat_router
from app.routers import chat_actions
from app.routers.chat_actions import ConfirmActionRequest
from app.routers.auth import get_current_user
from app.services.chat.action_executor import execute_tool_by_name
from app.services.chat.action_reaper import STALE_EXECUTING_MESSAGE, reap_stale_executing_actions
from app.services.chat.pending_actions import build_project_file_cleanup_pending_action
from app.services.time_utils import utc_now_naive
from app.tools import office_documents


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
    assert action.error_message == "Stored tool input must be an object"
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


def test_cleanup_hitas_api_flow_deletes_file_and_writes_result(monkeypatch, tmp_path):
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
    assert confirmed.json()["status"] == "completed"
    assert confirmed.json()["message_id"]

    with Session(engine) as session:
        deleted_file = session.get(ProjectFile, delete_file_id)
        assert deleted_file is not None
        assert deleted_file.deleted_at is not None
        assert session.get(ProjectFile, keep_file_id) is not None
        stored = session.get(PendingToolAction, action_id)
        assert stored is not None
        assert stored.status == "completed"
        messages = session.exec(select(Message).where(Message.conversation_id == conversation_id)).all()
        assert len(messages) == 1
        assert "已执行：确认删除项目文件" in messages[0].content
        assert "回收站" in messages[0].content
    assert full_path.exists()
    assert kept_full_path.exists()
