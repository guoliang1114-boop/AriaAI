"""Integration tests for skills router — CRUD endpoints."""
import json
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select

from app.models.db import (
    ChatRun,
    Conversation,
    ScheduledTask,
    Skill,
    SkillRelease,
    SkillRollout,
    TaskRun,
    User,
)
from app.routers import skills as skills_module
from app.routers.auth import get_current_user
from app.routers.skills import router
from app.services.cache import TTLCache
from app.services.agent_harness.skill_releases import (
    evaluate_rollout_stop_loss,
    resolve_skill_release,
)
from app.services.context_builder.skill_context import build_skill_context
from tests.test_database import create_test_engine, drop_all_tables


class SkillsCrudTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            session.add(User(
                id=1,
                email="test@example.com",
                display_name="Test",
                password_hash="test-only",
                is_admin=True,
            ))
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

        self.app = FastAPI()
        self.app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        self.app.dependency_overrides[skills_module.get_session] = override_session
        # R74 router-level auth floor — provide a test user so the
        # ``Depends(get_current_user)`` dep returns instead of 401-ing.
        self.app.dependency_overrides[get_current_user] = lambda: User(
            id=1, email="test@example.com", display_name="Test", is_admin=True
        )
        self.client = TestClient(self.app, raise_server_exceptions=False)

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

    def test_get_structured_deliverable_catalog(self):
        with Session(self.engine) as session:
            skill = session.get(Skill, self.skill_id)
            skill.system_prompt = """# Skill

### Deliverable Catalog
| Deliverable | When to use | Minimum content | Format |
|---|---|---|---|
| Executive deck | Board decision | Options and recommendation | PPTX / PDF |
"""
            session.add(skill)
            session.commit()

        resp = self.client.get(f"/skills/{self.skill_id}/deliverables")

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["item_count"], 1)
        self.assertEqual(data["items"][0]["name"], "Executive deck")
        self.assertEqual(data["items"][0]["formats"], ["pptx", "pdf"])
        self.assertEqual(len(data["catalog_sha256"]), 64)

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
        self.assertEqual(data["package_version"], "1.0.0")
        self.assertEqual(data["package_status"], "stable")
        with Session(self.engine) as session:
            release = session.exec(
                select(SkillRelease).where(SkillRelease.skill_id == data["id"])
            ).one()
            self.assertEqual(release.created_by_user_id, 1)

    def test_skill_release_fields_require_semver_and_known_status(self):
        invalid_version = self.client.post("/skills", json={
            "name": "Bad version",
            "category": "general",
            "package_version": "latest",
        })
        invalid_status = self.client.patch(
            f"/skills/{self.skill_id}",
            json={"package_status": "unknown"},
        )
        valid = self.client.patch(
            f"/skills/{self.skill_id}",
            json={"package_version": "1.2.0", "package_status": "preview"},
        )
        downgrade = self.client.patch(
            f"/skills/{self.skill_id}",
            json={"package_version": "0.9.0"},
        )

        self.assertEqual(invalid_version.status_code, 422)
        self.assertEqual(invalid_status.status_code, 422)
        self.assertEqual(downgrade.status_code, 409)
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(valid.json()["package_version"], "1.2.0")
        self.assertEqual(valid.json()["package_status"], "preview")

    def test_deprecated_skill_is_hidden_from_launch_catalog_and_recommendation(self):
        deprecated = self.client.patch(
            f"/skills/{self.skill_id}",
            json={"package_status": "deprecated"},
        )

        self.assertEqual(deprecated.status_code, 200)
        self.assertEqual(self.client.get("/skills/meta/summary").json(), [])
        self.assertEqual(len(self.client.get("/skills").json()), 1)
        recommendation = self.client.post("/skills/recommendations/turn", json={
            "project_id": 3,
            "content": "Generate Strategy Report",
            "skill_mode": "explicit",
            "skill_id": self.skill_id,
        })
        self.assertEqual(recommendation.status_code, 409)

    def test_update_skill(self):
        resp = self.client.patch(f"/skills/{self.skill_id}", json={
            "name": "Updated Strategy",
            "description": "Updated description",
        })
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "Updated Strategy")

    def test_behavior_change_requires_version_bump_and_refreshes_release_hash(self):
        rejected = self.client.patch(
            f"/skills/{self.skill_id}",
            json={"system_prompt": "Changed runtime behavior"},
        )
        accepted = self.client.patch(
            f"/skills/{self.skill_id}",
            json={
                "system_prompt": "Changed runtime behavior",
                "package_version": "1.1.0",
            },
        )

        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["package_version"], "1.1.0")
        self.assertEqual(len(accepted.json()["package_sha256"]), 64)

    def test_preview_release_is_snapshotted_without_replacing_live_baseline(self):
        updated = self.client.patch(
            f"/skills/{self.skill_id}",
            json={
                "system_prompt": "Preview strategy behavior",
                "package_version": "1.1.0",
                "package_status": "preview",
            },
        )
        releases = self.client.get(f"/skills/{self.skill_id}/releases")

        self.assertEqual(updated.status_code, 200)
        self.assertEqual(releases.status_code, 200)
        items = releases.json()["items"]
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["version"], "1.1.0")
        self.assertFalse(items[0]["is_active"])
        self.assertEqual(items[1]["version"], "1.0.0")
        self.assertTrue(items[1]["is_active"])
        live_catalog = self.client.get("/skills/meta/summary").json()
        self.assertEqual(live_catalog[0]["package_version"], "1.0.0")
        self.assertEqual(live_catalog[0]["package_status"], "stable")

    def test_admin_canary_control_is_stale_safe_and_reversible(self):
        updated = self.client.patch(
            f"/skills/{self.skill_id}",
            json={
                "system_prompt": "Candidate strategy behavior",
                "package_version": "1.1.0",
                "package_status": "preview",
            },
        )
        self.assertEqual(updated.status_code, 200)
        releases = self.client.get(f"/skills/{self.skill_id}/releases").json()["items"]
        candidate = next(item for item in releases if item["version"] == "1.1.0")
        baseline = next(item for item in releases if item["is_active"])

        stale = self.client.post(
            f"/skills/{self.skill_id}/rollouts",
            json={
                "candidate_release_id": candidate["id"],
                "percentage": 10,
                "expected_active_release_sha256": "f" * 64,
            },
        )
        created = self.client.post(
            f"/skills/{self.skill_id}/rollouts",
            json={
                "candidate_release_id": candidate["id"],
                "percentage": 10,
                "min_sample_size": 2,
                "max_failure_rate": 0.4,
                "expected_active_release_sha256": baseline["sha256"],
            },
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(created.status_code, 201)
        rollout = created.json()
        self.assertEqual(rollout["percentage"], 10)
        self.assertEqual(rollout["status"], "active")

        promoted = self.client.post(
            f"/skills/{self.skill_id}/rollouts/{rollout['id']}/control",
            json={
                "action": "promote",
                "expected_status": "active",
                "expected_candidate_sha256": candidate["sha256"],
            },
        )
        rolled_back = self.client.post(
            f"/skills/{self.skill_id}/rollouts/{rollout['id']}/control",
            json={
                "action": "rollback",
                "expected_status": "completed",
                "expected_candidate_sha256": candidate["sha256"],
            },
        )
        self.assertEqual(promoted.status_code, 200)
        self.assertEqual(promoted.json()["status"], "completed")
        self.assertEqual(rolled_back.status_code, 200)
        self.assertEqual(rolled_back.json()["status"], "rolled_back")
        current_releases = self.client.get(f"/skills/{self.skill_id}/releases").json()["items"]
        self.assertEqual(next(item for item in current_releases if item["is_active"])["id"], baseline["id"])

    def test_active_rollout_blocks_skill_edit_and_delete(self):
        self.client.patch(
            f"/skills/{self.skill_id}",
            json={
                "system_prompt": "Candidate strategy behavior",
                "package_version": "1.1.0",
                "package_status": "preview",
            },
        )
        releases = self.client.get(f"/skills/{self.skill_id}/releases").json()["items"]
        candidate = next(item for item in releases if item["version"] == "1.1.0")
        baseline = next(item for item in releases if item["is_active"])
        created = self.client.post(
            f"/skills/{self.skill_id}/rollouts",
            json={
                "candidate_release_id": candidate["id"],
                "expected_active_release_sha256": baseline["sha256"],
            },
        )

        edited = self.client.patch(
            f"/skills/{self.skill_id}",
            json={"description": "Must not change during rollout"},
        )
        deleted = self.client.delete(f"/skills/{self.skill_id}")

        self.assertEqual(created.status_code, 201)
        self.assertEqual(edited.status_code, 409)
        self.assertEqual(deleted.status_code, 409)
        self.assertEqual(
            self.client.get(f"/skills/{self.skill_id}").json()["description"],
            "Generate strategy reports",
        )

    def test_rollout_assignment_is_project_sticky_and_auto_stop_fails_to_baseline(self):
        self.client.patch(
            f"/skills/{self.skill_id}",
            json={
                "system_prompt": "Candidate strategy behavior",
                "package_version": "1.1.0",
                "package_status": "preview",
            },
        )
        releases = self.client.get(f"/skills/{self.skill_id}/releases").json()["items"]
        candidate = next(item for item in releases if item["version"] == "1.1.0")
        baseline = next(item for item in releases if item["is_active"])
        rollout_json = self.client.post(
            f"/skills/{self.skill_id}/rollouts",
            json={
                "candidate_release_id": candidate["id"],
                "percentage": 50,
                "min_sample_size": 2,
                "max_failure_rate": 0.4,
                "expected_active_release_sha256": baseline["sha256"],
            },
        ).json()

        with Session(self.engine) as session:
            skill = session.get(Skill, self.skill_id)
            first_skill, first = resolve_skill_release(
                session,
                skill,
                project_id=42,
                conversation_id=1,
                owner_user_id=1,
            )
            second_skill, second = resolve_skill_release(
                session,
                skill,
                project_id=42,
                conversation_id=999,
                owner_user_id=999,
            )
            self.assertEqual(first.bucket, second.bucket)
            self.assertEqual(first.release_id, second.release_id)
            self.assertEqual(first_skill.package_sha256, second_skill.package_sha256)
            expected_prompt = (
                "Candidate strategy behavior"
                if first.variant == "candidate"
                else "You are a strategy consultant."
            )
            self.assertEqual(first_skill.system_prompt, expected_prompt)
            self.assertEqual(
                build_skill_context(
                    session,
                    self.skill_id,
                    skill_override=first_skill,
                ).skill_prompt,
                expected_prompt,
            )

            conversation = Conversation(title="Rollout stop loss")
            session.add(conversation)
            session.flush()
            for index in range(2):
                task = TaskRun(
                    conversation_id=conversation.id,
                    task_type="chat_rollout",
                    status="failed",
                )
                session.add(task)
                session.flush()
                session.add(ChatRun(
                    run_id=f"run-rollout-failure-{index}",
                    task_run_id=task.id,
                    conversation_id=conversation.id,
                    skill_id=self.skill_id,
                    skill_name="Strategy Report",
                    skill_release_id=candidate["id"],
                    skill_rollout_id=rollout_json["id"],
                    skill_rollout_variant="candidate",
                    status="failed",
                ))
            session.commit()
            rollout = session.get(SkillRollout, rollout_json["id"])
            health = evaluate_rollout_stop_loss(session, rollout)
            session.commit()
            session.refresh(rollout)
            session.refresh(skill)

            self.assertTrue(health["auto_stopped"])
            self.assertEqual(rollout.status, "rolled_back")
            self.assertEqual(rollout.stop_reason, "candidate_failure_rate_exceeded")
            self.assertEqual(skill.active_release_id, baseline["id"])

    def test_skill_release_writes_require_admin(self):
        self.app.dependency_overrides[get_current_user] = lambda: User(
            id=2, email="member@example.com", display_name="Member", is_admin=False
        )
        create = self.client.post("/skills", json={"name": "Blocked", "category": "general"})
        update = self.client.patch(f"/skills/{self.skill_id}", json={"description": "Blocked"})
        delete = self.client.delete(f"/skills/{self.skill_id}")

        self.assertEqual(create.status_code, 403)
        self.assertEqual(update.status_code, 403)
        self.assertEqual(delete.status_code, 403)

    def test_delete_skill(self):
        with Session(self.engine) as session:
            conversation = Conversation(title="Skill run history", skill_id=self.skill_id)
            session.add(conversation)
            session.flush()
            scheduled_task = ScheduledTask(
                name="Skill schedule",
                skill_id=self.skill_id,
                frequency="weekly",
            )
            session.add(scheduled_task)
            task = TaskRun(
                conversation_id=conversation.id,
                task_type="chat_rollout",
                status="completed",
            )
            session.add(task)
            session.flush()
            session.add(
                ChatRun(
                    run_id="run-skill-delete",
                    task_run_id=task.id,
                    conversation_id=conversation.id,
                    skill_id=self.skill_id,
                    skill_name="Strategy Report",
                    status="completed",
                )
            )
            session.commit()
            conversation_id = int(conversation.id)
            scheduled_task_id = int(scheduled_task.id)

        resp = self.client.delete(f"/skills/{self.skill_id}")
        self.assertIn(resp.status_code, [200, 204])
        resp2 = self.client.get(f"/skills/{self.skill_id}")
        self.assertEqual(resp2.status_code, 404)
        with Session(self.engine) as session:
            chat_run = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run-skill-delete")
            ).one()
            self.assertIsNone(chat_run.skill_id)
            self.assertEqual(chat_run.skill_name, "Strategy Report")
            self.assertIsNone(session.get(Conversation, conversation_id).skill_id)
            self.assertIsNone(session.get(ScheduledTask, scheduled_task_id).skill_id)

    def test_delete_nonexistent_skill(self):
        resp = self.client.delete("/skills/99999")
        self.assertEqual(resp.status_code, 404)

    def test_skill_summaries(self):
        resp = self.client.get("/skills/meta/summary")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, (list, dict))
        self.assertEqual(data[0]["package_version"], "1.0.0")
        self.assertEqual(data[0]["package_status"], "stable")

    def test_turn_setup_recommends_brief_and_exact_skill_without_executing(self):
        resp = self.client.post("/skills/recommendations/turn", json={
            "project_id": 3,
            "content": "Generate Strategy Report for the board",
            "skill_mode": "auto",
        })

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["template"]["id"], "executive_answer")
        self.assertEqual(data["skill"]["state"], "recommended")
        self.assertEqual(data["skill"]["skill_id"], self.skill_id)
        self.assertEqual(data["skill"]["skill_name"], "Strategy Report")

    def test_turn_setup_respects_explicit_skill_off_boundary(self):
        resp = self.client.post("/skills/recommendations/turn", json={
            "project_id": 3,
            "content": "请分析项目风险",
            "skill_mode": "off",
        })

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["template"]["id"], "read_only_analysis")
        self.assertEqual(resp.json()["skill"]["state"], "off")

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
        self.assertIn('skill_name: "presentation-builder"', skill.system_prompt)
        self.assertIn('deck_type: "proposal"', skill.system_prompt)
        self.assertIn("客户可审阅", skill.user_template)
        self.assertEqual(skill.max_tokens, 32768)
        self.assertEqual(skill.package_version, "1.0.0")
        self.assertEqual(skill.package_status, "stable")
        self.assertEqual(len(skill.package_sha256), 64)
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
