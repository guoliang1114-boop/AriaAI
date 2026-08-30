from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.jobs import knowledge_jobs
from app.models.db import (
    ClientRecord,
    DocumentChunk,
    KnowledgeDocument,
    Project,
    ProjectMember,
    User,
)
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeDocumentEvent,
    KnowledgeSource,
    KnowledgeTemplateExtraction,
    KnowledgeV1Document,
)
from app.routers import knowledge as knowledge_router
from app.services import knowledge_ingestion, rag
from app.services.knowledge_ingestion import create_document_from_bytes, sha256_bytes
from app.services.storage import StorageService


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _project_scope(
    session: Session,
    *,
    actor_role: str | None = "owner",
) -> tuple[User, Project, ClientRecord]:
    actor = User(
        email=f"knowledge-actor-{actor_role or 'none'}@example.com",
        password_hash="x",
        is_active=True,
    )
    session.add(actor)
    session.flush()
    client = ClientRecord(
        name="Knowledge ACL Client",
        created_by_user_id=None,
    )
    session.add(client)
    session.flush()
    project = Project(
        name="Knowledge ACL Project",
        client=client.name,
        client_id=int(client.id),
    )
    session.add(project)
    session.flush()
    if actor_role is not None:
        session.add(
            ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role=actor_role,
            )
        )
    session.commit()
    session.refresh(actor)
    session.refresh(project)
    session.refresh(client)
    return actor, project, client


def _v1_job(
    session: Session,
    root: Path,
    *,
    actor: User,
    project: Project,
    max_attempts: int = 3,
):
    source = KnowledgeSource(
        name="Actor-aware source",
        source_type="manual_upload",
        scope_type="project",
        scope_id=int(project.id),
        owner_user_id=int(actor.id),
    )
    session.add(source)
    session.commit()
    session.refresh(source)
    content = b"# Actor-aware knowledge\nProvider-safe indexing content."
    storage_key = (
        f"knowledge/originals/source-{source.id}/{sha256_bytes(content)}.md"
    )
    StorageService(root).put_bytes(storage_key, content)
    document = create_document_from_bytes(
        session=session,
        source=source,
        file_name="actor-aware.md",
        content=content,
        relative_path=storage_key,
    )
    job = knowledge_jobs.enqueue_knowledge_job(
        session,
        job_type="index_document",
        source_id=int(source.id),
        document_id=int(document.id),
        requested_by_user_id=int(actor.id),
        max_attempts=max_attempts,
    )
    return source, document, job


def _deactivate(engine, user_id: int) -> None:
    with Session(engine) as revoke:
        actor = revoke.get(User, user_id)
        assert actor is not None
        actor.is_active = False
        revoke.add(actor)
        revoke.commit()


def test_v1_embedding_success_after_revocation_has_no_persistent_side_effects() -> None:
    engine = _engine()
    with TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion,
        "UPLOADS_DIR",
        Path(temp_dir),
    ):
        with Session(engine) as session:
            actor, project, _ = _project_scope(session)
            _, document, job = _v1_job(
                session,
                Path(temp_dir),
                actor=actor,
                project=project,
            )
            baseline_events = len(
                session.exec(
                    select(KnowledgeDocumentEvent).where(
                        KnowledgeDocumentEvent.document_id == document.id
                    )
                ).all()
            )
            original_embedding = knowledge_ingestion.deterministic_embedding

            def revoke_then_embed(text: str, dimensions: int = 1536):
                _deactivate(engine, int(actor.id))
                return original_embedding(text, dimensions)

            with patch.object(
                knowledge_ingestion,
                "deterministic_embedding",
                side_effect=revoke_then_embed,
            ):
                result = knowledge_jobs.process_knowledge_job(session, int(job.id))

            session.expire_all()
            current_job = session.get(type(job), int(job.id))
            current_document = session.get(KnowledgeV1Document, int(document.id))
            assert result is not None and current_job is not None
            assert current_job.status == "running"
            assert current_job.failure_code == ""
            assert current_job.error_message == ""
            assert json.loads(current_job.checkpoint_json)["phase"] == "queued"
            assert current_document is not None and current_document.status == "queued"
            assert current_document.metadata_json == "{}"
            assert session.exec(
                select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
            ).all() == []
            assert session.exec(
                select(KnowledgeTemplateExtraction).where(
                    KnowledgeTemplateExtraction.document_id == document.id
                )
            ).all() == []
            assert len(
                session.exec(
                    select(KnowledgeDocumentEvent).where(
                        KnowledgeDocumentEvent.document_id == document.id
                    )
                ).all()
            ) == baseline_events
    engine.dispose()


def test_v1_embedding_failure_after_revocation_writes_no_failure_receipt() -> None:
    engine = _engine()
    with TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion,
        "UPLOADS_DIR",
        Path(temp_dir),
    ):
        with Session(engine) as session:
            actor, project, _ = _project_scope(session)
            _, document, job = _v1_job(
                session,
                Path(temp_dir),
                actor=actor,
                project=project,
                max_attempts=1,
            )
            baseline_events = len(
                session.exec(
                    select(KnowledgeDocumentEvent).where(
                        KnowledgeDocumentEvent.document_id == document.id
                    )
                ).all()
            )

            def revoke_then_fail(*_args, **_kwargs):
                _deactivate(engine, int(actor.id))
                raise TimeoutError("embedding provider timed out")

            with patch.object(
                knowledge_ingestion,
                "deterministic_embedding",
                side_effect=revoke_then_fail,
            ):
                knowledge_jobs.process_knowledge_job(session, int(job.id))

            session.expire_all()
            current_job = session.get(type(job), int(job.id))
            current_document = session.get(KnowledgeV1Document, int(document.id))
            assert current_job is not None and current_job.status == "running"
            assert current_job.failure_code == ""
            assert current_job.error_message == ""
            assert current_document is not None and current_document.status == "queued"
            assert current_document.error_message is None
            assert session.exec(
                select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
            ).all() == []
            assert len(
                session.exec(
                    select(KnowledgeDocumentEvent).where(
                        KnowledgeDocumentEvent.document_id == document.id
                    )
                ).all()
            ) == baseline_events
    engine.dispose()


def test_v1_embedding_failure_with_active_actor_records_atomic_receipt() -> None:
    engine = _engine()
    with TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion,
        "UPLOADS_DIR",
        Path(temp_dir),
    ):
        with Session(engine) as session:
            actor, project, _ = _project_scope(session)
            _, document, job = _v1_job(
                session,
                Path(temp_dir),
                actor=actor,
                project=project,
                max_attempts=1,
            )
            with patch.object(
                knowledge_ingestion,
                "deterministic_embedding",
                side_effect=TimeoutError("embedding provider timed out"),
            ):
                result = knowledge_jobs.process_knowledge_job(session, int(job.id))

            session.expire_all()
            current_document = session.get(KnowledgeV1Document, int(document.id))
            assert result is not None and result.status == "failed"
            assert result.failure_code == "transient_io_error"
            assert current_document is not None and current_document.status == "failed"
            assert current_document.error_message
            events = session.exec(
                select(KnowledgeDocumentEvent).where(
                    KnowledgeDocumentEvent.document_id == document.id,
                    KnowledgeDocumentEvent.event_type == "job_failed",
                )
            ).all()
            assert len(events) == 1
            assert session.exec(
                select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
            ).all() == []
    engine.dispose()


def test_project_scope_does_not_inherit_other_project_access_from_same_client() -> None:
    engine = _engine()
    with TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion,
        "UPLOADS_DIR",
        Path(temp_dir),
    ):
        with Session(engine) as session:
            actor, target_project, client = _project_scope(session, actor_role="owner")
            _, document, job = _v1_job(
                session,
                Path(temp_dir),
                actor=actor,
                project=target_project,
            )
            target_membership = session.exec(
                select(ProjectMember).where(
                    ProjectMember.project_id == target_project.id,
                    ProjectMember.user_id == actor.id,
                )
            ).one()
            session.delete(target_membership)
            other_project = Project(
                name="Other project for same client",
                client=client.name,
                client_id=int(client.id),
            )
            session.add(other_project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(other_project.id),
                    user_id=int(actor.id),
                    role="editor",
                )
            )
            session.commit()

            with patch.object(
                knowledge_ingestion,
                "deterministic_embedding",
                side_effect=AssertionError("unauthorized job reached embedding"),
            ):
                result = knowledge_jobs.process_knowledge_job(session, int(job.id))

            session.expire_all()
            assert result is not None and result.status == "queued"
            assert session.get(KnowledgeV1Document, int(document.id)).status == "queued"
            assert session.exec(
                select(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
            ).all() == []
    engine.dispose()


def test_active_job_deduplication_still_requires_current_write_access() -> None:
    engine = _engine()
    with TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion,
        "UPLOADS_DIR",
        Path(temp_dir),
    ):
        with Session(engine) as session:
            actor, project, _ = _project_scope(session)
            source, document, active_job = _v1_job(
                session,
                Path(temp_dir),
                actor=actor,
                project=project,
            )
            membership = session.exec(
                select(ProjectMember).where(
                    ProjectMember.project_id == project.id,
                    ProjectMember.user_id == actor.id,
                )
            ).one()
            membership.role = "viewer"
            session.add(membership)
            session.commit()

            with pytest.raises(HTTPException) as exc_info:
                knowledge_jobs.enqueue_knowledge_job(
                    session,
                    job_type="index_document",
                    source_id=int(source.id),
                    document_id=int(document.id),
                    requested_by_user_id=int(actor.id),
                )

            assert exc_info.value.status_code == 403
            assert session.get(type(active_job), int(active_job.id)).status == "queued"
    engine.dispose()


def test_legacy_embedding_revocation_discards_chunks_and_failure_receipt() -> None:
    engine = _engine()
    with Session(engine) as session:
        actor, project, client = _project_scope(session)
        document = KnowledgeDocument(
            name="legacy.md",
            file_type="md",
            path="knowledge/legacy/legacy.md",
            project_id=int(project.id),
            client_id=int(client.id),
            vector_status="pending",
            vector_progress=0.0,
        )
        session.add(document)
        session.commit()
        session.refresh(document)
        actor_id = int(actor.id)
        document_id = int(document.id)

    def revoke_then_embed(chunks):
        _deactivate(engine, actor_id)
        return [[1.0, 0.0] for _ in chunks]

    with patch.object(knowledge_router, "engine", engine), patch.object(
        knowledge_router.parser,
        "extract_text",
        return_value="Legacy provider content",
    ), patch.object(rag, "embed_texts", side_effect=revoke_then_embed):
        knowledge_router._index_background(
            document_id,
            "/tmp/legacy.md",
            actor_id,
        )

    with Session(engine) as verify:
        document = verify.get(KnowledgeDocument, document_id)
        assert document is not None and document.vector_status == "pending"
        assert document.vector_progress == 0.0
        assert verify.exec(
            select(DocumentChunk).where(DocumentChunk.document_id == document_id)
        ).all() == []
    engine.dispose()
