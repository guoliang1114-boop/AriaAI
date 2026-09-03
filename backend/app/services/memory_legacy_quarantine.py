"""Content-free diagnostics for legacy aggregate-memory quarantine storage."""
from __future__ import annotations

import json
from typing import Any, Iterable

from app.models.db import ClientRecord


FLATTENED_STRUCTURED_STAKEHOLDER_KIND = "flattened_structured_stakeholder_v1"
FLATTENED_STRUCTURED_STAKEHOLDER_KEYS = (
    "name",
    "role",
    "note",
    "concerns",
    "influence_type",
    "relationship_status",
    "communication_preference",
)


def _parse_quarantine(raw: Any) -> tuple[list[Any], bool]:
    if raw is None or not str(raw).strip():
        return [], False
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return [], True
    if value == {}:
        return [], False
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        return [], True
    entries = value.get("entries")
    if not isinstance(entries, list):
        return [], True
    return entries, False


def build_memory_legacy_quarantine_report(
    clients: Iterable[ClientRecord],
) -> dict[str, object]:
    """Summarize quarantine integrity without returning content or entity IDs."""

    client_count = 0
    quarantined_entity_count = 0
    entry_count = 0
    recognized_entry_count = 0
    unknown_entry_count = 0
    malformed_entry_count = 0
    malformed_quarantine_count = 0

    for client in clients:
        client_count += 1
        entries, malformed = _parse_quarantine(
            client.client_memory_legacy_quarantine_json
        )
        if malformed:
            malformed_quarantine_count += 1
            continue
        if entries:
            quarantined_entity_count += 1
        entry_count += len(entries)
        for entry in entries:
            if not isinstance(entry, dict):
                malformed_entry_count += 1
                continue
            if entry.get("kind") != FLATTENED_STRUCTURED_STAKEHOLDER_KIND:
                unknown_entry_count += 1
                continue
            payload = entry.get("payload")
            if not isinstance(payload, dict) or set(payload) != set(
                FLATTENED_STRUCTURED_STAKEHOLDER_KEYS
            ):
                malformed_entry_count += 1
                continue
            if not all(
                isinstance(payload.get(key), str)
                for key in FLATTENED_STRUCTURED_STAKEHOLDER_KEYS
            ):
                malformed_entry_count += 1
                continue
            recognized_entry_count += 1

    return {
        "schema_version": 1,
        "content_included": False,
        "client_entity_count": client_count,
        "quarantined_entity_count": quarantined_entity_count,
        "quarantine_entry_count": entry_count,
        "recognized_entry_count": recognized_entry_count,
        "unknown_entry_count": unknown_entry_count,
        "malformed_entry_count": malformed_entry_count,
        "malformed_quarantine_count": malformed_quarantine_count,
        "quarantine_integrity_ready": (
            malformed_quarantine_count == 0 and malformed_entry_count == 0
        ),
    }
