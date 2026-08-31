"""Authorized, user-facing projection of retained conversation state.

This module does not create or repair continuation state.  It validates the
latest persisted Conversation Capsule and combines it with the current
project-memory open-question slot so the UI can show a trustworthy work
handoff without exposing prompts, tool inputs, or hidden reasoning.
"""
from __future__ import annotations

from typing import Any, Mapping

from sqlmodel import Session, select

from app.models.db import Conversation, Message, Project
from app.services.agent_harness.conversation_capsule import (
    validate_conversation_capsule,
)
from app.services.memory_slots import load_project_memory_slot_view
from app.services.project_contexts import get_project_memory_payload
from app.services.project_question_resolutions import (
    list_project_question_resolutions,
)


CONTINUITY_SNAPSHOT_SCHEMA_VERSION = 2
_MESSAGE_SCAN_LIMIT = 100


def _project_questions(session: Session, project_id: int | None) -> dict[str, Any]:
    if project_id is None:
        return {
            "status": "not_applicable",
            "memory_version": 0,
            "slot_version": 0,
            "stale": False,
            "items": [],
            "resolved": [],
        }
    project = session.get(Project, project_id)
    if project is None or int(project.memory_version or 0) <= 0:
        return {
            "status": "missing",
            "memory_version": int(project.memory_version or 0) if project else 0,
            "slot_version": 0,
            "stale": bool(project.memory_stale) if project else True,
            "items": [],
            "resolved": [],
        }
    aggregate = get_project_memory_payload(project)
    memory, slot_states = load_project_memory_slot_view(session, project, aggregate)
    raw_questions = memory.get("open_questions")
    questions: list[str] = []
    for item in raw_questions if isinstance(raw_questions, list) else []:
        question = str(item).strip()[:360]
        if question and question not in questions:
            questions.append(question)
        if len(questions) >= 8:
            break
    slot_state = slot_states.get("open_questions") or {}
    slot_status = str(slot_state.get("status") or "")
    stale = bool(project.memory_stale or slot_status in {"stale", "corrupt"})
    return {
        "status": "stale" if stale else "ready",
        "memory_version": int(project.memory_version or 0),
        "slot_version": int(slot_state.get("slot_version") or 0),
        "stale": stale,
        "items": questions,
        "resolved": list_project_question_resolutions(
            session,
            project_id=project_id,
            current_memory_version=int(project.memory_version or 0),
            project_memory_stale=stale,
            current_questions=questions,
        ),
    }


def _decision_summaries(value: Any) -> list[str]:
    summaries: list[str] = []
    for item in value if isinstance(value, list) else []:
        if not isinstance(item, Mapping):
            continue
        summary = item.get("summary")
        parts = summary if isinstance(summary, list) else [summary]
        for part in parts:
            text = str(part or "").strip()
            if text and text not in summaries:
                summaries.append(text[:360])
    return summaries[:8]


def _invalid_payload(
    conversation: Conversation,
    *,
    reason_code: str,
    project_questions: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
        "conversation_id": int(conversation.id or 0),
        "project_id": conversation.project_id,
        "status": "invalid",
        "reason_code": reason_code,
        "state": None,
        "project_questions": project_questions,
        "privacy": _privacy_payload(),
    }


def _privacy_payload() -> dict[str, bool]:
    return {
        "includes_bounded_conversation_state": True,
        "includes_bound_answer_message_content": False,
        "includes_prompt_content": False,
        "includes_tool_inputs": False,
        "includes_hidden_reasoning": False,
    }


def build_conversation_continuity_snapshot(
    session: Session,
    *,
    conversation: Conversation,
) -> dict[str, Any]:
    """Return the latest validated continuity state for one conversation."""

    conversation_id = int(conversation.id or 0)
    project_questions = _project_questions(session, conversation.project_id)
    assistant_messages = session.exec(
        select(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.role == "assistant",
        )
        .order_by(Message.id.desc())
        .limit(_MESSAGE_SCAN_LIMIT)
    ).all()
    capsule_message: Message | None = None
    capsule: Mapping[str, Any] | None = None
    for message in assistant_messages:
        candidate = message.get_metadata().get("conversation_capsule")
        if candidate is None:
            continue
        capsule_message = message
        if not isinstance(candidate, Mapping):
            return _invalid_payload(
                conversation,
                reason_code="capsule_not_mapping",
                project_questions=project_questions,
            )
        capsule = candidate
        break

    if capsule_message is None or capsule is None:
        return {
            "schema_version": CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
            "conversation_id": conversation_id,
            "project_id": conversation.project_id,
            "status": "unavailable",
            "reason_code": "capsule_not_available",
            "state": None,
            "project_questions": project_questions,
            "privacy": _privacy_payload(),
        }

    valid, reason = validate_conversation_capsule(capsule)
    if not valid:
        return _invalid_payload(
            conversation,
            reason_code=reason,
            project_questions=project_questions,
        )
    if (
        int(capsule.get("conversation_id") or 0) != conversation_id
        or capsule.get("project_id") != conversation.project_id
    ):
        return _invalid_payload(
            conversation,
            reason_code="capsule_scope_mismatch",
            project_questions=project_questions,
        )

    if any(type(item) is not int or item <= 0 for item in capsule["source_message_ids"]):
        return _invalid_payload(
            conversation,
            reason_code="invalid_source_message_id",
            project_questions=project_questions,
        )
    source_message_ids = list(dict.fromkeys(capsule["source_message_ids"]))
    if source_message_ids:
        scoped_ids = set(
            session.exec(
                select(Message.id).where(
                    Message.id.in_(source_message_ids),
                    Message.conversation_id == conversation_id,
                )
            ).all()
        )
        if scoped_ids != set(source_message_ids):
            return _invalid_payload(
                conversation,
                reason_code="source_message_scope_mismatch",
                project_questions=project_questions,
            )

    return {
        "schema_version": CONTINUITY_SNAPSHOT_SCHEMA_VERSION,
        "conversation_id": conversation_id,
        "project_id": conversation.project_id,
        "status": "ready",
        "reason_code": "",
        "state": {
            "capsule_message_id": int(capsule_message.id or 0),
            "updated_at": capsule_message.created_at.isoformat(),
            "active_goal": str(capsule.get("active_goal") or ""),
            "next_goal": str(capsule.get("next_goal") or ""),
            "turn_mode": str(capsule.get("turn_mode") or "answer_only"),
            "confirmed_constraints": list(capsule.get("confirmed_constraints") or []),
            "decisions": _decision_summaries(capsule.get("decisions")),
            "blockers": [dict(item) for item in capsule.get("blockers") or []],
            "active_artifact": dict(capsule["active_artifact"])
            if isinstance(capsule.get("active_artifact"), Mapping)
            else None,
            "active_task": dict(capsule["active_task"])
            if isinstance(capsule.get("active_task"), Mapping)
            else None,
            "source_message_ids": source_message_ids,
            "capsule_sha256": str(capsule.get("capsule_sha256") or ""),
        },
        "project_questions": project_questions,
        "privacy": _privacy_payload(),
    }
