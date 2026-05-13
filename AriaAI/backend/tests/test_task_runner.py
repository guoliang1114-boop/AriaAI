"""Tests for scheduled task runner — execution flow, next-run computation."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime

from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.models.db import ScheduledTask, Skill, Project
from app.services import task_runner as tr_module


class ComputeNextRunTestCase(unittest.TestCase):
    @patch("app.services.scheduler.next_run_from_frequency")
    def test_compute_next_run_delegates(self, mock_next_run):
        mock_next_run.return_value = datetime(2025, 1, 1, 12, 0, 0)
        task = ScheduledTask(name="T", prompt="p", frequency="daily", cron_expr="0 9 * * *")
        result = tr_module._compute_next_run(task)
        self.assertEqual(result, datetime(2025, 1, 1, 12, 0, 0))
        mock_next_run.assert_called_once_with("daily", "0 9 * * *")


class RunTaskTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)

        self.patchers = []
        # Patch engine used inside run_task
        p_engine = patch.object(tr_module, "engine", self.engine)
        self.patchers.append(p_engine)
        p_engine.start()

        # Patch claude.complete
        self.mock_complete = AsyncMock(return_value="AI response text")
        p_complete = patch.object(tr_module, "complete", self.mock_complete)
        self.patchers.append(p_complete)
        p_complete.start()

        # Patch build_system_prompt
        self.mock_build_sys = MagicMock(return_value="system prompt")
        p_sys = patch.object(tr_module, "build_system_prompt", self.mock_build_sys)
        self.patchers.append(p_sys)
        p_sys.start()

        # Patch _compute_next_run
        self.mock_next_run = MagicMock(return_value=datetime(2025, 1, 2, 0, 0, 0))
        p_next = patch.object(tr_module, "_compute_next_run", self.mock_next_run)
        self.patchers.append(p_next)
        p_next.start()

    def tearDown(self):
        for p in self.patchers:
            p.stop()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _seed_task(self, **overrides):
        with Session(self.engine) as session:
            task = ScheduledTask(
                name=overrides.get("name", "Test task"),
                prompt=overrides.get("prompt", "Do something"),
                frequency=overrides.get("frequency", "once"),
                cron_expr=overrides.get("cron_expr", ""),
                is_enabled=overrides.get("is_enabled", True),
                skill_id=overrides.get("skill_id"),
                project_id=overrides.get("project_id"),
            )
            session.add(task)
            session.commit()
            return task.id

    def test_run_disabled_task(self):
        import asyncio
        tid = self._seed_task(is_enabled=False)
        asyncio.run(tr_module.run_task(tid))

        with Session(self.engine) as session:
            task = session.get(ScheduledTask, tid)
            # Should not have been modified (or at least not set to success)
            self.assertNotEqual(task.status, "success")

    def test_run_task_without_skill_or_project(self):
        import asyncio
        tid = self._seed_task(prompt="Analyze Q3 data")
        asyncio.run(tr_module.run_task(tid))

        with Session(self.engine) as session:
            task = session.get(ScheduledTask, tid)
            self.assertEqual(task.status, "success")
            self.assertIsNotNone(task.last_run)
            self.mock_complete.assert_awaited_once()

    def test_run_task_with_skill(self):
        import asyncio
        with Session(self.engine) as session:
            skill = Skill(name="Analyzer", system_prompt="You analyze data", category="analytics")
            session.add(skill)
            session.commit()
            skill_id = skill.id

        tid = self._seed_task(skill_id=skill_id)
        asyncio.run(tr_module.run_task(tid))

        self.mock_build_sys.assert_called_once()
        args, kwargs = self.mock_build_sys.call_args
        self.assertIn("You analyze data", args[0])

    def test_run_task_with_project(self):
        import asyncio
        with Session(self.engine) as session:
            proj = Project(name="Alpha", client="ClientA")
            session.add(proj)
            session.commit()
            proj_id = proj.id

        tid = self._seed_task(project_id=proj_id)
        asyncio.run(tr_module.run_task(tid))

        self.mock_build_sys.assert_called_once()
        args, kwargs = self.mock_build_sys.call_args
        self.assertIn("Alpha", kwargs.get("project_context", ""))

    def test_run_task_failure(self):
        import asyncio
        self.mock_complete.side_effect = Exception("LLM failure")
        tid = self._seed_task()
        asyncio.run(tr_module.run_task(tid))

        with Session(self.engine) as session:
            task = session.get(ScheduledTask, tid)
            self.assertEqual(task.status, "failed")
