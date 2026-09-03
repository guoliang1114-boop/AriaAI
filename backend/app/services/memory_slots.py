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
import re
from datetime import datetime
from typing import Any, Iterable, Mapping

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
from app.services.stakeholder_contexts import MAX_STAKEHOLDERS_IN_PROMPT
from app.services.project_clients import find_client_for_project, list_projects_for_client
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
SAFE_AGGREGATE_ONLY_KEYS = frozenset(
    {
        "memory_version",
        "last_updated_at",
        "stale",
        "rebuild_log",
        "source_project_ids",
        "_coverage",
        "_accepted_memory_candidates",
        "_model_source_attributions",
        "_rebuild_generation",
    }
)
PROJECT_SAFE_AGGREGATE_ONLY_KEYS = frozenset(
    {
        "_client_promotion",
        "_last_failure",
    }
)
CLIENT_SAFE_AGGREGATE_ONLY_KEYS = frozenset({"_last_failure"})
PROJECT_EDITABLE_SLOT_KEYS = frozenset(
    {"key_risks", "open_questions", "stakeholder_notes"}
)
MAX_SLOT_EVIDENCE_REFS = 24
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
_PROJECT_MEMORY_TEXT_CHARS = 1200
_PROJECT_FILE_SUMMARY_CHARS = 200
_CLIENT_NOTES_CHARS = 1200
_CLIENT_PROJECT_SUMMARY_CHARS = 320
_CLIENT_PROJECT_BRIEF_CHARS = 240


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


def _json_value_type(value: Any) -> str:
    """Return a content-free JSON type label for compatibility audits."""

    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, Mapping):
        return "object"
    if isinstance(value, (int, float)):
        return "number"
    return "other"


def _memory_version_relation(slot_version: int, aggregate_version: int) -> str:
    if slot_version < aggregate_version:
        return "behind"
    if slot_version > aggregate_version:
        return "ahead"
    return "equal"


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def _project_base_prompt_state(project: Project) -> dict[str, Any]:
    """Return only the project-record fields visible to memory rebuilds.

    ``Project.updated_at`` is also advanced when aggregate memory is saved, so
    it must not participate in the source digest. The bounded text projections
    mirror ``build_project_memory_data`` rather than hashing the mutable memory
    envelope or operational rebuild metadata.
    """

    return {
        "name": project.name,
        "client": project.client,
        "status": project.status,
        "contract_amount": project.contract_amount,
        "description": str(project.description or "")[:_PROJECT_MEMORY_TEXT_CHARS],
        "notes": str(project.notes or "")[:_PROJECT_MEMORY_TEXT_CHARS],
        "md_notes": str(project.md_notes or "")[:_PROJECT_MEMORY_TEXT_CHARS],
    }


def _client_base_prompt_state(client: ClientRecord) -> dict[str, Any]:
    """Return the client-record projection shown to the rebuild provider."""

    return {
        "name": client.name,
        "industry": client.industry,
        "contact": client.contact,
        "notes": str(client.notes or "")[:_CLIENT_NOTES_CHARS],
    }


def _project_for_client_prompt_state(project: Project) -> dict[str, Any]:
    """Project source state as rendered by ``build_client_memory_data``.

    Hashing the raw ``context_memory_json`` would make an otherwise unchanged
    source appear different whenever Aria adds a rebuild-log entry, increments
    ``memory_version``, or writes ``last_updated_at``. Only business fields that
    are actually exposed in the client-memory prompt belong in this digest,
    plus the client association that authorizes the project for that prompt.
    """

    state: dict[str, Any] = {
        "name": project.name,
        "client": project.client,
        "status": project.status,
        "contract_amount": project.contract_amount,
        "context_summary": str(project.context_summary or "")[
            :_CLIENT_PROJECT_SUMMARY_CHARS
        ],
    }
    try:
        memory = json.loads(project.context_memory_json or "{}")
    except (json.JSONDecodeError, TypeError):
        memory = {}
    if not isinstance(memory, dict):
        return state

    brief = str(memory.get("project_brief", "")).strip()
    risks = memory.get("key_risks", [])
    next_actions = memory.get("next_actions", [])
    if brief:
        state["project_brief"] = brief[:_CLIENT_PROJECT_BRIEF_CHARS]
    if isinstance(risks, list) and risks:
        state["key_risks"] = "; ".join(str(item) for item in risks[:3])
    if isinstance(next_actions, list) and next_actions:
        state["next_actions"] = "; ".join(
            str(item) for item in next_actions[:3]
        )
    return state


def project_memory_promotion_payload(memory: Any) -> dict[str, Any]:
    """Return the exact business-only project memory shown during promotion.

    Aggregate memory also contains rebuild logs, versions, freshness flags, and
    private coverage metadata. Those operational fields are deliberately
    excluded. Editable project slots are flattened exactly like the public
    project-memory payload so the source digest and provider prompt cover the
    same value.
    """

    source = memory if isinstance(memory, dict) else {}
    payload: dict[str, Any] = {}
    for slot_key in PROJECT_MEMORY_SLOT_KEYS:
        value = source.get(slot_key)
        if slot_key in PROJECT_EDITABLE_SLOT_KEYS and isinstance(value, dict):
            flattened: list[str] = []
            for source_kind in ("ai", "pinned"):
                items = value.get(source_kind)
                if isinstance(items, list):
                    flattened.extend(
                        str(item).strip()
                        for item in items
                        if str(item).strip()
                    )
            value = flattened
        payload[slot_key] = value
    return payload


def _project_memory_for_promotion_state(project: Project) -> dict[str, Any]:
    """Canonical promotion state, including the client ownership boundary."""

    try:
        stored = json.loads(project.context_memory_json or "{}")
    except (json.JSONDecodeError, TypeError):
        stored = {}
    if not isinstance(stored, dict):
        stored = {}
    defaults: dict[str, Any] = {
        "project_brief": str(project.description or "")[:300],
        "current_stage": project.status,
        "current_objective": "",
        "recent_progress": [],
        "key_risks": {"ai": [], "pinned": []},
        "open_questions": {"ai": [], "pinned": []},
        "next_actions": [],
        "important_documents": [],
        "financial_status": "",
        "delivery_signals": [],
        "stakeholder_notes": {"ai": [], "pinned": []},
        "client_stakeholders": [],
    }
    return {
        "project_name": project.name,
        "project_client": project.client,
        "project_memory": project_memory_promotion_payload({**defaults, **stored}),
    }


def _stakeholder_prompt_state(stakeholder: ClientStakeholder) -> dict[str, str]:
    """Full authoritative stakeholder projection persisted as a memory fact.

    The system binds ``structured_stakeholders`` directly to this source after
    provider parsing, so every persisted business field must participate in
    the digest even when a compact prompt formatter omits some of them.
    """

    fields = {
        "name": stakeholder.name,
        "role": stakeholder.role,
        "organization_level": stakeholder.organization_level,
        "influence_type": stakeholder.influence_type,
        "relationship_status": stakeholder.relationship_status,
        "concerns": stakeholder.concerns,
        "sensitivities": stakeholder.sensitivities,
        "communication_preference": stakeholder.communication_preference,
        "contact": stakeholder.contact,
        "last_action": stakeholder.last_action,
        "personality_profile": stakeholder.personality_profile,
        "decision_style": stakeholder.decision_style,
        "communication_strategy": stakeholder.communication_strategy,
        "trust_signals": stakeholder.trust_signals,
        "note": stakeholder.note,
    }
    return {
        key: str(value).strip()
        for key, value in fields.items()
        if str(value or "").strip()
    }


def _source_ref(
    source_type: str,
    source_id: Any,
    source_label: str,
    captured_at: Any = None,
    *,
    source_state: Any = None,
    source_sha256: str = "",
) -> dict[str, str]:
    ref = {
        "source_type": str(source_type or "unknown")[:48],
        "source_id": str(source_id or "")[:80],
        "source_label": " ".join(str(source_label or "").split())[:180],
        "captured_at": _iso(captured_at)[:40],
    }
    normalized_sha = str(source_sha256 or "").strip().lower()
    ref["source_sha256"] = (
        normalized_sha
        if _SHA256_PATTERN.fullmatch(normalized_sha)
        else _sha256_json(
            {
                "domain": "aria.memory-source.v1",
                "source_type": ref["source_type"],
                "source_id": ref["source_id"],
                "state": source_state
                if source_state is not None
                else {
                    "source_label": ref["source_label"],
                    "captured_at": ref["captured_at"],
                },
            }
        )
    )
    return ref


def _sanitize_evidence_refs(values: Iterable[Any]) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for value in values:
        if not isinstance(value, dict):
            continue
        stored_sha256 = str(value.get("source_sha256") or "").strip().lower()
        ref = _source_ref(
            str(value.get("source_type") or "unknown"),
            value.get("source_id"),
            str(value.get("source_label") or ""),
            value.get("captured_at"),
            source_sha256=stored_sha256,
        )
        # Legacy ledgers predate source-state digests. Do not manufacture a
        # label/timestamp hash while reading them: it would be compared with a
        # new full-state hash and falsely mark every legacy slot stale.
        if not _SHA256_PATTERN.fullmatch(stored_sha256):
            ref.pop("source_sha256", None)
        identity = (ref["source_type"], ref["source_id"])
        if not ref["source_id"] or identity in seen:
            continue
        seen.add(identity)
        refs.append(ref)
        if len(refs) >= MAX_SLOT_EVIDENCE_REFS:
            break
    return refs


def _prompt_snapshot_evidence_refs(
    evidence_by_slot: dict[str, list[dict[str, str]]],
    source_snapshots: Mapping[str, str] | None,
) -> dict[str, list[dict[str, str]]]:
    """Limit persisted slot evidence to sources present in the provider prompt."""

    if source_snapshots is None:
        return evidence_by_slot
    if not isinstance(source_snapshots, Mapping):
        return {slot_key: [] for slot_key in evidence_by_slot}
    normalized = {
        str(handle): str(source_sha256).strip().lower()
        for handle, source_sha256 in source_snapshots.items()
        if _SHA256_PATTERN.fullmatch(str(source_sha256).strip().lower())
    }
    return {
        slot_key: [
            ref
            for ref in refs
            if normalized.get(
                f"{ref.get('source_type', '')}:{ref.get('source_id', '')}"
            )
            == str(ref.get("source_sha256") or "").strip().lower()
        ]
        for slot_key, refs in evidence_by_slot.items()
    }


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
                source_state={
                    "content": candidate.content,
                    "target_slot": candidate.target_slot,
                    "status": candidate.status,
                    "resolved_at": candidate.resolved_at,
                },
            )
        )
    return by_slot


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
            project.created_at,
            source_state=_project_base_prompt_state(project),
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
            source_state={
                "content": item.content,
                "next_step": item.next_step,
                "risk": item.risk,
                # The ProjectProgressUpdate row is part of the final source
                # freeze; its related User row is not. Persist the stable FK,
                # never mutable User.display_name, in the evidence digest.
                "created_by_user_id": item.created_by_user_id,
            },
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
        _source_ref(
            "milestone",
            item.id,
            item.title,
            None,
            source_state={
                "title": item.title,
                "is_done": item.is_done,
                "priority": "high" if item.priority == "high" else "",
                "due_date": item.due_date,
            },
        )
        for item in milestones
    ]
    todos = session.exec(
        select(ProjectTodo)
        .where(ProjectTodo.project_id == project_id)
        .order_by(ProjectTodo.updated_at.desc())
        .limit(8)
    ).all()
    todo_refs = [
        _source_ref(
            "project_todo",
            item.id,
            item.content,
            item.updated_at,
            source_state={
                "content": item.content,
                "is_done": item.is_done,
                "due_date": item.due_date,
            },
        )
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
        _source_ref(
            "project_file",
            item.id,
            item.name,
            item.uploaded_at,
            source_state={
                "name": item.name,
                "summary": str(item.summary or "")[:_PROJECT_FILE_SUMMARY_CHARS],
            },
        )
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
            source_state={
                "amount": item.amount,
                "payment_date": item.payment_date,
                "payment_type": item.payment_type,
                "note": item.note,
            },
        )
        for item in payments
    ]
    client = find_client_for_project(session, project)
    stakeholders = (
        session.exec(
            select(ClientStakeholder)
            .where(ClientStakeholder.client_id == client.id)
            .order_by(ClientStakeholder.updated_at.desc(), ClientStakeholder.id.desc())
            .limit(MAX_STAKEHOLDERS_IN_PROMPT)
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
            source_state=_stakeholder_prompt_state(item),
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
        "key_risks": [*base, *progress_refs, *milestone_refs, *payment_refs],
        "open_questions": [*base, *progress_refs, *todo_refs, *milestone_refs],
        "next_actions": [*todo_refs, *milestone_refs, *progress_refs],
        "important_documents": file_refs,
        "financial_status": [*base, *payment_refs],
        "delivery_signals": [
            *base,
            *progress_refs,
            *milestone_refs,
            *todo_refs,
            *file_refs,
        ],
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
            client.created_at,
            source_state=_client_base_prompt_state(client),
        )
    ]
    source_project_ids = {
        int(value)
        for value in list(memory.get("source_project_ids") or [])
        if str(value).isdigit()
    }
    matching_projects_by_id = {
        int(project.id): project
        for project in list_projects_for_client(session, client)
        if project.id is not None
    }
    if source_project_ids:
        for project in session.exec(
            select(Project).where(Project.id.in_(sorted(source_project_ids)))
        ).all():
            if project.id is not None:
                matching_projects_by_id[int(project.id)] = project
    matching_projects = list(matching_projects_by_id.values())
    # Explicitly requested sources (notably an older project being promoted)
    # must remain inside the bounded evidence window.
    matching_projects.sort(
        key=lambda project: int(int(project.id or 0) in source_project_ids),
        reverse=True,
    )
    matching_projects = matching_projects[:12]
    project_refs = [
        _source_ref(
            "project",
            project.id,
            f"Project: {project.name}",
            project.created_at,
            source_state=_project_for_client_prompt_state(project),
        )
        for project in matching_projects
    ]
    project_memory_refs = [
        _source_ref(
            "project_memory",
            project.id,
            f"Project memory: {project.name}",
            project.memory_updated_at,
            source_state=_project_memory_for_promotion_state(project),
        )
        for project in matching_projects
    ]
    stakeholders = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client_id)
        .order_by(ClientStakeholder.updated_at.desc(), ClientStakeholder.id.desc())
        .limit(MAX_STAKEHOLDERS_IN_PROMPT)
    ).all()
    stakeholder_refs = [
        _source_ref(
            "client_stakeholder",
            item.id,
            " · ".join(part for part in (item.name, item.role) if part),
            item.updated_at,
            source_state=_stakeholder_prompt_state(item),
        )
        for item in stakeholders
    ]
    candidates = _accepted_candidate_refs(
        session,
        scope="client",
        entity_id=client_id,
    )
    evidence = {
        "client_profile": [*base, *project_refs, *project_memory_refs],
        "decision_patterns": [
            *project_refs,
            *project_memory_refs,
            *stakeholder_refs,
            *base,
        ],
        "key_contacts": [*base, *stakeholder_refs, *project_memory_refs],
        "structured_stakeholders": stakeholder_refs,
        "lessons_learned": [*project_refs, *project_memory_refs, *base],
        "relationship_signals": [
            *project_refs,
            *project_memory_refs,
            *stakeholder_refs,
            *base,
        ],
        "project_history": [*project_refs, *project_memory_refs],
        "sensitive_topics": [
            *project_refs,
            *project_memory_refs,
            *stakeholder_refs,
            *base,
        ],
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
    source_snapshots: Mapping[str, str] | None = None,
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
        evidence_by_slot=_prompt_snapshot_evidence_refs(
            build_project_slot_evidence_refs(session, project),
            source_snapshots,
        ),
    )


def sync_client_memory_slots(
    session: Session,
    client: ClientRecord,
    memory: dict[str, Any],
    *,
    slot_keys: Iterable[str] | None = None,
    source_snapshots: Mapping[str, str] | None = None,
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
        evidence_by_slot=_prompt_snapshot_evidence_refs(
            build_client_slot_evidence_refs(session, client, memory),
            source_snapshots,
        ),
    )


def project_memory_slots_for_trigger(trigger: str) -> tuple[str, ...]:
    normalized = str(trigger or "data_changed").strip().lower()
    # Reassignment changes both the always-present Project source and the
    # additive ClientStakeholder source set. Mark every slot so a partial plan
    # cannot preserve memory built for the previous client.
    if "project_reassigned" in normalized:
        return PROJECT_MEMORY_SLOT_KEYS
    selected: set[str] = set()
    if any(term in normalized for term in ("payment", "financial", "contract_amount")):
        selected.update(("financial_status", "key_risks"))
    if "todo" in normalized:
        selected.update(
            (
                "current_objective",
                "recent_progress",
                "open_questions",
                "next_actions",
                "delivery_signals",
            )
        )
    if "milestone" in normalized:
        selected.update(
            (
                "current_stage",
                "recent_progress",
                "key_risks",
                "open_questions",
                "next_actions",
                "delivery_signals",
            )
        )
    if "progress" in normalized:
        selected.update(
            (
                "current_objective",
                "recent_progress",
                "key_risks",
                "open_questions",
                "next_actions",
                "delivery_signals",
            )
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
        select(model)
        .where(owner_column == owner_id, model.slot_key.in_(slot_keys))
        .execution_options(populate_existing=True)
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


def _slot_source_drifted(
    stored_refs: Iterable[dict[str, str]],
    current_refs: Iterable[dict[str, str]],
) -> bool:
    current_hashes = {
        f"{ref.get('source_type', '')}:{ref.get('source_id', '')}": str(
            ref.get("source_sha256") or ""
        ).strip().lower()
        for ref in current_refs
        if isinstance(ref, dict)
    }
    for ref in stored_refs:
        if str(ref.get("source_type") or "").startswith("legacy_"):
            continue
        source_sha256 = str(ref.get("source_sha256") or "").strip().lower()
        if not _SHA256_PATTERN.fullmatch(source_sha256):
            continue
        handle = f"{ref.get('source_type', '')}:{ref.get('source_id', '')}"
        if current_hashes.get(handle) != source_sha256:
            return True
    return False


def _slot_state(
    row: ProjectMemorySlot | ClientMemorySlot,
    current_refs: Iterable[dict[str, str]] = (),
) -> dict[str, Any]:
    integrity_ok, _ = _decode_slot_value(row)
    try:
        evidence_refs = json.loads(row.evidence_refs_json or "[]")
    except json.JSONDecodeError:
        evidence_refs = []
    evidence_refs = _sanitize_evidence_refs(
        evidence_refs if isinstance(evidence_refs, list) else []
    )
    source_drifted = bool(
        integrity_ok
        and not row.is_stale
        and _slot_source_drifted(evidence_refs, current_refs)
    )
    status = (
        "corrupt"
        if not integrity_ok
        else "stale"
        if row.is_stale or source_drifted
        else "ready"
    )
    public_evidence_refs = [
        {key: value for key, value in ref.items() if key != "source_sha256"}
        for ref in evidence_refs
    ] if status == "ready" else []
    return {
        "slot_key": row.slot_key,
        "slot_version": max(0, int(row.slot_version or 0)),
        "aggregate_memory_version": max(0, int(row.aggregate_memory_version or 0)),
        "status": status,
        "value_sha256": str(row.value_sha256 or ""),
        "evidence_count": len(public_evidence_refs),
        "evidence_refs": public_evidence_refs,
        "stale_reason": (
            str(row.stale_reason or "")
            if row.is_stale
            else "source_changed"
            if source_drifted
            else ""
        ),
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
    project = session.get(Project, project_id)
    evidence_by_slot = (
        build_project_slot_evidence_refs(session, project)
        if project is not None
        else {}
    )
    return [
        _slot_state(row, evidence_by_slot.get(row.slot_key, []))
        for row in rows
    ]


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
    client = session.get(ClientRecord, client_id)
    memory: dict[str, Any] = {}
    if client is not None:
        try:
            parsed = json.loads(client.client_memory_json or "{}")
        except (json.JSONDecodeError, TypeError):
            parsed = {}
        if isinstance(parsed, dict):
            memory = parsed
    evidence_by_slot = (
        build_client_slot_evidence_refs(session, client, memory)
        if client is not None
        else {}
    )
    return [
        _slot_state(row, evidence_by_slot.get(row.slot_key, []))
        for row in rows
    ]


def _overlay_slot_rows(
    payload: dict[str, Any],
    rows: Iterable[ProjectMemorySlot | ClientMemorySlot],
    evidence_by_slot: Mapping[str, Iterable[dict[str, str]]] | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    result = dict(payload)
    states: dict[str, dict[str, Any]] = {}
    for row in rows:
        integrity_ok, value = _decode_slot_value(row)
        state = _slot_state(
            row,
            (evidence_by_slot or {}).get(row.slot_key, ()),
        )
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


def build_memory_read_authority_report(
    aggregate_payload: Mapping[str, Any],
    rows: Iterable[ProjectMemorySlot | ClientMemorySlot],
    slot_keys: Iterable[str],
    *,
    editable_slot_keys: Iterable[str] = (),
    slot_states: Iterable[Mapping[str, Any]] = (),
    safe_aggregate_only_keys: Iterable[str] = (),
) -> dict[str, Any]:
    """Describe slot-ledger authority without returning memory content.

    The aggregate JSON remains a compatibility container. This report makes
    every business-slot fallback and dual-write divergence observable before
    Aria attempts a future read-model cutover or removes compatibility code.
    """

    expected = tuple(dict.fromkeys(str(key) for key in slot_keys if str(key)))
    expected_set = set(expected)
    editable = {str(key) for key in editable_slot_keys if str(key)}
    safe_metadata_keys = SAFE_AGGREGATE_ONLY_KEYS | {
        str(key) for key in safe_aggregate_only_keys if str(key)
    }
    row_by_key = {
        str(row.slot_key): row
        for row in rows
        if str(row.slot_key) in expected_set
    }
    unexpected_slots = sorted(
        {
            str(row.slot_key)
            for row in rows
            if str(row.slot_key) not in expected_set
        }
    )
    state_by_key = {
        str(state.get("slot_key") or ""): state
        for state in slot_states
        if isinstance(state, Mapping) and str(state.get("slot_key") or "")
    }

    ledger_slots: list[str] = []
    ready_slots: list[str] = []
    stale_slots: list[str] = []
    missing_slots: list[str] = []
    corrupt_slots: list[str] = []
    divergent_slots: list[str] = []
    divergent_slot_details: list[dict[str, Any]] = []
    try:
        current_aggregate_version = max(
            0,
            int(aggregate_payload.get("memory_version") or 0),
        )
    except (TypeError, ValueError):
        current_aggregate_version = 0
    for slot_key in expected:
        row = row_by_key.get(slot_key)
        if row is None:
            missing_slots.append(slot_key)
            continue
        integrity_ok, value = _decode_slot_value(row)
        if not integrity_ok:
            corrupt_slots.append(slot_key)
            continue
        ledger_slots.append(slot_key)
        state = state_by_key.get(slot_key)
        status = str(state.get("status") or "") if state else (
            "stale" if row.is_stale else "ready"
        )
        if status == "ready":
            ready_slots.append(slot_key)
        else:
            stale_slots.append(slot_key)

        detail_key = f"{slot_key}_detail"
        aggregate_value = (
            aggregate_payload.get(detail_key)
            if slot_key in editable and detail_key in aggregate_payload
            else aggregate_payload.get(slot_key)
        )
        if _sha256_json(aggregate_value) != _sha256_json(value):
            divergent_slots.append(slot_key)
            row_aggregate_version = max(
                0,
                int(row.aggregate_memory_version or 0),
            )
            divergent_slot_details.append(
                {
                    "slot_key": slot_key,
                    "ledger_value_type": _json_value_type(value),
                    "aggregate_value_type": _json_value_type(aggregate_value),
                    "aggregate_version_relation": _memory_version_relation(
                        row_aggregate_version,
                        current_aggregate_version,
                    ),
                }
            )

    fallback_set = set(missing_slots) | set(corrupt_slots)
    fallback_slots = [
        slot_key
        for slot_key in expected
        if slot_key in fallback_set
    ]
    derived_detail_keys = {f"{slot_key}_detail" for slot_key in editable}
    aggregate_only_keys = [
        str(key)
        for key in aggregate_payload
        if str(key) not in expected_set and str(key) not in derived_detail_keys
    ]
    recognized_aggregate_only_keys = sorted(
        key for key in aggregate_only_keys if key in safe_metadata_keys
    )
    unknown_aggregate_only_key_count = sum(
        key not in safe_metadata_keys for key in aggregate_only_keys
    )
    business_slot_cutover_ready = not fallback_slots
    dual_write_consistent = (
        business_slot_cutover_ready
        and not divergent_slots
        and not unexpected_slots
    )
    return {
        "schema_version": 1,
        "read_mode": (
            "slot_ledger"
            if business_slot_cutover_ready
            else "hybrid_aggregate_fallback"
        ),
        "expected_slot_count": len(expected),
        "ledger_row_count": len(row_by_key),
        "ledger_value_count": len(ledger_slots),
        "ready_slot_count": len(ready_slots),
        "stale_slot_count": len(stale_slots),
        "stale_slots": stale_slots,
        "missing_slot_count": len(missing_slots),
        "missing_slots": missing_slots,
        "corrupt_slot_count": len(corrupt_slots),
        "corrupt_slots": corrupt_slots,
        "aggregate_fallback_slot_count": len(fallback_slots),
        "aggregate_fallback_slots": fallback_slots,
        "divergent_slot_count": len(divergent_slots),
        "divergent_slots": divergent_slots,
        "divergent_slot_details": divergent_slot_details,
        "unexpected_slot_count": len(unexpected_slots),
        "aggregate_only_key_count": len(aggregate_only_keys),
        "aggregate_only_keys": recognized_aggregate_only_keys,
        "aggregate_only_unknown_key_count": unknown_aggregate_only_key_count,
        "business_slot_cutover_ready": business_slot_cutover_ready,
        "dual_write_consistent": dual_write_consistent,
        "aggregate_container_retirement_ready": (
            dual_write_consistent and not aggregate_only_keys
        ),
    }


def summarize_memory_read_authority(
    reports: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Aggregate content-free authority metrics for operational audits."""

    items = [dict(report) for report in reports]

    def slot_counts(field: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for item in items:
            values = item.get(field)
            if not isinstance(values, list):
                continue
            for value in values:
                key = str(value or "").strip()
                if key:
                    counts[key] = counts.get(key, 0) + 1
        return dict(sorted(counts.items()))

    total = len(items)
    cutover_ready = sum(
        bool(item.get("business_slot_cutover_ready")) for item in items
    )
    consistent = sum(bool(item.get("dual_write_consistent")) for item in items)
    divergence_profiles: dict[tuple[str, str, str, str], int] = {}
    for item in items:
        details = item.get("divergent_slot_details")
        if not isinstance(details, list):
            continue
        for detail in details:
            if not isinstance(detail, Mapping):
                continue
            profile = (
                str(detail.get("slot_key") or ""),
                str(detail.get("ledger_value_type") or "other"),
                str(detail.get("aggregate_value_type") or "other"),
                str(detail.get("aggregate_version_relation") or "equal"),
            )
            if not profile[0]:
                continue
            divergence_profiles[profile] = divergence_profiles.get(profile, 0) + 1
    return {
        "schema_version": 1,
        "entity_count": total,
        "slot_ledger_entity_count": sum(
            item.get("read_mode") == "slot_ledger" for item in items
        ),
        "hybrid_fallback_entity_count": sum(
            item.get("read_mode") == "hybrid_aggregate_fallback"
            for item in items
        ),
        "business_slot_cutover_ready_entity_count": cutover_ready,
        "business_slot_cutover_ready_rate": round(cutover_ready / total, 4)
        if total
        else 1.0,
        "dual_write_consistent_entity_count": consistent,
        "dual_write_consistency_rate": round(consistent / total, 4)
        if total
        else 1.0,
        "aggregate_fallback_slot_count": sum(
            max(0, int(item.get("aggregate_fallback_slot_count") or 0))
            for item in items
        ),
        "aggregate_fallback_slots_by_key": slot_counts(
            "aggregate_fallback_slots"
        ),
        "missing_slot_count": sum(
            max(0, int(item.get("missing_slot_count") or 0))
            for item in items
        ),
        "missing_slots_by_key": slot_counts("missing_slots"),
        "stale_slot_count": sum(
            max(0, int(item.get("stale_slot_count") or 0))
            for item in items
        ),
        "stale_slots_by_key": slot_counts("stale_slots"),
        "divergent_slot_count": sum(
            max(0, int(item.get("divergent_slot_count") or 0))
            for item in items
        ),
        "divergent_slots_by_key": slot_counts("divergent_slots"),
        "divergence_profiles": [
            {
                "slot_key": slot_key,
                "ledger_value_type": ledger_type,
                "aggregate_value_type": aggregate_type,
                "aggregate_version_relation": version_relation,
                "count": count,
            }
            for (
                slot_key,
                ledger_type,
                aggregate_type,
                version_relation,
            ), count in sorted(divergence_profiles.items())
        ],
        "corrupt_slot_count": sum(
            max(0, int(item.get("corrupt_slot_count") or 0))
            for item in items
        ),
        "corrupt_slots_by_key": slot_counts("corrupt_slots"),
        "aggregate_container_retirement_ready_entity_count": sum(
            bool(item.get("aggregate_container_retirement_ready"))
            for item in items
        ),
        "aggregate_only_key_count": sum(
            max(0, int(item.get("aggregate_only_key_count") or 0))
            for item in items
        ),
        "safe_aggregate_only_keys_by_key": slot_counts("aggregate_only_keys"),
        "entities_with_unknown_aggregate_keys": sum(
            max(0, int(item.get("aggregate_only_unknown_key_count") or 0)) > 0
            for item in items
        ),
    }


def get_project_memory_read_authority_report(
    session: Session,
    project: Project,
    aggregate_payload: Mapping[str, Any],
    *,
    slot_states: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    rows = session.exec(
        select(ProjectMemorySlot).where(
            ProjectMemorySlot.project_id == int(project.id or 0)
        )
    ).all()
    return build_memory_read_authority_report(
        aggregate_payload,
        rows,
        PROJECT_MEMORY_SLOT_KEYS,
        editable_slot_keys=PROJECT_EDITABLE_SLOT_KEYS,
        slot_states=slot_states,
        safe_aggregate_only_keys=PROJECT_SAFE_AGGREGATE_ONLY_KEYS,
    )


def get_client_memory_read_authority_report(
    session: Session,
    client: ClientRecord,
    aggregate_payload: Mapping[str, Any],
    *,
    slot_states: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    rows = session.exec(
        select(ClientMemorySlot).where(
            ClientMemorySlot.client_id == int(client.id or 0)
        )
    ).all()
    return build_memory_read_authority_report(
        aggregate_payload,
        rows,
        CLIENT_MEMORY_SLOT_KEYS,
        slot_states=slot_states,
        safe_aggregate_only_keys=CLIENT_SAFE_AGGREGATE_ONLY_KEYS,
    )


def load_project_memory_slot_view(
    session: Session,
    project: Project,
    aggregate_payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    rows = session.exec(
        select(ProjectMemorySlot).where(ProjectMemorySlot.project_id == int(project.id or 0))
    ).all()
    return _overlay_slot_rows(
        aggregate_payload,
        rows,
        build_project_slot_evidence_refs(session, project),
    )


def load_project_memory_slot_values(
    session: Session,
    project: Project,
    aggregate_payload: dict[str, Any],
) -> dict[str, Any]:
    """Return the verified slot-ledger value projection for one project.

    Read-only product surfaces that do not expose freshness metadata use this
    lighter projection. A corrupt or absent slot safely falls back to the
    compatibility aggregate; a verified slot remains authoritative when the
    aggregate copy has diverged.
    """

    views = load_project_memory_slot_value_views(
        session,
        {int(project.id or 0): aggregate_payload},
    )
    return views.get(int(project.id or 0), dict(aggregate_payload))


def load_project_memory_slot_value_views(
    session: Session,
    aggregate_payloads: Mapping[int, dict[str, Any]],
) -> dict[int, dict[str, Any]]:
    """Batch-load verified project slot values without per-project queries."""

    project_ids = sorted(
        int(project_id)
        for project_id in aggregate_payloads
        if int(project_id) > 0
    )
    rows_by_project: dict[int, list[ProjectMemorySlot]] = {
        project_id: [] for project_id in project_ids
    }
    if project_ids:
        rows = session.exec(
            select(ProjectMemorySlot).where(
                ProjectMemorySlot.project_id.in_(project_ids)
            )
        ).all()
        for row in rows:
            rows_by_project.setdefault(int(row.project_id), []).append(row)

    return {
        int(project_id): _overlay_slot_rows(
            dict(payload),
            rows_by_project.get(int(project_id), ()),
        )[0]
        for project_id, payload in aggregate_payloads.items()
    }


def load_client_memory_slot_view(
    session: Session,
    client: ClientRecord,
    aggregate_payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    rows = session.exec(
        select(ClientMemorySlot).where(ClientMemorySlot.client_id == int(client.id or 0))
    ).all()
    return _overlay_slot_rows(
        aggregate_payload,
        rows,
        build_client_slot_evidence_refs(session, client, aggregate_payload),
    )


def load_client_memory_slot_values(
    session: Session,
    client: ClientRecord,
    aggregate_payload: dict[str, Any],
) -> dict[str, Any]:
    """Return verified client slot values with aggregate fallback."""

    rows = session.exec(
        select(ClientMemorySlot).where(
            ClientMemorySlot.client_id == int(client.id or 0)
        )
    ).all()
    return _overlay_slot_rows(aggregate_payload, rows)[0]
