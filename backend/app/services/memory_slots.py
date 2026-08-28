"""Durable slot-level memory projections, freshness, and provenance.

Aria retains its aggregate project/client JSON and snapshots as compatibility
read models. This module dual-writes the smallest durable unit that retrieval
actually consumes: one memory slot. Stable slot identities, canonical content
digests, and bounded source references are an Aria-native adaptation of the
world-state identity mechanism in OpenAI Codex
``codex-rs/core/src/context/world_state/mod.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).
No Codex runtime, SDK, protocol, process, or communication is used.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Iterable

from sqlmodel import Session, select

from app.models.db import (
    ClientMemorySlot,
    ClientRecord,
    ClientStakeholder,
    MemoryCandidate,
    Milestone,
    Project,
    ProjectFile,
    ProjectMemorySlot,
    ProjectPayment,
    ProjectProgressUpdate,
    ProjectTodo,
)
from app.services.time_utils import utc_now_naive


PROJECT_MEMORY_SLOT_KEYS = (
    "project_brief",
    "current_stage",
    "current_objective",
    "recent_progress",
    "key_risks",
    "open_questions",
    "next_actions",
    "important_documents",
    "financial_status",
    "delivery_signals",
    "stakeholder_notes",
    "client_stakeholders",
)
CLIENT_MEMORY_SLOT_KEYS = (
    "client_profile",
    "decision_patterns",
    "key_contacts",
    "structured_stakeholders",
    "lessons_learned",
    "relationship_signals",
    "project_history",
    "sensitive_topics",
)
PROJECT_EDITABLE_SLOT_KEYS = frozenset(
    {"key_risks", "open_questions", "stakeholder_notes"}
)
MAX_SLOT_EVIDENCE_REFS = 24


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def _source_ref(
    source_type: str,
    source_id: Any,
    source_label: str,
    captured_at: Any = None,
) -> dict[str, str]:
    return {
        "source_type": str(source_type or "unknown")[:48],
        "source_id": str(source_id or "")[:80],
        "source_label": " ".join(str(source_label or "").split())[:180],
        "captured_at": _iso(captured_at)[:40],
    }


def _sanitize_evidence_refs(values: Iterable[Any]) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for value in values:
        if not isinstance(value, dict):
            continue
        ref = _source_ref(
            str(value.get("source_type") or "unknown"),
            value.get("source_id"),
            str(value.get("source_label") or ""),
            value.get("captured_at"),
        )
        identity = (ref["source_type"], ref["source_id"])
        if not ref["source_id"] or identity in seen:
            continue
        seen.add(identity)
        refs.append(ref)
        if len(refs) >= MAX_SLOT_EVIDENCE_REFS:
            break
    return refs


def _accepted_candidate_refs(
    session: Session,
    *,
    scope: str,
    entity_id: int,
) -> dict[str, list[dict[str, str]]]:
    statement = select(MemoryCandidate).where(
        MemoryCandidate.scope == scope,
        MemoryCandidate.status == "accepted",
    )
    if scope == "project":
        statement = statement.where(MemoryCandidate.project_id == entity_id)
    else:
        statement = statement.where(MemoryCandidate.client_id == entity_id)
    candidates = session.exec(
        statement.order_by(MemoryCandidate.resolved_at.desc(), MemoryCandidate.id.desc())
    ).all()
    by_slot: dict[str, list[dict[str, str]]] = {}
    for candidate in candidates[:MAX_SLOT_EVIDENCE_REFS]:
        slot_key = str(candidate.target_slot or "").strip()
        if not slot_key:
            continue
        by_slot.setdefault(slot_key, []).append(
            _source_ref(
                "memory_candidate",
                candidate.id,
                f"Accepted memory candidate #{candidate.id}",
                candidate.resolved_at or candidate.created_at,
            )
        )
    return by_slot


def _matching_client(session: Session, client_name: str) -> ClientRecord | None:
    normalized = " ".join(str(client_name or "").strip().lower().split())
    if not normalized:
        return None
    exact = session.exec(
        select(ClientRecord).where(ClientRecord.name == client_name)
    ).first()
    if exact is not None:
        return exact
    return next(
        (
            item
            for item in session.exec(select(ClientRecord)).all()
            if " ".join(str(item.name or "").strip().lower().split()) == normalized
        ),
        None,
    )


def build_project_slot_evidence_refs(
    session: Session,
    project: Project,
) -> dict[str, list[dict[str, str]]]:
    """Build bounded source pools that were actually read by project rebuild."""

    project_id = int(project.id or 0)
    base = [
        _source_ref(
            "project",
            project_id,
            f"Project record: {project.name}",
            project.updated_at,
        )
    ]
    progress = session.exec(
        select(ProjectProgressUpdate)
        .where(ProjectProgressUpdate.project_id == project_id)
        .order_by(ProjectProgressUpdate.created_at.desc())
        .limit(8)
    ).all()
    progress_refs = [
        _source_ref(
            "project_progress",
            item.id,
            f"Progress: {item.content}",
            item.created_at,
        )
        for item in progress
    ]
    milestones = session.exec(
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .order_by(Milestone.id.desc())
        .limit(8)
    ).all()
    milestone_refs = [
        _source_ref("milestone", item.id, item.title, None) for item in milestones
    ]
    todos = session.exec(
        select(ProjectTodo)
        .where(ProjectTodo.project_id == project_id)
        .order_by(ProjectTodo.updated_at.desc())
        .limit(8)
    ).all()
    todo_refs = [
        _source_ref("project_todo", item.id, item.content, item.updated_at)
        for item in todos
    ]
    files = session.exec(
        select(ProjectFile)
        .where(
            ProjectFile.project_id == project_id,
            ProjectFile.deleted_at.is_(None),
        )
        .order_by(ProjectFile.uploaded_at.desc())
        .limit(12)
    ).all()
    file_refs = [
        _source_ref("project_file", item.id, item.name, item.uploaded_at)
        for item in files
    ]
    payments = session.exec(
        select(ProjectPayment)
        .where(ProjectPayment.project_id == project_id)
        .order_by(ProjectPayment.id.desc())
        .limit(12)
    ).all()
    payment_refs = [
        _source_ref(
            "project_payment",
            item.id,
            " · ".join(
                part
                for part in (
                    str(item.payment_type or "payment"),
                    str(item.payment_date or ""),
                    str(item.amount or ""),
                    str(item.note or ""),
                )
                if part
            ),
            None,
        )
        for item in payments
    ]
    client = _matching_client(session, project.client)
    stakeholders = (
        session.exec(
            select(ClientStakeholder)
            .where(ClientStakeholder.client_id == client.id)
            .order_by(ClientStakeholder.updated_at.desc())
            .limit(10)
        ).all()
        if client is not None and client.id is not None
        else []
    )
    stakeholder_refs = [
        _source_ref(
            "client_stakeholder",
            item.id,
            " · ".join(part for part in (item.name, item.role) if part),
            item.updated_at,
        )
        for item in stakeholders
    ]
    candidates = _accepted_candidate_refs(
        session,
        scope="project",
        entity_id=project_id,
    )

    evidence = {
        "project_brief": base,
        "current_stage": [*base, *milestone_refs],
        "current_objective": [*base, *progress_refs, *todo_refs],
        "recent_progress": [*progress_refs, *milestone_refs, *todo_refs],
        "key_risks": [*progress_refs, *milestone_refs, *payment_refs],
        "open_questions": [*progress_refs, *todo_refs, *milestone_refs],
        "next_actions": [*todo_refs, *milestone_refs, *progress_refs],
        "important_documents": file_refs,
        "financial_status": [*base, *payment_refs],
        "delivery_signals": [*progress_refs, *milestone_refs, *todo_refs, *file_refs],
        "stakeholder_notes": stakeholder_refs,
        "client_stakeholders": stakeholder_refs,
    }
    return {
        slot_key: _sanitize_evidence_refs(
            [*evidence.get(slot_key, []), *candidates.get(slot_key, [])]
        )
        for slot_key in PROJECT_MEMORY_SLOT_KEYS
    }


def build_client_slot_evidence_refs(
    session: Session,
    client: ClientRecord,
    memory: dict[str, Any],
) -> dict[str, list[dict[str, str]]]:
    """Build bounded source pools that were actually read by client rebuild."""

    client_id = int(client.id or 0)
    base = [
        _source_ref(
            "client",
            client_id,
            f"Client record: {client.name}",
            client.client_memory_updated_at or client.created_at,
        )
    ]
    source_project_ids = {
        int(value)
        for value in list(memory.get("source_project_ids") or [])
        if str(value).isdigit()
    }
    normalized_name = " ".join(str(client.name or "").strip().lower().split())
    matching_projects = [
        project
        for project in session.exec(select(Project).order_by(Project.updated_at.desc())).all()
        if (
            int(project.id or 0) in source_project_ids
            or " ".join(str(project.client or "").strip().lower().split()) == normalized_name
        )
    ][:12]
    project_refs = [
        _source_ref(
            "project",
            project.id,
            f"Project: {project.name}",
            project.updated_at,
        )
        for project in matching_projects
    ]
    stakeholders = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client_id)
        .order_by(ClientStakeholder.updated_at.desc())
        .limit(12)
    ).all()
    stakeholder_refs = [
        _source_ref(
            "client_stakeholder",
            item.id,
            " · ".join(part for part in (item.name, item.role) if part),
            item.updated_at,
        )
        for item in stakeholders
    ]
    candidates = _accepted_candidate_refs(
        session,
        scope="client",
        entity_id=client_id,
    )
    evidence = {
        "client_profile": [*base, *project_refs],
        "decision_patterns": project_refs,
        "key_contacts": [*base, *stakeholder_refs],
        "structured_stakeholders": stakeholder_refs,
        "lessons_learned": project_refs,
        "relationship_signals": [*project_refs, *stakeholder_refs],
        "project_history": project_refs,
        "sensitive_topics": [*project_refs, *stakeholder_refs],
    }
    return {
        slot_key: _sanitize_evidence_refs(
            [*evidence.get(slot_key, []), *candidates.get(slot_key, [])]
        )
        for slot_key in CLIENT_MEMORY_SLOT_KEYS
    }


def _sync_slot_rows(
    session: Session,
    *,
    owner_id: int,
    owner_field: str,
    model: type[ProjectMemorySlot] | type[ClientMemorySlot],
    slot_keys: tuple[str, ...],
    aggregate_memory_version: int,
    memory: dict[str, Any],
    evidence_by_slot: dict[str, list[dict[str, str]]],
) -> None:
    owner_column = getattr(model, owner_field)
    existing_rows = session.exec(select(model).where(owner_column == owner_id)).all()
    existing = {row.slot_key: row for row in existing_rows}
    now = utc_now_naive()
    for slot_key in slot_keys:
        value = memory.get(slot_key)
        value_json = _canonical_json(value)
        value_sha256 = hashlib.sha256(value_json.encode("utf-8")).hexdigest()
        evidence_refs = _sanitize_evidence_refs(evidence_by_slot.get(slot_key, []))
        evidence_refs_json = _canonical_json(evidence_refs)
        row = existing.get(slot_key)
        if row is None:
            row = model(
                **{owner_field: owner_id},
                slot_key=slot_key,
                slot_version=1,
                created_at=now,
            )
        elif row.value_sha256 != value_sha256:
            row.slot_version = max(0, int(row.slot_version or 0)) + 1
        row.aggregate_memory_version = max(0, int(aggregate_memory_version or 0))
        row.value_json = value_json
        row.value_sha256 = value_sha256
        row.evidence_refs_json = evidence_refs_json
        row.evidence_count = len(evidence_refs)
        row.is_stale = False
        row.stale_reason = ""
        row.stale_at = None
        row.updated_at = now
        session.add(row)


def sync_project_memory_slots(
    session: Session,
    project: Project,
    memory: dict[str, Any],
    *,
    slot_keys: Iterable[str] | None = None,
) -> None:
    if project.id is None:
        return
    requested = set(slot_keys) if slot_keys is not None else None
    selected = tuple(
        slot_key
        for slot_key in PROJECT_MEMORY_SLOT_KEYS
        if requested is None or slot_key in requested
    )
    _sync_slot_rows(
        session,
        owner_id=project.id,
        owner_field="project_id",
        model=ProjectMemorySlot,
        slot_keys=selected,
        aggregate_memory_version=int(project.memory_version or 0),
        memory=memory,
        evidence_by_slot=build_project_slot_evidence_refs(session, project),
    )


def sync_client_memory_slots(
    session: Session,
    client: ClientRecord,
    memory: dict[str, Any],
    *,
    slot_keys: Iterable[str] | None = None,
) -> None:
    if client.id is None:
        return
    requested = set(slot_keys) if slot_keys is not None else None
    selected = tuple(
        slot_key
        for slot_key in CLIENT_MEMORY_SLOT_KEYS
        if requested is None or slot_key in requested
    )
    _sync_slot_rows(
        session,
        owner_id=client.id,
        owner_field="client_id",
        model=ClientMemorySlot,
        slot_keys=selected,
        aggregate_memory_version=int(client.client_memory_version or 0),
        memory=memory,
        evidence_by_slot=build_client_slot_evidence_refs(session, client, memory),
    )


def project_memory_slots_for_trigger(trigger: str) -> tuple[str, ...]:
    normalized = str(trigger or "data_changed").strip().lower()
    selected: set[str] = set()
    if any(term in normalized for term in ("payment", "financial", "contract_amount")):
        selected.update(("financial_status", "key_risks"))
    if "todo" in normalized:
        selected.update(("next_actions", "recent_progress", "delivery_signals"))
    if "milestone" in normalized:
        selected.update(
            ("current_stage", "recent_progress", "next_actions", "delivery_signals")
        )
    if "progress" in normalized:
        selected.update(
            ("recent_progress", "key_risks", "next_actions", "delivery_signals")
        )
    if any(
        term in normalized
        for term in (
            "project_file",
            "document",
            "markdown",
            "folder",
            "ppt",
            "docx",
            "xlsx",
            "pdf",
        )
    ):
        selected.update(("important_documents", "delivery_signals"))
    if any(term in normalized for term in ("stakeholder", "member")):
        selected.update(("stakeholder_notes", "client_stakeholders"))
    if "project_status" in normalized:
        selected.update(
            ("current_stage", "current_objective", "recent_progress", "delivery_signals")
        )
    if "project_profile" in normalized:
        selected.update(("project_brief", "current_objective"))
    if not selected:
        return PROJECT_MEMORY_SLOT_KEYS
    return tuple(slot for slot in PROJECT_MEMORY_SLOT_KEYS if slot in selected)


def client_memory_slots_for_trigger(trigger: str) -> tuple[str, ...]:
    normalized = str(trigger or "data_changed").strip().lower()
    if "stakeholder" in normalized:
        return (
            "key_contacts",
            "structured_stakeholders",
            "decision_patterns",
            "relationship_signals",
            "sensitive_topics",
        )
    if any(term in normalized for term in ("client_updated", "client_created")):
        return CLIENT_MEMORY_SLOT_KEYS
    if any(term in normalized for term in ("project_changed", "project_promoted")):
        return (
            "client_profile",
            "decision_patterns",
            "lessons_learned",
            "relationship_signals",
            "project_history",
            "sensitive_topics",
        )
    return CLIENT_MEMORY_SLOT_KEYS


def _mark_slot_rows_stale(
    session: Session,
    *,
    owner_id: int,
    owner_field: str,
    model: type[ProjectMemorySlot] | type[ClientMemorySlot],
    slot_keys: tuple[str, ...],
    trigger: str,
) -> None:
    owner_column = getattr(model, owner_field)
    rows = session.exec(
        select(model).where(owner_column == owner_id, model.slot_key.in_(slot_keys))
    ).all()
    now = utc_now_naive()
    for row in rows:
        row.is_stale = True
        row.stale_reason = str(trigger or "data_changed")[:160]
        row.stale_at = now
        session.add(row)


def mark_project_memory_slots_stale(
    session: Session,
    project_id: int,
    trigger: str,
) -> None:
    _mark_slot_rows_stale(
        session,
        owner_id=project_id,
        owner_field="project_id",
        model=ProjectMemorySlot,
        slot_keys=project_memory_slots_for_trigger(trigger),
        trigger=trigger,
    )


def mark_client_memory_slots_stale(
    session: Session,
    client_id: int,
    trigger: str,
) -> None:
    _mark_slot_rows_stale(
        session,
        owner_id=client_id,
        owner_field="client_id",
        model=ClientMemorySlot,
        slot_keys=client_memory_slots_for_trigger(trigger),
        trigger=trigger,
    )


def _decode_slot_value(row: ProjectMemorySlot | ClientMemorySlot) -> tuple[bool, Any]:
    try:
        value = json.loads(row.value_json or "null")
    except json.JSONDecodeError:
        return False, None
    return _sha256_json(value) == str(row.value_sha256 or ""), value


def _slot_state(row: ProjectMemorySlot | ClientMemorySlot) -> dict[str, Any]:
    integrity_ok, _ = _decode_slot_value(row)
    try:
        evidence_refs = json.loads(row.evidence_refs_json or "[]")
    except json.JSONDecodeError:
        evidence_refs = []
    evidence_refs = _sanitize_evidence_refs(
        evidence_refs if isinstance(evidence_refs, list) else []
    )
    return {
        "slot_key": row.slot_key,
        "slot_version": max(0, int(row.slot_version or 0)),
        "aggregate_memory_version": max(0, int(row.aggregate_memory_version or 0)),
        "status": "corrupt" if not integrity_ok else "stale" if row.is_stale else "ready",
        "value_sha256": str(row.value_sha256 or ""),
        "evidence_count": len(evidence_refs),
        "evidence_refs": evidence_refs,
        "stale_reason": str(row.stale_reason or ""),
        "stale_at": row.stale_at.isoformat() if row.stale_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def get_project_memory_slot_states(
    session: Session,
    project_id: int,
    *,
    for_update: bool = False,
) -> list[dict[str, Any]]:
    statement = (
        select(ProjectMemorySlot)
        .where(ProjectMemorySlot.project_id == project_id)
        .order_by(ProjectMemorySlot.slot_key)
    )
    if for_update:
        statement = statement.with_for_update()
    rows = session.exec(statement).all()
    return [_slot_state(row) for row in rows]


def get_client_memory_slot_states(
    session: Session,
    client_id: int,
    *,
    for_update: bool = False,
) -> list[dict[str, Any]]:
    statement = (
        select(ClientMemorySlot)
        .where(ClientMemorySlot.client_id == client_id)
        .order_by(ClientMemorySlot.slot_key)
    )
    if for_update:
        statement = statement.with_for_update()
    rows = session.exec(statement).all()
    return [_slot_state(row) for row in rows]


def _overlay_slot_rows(
    payload: dict[str, Any],
    rows: Iterable[ProjectMemorySlot | ClientMemorySlot],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    result = dict(payload)
    states: dict[str, dict[str, Any]] = {}
    for row in rows:
        integrity_ok, value = _decode_slot_value(row)
        state = _slot_state(row)
        states[row.slot_key] = state
        if not integrity_ok:
            continue
        result[row.slot_key] = value
        if row.slot_key in PROJECT_EDITABLE_SLOT_KEYS and isinstance(value, dict):
            result[f"{row.slot_key}_detail"] = value
            flattened: list[str] = []
            for part in ("pinned", "ai"):
                values = value.get(part)
                if isinstance(values, list):
                    flattened.extend(
                        str(item).strip() for item in values if str(item).strip()
                    )
            result[row.slot_key] = flattened
    return result, states


def load_project_memory_slot_view(
    session: Session,
    project: Project,
    aggregate_payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    rows = session.exec(
        select(ProjectMemorySlot).where(ProjectMemorySlot.project_id == int(project.id or 0))
    ).all()
    return _overlay_slot_rows(aggregate_payload, rows)


def load_client_memory_slot_view(
    session: Session,
    client: ClientRecord,
    aggregate_payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    rows = session.exec(
        select(ClientMemorySlot).where(ClientMemorySlot.client_id == int(client.id or 0))
    ).all()
    return _overlay_slot_rows(aggregate_payload, rows)
