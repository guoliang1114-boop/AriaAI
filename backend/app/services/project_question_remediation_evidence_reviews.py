"""Human adjudication for review-required remediation evidence.

The review ledger records a project member's bounded judgment about an
immutable attachment.  Acceptance makes the attachment eligible as supporting
context, but it is not a truth verdict, a memory fact, external delivery, or
question resolution.

The separation of immutable evidence from a bounded review judgment adapts the
structural principle in OpenAI Codex
``codex-rs/core/src/context/guardian_review_evidence.rs`` at commit
``99660ab3c7b861c916e467581fa9b8723504d66b`` (Apache-2.0).  Aria's
implementation is an original Python/SQLModel project-ACL ledger with
optimistic revisions and business audit events; it does not import or connect
to Codex.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    ProjectQuestionRemediationEvidenceAttachment,
    ProjectQuestionRemediationEvidenceReview,
    ProjectQuestionRemediationEvidenceReviewEvent,
    ProjectQuestionRemediationExecution,
)
from app.services.project_core import lock_and_require_project_write
from app.services.time_utils import utc_now_naive


REVIEW_SCHEMA_VERSION = 1
MAX_REVIEW_REASON_CHARS = 600
MAX_REVIEW_HISTORY = 20
MAX_LOADED_REVIEW_EVENTS = 1001
REVIEW_DECISIONS = {"accepted", "rejected"}


def _single_line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def build_remediation_evidence_review_contract() -> dict[str, Any]:
    """Return the machine-checkable Phase 3X safety boundary."""

    return {
        "name": "project_question_remediation_evidence_review",
        "human_judgment_only": True,
        "acceptance_is_truth_verdict": False,
        "writes_long_term_memory": False,
        "fetches_external_references": False,
        "sends_messages": False,
        "executes_tools": False,
        "automatically_resolves_question": False,
        "reauthorizes_on_decision": True,
        "uses_optimistic_revision": True,
        "events_are_append_only": True,
    }


def _event_payload(
    row: ProjectQuestionRemediationEvidenceReviewEvent,
) -> dict[str, Any]:
    return {
        "id": row.id,
        "revision": row.revision,
        "previous_status": row.previous_status,
        "status": row.status,
        "actor_user_id": row.actor_user_id,
        "reason": row.reason,
        "created_at": row.created_at,
    }


def evidence_review_projections(
    session: Session,
    attachments: Iterable[ProjectQuestionRemediationEvidenceAttachment],
) -> dict[int, dict[str, Any]]:
    """Build bounded review projections for an attachment collection."""

    attachment_rows = list(attachments)
    attachment_ids = [int(row.id or 0) for row in attachment_rows if row.id is not None]
    reviews = []
    if attachment_ids:
        reviews = session.exec(
            select(ProjectQuestionRemediationEvidenceReview).where(
                ProjectQuestionRemediationEvidenceReview.attachment_id.in_(attachment_ids)
            )
        ).all()
    reviews_by_attachment = {int(row.attachment_id): row for row in reviews}

    events_by_review: dict[int, list[ProjectQuestionRemediationEvidenceReviewEvent]] = (
        defaultdict(list)
    )
    truncated_review_ids: set[int] = set()
    events_truncated = False
    review_ids = [int(row.id or 0) for row in reviews if row.id is not None]
    if review_ids:
        events = session.exec(
            select(ProjectQuestionRemediationEvidenceReviewEvent)
            .where(
                ProjectQuestionRemediationEvidenceReviewEvent.review_id.in_(review_ids)
            )
            .order_by(
                ProjectQuestionRemediationEvidenceReviewEvent.created_at.desc(),
                ProjectQuestionRemediationEvidenceReviewEvent.id.desc(),
            )
            .limit(MAX_LOADED_REVIEW_EVENTS)
        ).all()
        events_truncated = len(events) >= MAX_LOADED_REVIEW_EVENTS
        for event in events:
            review_id = int(event.review_id)
            group = events_by_review[review_id]
            if len(group) < MAX_REVIEW_HISTORY:
                group.append(event)
            else:
                truncated_review_ids.add(review_id)

    projections: dict[int, dict[str, Any]] = {}
    for attachment in attachment_rows:
        attachment_id = int(attachment.id or 0)
        if attachment.support_level == "direct":
            projections[attachment_id] = {
                "schema_version": REVIEW_SCHEMA_VERSION,
                "status": "not_required",
                "revision": 0,
                "reason": "",
                "reviewed_by_user_id": None,
                "reviewed_at": None,
                "history": [],
                "history_truncated": False,
                "allowed_decisions": [],
                "human_judgment_only": True,
                "acceptance_is_truth_verdict": False,
            }
            continue
        review = reviews_by_attachment.get(attachment_id)
        if review is None:
            projections[attachment_id] = {
                "schema_version": REVIEW_SCHEMA_VERSION,
                "status": "pending",
                "revision": 0,
                "reason": "",
                "reviewed_by_user_id": None,
                "reviewed_at": None,
                "history": [],
                "history_truncated": False,
                "allowed_decisions": ["accepted", "rejected"],
                "human_judgment_only": True,
                "acceptance_is_truth_verdict": False,
            }
            continue
        review_events = events_by_review.get(int(review.id or 0), [])
        projections[attachment_id] = {
            "schema_version": REVIEW_SCHEMA_VERSION,
            "status": review.status,
            "revision": review.revision,
            "reason": review.reason,
            "reviewed_by_user_id": review.reviewed_by_user_id,
            "reviewed_at": review.reviewed_at,
            "history": [
                _event_payload(item) for item in review_events[:MAX_REVIEW_HISTORY]
            ],
            "history_truncated": (
                events_truncated or int(review.id or 0) in truncated_review_ids
            ),
            "allowed_decisions": ["accepted", "rejected"],
            "human_judgment_only": True,
            "acceptance_is_truth_verdict": False,
        }
    return projections


def review_project_question_remediation_evidence(
    session: Session,
    *,
    project_id: int,
    execution_id: int,
    attachment_id: int,
    actor_user_id: int,
    decision: str,
    expected_revision: int,
    reason: str,
) -> dict[str, Any]:
    """Accept or reject one review-required attachment with CAS and audit."""

    normalized_decision = _single_line(decision, 40)
    normalized_reason = _single_line(reason, MAX_REVIEW_REASON_CHARS)
    if normalized_decision not in REVIEW_DECISIONS:
        raise HTTPException(status_code=400, detail="Unsupported evidence review decision")
    if not normalized_reason:
        raise HTTPException(status_code=400, detail="An evidence review reason is required")
    if int(expected_revision) < 0:
        raise HTTPException(status_code=400, detail="Invalid evidence review revision")

    lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    execution = session.exec(
        select(ProjectQuestionRemediationExecution)
        .where(
            ProjectQuestionRemediationExecution.id == execution_id,
            ProjectQuestionRemediationExecution.project_id == project_id,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if execution is None:
        raise HTTPException(status_code=404, detail="Remediation execution not found")
    if execution.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled execution evidence cannot be reviewed")
    attachment = session.exec(
        select(ProjectQuestionRemediationEvidenceAttachment)
        .where(
            ProjectQuestionRemediationEvidenceAttachment.id == attachment_id,
            ProjectQuestionRemediationEvidenceAttachment.execution_id == execution_id,
            ProjectQuestionRemediationEvidenceAttachment.project_id == project_id,
            ProjectQuestionRemediationEvidenceAttachment.question_sha256
            == execution.question_sha256,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if attachment is None:
        raise HTTPException(status_code=404, detail="Remediation evidence not found")
    if attachment.support_level != "review_required":
        raise HTTPException(
            status_code=409,
            detail="Direct project evidence does not require human adjudication",
        )

    review = session.exec(
        select(ProjectQuestionRemediationEvidenceReview)
        .where(ProjectQuestionRemediationEvidenceReview.attachment_id == attachment_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if (
        review is not None
        and review.status == normalized_decision
        and review.reason == normalized_reason
    ):
        return evidence_review_projections(session, [attachment])[attachment_id]

    actual_revision = int(review.revision) if review is not None else 0
    if actual_revision != int(expected_revision):
        raise HTTPException(
            status_code=409,
            detail="Evidence review revision changed; reload and retry.",
        )

    now = utc_now_naive()
    previous_status = review.status if review is not None else "pending"
    next_revision = actual_revision + 1
    if review is None:
        review = ProjectQuestionRemediationEvidenceReview(
            attachment_id=attachment_id,
            execution_id=execution_id,
            project_id=project_id,
            question_sha256=attachment.question_sha256,
            evidence_sha256=attachment.evidence_sha256,
            status=normalized_decision,
            revision=next_revision,
            reason=normalized_reason,
            reviewed_by_user_id=actor_user_id,
            reviewed_at=now,
            created_at=now,
            updated_at=now,
        )
    else:
        if (
            review.execution_id != execution_id
            or review.project_id != project_id
            or review.question_sha256 != attachment.question_sha256
            or review.evidence_sha256 != attachment.evidence_sha256
        ):
            raise HTTPException(status_code=409, detail="Evidence review scope is inconsistent")
        review.status = normalized_decision
        review.revision = next_revision
        review.reason = normalized_reason
        review.reviewed_by_user_id = actor_user_id
        review.reviewed_at = now
        review.updated_at = now
    session.add(review)
    session.flush()
    session.add(
        ProjectQuestionRemediationEvidenceReviewEvent(
            review_id=int(review.id or 0),
            attachment_id=attachment_id,
            execution_id=execution_id,
            project_id=project_id,
            revision=next_revision,
            previous_status=previous_status,
            status=normalized_decision,
            evidence_sha256=attachment.evidence_sha256,
            actor_user_id=actor_user_id,
            reason=normalized_reason,
            created_at=now,
        )
    )
    session.commit()
    session.refresh(review)
    return evidence_review_projections(session, [attachment])[attachment_id]
