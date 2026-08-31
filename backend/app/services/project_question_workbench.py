"""Project-level question projection and accountability metadata.

The workbench composes existing Aria-owned state instead of creating a second
question source of truth: open questions come from the durable memory slot,
closures come from the resolution ledger, and only owner/priority/due-date
metadata is stored here.  Writes are re-authorized under the project lock and
recorded as append-only profile events.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    Conversation,
    Message,
    Project,
    ProjectMember,
    ProjectQuestionProfile,
    ProjectQuestionProfileEvent,
    ProjectQuestionResolution,
    User,
)
from app.services.memory_slots import load_project_memory_slot_view
from app.services.project_contexts import get_project_memory_payload
from app.services.project_core import lock_and_require_project_write
from app.services.project_question_resolutions import (
    normalize_project_question,
    project_question_sha256,
)
from app.services.time_utils import utc_now_naive


WORKBENCH_SCHEMA_VERSION = 1
MAX_RESOLUTION_ITEMS = 100
MAX_PROFILE_ITEMS = 200
MAX_ANSWER_CANDIDATES = 40
PRIORITIES = frozenset({"low", "normal", "high", "critical"})


def _iso(value: Any) -> str:
    return value.isoformat() if value is not None else ""


def _question_memory_projection(
    session: Session,
    project: Project,
) -> tuple[dict[str, Any], list[str]]:
    memory_version = int(project.memory_version or 0)
    if memory_version <= 0:
        return {
            "status": "missing",
            "memory_version": memory_version,
            "slot_version": 0,
            "stale": bool(project.memory_stale),
        }, []
    aggregate = get_project_memory_payload(project)
    memory, slot_states = load_project_memory_slot_view(session, project, aggregate)
    slot_state = slot_states.get("open_questions") or {}
    slot_status = str(slot_state.get("status") or "missing")
    stale = bool(project.memory_stale or slot_status in {"stale", "corrupt"})
    questions: list[str] = []
    seen: set[str] = set()
    raw_questions = memory.get("open_questions")
    for item in raw_questions if isinstance(raw_questions, list) else []:
        normalized = normalize_project_question(str(item or ""))
        identity = project_question_sha256(normalized) if normalized else ""
        if normalized and identity not in seen:
            seen.add(identity)
            questions.append(normalized)
    return {
        "status": "stale" if stale else "ready",
        "memory_version": memory_version,
        "slot_version": int(slot_state.get("slot_version") or 0),
        "stale": stale,
    }, questions


def _profile_payload(row: ProjectQuestionProfile | None) -> dict[str, Any]:
    if row is None:
        return {
            "owner_user_id": None,
            "priority": "normal",
            "due_date": "",
            "revision": 0,
            "updated_at": "",
        }
    return {
        "owner_user_id": row.owner_user_id,
        "priority": row.priority,
        "due_date": row.due_date,
        "revision": int(row.revision or 1),
        "updated_at": _iso(row.updated_at),
    }


def _resolution_payload(
    row: ProjectQuestionResolution,
    *,
    current_memory_version: int,
    project_memory_stale: bool,
    current_hashes: set[str],
    available_message_ids: set[int],
) -> tuple[str, str, dict[str, Any]]:
    reappeared = row.question_sha256 in current_hashes
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
    answer_available = int(row.answer_message_id or 0) in available_message_ids
    payload = {
        "id": int(row.id or 0),
        "resolution_revision": int(row.resolution_revision or 1),
        "resolution_summary": row.resolution_summary,
        "answer_message_id": row.answer_message_id if answer_available else None,
        "answer_conversation_id": row.answer_conversation_id if answer_available else None,
        "answer_available": answer_available,
        "resolved_memory_version": int(row.resolved_memory_version or 0),
        "resolved_slot_version": int(row.resolved_slot_version or 0),
        "resolved_at": _iso(row.resolved_at),
    }
    return ("needs_review" if needs_review else "resolved"), review_reason, payload


def _answer_candidates(
    session: Session,
    project_id: int,
) -> tuple[list[dict[str, Any]], bool]:
    rows = session.exec(
        select(Message, Conversation)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.project_id == project_id,
            Message.role == "assistant",
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(MAX_ANSWER_CANDIDATES + 1)
    ).all()
    result: list[dict[str, Any]] = []
    for message, conversation in rows[:MAX_ANSWER_CANDIDATES]:
        preview = " ".join(str(message.content or "").strip().split())[:280]
        if not preview:
            preview = "（该回答没有可显示的文本预览）"
        result.append(
            {
                "message_id": int(message.id or 0),
                "conversation_id": int(conversation.id or 0),
                "conversation_title": str(conversation.title or "未命名对话")[:160],
                "preview": preview,
                "created_at": _iso(message.created_at),
            }
        )
    return result, len(rows) > MAX_ANSWER_CANDIDATES


def _member_payloads(session: Session, project_id: int) -> list[dict[str, Any]]:
    rows = session.exec(
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id, User.is_active == True)
        .order_by(ProjectMember.id)
    ).all()
    return [
        {
            "user_id": int(user.id or 0),
            "display_name": str(user.display_name or user.email or "未命名成员")[:160],
            "role": str(member.role or "editor"),
        }
        for member, user in rows
    ]


def build_project_question_workbench(
    session: Session,
    *,
    project: Project,
    current_user: User,
) -> dict[str, Any]:
    """Compose a bounded project question workspace from native Aria state."""

    project_id = int(project.id or 0)
    memory, open_questions = _question_memory_projection(session, project)
    current_hashes = {
        project_question_sha256(question) for question in open_questions
    }
    resolution_rows = session.exec(
        select(ProjectQuestionResolution)
        .where(ProjectQuestionResolution.project_id == project_id)
        .order_by(
            ProjectQuestionResolution.updated_at.desc(),
            ProjectQuestionResolution.id.desc(),
        )
        .limit(MAX_RESOLUTION_ITEMS + 1)
    ).all()
    resolutions = resolution_rows[:MAX_RESOLUTION_ITEMS]
    known_profile_hashes = current_hashes | {
        row.question_sha256 for row in resolutions
    }
    profile_rows = session.exec(
        select(ProjectQuestionProfile)
        .where(
            ProjectQuestionProfile.project_id == project_id,
            ProjectQuestionProfile.question_sha256.in_(known_profile_hashes),
        )
        .order_by(ProjectQuestionProfile.updated_at.desc())
        .limit(MAX_PROFILE_ITEMS + 1)
    ).all() if known_profile_hashes else []
    profiles = profile_rows[:MAX_PROFILE_ITEMS]
    profiles_by_hash = {row.question_sha256: row for row in profiles}
    resolutions_by_hash = {row.question_sha256: row for row in resolutions}
    message_ids = [
        int(row.answer_message_id)
        for row in resolutions
        if row.answer_message_id is not None
    ]
    available_message_ids = set(
        session.exec(select(Message.id).where(Message.id.in_(message_ids))).all()
    ) if message_ids else set()

    items: list[dict[str, Any]] = []
    emitted: set[str] = set()
    for question in open_questions:
        identity = project_question_sha256(question)
        row = resolutions_by_hash.get(identity)
        status = "open"
        review_reason = ""
        resolution = None
        if row is not None and row.status == "resolved":
            status, review_reason, resolution = _resolution_payload(
                row,
                current_memory_version=memory["memory_version"],
                project_memory_stale=bool(memory["stale"]),
                current_hashes=current_hashes,
                available_message_ids=available_message_ids,
            )
        items.append(
            {
                "question": question,
                "question_sha256": identity,
                "status": status,
                "review_reason": review_reason,
                "profile": _profile_payload(profiles_by_hash.get(identity)),
                "resolution": resolution,
            }
        )
        emitted.add(identity)

    for row in resolutions:
        if row.question_sha256 in emitted:
            continue
        if row.status == "open":
            status, review_reason, resolution = "open", "", None
        else:
            status, review_reason, resolution = _resolution_payload(
                row,
                current_memory_version=memory["memory_version"],
                project_memory_stale=bool(memory["stale"]),
                current_hashes=current_hashes,
                available_message_ids=available_message_ids,
            )
        items.append(
            {
                "question": row.question_text,
                "question_sha256": row.question_sha256,
                "status": status,
                "review_reason": review_reason,
                "profile": _profile_payload(profiles_by_hash.get(row.question_sha256)),
                "resolution": resolution,
            }
        )
        emitted.add(row.question_sha256)

    priority_order = {"critical": 0, "high": 1, "normal": 2, "low": 3}
    status_order = {"needs_review": 0, "open": 1, "resolved": 2}
    items.sort(
        key=lambda item: (
            status_order.get(item["status"], 9),
            priority_order.get(item["profile"]["priority"], 9),
            item["profile"]["due_date"] or "9999-12-31",
            item["question_sha256"],
        )
    )
    membership = None
    if not current_user.is_admin:
        membership = session.exec(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == int(current_user.id or 0),
            )
        ).first()
    can_write = bool(
        current_user.is_admin
        or (
            membership is not None
            and str(membership.role or "").lower() in {"owner", "editor"}
        )
    )
    counts = {
        "open": sum(item["status"] == "open" for item in items),
        "needs_review": sum(item["status"] == "needs_review" for item in items),
        "resolved": sum(item["status"] == "resolved" for item in items),
    }
    if (
        can_write
        and memory["status"] == "ready"
        and any(item["status"] == "open" for item in items)
    ):
        answer_candidates, answer_candidates_truncated = _answer_candidates(
            session,
            project_id,
        )
    else:
        answer_candidates, answer_candidates_truncated = [], False
    return {
        "schema_version": WORKBENCH_SCHEMA_VERSION,
        "project_id": project_id,
        "can_write": can_write,
        "memory": memory,
        "counts": counts,
        "questions": items,
        "members": _member_payloads(session, project_id),
        "answer_candidates": answer_candidates,
        "truncated": {
            "resolutions": len(resolution_rows) > MAX_RESOLUTION_ITEMS,
            "profiles": len(profile_rows) > MAX_PROFILE_ITEMS,
            "answer_candidates": answer_candidates_truncated,
        },
        "privacy": {
            "includes_bounded_answer_previews": bool(answer_candidates),
            "includes_full_answer_content": False,
            "includes_prompt_content": False,
            "includes_tool_inputs": False,
            "includes_hidden_reasoning": False,
        },
    }


def _normalize_due_date(value: str | None) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    try:
        parsed = date.fromisoformat(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Due date must use YYYY-MM-DD") from exc
    return parsed.isoformat()


def update_project_question_profile(
    session: Session,
    *,
    project_id: int,
    actor_user_id: int,
    question: str,
    question_sha256: str,
    owner_user_id: int | None,
    priority: str,
    due_date: str | None,
    expected_revision: int,
) -> ProjectQuestionProfile:
    """CAS-update one question profile under final business authorization."""

    normalized_question = normalize_project_question(question)
    identity = project_question_sha256(normalized_question)
    if not normalized_question or identity != str(question_sha256 or "").lower():
        raise HTTPException(status_code=400, detail="Question identity does not match")
    normalized_priority = str(priority or "").strip().lower()
    if normalized_priority not in PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid question priority")
    normalized_due_date = _normalize_due_date(due_date)

    project, _ = lock_and_require_project_write(
        session,
        project_id,
        actor_user_id=actor_user_id,
    )
    existing = session.exec(
        select(ProjectQuestionProfile)
        .where(
            ProjectQuestionProfile.project_id == project_id,
            ProjectQuestionProfile.question_sha256 == identity,
        )
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    actual_revision = int(existing.revision or 0) if existing is not None else 0
    if actual_revision != expected_revision:
        raise HTTPException(
            status_code=409,
            detail="Question profile changed; reload and retry.",
        )

    _, open_questions = _question_memory_projection(session, project)
    known_hashes = {project_question_sha256(item) for item in open_questions}
    known_resolution = session.exec(
        select(ProjectQuestionResolution.id).where(
            ProjectQuestionResolution.project_id == project_id,
            ProjectQuestionResolution.question_sha256 == identity,
        )
    ).first()
    if existing is None and identity not in known_hashes and known_resolution is None:
        raise HTTPException(status_code=404, detail="Project question not found")

    if owner_user_id is not None:
        owner_exists = session.exec(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == owner_user_id,
            )
        ).first()
        if owner_exists is None:
            raise HTTPException(
                status_code=400,
                detail="Question owner must be an active project member",
            )
        owner = session.get(User, owner_user_id)
        if owner is None or not owner.is_active:
            raise HTTPException(
                status_code=400,
                detail="Question owner must be an active project member",
            )

    previous_owner = existing.owner_user_id if existing is not None else None
    previous_priority = existing.priority if existing is not None else "normal"
    previous_due_date = existing.due_date if existing is not None else ""
    if (
        existing is not None
        and previous_owner == owner_user_id
        and previous_priority == normalized_priority
        and previous_due_date == normalized_due_date
    ):
        return existing

    now = utc_now_naive()
    row = existing or ProjectQuestionProfile(
        project_id=project_id,
        question_text=normalized_question,
        question_sha256=identity,
        created_by_user_id=actor_user_id,
        created_at=now,
    )
    row.question_text = normalized_question
    row.owner_user_id = owner_user_id
    row.priority = normalized_priority
    row.due_date = normalized_due_date
    row.revision = actual_revision + 1
    row.updated_by_user_id = actor_user_id
    row.updated_at = now
    session.add(row)
    session.flush()
    session.add(
        ProjectQuestionProfileEvent(
            profile_id=int(row.id or 0),
            project_id=project_id,
            revision=int(row.revision),
            question_text=normalized_question,
            previous_owner_user_id=previous_owner,
            owner_user_id=owner_user_id,
            previous_priority=previous_priority,
            priority=normalized_priority,
            previous_due_date=previous_due_date,
            due_date=normalized_due_date,
            actor_user_id=actor_user_id,
            created_at=now,
        )
    )
    session.commit()
    session.refresh(row)
    return row
