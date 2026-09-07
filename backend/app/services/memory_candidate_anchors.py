"""Native lifecycle and authority for accepted project/client memory anchors.

Aria keeps accepted-candidate preservation in its own durable ledger instead of
embedding private control data in aggregate memory JSON. Stable anchor identity
adapts the content-addressed world-state boundary from OpenAI Codex
``codex-rs/core/src/context/world_state/mod.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).
No Codex runtime, SDK, protocol, process, or communication is used.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Collection, Iterable, Mapping

from sqlmodel import Session, select

from app.models.db import (
    ClientRecord,
    MemoryCandidate,
    MemoryCandidateAnchor,
    Project,
)
from app.services.time_utils import utc_now_naive


LEGACY_ACCEPTED_MEMORY_CANDIDATES_KEY = "_accepted_memory_candidates"
RETIRED_MODEL_SOURCE_METADATA_KEYS = frozenset(
    {"_source_attributions", "_model_source_attributions"}
)
PROJECT_MEMORY_ANCHOR_SLOTS = frozenset(
    {
        "recent_progress",
        "key_risks",
        "open_questions",
        "next_actions",
        "delivery_signals",
        "stakeholder_notes",
    }
)
PROJECT_EDITABLE_MEMORY_ANCHOR_SLOTS = frozenset(
    {"key_risks", "open_questions", "stakeholder_notes"}
)
CLIENT_MEMORY_ANCHOR_SLOTS = frozenset(
    {"decision_patterns", "lessons_learned", "relationship_signals"}
)
MAX_ACTIVE_ANCHORS_PER_SLOT = 50


def normalize_memory_anchor_content(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def memory_anchor_content_sha256(value: Any) -> str:
    content = normalize_memory_anchor_content(value)
    return hashlib.sha256(
        f"aria.memory-candidate.content.v1\0{content}".encode("utf-8")
    ).hexdigest()


def memory_anchor_key(
    scope: str,
    entity_id: int,
    slot_key: str,
    content: Any,
) -> str:
    normalized_scope = str(scope or "").strip().lower()
    normalized_slot = str(slot_key or "").strip()
    content_sha256 = memory_anchor_content_sha256(content)
    digest = hashlib.sha256(
        (
            f"aria.memory-candidate-anchor.v1\0{normalized_scope}\0"
            f"{int(entity_id)}\0{normalized_slot}\0{content_sha256}"
        ).encode("utf-8")
    ).hexdigest()
    return f"{normalized_scope[:1]}mca_{digest[:24]}"


def _scope_owner_id(anchor: MemoryCandidateAnchor) -> int:
    value = anchor.project_id if anchor.scope == "project" else anchor.client_id
    return int(value or 0)


def memory_anchor_integrity_valid(anchor: MemoryCandidateAnchor) -> bool:
    content = normalize_memory_anchor_content(anchor.content)
    owner_id = _scope_owner_id(anchor)
    allowed_slots = (
        PROJECT_MEMORY_ANCHOR_SLOTS
        if anchor.scope == "project"
        else CLIENT_MEMORY_ANCHOR_SLOTS
        if anchor.scope == "client"
        else frozenset()
    )
    if anchor.scope == "project":
        owner_shape_valid = anchor.project_id is not None and anchor.client_id is None
    elif anchor.scope == "client":
        owner_shape_valid = anchor.client_id is not None and anchor.project_id is None
    else:
        owner_shape_valid = False
    return bool(
        anchor.scope in {"project", "client"}
        and owner_shape_valid
        and owner_id > 0
        and anchor.slot_key in allowed_slots
        and anchor.status in {"active", "retired"}
        and int(anchor.revision or 0) >= 1
        and content
        and anchor.content_sha256 == memory_anchor_content_sha256(content)
        and anchor.anchor_key
        == memory_anchor_key(anchor.scope, owner_id, anchor.slot_key, content)
    )


def load_active_memory_candidate_anchors(
    session: Session,
    *,
    scope: str,
    entity_id: int,
) -> dict[str, list[str]]:
    """Load digest-verified active anchors, bounded independently per slot."""

    normalized_scope = str(scope or "").strip().lower()
    allowed_slots = (
        PROJECT_MEMORY_ANCHOR_SLOTS
        if normalized_scope == "project"
        else CLIENT_MEMORY_ANCHOR_SLOTS
        if normalized_scope == "client"
        else frozenset()
    )
    if not allowed_slots or int(entity_id or 0) <= 0:
        return {}
    statement = select(MemoryCandidateAnchor).where(
        MemoryCandidateAnchor.scope == normalized_scope,
        MemoryCandidateAnchor.status == "active",
    )
    if normalized_scope == "project":
        statement = statement.where(MemoryCandidateAnchor.project_id == entity_id)
    else:
        statement = statement.where(MemoryCandidateAnchor.client_id == entity_id)
    rows = session.exec(
        statement.order_by(
            MemoryCandidateAnchor.activated_at,
            MemoryCandidateAnchor.id,
        )
    ).all()
    result: dict[str, list[str]] = {}
    for row in rows:
        slot_key = str(row.slot_key or "").strip()
        if slot_key not in allowed_slots or not memory_anchor_integrity_valid(row):
            continue
        content = normalize_memory_anchor_content(row.content)
        values = result.setdefault(slot_key, [])
        if content not in values:
            values.append(content)
            if len(values) > MAX_ACTIVE_ANCHORS_PER_SLOT:
                del values[0]
    return result


def apply_memory_candidate_anchors(
    memory: Mapping[str, Any],
    anchors: Mapping[str, Iterable[Any]],
    *,
    editable_slots: Collection[str] = (),
) -> dict[str, Any]:
    """Overlay native accepted anchors onto a validated memory projection."""

    result = dict(memory)
    editable = {str(slot) for slot in editable_slots}
    for raw_slot, raw_items in anchors.items():
        slot_key = str(raw_slot or "").strip()
        items: list[str] = []
        for raw_item in raw_items if isinstance(raw_items, Iterable) else ():
            content = normalize_memory_anchor_content(raw_item)
            if content and content not in items:
                items.append(content)
        if not items:
            continue
        if slot_key in editable:
            current = result.get(slot_key)
            current = dict(current) if isinstance(current, dict) else {}
            ai_values = current.get("ai")
            pinned_values = current.get("pinned")
            ai = (
                [normalize_memory_anchor_content(item) for item in ai_values]
                if isinstance(ai_values, list)
                else []
            )
            pinned = (
                [normalize_memory_anchor_content(item) for item in pinned_values]
                if isinstance(pinned_values, list)
                else []
            )
            result[slot_key] = {
                "ai": [item for item in ai if item],
                "pinned": list(dict.fromkeys([*filter(None, pinned), *items]))[-50:],
            }
            continue
        current = result.get(slot_key)
        values = (
            [normalize_memory_anchor_content(item) for item in current]
            if isinstance(current, list)
            else []
        )
        result[slot_key] = list(
            dict.fromkeys([*filter(None, values), *items])
        )[-50:]
    return result


def strip_retired_memory_candidate_metadata(
    memory: Mapping[str, Any],
    *,
    scope: str,
) -> dict[str, Any]:
    """Remove retired private envelopes while preserving malformed legacy data.

    A well-shaped legacy anchor map is already reconstructable by migration
    054 and must not be written again. Unexpected shapes stay visible to the
    content-free aggregate audit instead of being silently discarded by an
    otherwise unrelated memory save.
    """

    result = dict(memory)
    allowed_slots = (
        PROJECT_MEMORY_ANCHOR_SLOTS
        if scope == "project"
        else CLIENT_MEMORY_ANCHOR_SLOTS
        if scope == "client"
        else frozenset()
    )
    raw_anchors = result.get(LEGACY_ACCEPTED_MEMORY_CANDIDATES_KEY)
    if isinstance(raw_anchors, dict) and all(
        str(slot_key) in allowed_slots
        and isinstance(items, list)
        and all(isinstance(item, str) for item in items)
        for slot_key, items in raw_anchors.items()
    ):
        result.pop(LEGACY_ACCEPTED_MEMORY_CANDIDATES_KEY, None)
    for key in RETIRED_MODEL_SOURCE_METADATA_KEYS:
        result.pop(key, None)
    return result


def activate_memory_candidate_anchor(
    session: Session,
    candidate: MemoryCandidate,
    *,
    actor_user_id: int | None,
) -> MemoryCandidateAnchor | None:
    """Create or reactivate the anchor represented by an accepted candidate."""

    scope = str(candidate.scope or "").strip().lower()
    if str(candidate.status or "").strip().lower() != "accepted":
        return None
    entity_id = (
        int(candidate.project_id or 0)
        if scope == "project"
        else int(candidate.client_id or 0)
        if scope == "client"
        else 0
    )
    slot_key = str(candidate.target_slot or "").strip()
    allowed_slots = (
        PROJECT_MEMORY_ANCHOR_SLOTS
        if scope == "project"
        else CLIENT_MEMORY_ANCHOR_SLOTS
        if scope == "client"
        else frozenset()
    )
    content = normalize_memory_anchor_content(candidate.content)
    if entity_id <= 0 or slot_key not in allowed_slots or not content:
        return None
    anchor_key = memory_anchor_key(scope, entity_id, slot_key, content)
    row = session.exec(
        select(MemoryCandidateAnchor)
        .where(MemoryCandidateAnchor.anchor_key == anchor_key)
        .with_for_update()
    ).first()
    now = utc_now_naive()
    if row is None:
        row = MemoryCandidateAnchor(
            anchor_key=anchor_key,
            scope=scope,
            project_id=entity_id if scope == "project" else None,
            client_id=entity_id if scope == "client" else None,
            slot_key=slot_key,
            content=content,
            content_sha256=memory_anchor_content_sha256(content),
            source_candidate_id=candidate.id,
            status="active",
            revision=1,
            activated_by_user_id=actor_user_id,
            activated_at=now,
            created_at=now,
            updated_at=now,
        )
    else:
        if not memory_anchor_integrity_valid(row):
            raise ValueError("Memory candidate anchor integrity check failed")
        changed = row.status != "active"
        row.content = content
        row.content_sha256 = memory_anchor_content_sha256(content)
        row.source_candidate_id = candidate.id
        row.status = "active"
        row.activated_by_user_id = actor_user_id
        row.retired_by_user_id = None
        row.retirement_reason = ""
        row.retired_at = None
        if changed:
            row.revision = int(row.revision or 0) + 1
            row.activated_at = now
        row.updated_at = now
    session.add(row)
    session.flush()
    return row


def retire_project_memory_candidate_anchors(
    session: Session,
    *,
    project_id: int,
    slot_key: str,
    contents: Iterable[Any],
    actor_user_id: int | None,
    reason: str,
) -> int:
    keys = {
        memory_anchor_key("project", project_id, slot_key, content)
        for content in contents
        if normalize_memory_anchor_content(content)
    }
    if not keys:
        return 0
    rows = session.exec(
        select(MemoryCandidateAnchor)
        .where(
            MemoryCandidateAnchor.scope == "project",
            MemoryCandidateAnchor.project_id == project_id,
            MemoryCandidateAnchor.slot_key == slot_key,
            MemoryCandidateAnchor.anchor_key.in_(sorted(keys)),
        )
        .with_for_update()
    ).all()
    now = utc_now_naive()
    changed = 0
    for row in rows:
        if not memory_anchor_integrity_valid(row):
            raise ValueError("Memory candidate anchor integrity check failed")
        if row.status == "retired":
            continue
        row.status = "retired"
        row.revision = int(row.revision or 0) + 1
        row.retired_by_user_id = actor_user_id
        row.retirement_reason = str(reason or "manual")[:80]
        row.retired_at = now
        row.updated_at = now
        session.add(row)
        changed += 1
    session.flush()
    return changed


def reactivate_project_memory_candidate_anchors(
    session: Session,
    *,
    project_id: int,
    slot_key: str,
    contents: Iterable[Any],
    actor_user_id: int | None,
) -> int:
    keys = {
        memory_anchor_key("project", project_id, slot_key, content)
        for content in contents
        if normalize_memory_anchor_content(content)
    }
    if not keys:
        return 0
    rows = session.exec(
        select(MemoryCandidateAnchor)
        .where(
            MemoryCandidateAnchor.scope == "project",
            MemoryCandidateAnchor.project_id == project_id,
            MemoryCandidateAnchor.slot_key == slot_key,
            MemoryCandidateAnchor.anchor_key.in_(sorted(keys)),
        )
        .with_for_update()
    ).all()
    now = utc_now_naive()
    changed = 0
    for row in rows:
        if not memory_anchor_integrity_valid(row):
            raise ValueError("Memory candidate anchor integrity check failed")
        if row.status == "active":
            continue
        row.status = "active"
        row.revision = int(row.revision or 0) + 1
        row.activated_by_user_id = actor_user_id
        row.retired_by_user_id = None
        row.retirement_reason = ""
        row.activated_at = now
        row.retired_at = None
        row.updated_at = now
        session.add(row)
        changed += 1
    session.flush()
    return changed


def _legacy_metadata_shape(
    raw: str | None,
    allowed_slots: Collection[str],
) -> tuple[bool, int, int]:
    try:
        memory = json.loads(raw or "{}")
    except (json.JSONDecodeError, TypeError):
        return False, 0, 0
    if not isinstance(memory, dict) or LEGACY_ACCEPTED_MEMORY_CANDIDATES_KEY not in memory:
        return True, 0, 0
    anchors = memory.get(LEGACY_ACCEPTED_MEMORY_CANDIDATES_KEY)
    if not isinstance(anchors, dict):
        return False, 1, 0
    item_count = sum(len(value) for value in anchors.values() if isinstance(value, list))
    valid = all(
        str(slot_key) in allowed_slots
        and isinstance(value, list)
        and all(isinstance(item, str) for item in value)
        for slot_key, value in anchors.items()
    )
    return valid, 1, item_count


def build_memory_candidate_anchor_authority_report(
    session: Session,
    projects: Iterable[Project],
    clients: Iterable[ClientRecord],
) -> dict[str, Any]:
    """Return content-free native-anchor coverage and legacy-residue metrics."""

    anchors = session.exec(select(MemoryCandidateAnchor)).all()
    accepted = session.exec(
        select(MemoryCandidate).where(
            MemoryCandidate.status == "accepted",
            MemoryCandidate.scope.in_(("project", "client")),
        )
    ).all()
    valid_anchor_keys = {
        row.anchor_key for row in anchors if memory_anchor_integrity_valid(row)
    }
    expected_candidate_keys: set[str] = set()
    unsupported_accepted_candidate_count = 0
    for candidate in accepted:
        entity_id = int(candidate.project_id or candidate.client_id or 0)
        allowed_slots = (
            PROJECT_MEMORY_ANCHOR_SLOTS
            if candidate.scope == "project"
            else CLIENT_MEMORY_ANCHOR_SLOTS
        )
        slot_key = str(candidate.target_slot or "").strip()
        content = normalize_memory_anchor_content(candidate.content)
        if entity_id <= 0 or slot_key not in allowed_slots or not content:
            unsupported_accepted_candidate_count += 1
            continue
        expected_candidate_keys.add(
            memory_anchor_key(candidate.scope, entity_id, slot_key, content)
        )
    legacy_entities = 0
    legacy_items = 0
    malformed_legacy_entities = 0
    for entities, allowed_slots, attribute in (
        (projects, PROJECT_MEMORY_ANCHOR_SLOTS, "context_memory_json"),
        (clients, CLIENT_MEMORY_ANCHOR_SLOTS, "client_memory_json"),
    ):
        for entity in entities:
            valid, entity_count, item_count = _legacy_metadata_shape(
                getattr(entity, attribute, "{}"),
                allowed_slots,
            )
            legacy_entities += entity_count
            legacy_items += item_count
            malformed_legacy_entities += int(entity_count > 0 and not valid)
    invalid_anchor_count = sum(
        not memory_anchor_integrity_valid(anchor) for anchor in anchors
    )
    missing_candidate_anchor_count = len(expected_candidate_keys - valid_anchor_keys)
    return {
        "schema_version": 1,
        "content_included": False,
        "runtime_read_mode": "native_only",
        "legacy_runtime_fallback_enabled": False,
        "anchor_count": len(anchors),
        "active_anchor_count": sum(anchor.status == "active" for anchor in anchors),
        "retired_anchor_count": sum(anchor.status == "retired" for anchor in anchors),
        "invalid_anchor_count": invalid_anchor_count,
        "accepted_candidate_count": len(accepted),
        "supported_accepted_candidate_identity_count": len(expected_candidate_keys),
        "unsupported_accepted_candidate_count": (
            unsupported_accepted_candidate_count
        ),
        "missing_candidate_anchor_count": missing_candidate_anchor_count,
        "legacy_aggregate_entity_count": legacy_entities,
        "legacy_aggregate_item_count": legacy_items,
        "malformed_legacy_aggregate_entity_count": malformed_legacy_entities,
        "native_authority_ready": (
            invalid_anchor_count == 0
            and unsupported_accepted_candidate_count == 0
            and missing_candidate_anchor_count == 0
            and legacy_entities == 0
        ),
    }
