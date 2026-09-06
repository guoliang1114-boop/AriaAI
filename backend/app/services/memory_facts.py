"""Fact-level memory identities, lifecycle, freshness, and provenance.

Aria keeps every fact and its business authorization in native project/client
services. Content-addressed fact identities and digest-verified reconstruction
adapt the stable world-state identity boundary from OpenAI Codex
``codex-rs/core/src/context/world_state/mod.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).
No Codex runtime, SDK, protocol, process, or communication is used.

Provenance is deliberately honest: ``direct`` means the rebuilding model
returned a stable source ID that Aria verified against both the prompt snapshot
and the slot's current source pool, ``matched`` means a source label can be
deterministically matched to the fact, ``scoped`` means only that the source
was read while rebuilding the containing slot, ``legacy`` identifies migrated
aggregate data, and
``unresolved`` means no source is currently available.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable, Mapping

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
from app.services.memory_projection_state import get_client_memory_source_project_ids


MAX_FACT_EVIDENCE_REFS = 6
MAX_FACT_PREVIEW_CHARS = 280
MAX_MODEL_SOURCE_ATTRIBUTIONS = 48
MAX_PROMPT_SOURCE_HANDLES = 96
MODEL_SOURCE_ATTRIBUTIONS_KEY = "_source_attributions"
FACT_PROVENANCE_STATUSES = frozenset(
    {"direct", "matched", "scoped", "legacy", "unresolved"}
)
_MATCH_TEXT_PATTERN = re.compile(r"[^0-9a-z\u3400-\u9fff]+")
_SOURCE_HANDLE_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,47}:[^\s:]{1,80}$")
_SOURCE_KIND_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


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
    result = {
        "source_type": str(value.get("source_type") or "unknown")[:48],
        "source_id": source_id,
        "source_label": " ".join(str(value.get("source_label") or "").split())[:180],
        "captured_at": str(value.get("captured_at") or "")[:40],
        "relation": relation,
    }
    source_sha256 = str(value.get("source_sha256") or "").strip().lower()
    if _SHA256_PATTERN.fullmatch(source_sha256):
        result["source_sha256"] = source_sha256
    return result


def _source_handle(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    source_type = str(value.get("source_type") or "").strip()
    source_id = str(value.get("source_id") or "").strip()
    return f"{source_type}:{source_id}" if source_type and source_id else ""


def _normalize_source_snapshots(value: Any) -> dict[str, str]:
    """Validate a bounded server-captured ``source handle -> state hash`` map."""

    if not isinstance(value, Mapping):
        return {}
    result: dict[str, str] = {}
    for raw_handle, raw_sha256 in value.items():
        handle = str(raw_handle).strip()
        source_sha256 = str(raw_sha256).strip().lower()
        if not _SOURCE_HANDLE_PATTERN.fullmatch(handle):
            continue
        if not _SHA256_PATTERN.fullmatch(source_sha256):
            continue
        result[handle] = source_sha256
        if len(result) >= MAX_PROMPT_SOURCE_HANDLES:
            break
    return result


def capture_memory_source_snapshots(
    evidence_by_slot: Mapping[str, Iterable[Any]],
    source_handles: Iterable[str] | None,
) -> dict[str, str]:
    """Capture the exact source states exposed to a model prompt.

    The returned map is private server data. A handle is omitted when it has no
    state hash in the evidence pool or resolves to conflicting state hashes.
    Save-time direct attribution must compare this snapshot with a freshly
    loaded source ref before accepting the model's source ID.
    """

    requested: list[str] = []
    for raw_handle in source_handles or ():
        handle = str(raw_handle).strip()
        if _SOURCE_HANDLE_PATTERN.fullmatch(handle) and handle not in requested:
            requested.append(handle)
        if len(requested) >= MAX_PROMPT_SOURCE_HANDLES:
            break
    if not requested:
        return {}

    requested_set = set(requested)
    captured: dict[str, str] = {}
    conflicts: set[str] = set()
    for refs in evidence_by_slot.values():
        for ref in refs if isinstance(refs, Iterable) else ():
            handle = _source_handle(ref)
            if handle not in requested_set or handle in conflicts:
                continue
            source_sha256 = str(
                ref.get("source_sha256") if isinstance(ref, dict) else ""
            ).strip().lower()
            if not _SHA256_PATTERN.fullmatch(source_sha256):
                continue
            previous = captured.get(handle)
            if previous is not None and previous != source_sha256:
                captured.pop(handle, None)
                conflicts.add(handle)
                continue
            captured[handle] = source_sha256
    return {handle: captured[handle] for handle in requested if handle in captured}


def capture_project_memory_source_snapshots(
    session: Session,
    project: Project,
    source_handles: Iterable[str] | None,
) -> dict[str, str]:
    """Capture prompt-visible project source states before provider execution."""

    return capture_memory_source_snapshots(
        build_project_slot_evidence_refs(session, project),
        source_handles,
    )


def capture_client_memory_source_snapshots(
    session: Session,
    client: ClientRecord,
    memory: dict[str, Any],
    source_handles: Iterable[str] | None,
) -> dict[str, str]:
    """Capture prompt-visible client source states before provider execution."""

    return capture_memory_source_snapshots(
        build_client_slot_evidence_refs(session, client, memory),
        source_handles,
    )


def normalize_model_source_attributions(
    value: Any,
    slot_keys: Iterable[str],
) -> list[dict[str, Any]]:
    """Bound the provider's optional fact-to-source ID declarations.

    Source existence and slot scope are intentionally *not* trusted here. They
    are verified against Aria's current evidence pool in ``_sync_fact_rows``.
    Older providers may omit this private key and continue through label/scope
    provenance unchanged.
    """

    allowed_slots = {str(slot) for slot in slot_keys}
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, int, str, str, tuple[str, ...]]] = set()
    for item in value[:MAX_MODEL_SOURCE_ATTRIBUTIONS]:
        if not isinstance(item, dict):
            continue
        slot_key = str(item.get("slot_key") or "").strip()
        fact_index = item.get("fact_index")
        if (
            slot_key not in allowed_slots
            or not isinstance(fact_index, int)
            or isinstance(fact_index, bool)
            or not 0 <= fact_index < 50
        ):
            continue
        raw_source_ids = item.get("source_ids")
        if not isinstance(raw_source_ids, list):
            continue
        source_ids = list(
            dict.fromkeys(
                str(source_id).strip()
                for source_id in raw_source_ids[:MAX_FACT_EVIDENCE_REFS]
                if _SOURCE_HANDLE_PATTERN.fullmatch(str(source_id).strip())
            )
        )
        if not source_ids:
            continue
        source_kind = str(item.get("source_kind") or "").strip().lower()
        fact_value_sha256 = str(
            item.get("fact_value_sha256") or ""
        ).strip().lower()
        if not (
            _SOURCE_KIND_PATTERN.fullmatch(source_kind)
            and _SHA256_PATTERN.fullmatch(fact_value_sha256)
        ):
            source_kind = ""
            fact_value_sha256 = ""
        identity = (
            slot_key,
            fact_index,
            source_kind,
            fact_value_sha256,
            tuple(source_ids),
        )
        if identity in seen:
            continue
        seen.add(identity)
        normalized_item: dict[str, Any] = {
            "slot_key": slot_key,
            "fact_index": fact_index,
            "source_ids": source_ids,
        }
        if source_kind and fact_value_sha256:
            normalized_item.update(
                {
                    "source_kind": source_kind,
                    "fact_value_sha256": fact_value_sha256,
                }
            )
        result.append(normalized_item)
    return result


def bind_model_source_attributions(
    value: Any,
    slot_keys: Iterable[str],
    fact_bindings: Mapping[str, Mapping[int, tuple[str, Any]]],
) -> list[dict[str, Any]]:
    """Bind raw provider indices to canonical, post-validation fact identities.

    ``fact_bindings`` has the shape
    ``{slot_key: {raw_index: (source_kind, canonical_value)}}``. Parsers build
    it while validating the provider's raw slot values. Attributions without a
    valid binding are dropped, so filtered empty items and candidate merges
    cannot shift an attribution onto a different saved fact.
    """

    normalized = normalize_model_source_attributions(value, slot_keys)
    result: list[dict[str, Any]] = []
    for attribution in normalized:
        slot_key = str(attribution["slot_key"])
        raw_index = int(attribution["fact_index"])
        slot_bindings = fact_bindings.get(slot_key)
        binding = (
            slot_bindings.get(raw_index)
            if isinstance(slot_bindings, Mapping)
            else None
        )
        if not isinstance(binding, (tuple, list)) or len(binding) != 2:
            continue
        source_kind = str(binding[0] or "").strip().lower()
        canonical_value = binding[1]
        if not _SOURCE_KIND_PATTERN.fullmatch(source_kind) or not _has_value(
            canonical_value
        ):
            continue
        result.append(
            {
                "slot_key": slot_key,
                "fact_index": raw_index,
                "source_ids": list(attribution["source_ids"]),
                "source_kind": source_kind,
                "fact_value_sha256": _value_sha256(canonical_value),
            }
        )
    return result


def _direct_evidence_by_fact(
    memory: dict[str, Any],
    *,
    slot_keys: tuple[str, ...],
    source_attributions: Any,
    source_snapshots: Mapping[str, str] | None,
    evidence_by_slot: dict[str, list[dict[str, str]]],
    project_scope: bool,
) -> dict[tuple[str, str], list[dict[str, str]]]:
    normalized = normalize_model_source_attributions(
        source_attributions,
        slot_keys,
    )
    result: dict[tuple[str, str], list[dict[str, str]]] = {}
    prompt_source_snapshots = _normalize_source_snapshots(source_snapshots)
    if not prompt_source_snapshots:
        return result

    current_refs_by_slot: dict[str, dict[str, dict[str, str]]] = {}
    for slot_key in slot_keys:
        allowed: dict[str, dict[str, str]] = {}
        for ref in evidence_by_slot.get(slot_key, []):
            handle = _source_handle(ref)
            current_sha256 = str(ref.get("source_sha256") or "").strip().lower()
            if (
                prompt_source_snapshots.get(handle) != current_sha256
                or not _SHA256_PATTERN.fullmatch(current_sha256)
            ):
                continue
            allowed[handle] = ref
        current_refs_by_slot[slot_key] = allowed

    bound_fact_keys: dict[tuple[str, str, str], str] = {}
    for slot_key in slot_keys:
        for fact in _flatten_slot_facts(
            memory,
            slot_key,
            project_scope=project_scope,
        ):
            source_kind = str(fact["source_kind"])
            fact_value = fact["value"]
            bound_fact_keys[(slot_key, source_kind, _value_sha256(fact_value))] = (
                _fact_key(
                    "project" if project_scope else "client",
                    slot_key,
                    source_kind,
                    fact_value,
                )
            )

    for attribution in normalized:
        slot_key = str(attribution["slot_key"])
        bound_source_kind = str(attribution.get("source_kind") or "")
        bound_value_sha256 = str(attribution.get("fact_value_sha256") or "")
        if not (bound_source_kind and bound_value_sha256):
            # Raw provider indices are intentionally insufficient for direct
            # provenance: parsers must bind them to the validated fact value.
            continue
        fact_key = bound_fact_keys.get(
            (slot_key, bound_source_kind, bound_value_sha256)
        )
        if fact_key is None:
            continue
        allowed_refs = current_refs_by_slot.get(slot_key, {})
        direct_refs = [
            sanitized
            for source_id in attribution["source_ids"]
            if (ref := allowed_refs.get(str(source_id))) is not None
            if (sanitized := _sanitize_ref(ref, "direct_source_id")) is not None
        ]
        if not direct_refs:
            continue
        identity = (slot_key, fact_key)
        existing = result.setdefault(identity, [])
        known = {
            (ref["source_type"], ref["source_id"])
            for ref in existing
        }
        for ref in direct_refs:
            ref_identity = (ref["source_type"], ref["source_id"])
            if ref_identity not in known and len(existing) < MAX_FACT_EVIDENCE_REFS:
                existing.append(ref)
                known.add(ref_identity)
    return result


def _preserved_direct_evidence(
    row: ProjectMemoryFact | ClientMemoryFact | None,
    allowed_refs: Iterable[Any],
) -> list[dict[str, str]]:
    """Keep a verified direct link when an unchanged fact is re-saved.

    This preserves direct provenance across user edits, rollback, and older
    providers that do not emit source attributions. Content changes create a
    different fact key and therefore cannot inherit the old relationship.
    """

    preserved = _preserved_existing_provenance(row, allowed_refs)
    if preserved is None or preserved[0] != "direct":
        return []
    return preserved[1]


_EXPECTED_RELATION_BY_PROVENANCE = {
    "direct": "direct_source_id",
    "matched": "label_match",
    "scoped": "slot_scope",
    "legacy": "legacy_aggregate",
}


def _preserved_existing_provenance(
    row: ProjectMemoryFact | ClientMemoryFact | None,
    allowed_refs: Iterable[Any],
) -> tuple[str, list[dict[str, str]]] | None:
    """Validate an existing fact's lineage against current source state.

    This is also the project-to-client promotion safety boundary: when enabled,
    an unchanged client fact keeps only its already-verified lineage and cannot
    be newly attributed to the promoted project.
    """

    if row is None:
        return None
    provenance_status = str(row.provenance_status or "unresolved")
    if provenance_status == "unresolved":
        return "unresolved", []
    expected_relation = _EXPECTED_RELATION_BY_PROVENANCE.get(provenance_status)
    if expected_relation is None:
        return "unresolved", []

    allowed: dict[str, dict[str, Any]] = {}
    for ref in allowed_refs:
        handle = _source_handle(ref)
        source_sha256 = str(
            ref.get("source_sha256") if isinstance(ref, dict) else ""
        ).strip().lower()
        if handle and _SHA256_PATTERN.fullmatch(source_sha256):
            allowed[handle] = ref

    preserved: list[dict[str, str]] = []
    for previous in _decode_evidence_refs(row.evidence_refs_json):
        if previous.get("relation") != expected_relation:
            continue
        previous_sha256 = str(previous.get("source_sha256") or "").lower()
        if not _SHA256_PATTERN.fullmatch(previous_sha256):
            continue
        current = allowed.get(_source_handle(previous))
        if current is None:
            continue
        current_sha256 = str(current.get("source_sha256") or "").lower()
        if current_sha256 != previous_sha256:
            continue
        sanitized = _sanitize_ref(current, expected_relation)
        if sanitized is not None:
            preserved.append(sanitized)
        if len(preserved) >= MAX_FACT_EVIDENCE_REFS:
            break
    if not preserved:
        return "unresolved", []
    return provenance_status, preserved


def _fact_evidence(
    value: Any,
    refs: Iterable[Any],
    direct_refs: Iterable[Any] = (),
) -> tuple[str, list[dict[str, str]]]:
    direct = [
        sanitized
        for ref in direct_refs
        if (sanitized := _sanitize_ref(ref, "direct_source_id")) is not None
    ][:MAX_FACT_EVIDENCE_REFS]
    if direct:
        return "direct", direct
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


def _prompt_snapshot_evidence_by_slot(
    evidence_by_slot: Mapping[str, Iterable[Any]],
    source_snapshots: Mapping[str, str] | None,
) -> dict[str, list[dict[str, str]]]:
    """Limit new fallback lineage to sources that the rebuilding model read.

    Save-time evidence is freshly loaded so direct and preserved provenance can
    reject changed sources.  That fresh pool can also contain sources created
    while the provider was running, however, and those sources must not become
    a new MATCHED/SCOPED link for output that never observed them. An omitted
    snapshot retains compatibility with non-provider edit paths;
    an explicit empty snapshot means the provider saw no eligible sources.
    """

    if source_snapshots is None:
        return {
            str(slot_key): [ref for ref in refs if isinstance(ref, dict)]
            for slot_key, refs in evidence_by_slot.items()
        }
    prompt_snapshots = _normalize_source_snapshots(source_snapshots)
    result: dict[str, list[dict[str, str]]] = {}
    for slot_key, refs in evidence_by_slot.items():
        visible: list[dict[str, str]] = []
        for ref in refs:
            if not isinstance(ref, dict):
                continue
            handle = _source_handle(ref)
            source_sha256 = str(ref.get("source_sha256") or "").strip().lower()
            if (
                _SHA256_PATTERN.fullmatch(source_sha256)
                and prompt_snapshots.get(handle) == source_sha256
            ):
                visible.append(ref)
        result[str(slot_key)] = visible
    return result


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
    source_attributions: Any = None,
    source_snapshots: Mapping[str, str] | None = None,
    protect_existing_fact_provenance: bool = False,
) -> None:
    owner_column = getattr(model, owner_field)
    rows = session.exec(select(model).where(owner_column == owner_id)).all()
    existing = {(row.slot_key, row.fact_key): row for row in rows}
    active_identities: set[tuple[str, str]] = set()
    now = utc_now_naive()
    direct_evidence = _direct_evidence_by_fact(
        memory,
        slot_keys=slot_keys,
        source_attributions=source_attributions,
        source_snapshots=source_snapshots,
        evidence_by_slot=evidence_by_slot,
        project_scope=scope == "project",
    )
    fallback_evidence_by_slot = _prompt_snapshot_evidence_by_slot(
        evidence_by_slot,
        source_snapshots,
    )

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
            row = existing.get(identity)
            protected_provenance = (
                _preserved_existing_provenance(
                    row,
                    evidence_by_slot.get(slot_key, []),
                )
                if protect_existing_fact_provenance and row is not None
                else None
            )
            if protected_provenance is not None:
                provenance_status, evidence_refs = protected_provenance
            else:
                verified_direct_refs = direct_evidence.get(
                    identity
                ) or _preserved_direct_evidence(
                    row,
                    evidence_by_slot.get(slot_key, []),
                )
                provenance_status, evidence_refs = _fact_evidence(
                    value,
                    fallback_evidence_by_slot.get(slot_key, []),
                    verified_direct_refs,
                )
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
        if (
            row.slot_key in slot_keys
            and row.is_active
            and identity not in active_identities
        ):
            row.is_active = False
            row.retired_at = now
            row.updated_at = now
            session.add(row)


def sync_project_memory_facts(
    session: Session,
    project: Project,
    memory: dict[str, Any],
    *,
    slot_keys: Iterable[str] | None = None,
    source_attributions: Any = None,
    source_snapshots: Mapping[str, str] | None = None,
) -> None:
    if project.id is None:
        return
    project_id = int(project.id)
    requested = set(slot_keys) if slot_keys is not None else None
    selected = tuple(
        slot_key
        for slot_key in PROJECT_MEMORY_SLOT_KEYS
        if requested is None or slot_key in requested
    )
    # Re-read source rows after the provider call. The session may still hold
    # pre-prompt ORM identities, which must not satisfy a save-time hash check.
    session.flush()
    session.expire_all()
    current_project = session.get(Project, project_id)
    if current_project is None:
        return
    _sync_fact_rows(
        session,
        scope="project",
        owner_id=project_id,
        owner_field="project_id",
        model=ProjectMemoryFact,
        slot_keys=selected,
        memory_version=max(0, int(current_project.memory_version or 0)),
        memory=memory,
        evidence_by_slot=build_project_slot_evidence_refs(session, current_project),
        source_attributions=source_attributions,
        source_snapshots=source_snapshots,
    )


def sync_client_memory_facts(
    session: Session,
    client: ClientRecord,
    memory: dict[str, Any],
    *,
    slot_keys: Iterable[str] | None = None,
    source_attributions: Any = None,
    source_snapshots: Mapping[str, str] | None = None,
    protect_existing_fact_provenance: bool = False,
) -> None:
    if client.id is None:
        return
    client_id = int(client.id)
    requested = set(slot_keys) if slot_keys is not None else None
    selected = tuple(
        slot_key
        for slot_key in CLIENT_MEMORY_SLOT_KEYS
        if requested is None or slot_key in requested
    )
    session.flush()
    session.expire_all()
    current_client = session.get(ClientRecord, client_id)
    if current_client is None:
        return
    _sync_fact_rows(
        session,
        scope="client",
        owner_id=client_id,
        owner_field="client_id",
        model=ClientMemoryFact,
        slot_keys=selected,
        memory_version=max(0, int(current_client.client_memory_version or 0)),
        memory=memory,
        evidence_by_slot=build_client_slot_evidence_refs(
            session,
            current_client,
            memory,
        ),
        source_attributions=source_attributions,
        source_snapshots=source_snapshots,
        protect_existing_fact_provenance=protect_existing_fact_provenance,
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
        .execution_options(populate_existing=True)
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


def _fact_source_drifted(
    stored_refs: Iterable[dict[str, str]],
    current_refs: Iterable[dict[str, str]],
) -> bool:
    current_hashes = {
        _source_handle(ref): str(ref.get("source_sha256") or "").strip().lower()
        for ref in current_refs
        if isinstance(ref, dict) and _source_handle(ref)
    }
    for ref in stored_refs:
        if str(ref.get("source_type") or "").startswith("legacy_"):
            continue
        source_sha256 = str(ref.get("source_sha256") or "").strip().lower()
        if not _SHA256_PATTERN.fullmatch(source_sha256):
            continue
        if current_hashes.get(_source_handle(ref)) != source_sha256:
            return True
    return False


def _fact_state(
    row: ProjectMemoryFact | ClientMemoryFact,
    current_refs: Iterable[dict[str, str]] = (),
) -> dict[str, Any]:
    integrity_ok, value = _decode_fact_value(row)
    stored_evidence_refs = _decode_evidence_refs(row.evidence_refs_json)
    # State hashes are an internal trust primitive, not part of the public
    # memory receipt. Keeping them private also avoids exposing fingerprints of
    # low-entropy business source fields.
    source_drifted = bool(
        row.is_active
        and integrity_ok
        and not row.is_stale
        and _fact_source_drifted(stored_evidence_refs, current_refs)
    )
    if not row.is_active:
        status = "retired"
    elif not integrity_ok:
        status = "corrupt"
    elif row.is_stale or source_drifted:
        status = "stale"
    else:
        status = "ready"
    provenance_status = str(row.provenance_status or "unresolved")
    if provenance_status not in FACT_PROVENANCE_STATUSES:
        provenance_status = "unresolved"
    if status != "ready":
        provenance_status = "unresolved"
        public_stored_refs: list[dict[str, str]] = []
    else:
        public_stored_refs = stored_evidence_refs
    evidence_refs = [
        {key: ref_value for key, ref_value in ref.items() if key != "source_sha256"}
        for ref in public_stored_refs
    ]
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
        "evidence_count": len(public_stored_refs),
        "evidence_refs": evidence_refs,
        "stale_reason": (
            str(row.stale_reason or "")
            if row.is_stale
            else "source_changed"
            if source_drifted
            else ""
        ),
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
    project = session.get(Project, project_id)
    evidence_by_slot = (
        build_project_slot_evidence_refs(session, project)
        if project is not None
        else {}
    )
    return [
        _fact_state(row, evidence_by_slot.get(row.slot_key, []))
        for row in rows
    ]


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
    client = session.get(ClientRecord, client_id)
    memory: dict[str, Any] = {}
    if client is not None:
        memory["source_project_ids"] = get_client_memory_source_project_ids(client)
    evidence_by_slot = (
        build_client_slot_evidence_refs(session, client, memory)
        if client is not None
        else {}
    )
    return [
        _fact_state(row, evidence_by_slot.get(row.slot_key, []))
        for row in rows
    ]


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


def find_memory_fact_state(
    slot_fact_states: Mapping[int, dict[str, Any]] | None,
    source_kind: str,
    value: Any,
    *,
    fallback_ordinal: int | None = None,
) -> dict[str, Any]:
    """Resolve a rendered value to its content-addressed fact state.

    Fact ordinals are storage/display hints, not identities: invalid values and
    duplicate values can be filtered at different points and compress ordinal
    positions.  Production states therefore match on the same ``source_kind``
    plus canonical value digest used by fact persistence.  The ordinal fallback
    exists only for older callers and focused tests that provide synthetic fact
    states without a value digest; it is never used to override an identity-aware
    state.
    """

    if not isinstance(slot_fact_states, Mapping):
        return {}
    expected_source_kind = str(source_kind or "").strip().lower()
    expected_value_sha256 = _value_sha256(value)
    for candidate in slot_fact_states.values():
        if not isinstance(candidate, dict):
            continue
        if (
            str(candidate.get("source_kind") or "").strip().lower()
            == expected_source_kind
            and str(candidate.get("value_sha256") or "").strip().lower()
            == expected_value_sha256
        ):
            return candidate

    if fallback_ordinal is None:
        return {}
    candidate = slot_fact_states.get(max(0, int(fallback_ordinal)))
    if not isinstance(candidate, dict):
        return {}
    if str(candidate.get("value_sha256") or "").strip():
        return {}
    return candidate
