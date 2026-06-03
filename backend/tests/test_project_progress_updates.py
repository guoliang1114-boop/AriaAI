import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

from app.models.db import Project, User
from app.routers import projects as projects_module
from app.routers.auth import get_current_user
from app.routers.projects import router
from app.services.cache import projects_cache
from tests.test_database import create_test_engine, drop_all_tables


def _override_admin_user():
    return User(id=1, email="admin@test.com", display_name="Admin", is_admin=True)


class ProjectProgressUpdatesTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            user = User(email="admin@test.com", password_hash="h", display_name="Admin", is_admin=True)
            project = Project(name="Progress Project", client="Acme", description="Demo")
            session.add(user)
            session.add(project)
            session.commit()
            session.refresh(user)
            session.refresh(project)
            self.user_id = user.id
            self.project_id = project.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[projects_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = _override_admin_user
        self.client = TestClient(app, raise_server_exceptions=False)
        projects_cache.clear()

    def tearDown(self):
        projects_cache.clear()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_create_progress_update_and_include_in_detail(self):
        payload = {
            "content": "客户已确认周五讲标。",
            "next_step": "准备讲标提纲",
            "risk": "预算审批时间未定",
        }
        resp = self.client.post(f"/projects/{self.project_id}/progress-updates", json=payload)
        self.assertEqual(resp.status_code, 201)
        created = resp.json()
        self.assertEqual(created["content"], payload["content"])
        self.assertEqual(created["created_by"]["display_name"], "Admin")

        list_resp = self.client.get(f"/projects/{self.project_id}/progress-updates")
        self.assertEqual(list_resp.status_code, 200)
        self.assertEqual(len(list_resp.json()), 1)

        detail_resp = self.client.get(f"/projects/{self.project_id}/detail")
        self.assertEqual(detail_resp.status_code, 200)
        detail = detail_resp.json()
        self.assertEqual(detail["progress_updates"][0]["next_step"], payload["next_step"])
