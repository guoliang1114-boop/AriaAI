from __future__ import annotations

import io
import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.jobs import knowledge_jobs
from app.models.db import User
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeJob,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.routers import knowledge as knowledge_router
from app.services import knowledge_ingestion
from app.services.knowledge_ingestion import create_document_from_bytes, sha256_bytes
from app.services.storage import StorageService
from app.services.time_utils import utc_now_naive


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _source_and_document(session: Session, root: Path) -> tuple[KnowledgeSource, KnowledgeV1Document]:
    source = KnowledgeSource(
        name="Recovery source",
        source_type="manual_upload",
        scope_type="workspace",
    )
    session.add(source)
    session.commit()
    session.refresh(source)
    content = b"# Recovery\nDurable knowledge ingestion checkpoint."
    storage_key = f"knowledge/originals/source-{source.id}/{sha256_bytes(content)}.md"
    StorageService(root).put_bytes(storage_key, content)
    document = create_document_from_bytes(
        session=session,
        source=source,
        file_name="recovery.md",
        content=content,
        relative_path=storage_key,
    )
    return source, document


def test_document_job_is_idempotent_and_persists_safe_checkpoints() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion,
        "UPLOADS_DIR",
        Path(temp_dir),
    ):
        with Session(engine) as session:
            source, document = _source_and_document(session, Path(temp_dir))
            first = knowledge_jobs.enqueue_knowledge_job(
                session,
                job_type="index_document",
                document_id=document.id,
                source_id=source.id,
            )
            duplicate = knowledge_jobs.enqueue_knowledge_job(
                session,
                job_type="index_document",
                document_id=document.id,
                source_id=source.id,
            )
            assert duplicate.id == first.id

            completed = knowledge_jobs.process_knowledge_job(session, int(first.id))

            assert completed is not None
            assert completed.status == "completed"
            assert completed.attempt == 1
            checkpoint = json.loads(completed.checkpoint_json)
            assert checkpoint["phase"] == "completed"
            assert checkpoint["chunk_count"] == 1
            assert "Durable knowledge" not in completed.checkpoint_json
            indexed = session.get(KnowledgeV1Document, document.id)
            assert indexed is not None and indexed.status == "indexed"
            assert len(
                session.exec(
                    select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
                ).all()
            ) == 1
    engine.dispose()


def test_transient_failure_schedules_retry_and_manual_restart_keeps_checkpoint() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir:
        with Session(engine) as session:
            source, document = _source_and_document(session, Path(temp_dir))
            job = knowledge_jobs.enqueue_knowledge_job(
                session,
                job_type="index_document",
                document_id=document.id,
                source_id=source.id,
                max_attempts=1,
            )
            with patch.object(knowledge_jobs, "index_document", side_effect=TimeoutError("storage busy")):
                failed = knowledge_jobs.process_knowledge_job(session, int(job.id))

            assert failed is not None
            assert failed.status == "failed"
            assert failed.failure_code == "transient_io_error"
            assert failed.retryable is True
            assert failed.completed_at is not None

            restarted = knowledge_jobs.retry_knowledge_job(session, int(job.id))
            assert restarted.status == "queued"
            assert restarted.attempt == 0
            assert json.loads(restarted.checkpoint_json)["manual_retry_count"] == 1

            def succeed(_session, document_id, **_kwargs):
                current = _session.get(KnowledgeV1Document, document_id)
                current.status = "indexed"
                _session.add(current)
                _session.commit()
                return current

            with patch.object(knowledge_jobs, "index_document", side_effect=succeed):
                completed = knowledge_jobs.process_knowledge_job(session, int(job.id))
            assert completed is not None and completed.status == "completed"
            assert completed.attempt == 1
    engine.dispose()


def test_expired_worker_lease_is_reclaimed_but_live_lease_is_not() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir:
        with Session(engine) as session:
            source, document = _source_and_document(session, Path(temp_dir))
            job = knowledge_jobs.enqueue_knowledge_job(
                session,
                job_type="index_document",
                document_id=document.id,
                source_id=source.id,
            )
            job.status = "running"
            job.attempt = 1
            job.lease_token = "expired-worker"
            job.lease_expires_at = utc_now_naive() - timedelta(seconds=1)
            session.add(job)
            session.commit()

            def succeed(_session, document_id, **_kwargs):
                current = _session.get(KnowledgeV1Document, document_id)
                current.status = "indexed"
                _session.add(current)
                _session.commit()
                return current

            with patch.object(knowledge_jobs, "index_document", side_effect=succeed):
                processed = knowledge_jobs.run_pending_knowledge_jobs(session)
            assert len(processed) == 1
            assert processed[0].status == "completed"
            assert processed[0].attempt == 2

            second = knowledge_jobs.enqueue_knowledge_job(
                session,
                job_type="index_document",
                document_id=document.id,
                source_id=source.id,
                force_new=True,
            )
            second.status = "running"
            second.lease_token = "live-worker"
            second.lease_expires_at = utc_now_naive() + timedelta(minutes=2)
            session.add(second)
            session.commit()
            assert knowledge_jobs.run_pending_knowledge_jobs(session) == []
    engine.dispose()


def test_permanent_job_failure_is_not_automatically_retried() -> None:
    engine = _engine()
    with Session(engine) as session:
        job = knowledge_jobs.enqueue_knowledge_job(
            session,
            job_type="unsupported",
        )
        failed = knowledge_jobs.process_knowledge_job(session, int(job.id))
        assert failed is not None
        assert failed.status == "failed"
        assert failed.failure_code == "unsupported_job_type"
        assert failed.retryable is False
        assert failed.next_attempt_at is None
    engine.dispose()


def test_v005_api_exposes_durable_status_without_job_payload_or_document_text() -> None:
    engine = _engine()
    temp_dir = tempfile.TemporaryDirectory()
    uploads_dir = Path(temp_dir.name) / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    with Session(engine) as session:
        user = User(
            email="knowledge-admin@example.com",
            password_hash="x",
            is_admin=True,
            is_active=True,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        user_id = int(user.id)

    app = FastAPI()
    app.include_router(knowledge_router.router)

    def override_session():
        with Session(engine) as session:
            yield session

    def override_user():
        with Session(engine) as session:
            return session.get(User, user_id)

    app.dependency_overrides[knowledge_router.get_session] = override_session
    app.dependency_overrides[knowledge_router.get_current_user] = override_user
    app.dependency_overrides[knowledge_router.require_admin] = override_user
    client = TestClient(app, raise_server_exceptions=False)
    retrieved_text = "Private ingestion text must not enter job status."

    with patch.object(knowledge_router, "UPLOADS_DIR", uploads_dir), patch.object(
        knowledge_ingestion,
        "UPLOADS_DIR",
        uploads_dir,
    ):
        source_response = client.post(
            "/knowledge/sources",
            json={
                "name": "API recovery source",
                "source_type": "manual_upload",
                "scope_type": "workspace",
            },
        )
        assert source_response.status_code == 201, source_response.text
        source_id = source_response.json()["id"]
        upload_response = client.post(
            f"/knowledge/sources/{source_id}/documents",
            files={
                "file": (
                    "private.md",
                    io.BytesIO(f"# Private\n{retrieved_text}".encode()),
                    "text/markdown",
                )
            },
        )
        assert upload_response.status_code == 201, upload_response.text
        document_id = upload_response.json()["id"]
        job_id = upload_response.json()["job_id"]

        job_response = client.get(f"/knowledge/jobs/{job_id}")
        assert job_response.status_code == 200, job_response.text
        job_payload = job_response.json()
        assert job_payload["status"] == "completed"
        assert job_payload["checkpoint"]["phase"] == "completed"
        assert "payload_json" not in job_payload
        assert "checkpoint_json" not in job_payload
        assert retrieved_text not in json.dumps(job_payload)

        documents = client.get(f"/knowledge/sources/{source_id}/documents")
        assert documents.status_code == 200
        assert documents.json()[0]["status"] == "indexed"
        assert documents.json()[0]["latest_job"]["status"] == "completed"
        events = client.get(f"/knowledge/documents/{document_id}/events")
        assert events.status_code == 200
        assert "index_completed" in {event["event_type"] for event in events.json()}
        search = client.post(
            "/knowledge/search",
            json={"query": "Private ingestion", "scope_types": ["workspace"], "top_k": 5},
        )
        assert search.status_code == 200, search.text
        assert search.json()["total_found"] >= 1

    engine.dispose()
    temp_dir.cleanup()
