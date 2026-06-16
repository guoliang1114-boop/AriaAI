from __future__ import annotations

import json
import os
import uuid
from typing import Any

from sqlmodel import Session, select

from app.database import engine
from app.models.knowledge import KnowledgeJob, KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_ingestion import index_document, record_document_event, scan_source_files
from app.services.time_utils import utc_now_naive

REDIS_QUEUE_NAME = os.getenv("KNOWLEDGE_QUEUE_NAME", "aria:knowledge:jobs")


def _json(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _push_to_redis(job: KnowledgeJob) -> None:
    redis_url = os.getenv("REDIS_URL", "").strip()
    if not redis_url:
        return
    try:
        import redis

        client = redis.Redis.from_url(redis_url)
        client.lpush(REDIS_QUEUE_NAME, json.dumps({"job_id": job.id}))
    except Exception:
        # The database row is the durable source of truth; Redis is an optional
        # dispatch accelerator and must not make API enqueue fail.
        return


def enqueue_knowledge_job(
    session: Session,
    *,
    job_type: str,
    document_id: int | None = None,
    source_id: int | None = None,
    requested_by_user_id: int | None = None,
    payload: dict[str, Any] | None = None,
) -> KnowledgeJob:
    job = KnowledgeJob(
        job_type=job_type,
        status="queued",
        document_id=document_id,
        source_id=source_id,
        requested_by_user_id=requested_by_user_id,
        payload_json=json.dumps(payload or {}, ensure_ascii=False),
        trace_id=f"knowledge_{uuid.uuid4().hex}",
    )
    session.add(job)
    if document_id:
        doc = session.get(KnowledgeV1Document, document_id)
        if doc:
            doc.status = "queued"
            doc.updated_at = utc_now_naive()
            session.add(doc)
    session.commit()
    session.refresh(job)
    if document_id:
        record_document_event(session, document_id, "job_queued", "queued", metadata={"job_id": job.id, "job_type": job_type})
    _push_to_redis(job)
    return job


def process_knowledge_job(session: Session, job_id: int) -> KnowledgeJob | None:
    job = session.get(KnowledgeJob, job_id)
    if not job:
        return None
    if job.status not in {"queued", "retrying", "failed"}:
        return job
    job.status = "running"
    job.attempt += 1
    job.started_at = utc_now_naive()
    job.updated_at = utc_now_naive()
    session.add(job)
    session.commit()

    payload = _json(job.payload_json)
    try:
        if job.job_type in {"index_document", "extract_document", "embed_chunks"}:
            if job.document_id is None:
                raise ValueError("document_id is required")
            index_document(session, job.document_id, template_key=payload.get("template_key"))
        elif job.job_type == "extract_template":
            if job.document_id is None:
                raise ValueError("document_id is required")
            index_document(session, job.document_id, template_key=payload.get("template_key"))
        elif job.job_type == "sync_source":
            if job.source_id is None:
                raise ValueError("source_id is required")
            source = session.get(KnowledgeSource, job.source_id)
            if not source:
                raise ValueError("Knowledge source not found")
            source.status = "indexing"
            source.updated_at = utc_now_naive()
            session.add(source)
            session.commit()
            scanned_docs = scan_source_files(session, job.source_id)
            docs = session.exec(
                select(KnowledgeV1Document).where(
                    KnowledgeV1Document.source_id == job.source_id,
                    KnowledgeV1Document.status != "deleted",
                )
            ).all()
            for doc in docs:
                index_document(session, doc.id)
            source.status = "active"
            source.updated_at = utc_now_naive()
            session.add(source)
            session.commit()
            job.payload_json = json.dumps({**payload, "scanned_document_count": len(scanned_docs)}, ensure_ascii=False)
        else:
            raise ValueError(f"Unsupported knowledge job type: {job.job_type}")

        job.status = "completed"
        job.error_message = ""
        job.completed_at = utc_now_naive()
    except Exception as exc:
        job.error_message = str(exc)[:2000]
        job.status = "retrying" if job.attempt < job.max_attempts else "failed"
        if job.document_id:
            doc = session.get(KnowledgeV1Document, job.document_id)
            if doc:
                doc.status = "failed" if job.status == "failed" else "retrying"
                doc.error_message = job.error_message
                doc.updated_at = utc_now_naive()
                session.add(doc)
                record_document_event(session, doc.id, "job_failed", doc.status, message=job.error_message)
    job.updated_at = utc_now_naive()
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def process_knowledge_job_by_id(job_id: int, bind=None) -> None:
    with Session(bind or engine) as session:
        process_knowledge_job(session, job_id)


def run_pending_knowledge_jobs(session: Session, *, limit: int = 10) -> list[KnowledgeJob]:
    jobs = session.exec(
        select(KnowledgeJob)
        .where(KnowledgeJob.status.in_(["queued", "retrying"]))
        .order_by(KnowledgeJob.created_at.asc())
        .limit(limit)
    ).all()
    processed: list[KnowledgeJob] = []
    for job in jobs:
        next_job = process_knowledge_job(session, job.id)
        if next_job:
            processed.append(next_job)
    return processed


def index_knowledge_document_job(document_id: int, template_key: str | None = None) -> None:
    with Session(engine) as session:
        job = enqueue_knowledge_job(
            session,
            job_type="index_document",
            document_id=document_id,
            payload={"template_key": template_key} if template_key else {},
        )
        process_knowledge_job(session, job.id)
