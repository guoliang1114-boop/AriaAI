from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.jobs import knowledge_jobs
from app.models.db import KnowledgeDocument, Project, ProjectMember, User
from app.models.knowledge import (
    KnowledgeLegacyMigration,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.routers import knowledge as knowledge_router
from app.services import knowledge_ingestion, knowledge_migration
from app.services.knowledge_migration import build_legacy_migration_preview
from app.services.storage import StorageService


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _legacy_document(
    session: Session,
    root: Path,
    *,
    name: str,
    content: bytes | None,
    project_id: int | None = None,
) -> KnowledgeDocument:
    storage_key = f"knowledge/legacy/{name}"
    if content is not None:
        StorageService(root).put_bytes(storage_key, content)
    document = KnowledgeDocument(
        name=name,
        file_type=Path(name).suffix.lstrip("."),
        path=storage_key,
        category="methodology",
        vector_status="synced",
        project_id=project_id,
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


def test_preview_freezes_content_and_reports_blocked_files_without_paths() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir, Session(engine) as session:
        root = Path(temp_dir)
        ready = _legacy_document(
            session,
            root,
            name="playbook.md",
            content=b"# Playbook\nCustomer strategy",
        )
        _legacy_document(session, root, name="missing.pdf", content=None)

        first = build_legacy_migration_preview(session, uploads_root=root)
        assert first["ready"] == 1
        assert first["blocked"] == 1
        assert first["migrated"] == 0
        ready_item = next(item for item in first["items"] if item["legacy_document_id"] == ready.id)
        assert ready_item["state"] == "ready"
        assert "path" not in ready_item
        assert "Customer strategy" not in json.dumps(first)

        StorageService(root).put_bytes(ready.path, b"# Changed\nNew content")
        second = build_legacy_migration_preview(session, uploads_root=root)
        assert second["plan_hash"] != first["plan_hash"]
        assert second["ready_plans"][0]["snapshot_hash"] != first["ready_plans"][0]["snapshot_hash"]
    engine.dispose()


def test_durable_migration_preserves_legacy_rows_and_deduplicates_v1_content() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        with Session(engine) as session:
            content = b"# Durable migration\nReusable consulting method"
            first = _legacy_document(session, root, name="method-a.md", content=content)
            second = _legacy_document(session, root, name="method-b.md", content=content)
            preview = build_legacy_migration_preview(session, uploads_root=root)
            job = knowledge_jobs.enqueue_knowledge_job(
                session,
                job_type="migrate_legacy_knowledge",
                requested_by_user_id=1,
                payload={
                    "migration_version": preview["version"],
                    "plan_hash": preview["plan_hash"],
                    "planned_documents": preview["ready_plans"],
                },
            )

            with patch.object(knowledge_migration, "UPLOADS_DIR", root), patch.object(
                knowledge_ingestion,
                "UPLOADS_DIR",
                root,
            ):
                completed = knowledge_jobs.process_knowledge_job(session, int(job.id))

            assert completed is not None and completed.status == "completed"
            assert session.get(KnowledgeDocument, first.id) is not None
            assert session.get(KnowledgeDocument, second.id) is not None
            mappings = session.exec(
                select(KnowledgeLegacyMigration).order_by(
                    KnowledgeLegacyMigration.legacy_document_id.asc()
                )
            ).all()
            assert len(mappings) == 2
            assert {mapping.status for mapping in mappings} == {"completed"}
            assert len({mapping.document_id for mapping in mappings}) == 1
            assert len(session.exec(select(KnowledgeV1Document)).all()) == 1
            sources = session.exec(select(KnowledgeSource)).all()
            assert len(sources) == 1
            assert sources[0].external_key == "legacy-knowledge-v1:workspace:workspace"
            migrated = session.get(KnowledgeV1Document, mappings[0].document_id)
            assert migrated is not None and migrated.status == "indexed"
            assert StorageService(root).exists(migrated.original_storage_key)
            safe_status = knowledge_jobs.knowledge_job_to_dict(completed)
            assert "planned_documents" not in json.dumps(safe_status)
            assert safe_status["checkpoint"]["migrated_document_count"] == 2
    engine.dispose()


def test_changed_document_fails_closed_and_can_be_repreviewed() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        with Session(engine) as session:
            legacy = _legacy_document(
                session,
                root,
                name="changing.md",
                content=b"# Original",
            )
            preview = build_legacy_migration_preview(session, uploads_root=root)
            StorageService(root).put_bytes(legacy.path, b"# Changed after preview")
            job = knowledge_jobs.enqueue_knowledge_job(
                session,
                job_type="migrate_legacy_knowledge",
                payload={
                    "migration_version": preview["version"],
                    "plan_hash": preview["plan_hash"],
                    "planned_documents": preview["ready_plans"],
                },
            )
            with patch.object(knowledge_migration, "UPLOADS_DIR", root), patch.object(
                knowledge_ingestion,
                "UPLOADS_DIR",
                root,
            ):
                failed = knowledge_jobs.process_knowledge_job(session, int(job.id))

            assert failed is not None and failed.status == "failed"
            assert failed.failure_code == "migration_items_failed"
            mapping = session.exec(select(KnowledgeLegacyMigration)).one()
            assert mapping.error_code == "migration_plan_stale"
            assert mapping.document_id is None
            assert session.get(KnowledgeDocument, legacy.id) is not None
            assert build_legacy_migration_preview(session, uploads_root=root)["ready"] == 1
    engine.dispose()


def test_admin_api_executes_migration_and_never_exposes_job_plan() -> None:
    engine = _engine()
    temp_dir = tempfile.TemporaryDirectory()
    root = Path(temp_dir.name)
    with Session(engine) as session:
        admin = User(email="admin@example.com", password_hash="x", is_admin=True, is_active=True)
        member = User(email="member@example.com", password_hash="x", is_admin=False, is_active=True)
        session.add(admin)
        session.add(member)
        session.commit()
        session.refresh(admin)
        session.refresh(member)
        admin_id = int(admin.id)
        member_id = int(member.id)
        legacy = _legacy_document(
            session,
            root,
            name="api-migration.md",
            content=b"# API migration\nControlled plan",
        )
        legacy_id = int(legacy.id)

    current_user_id = {"value": member_id}
    app = FastAPI()
    app.include_router(knowledge_router.router)

    def override_session():
        with Session(engine) as session:
            yield session

    def override_user():
        with Session(engine) as session:
            return session.get(User, current_user_id["value"])

    app.dependency_overrides[knowledge_router.get_session] = override_session
    app.dependency_overrides[knowledge_router.get_current_user] = override_user
    client = TestClient(app, raise_server_exceptions=False)

    with patch.object(knowledge_router, "UPLOADS_DIR", root), patch.object(
        knowledge_migration,
        "UPLOADS_DIR",
        root,
    ), patch.object(knowledge_ingestion, "UPLOADS_DIR", root):
        assert client.get("/knowledge/migrations/legacy/preview").status_code == 403
        current_user_id["value"] = admin_id
        preview_response = client.get("/knowledge/migrations/legacy/preview")
        assert preview_response.status_code == 200, preview_response.text
        preview = preview_response.json()
        assert preview["ready"] == 1
        assert "ready_plans" not in preview

        execute_response = client.post(
            "/knowledge/migrations/legacy",
            json={"plan_hash": preview["plan_hash"], "batch_size": 100},
        )
        assert execute_response.status_code == 202, execute_response.text
        job_id = execute_response.json()["job_id"]
        status_response = client.get(f"/knowledge/jobs/{job_id}")
        assert status_response.status_code == 200
        assert status_response.json()["status"] == "completed"
        assert "planned_documents" not in status_response.text

        sources = client.get("/knowledge/sources").json()
        documents = client.get(f"/knowledge/sources/{sources[0]['id']}/documents").json()
        assert documents[0]["legacy_document_id"] == legacy_id
        assert documents[0]["status"] == "indexed"

    engine.dispose()
    temp_dir.cleanup()


def test_legacy_management_endpoints_apply_project_membership() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        with Session(engine) as session:
            member = User(email="project-member@example.com", password_hash="x", is_active=True)
            outsider = User(email="outsider@example.com", password_hash="x", is_active=True)
            session.add(member)
            session.add(outsider)
            session.commit()
            session.refresh(member)
            session.refresh(outsider)
            project = Project(name="Restricted", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            session.add(ProjectMember(project_id=int(project.id), user_id=int(member.id)))
            session.commit()
            restricted = _legacy_document(
                session,
                root,
                name="restricted.md",
                content=b"Restricted project knowledge",
                project_id=int(project.id),
            )
            member_id = int(member.id)
            outsider_id = int(outsider.id)
            restricted_id = int(restricted.id)

        current_user_id = {"value": outsider_id}
        app = FastAPI()
        app.include_router(knowledge_router.router)

        def override_session():
            with Session(engine) as session:
                yield session

        def override_user():
            with Session(engine) as session:
                return session.get(User, current_user_id["value"])

        app.dependency_overrides[knowledge_router.get_session] = override_session
        app.dependency_overrides[knowledge_router.get_current_user] = override_user
        client = TestClient(app, raise_server_exceptions=False)
        assert client.get("/knowledge/documents").json() == []
        assert client.delete(f"/knowledge/documents/{restricted_id}").status_code == 403
        current_user_id["value"] = member_id
        visible = client.get("/knowledge/documents").json()
        assert [item["id"] for item in visible] == [restricted_id]
    engine.dispose()
