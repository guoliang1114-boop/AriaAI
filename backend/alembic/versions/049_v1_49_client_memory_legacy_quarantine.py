"""V1.49 - Quarantine a confirmed flattened client-memory legacy shape.

Revision ID: 049_v1_49
Revises: 048_v1_48
Create Date: 2026-09-04
"""
from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "049_v1_49"
down_revision = "048_v1_48"
branch_labels = None
depends_on = None

_KIND = "flattened_structured_stakeholder_v1"
_KEYS = (
    "name",
    "role",
    "note",
    "concerns",
    "influence_type",
    "relationship_status",
    "communication_preference",
)


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(column["name"])
        for column in inspect(op.get_bind()).get_columns(table_name)
    }


def _parse_object(raw: Any) -> dict[str, Any] | None:
    if raw is None or not str(raw).strip():
        return {}
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return None
    return dict(value) if isinstance(value, dict) else None


def _json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _quarantine_confirmed_shape() -> None:
    required = {
        "id",
        "client_memory_json",
        "client_memory_legacy_quarantine_json",
    }
    if "clientrecord" not in _tables() or not required.issubset(
        _columns("clientrecord")
    ):
        return

    table = sa.table(
        "clientrecord",
        sa.column("id", sa.Integer()),
        sa.column("client_memory_json", sa.Text()),
        sa.column("client_memory_legacy_quarantine_json", sa.Text()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("client_memory_json"))
        quarantine = _parse_object(row.get("client_memory_legacy_quarantine_json"))
        if memory is None or quarantine is None:
            continue
        if not all(key in memory and isinstance(memory[key], str) for key in _KEYS):
            continue

        if quarantine == {}:
            entries: list[Any] = []
            quarantine = {"schema_version": 1, "entries": entries}
        elif (
            quarantine.get("schema_version") == 1
            and isinstance(quarantine.get("entries"), list)
        ):
            entries = list(quarantine["entries"])
            quarantine = dict(quarantine)
            quarantine["entries"] = entries
        else:
            # Never remove active data when an existing quarantine cannot be
            # safely extended without changing or discarding its contents.
            continue

        payload = {key: memory[key] for key in _KEYS}
        entry = {"kind": _KIND, "payload": payload}
        if entry not in entries:
            entries.append(entry)
        active_memory = dict(memory)
        for key in _KEYS:
            active_memory.pop(key, None)
        bind.execute(
            table.update()
            .where(table.c.id == int(row["id"]))
            .values(
                client_memory_json=_json(active_memory),
                client_memory_legacy_quarantine_json=_json(quarantine),
            )
        )


def _restore_quarantine_for_downgrade() -> None:
    required = {
        "id",
        "client_memory_json",
        "client_memory_legacy_quarantine_json",
    }
    if "clientrecord" not in _tables() or not required.issubset(
        _columns("clientrecord")
    ):
        return
    table = sa.table(
        "clientrecord",
        sa.column("id", sa.Integer()),
        sa.column("client_memory_json", sa.Text()),
        sa.column("client_memory_legacy_quarantine_json", sa.Text()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("client_memory_json"))
        quarantine = _parse_object(row.get("client_memory_legacy_quarantine_json"))
        if memory is None or quarantine is None:
            continue
        entries = quarantine.get("entries")
        if quarantine.get("schema_version") != 1 or not isinstance(entries, list):
            continue
        restored = dict(memory)
        changed = False
        for entry in entries:
            if not isinstance(entry, dict) or entry.get("kind") != _KIND:
                continue
            payload = entry.get("payload")
            if not isinstance(payload, dict):
                continue
            if set(payload) != set(_KEYS) or not all(
                isinstance(payload.get(key), str) for key in _KEYS
            ):
                continue
            for key in _KEYS:
                if key not in restored:
                    restored[key] = payload[key]
                    changed = True
        if changed:
            bind.execute(
                table.update()
                .where(table.c.id == int(row["id"]))
                .values(client_memory_json=_json(restored))
            )


def upgrade() -> None:
    if "clientrecord" not in _tables():
        return
    if "client_memory_legacy_quarantine_json" not in _columns("clientrecord"):
        op.add_column(
            "clientrecord",
            sa.Column(
                "client_memory_legacy_quarantine_json",
                sa.Text(),
                nullable=False,
                server_default="{}",
            ),
        )
    _quarantine_confirmed_shape()


def downgrade() -> None:
    if "clientrecord" not in _tables():
        return
    if "client_memory_legacy_quarantine_json" in _columns("clientrecord"):
        _restore_quarantine_for_downgrade()
        # Batch mode recreates the table on older SQLite releases used by the
        # deploy contract tests, while PostgreSQL still emits a native ALTER.
        with op.batch_alter_table("clientrecord") as batch_op:
            batch_op.drop_column("client_memory_legacy_quarantine_json")
