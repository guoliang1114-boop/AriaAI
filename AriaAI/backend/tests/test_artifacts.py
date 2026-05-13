"""Tests for artifacts router — covers CRUD for generated file artifacts."""
import unittest
import tempfile
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import GeneratedFile, User, Conversation
from app.routers import artifacts as artifacts_module
from app.routers.artifacts import router
from app.database import get_session
from tests.test_database import create_test_engine, drop_all_tables


class ArtifactsRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        self.tmpdir = tempfile.mkdtemp()

        with Session(self.engine) as session:
            user = User(email="test@test.com", password_hash="h", display_name="T")
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user_id = user.id

            conv = Conversation(user_id=user.id, title="test conv")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            self.conv_id = conv.id

            gf = GeneratedFile(
                conversation_id=conv.id,
                name="report.md",
                file_type="markdown",
                path=os.path.join(self.tmpdir, "report.md"),
                size_bytes=100,
                description="Test report",
            )
            session.add(gf)
            session.commit()
            session.refresh(gf)
            self.artifact_id = gf.id

            Path(gf.path).write_text("# Test Report\nContent here")

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = override_session

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_list_artifacts(self):
        resp = self.client.get("/artifacts")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)

    def test_list_artifacts_by_conversation(self):
        resp = self.client.get(f"/artifacts?conversation_id={self.conv_id}")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.json()), 1)

    def test_get_artifact(self):
        resp = self.client.get(f"/artifacts/{self.artifact_id}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["name"], "report.md")

    def test_get_nonexistent_artifact(self):
        resp = self.client.get("/artifacts/99999")
        self.assertEqual(resp.status_code, 404)

    def test_download_artifact(self):
        resp = self.client.get(f"/artifacts/{self.artifact_id}/download")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"Test Report", resp.content)

    def test_delete_artifact(self):
        resp = self.client.delete(f"/artifacts/{self.artifact_id}")
        self.assertIn(resp.status_code, [200, 204])
        resp2 = self.client.get(f"/artifacts/{self.artifact_id}")
        self.assertEqual(resp2.status_code, 404)

    def test_delete_nonexistent_artifact(self):
        resp = self.client.delete("/artifacts/99999")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
