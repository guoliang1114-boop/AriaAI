"""Governed promotion of question-remediation drafts into Aria domain state.

Preparing a promotion persists an exact, expiring HITAS preview only.  The
separate confirmation call re-authorizes the actor, revalidates the current
evidence basis, and atomically creates either a native ProjectTodo or a manual
communication request.  This module has no message-delivery or tool-execution
capability.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    ProjectCommunicationRequest,
    ProjectMember,
    ProjectQuestionRemediationPromotion,
    ProjectQuestionRemediationPromotionEvent,
    ProjectTodo,
    User,
)
from app.services.cache import projects_cache
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import lock_and_require_project_write
from app.services.project_question_remediation import (
    build_project_question_remediation_plan,
)
from app.services.project_question_resolutions import (
    normalize_project_question,
    project_question_sha256,
)
from app.services.time_utils import utc_now_naive


PROMOTION_SCHEMA_VERSION = 1
PROMOTION_TTL_HOURS = 24
MAX_TITLE_CHARS = 120
MAX_DRAFT_CHARS = 600
MAX_RECIPIENT_CHARS = 160
MAX_REASON_CHARS = 600
MAX_TODO_CHARS = 1000

TARGET_KINDS = {"project_todo", "communication_request"}
ACTION_KINDS = {
    "clarification_question",
    "evidence_request",
    "internal_check",
    "candidate_review",
    "human_verification",
}
TERMINAL_STATUSES = {"confirmed", "rejected", "failed", "expired"}
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_SOURCE_ACTION_PATTERN = re.compile(
    r"^(?:remediation_[0-9]{2}|custom_[0-9]+_[0-9a-f]{6})$"
)


def _canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _single_line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def _draft(value: Any) -> str:
    normalized = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return normalized[:MAX_DRAFT_CHARS]


def _sha256(value: Any, *, field: str) -> str:
    normalized = str(value or "").strip().lower()
    if not _SHA256_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail=f"{field} must be a SHA-256 digest")
    return normalized


def _due_date(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    try:
        parsed = date.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="due_date must use YYYY-MM-DD") from exc
    if parsed.isoformat() != normalized:
        raise HTTPException(status_code=400, detail="due_date must use YYYY-MM-DD")
    return normalized


def _action_payload(
    *,
    project_id: int,
    question_sha256: str,
    target_kind: str,
    action_kind: str,
    source_action_id: str,
    title: str,
    draft: str,
    owner_user_id: int | None,
    due_date: str,
    recipient_label: str,
) -> dict[str, Any]:
    return {
        "project_id": project_id,
        "question_sha256": question_sha256,
        "target_kind": target_kind,
        "action_kind": action_kind,
        "source_action_id": source_action_id,
        "title": title,
        "draft": draft,
        "owner_user_id": owner_user_id,
        "due_date": due_date,
        "recipient_label": recipient_label,
    }


def _snapshot_payload(
    *,
    action: dict[str, Any],
    evidence_basis_sha256: str,
    actor_user_id: int,
    expires_at: datetime,
) -> dict[str, Any]:
    return {
        "schema_version": PROMOTION_SCHEMA_VERSION,
        "action": action,
        "evidence_basis_sha256": evidence_basis_sha256,
        "prepared_by_user_id": actor_user_id,
        "expires_at": expires_at.isoformat(),
    }


def build_remediation_promotion_contract(target_kind: str) -> dict[str, Any]:
    """Return the machine-checkable safety contract used by API and evals."""

    if target_kind not in TARGET_KINDS:
        raise ValueError("unsupported remediation promotion target")
    return {
        "name": "project_question_remediation_promotion",
        "persists_frozen_preview": True,
        "requires_explicit_confirmation": True,
        "reauthorizes_on_confirmation": True,
        "rechecks_current_evidence_basis": True,
        "creates_target_before_confirmation": False,
        "sends_messages": False,
        "executes_tools": False,
        "outbound_delivery": False,
        "delivery_mode": "manual_only" if target_kind == "communication_request" else "not_applicable",
    }


def _normalize_action(
    *,
    project_id: int,
    question: str,
    question_sha256: str,
    target_kind: str,
    action_kind: str,
    source_action_id: str,
    title: str,
    draft: str,
    owner_user_id: int | None,
    due_date: str | None,
    recipient_label: str,
) -> tuple[str, dict[str, Any]]:
    normalized_question = normalize_project_question(question)
    identity = project_question_sha256(normalized_question)
    requested_identity = _sha256(question_sha256, field="question_sha256")
    if not normalized_question or identity != requested_identity:
        raise HTTPException(status_code=409, detail="Question identity changed; reload and retry.")

    normalized_target = _single_line(target_kind, 40)
    normalized_kind = _single_line(action_kind, 40)
    normalized_source_action = _single_line(source_action_id, 40)
    normalized_title = _single_line(title, MAX_TITLE_CHARS)
    normalized_draft = _draft(draft)
    normalized_recipient = _single_line(recipient_label, MAX_RECIPIENT_CHARS)
    normalized_due_date = _due_date(due_date)

    if normalized_target not in TARGET_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported remediation target")
    if normalized_kind not in ACTION_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported remediation action")
    if not _SOURCE_ACTION_PATTERN.fullmatch(normalized_source_action):
        raise HTTPException(status_code=400, detail="Invalid remediation source action")
    if not normalized_title:
        raise HTTPException(status_code=400, detail="A remediation title is required")
    if owner_user_id is not None and int(owner_user_id) <= 0:
        raise HTTPException(status_code=400, detail="Invalid remediation owner")
    if normalized_target == "communication_request":
        if not normalized_draft:
            raise HTTPException(status_code=400, detail="A communication draft is required")
        if not normalized_recipient:
            raise HTTPException(status_code=400, detail="A communication recipient is required")
    else:
        normalized_recipient = ""

    return normalized_question, _action_payload(
        project_id=project_id,
        question_sha256=identity,
        target_kind=normalized_target,
        action_kind=normalized_kind,
        source_action_id=normalized_source_action,
        title=normalized_title,
        draft=normalized_draft,
        owner_user_id=int(owner_user_id) if owner_user_id is not None else None,
        due_date=normalized_due_date,
        recipient_label=normalized_recipient,
    )


def _action_still_allowed(
    *,
    source_action_id: str,
    action_kind: str,
    current_actions: set[tuple[str, str]],
) -> bool:
    if source_action_id.startswith("custom_"):
        return action_kind == "internal_check"
    return (source_action_id, action_kind) in current_actions


def _row_action(row: ProjectQuestionRemediationPromotion) -> dict[str, Any]:
    return _action_payload(
        project_id=int(row.project_id),
        question_sha256=row.question_sha256,
        target_kind=row.target_kind,
        action_kind=row.action_kind,
        source_action_id=row.source_action_id,
        title=row.title,
        draft=row.draft,
        owner_user_id=row.owner_user_id,
        due_date=row.due_date,
        recipient_label=row.recipient_label,
    )


def _validate_owner(
    session: Session,
    *,
    project_id: int,
    owner_user_id: int | None,
) -> None:
    if owner_user_id is None:
        return
    row = session.exec(
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == owner_user_id,
            User.is_active.is_(True),
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=409,
            detail="The selected owner is no longer an active project member.",
        )


def _event(
    row: ProjectQuestionRemediationPromotion,
    *,
    action: str,
    actor_user_id: int,
    target_todo_id: int | None = None,
    communication_request_id: int | None = None,
    note: str = "",
) -> ProjectQuestionRemediationPromotionEvent:
    return ProjectQuestionRemediationPromotionEvent(
        promotion_id=int(row.id or 0),
        project_id=int(row.project_id),
        revision=int(row.revision),
        action=action,
        status=row.status,
        snapshot_sha256=row.snapshot_sha256,
        actor_user_id=actor_user_id,
        target_todo_id=target_todo_id,
        communication_request_id=communication_request_id,
        note=_single_line(note, MAX_REASON_CHARS),
        created_at=utc_now_naive(),
    )


def _target_ids(
    session: Session,
    row: ProjectQuestionRemediationPromotion,
) -> tuple[int | None, int | None]:
    event = session.exec(
        select(ProjectQuestionRemediationPromotionEvent)
        .where(
            ProjectQuestionRemediationPromotionEvent.promotion_id == int(row.id or 0),
            ProjectQuestionRemediationPromotionEvent.status == "confirmed",
        )
        .order_by(ProjectQuestionRemediationPromotionEvent.revision.desc())
    ).first()
    if event is None:
        return row.target_todo_id, None
    return event.target_todo_id, event.communication_request_id


def serialize_project_question_remediation_promotion(
    session: Session,
    row: ProjectQuestionRemediationPromotion,
) -> dict[str, Any]:
    target_todo_id, communication_request_id = _target_ids(session, row)
    target: dict[str, Any] | None = None
    if target_todo_id is not None:
        todo = session.get(ProjectTodo, target_todo_id)
        if todo is not None:
            target = {
                "kind": "project_todo",
                "id": todo.id,
                "content": todo.content,
                "is_done": todo.is_done,
                "due_date": todo.due_date,
                "owner_user_id": todo.assigned_to_user_id,
            }
    elif communication_request_id is not None:
        request = session.get(ProjectCommunicationRequest, communication_request_id)
        if request is not None:
            target = {
                "kind": "communication_request",
                "id": request.id,
                "subject": request.subject,
                "body": request.body,
                "recipient_label": request.recipient_label,
                "owner_user_id": request.owner_user_id,
                "due_date": request.due_date,
                "status": request.status,
                "delivery_mode": request.delivery_mode,
                "delivered": False,
            }
    now = utc_now_naive()
    return {
        "schema_version": PROMOTION_SCHEMA_VERSION,
        "id": row.id,
        "project_id": row.project_id,
        "question": row.question_text,
        "question_sha256": row.question_sha256,
        "status": row.status,
        "revision": row.revision,
        "snapshot_sha256": row.snapshot_sha256,
        "evidence_basis_fingerprint": row.evidence_basis_sha256,
        "preview": _row_action(row),
        "created_by_user_id": row.created_by_user_id,
        "decided_by_user_id": row.decided_by_user_id,
        "failure_code": row.failure_code,
        "decision_reason": row.decision_reason,
        "expires_at": row.expires_at,
        "expired": row.status == "pending" and row.expires_at <= now,
        "decided_at": row.decided_at,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "target": target,
        "contract": build_remediation_promotion_contract(row.target_kind),
    }


def prepare_project_question_remediation_promotion(
    session: Session,
    *,
    project_id: int,
    actor_user_id: int,
    question: str,
    question_sha256: str,
    evidence_basis_fingerprint: str,
    idempotency_key: str,
    target_kind: str,
    action_kind: str,
    source_action_id: str,
    title: str,
    draft: str = "",
    owner_user_id: int | None = None,
    due_date: str | None = None,
    recipient_label: str = "",
) -> dict[str, Any]:
    """Persist an exact preview without creating its consequential target."""

    normalized_question, action = _normalize_action(
        project_id=project_id,
        question=question,
        question_sha256=question_sha256,
        target_kind=target_kind,
        action_kind=action_kind,
        source_action_id=source_action_id,
        title=title,
        draft=draft,
        owner_user_id=owner_user_id,
        due_date=due_date,
        recipient_label=recipient_label,
    )
    basis = _sha256(evidence_basis_fingerprint, field="evidence_basis_fingerprint")
    raw_key = str(idempotency_key or "").strip()
    if not 16 <= len(raw_key) <= 128:
        raise HTTPException(status_code=400, detail="Invalid idempotency key")
    key_sha256 = _canonical_sha256(
        {"contract": "aria.remediation-promotion.idempotency.v1", "key": raw_key}
    )
    action_sha256 = _canonical_sha256(action)

    project, actor = lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    existing = session.exec(
        select(ProjectQuestionRemediationPromotion)
        .where(
            ProjectQuestionRemediationPromotion.project_id == project_id,
            ProjectQuestionRemediationPromotion.idempotency_key_sha256 == key_sha256,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if existing is not None:
        _assert_snapshot_integrity(session, existing, actor_user_id=actor_user_id)
        retry_snapshot_sha256 = _canonical_sha256(
            _snapshot_payload(
                action=action,
                evidence_basis_sha256=basis,
                actor_user_id=actor_user_id,
                expires_at=existing.expires_at,
            )
        )
        if (
            existing.action_sha256 != action_sha256
            or existing.snapshot_sha256 != retry_snapshot_sha256
        ):
            raise HTTPException(
                status_code=409,
                detail="This idempotency key is already bound to a different preview.",
            )
        return serialize_project_question_remediation_promotion(session, existing)

    current_plan = build_project_question_remediation_plan(
        session,
        project=project,
        question=normalized_question,
        question_sha256=action["question_sha256"],
    )
    current_basis = str((current_plan.get("basis") or {}).get("fingerprint") or "")
    if current_basis != basis:
        raise HTTPException(
            status_code=409,
            detail="Question evidence changed; regenerate the remediation preview.",
        )
    current_actions = {
        (str(item.get("action_id") or ""), str(item.get("kind") or ""))
        for item in list(current_plan.get("actions") or [])
        if isinstance(item, dict)
    }
    if not _action_still_allowed(
        source_action_id=action["source_action_id"],
        action_kind=action["action_kind"],
        current_actions=current_actions,
    ):
        raise HTTPException(
            status_code=409,
            detail="The selected remediation action is no longer in the current plan.",
        )
    _validate_owner(
        session,
        project_id=project_id,
        owner_user_id=action["owner_user_id"],
    )

    now = utc_now_naive()
    expires_at = now + timedelta(hours=PROMOTION_TTL_HOURS)
    snapshot_sha256 = _canonical_sha256(
        _snapshot_payload(
            action=action,
            evidence_basis_sha256=basis,
            actor_user_id=actor_user_id,
            expires_at=expires_at,
        )
    )
    row = ProjectQuestionRemediationPromotion(
        project_id=project_id,
        question_text=normalized_question,
        question_sha256=action["question_sha256"],
        idempotency_key_sha256=key_sha256,
        action_sha256=action_sha256,
        snapshot_sha256=snapshot_sha256,
        evidence_basis_sha256=basis,
        target_kind=action["target_kind"],
        action_kind=action["action_kind"],
        source_action_id=action["source_action_id"],
        title=action["title"],
        draft=action["draft"],
        owner_user_id=action["owner_user_id"],
        due_date=action["due_date"],
        recipient_label=action["recipient_label"],
        status="pending",
        revision=1,
        created_by_user_id=int(actor.id or actor_user_id),
        expires_at=expires_at,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    session.flush()
    session.add(_event(row, action="prepared", actor_user_id=actor_user_id))
    session.commit()
    session.refresh(row)
    return serialize_project_question_remediation_promotion(session, row)


def _locked_promotion(
    session: Session,
    *,
    project_id: int,
    question_sha256: str,
    promotion_id: int,
) -> ProjectQuestionRemediationPromotion:
    row = session.exec(
        select(ProjectQuestionRemediationPromotion)
        .where(
            ProjectQuestionRemediationPromotion.id == promotion_id,
            ProjectQuestionRemediationPromotion.project_id == project_id,
            ProjectQuestionRemediationPromotion.question_sha256 == question_sha256,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Remediation promotion not found")
    return row


def _fail_promotion(
    session: Session,
    row: ProjectQuestionRemediationPromotion,
    *,
    actor_user_id: int,
    status: str,
    failure_code: str,
    detail: str,
) -> None:
    now = utc_now_naive()
    row.status = status
    row.failure_code = failure_code
    row.decided_by_user_id = actor_user_id
    row.decided_at = now
    row.updated_at = now
    row.revision = int(row.revision) + 1
    session.add(row)
    session.add(
        _event(
            row,
            action="expired" if status == "expired" else "failed",
            actor_user_id=actor_user_id,
            note=failure_code,
        )
    )
    session.commit()
    raise HTTPException(status_code=409, detail=detail)


def _assert_snapshot_integrity(
    session: Session,
    row: ProjectQuestionRemediationPromotion,
    *,
    actor_user_id: int,
) -> None:
    action = _row_action(row)
    expected_action = _canonical_sha256(action)
    expected_snapshot = _canonical_sha256(
        _snapshot_payload(
            action=action,
            evidence_basis_sha256=row.evidence_basis_sha256,
            actor_user_id=int(row.created_by_user_id or 0),
            expires_at=row.expires_at,
        )
    )
    if expected_action != row.action_sha256 or expected_snapshot != row.snapshot_sha256:
        _fail_promotion(
            session,
            row,
            actor_user_id=actor_user_id,
            status="failed",
            failure_code="snapshot_integrity_invalid",
            detail="The persisted preview failed integrity validation.",
        )


def _deduplicated_target(
    session: Session,
    row: ProjectQuestionRemediationPromotion,
) -> tuple[int | None, int | None]:
    prior_rows = session.exec(
        select(ProjectQuestionRemediationPromotion)
        .where(
            ProjectQuestionRemediationPromotion.project_id == row.project_id,
            ProjectQuestionRemediationPromotion.action_sha256 == row.action_sha256,
            ProjectQuestionRemediationPromotion.status == "confirmed",
            ProjectQuestionRemediationPromotion.id != int(row.id or 0),
        )
        .order_by(ProjectQuestionRemediationPromotion.id)
    ).all()
    for prior in prior_rows:
        todo_id, communication_id = _target_ids(session, prior)
        if todo_id is not None and session.get(ProjectTodo, todo_id) is not None:
            return todo_id, None
        if (
            communication_id is not None
            and session.get(ProjectCommunicationRequest, communication_id) is not None
        ):
            return None, communication_id
    return None, None


def confirm_project_question_remediation_promotion(
    session: Session,
    *,
    project_id: int,
    question_sha256: str,
    promotion_id: int,
    actor_user_id: int,
    snapshot_sha256: str,
    expected_revision: int,
) -> dict[str, Any]:
    """Confirm one preview and atomically create its exact native target."""

    identity = _sha256(question_sha256, field="question_sha256")
    requested_snapshot = _sha256(snapshot_sha256, field="snapshot_sha256")
    project, actor = lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    row = _locked_promotion(
        session,
        project_id=project_id,
        question_sha256=identity,
        promotion_id=promotion_id,
    )
    if requested_snapshot != row.snapshot_sha256:
        raise HTTPException(status_code=409, detail="Preview snapshot changed; reload and retry.")
    _assert_snapshot_integrity(session, row, actor_user_id=actor_user_id)
    if row.status == "confirmed":
        return serialize_project_question_remediation_promotion(session, row)
    if row.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Promotion is already {row.status}.")
    if int(row.revision) != int(expected_revision):
        raise HTTPException(status_code=409, detail="Promotion revision changed; reload and retry.")
    if row.expires_at <= utc_now_naive():
        _fail_promotion(
            session,
            row,
            actor_user_id=actor_user_id,
            status="expired",
            failure_code="preview_expired",
            detail="The preview expired; prepare a new one.",
        )

    current_plan = build_project_question_remediation_plan(
        session,
        project=project,
        question=row.question_text,
        question_sha256=row.question_sha256,
    )
    current_basis = str((current_plan.get("basis") or {}).get("fingerprint") or "")
    if current_basis != row.evidence_basis_sha256:
        _fail_promotion(
            session,
            row,
            actor_user_id=actor_user_id,
            status="failed",
            failure_code="evidence_basis_changed",
            detail="Question evidence changed; prepare and confirm a new preview.",
        )
    current_actions = {
        (str(item.get("action_id") or ""), str(item.get("kind") or ""))
        for item in list(current_plan.get("actions") or [])
        if isinstance(item, dict)
    }
    if not _action_still_allowed(
        source_action_id=row.source_action_id,
        action_kind=row.action_kind,
        current_actions=current_actions,
    ):
        _fail_promotion(
            session,
            row,
            actor_user_id=actor_user_id,
            status="failed",
            failure_code="source_action_changed",
            detail="The remediation action changed; prepare and confirm a new preview.",
        )
    _validate_owner(
        session,
        project_id=project_id,
        owner_user_id=row.owner_user_id,
    )

    todo_id, communication_id = _deduplicated_target(session, row)
    deduplicated = todo_id is not None or communication_id is not None
    now = utc_now_naive()
    if not deduplicated and row.target_kind == "project_todo":
        content = row.title
        if row.draft:
            content = f"{row.title}：{row.draft}"
        todo = ProjectTodo(
            project_id=project_id,
            content=content[:MAX_TODO_CHARS],
            is_done=False,
            due_date=row.due_date or None,
            assigned_to_user_id=row.owner_user_id,
            created_at=now,
            updated_at=now,
        )
        session.add(todo)
        session.flush()
        todo_id = int(todo.id or 0)
        row.target_todo_id = todo_id
        mark_project_memory_stale(
            session,
            project_id,
            trigger="question_remediation_todo_confirmed",
            commit=False,
        )
    elif not deduplicated:
        request = ProjectCommunicationRequest(
            project_id=project_id,
            source_promotion_id=int(row.id or 0),
            question_sha256=row.question_sha256,
            subject=row.title,
            body=row.draft,
            recipient_label=row.recipient_label,
            owner_user_id=row.owner_user_id,
            due_date=row.due_date,
            status="ready_for_manual_send",
            delivery_mode="manual_only",
            created_by_user_id=int(actor.id or actor_user_id),
            created_at=now,
            updated_at=now,
        )
        session.add(request)
        session.flush()
        communication_id = int(request.id or 0)

    row.status = "confirmed"
    row.revision = int(row.revision) + 1
    row.decided_by_user_id = int(actor.id or actor_user_id)
    row.decided_at = now
    row.updated_at = now
    row.decision_reason = "deduplicated_exact_effect" if deduplicated else "confirmed_by_user"
    if todo_id is not None:
        row.target_todo_id = todo_id
    session.add(row)
    session.add(
        _event(
            row,
            action="confirmed",
            actor_user_id=actor_user_id,
            target_todo_id=todo_id,
            communication_request_id=communication_id,
            note=row.decision_reason,
        )
    )
    session.commit()
    session.refresh(row)
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")
    return serialize_project_question_remediation_promotion(session, row)


def reject_project_question_remediation_promotion(
    session: Session,
    *,
    project_id: int,
    question_sha256: str,
    promotion_id: int,
    actor_user_id: int,
    snapshot_sha256: str,
    expected_revision: int,
    reason: str = "",
) -> dict[str, Any]:
    """Reject an exact pending preview without creating any target."""

    identity = _sha256(question_sha256, field="question_sha256")
    requested_snapshot = _sha256(snapshot_sha256, field="snapshot_sha256")
    lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    row = _locked_promotion(
        session,
        project_id=project_id,
        question_sha256=identity,
        promotion_id=promotion_id,
    )
    if requested_snapshot != row.snapshot_sha256:
        raise HTTPException(status_code=409, detail="Preview snapshot changed; reload and retry.")
    _assert_snapshot_integrity(session, row, actor_user_id=actor_user_id)
    if row.status == "rejected":
        return serialize_project_question_remediation_promotion(session, row)
    if row.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=409, detail=f"Promotion is already {row.status}.")
    if int(row.revision) != int(expected_revision):
        raise HTTPException(status_code=409, detail="Promotion revision changed; reload and retry.")

    now = utc_now_naive()
    row.status = "rejected"
    row.revision = int(row.revision) + 1
    row.decided_by_user_id = actor_user_id
    row.decision_reason = _single_line(reason, MAX_REASON_CHARS) or "rejected_by_user"
    row.decided_at = now
    row.updated_at = now
    session.add(row)
    session.add(
        _event(
            row,
            action="rejected",
            actor_user_id=actor_user_id,
            note=row.decision_reason,
        )
    )
    session.commit()
    session.refresh(row)
    return serialize_project_question_remediation_promotion(session, row)


def list_project_question_remediation_promotions(
    session: Session,
    *,
    project_id: int,
    question_sha256: str,
    actor_user_id: int,
    limit: int = 20,
) -> dict[str, Any]:
    """List bounded promotion history after project-write authorization."""

    identity = _sha256(question_sha256, field="question_sha256")
    lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    rows = session.exec(
        select(ProjectQuestionRemediationPromotion)
        .where(
            ProjectQuestionRemediationPromotion.project_id == project_id,
            ProjectQuestionRemediationPromotion.question_sha256 == identity,
        )
        .order_by(ProjectQuestionRemediationPromotion.created_at.desc())
        .limit(max(1, min(int(limit), 50)))
    ).all()
    return {
        "schema_version": PROMOTION_SCHEMA_VERSION,
        "project_id": project_id,
        "question_sha256": identity,
        "items": [
            serialize_project_question_remediation_promotion(session, row)
            for row in rows
        ],
        "count": len(rows),
        "outbound_delivery": False,
    }
