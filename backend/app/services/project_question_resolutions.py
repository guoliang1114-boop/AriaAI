"""Authorized, durable closure of project-memory open questions.

Question state remains in Aria's native project memory. A resolution is only
recorded when a user with project write access binds the current question to a
persisted Assistant message and confirms a bounded summary. The memory edit,
fact retirement, and resolution ledger commit atomically.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    Conversation,
    Message,
    Project,
    ProjectMemoryFact,
    ProjectMemorySlot,
    ProjectQuestionResolution,
    ProjectQuestionResolutionEvent,
)
from app.services.cache import projects_cache
from app.services.memory_slots import load_project_memory_slot_view
from app.services.project_contexts import (
    ACCEPTED_MEMORY_CANDIDATES_KEY,
    _get_existing_raw_memory,
    _normalize_editable_slot,
    get_project_memory_payload,
    save_project_memory,
)
from app.services.project_core import lock_and_require_project_memory_write
from app.services.time_utils import utc_now_naive


OPEN_QUESTIONS_SLOT = "open_questions"
MAX_RESOLUTION_ITEMS = 8


def normalize_project_question(value: str) -> str:
    return " ".join(str(value or "").strip().split())[:360]


def project_question_sha256(value: str) -> str:
    normalized = normalize_project_question(value)
    return hashlib.sha256(
        f"aria.project-question.v1\0{normalized}".encode("utf-8")
    ).hexdigest()


def _value_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _project_memory_view(
    session: Session,
    *,
    project_id: int,
    actor_user_id: int,
    expected_memory_version: int,
    expected_slot_version: int,
) -> tuple[Project, dict[str, list[str]], dict[str, Any]]:
    project, _, _ = lock_and_require_project_memory_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    if int(project.memory_version or 0) != expected_memory_version:
        raise HTTPException(
            status_code=409,
            detail="Project memory changed; reload the question state and retry.",
        )
    slot = session.exec(
        select(ProjectMemorySlot)
        .where(
            ProjectMemorySlot.project_id == project_id,
            ProjectMemorySlot.slot_key == OPEN_QUESTIONS_SLOT,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if slot is None:
        raise HTTPException(
            status_code=409,
            detail="Open-question ledger is unavailable; rebuild project memory first.",
        )
    if int(slot.slot_version or 0) != expected_slot_version:
        raise HTTPException(
            status_code=409,
            detail="Open questions changed; reload and retry.",
        )
    aggregate = get_project_memory_payload(project)
    memory, slot_states = load_project_memory_slot_view(session, project, aggregate)
    slot_state = slot_states.get(OPEN_QUESTIONS_SLOT) or {}
    if (
        slot_state.get("status") != "ready"
        or int(slot_state.get("aggregate_memory_version") or 0)
        != expected_memory_version
    ):
        raise HTTPException(
            status_code=409,
            detail="Open questions are stale or invalid; rebuild project memory first.",
        )
    detail = _normalize_editable_slot(memory.get(f"{OPEN_QUESTIONS_SLOT}_detail"))
    return project, detail, slot_state


def _question_fact_key(
    session: Session,
    *,
    project_id: int,
    question: str,
) -> str:
    facts = session.exec(
        select(ProjectMemoryFact)
        .where(
            ProjectMemoryFact.project_id == project_id,
            ProjectMemoryFact.slot_key == OPEN_QUESTIONS_SLOT,
            ProjectMemoryFact.value_sha256 == _value_sha256(question),
            ProjectMemoryFact.is_active == True,
        )
        .order_by(ProjectMemoryFact.id)
    ).all()
    pinned = next((fact for fact in facts if fact.source_kind == "pinned"), None)
    selected = pinned or (facts[0] if facts else None)
    return str(selected.fact_key or "") if selected is not None else ""


def _serialize_resolution(
    row: ProjectQuestionResolution,
    *,
    current_memory_version: int,
    project_memory_stale: bool,
    current_question_hashes: set[str],
    answer_message_available: bool,
) -> dict[str, Any]:
    reappeared = row.question_sha256 in current_question_hashes
    memory_changed = current_memory_version > int(row.resolved_memory_version or 0)
    needs_review = bool(project_memory_stale or memory_changed or reappeared)
    review_reason = (
        "question_reappeared"
        if reappeared
        else "project_memory_stale"
        if project_memory_stale
        else "project_memory_changed"
        if memory_changed
        else ""
    )
    return {
        "id": int(row.id or 0),
        "question": row.question_text,
        "status": "needs_review" if needs_review else "resolved",
        "review_reason": review_reason,
        "resolution_summary": row.resolution_summary,
        "answer_message_id": row.answer_message_id if answer_message_available else None,
        "answer_conversation_id": row.answer_conversation_id if answer_message_available else None,
        "answer_available": answer_message_available,
        "resolution_revision": int(row.resolution_revision or 1),
        "resolved_memory_version": int(row.resolved_memory_version or 0),
        "resolved_slot_version": int(row.resolved_slot_version or 0),
        "resolved_at": row.resolved_at.isoformat(),
    }


def list_project_question_resolutions(
    session: Session,
    *,
    project_id: int,
    current_memory_version: int,
    project_memory_stale: bool,
    current_questions: list[str],
    limit: int = MAX_RESOLUTION_ITEMS,
) -> list[dict[str, Any]]:
    rows = session.exec(
        select(ProjectQuestionResolution)
        .where(
            ProjectQuestionResolution.project_id == project_id,
            ProjectQuestionResolution.status == "resolved",
        )
        .order_by(
            ProjectQuestionResolution.resolved_at.desc(),
            ProjectQuestionResolution.id.desc(),
        )
        .limit(min(max(int(limit or MAX_RESOLUTION_ITEMS), 1), MAX_RESOLUTION_ITEMS))
    ).all()
    message_ids = [int(row.answer_message_id) for row in rows if row.answer_message_id]
    available_ids = set(
        session.exec(select(Message.id).where(Message.id.in_(message_ids))).all()
    ) if message_ids else set()
    current_hashes = {
        project_question_sha256(question)
        for question in current_questions
        if normalize_project_question(question)
    }
    return [
        _serialize_resolution(
            row,
            current_memory_version=current_memory_version,
            project_memory_stale=project_memory_stale,
            current_question_hashes=current_hashes,
            answer_message_available=int(row.answer_message_id or 0) in available_ids,
        )
        for row in rows
    ]


def resolve_project_question(
    session: Session,
    *,
    conversation: Conversation,
    actor_user_id: int,
    question: str,
    answer_message_id: int,
    resolution_summary: str,
    expected_memory_version: int,
    expected_slot_version: int,
) -> ProjectQuestionResolution:
    if conversation.project_id is None:
        raise HTTPException(status_code=400, detail="A project conversation is required")
    project_id = int(conversation.project_id)
    normalized_question = normalize_project_question(question)
    normalized_summary = " ".join(str(resolution_summary or "").strip().split())[:600]
    if not normalized_question or not normalized_summary:
        raise HTTPException(status_code=400, detail="Question and resolution summary are required")

    project, detail, _ = _project_memory_view(
        session,
        project_id=project_id,
        actor_user_id=actor_user_id,
        expected_memory_version=expected_memory_version,
        expected_slot_version=expected_slot_version,
    )
    answer = session.exec(
        select(Message)
        .where(
            Message.id == answer_message_id,
            Message.conversation_id == int(conversation.id or 0),
            Message.role == "assistant",
        )
        .execution_options(populate_existing=True)
    ).first()
    if answer is None:
        raise HTTPException(
            status_code=409,
            detail="The selected Assistant answer is unavailable or outside this conversation.",
        )

    question_hash = project_question_sha256(normalized_question)
    existing = session.exec(
        select(ProjectQuestionResolution)
        .where(
            ProjectQuestionResolution.project_id == project_id,
            ProjectQuestionResolution.question_sha256 == question_hash,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if (
        existing is not None
        and existing.status == "resolved"
        and existing.answer_message_id == answer_message_id
        and existing.resolution_summary == normalized_summary
    ):
        return existing

    current_by_identity: dict[str, str] = {}
    for item in [*detail["pinned"], *detail["ai"]]:
        normalized = normalize_project_question(item)
        if normalized:
            current_by_identity.setdefault(normalized, str(item).strip())
    current_question = current_by_identity.get(normalized_question)
    if current_question is None:
        raise HTTPException(
            status_code=409,
            detail="This question is no longer open; reload the project state.",
        )
    question_fact_key = _question_fact_key(
        session,
        project_id=project_id,
        question=current_question,
    )
    updated_detail = {
        "pinned": [
            item
            for item in detail["pinned"]
            if normalize_project_question(item) != normalized_question
        ],
        "ai": [
            item
            for item in detail["ai"]
            if normalize_project_question(item) != normalized_question
        ],
    }
    raw_memory = _get_existing_raw_memory(project)
    raw_memory[OPEN_QUESTIONS_SLOT] = updated_detail
    accepted = raw_memory.get(ACCEPTED_MEMORY_CANDIDATES_KEY)
    removed_anchor_values = [current_question]
    if isinstance(accepted, dict) and isinstance(accepted.get(OPEN_QUESTIONS_SLOT), list):
        removed_anchor_values.extend(
            str(item).strip()
            for item in accepted[OPEN_QUESTIONS_SLOT]
            if normalize_project_question(item) == normalized_question
        )
        accepted[OPEN_QUESTIONS_SLOT] = [
            item
            for item in accepted[OPEN_QUESTIONS_SLOT]
            if normalize_project_question(item) != normalized_question
        ]

    save_project_memory(
        session,
        project_id,
        raw_memory,
        trigger="question_resolved",
        coverage=raw_memory.get("_coverage") if isinstance(raw_memory.get("_coverage"), dict) else {},
        rebuilt_slots=(OPEN_QUESTIONS_SLOT,),
        rebuild_mode="targeted_edit",
        removed_accepted_anchors={OPEN_QUESTIONS_SLOT: removed_anchor_values},
        commit=False,
    )
    refreshed_project = session.get(type(project), project_id)
    refreshed_slot = session.exec(
        select(ProjectMemorySlot).where(
            ProjectMemorySlot.project_id == project_id,
            ProjectMemorySlot.slot_key == OPEN_QUESTIONS_SLOT,
        )
    ).first()
    if refreshed_project is None or refreshed_slot is None:
        raise HTTPException(status_code=409, detail="Project memory update could not be verified")

    now = utc_now_naive()
    row = existing or ProjectQuestionResolution(
        project_id=project_id,
        question_text=current_question,
        question_sha256=question_hash,
        source_memory_version=expected_memory_version,
        source_slot_version=expected_slot_version,
        resolved_memory_version=int(refreshed_project.memory_version or 0),
        resolved_slot_version=int(refreshed_slot.slot_version or 0),
        created_at=now,
    )
    row.question_text = current_question
    row.question_fact_key = question_fact_key
    row.status = "resolved"
    row.resolution_revision = max(0, int(existing.resolution_revision or 0)) + 1 if existing else 1
    row.resolution_summary = normalized_summary
    row.answer_message_id = int(answer.id or 0)
    row.answer_conversation_id = int(conversation.id or 0)
    row.resolved_by_user_id = actor_user_id
    row.source_memory_version = expected_memory_version
    row.source_slot_version = expected_slot_version
    row.resolved_memory_version = int(refreshed_project.memory_version or 0)
    row.resolved_slot_version = int(refreshed_slot.slot_version or 0)
    row.resolved_at = now
    row.updated_at = now
    session.add(row)
    session.flush()
    session.add(
        ProjectQuestionResolutionEvent(
            resolution_id=int(row.id or 0),
            project_id=project_id,
            action="resolved",
            resolution_revision=int(row.resolution_revision),
            question_text=row.question_text,
            question_fact_key=row.question_fact_key,
            note=normalized_summary,
            answer_message_id=row.answer_message_id,
            answer_conversation_id=row.answer_conversation_id,
            actor_user_id=actor_user_id,
            memory_version=int(row.resolved_memory_version),
            slot_version=int(row.resolved_slot_version),
            created_at=now,
        )
    )
    session.commit()
    session.refresh(row)
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")
    return row


def reopen_project_question(
    session: Session,
    *,
    conversation: Conversation,
    resolution_id: int,
    actor_user_id: int,
    reason: str,
    expected_resolution_revision: int,
    expected_memory_version: int,
    expected_slot_version: int,
) -> ProjectQuestionResolution:
    if conversation.project_id is None:
        raise HTTPException(status_code=400, detail="A project conversation is required")
    project_id = int(conversation.project_id)
    normalized_reason = " ".join(str(reason or "").strip().split())[:600]
    if not normalized_reason:
        raise HTTPException(status_code=400, detail="A reopen reason is required")
    project, detail, _ = _project_memory_view(
        session,
        project_id=project_id,
        actor_user_id=actor_user_id,
        expected_memory_version=expected_memory_version,
        expected_slot_version=expected_slot_version,
    )
    row = session.exec(
        select(ProjectQuestionResolution)
        .where(
            ProjectQuestionResolution.id == resolution_id,
            ProjectQuestionResolution.project_id == project_id,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Question resolution not found")
    if row.status == "open":
        return row
    if int(row.resolution_revision or 0) != expected_resolution_revision:
        raise HTTPException(
            status_code=409,
            detail="Question resolution changed; reload and retry.",
        )

    identity = normalize_project_question(row.question_text)
    already_pinned = any(
        normalize_project_question(item) == identity for item in detail["pinned"]
    )
    refreshed_project = project
    refreshed_slot = session.exec(
        select(ProjectMemorySlot).where(
            ProjectMemorySlot.project_id == project_id,
            ProjectMemorySlot.slot_key == OPEN_QUESTIONS_SLOT,
        )
    ).first()
    if not already_pinned:
        raw_memory = _get_existing_raw_memory(project)
        raw_memory[OPEN_QUESTIONS_SLOT] = {
            "pinned": [*detail["pinned"], row.question_text],
            "ai": list(detail["ai"]),
        }
        save_project_memory(
            session,
            project_id,
            raw_memory,
            trigger="question_reopened",
            coverage=raw_memory.get("_coverage") if isinstance(raw_memory.get("_coverage"), dict) else {},
            rebuilt_slots=(OPEN_QUESTIONS_SLOT,),
            rebuild_mode="targeted_edit",
            commit=False,
        )
        refreshed_project = session.get(type(project), project_id)
        refreshed_slot = session.exec(
            select(ProjectMemorySlot).where(
                ProjectMemorySlot.project_id == project_id,
                ProjectMemorySlot.slot_key == OPEN_QUESTIONS_SLOT,
            )
        ).first()
    if refreshed_project is None or refreshed_slot is None:
        raise HTTPException(status_code=409, detail="Project memory update could not be verified")

    now = utc_now_naive()
    row.status = "open"
    row.resolution_revision = int(row.resolution_revision or 0) + 1
    row.reopen_reason = normalized_reason
    row.reopened_by_user_id = actor_user_id
    row.reopened_memory_version = int(refreshed_project.memory_version or 0)
    row.reopened_slot_version = int(refreshed_slot.slot_version or 0)
    row.reopened_at = now
    row.updated_at = now
    session.add(row)
    session.flush()
    session.add(
        ProjectQuestionResolutionEvent(
            resolution_id=int(row.id or 0),
            project_id=project_id,
            action="reopened",
            resolution_revision=int(row.resolution_revision),
            question_text=row.question_text,
            question_fact_key=row.question_fact_key,
            note=normalized_reason,
            answer_message_id=row.answer_message_id,
            answer_conversation_id=row.answer_conversation_id,
            actor_user_id=actor_user_id,
            memory_version=int(row.reopened_memory_version or 0),
            slot_version=int(row.reopened_slot_version or 0),
            created_at=now,
        )
    )
    session.commit()
    session.refresh(row)
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")
    return row
