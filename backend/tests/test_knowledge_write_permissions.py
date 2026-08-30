from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session, select

from app.models.db import ClientRecord, KnowledgeDocument, Project, ProjectMember, User
from app.models.knowledge import (
    KnowledgeJob,
    KnowledgeSource,
    KnowledgeTemplate,
    KnowledgeV1Document,
)
from app.routers import knowledge as knowledge_router
from app.services import knowledge_permissions
from app.services.storage import StorageService
from tests.test_database import create_test_engine, drop_all_tables


class KnowledgeWritePermissionTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        self.temp_dir = tempfile.TemporaryDirectory()
        self.uploads_dir = Path(self.temp_dir.name) / "uploads"
        (self.uploads_dir / "knowledge").mkdir(parents=True, exist_ok=True)

        with Session(self.engine) as session:
            admin = User(
                email="knowledge-admin@example.com",
                password_hash="x",
                is_admin=True,
                is_active=True,
            )
            editor = User(
                email="knowledge-editor@example.com",
                password_hash="x",
                is_active=True,
            )
            viewer = User(
                email="knowledge-viewer@example.com",
                password_hash="x",
                is_active=True,
            )
            creator = User(
                email="knowledge-client-creator@example.com",
                password_hash="x",
                is_active=True,
            )
            session.add(admin)
            session.add(editor)
            session.add(viewer)
            session.add(creator)
            session.commit()
            for user in (admin, editor, viewer, creator):
                session.refresh(user)

            client = ClientRecord(
                name="Stable Client",
                created_by_user_id=int(creator.id),
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            project = Project(
                name="Knowledge ACL Project",
                client=client.name,
                client_id=int(client.id),
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            editor_member = ProjectMember(
                project_id=int(project.id),
                user_id=int(editor.id),
                role="editor",
            )
            viewer_member = ProjectMember(
                project_id=int(project.id),
                user_id=int(viewer.id),
                role="viewer",
            )
            session.add(editor_member)
            session.add(viewer_member)
            session.commit()
            session.refresh(editor_member)

            source = KnowledgeSource(
                name="Project source",
                source_type="manual_upload",
                scope_type="project",
                scope_id=int(project.id),
                owner_user_id=int(editor.id),
            )
            session.add(source)
            session.commit()
            session.refresh(source)
            source_document = KnowledgeV1Document(
                source_id=int(source.id),
                title="Source document",
                file_name="source.md",
                file_type="md",
                path="knowledge/source.md",
                content_hash="a" * 64,
                scope_type="project",
                scope_id=int(project.id),
                status="indexed",
                original_storage_key="knowledge/source.md",
            )
            (self.uploads_dir / "knowledge" / "source.md").write_text(
                "source knowledge",
                encoding="utf-8",
            )
            session.add(source_document)
            session.commit()
            session.refresh(source_document)
            failed_job = KnowledgeJob(
                job_type="index_document",
                status="failed",
                source_id=int(source.id),
                document_id=int(source_document.id),
                requested_by_user_id=int(editor.id),
                retryable=True,
                idempotency_key="knowledge-acl-failed-job",
            )
            session.add(failed_job)

            legacy_path = self.uploads_dir / "knowledge" / "legacy.txt"
            legacy_path.write_text("legacy knowledge", encoding="utf-8")
            legacy_document = KnowledgeDocument(
                name="legacy.txt",
                file_type="txt",
                path="knowledge/legacy.txt",
                category="general",
                vector_status="failed",
                project_id=int(project.id),
            )
            session.add(legacy_document)
            session.commit()
            session.refresh(failed_job)
            session.refresh(legacy_document)

            self.user_ids = {
                "admin": int(admin.id),
                "editor": int(editor.id),
                "viewer": int(viewer.id),
                "creator": int(creator.id),
            }
            self.client_id = int(client.id)
            self.project_id = int(project.id)
            self.editor_member_id = int(editor_member.id)
            self.source_id = int(source.id)
            self.source_document_id = int(source_document.id)
            self.failed_job_id = int(failed_job.id)
            self.legacy_document_id = int(legacy_document.id)

        self.current_user_id = self.user_ids["viewer"]
        app = FastAPI()
        app.include_router(knowledge_router.router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        def override_user():
            with Session(self.engine) as session:
                return session.get(User, self.current_user_id)

        app.dependency_overrides[knowledge_router.get_session] = override_session
        app.dependency_overrides[knowledge_router.get_current_user] = override_user
        app.dependency_overrides[knowledge_router.require_admin] = override_user
        self.api = TestClient(app, raise_server_exceptions=False)
        self.upload_patches = (
            patch.object(knowledge_router, "UPLOADS_DIR", self.uploads_dir),
            patch.object(knowledge_router, "KB_UPLOADS", self.uploads_dir / "knowledge"),
        )
        for active_patch in self.upload_patches:
            active_patch.start()

    def tearDown(self) -> None:
        for active_patch in reversed(self.upload_patches):
            active_patch.stop()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _become(self, role: str) -> None:
        self.current_user_id = self.user_ids[role]

    def test_viewer_can_read_but_cannot_mutate_or_retry(self) -> None:
        self.assertEqual(
            self.api.get(f"/knowledge/sources/{self.source_id}/documents").status_code,
            200,
        )
        self.assertEqual(
            self.api.get(f"/knowledge/jobs/{self.failed_job_id}").status_code,
            200,
        )
        visible = self.api.get("/knowledge/documents")
        self.assertEqual(visible.status_code, 200)
        self.assertEqual([item["id"] for item in visible.json()], [self.legacy_document_id])
        templates = self.api.get("/knowledge/templates")
        self.assertEqual(templates.status_code, 200)
        self.assertTrue(templates.json()["templates"])
        with Session(self.engine) as session:
            self.assertEqual(session.exec(select(KnowledgeTemplate)).all(), [])

        with patch.object(knowledge_router, "process_knowledge_job_by_id") as process_job, patch.object(
            knowledge_router, "_index_background"
        ) as legacy_index:
            responses = [
                self.api.post(
                    "/knowledge/sources",
                    json={
                        "name": "Viewer source",
                        "source_type": "manual_upload",
                        "scope_type": "project",
                        "scope_id": self.project_id,
                    },
                ),
                self.api.post(
                    f"/knowledge/sources/{self.source_id}/documents",
                    files={"file": ("blocked.md", io.BytesIO(b"blocked"), "text/markdown")},
                ),
                self.api.post(f"/knowledge/sources/{self.source_id}/sync"),
                self.api.post(
                    f"/knowledge/sources/{self.source_id}/documents/{self.source_document_id}/reindex"
                ),
                self.api.delete(
                    f"/knowledge/sources/{self.source_id}/documents/{self.source_document_id}"
                ),
                self.api.post(f"/knowledge/jobs/{self.failed_job_id}/retry"),
                self.api.post(
                    f"/knowledge/documents?project_id={self.project_id}",
                    files={"file": ("blocked.txt", io.BytesIO(b"blocked"), "text/plain")},
                ),
                self.api.post(f"/knowledge/documents/{self.legacy_document_id}/reindex"),
                self.api.delete(f"/knowledge/documents/{self.legacy_document_id}"),
            ]
        self.assertEqual([response.status_code for response in responses], [403] * len(responses))
        process_job.assert_not_called()
        legacy_index.assert_not_called()
        with Session(self.engine) as session:
            self.assertIsNotNone(session.get(KnowledgeV1Document, self.source_document_id))
            self.assertIsNotNone(session.get(KnowledgeDocument, self.legacy_document_id))
            self.assertEqual(session.get(KnowledgeJob, self.failed_job_id).status, "failed")

    def test_project_editor_and_stable_client_creator_can_write(self) -> None:
        self._become("editor")
        project_source = self.api.post(
            "/knowledge/sources",
            json={
                "name": "Editor project source",
                "source_type": "manual_upload",
                "scope_type": "project",
                "scope_id": self.project_id,
            },
        )
        self.assertEqual(project_source.status_code, 201, project_source.text)
        stable_client_source = self.api.post(
            "/knowledge/sources",
            json={
                "name": "Editor client source",
                "source_type": "manual_upload",
                "scope_type": "client",
                "scope_id": self.client_id,
            },
        )
        self.assertEqual(stable_client_source.status_code, 201, stable_client_source.text)
        with Session(self.engine) as session:
            duplicate_name_client = ClientRecord(
                name="Stable Client",
                created_by_user_id=self.user_ids["viewer"],
            )
            session.add(duplicate_name_client)
            session.commit()
            session.refresh(duplicate_name_client)
            duplicate_name_client_id = int(duplicate_name_client.id)
        duplicate_client_source = self.api.post(
            "/knowledge/sources",
            json={
                "name": "Must not follow a duplicate name",
                "source_type": "manual_upload",
                "scope_type": "client",
                "scope_id": duplicate_name_client_id,
            },
        )
        self.assertEqual(duplicate_client_source.status_code, 403)
        self.assertEqual(
            self.api.post(
                "/knowledge/sources",
                json={
                    "name": "Blocked shared source",
                    "source_type": "manual_upload",
                    "scope_type": "workspace",
                },
            ).status_code,
            403,
        )

        self._become("creator")
        creator_source = self.api.post(
            "/knowledge/sources",
            json={
                "name": "Creator client source",
                "source_type": "manual_upload",
                "scope_type": "client",
                "scope_id": self.client_id,
            },
        )
        self.assertEqual(creator_source.status_code, 201, creator_source.text)

    def test_user_scope_owner_can_write_but_other_user_cannot(self) -> None:
        self._become("editor")
        created = self.api.post(
            "/knowledge/sources",
            json={
                "name": "Private source",
                "source_type": "manual_upload",
                "scope_type": "user",
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        source_id = int(created.json()["id"])
        with patch.object(knowledge_router, "process_knowledge_job_by_id"):
            self.assertEqual(
                self.api.post(f"/knowledge/sources/{source_id}/sync").status_code,
                202,
            )

        self._become("viewer")
        self.assertEqual(
            self.api.post(f"/knowledge/sources/{source_id}/sync").status_code,
            403,
        )

    def test_query_passes_explicit_project_and_client_visibility(self) -> None:
        self._become("creator")
        with patch.object(knowledge_router.rag, "retrieve", return_value="visible") as retrieve:
            response = self.api.post("/knowledge/query?query=client")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"context": "visible"})
        self.assertEqual(retrieve.call_args.kwargs["accessible_project_ids"], [])
        self.assertEqual(
            retrieve.call_args.kwargs["accessible_client_ids"],
            [self.client_id],
        )

        self._become("admin")
        with patch.object(knowledge_router.rag, "retrieve", return_value="all") as retrieve:
            response = self.api.post("/knowledge/query?query=all")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(retrieve.call_args.kwargs["accessible_project_ids"])
        self.assertIsNone(retrieve.call_args.kwargs["accessible_client_ids"])

    def test_document_helper_checks_existing_and_additional_client_scopes(self) -> None:
        with Session(self.engine) as session:
            editor = session.get(User, self.user_ids["editor"])
            allowed_target = ClientRecord(
                name="Allowed target",
                created_by_user_id=self.user_ids["editor"],
            )
            denied_target = ClientRecord(
                name="Denied target",
                created_by_user_id=self.user_ids["viewer"],
            )
            session.add(allowed_target)
            session.add(denied_target)
            session.commit()
            session.refresh(allowed_target)
            session.refresh(denied_target)
            allowed_target_id = int(allowed_target.id)
            denied_target_id = int(denied_target.id)

            document, actor = (
                knowledge_permissions.lock_and_require_legacy_document_write(
                    session,
                    self.legacy_document_id,
                    editor,
                    additional_client_ids=(allowed_target_id,),
                )
            )
            self.assertEqual(document.id, self.legacy_document_id)
            self.assertEqual(actor.id, self.user_ids["editor"])
            session.rollback()

        with Session(self.engine) as session:
            editor = session.get(User, self.user_ids["editor"])
            with self.assertRaises(HTTPException) as denied:
                knowledge_permissions.lock_and_require_legacy_document_write(
                    session,
                    self.legacy_document_id,
                    editor,
                    additional_client_ids=(denied_target_id,),
                )
            self.assertEqual(denied.exception.status_code, 403)

    def test_final_write_check_observes_membership_downgrade(self) -> None:
        self._become("editor")
        original = knowledge_permissions.lock_and_require_legacy_document_write

        def revoke_then_finalize(session: Session, document_id: int, user: User, **kwargs):
            member = session.exec(
                select(ProjectMember).where(ProjectMember.id == self.editor_member_id)
            ).one()
            member.role = "viewer"
            session.add(member)
            session.commit()
            return original(session, document_id, user, **kwargs)

        with patch.object(
            knowledge_router,
            "lock_and_require_legacy_document_write",
            side_effect=revoke_then_finalize,
        ), patch.object(knowledge_router, "_index_background") as index_background:
            response = self.api.post(
                f"/knowledge/documents/{self.legacy_document_id}/reindex"
            )

        self.assertEqual(response.status_code, 403, response.text)
        index_background.assert_not_called()
        with Session(self.engine) as session:
            document = session.get(KnowledgeDocument, self.legacy_document_id)
            self.assertEqual(document.vector_status, "failed")

    def test_source_final_write_check_observes_membership_downgrade(self) -> None:
        self._become("editor")
        original = knowledge_permissions.lock_and_require_source_document_write

        def revoke_then_finalize(
            session: Session,
            source_id: int,
            document_id: int,
            user: User,
        ):
            member = session.exec(
                select(ProjectMember).where(ProjectMember.id == self.editor_member_id)
            ).one()
            member.role = "viewer"
            session.add(member)
            session.commit()
            return original(session, source_id, document_id, user)

        with patch.object(
            knowledge_router,
            "lock_and_require_source_document_write",
            side_effect=revoke_then_finalize,
        ), patch.object(knowledge_router, "process_knowledge_job_by_id") as process_job:
            response = self.api.post(
                f"/knowledge/sources/{self.source_id}/documents/"
                f"{self.source_document_id}/reindex"
            )

        self.assertEqual(response.status_code, 403, response.text)
        process_job.assert_not_called()
        with Session(self.engine) as session:
            self.assertEqual(
                session.get(KnowledgeV1Document, self.source_document_id).status,
                "indexed",
            )

    def test_database_failure_does_not_delete_files(self) -> None:
        self._become("editor")
        source_path = self.uploads_dir / "knowledge" / "source.md"
        legacy_path = self.uploads_dir / "knowledge" / "legacy.txt"

        with patch.object(Session, "commit", side_effect=RuntimeError("commit failed")):
            source_response = self.api.delete(
                f"/knowledge/sources/{self.source_id}/documents/{self.source_document_id}"
            )
        self.assertEqual(source_response.status_code, 500)
        self.assertTrue(source_path.is_file())
        with Session(self.engine) as session:
            self.assertIsNotNone(session.get(KnowledgeV1Document, self.source_document_id))

        with patch.object(Session, "commit", side_effect=RuntimeError("commit failed")):
            legacy_response = self.api.delete(
                f"/knowledge/documents/{self.legacy_document_id}"
            )
        self.assertEqual(legacy_response.status_code, 500)
        self.assertTrue(legacy_path.is_file())
        with Session(self.engine) as session:
            self.assertIsNotNone(session.get(KnowledgeDocument, self.legacy_document_id))

    def test_storage_cleanup_failure_does_not_undo_database_delete(self) -> None:
        self._become("editor")
        with patch.object(
            StorageService,
            "delete",
            side_effect=RuntimeError("storage unavailable"),
        ):
            source_response = self.api.delete(
                f"/knowledge/sources/{self.source_id}/documents/{self.source_document_id}"
            )
            legacy_response = self.api.delete(
                f"/knowledge/documents/{self.legacy_document_id}"
            )

        self.assertEqual(source_response.status_code, 200, source_response.text)
        self.assertEqual(legacy_response.status_code, 200, legacy_response.text)
        with Session(self.engine) as session:
            self.assertIsNone(session.get(KnowledgeV1Document, self.source_document_id))
            self.assertIsNone(session.get(KnowledgeDocument, self.legacy_document_id))


if __name__ == "__main__":
    unittest.main()
