"""Tests for the user-memory router (V0.0.4 main track B)."""
from __future__ import annotations

import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select

from app.models.db import User, UserMemory
from app.routers import user_memory as user_memory_module
from app.routers.auth import get_current_user
from app.routers.user_memory import router
from tests.test_database import create_test_engine, drop_all_tables


class UserMemoryRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            session.add(User(id=1, email="a@example.com", display_name="Alice", password_hash="x"))
            session.add(User(id=2, email="b@example.com", display_name="Bob", password_hash="x"))
            session.commit()

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        self.current_user_id = 1

        def override_current_user():
            return User(
                id=self.current_user_id,
                email=f"user{self.current_user_id}@example.com",
                display_name="Test",
                is_admin=False,
                is_active=True,
            )

        app.dependency_overrides[user_memory_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = override_current_user
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_get_returns_empty_when_no_row(self):
        resp = self.client.get("/user-memory")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"preferences": {}, "version": 0, "updated_at": ""})

    def test_put_then_get_round_trip(self):
        prefs = {
            "response_preferences": {"language": "zh", "tone": "direct"},
            "work_style": {"prefers_root_cause_first": True},
        }
        resp = self.client.put("/user-memory", json={"preferences": prefs})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["preferences"], prefs)
        self.assertEqual(body["version"], 1)
        self.assertTrue(body["updated_at"])

        get_resp = self.client.get("/user-memory").json()
        self.assertEqual(get_resp["preferences"], prefs)

    def test_put_bumps_version(self):
        self.client.put("/user-memory", json={"preferences": {"x": 1}})
        resp = self.client.put("/user-memory", json={"preferences": {"x": 2}}).json()
        self.assertEqual(resp["version"], 2)
        self.assertEqual(resp["preferences"], {"x": 2})

    def test_disallowed_top_keys_are_rejected(self):
        # Project/client facts must never be accepted into user memory.
        for bad_key in ("client_id", "project_id", "milestones", "contract_amount"):
            resp = self.client.put(
                "/user-memory", json={"preferences": {bad_key: "x", "valid": True}}
            )
            self.assertEqual(resp.status_code, 400, bad_key)
            self.assertIn("not allowed", resp.json().get("detail", ""))

    def test_users_are_isolated(self):
        self.current_user_id = 1
        self.client.put("/user-memory", json={"preferences": {"language": "zh"}})

        self.current_user_id = 2
        bob_get = self.client.get("/user-memory").json()
        self.assertEqual(bob_get["preferences"], {})

        # Bob writing his own preferences must not touch Alice's.
        self.client.put("/user-memory", json={"preferences": {"language": "en"}})

        self.current_user_id = 1
        alice_get = self.client.get("/user-memory").json()
        self.assertEqual(alice_get["preferences"], {"language": "zh"})

    def test_delete_clears_preferences(self):
        self.client.put("/user-memory", json={"preferences": {"language": "zh"}})
        del_resp = self.client.delete("/user-memory")
        self.assertEqual(del_resp.status_code, 200)
        self.assertEqual(del_resp.json()["preferences"], {})

        # Row stays but is now empty so subsequent reads see {}.
        with Session(self.engine) as session:
            row = session.exec(select(UserMemory).where(UserMemory.user_id == 1)).first()
            self.assertIsNotNone(row)
            self.assertEqual(row.preferences_json, "{}")

    def test_put_rejects_non_object_body(self):
        # Pydantic schema enforces dict; a list at the top level → 422.
        resp = self.client.put("/user-memory", json={"preferences": [1, 2, 3]})
        self.assertEqual(resp.status_code, 422)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
