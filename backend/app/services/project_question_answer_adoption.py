"""Evidence-bound human adoption of one project-question answer.

This module adapts two narrow structural ideas from OpenAI Codex at upstream
commit ``986ff1cc7ced0081ec5014b700a376333d87f869`` (Apache-2.0): review
lifecycles target a stable item identity
(``codex-rs/protocol/src/approvals.rs``), and durable terminal items—not
transient UI events—are authoritative
(``codex-rs/rollout/src/policy.rs``).

Modified for AriaAI on 2026-09-02.  Aria prepares a content-safe adoption
snapshot for one persisted Assistant Message, revalidates that snapshot under
the final project write lock, and records the confirmed snapshot inside the
existing append-only resolution event note.  Historical answer text is never
rewritten; the preview does not resolve a question; and no Codex runtime,
protocol, SDK, process, account, or API is imported or contacted.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    Conversation,
    Message,
    Project,
    ProjectQuestionRemediationEvidenceAttachment,
    ProjectQuestionRemediationEvidenceReview,
    ProjectQuestionRemediationExecution,
    ProjectQuestionResolution,
    ProjectQuestionResolutionEvent,
)
from app.services.memory_slots import load_project_memory_slot_view
from app.services.project_contexts import get_project_memory_payload
from app.services.project_question_evidence import (
    build_project_question_evidence_review,
    project_question_evidence_identity_fingerprint,
)
from app.services.project_question_resolutions import (
    normalize_project_question,
    project_question_sha256,
)


ANSWER_ADOPTION_SCHEMA_VERSION = 1
MAX_ADOPTION_WARNINGS = 8
_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


@dataclass(frozen=True)
class ProjectQuestionAnswerAdoptionSnapshot:
    public: dict[str, Any]
    audit: dict[str, Any]


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _text_sha256(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def _single_line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def build_project_question_answer_adoption_contract() -> dict[str, Any]:
    return {
        "name": "project_question_answer_adoption",
        "preview_resolves_question": False,
        "requires_explicit_confirmation": True,
        "reauthorizes_on_confirmation": True,
        "rechecks_current_question": True,
        "rechecks_answer_content": True,
        "rechecks_current_evidence_basis": True,
        "confirmation_resolves_question": True,
        "mutates_historical_messages": False,
        "writes_long_term_memory_before_confirmation": False,
        "sends_messages": False,
        "executes_tools": False,
        "is_correctness_verdict": False,
    }


def _require_current_open_question(
    session: Session,
    *,
    project: Project,
    question: str,
    question_sha256: str,
) -> tuple[str, int, int]:
    normalized = normalize_project_question(question)
    identity = project_question_sha256(normalized)
    if not normalized or identity != str(question_sha256 or "").lower():
        raise HTTPException(status_code=400, detail="Question identity does not match")
    memory_version = int(project.memory_version or 0)
    memory, slot_states = load_project_memory_slot_view(
        session,
        project,
        get_project_memory_payload(project),
    )
    slot = slot_states.get("open_questions") or {}
    if (
        memory_version <= 0
        or project.memory_stale
        or slot.get("status") != "ready"
        or int(slot.get("aggregate_memory_version") or 0) != memory_version
    ):
        raise HTTPException(
            status_code=409,
            detail="Open questions are stale; rebuild project memory before adopting an answer.",
        )
    raw_questions = memory.get("open_questions")
    open_identities = {
        project_question_sha256(item)
        for raw in (raw_questions if isinstance(raw_questions, list) else [])
        if (item := normalize_project_question(str(raw or "")))
    }
    if identity not in open_identities:
        raise HTTPException(status_code=409, detail="This project question is no longer open")
    return normalized, memory_version, int(slot.get("slot_version") or 0)


def _assessment_audit(assessment: dict[str, Any]) -> dict[str, Any]:
    evidence = assessment.get("evidence")
    evidence = evidence if isinstance(evidence, dict) else {}
    run = assessment.get("run_evaluation")
    run = run if isinstance(run, dict) else {}
    feedback = assessment.get("feedback")
    feedback = feedback if isinstance(feedback, dict) else {}
    warnings = [
        _single_line(item, 80)
        for item in list(assessment.get("warnings") or [])[:MAX_ADOPTION_WARNINGS]
        if _single_line(item, 80)
    ]
    return {
        "readiness_score": max(0, min(100, int(assessment.get("readiness_score") or 0))),
        "readiness_band": str(assessment.get("readiness_band") or "unrated"),
        "warnings": warnings,
        "evidence_status": str(evidence.get("status") or "not_available"),
        "cited_count": max(0, int(evidence.get("cited_count") or 0)),
        "question_aligned_count": max(
            0, int(evidence.get("question_aligned_count") or 0)
        ),
        "verified_aligned_count": max(
            0, int(evidence.get("verified_aligned_count") or 0)
        ),
        "invalid_citation_count": max(
            0, int(evidence.get("invalid_citation_count") or 0)
        ),
        "run_verdict": str(run.get("verdict") or ""),
        "feedback_rating": str(feedback.get("rating") or ""),
        "requires_human_confirmation": True,
        "is_correctness_verdict": False,
    }


def build_project_question_answer_adoption_snapshot(
    session: Session,
    *,
    project: Project,
    question: str,
    question_sha256: str,
    answer_message_id: int,
    resolution_summary: str,
) -> ProjectQuestionAnswerAdoptionSnapshot:
    """Prepare an exact, side-effect-free answer-adoption snapshot."""

    normalized_question, memory_version, slot_version = _require_current_open_question(
        session,
        project=project,
        question=question,
        question_sha256=question_sha256,
    )
    normalized_summary = _single_line(resolution_summary, 600)
    if not normalized_summary:
        raise HTTPException(status_code=400, detail="A resolution summary is required")
    project_id = int(project.id or 0)
    row = session.exec(
        select(Message, Conversation)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.id == int(answer_message_id),
            Message.role == "assistant",
            Conversation.project_id == project_id,
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=409,
            detail="The selected Assistant answer is unavailable or outside this project.",
        )
    message, conversation = row
    review = build_project_question_evidence_review(
        session,
        project=project,
        question=normalized_question,
        question_sha256=question_sha256,
        focus_message_id=int(answer_message_id),
    )
    candidate = next(
        (
            item
            for item in list(review.get("candidates") or [])
            if int(item.get("message_id") or 0) == int(answer_message_id)
        ),
        None,
    )
    if candidate is None:
        raise HTTPException(
            status_code=409,
            detail="The selected answer could not be included in the current bounded review.",
        )
    assessment = candidate.get("assessment")
    assessment = assessment if isinstance(assessment, dict) else {}
    assessment_audit = _assessment_audit(assessment)
    question_evidence = review.get("question_evidence")
    question_evidence = question_evidence if isinstance(question_evidence, dict) else {}
    evidence_identity = project_question_evidence_identity_fingerprint(question_evidence)
    attachment_identity = project_question_evidence_identity_fingerprint(
        question_evidence,
        collections=("attachments",),
    )
    answer_content_sha256 = _text_sha256(str(message.content or ""))
    summary_sha256 = _text_sha256(normalized_summary)
    snapshot_core = {
        "domain": "aria.project-question-answer-adoption.v1",
        "project_id": project_id,
        "question_sha256": question_sha256,
        "memory_version": memory_version,
        "slot_version": slot_version,
        "answer_message_id": int(message.id or 0),
        "answer_conversation_id": int(conversation.id or 0),
        "answer_content_sha256": answer_content_sha256,
        "resolution_summary_sha256": summary_sha256,
        "evidence_identity_fingerprint": evidence_identity,
        "attachment_evidence_identity_fingerprint": attachment_identity,
        "assessment": assessment_audit,
    }
    snapshot_sha256 = _sha256(snapshot_core)
    audit = {
        "schema_version": ANSWER_ADOPTION_SCHEMA_VERSION,
        "snapshot_sha256": snapshot_sha256,
        **snapshot_core,
    }
    public = {
        "schema_version": ANSWER_ADOPTION_SCHEMA_VERSION,
        "project_id": project_id,
        "question": normalized_question,
        "question_sha256": question_sha256,
        "memory_version": memory_version,
        "slot_version": slot_version,
        "snapshot_sha256": snapshot_sha256,
        "resolution_summary": normalized_summary,
        "answer": {
            "message_id": int(message.id or 0),
            "conversation_id": int(conversation.id or 0),
            "conversation_title": _single_line(conversation.title, 160) or "未命名对话",
            "preview": _single_line(message.content, 280) or "（该回答没有可显示的文本预览）",
            "created_at": message.created_at.isoformat() if message.created_at else "",
            "content_sha256": answer_content_sha256,
        },
        "evidence_identity_fingerprint": evidence_identity,
        "attachment_evidence_identity_fingerprint": attachment_identity,
        "assessment": assessment,
        "contract": build_project_question_answer_adoption_contract(),
        "privacy": {
            "includes_bounded_answer_preview": True,
            "includes_full_answer_content": False,
            "includes_retrieved_chunk_content": False,
            "includes_bounded_source_metadata": True,
            "includes_prompt_content": False,
            "includes_tool_inputs": False,
            "includes_tool_outputs": False,
            "includes_hidden_reasoning": False,
        },
    }
    return ProjectQuestionAnswerAdoptionSnapshot(public=public, audit=audit)


def encode_project_question_resolution_event_note(
    resolution_summary: str,
    adoption_audit: dict[str, Any],
) -> str:
    """Encode a backward-readable append-only resolution audit envelope."""

    return _canonical_json(
        {
            "schema_version": ANSWER_ADOPTION_SCHEMA_VERSION,
            "kind": "project_question_resolution_audit",
            "resolution_summary": _single_line(resolution_summary, 600),
            "answer_adoption": adoption_audit,
        }
    )


def parse_project_question_resolution_event_note(value: Any) -> dict[str, Any]:
    """Parse v1 audit envelopes while preserving historical plain-text notes."""

    raw = str(value or "")
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        payload = None
    if not isinstance(payload, dict) or payload.get("kind") != "project_question_resolution_audit":
        return {"resolution_summary": raw, "answer_adoption": None}
    summary = _single_line(payload.get("resolution_summary"), 600)
    adoption = payload.get("answer_adoption")
    if not isinstance(adoption, dict):
        return {"resolution_summary": summary, "answer_adoption": None}
    if adoption.get("schema_version") != ANSWER_ADOPTION_SCHEMA_VERSION:
        return {"resolution_summary": summary, "answer_adoption": None}
    required_hashes = (
        "snapshot_sha256",
        "answer_content_sha256",
        "resolution_summary_sha256",
        "evidence_identity_fingerprint",
        "attachment_evidence_identity_fingerprint",
    )
    if any(
        not _SHA256_PATTERN.fullmatch(str(adoption.get(key) or "").lower())
        for key in required_hashes
    ):
        return {"resolution_summary": summary, "answer_adoption": None}
    return {"resolution_summary": summary, "answer_adoption": dict(adoption)}


def _current_attachment_fingerprints(
    session: Session,
    *,
    project_ids: set[int],
    question_hashes: set[str],
) -> dict[tuple[int, str], str]:
    grouped: dict[tuple[int, str], list[dict[str, Any]]] = {
        (project_id, question_hash): []
        for project_id in project_ids
        for question_hash in question_hashes
    }
    if not project_ids or not question_hashes:
        return {}
    rows = session.exec(
        select(
            ProjectQuestionRemediationEvidenceAttachment,
            ProjectQuestionRemediationExecution,
            ProjectQuestionRemediationEvidenceReview,
        )
        .join(
            ProjectQuestionRemediationExecution,
            ProjectQuestionRemediationExecution.id
            == ProjectQuestionRemediationEvidenceAttachment.execution_id,
        )
        .outerjoin(
            ProjectQuestionRemediationEvidenceReview,
            ProjectQuestionRemediationEvidenceReview.attachment_id
            == ProjectQuestionRemediationEvidenceAttachment.id,
        )
        .where(
            ProjectQuestionRemediationEvidenceAttachment.project_id.in_(project_ids),
            ProjectQuestionRemediationEvidenceAttachment.question_sha256.in_(question_hashes),
            ProjectQuestionRemediationExecution.status != "cancelled",
        )
        .order_by(ProjectQuestionRemediationEvidenceAttachment.id)
        .limit(5_000)
    ).all()
    for attachment, _execution, review in rows:
        review_status = (
            "not_required"
            if attachment.support_level == "direct"
            else str(review.status)
            if review is not None
            else "pending"
        )
        review_revision = (
            0
            if attachment.support_level == "direct"
            else int(review.revision or 0)
            if review is not None
            else 0
        )
        grouped.setdefault(
            (int(attachment.project_id), str(attachment.question_sha256)), []
        ).append(
            {
                "source_type": "remediation_attachment",
                "evidence_id": f"remediation_attachment_{attachment.evidence_sha256}",
                "support_level": attachment.support_level,
                "review_status": review_status,
                "review_revision": review_revision,
            }
        )
    return {
        key: project_question_evidence_identity_fingerprint(
            {"attachments": {"sources": sources}},
            collections=("attachments",),
        )
        for key, sources in grouped.items()
    }


def build_project_question_resolution_adoption_projections(
    session: Session,
    resolutions: Iterable[ProjectQuestionResolution],
) -> dict[int, dict[str, Any]]:
    """Reconstruct bounded adoption integrity from authoritative event rows."""

    rows = list(resolutions)
    resolution_ids = [int(row.id or 0) for row in rows if row.id is not None]
    if not resolution_ids:
        return {}
    events = session.exec(
        select(ProjectQuestionResolutionEvent).where(
            ProjectQuestionResolutionEvent.resolution_id.in_(resolution_ids),
            ProjectQuestionResolutionEvent.action == "resolved",
        )
    ).all()
    events_by_revision = {
        (int(event.resolution_id), int(event.resolution_revision)): event
        for event in events
    }
    message_ids = {
        int(row.answer_message_id)
        for row in rows
        if row.answer_message_id is not None
    }
    messages = (
        session.exec(select(Message).where(Message.id.in_(message_ids))).all()
        if message_ids
        else []
    )
    messages_by_id = {int(message.id or 0): message for message in messages}
    parsed_by_resolution: dict[int, dict[str, Any]] = {}
    project_ids: set[int] = set()
    question_hashes: set[str] = set()
    for row in rows:
        resolution_id = int(row.id or 0)
        event = events_by_revision.get(
            (resolution_id, int(row.resolution_revision or 0))
        )
        parsed = parse_project_question_resolution_event_note(event.note if event else "")
        parsed_by_resolution[resolution_id] = parsed
        if parsed.get("answer_adoption") is not None:
            project_ids.add(int(row.project_id))
            question_hashes.add(str(row.question_sha256))
    attachment_fingerprints = _current_attachment_fingerprints(
        session,
        project_ids=project_ids,
        question_hashes=question_hashes,
    )

    result: dict[int, dict[str, Any]] = {}
    for row in rows:
        resolution_id = int(row.id or 0)
        adoption = parsed_by_resolution[resolution_id].get("answer_adoption")
        if not isinstance(adoption, dict):
            result[resolution_id] = {
                "status": "legacy_unbound",
                "integrity_review_reason": "",
                "answer_content_bound": False,
                "evidence_basis_bound": False,
                "requires_human_confirmation": True,
                "is_correctness_verdict": False,
            }
            continue
        message = messages_by_id.get(int(row.answer_message_id or 0))
        if message is None:
            status = "answer_unavailable"
            reason = "answer_unavailable"
        elif _text_sha256(str(message.content or "")) != adoption["answer_content_sha256"]:
            status = "answer_changed"
            reason = "answer_changed"
        elif attachment_fingerprints.get(
            (int(row.project_id), str(row.question_sha256))
        ) != adoption["attachment_evidence_identity_fingerprint"]:
            status = "evidence_changed"
            reason = "answer_evidence_changed"
        else:
            status = "bound"
            reason = ""
        assessment = adoption.get("assessment")
        assessment = assessment if isinstance(assessment, dict) else {}
        result[resolution_id] = {
            "status": status,
            "integrity_review_reason": reason,
            "snapshot_sha256": adoption["snapshot_sha256"],
            "answer_content_sha256": adoption["answer_content_sha256"],
            "evidence_identity_fingerprint": adoption["evidence_identity_fingerprint"],
            "readiness_score": max(0, min(100, int(assessment.get("readiness_score") or 0))),
            "readiness_band": str(assessment.get("readiness_band") or "unrated"),
            "warnings": list(assessment.get("warnings") or [])[:MAX_ADOPTION_WARNINGS],
            "answer_content_bound": True,
            "evidence_basis_bound": True,
            "requires_human_confirmation": True,
            "is_correctness_verdict": False,
        }
    return result
