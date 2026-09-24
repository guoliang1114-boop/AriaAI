from __future__ import annotations

import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from sqlmodel import Session, select

from app.jobs import knowledge_jobs
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeDocumentEvent,
    KnowledgeJob,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.services import knowledge_ingestion
from app.services.knowledge_ingestion import create_document_from_bytes, sha256_bytes
from app.services.storage import StorageService
from app.services.time_utils import utc_now_naive
from tests.test_knowledge_job_recovery import _engine

SECTIONS = b"# One\nFirst section.\n# Two\nSecond section.\n# Three\nThird section."


def _document(session: Session, root: Path) -> tuple[KnowledgeSource, KnowledgeV1Document]:
    source = KnowledgeSource(name="Lease source", source_type="manual_upload", scope_type="workspace")
    session.add(source)
    session.commit()
    session.refresh(source)
    storage_key = f"knowledge/originals/source-{source.id}/{sha256_bytes(SECTIONS)}.md"
    StorageService(root).put_bytes(storage_key, SECTIONS)
    document = create_document_from_bytes(
        session=session,
        source=source,
        file_name="lease.md",
        content=SECTIONS,
        relative_path=storage_key,
    )
    return source, document


def _enqueue(session: Session, source, document, **kwargs) -> KnowledgeJob:
    return knowledge_jobs.enqueue_knowledge_job(
        session,
        job_type="index_document",
        document_id=document.id,
        source_id=source.id,
        trusted_system=True,
        **kwargs,
    )


def _chunk_ids(session: Session, document_id: int) -> list[int]:
    return [
        int(chunk.id)
        for chunk in session.exec(
            select(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)
        ).all()
    ]


def _events(session: Session, document_id: int) -> list[KnowledgeDocumentEvent]:
    return list(
        session.exec(
            select(KnowledgeDocumentEvent)
            .where(KnowledgeDocumentEvent.document_id == document_id)
            .order_by(KnowledgeDocumentEvent.id)
        ).all()
    )


def test_embedding_batches_renew_the_job_lease() -> None:
    engine = _engine()
    real_embed = knowledge_ingestion.embed_texts
    leases = []

    def observed_embed(texts, **kwargs):
        with Session(engine) as probe:
            leases.append(probe.exec(select(KnowledgeJob)).one().lease_expires_at)
        return real_embed(texts, **kwargs)

    with tempfile.TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion, "UPLOADS_DIR", Path(temp_dir)
    ), patch.object(knowledge_ingestion, "EMBEDDING_HEARTBEAT_BATCH_SIZE", 1), patch.object(
        knowledge_ingestion, "embed_texts", side_effect=observed_embed
    ):
        with Session(engine) as session:
            source, document = _document(session, Path(temp_dir))
            job = _enqueue(session, source, document)
            completed = knowledge_jobs.process_knowledge_job(session, int(job.id))

            assert completed is not None and completed.status == "completed"
            assert len(leases) == 3
            assert leases[0] < leases[1] < leases[2]
            assert len(_chunk_ids(session, int(document.id))) == 3
    engine.dispose()


def test_superseded_attempt_stops_at_next_heartbeat_without_writing() -> None:
    engine = _engine()
    real_embed = knowledge_ingestion.embed_texts
    calls = []

    def supersede_after_first_batch(texts, **kwargs):
        calls.append(len(texts))
        if len(calls) == 2:
            with Session(engine) as other_worker:
                job = other_worker.exec(select(KnowledgeJob)).one()
                job.lease_token = "reclaimed-by-another-worker"
                other_worker.add(job)
                other_worker.commit()
        return real_embed(texts, **kwargs)

    with tempfile.TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion, "UPLOADS_DIR", Path(temp_dir)
    ), patch.object(knowledge_ingestion, "EMBEDDING_HEARTBEAT_BATCH_SIZE", 1), patch.object(
        knowledge_ingestion, "embed_texts", side_effect=supersede_after_first_batch
    ):
        with Session(engine) as session:
            source, document = _document(session, Path(temp_dir))
            job = _enqueue(session, source, document)
            result = knowledge_jobs.process_knowledge_job(session, int(job.id))

            assert len(calls) == 2
            assert result is not None and result.status == "running"
            assert result.lease_token == "reclaimed-by-another-worker"
            assert _chunk_ids(session, int(document.id)) == []
    engine.dispose()


def test_failed_reindex_keeps_indexed_document_searchable() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion, "UPLOADS_DIR", Path(temp_dir)
    ):
        with Session(engine) as session:
            source, document = _document(session, Path(temp_dir))
            first = _enqueue(session, source, document)
            assert knowledge_jobs.process_knowledge_job(session, int(first.id)).status == "completed"
            committed_chunks = _chunk_ids(session, int(document.id))
            indexed_at = session.get(KnowledgeV1Document, document.id).updated_at

            reindex = _enqueue(session, source, document, force_new=True, max_attempts=1)
            pending = session.get(KnowledgeV1Document, document.id)
            assert pending.status == "indexed"
            assert pending.updated_at == indexed_at

            with patch.object(knowledge_jobs, "index_document", side_effect=TimeoutError("embedding busy")):
                failed = knowledge_jobs.process_knowledge_job(session, int(reindex.id))

            assert failed is not None and failed.status == "failed"
            current = session.get(KnowledgeV1Document, document.id)
            assert current.status == "indexed"
            assert current.error_message is None
            assert _chunk_ids(session, int(document.id)) == committed_chunks
            last = _events(session, int(document.id))[-1]
            assert last.event_type == "job_failed"
            assert json.loads(last.metadata_json)["committed_index_preserved"] is True

            restarted = knowledge_jobs.retry_knowledge_job(session, int(reindex.id))
            assert restarted.status == "queued"
            assert session.get(KnowledgeV1Document, document.id).status == "indexed"
    engine.dispose()


def test_retry_limit_preserves_indexed_document_and_fails_unindexed_one() -> None:
    engine = _engine()
    with tempfile.TemporaryDirectory() as temp_dir, patch.object(
        knowledge_ingestion, "UPLOADS_DIR", Path(temp_dir)
    ):
        with Session(engine) as session:
            source, document = _document(session, Path(temp_dir))
            job = _enqueue(session, source, document, max_attempts=2)
            assert session.get(KnowledgeV1Document, document.id).status == "queued"

            def exhaust(target: KnowledgeJob) -> None:
                target.status = "running"
                target.attempt = target.max_attempts
                target.lease_token = "expired-worker"
                target.lease_expires_at = utc_now_naive() - timedelta(seconds=1)
                session.add(target)
                session.commit()

            exhaust(job)
            [failed] = knowledge_jobs.run_pending_knowledge_jobs(session)
            assert failed.failure_code == "retry_limit_reached"
            unindexed = session.get(KnowledgeV1Document, document.id)
            assert unindexed.status == "failed"
            assert unindexed.error_message == "Knowledge ingestion retry limit reached."
            assert _events(session, int(document.id))[-1].event_type == "job_failed"

            first = _enqueue(session, source, document, force_new=True)
            assert knowledge_jobs.process_knowledge_job(session, int(first.id)).status == "completed"
            committed_chunks = _chunk_ids(session, int(document.id))
            reindex = _enqueue(session, source, document, force_new=True, max_attempts=2)
            exhaust(reindex)
            [failed_reindex] = knowledge_jobs.run_pending_knowledge_jobs(session)

            assert failed_reindex.failure_code == "retry_limit_reached"
            assert session.get(KnowledgeV1Document, document.id).status == "indexed"
            assert _chunk_ids(session, int(document.id)) == committed_chunks
    engine.dispose()
