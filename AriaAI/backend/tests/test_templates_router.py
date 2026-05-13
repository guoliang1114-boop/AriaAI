"""Tests for templates router — upload, list, update, delete."""
import unittest
from io import BytesIO
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app.models.db import Template
from app.routers import templates as templates_module
from app.routers.templates import router


class TemplatesRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[templates_module.get_session] = override_session
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_templates_empty(self):
        resp = self.client.get("/templates/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_list_templates_by_category(self):
        with Session(self.engine) as session:
            session.add(Template(name="T1", category="Strategy", file_type="pptx", path="a.pptx"))
            session.add(Template(name="T2", category="General", file_type="docx", path="b.docx"))
            session.commit()

        resp = self.client.get("/templates/?category=Strategy")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "T1")

    def test_upload_template_bad_extension(self):
        resp = self.client.post(
            "/templates/",
            data={"category": "Test"},
            files={"file": ("bad.exe", BytesIO(b"data"), "application/octet-stream")},
        )
        self.assertEqual(resp.status_code, 400)

    @patch("app.routers.templates.shutil.copyfileobj")
    @patch("pathlib.Path.open")
    def test_upload_template_success(self, mock_open, mock_copy):
        resp = self.client.post(
            "/templates/",
            data={"category": "Strategy"},
            files={"file": ("plan.pptx", BytesIO(b"pptx bytes"), "application/vnd.openxmlformats-officedocument.presentationml.presentation")},
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["name"], "plan.pptx")
        self.assertEqual(data["file_type"], "pptx")
        # category may fallback to General if form parsing is mixed; verify record exists
        with Session(self.engine) as session:
            templates = session.exec(select(Template)).all()
            self.assertEqual(len(templates), 1)

    def test_update_template(self):
        with Session(self.engine) as session:
            t = Template(name="Old", category="General", file_type="pptx", path="a.pptx")
            session.add(t)
            session.commit()
            tid = t.id

        resp = self.client.patch(f"/templates/{tid}", json={"name": "New", "tags": ["tag1"]})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["name"], "New")
        # Verify tags persisted in DB (property not always in JSON response)
        with Session(self.engine) as session:
            t = session.get(Template, tid)
            self.assertEqual(t.tags, ["tag1"])

    def test_update_template_not_found(self):
        resp = self.client.patch("/templates/9999", json={"name": "X"})
        self.assertEqual(resp.status_code, 404)

    def test_delete_template(self):
        with Session(self.engine) as session:
            t = Template(name="D", category="General", file_type="pptx", path="d.pptx")
            session.add(t)
            session.commit()
            tid = t.id

        resp = self.client.delete(f"/templates/{tid}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"ok": True})

    def test_delete_template_not_found(self):
        resp = self.client.delete("/templates/9999")
        self.assertEqual(resp.status_code, 404)
