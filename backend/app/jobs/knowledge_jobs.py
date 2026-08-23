"""Durable, resumable knowledge-ingestion jobs owned by AriaAI.

The semantic failure categories and bounded exponential retry policy are adapted
from OpenAI Codex ``codex-rs/protocol/src/error.rs`` and
``codex-rs/core/src/util.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-23: jobs are PostgreSQL-backed Aria business
objects with idempotency keys, worker leases, privacy-safe checkpoints,
deterministic retry scheduling, source/document permission ownership, and
manual recovery. No Codex runtime, protocol, process, account, or API is used.
"""
from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.config import (
    KNOWLEDGE_JOB_LEASE_SECONDS,
    KNOWLEDGE_JOB_MAX_ATTEMPTS,
    KNOWLEDGE_JOB_RETRY_BASE_SECONDS,
    KNOWLEDGE_JOB_RETRY_MAX_SECONDS,
)
from app.database import engine
from app.models.knowledge import KnowledgeJob, KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_ingestion import (
    index_document,
    record_document_event,
    scan_source_files,
)
from app.services.knowledge_migration import (
    LegacyMigrationFailure,
    migrate_legacy_documents,
)
from app.services.time_utils import utc_now_naive

REDIS_QUEUE_NAME = os.getenv("KNOWLEDGE_QUEUE_NAME", "aria:knowledge:jobs")
ACTIVE_JOB_STATUSES = ("queued", "running", "retrying")
TERMINAL_JOB_STATUSES = ("completed", "failed", "cancelled")
MAX_CHECKPOINT_DOCUMENT_IDS = 2048
MAX_JOB_ERROR_CHARS = 2000


class KnowledgeJobFailure(RuntimeError):
    """A classified ingestion failure with an explicit retry boundary."""

    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def _json(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _sha256(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _bounded_checkpoint(value: dict[str, Any]) -> dict[str, Any]:
    """Keep restart facts while refusing paths, extracted text, or raw payloads."""

    checkpoint: dict[str, Any] = {}
    for key in ("phase", "document_phase", "template_key"):
        if value.get(key) is not None:
            checkpoint[key] = str(value[key])[:100]
    for key in (
        "document_id",
        "source_id",
        "current_document_id",
        "current_legacy_document_id",
        "chunk_count",
        "token_count",
        "completed_document_count",
        "migrated_document_count",
        "skipped_document_count",
        "failed_document_count",
        "manual_retry_count",
    ):
        if isinstance(value.get(key), int):
            checkpoint[key] = max(0, int(value[key]))
    completed_ids = value.get("completed_document_ids")
    if isinstance(completed_ids, list):
        checkpoint["completed_document_ids"] = list(
            dict.fromkeys(
                int(item)
                for item in completed_ids[:MAX_CHECKPOINT_DOCUMENT_IDS]
                if isinstance(item, int) and item >= 0
            )
        )
        checkpoint["completed_document_count"] = len(checkpoint["completed_document_ids"])
    for source_key, target_key in (
        ("completed_legacy_document_ids", "completed_legacy_document_ids"),
        ("failed_legacy_document_ids", "failed_legacy_document_ids"),
    ):
        raw_ids = value.get(source_key)
        if isinstance(raw_ids, list):
            checkpoint[target_key] = list(
                dict.fromkeys(
                    int(item)
                    for item in raw_ids[:MAX_CHECKPOINT_DOCUMENT_IDS]
                    if isinstance(item, int) and item >= 0
                )
            )
    return checkpoint


def knowledge_job_checkpoint_reference(job: KnowledgeJob) -> dict[str, Any]:
    checkpoint = _bounded_checkpoint(_json(job.checkpoint_json))
    return {
        "phase": str(checkpoint.get("phase") or "queued"),
        "document_phase": str(checkpoint.get("document_phase") or ""),
        "completed_document_count": int(checkpoint.get("completed_document_count") or 0),
        "current_document_id": checkpoint.get("current_document_id"),
        "current_legacy_document_id": checkpoint.get("current_legacy_document_id"),
        "migrated_document_count": int(checkpoint.get("migrated_document_count") or 0),
        "skipped_document_count": int(checkpoint.get("skipped_document_count") or 0),
        "failed_document_count": int(checkpoint.get("failed_document_count") or 0),
    }


def knowledge_job_to_dict(job: KnowledgeJob) -> dict[str, Any]:
    """Return API-safe status without payload, storage paths, or document text."""

    return {
        "id": job.id,
        "job_id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "document_id": job.document_id,
        "source_id": job.source_id,
        "attempt": job.attempt,
        "max_attempts": job.max_attempts,
        "failure_code": job.failure_code,
        "retryable": bool(job.retryable),
        "error_message": str(job.error_message or "")[:MAX_JOB_ERROR_CHARS],
        "trace_id": job.trace_id,
        "checkpoint": knowledge_job_checkpoint_reference(job),
        "created_at": _iso(job.created_at),
        "updated_at": _iso(job.updated_at),
        "started_at": _iso(job.started_at),
        "completed_at": _iso(job.completed_at),
        "next_attempt_at": _iso(job.next_attempt_at),
        "lease_expires_at": _iso(job.lease_expires_at) if job.status == "running" else None,
    }


def _job_idempotency_key(
    *,
    job_type: str,
    document_id: int | None,
    source_id: int | None,
    payload: dict[str, Any],
    nonce: str = "",
) -> str:
    return _sha256(
        {
            "domain": "aria.knowledge-job.v1",
            "job_type": job_type,
            "document_id": document_id,
            "source_id": source_id,
            "payload": payload,
            "nonce": nonce,
        }
    )


def _push_to_redis(job: KnowledgeJob) -> None:
    redis_url = os.getenv("REDIS_URL", "").strip()
    if not redis_url:
        return
    try:
        import redis

        client = redis.Redis.from_url(redis_url)
        client.lpush(REDIS_QUEUE_NAME, json.dumps({"job_id": job.id}))
    except Exception:
        # PostgreSQL is the durable queue. Redis is only an optional wake-up
        # accelerator, so dispatch failure never loses the job.
        return


def _find_active_target_job(
    session: Session,
    *,
    job_type: str,
    document_id: int | None,
    source_id: int | None,
) -> KnowledgeJob | None:
    stmt = select(KnowledgeJob).where(KnowledgeJob.status.in_(ACTIVE_JOB_STATUSES))
    if document_id is not None:
        stmt = stmt.where(KnowledgeJob.document_id == document_id)
    elif source_id is not None:
        stmt = stmt.where(
            KnowledgeJob.source_id == source_id,
            KnowledgeJob.job_type == job_type,
            KnowledgeJob.document_id.is_(None),
        )
    else:
        stmt = stmt.where(
            KnowledgeJob.job_type == job_type,
            KnowledgeJob.document_id.is_(None),
            KnowledgeJob.source_id.is_(None),
        )
    return session.exec(
        stmt.order_by(KnowledgeJob.created_at.asc(), KnowledgeJob.id.asc())
    ).first()


def enqueue_knowledge_job(
    session: Session,
    *,
    job_type: str,
    document_id: int | None = None,
    source_id: int | None = None,
    requested_by_user_id: int | None = None,
    payload: dict[str, Any] | None = None,
    max_attempts: int | None = None,
    force_new: bool = False,
) -> KnowledgeJob:
    normalized_payload = dict(payload or {})
    if document_id and source_id is None:
        document = session.get(KnowledgeV1Document, document_id)
        if document:
            source_id = document.source_id
    active_target = _find_active_target_job(
        session,
        job_type=job_type,
        document_id=document_id,
        source_id=source_id,
    )
    if active_target:
        return active_target
    idempotency_key = _job_idempotency_key(
        job_type=job_type,
        document_id=document_id,
        source_id=source_id,
        payload=normalized_payload,
        nonce=uuid.uuid4().hex if force_new else "",
    )
    existing = session.exec(
        select(KnowledgeJob).where(
            KnowledgeJob.idempotency_key == idempotency_key,
            KnowledgeJob.status.in_(ACTIVE_JOB_STATUSES),
        )
    ).first()
    if existing:
        return existing

    job = KnowledgeJob(
        job_type=job_type,
        status="queued",
        document_id=document_id,
        source_id=source_id,
        requested_by_user_id=requested_by_user_id,
        payload_json=json.dumps(normalized_payload, ensure_ascii=False),
        checkpoint_json=json.dumps(
            _bounded_checkpoint(
                {
                    "phase": "queued",
                    "document_id": document_id,
                    "source_id": source_id,
                }
            ),
            ensure_ascii=False,
        ),
        max_attempts=max(1, min(int(max_attempts or KNOWLEDGE_JOB_MAX_ATTEMPTS), 10)),
        trace_id=f"knowledge_{uuid.uuid4().hex}",
        idempotency_key=idempotency_key,
    )
    session.add(job)
    if document_id:
        document = session.get(KnowledgeV1Document, document_id)
        if document:
            document.status = "queued"
            document.error_message = None
            document.updated_at = utc_now_naive()
            session.add(document)
    try:
        session.commit()
    except IntegrityError:
        # The production partial unique index resolves concurrent enqueue races.
        session.rollback()
        existing = session.exec(
            select(KnowledgeJob).where(
                KnowledgeJob.idempotency_key == idempotency_key,
                KnowledgeJob.status.in_(ACTIVE_JOB_STATUSES),
            )
        ).first()
        if existing:
            return existing
        active_target = _find_active_target_job(
            session,
            job_type=job_type,
            document_id=document_id,
            source_id=source_id,
        )
        if active_target:
            return active_target
        raise
    session.refresh(job)
    if document_id:
        record_document_event(
            session,
            document_id,
            "job_queued",
            "queued",
            metadata={"job_id": job.id, "job_type": job_type, "trace_id": job.trace_id},
        )
    _push_to_redis(job)
    return job


def _retry_delay_seconds(attempt: int) -> int:
    # Codex uses bounded exponential backoff with jitter for remote requests.
    # Durable ingestion uses the deterministic form so operators can predict
    # the exact next-attempt time and tests remain stable.
    exponent = max(0, int(attempt) - 1)
    return min(KNOWLEDGE_JOB_RETRY_MAX_SECONDS, KNOWLEDGE_JOB_RETRY_BASE_SECONDS * (2**exponent))


def classify_knowledge_job_failure(exc: BaseException) -> tuple[str, bool, str]:
    if isinstance(exc, KnowledgeJobFailure):
        return exc.code, exc.retryable, str(exc)[:MAX_JOB_ERROR_CHARS]
    if isinstance(exc, LegacyMigrationFailure):
        return exc.code, exc.retryable, str(exc)[:MAX_JOB_ERROR_CHARS]
    if isinstance(exc, FileNotFoundError):
        return "source_file_missing", False, "The source file is no longer available."
    if isinstance(exc, PermissionError):
        return "source_permission_denied", False, "The source file cannot be read with current permissions."
    if isinstance(exc, ValueError):
        return "invalid_job_input", False, str(exc)[:MAX_JOB_ERROR_CHARS]
    if isinstance(exc, (TimeoutError, ConnectionError, OSError)):
        return "transient_io_error", True, "A temporary storage or network error interrupted ingestion."
    return "internal_ingestion_error", True, "An unexpected ingestion error interrupted the job."


def _claim_knowledge_job(session: Session, job_id: int) -> KnowledgeJob | None:
    now = utc_now_naive()
    job = session.exec(
        select(KnowledgeJob)
        .where(KnowledgeJob.id == job_id)
        .with_for_update()
    ).first()
    if not job:
        session.rollback()
        return None
    running_with_live_lease = (
        job.status == "running"
        and job.lease_expires_at is not None
        and job.lease_expires_at > now
    )
    waiting_for_retry = (
        job.status == "retrying"
        and job.next_attempt_at is not None
        and job.next_attempt_at > now
    )
    if job.status in TERMINAL_JOB_STATUSES or running_with_live_lease or waiting_for_retry:
        session.rollback()
        return job
    if job.status not in ACTIVE_JOB_STATUSES:
        session.rollback()
        return job
    if job.attempt >= job.max_attempts:
        job.status = "failed"
        job.failure_code = "retry_limit_reached"
        job.retryable = False
        job.error_message = "Knowledge ingestion retry limit reached."
        job.updated_at = now
        job.completed_at = now
        job.next_attempt_at = None
        job.lease_token = ""
        job.lease_expires_at = None
        session.add(job)
        session.commit()
        session.refresh(job)
        return job

    job.status = "running"
    job.attempt += 1
    job.started_at = job.started_at or now
    job.updated_at = now
    job.last_heartbeat_at = now
    job.next_attempt_at = None
    job.lease_token = uuid.uuid4().hex
    job.lease_expires_at = now + timedelta(seconds=KNOWLEDGE_JOB_LEASE_SECONDS)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def _save_checkpoint(
    session: Session,
    job: KnowledgeJob,
    phase: str,
    **facts: Any,
) -> None:
    checkpoint = _bounded_checkpoint({**_json(job.checkpoint_json), **facts, "phase": phase})
    now = utc_now_naive()
    job.checkpoint_json = json.dumps(checkpoint, ensure_ascii=False, sort_keys=True)
    job.updated_at = now
    job.last_heartbeat_at = now
    job.lease_expires_at = now + timedelta(seconds=KNOWLEDGE_JOB_LEASE_SECONDS)
    session.add(job)
    session.commit()


def _process_document_job(
    session: Session,
    job: KnowledgeJob,
    payload: dict[str, Any],
) -> None:
    if job.document_id is None:
        raise KnowledgeJobFailure("document_id_required", "document_id is required", retryable=False)

    def checkpoint(phase: str, facts: dict[str, Any]) -> None:
        _save_checkpoint(
            session,
            job,
            phase,
            document_id=job.document_id,
            source_id=job.source_id,
            **facts,
        )

    document = index_document(
        session,
        job.document_id,
        template_key=payload.get("template_key"),
        resume_checkpoint=_json(job.checkpoint_json),
        checkpoint=checkpoint,
    )
    if document.status != "indexed":
        raise KnowledgeJobFailure(
            "document_not_indexed",
            document.error_message or "The document could not be indexed.",
            retryable=False,
        )


def _process_source_sync(
    session: Session,
    job: KnowledgeJob,
    payload: dict[str, Any],
) -> None:
    if job.source_id is None:
        raise KnowledgeJobFailure("source_id_required", "source_id is required", retryable=False)
    source = session.get(KnowledgeSource, job.source_id)
    if not source:
        raise KnowledgeJobFailure("source_not_found", "Knowledge source not found", retryable=False)
    source.status = "indexing"
    source.updated_at = utc_now_naive()
    session.add(source)
    session.commit()

    scan_source_files(session, job.source_id)
    documents = session.exec(
        select(KnowledgeV1Document)
        .where(
            KnowledgeV1Document.source_id == job.source_id,
            KnowledgeV1Document.status != "deleted",
        )
        .order_by(KnowledgeV1Document.id.asc())
    ).all()
    checkpoint_value = _json(job.checkpoint_json)
    completed_ids = {
        int(item)
        for item in checkpoint_value.get("completed_document_ids", [])
        if isinstance(item, int)
    }
    for document in documents:
        if document.id in completed_ids and document.status == "indexed":
            continue

        def document_checkpoint(phase: str, facts: dict[str, Any]) -> None:
            _save_checkpoint(
                session,
                job,
                "syncing",
                source_id=job.source_id,
                current_document_id=document.id,
                document_phase=phase,
                completed_document_ids=sorted(completed_ids),
                **facts,
            )

        indexed = index_document(
            session,
            document.id,
            template_key=payload.get("template_key"),
            resume_checkpoint=(
                checkpoint_value
                if checkpoint_value.get("current_document_id") == document.id
                else {}
            ),
            checkpoint=document_checkpoint,
        )
        if indexed.status != "indexed":
            raise KnowledgeJobFailure(
                "document_not_indexed",
                indexed.error_message or f"Document {document.id} could not be indexed.",
                retryable=False,
            )
        completed_ids.add(int(document.id))
        _save_checkpoint(
            session,
            job,
            "syncing",
            source_id=job.source_id,
            completed_document_ids=sorted(completed_ids),
            completed_document_count=len(completed_ids),
        )
        checkpoint_value = _json(job.checkpoint_json)

    source.status = "active"
    source.updated_at = utc_now_naive()
    session.add(source)
    job.payload_json = json.dumps(
        {**payload, "scanned_document_count": len(documents)},
        ensure_ascii=False,
    )
    session.add(job)
    session.commit()


def _process_legacy_migration(
    session: Session,
    job: KnowledgeJob,
    payload: dict[str, Any],
) -> None:
    raw_plans = payload.get("planned_documents")
    if not isinstance(raw_plans, list) or not raw_plans:
        raise KnowledgeJobFailure(
            "migration_plan_required",
            "A non-empty legacy migration plan is required.",
            retryable=False,
        )
    planned_documents = [item for item in raw_plans if isinstance(item, dict)]
    if len(planned_documents) != len(raw_plans):
        raise KnowledgeJobFailure(
            "migration_plan_invalid",
            "The legacy migration plan contains invalid entries.",
            retryable=False,
        )

    def checkpoint(phase: str, facts: dict[str, Any]) -> None:
        _save_checkpoint(session, job, phase, **facts)

    result = migrate_legacy_documents(
        session,
        job_id=int(job.id),
        requested_by_user_id=job.requested_by_user_id,
        planned_documents=planned_documents,
        checkpoint=checkpoint,
    )
    job.payload_json = json.dumps(
        {
            "migration_version": payload.get("migration_version"),
            "plan_hash": payload.get("plan_hash"),
            "planned_document_count": len(planned_documents),
            **{
                key: result.get(key)
                for key in (
                    "migrated_document_count",
                    "skipped_document_count",
                    "failed_document_count",
                )
            },
        },
        ensure_ascii=False,
    )
    session.add(job)
    session.commit()


def process_knowledge_job(session: Session, job_id: int) -> KnowledgeJob | None:
    job = _claim_knowledge_job(session, job_id)
    if not job or job.status != "running":
        return job

    payload = _json(job.payload_json)
    try:
        if job.job_type in {
            "index_document",
            "extract_document",
            "embed_chunks",
            "extract_template",
        }:
            _process_document_job(session, job, payload)
        elif job.job_type == "sync_source":
            _process_source_sync(session, job, payload)
        elif job.job_type == "migrate_legacy_knowledge":
            _process_legacy_migration(session, job, payload)
        else:
            raise KnowledgeJobFailure(
                "unsupported_job_type",
                f"Unsupported knowledge job type: {job.job_type}",
                retryable=False,
            )

        now = utc_now_naive()
        job.status = "completed"
        job.error_message = ""
        job.failure_code = ""
        job.retryable = False
        job.completed_at = now
        job.updated_at = now
        job.next_attempt_at = None
        job.lease_token = ""
        job.lease_expires_at = None
        prior_checkpoint = _json(job.checkpoint_json)
        prior_checkpoint.pop("phase", None)
        prior_checkpoint["document_id"] = job.document_id
        prior_checkpoint["source_id"] = job.source_id
        _save_checkpoint(
            session,
            job,
            "completed",
            **prior_checkpoint,
        )
        job.lease_expires_at = None
        session.add(job)
        session.commit()
    except Exception as exc:
        session.rollback()
        job = session.get(KnowledgeJob, job_id)
        if not job:
            return None
        failure_code, retryable, message = classify_knowledge_job_failure(exc)
        now = utc_now_naive()
        will_retry = bool(retryable and job.attempt < job.max_attempts)
        job.error_message = message
        job.failure_code = failure_code
        # Preserve the semantic retryability after automatic attempts are
        # exhausted so an authorized user can explicitly restart the job.
        job.retryable = bool(retryable)
        job.status = "retrying" if will_retry else "failed"
        job.next_attempt_at = (
            now + timedelta(seconds=_retry_delay_seconds(job.attempt))
            if will_retry
            else None
        )
        job.completed_at = None if will_retry else now
        job.updated_at = now
        job.lease_token = ""
        job.lease_expires_at = None
        session.add(job)
        if job.document_id:
            document = session.get(KnowledgeV1Document, job.document_id)
            if document:
                document.status = "retrying" if will_retry else "failed"
                document.error_message = message
                document.updated_at = now
                session.add(document)
        if job.source_id and job.job_type == "sync_source":
            source = session.get(KnowledgeSource, job.source_id)
            if source:
                source.status = "indexing" if will_retry else "error"
                source.updated_at = now
                session.add(source)
        session.commit()
        if job.document_id:
            record_document_event(
                session,
                job.document_id,
                "job_retry_scheduled" if will_retry else "job_failed",
                job.status,
                message=message,
                metadata={
                    "job_id": job.id,
                    "failure_code": failure_code,
                    "attempt": job.attempt,
                    "max_attempts": job.max_attempts,
                    "next_attempt_at": _iso(job.next_attempt_at),
                },
            )

    session.refresh(job)
    return job


def retry_knowledge_job(
    session: Session,
    job_id: int,
    *,
    force: bool = False,
) -> KnowledgeJob:
    job = session.exec(
        select(KnowledgeJob).where(KnowledgeJob.id == job_id).with_for_update()
    ).first()
    if not job:
        raise ValueError("Knowledge job not found")
    if job.status in ACTIVE_JOB_STATUSES:
        session.rollback()
        return job
    if job.status == "completed":
        session.rollback()
        raise ValueError("Completed knowledge jobs cannot be retried")
    if not job.retryable and not force:
        session.rollback()
        raise KnowledgeJobFailure(
            "manual_retry_not_allowed",
            "This failure is not retryable without an explicit administrative override.",
            retryable=False,
        )
    checkpoint = _json(job.checkpoint_json)
    checkpoint["manual_retry_count"] = int(checkpoint.get("manual_retry_count") or 0) + 1
    checkpoint["phase"] = str(checkpoint.get("phase") or "queued")
    job.checkpoint_json = json.dumps(_bounded_checkpoint(checkpoint), ensure_ascii=False)
    job.status = "queued"
    job.attempt = 0
    job.error_message = ""
    job.failure_code = ""
    job.retryable = False
    job.next_attempt_at = None
    job.completed_at = None
    job.lease_token = ""
    job.lease_expires_at = None
    job.updated_at = utc_now_naive()
    session.add(job)
    if job.document_id:
        document = session.get(KnowledgeV1Document, job.document_id)
        if document:
            document.status = "queued"
            document.error_message = None
            document.updated_at = utc_now_naive()
            session.add(document)
    session.commit()
    session.refresh(job)
    _push_to_redis(job)
    return job


def process_knowledge_job_by_id(job_id: int, bind=None) -> None:
    with Session(bind or engine) as session:
        process_knowledge_job(session, job_id)


def run_pending_knowledge_jobs(session: Session, *, limit: int = 10) -> list[KnowledgeJob]:
    now = utc_now_naive()
    jobs = session.exec(
        select(KnowledgeJob)
        .where(
            or_(
                KnowledgeJob.status == "queued",
                and_(
                    KnowledgeJob.status == "retrying",
                    or_(
                        KnowledgeJob.next_attempt_at.is_(None),
                        KnowledgeJob.next_attempt_at <= now,
                    ),
                ),
                and_(
                    KnowledgeJob.status == "running",
                    or_(
                        KnowledgeJob.lease_expires_at.is_(None),
                        KnowledgeJob.lease_expires_at <= now,
                    ),
                ),
            )
        )
        .order_by(KnowledgeJob.created_at.asc(), KnowledgeJob.id.asc())
        .limit(max(1, min(int(limit), 100)))
    ).all()
    processed: list[KnowledgeJob] = []
    for candidate in jobs:
        next_job = process_knowledge_job(session, int(candidate.id))
        if next_job:
            processed.append(next_job)
    return processed


def run_pending_knowledge_jobs_with_engine(bind=engine, limit: int = 10) -> int:
    with Session(bind) as session:
        return len(run_pending_knowledge_jobs(session, limit=limit))


def index_knowledge_document_job(document_id: int, template_key: str | None = None) -> None:
    with Session(engine) as session:
        job = enqueue_knowledge_job(
            session,
            job_type="index_document",
            document_id=document_id,
            payload={"template_key": template_key} if template_key else {},
        )
        process_knowledge_job(session, int(job.id))
