"""Integration tests for auth router — login, logout, user management endpoints."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ChatRun, Conversation, TaskRun, User, UserToken
from app.routers.auth import router, _hash, require_admin, get_current_user
from app.database import get_session
from tests.test_database import create_test_engine, drop_all_tables


def _make_app(engine, current_user=None, admin_user=None):
    app = FastAPI()
    app.include_router(router)

    def override_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    if current_user:
        app.dependency_overrides[get_current_user] = lambda: current_user
    if admin_user:
        app.dependency_overrides[require_admin] = lambda: admin_user
    return app


class AuthLoginTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            user = User(
                email="test@test.com",
                password_hash=_hash("password123"),
                display_name="Test User",
                is_admin=False,
                is_active=True,
            )
            admin = User(
                email="admin@test.com",
                password_hash=_hash("admin123"),
                display_name="Admin",
                is_admin=True,
                is_active=True,
            )
            disabled = User(
                email="disabled@test.com",
                password_hash=_hash("password123"),
                display_name="Disabled",
                is_admin=False,
                is_active=False,
            )
            session.add(user)
            session.add(admin)
            session.add(disabled)
            session.commit()
            session.refresh(user)
            session.refresh(admin)
            self.user_id = user.id
            self.admin_id = admin.id

        app = _make_app(self.engine)
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_login_success(self):
        resp = self.client.post("/auth/login", json={"email": "test@test.com", "password": "password123"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("token", data)
        self.assertEqual(data["user"]["email"], "test@test.com")

    def test_login_wrong_password(self):
        resp = self.client.post("/auth/login", json={"email": "test@test.com", "password": "wrong"})
        self.assertEqual(resp.status_code, 401)

    def test_login_nonexistent_email(self):
        resp = self.client.post("/auth/login", json={"email": "nobody@test.com", "password": "x"})
        self.assertEqual(resp.status_code, 401)

    def test_login_disabled_account(self):
        resp = self.client.post("/auth/login", json={"email": "disabled@test.com", "password": "password123"})
        self.assertEqual(resp.status_code, 403)


class AuthMeTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            user = User(email="me@test.com", password_hash=_hash("pw"), display_name="Me", is_admin=False, is_active=True)
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user = user

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_me_returns_current_user(self):
        app = _make_app(self.engine, current_user=self.user)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/auth/me")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["email"], "me@test.com")


class AuthUsersCrudTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            admin = User(email="admin@test.com", password_hash=_hash("admin123"), display_name="Admin", is_admin=True, is_active=True)
            user = User(email="user@test.com", password_hash=_hash("user123"), display_name="User", is_admin=False, is_active=True)
            session.add(admin)
            session.add(user)
            session.commit()
            session.refresh(admin)
            session.refresh(user)
            self.admin = admin
            self.user = user
            self.user_id = user.id

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_users_as_admin(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/auth/users")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.json()), 2)

    def test_list_users_simple(self):
        app = _make_app(self.engine, current_user=self.user)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/auth/users/simple")
        self.assertEqual(resp.status_code, 200)

    def test_create_user(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/users", json={
            "email": "new@test.com",
            "password": "newpass123",
            "display_name": "New User",
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["email"], "new@test.com")

    def test_create_user_duplicate_email(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/users", json={
            "email": "user@test.com",
            "password": "newpass123",
        })
        self.assertEqual(resp.status_code, 409)

    def test_create_user_short_password(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/users", json={
            "email": "short@test.com",
            "password": "123",
        })
        self.assertEqual(resp.status_code, 400)

    def test_update_user(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(f"/auth/users/{self.user.id}", json={"display_name": "Updated"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["display_name"], "Updated")

    def test_update_nonexistent_user(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch("/auth/users/99999", json={"display_name": "Nope"})
        self.assertEqual(resp.status_code, 404)

    def test_update_user_deactivate(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(f"/auth/users/{self.user.id}", json={"is_active": False})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.json()["is_active"])

    def test_cannot_deactivate_last_admin(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(f"/auth/users/{self.admin.id}", json={"is_active": False})
        self.assertEqual(resp.status_code, 400)

    def test_cannot_demote_last_admin(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.patch(f"/auth/users/{self.admin.id}", json={"is_admin": False})
        self.assertEqual(resp.status_code, 400)

    def test_delete_user(self):
        with Session(self.engine) as session:
            conversation = Conversation(
                title="Retained audit run",
                owner_user_id=self.admin.id,
            )
            session.add(conversation)
            session.flush()
            task = TaskRun(
                conversation_id=conversation.id,
                task_type="chat_rollout",
                status="completed",
            )
            session.add(task)
            session.flush()
            session.add(
                ChatRun(
                    run_id="run-user-delete",
                    task_run_id=task.id,
                    conversation_id=conversation.id,
                    owner_user_id=self.user.id,
                    status="completed",
                )
            )
            session.commit()

        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.delete(f"/auth/users/{self.user.id}")
        self.assertEqual(resp.status_code, 200)
        with Session(self.engine) as session:
            chat_run = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run-user-delete")
            ).one()
            self.assertIsNone(chat_run.owner_user_id)

    def test_delete_nonexistent_user(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.delete("/auth/users/99999")
        self.assertEqual(resp.status_code, 404)

    def test_cannot_delete_self(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.delete(f"/auth/users/{self.admin.id}")
        self.assertEqual(resp.status_code, 400)

    def test_cannot_delete_last_admin(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.delete(f"/auth/users/{self.admin.id}")
        self.assertEqual(resp.status_code, 400)

    def test_admin_reset_password(self):
        with Session(self.engine) as session:
            session.add(UserToken(user_id=self.user_id, token="old-token"))
            session.commit()

        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(f"/auth/users/{self.user_id}/reset-password", json={"new_password": "newpass123"})
        self.assertEqual(resp.status_code, 200)
        with Session(self.engine) as session:
            token = session.exec(select(UserToken).where(UserToken.user_id == self.user_id)).first()
            user = session.get(User, self.user_id)
            self.assertIsNone(token)
            self.assertIsNone(user.auth_token)

    def test_admin_reset_password_nonexistent(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/users/99999/reset-password", json={"new_password": "newpass123"})
        self.assertEqual(resp.status_code, 404)

    def test_admin_reset_password_short(self):
        app = _make_app(self.engine, admin_user=self.admin)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(f"/auth/users/{self.user.id}/reset-password", json={"new_password": "123"})
        self.assertEqual(resp.status_code, 400)


class AuthChangePasswordTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            user = User(email="cp@test.com", password_hash=_hash("oldpass123"), display_name="CP", is_admin=False, is_active=True)
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user = user
            self.user_id = user.id

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_change_password_success(self):
        with Session(self.engine) as session:
            session.add(UserToken(user_id=self.user_id, token="old-token"))
            session.commit()

        app = _make_app(self.engine, current_user=self.user)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/change-password", json={
            "current_password": "oldpass123",
            "new_password": "newpass123",
        })
        self.assertEqual(resp.status_code, 200)
        with Session(self.engine) as session:
            token = session.exec(select(UserToken).where(UserToken.user_id == self.user_id)).first()
            user = session.get(User, self.user_id)
            self.assertIsNone(token)
            self.assertIsNone(user.auth_token)

    def test_change_password_wrong_current(self):
        app = _make_app(self.engine, current_user=self.user)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/change-password", json={
            "current_password": "wrong",
            "new_password": "newpass123",
        })
        self.assertEqual(resp.status_code, 401)

    def test_change_password_short_new(self):
        app = _make_app(self.engine, current_user=self.user)
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post("/auth/change-password", json={
            "current_password": "oldpass123",
            "new_password": "123",
        })
        self.assertEqual(resp.status_code, 400)


class SeedAdminTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_seed_creates_admin(self):
        from app.routers.auth import seed_admin_user
        with Session(self.engine) as session:
            seed_admin_user(session, "admin@test.com", "admin123", "Admin")
            user = session.get(User, 1)
            self.assertIsNotNone(user)
            self.assertTrue(user.is_admin)

    def test_seed_skips_when_users_exist(self):
        from app.routers.auth import seed_admin_user
        from sqlmodel import select
        with Session(self.engine) as session:
            existing = User(email="existing@test.com", password_hash=_hash("pw"), display_name="E", is_admin=False)
            session.add(existing)
            session.commit()
            seed_admin_user(session, "admin@test.com", "admin123")
            users = list(session.exec(select(User)).all())
            self.assertEqual(len(users), 1)
            self.assertEqual(users[0].email, "existing@test.com")
