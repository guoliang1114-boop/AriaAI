"""Source-linked Memory Candidate creation and human decision workflow."""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import (
    ClientRecord,
    MemoryCandidate,
    Message,
    Project,
    User,
    UserMemory,
)
from app.services.agent_harness.run_output_record import (
    append_run_output_record,
    build_memory_candidate_output_record,
    normalize_run_output_records,
)
from app.services.client_contexts import get_client_memory_payload, save_client_memory
from app.services.project_contexts import (
    _default_project_memory,
    _get_existing_raw_memory,
    _normalize_editable_slot,
    save_project_memory,
)
from app.services.time_utils import utc_now_naive


MEMORY_CANDIDATE_SCHEMA_VERSION = 1
MAX_CANDIDATE_CONTENT_CHARS = 4_000
MAX_SOURCE_REFS = 12
MAX_SOURCE_REF_LABEL_CHARS = 160
MAX_DECISION_NOTE_CHARS = 300

SCOPE_TYPES = {
    "user": {"user_preference"},
    "project": {"project_fact", "project_risk", "project_next_action"},
    "client": {
        "client_preference",
        "client_relationship_signal",
        "consulting_lesson",
    },
}

DEFAULT_TARGET_SLOT = {
    "user_preference": "remembered_preferences",
    "project_fact": "recent_progress",
    "project_risk": "key_risks",
    "project_next_action": "next_actions",
    "client_preference": "decision_patterns",
    "client_relationship_signal": "relationship_signals",
    "consulting_lesson": "lessons_learned",
}
ACCEPTED_MEMORY_CANDIDATES_KEY = "_accepted_memory_candidates"


def _content_sha256(content: str) -> str:
    return hashlib.sha256(
        f"aria.memory-candidate.content.v1\0{content}".encode("utf-8")
    ).hexdigest()


def _parse_json(value: str | None, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except (json.JSONDecodeError, TypeError):
        return fallback


def _bounded_source_refs(refs: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    bounded: list[dict[str, str]] = []
    for raw in refs or []:
        if not isinstance(raw, dict):
            continue
        source_type = str(raw.get("source_type") or raw.get("type") or "").strip()[:40]
        source_id = str(raw.get("source_id") or raw.get("id") or "").strip()[:96]
        if not source_type or not source_id:
            continue
        item = {"source_type": source_type, "source_id": source_id}
        label = str(raw.get("label") or raw.get("title") or "").strip()
        if label:
            item["label"] = label[:MAX_SOURCE_REF_LABEL_CHARS]
        bounded.append(item)
        if len(bounded) >= MAX_SOURCE_REFS:
            break
    return bounded


def validate_candidate_shape(
    *,
    scope: str,
    candidate_type: str,
    content: str,
    project_id: int | None,
    client_id: int | None,
) -> tuple[str, str, str]:
    normalized_scope = str(scope or "").strip().lower()
    normalized_type = str(candidate_type or "").strip().lower()
    normalized_content = str(content or "").strip()
    if normalized_scope not in SCOPE_TYPES:
        raise HTTPException(400, "Unsupported memory candidate scope")
    if normalized_type not in SCOPE_TYPES[normalized_scope]:
        raise HTTPException(400, "Candidate type does not belong to the requested scope")
    if len(normalized_content) < 2:
        raise HTTPException(400, "Memory candidate content is too short")
    if len(normalized_content) > MAX_CANDIDATE_CONTENT_CHARS:
        raise HTTPException(400, f"Memory candidate content exceeds {MAX_CANDIDATE_CONTENT_CHARS} characters")
    if normalized_scope == "project" and project_id is None:
        raise HTTPException(400, "project_id is required for project memory candidates")
    if normalized_scope != "project" and project_id is not None:
        raise HTTPException(400, "project_id is only valid for project memory candidates")
    if normalized_scope == "client" and client_id is None:
        raise HTTPException(400, "client_id is required for client memory candidates")
    if normalized_scope != "client" and client_id is not None:
        raise HTTPException(400, "client_id is only valid for client memory candidates")
    return normalized_scope, normalized_type, normalized_content


def create_memory_candidate(
    session: Session,
    *,
    owner_user_id: int,
    scope: str,
    candidate_type: str,
    content: str,
    source_type: str = "manual",
    source_id: str = "",
    source_run_id: str = "",
    source_refs: list[dict[str, Any]] | None = None,
    project_id: int | None = None,
    client_id: int | None = None,
    confidence: float = 1.0,
    created_by: str = "user",
) -> tuple[MemoryCandidate, bool]:
    scope, candidate_type, content = validate_candidate_shape(
        scope=scope,
        candidate_type=candidate_type,
        content=content,
        project_id=project_id,
        client_id=client_id,
    )
    normalized_source_type = str(source_type or "manual").strip().lower()[:40] or "manual"
    normalized_source_id = str(source_id or "").strip()[:96]
    if not normalized_source_id:
        # Keep manual proposals idempotent without accidentally deduplicating
        # the same sentence across two different formal-memory scopes.
        scope_identity = (
            project_id
            if scope == "project"
            else client_id
            if scope == "client"
            else owner_user_id
        )
        normalized_source_id = f"{scope}:{scope_identity}"
    digest = _content_sha256(content)
    existing = session.exec(
        select(MemoryCandidate).where(
            MemoryCandidate.owner_user_id == owner_user_id,
            MemoryCandidate.scope == scope,
            MemoryCandidate.candidate_type == candidate_type,
            MemoryCandidate.source_type == normalized_source_type,
            MemoryCandidate.source_id == normalized_source_id,
            MemoryCandidate.content_sha256 == digest,
        )
    ).first()
    if existing is not None:
        return existing, False

    candidate = MemoryCandidate(
        owner_user_id=owner_user_id,
        scope=scope,
        candidate_type=candidate_type,
        content=content,
        content_sha256=digest,
        source_type=normalized_source_type,
        source_id=normalized_source_id,
        source_run_id=str(source_run_id or "").strip()[:96],
        source_refs_json=json.dumps(_bounded_source_refs(source_refs), ensure_ascii=False),
        project_id=project_id,
        client_id=client_id,
        confidence=min(1.0, max(0.0, float(confidence))),
        status="pending",
        created_by=str(created_by or "user").strip().lower()[:20] or "user",
        target_slot=DEFAULT_TARGET_SLOT[candidate_type],
    )
    session.add(candidate)
    session.flush()
    return candidate, True


def serialize_memory_candidate(candidate: MemoryCandidate) -> dict[str, Any]:
    refs = _parse_json(candidate.source_refs_json, [])
    return {
        "schema_version": MEMORY_CANDIDATE_SCHEMA_VERSION,
        "id": candidate.id,
        "scope": candidate.scope,
        "candidate_type": candidate.candidate_type,
        "content": candidate.content,
        "content_sha256": candidate.content_sha256,
        "source_type": candidate.source_type,
        "source_id": candidate.source_id,
        "source_run_id": candidate.source_run_id,
        "source_refs": refs if isinstance(refs, list) else [],
        "project_id": candidate.project_id,
        "client_id": candidate.client_id,
        "confidence": candidate.confidence,
        "status": candidate.status,
        "created_by": candidate.created_by,
        "target_slot": candidate.target_slot,
        "applied_memory_version": candidate.applied_memory_version,
        "resolved_by_user_id": candidate.resolved_by_user_id,
        "decision_note": candidate.decision_note,
        "created_at": candidate.created_at.isoformat() if candidate.created_at else None,
        "resolved_at": candidate.resolved_at.isoformat() if candidate.resolved_at else None,
    }


def source_run_id_from_message(message: Message) -> str:
    metadata = message.get_metadata()
    for key in ("activity_timeline", "run_rollout"):
        value = metadata.get(key)
        if isinstance(value, dict):
            run_id = str(value.get("run_id") or "").strip()
            if run_id:
                return run_id[:96]
    return ""


def sync_candidate_source_message(session: Session, candidate: MemoryCandidate) -> None:
    if candidate.source_type != "chat_message" or not str(candidate.source_id).isdigit():
        return
    message = session.get(Message, int(candidate.source_id))
    if message is None:
        return
    metadata = message.get_metadata()
    refs = metadata.get("memory_candidates")
    refs = [dict(item) for item in refs if isinstance(item, dict)] if isinstance(refs, list) else []
    candidate_ref = {
        "candidate_id": candidate.id,
        "scope": candidate.scope,
        "candidate_type": candidate.candidate_type,
        "status": candidate.status,
        "content_sha256": candidate.content_sha256,
    }
    refs = [item for item in refs if item.get("candidate_id") != candidate.id]
    refs.append(candidate_ref)
    metadata["memory_candidates"] = refs[-20:]
    outputs = metadata.get("run_outputs")
    normalized_outputs = normalize_run_output_records(outputs if isinstance(outputs, list) else [])
    append_run_output_record(
        normalized_outputs,
        build_memory_candidate_output_record(candidate),
    )
    metadata["run_outputs"] = normalized_outputs
    timeline = metadata.get("activity_timeline")
    if isinstance(timeline, dict):
        timeline_candidates = timeline.get("memory_candidates")
        timeline_candidates = (
            [dict(item) for item in timeline_candidates if isinstance(item, dict)]
            if isinstance(timeline_candidates, list)
            else []
        )
        timeline_ref = {
            "id": str(candidate.id),
            "scope": candidate.scope,
            "candidate_type": candidate.candidate_type,
            "status": {
                "pending": "pending_review",
                "accepted": "accepted",
                "rejected": "rejected",
            }.get(candidate.status, "failed"),
            "content_sha256": candidate.content_sha256,
        }
        timeline_candidates = [
            item
            for item in timeline_candidates
            if str(item.get("id") or "") != str(candidate.id)
        ]
        timeline_candidates.append(timeline_ref)
        timeline["memory_candidates"] = timeline_candidates[-20:]
        metadata["activity_timeline"] = timeline
    message.set_metadata(metadata)
    session.add(message)


def _append_unique(items: Any, content: str, *, limit: int = 50) -> list[str]:
    values = [str(item).strip() for item in items if str(item).strip()] if isinstance(items, list) else []
    if content not in values:
        values.append(content)
    return values[-limit:]


def _record_accepted_anchor(memory: dict[str, Any], target_slot: str, content: str) -> None:
    anchors = memory.get(ACCEPTED_MEMORY_CANDIDATES_KEY)
    anchors = dict(anchors) if isinstance(anchors, dict) else {}
    anchors[target_slot] = _append_unique(anchors.get(target_slot), content)
    memory[ACCEPTED_MEMORY_CANDIDATES_KEY] = anchors


def _mark_accepted(
    session: Session,
    candidate: MemoryCandidate,
    *,
    user_id: int,
    applied_memory_version: int,
    decision_note: str,
) -> None:
    candidate.status = "accepted"
    candidate.applied_memory_version = applied_memory_version
    candidate.resolved_by_user_id = user_id
    candidate.decision_note = str(decision_note or "").strip()[:MAX_DECISION_NOTE_CHARS]
    candidate.resolved_at = utc_now_naive()
    session.add(candidate)


def accept_memory_candidate(
    session: Session,
    candidate: MemoryCandidate,
    *,
    user_id: int,
    decision_note: str = "",
) -> MemoryCandidate:
    if candidate.status == "accepted":
        return candidate
    if candidate.status != "pending":
        raise HTTPException(409, f"Memory candidate is already {candidate.status}")

    target_slot = DEFAULT_TARGET_SLOT.get(candidate.candidate_type, candidate.target_slot)
    candidate.target_slot = target_slot
    if candidate.scope == "user":
        # Lock the owner row first so concurrent candidate decisions cannot
        # both derive the same UserMemory version or race to create its unique
        # row.
        owner = session.exec(
            select(User).where(User.id == candidate.owner_user_id).with_for_update()
        ).first()
        if owner is None:
            raise HTTPException(404, "User not found")
        row = session.exec(
            select(UserMemory)
            .where(UserMemory.user_id == candidate.owner_user_id)
            .with_for_update()
        ).first()
        now = utc_now_naive()
        if row is None:
            preferences: dict[str, Any] = {}
            row = UserMemory(
                user_id=candidate.owner_user_id,
                preferences_json="{}",
                version=0,
                created_at=now,
                updated_at=now,
            )
        else:
            preferences = _parse_json(row.preferences_json, {})
            if not isinstance(preferences, dict):
                preferences = {}
        preferences[target_slot] = _append_unique(preferences.get(target_slot), candidate.content)
        row.preferences_json = json.dumps(preferences, ensure_ascii=False)
        row.version = int(row.version or 0) + 1
        row.updated_at = now
        session.add(row)
        _mark_accepted(
            session,
            candidate,
            user_id=user_id,
            applied_memory_version=row.version,
            decision_note=decision_note,
        )
        sync_candidate_source_message(session, candidate)
        session.commit()
    elif candidate.scope == "project":
        project = session.exec(
            select(Project).where(Project.id == candidate.project_id).with_for_update()
        ).first()
        if project is None:
            raise HTTPException(404, "Project not found")
        memory = _get_existing_raw_memory(project) or _default_project_memory(project)
        _record_accepted_anchor(memory, target_slot, candidate.content)
        if target_slot == "key_risks":
            normalized = _normalize_editable_slot(memory.get(target_slot))
            normalized["pinned"] = _append_unique(normalized.get("pinned"), candidate.content)
            memory[target_slot] = normalized
        else:
            memory[target_slot] = _append_unique(memory.get(target_slot), candidate.content)
        next_version = int(project.memory_version or 0) + 1
        _mark_accepted(
            session,
            candidate,
            user_id=user_id,
            applied_memory_version=next_version,
            decision_note=decision_note,
        )
        save_project_memory(
            session,
            int(candidate.project_id),
            memory,
            trigger=f"memory_candidate:{candidate.id}",
            coverage=memory.get("_coverage") if isinstance(memory.get("_coverage"), dict) else {},
        )
        sync_candidate_source_message(session, candidate)
        session.commit()
    elif candidate.scope == "client":
        client = session.exec(
            select(ClientRecord)
            .where(ClientRecord.id == candidate.client_id)
            .with_for_update()
        ).first()
        if client is None:
            raise HTTPException(404, "Client not found")
        memory = get_client_memory_payload(client)
        _record_accepted_anchor(memory, target_slot, candidate.content)
        memory[target_slot] = _append_unique(memory.get(target_slot), candidate.content)
        next_version = int(client.client_memory_version or 0) + 1
        _mark_accepted(
            session,
            candidate,
            user_id=user_id,
            applied_memory_version=next_version,
            decision_note=decision_note,
        )
        save_client_memory(
            session,
            int(candidate.client_id),
            memory,
            trigger=f"memory_candidate:{candidate.id}",
            source_project_ids=[candidate.project_id] if candidate.project_id else None,
        )
        sync_candidate_source_message(session, candidate)
        session.commit()
    else:
        raise HTTPException(400, "Unsupported memory candidate scope")
    session.refresh(candidate)
    return candidate


def reject_memory_candidate(
    session: Session,
    candidate: MemoryCandidate,
    *,
    user_id: int,
    decision_note: str = "",
) -> MemoryCandidate:
    if candidate.status == "rejected":
        return candidate
    if candidate.status != "pending":
        raise HTTPException(409, f"Memory candidate is already {candidate.status}")
    candidate.status = "rejected"
    candidate.resolved_by_user_id = user_id
    candidate.decision_note = str(decision_note or "").strip()[:MAX_DECISION_NOTE_CHARS]
    candidate.resolved_at = utc_now_naive()
    session.add(candidate)
    sync_candidate_source_message(session, candidate)
    session.commit()
    session.refresh(candidate)
    return candidate
