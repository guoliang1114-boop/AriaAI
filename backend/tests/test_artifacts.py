"""Tests for artifacts router — covers CRUD for generated file artifacts."""
import unittest
import tempfile
import shutil
import hashlib
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select

from app.models.db import (
    ArtifactVerification,
    Conversation,
    GeneratedFile,
    Project,
    ProjectFile,
    User,
)
from app.models.knowledge import (
    ArtifactKnowledgeArchive,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.routers import artifacts as artifacts_module
from app.routers.artifacts import router
from app.database import get_session
from app.services import knowledge_ingestion as knowledge_ingestion_module
from tests.test_database import create_test_engine, drop_all_tables
from app.services.agent_harness.artifact_verification import persist_artifact_verification


class ArtifactsRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        self.tmpdir = tempfile.mkdtemp()
        self.uploads_dir = Path(self.tmpdir) / "uploads"
        self.uploads_dir.mkdir()
        self.original_uploads_dir = artifacts_module.UPLOADS_DIR
        self.original_knowledge_uploads_dir = knowledge_ingestion_module.UPLOADS_DIR
        artifacts_module.UPLOADS_DIR = self.uploads_dir
        knowledge_ingestion_module.UPLOADS_DIR = self.uploads_dir

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
            legacy_path = self.uploads_dir / "generated" / "legacy.md"
            legacy_path.write_text("# Legacy Report\n")
            legacy_gf = GeneratedFile(
                conversation_id=conv.id,
                name="legacy.md",
                file_type="markdown",
                path="generated/legacy.md",
                size_bytes=16,
                description="Legacy report without verification evidence",
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
            manual_path = self.uploads_dir / "generated" / "manual.md"
            manual_path.write_text("# Manual acceptance\n")
            manual_gf = GeneratedFile(
                conversation_id=conv.id,
                name="manual.md",
                file_type="markdown",
                path="generated/manual.md",
                size_bytes=manual_path.stat().st_size,
                description="Report with Skill business checks",
            )
            session.add(gf)
            session.add(legacy_gf)
            session.add(other_gf)
            session.add(manual_gf)
            session.commit()
            session.refresh(gf)
            session.refresh(legacy_gf)
            session.refresh(other_gf)
            session.refresh(manual_gf)
            gf.content_sha256 = hashlib.sha256(report_path.read_bytes()).hexdigest()
            manual_gf.content_sha256 = hashlib.sha256(manual_path.read_bytes()).hexdigest()
            session.add(gf)
            session.add(manual_gf)
            verification = persist_artifact_verification(session, gf, report_path)
            manual_verification = persist_artifact_verification(
                session,
                manual_gf,
                manual_path,
                skill_runtime_contract={
                    "verification_status": "available",
                    "verification_context_complete": True,
                    "verification_step_count": 2,
                    "verification_plan_sha256": "a" * 64,
                    "release_sha256": "b" * 64,
                },
            )
            session.commit()
            self.artifact_id = gf.id
            self.manual_artifact_id = manual_gf.id
            self.legacy_artifact_id = legacy_gf.id
            self.other_artifact_id = other_gf.id
            self.verification_id = verification["verification_id"]
            self.manual_verification_id = manual_verification["verification_id"]

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
        knowledge_ingestion_module.UPLOADS_DIR = self.original_knowledge_uploads_dir
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

    def test_get_artifact_verification_returns_bounded_evidence(self):
        resp = self.client.get(f"/artifacts/{self.artifact_id}/verification")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["verification_id"], self.verification_id)
        self.assertEqual(data["status"], "passed")
        self.assertTrue(data["checks"])
        self.assertNotIn(str(self.uploads_dir), str(data))
        self.assertNotIn("Test Report", str(data))

    def test_get_artifact_verification_returns_404_for_legacy_artifact(self):
        resp = self.client.get(
            f"/artifacts/{self.legacy_artifact_id}/verification"
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_artifact_verification_rejects_other_users_artifact(self):
        resp = self.client.get(
            f"/artifacts/{self.other_artifact_id}/verification"
        )
        self.assertEqual(resp.status_code, 403)

    def test_save_verified_artifact_to_project_is_explicit_bound_and_idempotent(self):
        with Session(self.engine) as session:
            project = Project(name="Artifact project", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            artifact = session.get(GeneratedFile, self.artifact_id)
            artifact.project_id = project.id
            session.add(artifact)
            session.commit()
            project_id = int(project.id)
            digest = artifact.content_sha256

        first = self.client.post(
            f"/artifacts/{self.artifact_id}/save-to-project",
            json={"expected_content_sha256": digest},
        )
        second = self.client.post(
            f"/artifacts/{self.artifact_id}/save-to-project",
            json={"expected_content_sha256": digest},
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(first.json()["created"])
        self.assertFalse(second.json()["created"])
        self.assertFalse(first.json()["writes_memory"])
        self.assertTrue(first.json()["invalidates_derived_project_memory"])
        self.assertFalse(second.json()["invalidates_derived_project_memory"])
        self.assertFalse(first.json()["writes_knowledge_base"])
        self.assertEqual(first.json()["project_id"], project_id)
        self.assertEqual(
            first.json()["project_file_id"],
            second.json()["project_file_id"],
        )
        with Session(self.engine) as session:
            artifact = session.get(GeneratedFile, self.artifact_id)
            project_files = session.exec(
                select(ProjectFile).where(ProjectFile.project_id == project_id)
            ).all()
            self.assertEqual(len(project_files), 1)
            self.assertEqual(artifact.project_file_id, project_files[0].id)
            self.assertEqual(artifact.saved_to_project_by_user_id, self.user_id)
            self.assertIsNotNone(artifact.saved_to_project_at)

    def test_save_artifact_to_project_rejects_stale_content_identity(self):
        with Session(self.engine) as session:
            project = Project(name="Stale project", client="Client")
            session.add(project)
            session.commit()
            artifact = session.get(GeneratedFile, self.artifact_id)
            artifact.project_id = project.id
            session.add(artifact)
            session.commit()

        resp = self.client.post(
            f"/artifacts/{self.artifact_id}/save-to-project",
            json={"expected_content_sha256": "f" * 64},
        )

        self.assertEqual(resp.status_code, 409)

    def test_archive_delivery_ready_artifact_to_selected_knowledge_source(self):
        with Session(self.engine) as session:
            project = Project(name="Knowledge archive", client="Client")
            session.add(project)
            session.flush()
            source = KnowledgeSource(
                name="User source",
                source_type="manual_upload",
                scope_type="user",
                owner_user_id=self.user_id,
            )
            session.add(source)
            artifact = session.get(GeneratedFile, self.artifact_id)
            artifact.project_id = project.id
            session.add(artifact)
            session.commit()
            source_id = int(source.id)
            digest = artifact.content_sha256

        first = self.client.post(
            f"/artifacts/{self.artifact_id}/archive-to-knowledge",
            json={
                "source_id": source_id,
                "confirm_archive": True,
                "expected_content_sha256": digest,
            },
        )
        second = self.client.post(
            f"/artifacts/{self.artifact_id}/archive-to-knowledge",
            json={
                "source_id": source_id,
                "confirm_archive": True,
                "expected_content_sha256": digest,
            },
        )
        listed = self.client.get(
            f"/artifacts/{self.artifact_id}/knowledge-archives"
        )

        self.assertEqual(first.status_code, 202, first.text)
        self.assertEqual(second.status_code, 202, second.text)
        self.assertTrue(first.json()["archive_created"])
        self.assertFalse(second.json()["archive_created"])
        self.assertFalse(first.json()["writes_project_memory"])
        self.assertFalse(first.json()["writes_client_memory"])
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)
        with Session(self.engine) as session:
            self.assertEqual(
                len(session.exec(select(ArtifactKnowledgeArchive)).all()),
                1,
            )
            documents = session.exec(select(KnowledgeV1Document)).all()
            self.assertEqual(len(documents), 1)
            self.assertEqual(documents[0].content_hash, digest)

    def test_archive_to_knowledge_requires_final_delivery_gate(self):
        with Session(self.engine) as session:
            source = KnowledgeSource(
                name="Private source",
                source_type="manual_upload",
                scope_type="user",
                owner_user_id=self.user_id,
            )
            session.add(source)
            session.commit()
            source_id = int(source.id)
            artifact = session.get(GeneratedFile, self.manual_artifact_id)
            digest = artifact.content_sha256

        response = self.client.post(
            f"/artifacts/{self.manual_artifact_id}/archive-to-knowledge",
            json={
                "source_id": source_id,
                "confirm_archive": True,
                "expected_content_sha256": digest,
            },
        )

        self.assertEqual(response.status_code, 409)

    def test_archive_to_knowledge_rechecks_target_source_write_permission(self):
        with Session(self.engine) as session:
            source = KnowledgeSource(
                name="Other user source",
                source_type="manual_upload",
                scope_type="user",
                owner_user_id=self.other_user_id,
            )
            session.add(source)
            session.commit()
            source_id = int(source.id)
            artifact = session.get(GeneratedFile, self.artifact_id)
            digest = artifact.content_sha256

        response = self.client.post(
            f"/artifacts/{self.artifact_id}/archive-to-knowledge",
            json={
                "source_id": source_id,
                "confirm_archive": True,
                "expected_content_sha256": digest,
            },
        )

        self.assertEqual(response.status_code, 403)

    def test_archive_to_knowledge_requires_explicit_confirmation(self):
        with Session(self.engine) as session:
            source = KnowledgeSource(
                name="Confirmation source",
                source_type="manual_upload",
                scope_type="user",
                owner_user_id=self.user_id,
            )
            session.add(source)
            session.commit()
            source_id = int(source.id)
            artifact = session.get(GeneratedFile, self.artifact_id)
            digest = artifact.content_sha256

        response = self.client.post(
            f"/artifacts/{self.artifact_id}/archive-to-knowledge",
            json={
                "source_id": source_id,
                "expected_content_sha256": digest,
            },
        )

        self.assertEqual(response.status_code, 422)

    def test_get_acceptance_marks_technical_pass_without_skill_checks_ready(self):
        resp = self.client.get(f"/artifacts/{self.artifact_id}/acceptance")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["review_status"], "not_required")
        self.assertEqual(data["delivery_status"], "ready")
        self.assertTrue(data["final_delivery_allowed"])

    def test_manual_acceptance_is_revisioned_and_audited(self):
        pending = self.client.get(
            f"/artifacts/{self.manual_artifact_id}/acceptance"
        )
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json()["review_status"], "pending")

        accepted = self.client.post(
            f"/artifacts/{self.manual_artifact_id}/acceptance",
            json={
                "decision": "accepted",
                "expected_revision": 0,
                "reason": "已核对客户口径和结论。",
            },
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["review_status"], "accepted")
        self.assertEqual(accepted.json()["revision"], 1)
        self.assertTrue(accepted.json()["final_delivery_allowed"])

        stale = self.client.post(
            f"/artifacts/{self.manual_artifact_id}/acceptance",
            json={
                "decision": "rejected",
                "expected_revision": 0,
                "reason": "使用过期版本。",
            },
        )
        self.assertEqual(stale.status_code, 409)

    def test_acceptance_registry_and_contract_are_content_free(self):
        registry = self.client.get("/artifacts/verification/business-verifiers")
        contract = self.client.get("/artifacts/acceptance/contract")
        self.assertEqual(registry.status_code, 200)
        self.assertEqual(contract.status_code, 200)
        self.assertFalse(registry.json()["skill_package_code_executable"])
        self.assertTrue(contract.json()["events_are_append_only"])
        self.assertNotIn(str(self.uploads_dir), str(registry.json()))

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
        with Session(self.engine) as session:
            self.assertIsNone(session.get(ArtifactVerification, self.verification_id))

    def test_delete_nonexistent_artifact(self):
        resp = self.client.delete("/artifacts/99999")
        self.assertEqual(resp.status_code, 404)


if __name__ == "__main__":
    unittest.main()
