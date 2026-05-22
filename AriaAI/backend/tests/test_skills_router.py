"""Integration tests for skills router — CRUD endpoints."""
import json
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select

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

    def test_seed_pro_adds_consulting_capability_skills(self):
        with Session(self.engine) as session:
            first_count = skills_module.ensure_builtin_pro_skills(session)
            second_count = skills_module.ensure_builtin_pro_skills(session)
            skills = session.exec(
                select(Skill).where(Skill.name.startswith(skills_module.CONSULTING_CAPABILITY_SKILL_PREFIX))
            ).all()

        self.assertGreaterEqual(first_count, len(skills_module.CONSULTING_CAPABILITY_SKILLS))
        # Second run may patch a few skills if prompt_markers don't match
        self.assertLessEqual(second_count, first_count)
        names = {skill.name for skill in skills}
        self.assertIn("顾问能力｜客户会议准备", names)
        self.assertIn("顾问能力｜咨询故事线大纲", names)
        self.assertIn("顾问能力｜问题树拆解", names)

        storyline = next(skill for skill in skills if skill.name == "顾问能力｜咨询故事线大纲")
        self.assertEqual(storyline.category, "提案与项目交付")
        self.assertIn("consulting-capability:consulting_storyline", storyline.system_prompt)
        self.assertIn("至少输出 10 个一级章节", storyline.system_prompt)
        self.assertEqual(storyline.max_tokens, 16384)
        self.assertEqual(storyline.tools, [])
        self.assertEqual(json.loads(storyline.tools_definition_json), [])

        required_steps = [
            "步骤 1/4：收集上下文",
            "步骤 2/4：规划结构",
            "步骤 3/4：生成内容",
            "步骤 4/4：校验并交付",
        ]
        for skill in skills:
            for step in required_steps:
                self.assertIn(step, skill.system_prompt, skill.name)

    def test_seed_pro_adds_consulting_proposal_advisor_skill(self):
        with Session(self.engine) as session:
            skills_module.ensure_builtin_pro_skills(session)
            skill = session.exec(
                select(Skill).where(Skill.name == skills_module.CONSULTING_PROPOSAL_ADVISOR_SKILL_NAME)
            ).one()

        self.assertEqual(skill.category, "顾问基础能力")
        self.assertIn("Consulting Proposal Advisor", skill.system_prompt)
        self.assertIn("Bundled Reference: proposal-structure.md", skill.system_prompt)
        self.assertIn('skill_name: "consulting-proposal-advisor"', skill.system_prompt)
        self.assertIn("客户可审阅", skill.user_template)
        self.assertEqual(skill.max_tokens, 32768)
        self.assertEqual(
            skill.tools,
            [
                "generate_ppt_from_skill",
                "read_project_file",
                "write_project_office_document",
            ],
        )
        tool_defs = json.loads(skill.tools_definition_json)
        tool_def_names = {tool.get("name") for tool in tool_defs}
        self.assertEqual(
            tool_def_names,
            {
                "generate_ppt_from_skill",
                "read_project_file",
                "write_project_office_document",
            },
        )
