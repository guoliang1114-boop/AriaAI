"""Tests for artifacts router — covers CRUD for generated file artifacts."""
import unittest
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel

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
        self.uploads_dir = Path(self.tmpdir) / "uploads"
        self.uploads_dir.mkdir()
        self.original_uploads_dir = artifacts_module.UPLOADS_DIR
        artifacts_module.UPLOADS_DIR = self.uploads_dir

        with Session(self.engine) as session:
            user = User(email="test@test.com", password_hash="h", display_name="T")
            other = User(email="other@test.com", password_hash="h", display_name="Other")
            session.add(user)
            session.add(other)
            session.commit()
            session.refresh(user)
            session.refresh(other)
            self.user_id = user.id
            self.other_user_id = other.id

            conv = Conversation(owner_user_id=user.id, title="test conv")
            other_conv = Conversation(owner_user_id=other.id, title="other conv")
            session.add(conv)
            session.add(other_conv)
            session.commit()
            session.refresh(conv)
            session.refresh(other_conv)
            self.conv_id = conv.id

            report_path = self.uploads_dir / "generated" / "report.md"
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text("# Test Report\nContent here")
            gf = GeneratedFile(
                conversation_id=conv.id,
                name="report.md",
                file_type="markdown",
                path="generated/report.md",
                size_bytes=100,
                description="Test report",
            )
            other_path = self.uploads_dir / "generated" / "other.md"
            other_path.write_text("# Other Report\n")
            other_gf = GeneratedFile(
                conversation_id=other_conv.id,
                name="other.md",
                file_type="markdown",
                path="generated/other.md",
                size_bytes=30,
                description="Other report",
            )
            session.add(gf)
            session.add(other_gf)
            session.commit()
            session.refresh(gf)
            session.refresh(other_gf)
            self.artifact_id = gf.id
            self.other_artifact_id = other_gf.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = override_session
        app.dependency_overrides[artifacts_module.get_current_user] = lambda: User(
            id=self.user_id,
            email="test@test.com",
            password_hash="h",
            display_name="T",
            is_admin=True,
            is_active=True,
        )

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        artifacts_module.UPLOADS_DIR = self.original_uploads_dir
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()
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

    def test_download_by_path_rejects_absolute_path(self):
        resp = self.client.get("/artifacts/download-by-path", params={"path": "/etc/passwd"})
        self.assertEqual(resp.status_code, 400)

    def test_download_by_path_rejects_traversal(self):
        resp = self.client.get("/artifacts/download-by-path", params={"path": "../secret.txt"})
        self.assertEqual(resp.status_code, 400)

    def test_download_by_path_requires_artifact_record(self):
        orphan_path = self.uploads_dir / "generated" / "orphan.md"
        orphan_path.write_text("# Orphan")
        resp = self.client.get("/artifacts/download-by-path", params={"path": "generated/orphan.md"})
        self.assertEqual(resp.status_code, 404)

    def test_non_admin_cannot_download_other_users_artifact(self):
        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[get_session] = override_session
        app.dependency_overrides[artifacts_module.get_current_user] = lambda: User(
            id=self.user_id,
            email="test@test.com",
            password_hash="h",
            display_name="T",
            is_admin=False,
            is_active=True,
        )
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get(f"/artifacts/{self.other_artifact_id}/download")
        self.assertEqual(resp.status_code, 403)

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
