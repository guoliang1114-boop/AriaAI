"""Fact-level memory identities, lifecycle, freshness, and provenance.

Aria keeps every fact and its business authorization in native project/client
services. Content-addressed fact identities and digest-verified reconstruction
adapt the stable world-state identity boundary from OpenAI Codex
``codex-rs/core/src/context/world_state/mod.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).
No Codex runtime, SDK, protocol, process, or communication is used.

Provenance is deliberately honest: ``matched`` means a source label can be
deterministically matched to the fact, ``scoped`` means only that the source
was read while rebuilding the containing slot, ``legacy`` identifies migrated
aggregate data, and ``unresolved`` means no source is currently available.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Any, Iterable

from sqlmodel import Session, select

from app.models.db import (
    ClientMemoryFact,
    ClientRecord,
    Project,
    ProjectMemoryFact,
)
from app.services.memory_slots import (
    CLIENT_MEMORY_SLOT_KEYS,
    PROJECT_EDITABLE_SLOT_KEYS,
    PROJECT_MEMORY_SLOT_KEYS,
    build_client_slot_evidence_refs,
    build_project_slot_evidence_refs,
    client_memory_slots_for_trigger,
    project_memory_slots_for_trigger,
)
from app.services.time_utils import utc_now_naive


MAX_FACT_EVIDENCE_REFS = 6
MAX_FACT_PREVIEW_CHARS = 280
FACT_PROVENANCE_STATUSES = frozenset({"matched", "scoped", "legacy", "unresolved"})
_MATCH_TEXT_PATTERN = re.compile(r"[^0-9a-z\u3400-\u9fff]+")


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _value_sha256(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _fact_key(scope: str, slot_key: str, source_kind: str, value: Any) -> str:
    digest = hashlib.sha256(
        (
            f"aria.memory-fact.v1\0{scope}\0{slot_key}\0{source_kind}\0"
            + _canonical_json(value)
        ).encode("utf-8")
    ).hexdigest()
    return f"{scope[:1]}mf_{digest[:24]}"


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict, tuple, set)):
        return bool(value)
    return True


def _flatten_slot_facts(
    memory: dict[str, Any],
    slot_key: str,
    *,
    project_scope: bool,
) -> list[dict[str, Any]]:
    value = memory.get(slot_key)
    if project_scope:
        detail = memory.get(f"{slot_key}_detail")
        if isinstance(detail, dict):
            value = detail
    values: list[tuple[str, Any]] = []
    if (
        project_scope
        and slot_key in PROJECT_EDITABLE_SLOT_KEYS
        and isinstance(value, dict)
    ):
        for source_kind in ("pinned", "ai"):
            items = value.get(source_kind)
            if isinstance(items, list):
                values.extend((source_kind, item) for item in items)
    elif isinstance(value, list):
        values.extend(("item", item) for item in value)
    elif _has_value(value):
        values.append(("value", value))

    result: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for source_kind, item in values:
        if not _has_value(item):
            continue
        identity = (source_kind, _canonical_json(item))
        if identity in seen:
            continue
        seen.add(identity)
        result.append(
            {
                "source_kind": source_kind,
                "ordinal": len(result),
                "value": item,
            }
        )
    return result


def _normalize_match_text(value: Any) -> str:
    return _MATCH_TEXT_PATTERN.sub("", str(value or "").lower())


def _label_fragments(value: str) -> tuple[str, ...]:
    raw = " ".join(str(value or "").split())
    candidates = [raw]
    for separator in (":", "：", "·", "/", "|"):
        candidates.extend(part.strip() for part in raw.split(separator))
    normalized = []
    for candidate in candidates:
        text = _normalize_match_text(candidate)
        if len(text) >= 4 and text not in normalized:
            normalized.append(text)
    return tuple(normalized)


def _sanitize_ref(value: Any, relation: str) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    source_id = str(value.get("source_id") or "")[:80]
    if not source_id:
        return None
    return {
        "source_type": str(value.get("source_type") or "unknown")[:48],
        "source_id": source_id,
        "source_label": " ".join(str(value.get("source_label") or "").split())[:180],
        "captured_at": str(value.get("captured_at") or "")[:40],
        "relation": relation,
    }


def _fact_evidence(
    value: Any,
    refs: Iterable[Any],
) -> tuple[str, list[dict[str, str]]]:
    source_refs = [ref for ref in refs if isinstance(ref, dict)]
    if not source_refs:
        return "unresolved", []
    if all(str(ref.get("source_type") or "") == "legacy_memory_aggregate" for ref in source_refs):
        legacy = [
            sanitized
            for ref in source_refs[:MAX_FACT_EVIDENCE_REFS]
            if (sanitized := _sanitize_ref(ref, "legacy_aggregate")) is not None
        ]
        return "legacy", legacy

    fact_text = _normalize_match_text(_canonical_json(value))
    matched: list[dict[str, str]] = []
    for ref in source_refs:
        fragments = _label_fragments(str(ref.get("source_label") or ""))
        if not any(fragment in fact_text or fact_text in fragment for fragment in fragments):
            continue
        sanitized = _sanitize_ref(ref, "label_match")
        if sanitized is not None:
            matched.append(sanitized)
        if len(matched) >= MAX_FACT_EVIDENCE_REFS:
            break
    if matched:
        return "matched", matched

    scoped = [
        sanitized
        for ref in source_refs[:MAX_FACT_EVIDENCE_REFS]
        if (sanitized := _sanitize_ref(ref, "slot_scope")) is not None
    ]
    return ("scoped", scoped) if scoped else ("unresolved", [])


def _sync_fact_rows(
    session: Session,
    *,
    scope: str,
    owner_id: int,
    owner_field: str,
    model: type[ProjectMemoryFact] | type[ClientMemoryFact],
    slot_keys: tuple[str, ...],
    memory_version: int,
    memory: dict[str, Any],
    evidence_by_slot: dict[str, list[dict[str, str]]],
) -> None:
    owner_column = getattr(model, owner_field)
    rows = session.exec(select(model).where(owner_column == owner_id)).all()
    existing = {(row.slot_key, row.fact_key): row for row in rows}
    active_identities: set[tuple[str, str]] = set()
    now = utc_now_naive()

    for slot_key in slot_keys:
        for fact in _flatten_slot_facts(
            memory,
            slot_key,
            project_scope=scope == "project",
        ):
            source_kind = str(fact["source_kind"])
            value = fact["value"]
            fact_key = _fact_key(scope, slot_key, source_kind, value)
            identity = (slot_key, fact_key)
            active_identities.add(identity)
            value_json = _canonical_json(value)
            provenance_status, evidence_refs = _fact_evidence(
                value,
                evidence_by_slot.get(slot_key, []),
            )
            row = existing.get(identity)
            if row is None:
                row = model(
                    **{owner_field: owner_id},
                    slot_key=slot_key,
                    fact_key=fact_key,
                    first_seen_memory_version=memory_version,
                    created_at=now,
                )
            row.source_kind = source_kind
            row.ordinal = int(fact["ordinal"])
            row.last_seen_memory_version = memory_version
            row.value_json = value_json
            row.value_sha256 = hashlib.sha256(value_json.encode("utf-8")).hexdigest()
            row.evidence_refs_json = _canonical_json(evidence_refs)
            row.evidence_count = len(evidence_refs)
            row.provenance_status = provenance_status
            row.is_active = True
            row.is_stale = False
            row.stale_reason = ""
            row.stale_at = None
            row.retired_at = None
            row.updated_at = now
            session.add(row)

    for row in rows:
        identity = (row.slot_key, row.fact_key)
        if row.is_active and identity not in active_identities:
            row.is_active = False
            row.retired_at = now
            row.updated_at = now
            session.add(row)


def sync_project_memory_facts(
    session: Session,
    project: Project,
    memory: dict[str, Any],
) -> None:
    if project.id is None:
        return
    _sync_fact_rows(
        session,
        scope="project",
        owner_id=project.id,
        owner_field="project_id",
        model=ProjectMemoryFact,
        slot_keys=PROJECT_MEMORY_SLOT_KEYS,
        memory_version=max(0, int(project.memory_version or 0)),
        memory=memory,
        evidence_by_slot=build_project_slot_evidence_refs(session, project),
    )


def sync_client_memory_facts(
    session: Session,
    client: ClientRecord,
    memory: dict[str, Any],
) -> None:
    if client.id is None:
        return
    _sync_fact_rows(
        session,
        scope="client",
        owner_id=client.id,
        owner_field="client_id",
        model=ClientMemoryFact,
        slot_keys=CLIENT_MEMORY_SLOT_KEYS,
        memory_version=max(0, int(client.client_memory_version or 0)),
        memory=memory,
        evidence_by_slot=build_client_slot_evidence_refs(session, client, memory),
    )


def _mark_facts_stale(
    session: Session,
    *,
    owner_id: int,
    owner_field: str,
    model: type[ProjectMemoryFact] | type[ClientMemoryFact],
    slot_keys: tuple[str, ...],
    trigger: str,
) -> None:
    owner_column = getattr(model, owner_field)
    rows = session.exec(
        select(model).where(
            owner_column == owner_id,
            model.is_active.is_(True),
            model.slot_key.in_(slot_keys),
        )
    ).all()
    now = utc_now_naive()
    for row in rows:
        row.is_stale = True
        row.stale_reason = str(trigger or "data_changed")[:160]
        row.stale_at = now
        row.updated_at = now
        session.add(row)


def mark_project_memory_facts_stale(
    session: Session,
    project_id: int,
    trigger: str,
) -> None:
    _mark_facts_stale(
        session,
        owner_id=project_id,
        owner_field="project_id",
        model=ProjectMemoryFact,
        slot_keys=project_memory_slots_for_trigger(trigger),
        trigger=trigger,
    )


def mark_client_memory_facts_stale(
    session: Session,
    client_id: int,
    trigger: str,
) -> None:
    _mark_facts_stale(
        session,
        owner_id=client_id,
        owner_field="client_id",
        model=ClientMemoryFact,
        slot_keys=client_memory_slots_for_trigger(trigger),
        trigger=trigger,
    )


def _decode_fact_value(
    row: ProjectMemoryFact | ClientMemoryFact,
) -> tuple[bool, Any]:
    try:
        value = json.loads(row.value_json or "null")
    except json.JSONDecodeError:
        return False, None
    return _value_sha256(value) == str(row.value_sha256 or ""), value


def _decode_evidence_refs(value: str) -> list[dict[str, str]]:
    try:
        refs = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    result: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for ref in refs if isinstance(refs, list) else []:
        if not isinstance(ref, dict):
            continue
        relation = str(ref.get("relation") or "slot_scope")[:32]
        sanitized = _sanitize_ref(ref, relation)
        if sanitized is None:
            continue
        identity = (
            sanitized["source_type"],
            sanitized["source_id"],
            sanitized["relation"],
        )
        if identity in seen:
            continue
        seen.add(identity)
        result.append(sanitized)
        if len(result) >= MAX_FACT_EVIDENCE_REFS:
            break
    return result


def _fact_preview(value: Any) -> str:
    if isinstance(value, str):
        text = " ".join(value.split())
    else:
        text = _canonical_json(value)
    return text[:MAX_FACT_PREVIEW_CHARS]


def _fact_state(row: ProjectMemoryFact | ClientMemoryFact) -> dict[str, Any]:
    integrity_ok, value = _decode_fact_value(row)
    evidence_refs = _decode_evidence_refs(row.evidence_refs_json)
    if not row.is_active:
        status = "retired"
    elif not integrity_ok:
        status = "corrupt"
    elif row.is_stale:
        status = "stale"
    else:
        status = "ready"
    provenance_status = str(row.provenance_status or "unresolved")
    if provenance_status not in FACT_PROVENANCE_STATUSES:
        provenance_status = "unresolved"
    return {
        "fact_key": row.fact_key,
        "slot_key": row.slot_key,
        "source_kind": row.source_kind,
        "ordinal": max(0, int(row.ordinal or 0)),
        "first_seen_memory_version": max(0, int(row.first_seen_memory_version or 0)),
        "last_seen_memory_version": max(0, int(row.last_seen_memory_version or 0)),
        "status": status,
        "provenance_status": provenance_status,
        "value_sha256": str(row.value_sha256 or ""),
        "value_preview": _fact_preview(value) if integrity_ok else "",
        "evidence_count": len(evidence_refs),
        "evidence_refs": evidence_refs,
        "stale_reason": str(row.stale_reason or ""),
        "stale_at": row.stale_at.isoformat() if row.stale_at else None,
        "retired_at": row.retired_at.isoformat() if row.retired_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def get_project_memory_fact_states(
    session: Session,
    project_id: int,
    *,
    include_retired: bool = False,
) -> list[dict[str, Any]]:
    statement = select(ProjectMemoryFact).where(ProjectMemoryFact.project_id == project_id)
    if not include_retired:
        statement = statement.where(ProjectMemoryFact.is_active.is_(True))
    rows = session.exec(
        statement.order_by(ProjectMemoryFact.slot_key, ProjectMemoryFact.ordinal)
    ).all()
    return [_fact_state(row) for row in rows]


def get_client_memory_fact_states(
    session: Session,
    client_id: int,
    *,
    include_retired: bool = False,
) -> list[dict[str, Any]]:
    statement = select(ClientMemoryFact).where(ClientMemoryFact.client_id == client_id)
    if not include_retired:
        statement = statement.where(ClientMemoryFact.is_active.is_(True))
    rows = session.exec(
        statement.order_by(ClientMemoryFact.slot_key, ClientMemoryFact.ordinal)
    ).all()
    return [_fact_state(row) for row in rows]


def fact_states_by_slot(
    values: Iterable[dict[str, Any]],
) -> dict[str, dict[int, dict[str, Any]]]:
    result: dict[str, dict[int, dict[str, Any]]] = {}
    for value in values:
        slot_key = str(value.get("slot_key") or "")
        if not slot_key:
            continue
        result.setdefault(slot_key, {})[max(0, int(value.get("ordinal") or 0))] = value
    return result
