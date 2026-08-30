"""Database-backed worker lease and reaper for active Aria ChatRuns.

The fencing-token and heartbeat boundary follows the same general durable-job
principle already used by Aria knowledge ingestion: one opaque generation owns
active execution, renewal proves liveness, and expiry records interruption
without replaying provider calls or business writes. This is an Aria-native
Python/SQLModel mechanism; it does not use a Codex runtime, protocol, SDK,
subprocess, account, or provider transcript.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import socket
from dataclasses import dataclass
from datetime import datetime, timedelta
from secrets import token_hex
from uuid import uuid4

from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.config import (
    CHAT_RUN_LEASE_SECONDS,
    CHAT_RUN_UNLEASED_GRACE_SECONDS,
)
from app.models.db import ChatRun, ChatRunInput, TaskEvent, TaskRun
from app.services.time_utils import utc_now_naive


logger = logging.getLogger(__name__)

CHAT_RUN_LEASE_LOST_CANCEL_MESSAGE = "aria_chat_run_lease_lost"
LEASE_EXPIRED_ERROR_CODE = "CHAT_RUN_WORKER_LEASE_EXPIRED"
LEASE_MISSING_ERROR_CODE = "CHAT_RUN_WORKER_LEASE_MISSING"
LEASE_INVALID_ERROR_CODE = "CHAT_RUN_WORKER_LEASE_INVALID"
LEASE_REAPER_PHASE = "worker_lease_expired"

_PROCESS_NONCE = uuid4().hex


class ChatRunLeaseError(RuntimeError):
    """Stable failure raised when a worker no longer owns an active Run."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class ChatRunLease:
    owner: str
    token: str
    generation: int = 1
    ttl_seconds: int = CHAT_RUN_LEASE_SECONDS


@dataclass(frozen=True)
class ChatRunReaperResult:
    scanned: int = 0
    reaped: int = 0
    expired: int = 0
    missing: int = 0
    invalid: int = 0


def chat_run_lease_from_state(state) -> ChatRunLease | None:
    """Resolve a lease from internal orchestration state, never API input."""

    owner = str(getattr(state, "run_lease_owner", "") or "")
    token = str(getattr(state, "run_lease_token", "") or "")
    generation = int(getattr(state, "run_lease_generation", 0) or 0)
    if not owner and not token and generation == 0:
        return None
    if not owner or len(token) != 64 or generation < 1:
        raise ChatRunLeaseError("lease_state_invalid", "Chat run lease state is invalid")
    return ChatRunLease(
        owner=owner,
        token=token,
        generation=generation,
        ttl_seconds=max(
            30,
            min(int(getattr(state, "run_lease_ttl_seconds", CHAT_RUN_LEASE_SECONDS)), 900),
        ),
    )


def _default_owner() -> str:
    identity = f"{socket.gethostname()}:{os.getpid()}:{_PROCESS_NONCE}"
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return f"worker_{digest}"


def new_chat_run_lease(
    *,
    owner: str | None = None,
    ttl_seconds: int = CHAT_RUN_LEASE_SECONDS,
) -> ChatRunLease:
    normalized_owner = str(owner or _default_owner()).strip()[:96]
    if not normalized_owner:
        raise ValueError("chat run lease owner is required")
    normalized_ttl = max(30, min(int(ttl_seconds), 900))
    return ChatRunLease(
        owner=normalized_owner,
        token=token_hex(32),
        generation=1,
        ttl_seconds=normalized_ttl,
    )


def bind_new_chat_run_lease(
    run: ChatRun,
    lease: ChatRunLease,
    *,
    now: datetime | None = None,
) -> datetime:
    """Attach the first worker generation to a new/activated ChatRun."""

    if int(getattr(run, "lease_generation", 0) or 0) != 0:
        raise ChatRunLeaseError("lease_already_bound", "Chat run already has a worker lease")
    if str(getattr(run, "lease_token", "") or ""):
        raise ChatRunLeaseError("lease_already_bound", "Chat run already has a worker lease")
    stamp = now or utc_now_naive()
    expires_at = stamp + timedelta(seconds=lease.ttl_seconds)
    run.lease_owner = lease.owner
    run.lease_token = lease.token
    run.lease_generation = lease.generation
    run.last_heartbeat_at = stamp
    run.lease_expires_at = expires_at
    return expires_at


def require_chat_run_lease(
    run: ChatRun,
    lease: ChatRunLease | None,
    *,
    now: datetime | None = None,
    require_unexpired: bool = True,
) -> None:
    """Verify the exact worker fencing token on a row already locked by caller.

    Rows with no lease fields remain compatible with direct harness fixtures
    and rolling upgrades. Once a Run has any lease identity, every protected
    mutation must supply the exact owner/token/generation.
    """

    stored_token = str(getattr(run, "lease_token", "") or "")
    stored_owner = str(getattr(run, "lease_owner", "") or "")
    stored_generation = int(getattr(run, "lease_generation", 0) or 0)
    if not stored_token and not stored_owner and stored_generation == 0:
        if lease is None:
            return
        raise ChatRunLeaseError("lease_not_bound", "Chat run worker lease is not bound")
    if lease is None:
        raise ChatRunLeaseError("lease_required", "Chat run worker lease is required")
    if (
        stored_token != lease.token
        or stored_owner != lease.owner
        or stored_generation != int(lease.generation)
    ):
        raise ChatRunLeaseError("lease_fenced", "Chat run is owned by another worker generation")
    if run.status not in {"running", "waiting_confirmation"} or run.completed_at is not None:
        raise ChatRunLeaseError("run_not_active", "Chat run is no longer active")
    expires_at = getattr(run, "lease_expires_at", None)
    if require_unexpired and (
        expires_at is None or expires_at <= (now or utc_now_naive())
    ):
        raise ChatRunLeaseError("lease_expired", "Chat run worker lease has expired")


def heartbeat_chat_run_lease(
    bind,
    *,
    run_id: str,
    lease: ChatRunLease,
    now: datetime | None = None,
) -> datetime:
    """Renew one exact active worker generation under the ChatRun row lock."""

    stamp = now or utc_now_naive()
    with Session(bind) as session:
        run = session.exec(
            select(ChatRun)
            .where(ChatRun.run_id == str(run_id or "").strip())
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if run is None or run.id is None:
            raise ChatRunLeaseError("run_not_found", "Chat run worker lease target is unavailable")
        require_chat_run_lease(run, lease, now=stamp)
        expires_at = stamp + timedelta(seconds=lease.ttl_seconds)
        run.last_heartbeat_at = stamp
        run.lease_expires_at = expires_at
        session.add(run)
        session.commit()
        return expires_at


def clear_chat_run_lease(run: ChatRun) -> None:
    """Release active ownership while retaining generation/heartbeat evidence."""

    run.lease_owner = ""
    run.lease_token = ""
    run.lease_expires_at = None


def _append_interrupted_event(
    session: Session,
    *,
    task: TaskRun,
    run: ChatRun,
    error_code: str,
    previous_phase: str,
) -> None:
    ordinal = int(
        session.exec(
            select(func.count(TaskEvent.id)).where(TaskEvent.task_run_id == int(task.id))
        ).one()
        or 0
    ) + 1
    event = TaskEvent(
        task_run_id=int(task.id),
        event_type="run_interrupted",
        message="run interrupted",
        payload_json=json.dumps(
            {
                "schema_version": 1,
                "ordinal": ordinal,
                "run_id": run.run_id,
                "phase": LEASE_REAPER_PHASE,
                "previous_phase": previous_phase[:64],
                "error_code": error_code,
                "retryable": True,
                "lease_generation": int(run.lease_generation or 0),
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
    )
    session.add(event)
    session.flush()


def _classify_stale_run(
    run: ChatRun,
    *,
    now: datetime,
    unleased_cutoff: datetime,
) -> str | None:
    token = str(run.lease_token or "")
    owner = str(run.lease_owner or "")
    generation = int(run.lease_generation or 0)
    expires_at = run.lease_expires_at
    if token and owner and generation > 0 and expires_at is not None:
        return "expired" if expires_at <= now else None
    if token or owner or generation > 0 or expires_at is not None:
        reference = run.last_heartbeat_at or run.updated_at or run.started_at
        return "invalid" if reference <= unleased_cutoff else None
    reference = run.updated_at or run.started_at
    return "missing" if reference <= unleased_cutoff else None


def reap_stale_chat_runs(
    session: Session,
    *,
    now: datetime | None = None,
    unleased_grace_seconds: int = CHAT_RUN_UNLEASED_GRACE_SECONDS,
    limit: int = 200,
) -> ChatRunReaperResult:
    """Fence expired active Runs and record a recoverable interruption.

    This never retries model requests, tools, or business writes. PostgreSQL
    workers use ``SKIP LOCKED`` so heartbeat/finalization transactions win or
    serialize cleanly; SQLite retains deterministic test behavior.
    """

    stamp = now or utc_now_naive()
    grace = max(30, int(unleased_grace_seconds))
    unleased_cutoff = stamp - timedelta(seconds=grace)
    statement = (
        select(ChatRun)
        .where(
            ChatRun.status.in_(("running", "waiting_confirmation")),
            ChatRun.completed_at.is_(None),
            ChatRun.phase != "reserved",
            or_(
                and_(
                    ChatRun.lease_token != "",
                    ChatRun.lease_expires_at.is_not(None),
                    ChatRun.lease_expires_at <= stamp,
                ),
                and_(
                    ChatRun.updated_at <= unleased_cutoff,
                    or_(
                        ChatRun.lease_token == "",
                        ChatRun.lease_owner == "",
                        ChatRun.lease_expires_at.is_(None),
                    ),
                ),
            ),
        )
        .order_by(ChatRun.id)
        .limit(max(1, min(int(limit), 1000)))
        .execution_options(populate_existing=True)
    )
    if session.bind is not None and session.bind.dialect.name == "postgresql":
        statement = statement.with_for_update(skip_locked=True)
    else:
        statement = statement.with_for_update()
    runs = list(session.exec(statement).all())
    counts = {"expired": 0, "missing": 0, "invalid": 0}
    reaped = 0
    for run in runs:
        classification = _classify_stale_run(
            run,
            now=stamp,
            unleased_cutoff=unleased_cutoff,
        )
        if classification is None:
            continue
        error_code = {
            "expired": LEASE_EXPIRED_ERROR_CODE,
            "missing": LEASE_MISSING_ERROR_CODE,
            "invalid": LEASE_INVALID_ERROR_CODE,
        }[classification]
        previous_phase = str(run.phase or "")
        task = session.exec(
            select(TaskRun)
            .where(TaskRun.id == int(run.task_run_id))
            .execution_options(populate_existing=True)
            .with_for_update()
        ).first()
        if task is not None:
            task.status = "failed"
            task.current_step_key = LEASE_REAPER_PHASE
            task.error_code = error_code
            task.error_message = "Active chat worker lease expired; automatic execution was not replayed."
            task.updated_at = stamp
            task.completed_at = stamp
            session.add(task)
            session.flush()
            _append_interrupted_event(
                session,
                task=task,
                run=run,
                error_code=error_code,
                previous_phase=previous_phase,
            )
            from app.services.agent_harness.run_rollout import reconstruct_rollout

            records = [
                {
                    "event_type": item.event_type,
                    "payload": json.loads(item.payload_json or "{}"),
                }
                for item in session.exec(
                    select(TaskEvent)
                    .where(TaskEvent.task_run_id == int(task.id))
                    .order_by(TaskEvent.created_at, TaskEvent.id)
                ).all()
            ]
            task.output_json = json.dumps(
                reconstruct_rollout(records, task_status=task.status),
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            session.add(task)
        run.status = "interrupted"
        run.phase = LEASE_REAPER_PHASE
        run.error_code = error_code
        run.retryable = True
        run.completed_at = stamp
        run.updated_at = stamp
        run.duration_ms = max(0, int((stamp - run.started_at).total_seconds() * 1000))
        clear_chat_run_lease(run)
        session.add(run)
        for item in session.exec(
            select(ChatRunInput).where(
                ChatRunInput.chat_run_id == int(run.id),
                ChatRunInput.status == "accepted",
            )
        ).all():
            item.status = "unapplied"
            item.applied_at = None
            session.add(item)
        counts[classification] += 1
        reaped += 1
    if reaped:
        session.commit()
        logger.warning(
            "Reaped %s stale ChatRuns (expired=%s missing=%s invalid=%s); no execution replayed.",
            reaped,
            counts["expired"],
            counts["missing"],
            counts["invalid"],
        )
    return ChatRunReaperResult(
        scanned=len(runs),
        reaped=reaped,
        expired=counts["expired"],
        missing=counts["missing"],
        invalid=counts["invalid"],
    )


def reap_stale_chat_runs_with_engine(engine) -> ChatRunReaperResult:
    with Session(engine) as session:
        return reap_stale_chat_runs(session)
