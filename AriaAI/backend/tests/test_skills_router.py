"""Integration tests for skills router — CRUD endpoints."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import User, Skill
from app.routers import skills as skills_module
from app.routers.skills import router
from app.services.cache import TTLCache
from tests.test_database import create_test_engine, drop_all_tables


class SkillsCrudTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            skill = Skill(
                name="Strategy Report",
                description="Generate strategy reports",
                category="strategy",
                icon="📊",
                system_prompt="You are a strategy consultant.",
                user_template="Analyze {{company}}",
                tools="[]",
            )
            session.add(skill)
            session.commit()
            session.refresh(skill)
            self.skill_id = skill.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[skills_module.get_session] = override_session
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_skills(self):
        resp = self.client.get("/skills")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "Strategy Report")

    def test_list_skills_by_category(self):
        resp = self.client.get("/skills?category=strategy")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.json()), 1)

    def test_list_skills_empty_category(self):
        resp = self.client.get("/skills?category=nonexistent")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 0)

    def test_get_skill(self):
        resp = self.client.get(f"/skills/{self.skill_id}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["name"], "Strategy Report")
        self.assertEqual(data["category"], "strategy")

    def test_get_nonexistent_skill(self):
        resp = self.client.get("/skills/99999")
        self.assertEqual(resp.status_code, 404)

    def test_create_skill(self):
        resp = self.client.post("/skills", json={
            "name": "New Skill",
            "description": "A new skill",
            "category": "general",
            "system_prompt": "You are helpful.",
            "user_template": "Help with {{topic}}",
        })
        self.assertIn(resp.status_code, [200, 201])
        data = resp.json()
        self.assertEqual(data["name"], "New Skill")

    def test_update_skill(self):
        resp = self.client.patch(f"/skills/{self.skill_id}", json={
            "name": "Updated Strategy",
            "description": "Updated description",
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "Updated Strategy")

    def test_delete_skill(self):
        resp = self.client.delete(f"/skills/{self.skill_id}")
        self.assertIn(resp.status_code, [200, 204])
        resp2 = self.client.get(f"/skills/{self.skill_id}")
        self.assertEqual(resp2.status_code, 404)

    def test_delete_nonexistent_skill(self):
        resp = self.client.delete("/skills/99999")
        self.assertEqual(resp.status_code, 404)

    def test_skill_summaries(self):
        resp = self.client.get("/skills/meta/summary")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, (list, dict))

    def test_update_nonexistent_skill(self):
        resp = self.client.patch("/skills/99999", json={"name": "Nope"})
        self.assertEqual(resp.status_code, 404)

    def test_skill_summaries_by_category(self):
        resp = self.client.get("/skills/meta/summary?category=strategy")
        self.assertEqual(resp.status_code, 200)

    def test_list_skills_caching(self):
        resp1 = self.client.get("/skills")
        resp2 = self.client.get("/skills")
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(len(resp1.json()), len(resp2.json()))

    def test_create_skill_with_tools(self):
        resp = self.client.post("/skills", json={
            "name": "Tool Skill",
            "description": "Has tools",
            "category": "test",
            "system_prompt": "test",
            "tools_definition_json": '[{"name": "my_tool"}]',
        })
        self.assertIn(resp.status_code, [200, 201])
        self.assertEqual(resp.json()["name"], "Tool Skill")
