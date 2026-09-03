from __future__ import annotations

import json

from app.models.db import ClientRecord
from app.services.memory_legacy_quarantine import (
    FLATTENED_STRUCTURED_STAKEHOLDER_KEYS,
    build_memory_legacy_quarantine_report,
)


def _entry(secret: str = "PRIVATE") -> dict[str, object]:
    return {
        "kind": "flattened_structured_stakeholder_v1",
        "payload": {
            key: f"{secret}-{index}"
            for index, key in enumerate(FLATTENED_STRUCTURED_STAKEHOLDER_KEYS)
        },
    }


def test_legacy_quarantine_report_is_content_free_and_integrity_aware() -> None:
    clients = [
        ClientRecord(name="Empty"),
        ClientRecord(
            name="Recognized",
            client_memory_legacy_quarantine_json=json.dumps(
                {"schema_version": 1, "entries": [_entry()]}
            ),
        ),
        ClientRecord(
            name="Unknown",
            client_memory_legacy_quarantine_json=json.dumps(
                {
                    "schema_version": 1,
                    "entries": [{"kind": "PRIVATE-KIND", "payload": {}}],
                }
            ),
        ),
        ClientRecord(
            name="Malformed entry",
            client_memory_legacy_quarantine_json=json.dumps(
                {"schema_version": 1, "entries": ["PRIVATE-ENTRY"]}
            ),
        ),
        ClientRecord(
            name="Malformed container",
            client_memory_legacy_quarantine_json="PRIVATE-NOT-JSON",
        ),
    ]

    report = build_memory_legacy_quarantine_report(clients)
    serialized = json.dumps(report, ensure_ascii=False)

    assert report == {
        "schema_version": 1,
        "content_included": False,
        "client_entity_count": 5,
        "quarantined_entity_count": 3,
        "quarantine_entry_count": 3,
        "recognized_entry_count": 1,
        "unknown_entry_count": 1,
        "malformed_entry_count": 1,
        "malformed_quarantine_count": 1,
        "quarantine_integrity_ready": False,
    }
    assert "PRIVATE" not in serialized
    assert "client_memory_legacy_quarantine_json" not in clients[1].model_dump()


def test_legacy_quarantine_report_accepts_empty_and_recognized_entries() -> None:
    report = build_memory_legacy_quarantine_report(
        [
            ClientRecord(name="Empty"),
            ClientRecord(
                name="Recognized",
                client_memory_legacy_quarantine_json=json.dumps(
                    {"schema_version": 1, "entries": [_entry("SECRET")]}
                ),
            ),
        ]
    )

    assert report["quarantine_integrity_ready"] is True
    assert report["recognized_entry_count"] == 1
    assert report["quarantined_entity_count"] == 1
    assert "SECRET" not in json.dumps(report)
