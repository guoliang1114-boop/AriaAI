"""Aria-native artifact business checks and human delivery sign-off.

The registry in this module only evaluates bounded declarative rules owned by
Aria.  It cannot import or execute Skill package code, macros, shell commands,
or arbitrary callables.  Semantic completion criteria that do not map to a
registered rule remain a human review responsibility.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    ArtifactAcceptanceReview,
    ArtifactAcceptanceReviewEvent,
    ArtifactVerification,
    GeneratedFile,
)
from app.services.agent_harness.artifact_verification import (
    artifact_verification_reference,
)
from app.services.time_utils import utc_now_naive


ARTIFACT_ACCEPTANCE_SCHEMA_VERSION = 1
BUSINESS_VERIFIER_REGISTRY_VERSION = 1
MAX_ACCEPTANCE_REASON_CHARS = 600
MAX_ACCEPTANCE_HISTORY = 20
MAX_BUSINESS_REQUIREMENTS = 16
MAX_BUSINESS_THRESHOLD = 1_000_000
ACCEPTANCE_DECISIONS = frozenset({"accepted", "rejected"})


@dataclass(frozen=True)
class ArtifactBusinessVerifier:
    """One safe metric threshold understood by Aria's own runtime."""

    verifier_id: str
    metric: str
    supported_file_types: tuple[str, ...]
    description: str


_BUSINESS_VERIFIERS: tuple[ArtifactBusinessVerifier, ...] = (
    ArtifactBusinessVerifier(
        "min_slide_count",
        "slide_count",
        ("pptx",),
        "Presentation contains at least the declared number of slides.",
    ),
    ArtifactBusinessVerifier(
        "min_worksheet_count",
        "worksheet_count",
        ("xlsx",),
        "Workbook contains at least the declared number of worksheets.",
    ),
    ArtifactBusinessVerifier(
        "min_page_count",
        "page_count",
        ("pdf",),
        "PDF contains at least the declared number of pages.",
    ),
    ArtifactBusinessVerifier(
        "min_paragraph_count",
        "paragraph_count",
        ("docx",),
        "Document contains at least the declared number of paragraphs.",
    ),
    ArtifactBusinessVerifier(
        "min_line_count",
        "line_count",
        ("md", "markdown", "txt", "json", "csv", "html"),
        "Text deliverable contains at least the declared number of lines.",
    ),
    ArtifactBusinessVerifier(
        "min_row_count",
        "row_count",
        ("csv",),
        "CSV deliverable contains at least the declared number of rows.",
    ),
    ArtifactBusinessVerifier(
        "min_width_px",
        "width_px",
        ("png", "jpg", "jpeg"),
        "Image width meets the declared minimum.",
    ),
    ArtifactBusinessVerifier(
        "min_height_px",
        "height_px",
        ("png", "jpg", "jpeg"),
        "Image height meets the declared minimum.",
    ),
)
_BUSINESS_VERIFIERS_BY_ID = {
    item.verifier_id: item for item in _BUSINESS_VERIFIERS
}


def registered_artifact_business_verifiers() -> dict[str, Any]:
    """Return the content-free public registry manifest."""

    return {
        "schema_version": ARTIFACT_ACCEPTANCE_SCHEMA_VERSION,
        "registry_version": BUSINESS_VERIFIER_REGISTRY_VERSION,
        "execution_boundary": "aria_owned_declarative_rules_only",
        "skill_package_code_executable": False,
        "items": [
            {
                "verifier_id": item.verifier_id,
                "metric": item.metric,
                "supported_file_types": list(item.supported_file_types),
                "description": item.description,
            }
            for item in _BUSINESS_VERIFIERS
        ],
    }


def run_registered_artifact_business_verifiers(
    verification: dict[str, Any],
    requirements: Iterable[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Evaluate only whitelisted metric thresholds against bounded evidence."""

    raw_requirements = list(requirements or ())[:MAX_BUSINESS_REQUIREMENTS]
    if not raw_requirements:
        return {
            "schema_version": ARTIFACT_ACCEPTANCE_SCHEMA_VERSION,
            "registry_version": BUSINESS_VERIFIER_REGISTRY_VERSION,
            "status": "not_configured",
            "check_count": 0,
            "passed_count": 0,
            "failed_count": 0,
            "skipped_count": 0,
            "checks": [],
        }

    metrics = verification.get("metrics")
    if not isinstance(metrics, dict):
        metrics = {}
    checks: list[dict[str, Any]] = []
    for position, requirement in enumerate(raw_requirements):
        if not isinstance(requirement, dict):
            checks.append(
                {
                    "position": position,
                    "status": "skipped",
                    "code": "invalid_requirement",
                }
            )
            continue
        verifier_id = str(requirement.get("verifier_id") or "")[:80]
        verifier = _BUSINESS_VERIFIERS_BY_ID.get(verifier_id)
        if verifier is None:
            checks.append(
                {
                    "position": position,
                    "verifier_id": verifier_id,
                    "status": "skipped",
                    "code": "verifier_not_registered",
                }
            )
            continue
        try:
            expected_min = int(requirement.get("expected_min"))
        except (TypeError, ValueError):
            expected_min = 0
        if expected_min < 1 or expected_min > MAX_BUSINESS_THRESHOLD:
            checks.append(
                {
                    "position": position,
                    "verifier_id": verifier_id,
                    "metric": verifier.metric,
                    "status": "skipped",
                    "code": "invalid_threshold",
                }
            )
            continue
        try:
            actual = int(metrics[verifier.metric])
        except (KeyError, TypeError, ValueError):
            checks.append(
                {
                    "position": position,
                    "verifier_id": verifier_id,
                    "metric": verifier.metric,
                    "expected_min": expected_min,
                    "status": "skipped",
                    "code": "metric_unavailable",
                }
            )
            continue
        checks.append(
            {
                "position": position,
                "verifier_id": verifier_id,
                "metric": verifier.metric,
                "expected_min": expected_min,
                "actual": max(0, actual),
                "status": "passed" if actual >= expected_min else "failed",
            }
        )

    passed_count = sum(item["status"] == "passed" for item in checks)
    failed_count = sum(item["status"] == "failed" for item in checks)
    skipped_count = sum(item["status"] == "skipped" for item in checks)
    status = "failed" if failed_count else "partial" if skipped_count else "passed"
    return {
        "schema_version": ARTIFACT_ACCEPTANCE_SCHEMA_VERSION,
        "registry_version": BUSINESS_VERIFIER_REGISTRY_VERSION,
        "status": status,
        "check_count": len(checks),
        "passed_count": passed_count,
        "failed_count": failed_count,
        "skipped_count": skipped_count,
        "checks": checks,
    }


def build_artifact_acceptance_contract() -> dict[str, Any]:
    """Return the machine-checkable delivery sign-off safety boundary."""

    return {
        "name": "artifact_delivery_acceptance",
        "schema_version": ARTIFACT_ACCEPTANCE_SCHEMA_VERSION,
        "technical_evidence_required": True,
        "failed_or_partial_evidence_can_be_accepted": False,
        "human_judgment_only": True,
        "acceptance_is_truth_verdict": False,
        "writes_long_term_memory": False,
        "executes_skill_package_code": False,
        "executes_macros_or_shell": False,
        "reauthorizes_on_decision": True,
        "uses_optimistic_revision": True,
        "events_are_append_only": True,
        "registered_verifier_count": len(_BUSINESS_VERIFIERS),
        "business_verifier_registry_version": BUSINESS_VERIFIER_REGISTRY_VERSION,
    }


def _single_line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def _latest_verification(
    session: Session,
    artifact_id: int,
    *,
    for_update: bool = False,
) -> ArtifactVerification | None:
    statement = (
        select(ArtifactVerification)
        .where(ArtifactVerification.generated_file_id == artifact_id)
        .order_by(
            ArtifactVerification.created_at.desc(),
            ArtifactVerification.id.desc(),
        )
    )
    if for_update:
        statement = statement.with_for_update()
    return session.exec(statement).first()


def _review_history(
    session: Session,
    review: ArtifactAcceptanceReview | None,
) -> list[dict[str, Any]]:
    if review is None or review.id is None:
        return []
    events = session.exec(
        select(ArtifactAcceptanceReviewEvent)
        .where(ArtifactAcceptanceReviewEvent.review_id == int(review.id))
        .order_by(
            ArtifactAcceptanceReviewEvent.created_at.desc(),
            ArtifactAcceptanceReviewEvent.id.desc(),
        )
        .limit(MAX_ACCEPTANCE_HISTORY)
    ).all()
    return [
        {
            "id": event.id,
            "revision": event.revision,
            "previous_status": event.previous_status,
            "status": event.status,
            "actor_user_id": event.actor_user_id,
            "reason": event.reason,
            "created_at": event.created_at,
        }
        for event in events
    ]


def artifact_acceptance_projection(
    session: Session,
    artifact: GeneratedFile,
    verification: ArtifactVerification | None = None,
) -> dict[str, Any]:
    """Combine immutable technical evidence and current human sign-off."""

    if artifact.id is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    verification = verification or _latest_verification(session, int(artifact.id))
    if verification is None:
        raise HTTPException(status_code=404, detail="Artifact verification not found")
    reference = artifact_verification_reference(verification)
    if not reference:
        raise HTTPException(status_code=409, detail="Artifact verification evidence is invalid")
    if reference["content_sha256"] != str(artifact.content_sha256 or "").lower():
        raise HTTPException(status_code=409, detail="Artifact verification is stale")

    review = session.exec(
        select(ArtifactAcceptanceReview).where(
            ArtifactAcceptanceReview.verification_id == int(verification.id or 0)
        )
    ).first()
    if review is not None and (
        review.generated_file_id != int(artifact.id)
        or review.content_sha256 != reference["content_sha256"]
        or review.evidence_sha256 != reference["evidence_sha256"]
        or review.verification_plan_sha256
        != str(reference.get("verification_plan_sha256") or "")
    ):
        raise HTTPException(status_code=409, detail="Artifact acceptance scope is inconsistent")

    evidence_status = str(reference["status"])
    if evidence_status in {"failed", "partial"}:
        review_status = "blocked"
        delivery_status = "blocked"
        allowed_decisions: list[str] = []
    elif evidence_status == "passed":
        review_status = "not_required"
        delivery_status = "ready"
        allowed_decisions = []
    elif review is None:
        review_status = "pending"
        delivery_status = "review_required"
        allowed_decisions = ["accepted", "rejected"]
    else:
        review_status = review.status
        delivery_status = "ready" if review.status == "accepted" else "changes_required"
        allowed_decisions = ["accepted", "rejected"]

    return {
        "schema_version": ARTIFACT_ACCEPTANCE_SCHEMA_VERSION,
        "artifact_id": int(artifact.id),
        "verification_id": int(verification.id or 0),
        "content_sha256": reference["content_sha256"],
        "evidence_sha256": reference["evidence_sha256"],
        "verification_plan_sha256": str(
            reference.get("verification_plan_sha256") or ""
        ),
        "verification_status": evidence_status,
        "technical_status": reference["technical_status"],
        "review_status": review_status,
        "delivery_status": delivery_status,
        "final_delivery_allowed": delivery_status == "ready",
        "revision": int(review.revision) if review is not None else 0,
        "reason": review.reason if review is not None else "",
        "reviewed_by_user_id": (
            review.reviewed_by_user_id if review is not None else None
        ),
        "reviewed_at": review.reviewed_at if review is not None else None,
        "history": _review_history(session, review),
        "history_limit": MAX_ACCEPTANCE_HISTORY,
        "allowed_decisions": allowed_decisions,
        "human_judgment_only": True,
        "acceptance_is_truth_verdict": False,
        "business_automation": {
            "registry_version": BUSINESS_VERIFIER_REGISTRY_VERSION,
            "status": "not_configured",
            "registered_verifier_count": len(_BUSINESS_VERIFIERS),
            "skill_package_code_executable": False,
        },
        "deliverable": (
            {
                "deliverable_id": str(artifact.deliverable_id or ""),
                "name": str(artifact.deliverable_name or ""),
                "contract_sha256": str(
                    artifact.deliverable_contract_sha256 or ""
                ),
                "catalog_sha256": str(
                    artifact.deliverable_catalog_sha256 or ""
                ),
                "skill_release_sha256": str(
                    artifact.deliverable_skill_release_sha256 or ""
                ),
            }
            if artifact.deliverable_id
            else None
        ),
    }


def review_artifact_acceptance(
    session: Session,
    *,
    artifact: GeneratedFile,
    actor_user_id: int,
    decision: str,
    expected_revision: int,
    reason: str,
) -> dict[str, Any]:
    """Accept or reject one exact verification using optimistic concurrency."""

    if artifact.id is None:
        raise HTTPException(status_code=404, detail="Artifact not found")
    normalized_decision = _single_line(decision, 40)
    normalized_reason = _single_line(reason, MAX_ACCEPTANCE_REASON_CHARS)
    if normalized_decision not in ACCEPTANCE_DECISIONS:
        raise HTTPException(status_code=400, detail="Unsupported acceptance decision")
    if not normalized_reason:
        raise HTTPException(status_code=400, detail="An acceptance reason is required")
    if int(expected_revision) < 0:
        raise HTTPException(status_code=400, detail="Invalid acceptance revision")

    verification = _latest_verification(
        session,
        int(artifact.id),
        for_update=True,
    )
    if verification is None:
        raise HTTPException(status_code=404, detail="Artifact verification not found")
    reference = artifact_verification_reference(verification)
    if not reference:
        raise HTTPException(status_code=409, detail="Artifact verification evidence is invalid")
    if reference["content_sha256"] != str(artifact.content_sha256 or "").lower():
        raise HTTPException(status_code=409, detail="Artifact verification is stale")
    if reference["status"] != "manual_required":
        raise HTTPException(
            status_code=409,
            detail="Only artifacts awaiting business acceptance can be reviewed",
        )

    review = session.exec(
        select(ArtifactAcceptanceReview)
        .where(
            ArtifactAcceptanceReview.verification_id == int(verification.id or 0)
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if (
        review is not None
        and review.status == normalized_decision
        and review.reason == normalized_reason
    ):
        return artifact_acceptance_projection(session, artifact, verification)

    actual_revision = int(review.revision) if review is not None else 0
    if actual_revision != int(expected_revision):
        raise HTTPException(
            status_code=409,
            detail="Artifact acceptance revision changed; reload and retry.",
        )

    now = utc_now_naive()
    next_revision = actual_revision + 1
    previous_status = review.status if review is not None else "pending"
    plan_sha256 = str(reference.get("verification_plan_sha256") or "")
    if review is None:
        review = ArtifactAcceptanceReview(
            generated_file_id=int(artifact.id),
            verification_id=int(verification.id or 0),
            run_id=str(artifact.run_id or "")[:96],
            output_id=str(artifact.output_id or "")[:96],
            content_sha256=reference["content_sha256"],
            evidence_sha256=reference["evidence_sha256"],
            verification_plan_sha256=plan_sha256,
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
            review.generated_file_id != int(artifact.id)
            or review.content_sha256 != reference["content_sha256"]
            or review.evidence_sha256 != reference["evidence_sha256"]
            or review.verification_plan_sha256 != plan_sha256
        ):
            raise HTTPException(
                status_code=409,
                detail="Artifact acceptance scope is inconsistent",
            )
        review.status = normalized_decision
        review.revision = next_revision
        review.reason = normalized_reason
        review.reviewed_by_user_id = actor_user_id
        review.reviewed_at = now
        review.updated_at = now
    session.add(review)
    session.flush()
    session.add(
        ArtifactAcceptanceReviewEvent(
            review_id=int(review.id or 0),
            generated_file_id=int(artifact.id),
            verification_id=int(verification.id or 0),
            revision=next_revision,
            previous_status=previous_status,
            status=normalized_decision,
            content_sha256=reference["content_sha256"],
            evidence_sha256=reference["evidence_sha256"],
            verification_plan_sha256=plan_sha256,
            actor_user_id=actor_user_id,
            reason=normalized_reason,
            created_at=now,
        )
    )
    session.commit()
    session.refresh(review)
    return artifact_acceptance_projection(session, artifact, verification)
