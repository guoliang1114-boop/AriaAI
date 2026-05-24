"""Integration tests for messages router."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import User, SystemMessage
from app.routers import messages as messages_module
from app.routers.messages import router
from app.routers.auth import get_current_user, require_admin
from tests.test_database import create_test_engine, drop_all_tables


def _make_app(engine, user_id, admin_id, is_admin=False):
    app = FastAPI()
    app.include_router(router)

    def override_session():
        with Session(engine) as session:
            yield session

    def override_current_user():
        with Session(engine) as session:
            return session.get(User, user_id)

    def override_require_admin():
        with Session(engine) as session:
            return session.get(User, admin_id if is_admin else user_id)

    app.dependency_overrides[messages_module.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_current_user
    app.dependency_overrides[require_admin] = override_require_admin
    return app


class MessagesTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            user = User(email="user@test.com", password_hash="h", display_name="User", is_admin=False)
            admin = User(email="admin@test.com", password_hash="h", display_name="Admin", is_admin=True)
            session.add(user)
            session.add(admin)
            session.commit()
            session.refresh(user)
            session.refresh(admin)
            self.user_id = user.id
            self.admin_id = admin.id

            msg = SystemMessage(title="Welcome", content="Welcome to AriaAI", level="info", created_by_user_id=admin.id)
            session.add(msg)
            session.commit()
            session.refresh(msg)
            self.msg_id = msg.id

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_messages(self):
        app = _make_app(self.engine, self.user_id, self.admin_id)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/messages")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("unread_count", data)

    def test_unread_count(self):
        app = _make_app(self.engine, self.user_id, self.admin_id)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/messages/unread-count")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("unread_count", resp.json())

    def test_mark_message_read(self):
        app = _make_app(self.engine, self.user_id, self.user_id)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(f"/messages/{self.msg_id}/read")
        self.assertIn(resp.status_code, [200, 204])

    def test_mark_all_read(self):
        app = _make_app(self.engine, self.user_id, self.user_id)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/messages/read-all")
        self.assertIn(resp.status_code, [200, 204])

    def test_admin_create_message(self):
        app = _make_app(self.engine, self.admin_id, self.admin_id, is_admin=True)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/messages/admin", json={
            "title": "New Notice",
            "content": "Important update",
            "level": "warning",
        })
        self.assertIn(resp.status_code, [200, 201])
        self.assertEqual(resp.json()["title"], "New Notice")

    def test_admin_list_messages(self):
        app = _make_app(self.engine, self.admin_id, self.admin_id, is_admin=True)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/messages/admin")
        self.assertEqual(resp.status_code, 200)

    def test_admin_update_message(self):
        app = _make_app(self.engine, self.admin_id, self.admin_id, is_admin=True)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(f"/messages/admin/{self.msg_id}", json={"title": "Updated"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["title"], "Updated")


class MessagesHelperTestCase(unittest.TestCase):
    def test_validate_level_valid(self):
        from app.routers.messages import _validate_level
        for level in ["info", "success", "warning", "error"]:
            self.assertEqual(_validate_level(level), level)

    def test_validate_level_invalid(self):
        from app.routers.messages import _validate_level
        with self.assertRaises(Exception):
            _validate_level("critical")

    def test_validate_level_case_insensitive(self):
        from app.routers.messages import _validate_level
        self.assertEqual(_validate_level("INFO"), "info")
