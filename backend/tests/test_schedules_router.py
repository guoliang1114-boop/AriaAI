"""Tests for schedules router — CRUD and scheduler integration."""
import unittest
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import ScheduledTask, User
from app.routers import schedules as schedules_module
from app.routers.auth import require_admin
from app.routers.schedules import router
from tests.test_database import create_test_engine, drop_all_tables


class SchedulesRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        self.scheduler_mock = MagicMock()
        self.scheduler_mock.next_run_from_frequency.return_value = None
        self.scheduler_mock.register_task = MagicMock()
        self.scheduler_mock.update_task = MagicMock()
        self.scheduler_mock.remove_task = MagicMock()
        self.scheduler_mock.trigger_now = MagicMock()

        patches = [
            patch.object(schedules_module, "scheduler_service", self.scheduler_mock),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[schedules_module.get_session] = override_session
        # R74 router-level guard is require_admin — supply an admin
        # user so the dep returns instead of 403-ing.
        app.dependency_overrides[require_admin] = lambda: User(
            id=1, email="admin@example.com", display_name="Admin", is_admin=True
        )
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_tasks_empty(self):
        resp = self.client.get("/schedules/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_create_task(self):
        payload = {
            "name": "Daily report",
            "prompt": "Generate daily summary",
            "frequency": "daily",
            "cron_expr": "0 9 * * *",
            "is_enabled": True,
        }
        resp = self.client.post("/schedules/", json=payload)
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["name"], "Daily report")
        self.assertEqual(data["frequency"], "daily")
        self.scheduler_mock.register_task.assert_called_once()

    def test_update_task(self):
        with Session(self.engine) as session:
            task = ScheduledTask(name="Old", prompt="p", frequency="once", cron_expr="")
            session.add(task)
            session.commit()
            task_id = task.id

        resp = self.client.patch(f"/schedules/{task_id}", json={"name": "New"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "New")
        self.scheduler_mock.update_task.assert_called_once()

    def test_update_task_not_found(self):
        resp = self.client.patch("/schedules/9999", json={"name": "New"})
        self.assertEqual(resp.status_code, 404)

    def test_delete_task(self):
        with Session(self.engine) as session:
            task = ScheduledTask(name="D", prompt="p", frequency="once", cron_expr="")
            session.add(task)
            session.commit()
            task_id = task.id

        resp = self.client.delete(f"/schedules/{task_id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})
        self.scheduler_mock.remove_task.assert_called_once_with(task_id)

    def test_delete_task_not_found(self):
        resp = self.client.delete("/schedules/9999")
        self.assertEqual(resp.status_code, 404)

    def test_run_now(self):
        with Session(self.engine) as session:
            task = ScheduledTask(name="R", prompt="p", frequency="once", cron_expr="")
            session.add(task)
            session.commit()
            task_id = task.id

        resp = self.client.post(f"/schedules/{task_id}/run")
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["ok"])
        self.scheduler_mock.trigger_now.assert_called_once()

    def test_run_now_not_found(self):
        resp = self.client.post("/schedules/9999/run")
        self.assertEqual(resp.status_code, 404)
