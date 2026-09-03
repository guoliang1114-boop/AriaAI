"""V1.47 - Normalize legacy empty memory slot placeholders.

Revision ID: 047_v1_47
Revises: 046_v1_46
Create Date: 2026-09-04
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "047_v1_47"
down_revision = "046_v1_46"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(column["name"])
        for column in inspect(op.get_bind()).get_columns(table_name)
    }


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def _sha256(value_json: str) -> str:
    return hashlib.sha256(value_json.encode("utf-8")).hexdigest()


def _parse_memory(raw: Any) -> dict[str, Any] | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def _normalize_missing_array_slot(
    *,
    owner_table_name: str,
    owner_memory_column: str,
    owner_version_column: str,
    slot_table_name: str,
    slot_owner_column: str,
    slot_key: str,
) -> None:
    required = {
        owner_table_name: {"id", owner_memory_column, owner_version_column},
        slot_table_name: {
            "id",
            slot_owner_column,
            "slot_key",
            "slot_version",
            "aggregate_memory_version",
            "value_json",
            "value_sha256",
            "updated_at",
        },
    }
    if not set(required).issubset(_tables()):
        return
    if any(not columns.issubset(_columns(table)) for table, columns in required.items()):
        return

    bind = op.get_bind()
    owner = sa.table(
        owner_table_name,
        sa.column("id", sa.Integer()),
        sa.column(owner_memory_column, sa.Text()),
        sa.column(owner_version_column, sa.Integer()),
    )
    slot = sa.table(
        slot_table_name,
        sa.column("id", sa.Integer()),
        sa.column(slot_owner_column, sa.Integer()),
        sa.column("slot_key", sa.String()),
        sa.column("slot_version", sa.Integer()),
        sa.column("aggregate_memory_version", sa.Integer()),
        sa.column("value_json", sa.Text()),
        sa.column("value_sha256", sa.String()),
        sa.column("updated_at", sa.DateTime()),
    )
    owner_id = owner.c.id
    slot_owner_id = getattr(slot.c, slot_owner_column)
    owner_memory = getattr(owner.c, owner_memory_column)
    owner_version = getattr(owner.c, owner_version_column)
    rows = bind.execute(
        sa.select(
            slot.c.id.label("slot_id"),
            slot.c.slot_version,
            slot.c.aggregate_memory_version,
            slot.c.value_json,
            slot.c.value_sha256,
            owner_id.label("owner_id"),
            owner_memory.label("owner_memory_json"),
            owner_version.label("owner_memory_version"),
        )
        .select_from(slot.join(owner, slot_owner_id == owner_id))
        .where(slot.c.slot_key == slot_key)
        .with_for_update()
    ).mappings().all()

    null_json = _canonical_json(None)
    null_sha256 = _sha256(null_json)
    empty_array_json = _canonical_json([])
    empty_array_sha256 = _sha256(empty_array_json)
    updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    for row in rows:
        # Only repair the exact placeholder emitted by migration 033. Invalid
        # digests, explicit aggregate nulls, content, and version conflicts are
        # deliberately left untouched for operator review.
        if str(row.get("value_json") or "") != null_json:
            continue
        if str(row.get("value_sha256") or "") != null_sha256:
            continue
        current_version = max(0, int(row.get("owner_memory_version") or 0))
        if max(0, int(row.get("aggregate_memory_version") or 0)) != current_version:
            continue
        memory = _parse_memory(row.get("owner_memory_json"))
        if memory is None or slot_key in memory:
            continue

        memory[slot_key] = []
        bind.execute(
            owner.update()
            .where(owner_id == int(row["owner_id"]))
            .values(
                {
                    owner_memory_column: json.dumps(
                        memory,
                        ensure_ascii=False,
                    )
                }
            )
        )
        bind.execute(
            slot.update()
            .where(slot.c.id == int(row["slot_id"]))
            .where(slot.c.slot_key == slot_key)
            .values(
                slot_version=max(0, int(row.get("slot_version") or 0)) + 1,
                aggregate_memory_version=current_version,
                value_json=empty_array_json,
                value_sha256=empty_array_sha256,
                updated_at=updated_at,
            )
        )


def upgrade() -> None:
    _normalize_missing_array_slot(
        owner_table_name="project",
        owner_memory_column="context_memory_json",
        owner_version_column="memory_version",
        slot_table_name="projectmemoryslot",
        slot_owner_column="project_id",
        slot_key="client_stakeholders",
    )
    _normalize_missing_array_slot(
        owner_table_name="clientrecord",
        owner_memory_column="client_memory_json",
        owner_version_column="client_memory_version",
        slot_table_name="clientmemoryslot",
        slot_owner_column="client_id",
        slot_key="relationship_signals",
    )


def downgrade() -> None:
    # Data normalization is intentionally irreversible: after upgrade there is
    # no safe way to distinguish a migrated empty array from a user-authored one.
    pass
