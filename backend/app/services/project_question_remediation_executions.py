"""Governed manual lifecycle for confirmed question-remediation targets.

The execution ledger is separate from the frozen promotion approval.  It can
record a user's attestation that a manual communication was sent, complete a
native remediation todo after evidence exists, cancel an unsatisfied manual
communication request, and attach bounded project-scoped evidence.  It cannot
send a message, invoke a tool, or resolve a project question.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from app.models.db import (
    Conversation,
    KnowledgeDocument,
    Message,
    ProjectCommunicationRequest,
    ProjectFile,
    ProjectQuestionRemediationEvidenceAttachment,
    ProjectQuestionRemediationExecution,
    ProjectQuestionRemediationExecutionEvent,
    ProjectQuestionRemediationPromotion,
    ProjectQuestionResolution,
    ProjectTodo,
)
from app.services.cache import projects_cache
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import lock_and_require_project_write
from app.services.time_utils import utc_now_naive


EXECUTION_SCHEMA_VERSION = 1
MAX_TRANSITION_NOTE_CHARS = 600
MAX_EVIDENCE_TITLE_CHARS = 160
MAX_EVIDENCE_NOTE_CHARS = 1200
MAX_REFERENCE_CHARS = 500
MAX_EVIDENCE_PER_EXECUTION = 50
MAX_EVENTS_PER_EXECUTION = 50

EXECUTION_STATUSES = {
    "active",
    "ready_for_manual_send",
    "sent_manually",
    "completed",
    "cancelled",
}
EVIDENCE_KINDS = {
    "project_file",
    "knowledge_document",
    "message",
    "external_reference",
    "manual_note",
}


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _single_line(value: Any, limit: int) -> str:
    return " ".join(str(value or "").strip().split())[:limit]


def _note(value: Any, limit: int = MAX_EVIDENCE_NOTE_CHARS) -> str:
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()[:limit]


def build_remediation_execution_contract() -> dict[str, Any]:
    """Return the machine-checkable Phase 3W safety boundary."""

    return {
        "name": "project_question_remediation_execution",
        "manual_send_is_user_attestation": True,
        "delivered_by_aria": False,
        "outbound_delivery": False,
        "sends_messages": False,
        "executes_tools": False,
        "completion_requires_evidence": True,
        "evidence_is_project_scoped": True,
        "evidence_events_are_append_only": True,
        "automatically_resolves_question": False,
    }


def _execution_event(
    execution: ProjectQuestionRemediationExecution,
    *,
    action: str,
    actor_user_id: int | None,
    note: str = "",
    evidence_attachment_id: int | None = None,
) -> ProjectQuestionRemediationExecutionEvent:
    return ProjectQuestionRemediationExecutionEvent(
        execution_id=int(execution.id or 0),
        project_id=int(execution.project_id),
        revision=int(execution.revision),
        action=action,
        status=execution.status,
        actor_user_id=actor_user_id,
        evidence_attachment_id=evidence_attachment_id,
        note=_note(note, MAX_TRANSITION_NOTE_CHARS),
        created_at=utc_now_naive(),
    )


def ensure_project_question_remediation_execution(
    session: Session,
    *,
    promotion: ProjectQuestionRemediationPromotion,
    actor_user_id: int,
    target_todo_id: int | None,
    communication_request_id: int | None,
) -> ProjectQuestionRemediationExecution:
    """Create the one execution ledger owned by an actual confirmed target."""

    query = select(ProjectQuestionRemediationExecution).where(
        ProjectQuestionRemediationExecution.project_id == promotion.project_id
    )
    if target_todo_id is not None:
        query = query.where(
            ProjectQuestionRemediationExecution.target_todo_id == target_todo_id
        )
    elif communication_request_id is not None:
        query = query.where(
            ProjectQuestionRemediationExecution.communication_request_id
            == communication_request_id
        )
    else:
        raise HTTPException(status_code=500, detail="Confirmed remediation target is missing")
    existing = session.exec(query.with_for_update()).first()
    if existing is not None:
        return existing

    if target_todo_id is not None:
        todo = session.get(ProjectTodo, target_todo_id)
        if todo is None or int(todo.project_id) != int(promotion.project_id):
            raise HTTPException(status_code=409, detail="Remediation todo is no longer available")
        target_kind = "project_todo"
        status = "completed" if todo.is_done else "active"
    else:
        request = session.get(ProjectCommunicationRequest, communication_request_id)
        if request is None or int(request.project_id) != int(promotion.project_id):
            raise HTTPException(
                status_code=409,
                detail="Remediation communication request is no longer available",
            )
        target_kind = "communication_request"
        status = request.status
        if status not in {
            "ready_for_manual_send",
            "sent_manually",
            "completed",
            "cancelled",
        }:
            raise HTTPException(status_code=409, detail="Invalid communication lifecycle status")

    now = utc_now_naive()
    execution = ProjectQuestionRemediationExecution(
        project_id=int(promotion.project_id),
        source_promotion_id=int(promotion.id or 0),
        question_text=promotion.question_text,
        question_sha256=promotion.question_sha256,
        target_kind=target_kind,
        target_todo_id=target_todo_id,
        communication_request_id=communication_request_id,
        status=status,
        revision=1,
        evidence_count=0,
        last_transition_note="confirmed_target_created",
        created_by_user_id=actor_user_id,
        last_transition_by_user_id=actor_user_id,
        last_transition_at=now,
        created_at=now,
        updated_at=now,
    )
    session.add(execution)
    session.flush()
    session.add(
        _execution_event(
            execution,
            action="created",
            actor_user_id=actor_user_id,
            note="confirmed_target_created",
        )
    )
    return execution


def _locked_execution(
    session: Session,
    *,
    project_id: int,
    execution_id: int,
) -> ProjectQuestionRemediationExecution:
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
    return execution


def _attachment_rows(
    session: Session,
    execution_id: int,
) -> tuple[list[ProjectQuestionRemediationEvidenceAttachment], bool]:
    rows = session.exec(
        select(ProjectQuestionRemediationEvidenceAttachment)
        .where(
            ProjectQuestionRemediationEvidenceAttachment.execution_id == execution_id
        )
        .order_by(
            ProjectQuestionRemediationEvidenceAttachment.attached_at.desc(),
            ProjectQuestionRemediationEvidenceAttachment.id.desc(),
        )
        .limit(MAX_EVIDENCE_PER_EXECUTION + 1)
    ).all()
    return rows[:MAX_EVIDENCE_PER_EXECUTION], len(rows) > MAX_EVIDENCE_PER_EXECUTION


def _event_rows(
    session: Session,
    execution_id: int,
) -> tuple[list[ProjectQuestionRemediationExecutionEvent], bool]:
    rows = session.exec(
        select(ProjectQuestionRemediationExecutionEvent)
        .where(ProjectQuestionRemediationExecutionEvent.execution_id == execution_id)
        .order_by(ProjectQuestionRemediationExecutionEvent.revision.desc())
        .limit(MAX_EVENTS_PER_EXECUTION + 1)
    ).all()
    return rows[:MAX_EVENTS_PER_EXECUTION], len(rows) > MAX_EVENTS_PER_EXECUTION


def serialize_remediation_evidence_attachment(
    row: ProjectQuestionRemediationEvidenceAttachment,
) -> dict[str, Any]:
    return {
        "id": row.id,
        "execution_id": row.execution_id,
        "project_id": row.project_id,
        "question_sha256": row.question_sha256,
        "execution_revision": row.execution_revision,
        "evidence_sha256": row.evidence_sha256,
        "evidence_kind": row.evidence_kind,
        "support_level": row.support_level,
        "title": row.title,
        "note": row.note,
        "reference_locator": row.reference_locator,
        "project_file_id": row.project_file_id,
        "knowledge_document_id": row.knowledge_document_id,
        "message_id": row.message_id,
        "attached_by_user_id": row.attached_by_user_id,
        "attached_at": row.attached_at,
    }


def _target_payload(
    session: Session,
    execution: ProjectQuestionRemediationExecution,
) -> dict[str, Any] | None:
    if execution.target_kind == "project_todo":
        todo = session.get(ProjectTodo, execution.target_todo_id)
        if todo is None:
            return None
        return {
            "kind": "project_todo",
            "id": todo.id,
            "content": todo.content,
            "is_done": todo.is_done,
            "due_date": todo.due_date,
            "owner_user_id": todo.assigned_to_user_id,
        }
    request = session.get(
        ProjectCommunicationRequest,
        execution.communication_request_id,
    )
    if request is None:
        return None
    return {
        "kind": "communication_request",
        "id": request.id,
        "subject": request.subject,
        "body": request.body,
        "recipient_label": request.recipient_label,
        "owner_user_id": request.owner_user_id,
        "due_date": request.due_date,
        "status": request.status,
        "delivery_mode": request.delivery_mode,
        "delivered_by_aria": False,
        "manual_delivery_attested": execution.status
        in {"sent_manually", "completed"},
    }


def _allowed_actions(execution: ProjectQuestionRemediationExecution) -> list[str]:
    if execution.target_kind == "project_todo":
        return ["attach_evidence", "complete"] if execution.status == "active" else []
    if execution.status == "ready_for_manual_send":
        return ["attach_evidence", "mark_sent", "cancel"]
    if execution.status == "sent_manually":
        return ["attach_evidence", "complete", "cancel"]
    if execution.status == "completed":
        return ["attach_evidence"]
    return []


def serialize_project_question_remediation_execution(
    session: Session,
    execution: ProjectQuestionRemediationExecution,
) -> dict[str, Any]:
    attachments, attachments_truncated = _attachment_rows(
        session,
        int(execution.id or 0),
    )
    events, events_truncated = _event_rows(session, int(execution.id or 0))
    resolution = session.exec(
        select(ProjectQuestionResolution).where(
            ProjectQuestionResolution.project_id == execution.project_id,
            ProjectQuestionResolution.question_sha256 == execution.question_sha256,
        )
    ).first()
    return {
        "schema_version": EXECUTION_SCHEMA_VERSION,
        "id": execution.id,
        "project_id": execution.project_id,
        "source_promotion_id": execution.source_promotion_id,
        "question": execution.question_text,
        "question_sha256": execution.question_sha256,
        "target_kind": execution.target_kind,
        "status": execution.status,
        "revision": execution.revision,
        "evidence_count": execution.evidence_count,
        "last_transition_note": execution.last_transition_note,
        "created_by_user_id": execution.created_by_user_id,
        "last_transition_by_user_id": execution.last_transition_by_user_id,
        "last_transition_at": execution.last_transition_at,
        "created_at": execution.created_at,
        "updated_at": execution.updated_at,
        "target": _target_payload(session, execution),
        "evidence": [
            serialize_remediation_evidence_attachment(item) for item in attachments
        ],
        "events": [
            {
                "id": item.id,
                "revision": item.revision,
                "action": item.action,
                "status": item.status,
                "actor_user_id": item.actor_user_id,
                "evidence_attachment_id": item.evidence_attachment_id,
                "note": item.note,
                "created_at": item.created_at,
            }
            for item in events
        ],
        "truncated": {
            "evidence": attachments_truncated,
            "events": events_truncated,
        },
        "allowed_actions": _allowed_actions(execution),
        "question_resolution_status": resolution.status if resolution is not None else "open",
        "contract": build_remediation_execution_contract(),
    }


def remediation_execution_summary_for_target(
    session: Session,
    *,
    target_todo_id: int | None = None,
    communication_request_id: int | None = None,
) -> dict[str, Any] | None:
    if target_todo_id is None and communication_request_id is None:
        return None
    query = select(ProjectQuestionRemediationExecution)
    if target_todo_id is not None:
        query = query.where(
            ProjectQuestionRemediationExecution.target_todo_id == target_todo_id
        )
    else:
        query = query.where(
            ProjectQuestionRemediationExecution.communication_request_id
            == communication_request_id
        )
    row = session.exec(query).first()
    if row is None:
        return None
    return {
        "id": row.id,
        "status": row.status,
        "revision": row.revision,
        "evidence_count": row.evidence_count,
        "allowed_actions": _allowed_actions(row),
        "delivered_by_aria": False,
    }


def list_project_question_remediation_executions(
    session: Session,
    *,
    project_id: int,
    actor_user_id: int,
    status: str = "",
    limit: int = 100,
) -> dict[str, Any]:
    """Return the bounded project-wide remediation execution center."""

    lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    normalized_status = _single_line(status, 40)
    if normalized_status and normalized_status not in EXECUTION_STATUSES:
        raise HTTPException(status_code=400, detail="Unsupported execution status")
    query = select(ProjectQuestionRemediationExecution).where(
        ProjectQuestionRemediationExecution.project_id == project_id
    )
    if normalized_status:
        query = query.where(
            ProjectQuestionRemediationExecution.status == normalized_status
        )
    rows = session.exec(
        query.order_by(
            ProjectQuestionRemediationExecution.updated_at.desc(),
            ProjectQuestionRemediationExecution.id.desc(),
        ).limit(max(1, min(int(limit), 100)))
    ).all()
    all_statuses = session.exec(
        select(ProjectQuestionRemediationExecution.status).where(
            ProjectQuestionRemediationExecution.project_id == project_id
        )
    ).all()
    counts = {item: 0 for item in sorted(EXECUTION_STATUSES)}
    for item in all_statuses:
        counts[str(item)] = counts.get(str(item), 0) + 1
    return {
        "schema_version": EXECUTION_SCHEMA_VERSION,
        "project_id": project_id,
        "items": [
            serialize_project_question_remediation_execution(session, row)
            for row in rows
        ],
        "count": len(rows),
        "counts": counts,
        "contract": build_remediation_execution_contract(),
    }


def transition_project_question_remediation_execution(
    session: Session,
    *,
    project_id: int,
    execution_id: int,
    actor_user_id: int,
    action: str,
    expected_revision: int,
    note: str,
) -> dict[str, Any]:
    """Advance a manual lifecycle without delivery or question resolution."""

    normalized_action = _single_line(action, 40)
    normalized_note = _note(note, MAX_TRANSITION_NOTE_CHARS)
    if normalized_action not in {"mark_sent", "complete", "cancel"}:
        raise HTTPException(status_code=400, detail="Unsupported execution action")
    if not normalized_note:
        raise HTTPException(status_code=400, detail="A transition note is required")

    lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    execution = _locked_execution(
        session,
        project_id=project_id,
        execution_id=execution_id,
    )
    already_satisfied = (
        (normalized_action == "mark_sent" and execution.status in {"sent_manually", "completed"})
        or (normalized_action == "complete" and execution.status == "completed")
        or (normalized_action == "cancel" and execution.status == "cancelled")
    )
    if already_satisfied:
        return serialize_project_question_remediation_execution(session, execution)
    if int(execution.revision) != int(expected_revision):
        raise HTTPException(status_code=409, detail="Execution revision changed; reload and retry.")

    now = utc_now_naive()
    event_action: str
    if normalized_action == "mark_sent":
        if (
            execution.target_kind != "communication_request"
            or execution.status != "ready_for_manual_send"
        ):
            raise HTTPException(
                status_code=409,
                detail="Only a ready manual communication can be marked sent.",
            )
        request = session.get(
            ProjectCommunicationRequest,
            execution.communication_request_id,
        )
        if request is None:
            raise HTTPException(status_code=409, detail="Communication request is unavailable")
        request.status = "sent_manually"
        request.updated_at = now
        session.add(request)
        execution.status = "sent_manually"
        event_action = "marked_sent"
    elif normalized_action == "complete":
        actual_evidence_count = int(
            session.exec(
                select(func.count(ProjectQuestionRemediationEvidenceAttachment.id)).where(
                    ProjectQuestionRemediationEvidenceAttachment.execution_id
                    == int(execution.id or 0)
                )
            ).one()
        )
        if actual_evidence_count < 1:
            raise HTTPException(
                status_code=409,
                detail="Attach at least one evidence record before completion.",
            )
        execution.evidence_count = actual_evidence_count
        if execution.target_kind == "project_todo":
            if execution.status != "active":
                raise HTTPException(status_code=409, detail="Todo execution is not active")
            todo = session.get(ProjectTodo, execution.target_todo_id)
            if todo is None:
                raise HTTPException(status_code=409, detail="Remediation todo is unavailable")
            todo.is_done = True
            todo.updated_at = now
            session.add(todo)
            mark_project_memory_stale(
                session,
                project_id,
                trigger="question_remediation_execution_completed",
                commit=False,
            )
        else:
            if execution.status != "sent_manually":
                raise HTTPException(
                    status_code=409,
                    detail="Mark the manual communication sent before completion.",
                )
            request = session.get(
                ProjectCommunicationRequest,
                execution.communication_request_id,
            )
            if request is None:
                raise HTTPException(status_code=409, detail="Communication request is unavailable")
            request.status = "completed"
            request.updated_at = now
            session.add(request)
        execution.status = "completed"
        event_action = "completed"
    else:
        if execution.target_kind != "communication_request" or execution.status not in {
            "ready_for_manual_send",
            "sent_manually",
        }:
            raise HTTPException(
                status_code=409,
                detail="Only an active manual communication can be cancelled.",
            )
        request = session.get(
            ProjectCommunicationRequest,
            execution.communication_request_id,
        )
        if request is None:
            raise HTTPException(status_code=409, detail="Communication request is unavailable")
        request.status = "cancelled"
        request.updated_at = now
        session.add(request)
        execution.status = "cancelled"
        event_action = "cancelled"

    execution.revision = int(execution.revision) + 1
    execution.last_transition_note = normalized_note
    execution.last_transition_by_user_id = actor_user_id
    execution.last_transition_at = now
    execution.updated_at = now
    session.add(execution)
    session.add(
        _execution_event(
            execution,
            action=event_action,
            actor_user_id=actor_user_id,
            note=normalized_note,
        )
    )
    session.commit()
    session.refresh(execution)
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")
    return serialize_project_question_remediation_execution(session, execution)


def _normalized_external_reference(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw or len(raw) > MAX_REFERENCE_CHARS:
        raise HTTPException(status_code=400, detail="A bounded external reference is required")
    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="External reference must use HTTP or HTTPS")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="External reference cannot contain credentials")
    hostname = parsed.hostname.lower()
    netloc = hostname
    if parsed.port is not None:
        netloc = f"{hostname}:{parsed.port}"
    return urlunsplit(
        (parsed.scheme.lower(), netloc, parsed.path or "/", parsed.query, "")
    )[:MAX_REFERENCE_CHARS]


def _normalize_evidence(
    session: Session,
    *,
    project_id: int,
    evidence_kind: str,
    title: str,
    note: str,
    reference_locator: str,
    project_file_id: int | None,
    knowledge_document_id: int | None,
    message_id: int | None,
) -> dict[str, Any]:
    kind = _single_line(evidence_kind, 40)
    if kind not in EVIDENCE_KINDS:
        raise HTTPException(status_code=400, detail="Unsupported evidence kind")
    normalized_title = _single_line(title, MAX_EVIDENCE_TITLE_CHARS)
    normalized_note = _note(note)
    provided_ids = sum(
        item is not None
        for item in (project_file_id, knowledge_document_id, message_id)
    )
    if kind == "project_file":
        if provided_ids != 1 or project_file_id is None or reference_locator:
            raise HTTPException(status_code=400, detail="Invalid project-file evidence reference")
        row = session.exec(
            select(ProjectFile).where(
                ProjectFile.id == int(project_file_id),
                ProjectFile.project_id == project_id,
                ProjectFile.deleted_at.is_(None),
            )
        ).first()
        if row is None:
            raise HTTPException(status_code=409, detail="Project file is unavailable")
        normalized_title = normalized_title or _single_line(row.name, MAX_EVIDENCE_TITLE_CHARS)
        support_level = "direct"
    elif kind == "knowledge_document":
        if provided_ids != 1 or knowledge_document_id is None or reference_locator:
            raise HTTPException(status_code=400, detail="Invalid knowledge evidence reference")
        row = session.exec(
            select(KnowledgeDocument).where(
                KnowledgeDocument.id == int(knowledge_document_id),
                KnowledgeDocument.project_id == project_id,
            )
        ).first()
        if row is None:
            raise HTTPException(status_code=409, detail="Knowledge document is unavailable")
        normalized_title = normalized_title or _single_line(row.name, MAX_EVIDENCE_TITLE_CHARS)
        support_level = "direct"
    elif kind == "message":
        if provided_ids != 1 or message_id is None or reference_locator:
            raise HTTPException(status_code=400, detail="Invalid message evidence reference")
        row = session.exec(
            select(Message, Conversation)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Message.id == int(message_id),
                Conversation.project_id == project_id,
            )
        ).first()
        if row is None:
            raise HTTPException(status_code=409, detail="Project message is unavailable")
        message, conversation = row
        normalized_title = normalized_title or _single_line(
            f"{conversation.title or '项目对话'} · 消息 #{message.id}",
            MAX_EVIDENCE_TITLE_CHARS,
        )
        support_level = "review_required"
    elif kind == "external_reference":
        if provided_ids or not normalized_title:
            raise HTTPException(status_code=400, detail="Invalid external evidence reference")
        reference_locator = _normalized_external_reference(reference_locator)
        support_level = "review_required"
    else:
        if provided_ids or reference_locator or not normalized_note:
            raise HTTPException(status_code=400, detail="A manual evidence note is required")
        normalized_title = normalized_title or "人工证据记录"
        support_level = "review_required"

    if not normalized_title:
        raise HTTPException(status_code=400, detail="An evidence title is required")
    return {
        "evidence_kind": kind,
        "support_level": support_level,
        "title": normalized_title,
        "note": normalized_note,
        "reference_locator": reference_locator if kind == "external_reference" else "",
        "project_file_id": int(project_file_id) if kind == "project_file" else None,
        "knowledge_document_id": (
            int(knowledge_document_id) if kind == "knowledge_document" else None
        ),
        "message_id": int(message_id) if kind == "message" else None,
    }


def attach_project_question_remediation_evidence(
    session: Session,
    *,
    project_id: int,
    execution_id: int,
    actor_user_id: int,
    expected_revision: int,
    idempotency_key: str,
    evidence_kind: str,
    title: str = "",
    note: str = "",
    reference_locator: str = "",
    project_file_id: int | None = None,
    knowledge_document_id: int | None = None,
    message_id: int | None = None,
) -> dict[str, Any]:
    """Attach immutable evidence and append its execution event."""

    raw_key = str(idempotency_key or "").strip()
    if not 16 <= len(raw_key) <= 128:
        raise HTTPException(status_code=400, detail="Invalid evidence idempotency key")
    lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    execution = _locked_execution(
        session,
        project_id=project_id,
        execution_id=execution_id,
    )
    if execution.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled execution cannot accept evidence")

    payload = _normalize_evidence(
        session,
        project_id=project_id,
        evidence_kind=evidence_kind,
        title=title,
        note=note,
        reference_locator=reference_locator,
        project_file_id=project_file_id,
        knowledge_document_id=knowledge_document_id,
        message_id=message_id,
    )
    key_sha256 = _canonical_sha256(
        {
            "contract": "aria.remediation-execution-evidence.idempotency.v1",
            "execution_id": int(execution.id or 0),
            "key": raw_key,
        }
    )
    evidence_sha256 = _canonical_sha256(
        {
            "contract": "aria.remediation-execution-evidence.v1",
            "execution_id": int(execution.id or 0),
            **payload,
        }
    )
    existing = session.exec(
        select(ProjectQuestionRemediationEvidenceAttachment).where(
            ProjectQuestionRemediationEvidenceAttachment.execution_id
            == int(execution.id or 0),
            ProjectQuestionRemediationEvidenceAttachment.idempotency_key_sha256
            == key_sha256,
        )
    ).first()
    if existing is not None:
        if existing.evidence_sha256 != evidence_sha256:
            raise HTTPException(
                status_code=409,
                detail="This idempotency key is bound to different evidence.",
            )
        return serialize_project_question_remediation_execution(session, execution)
    duplicate = session.exec(
        select(ProjectQuestionRemediationEvidenceAttachment).where(
            ProjectQuestionRemediationEvidenceAttachment.execution_id
            == int(execution.id or 0),
            ProjectQuestionRemediationEvidenceAttachment.evidence_sha256
            == evidence_sha256,
        )
    ).first()
    if duplicate is not None:
        return serialize_project_question_remediation_execution(session, execution)
    if int(execution.revision) != int(expected_revision):
        raise HTTPException(status_code=409, detail="Execution revision changed; reload and retry.")

    current_count = int(
        session.exec(
            select(func.count(ProjectQuestionRemediationEvidenceAttachment.id)).where(
                ProjectQuestionRemediationEvidenceAttachment.execution_id
                == int(execution.id or 0)
            )
        ).one()
    )
    if current_count >= MAX_EVIDENCE_PER_EXECUTION:
        raise HTTPException(status_code=409, detail="Execution evidence limit reached")

    now = utc_now_naive()
    execution.revision = int(execution.revision) + 1
    execution.evidence_count = current_count + 1
    execution.last_transition_note = "evidence_attached"
    execution.last_transition_by_user_id = actor_user_id
    execution.last_transition_at = now
    execution.updated_at = now
    attachment = ProjectQuestionRemediationEvidenceAttachment(
        execution_id=int(execution.id or 0),
        project_id=project_id,
        question_sha256=execution.question_sha256,
        execution_revision=execution.revision,
        idempotency_key_sha256=key_sha256,
        evidence_sha256=evidence_sha256,
        attached_by_user_id=actor_user_id,
        attached_at=now,
        **payload,
    )
    session.add(execution)
    session.add(attachment)
    session.flush()
    session.add(
        _execution_event(
            execution,
            action="evidence_attached",
            actor_user_id=actor_user_id,
            note=payload["title"],
            evidence_attachment_id=int(attachment.id or 0),
        )
    )
    session.commit()
    session.refresh(execution)
    return serialize_project_question_remediation_execution(session, execution)
