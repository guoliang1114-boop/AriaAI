"""V1.53 - Retire aggregate memory business-slot copies.

Revision ID: 053_v1_53
Revises: 052_v1_52
Create Date: 2026-09-06
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Iterable

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "053_v1_53"
down_revision = "052_v1_52"
branch_labels = None
depends_on = None


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


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _parse_object(raw: Any) -> dict[str, Any] | None:
    if raw is None or not str(raw).strip():
        return {}
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return None
    return dict(value) if isinstance(value, dict) else None


def _valid_slot_values(
    *,
    slot_table_name: str,
    slot_owner_column: str,
    slot_keys: Iterable[str],
) -> dict[int, dict[str, Any]]:
    required = {
        "id",
        slot_owner_column,
        "slot_key",
        "value_json",
        "value_sha256",
    }
    if slot_table_name not in _tables() or not required.issubset(
        _columns(slot_table_name)
    ):
        return {}
    slot = sa.table(
        slot_table_name,
        sa.column("id", sa.Integer()),
        sa.column(slot_owner_column, sa.Integer()),
        sa.column("slot_key", sa.String()),
        sa.column("value_json", sa.Text()),
        sa.column("value_sha256", sa.String()),
    )
    owner_id = getattr(slot.c, slot_owner_column)
    selected = tuple(dict.fromkeys(str(key) for key in slot_keys if str(key)))
    rows = op.get_bind().execute(
        sa.select(slot)
        .where(slot.c.slot_key.in_(selected))
        .order_by(owner_id, slot.c.slot_key, slot.c.id)
        .with_for_update()
    ).mappings().all()
    values: dict[int, dict[str, Any]] = {}
    seen: set[tuple[int, str]] = set()
    duplicates: set[tuple[int, str]] = set()
    for row in rows:
        identity = (int(row[slot_owner_column]), str(row["slot_key"]))
        if identity in seen:
            duplicates.add(identity)
            continue
        seen.add(identity)
        try:
            value = json.loads(str(row.get("value_json") or "null"))
        except (json.JSONDecodeError, TypeError):
            continue
        if _sha256_json(value) != str(row.get("value_sha256") or ""):
            continue
        values.setdefault(identity[0], {})[identity[1]] = value
    for owner_id_value, slot_key in duplicates:
        values.get(owner_id_value, {}).pop(slot_key, None)
    return values


def _retire_matching_business_slots(
    *,
    owner_table_name: str,
    owner_memory_column: str,
    slot_table_name: str,
    slot_owner_column: str,
    slot_keys: Iterable[str],
    editable_slot_keys: Iterable[str] = (),
) -> None:
    required = {"id", owner_memory_column}
    if owner_table_name not in _tables() or not required.issubset(
        _columns(owner_table_name)
    ):
        return
    owner = sa.table(
        owner_table_name,
        sa.column("id", sa.Integer()),
        sa.column(owner_memory_column, sa.Text()),
    )
    memory_column = getattr(owner.c, owner_memory_column)
    valid_values = _valid_slot_values(
        slot_table_name=slot_table_name,
        slot_owner_column=slot_owner_column,
        slot_keys=slot_keys,
    )
    editable = {str(key) for key in editable_slot_keys if str(key)}
    bind = op.get_bind()
    for row in bind.execute(sa.select(owner).with_for_update()).mappings().all():
        memory = _parse_object(row.get(owner_memory_column))
        if memory is None:
            continue
        changed = False
        for slot_key, value in valid_values.get(int(row["id"]), {}).items():
            aggregate_keys = [slot_key]
            if slot_key in editable:
                aggregate_keys.append(f"{slot_key}_detail")
            for aggregate_key in aggregate_keys:
                if aggregate_key not in memory:
                    continue
                if _sha256_json(memory.get(aggregate_key)) != _sha256_json(value):
                    continue
                memory.pop(aggregate_key, None)
                changed = True
        if changed:
            bind.execute(
                owner.update()
                .where(owner.c.id == int(row["id"]))
                .values({owner_memory_column: json.dumps(memory, ensure_ascii=False)})
            )


def _restore_business_slots(
    *,
    owner_table_name: str,
    owner_memory_column: str,
    slot_table_name: str,
    slot_owner_column: str,
    slot_keys: Iterable[str],
) -> None:
    required = {"id", owner_memory_column}
    if owner_table_name not in _tables() or not required.issubset(
        _columns(owner_table_name)
    ):
        return
    owner = sa.table(
        owner_table_name,
        sa.column("id", sa.Integer()),
        sa.column(owner_memory_column, sa.Text()),
    )
    valid_values = _valid_slot_values(
        slot_table_name=slot_table_name,
        slot_owner_column=slot_owner_column,
        slot_keys=slot_keys,
    )
    bind = op.get_bind()
    for row in bind.execute(sa.select(owner).with_for_update()).mappings().all():
        memory = _parse_object(row.get(owner_memory_column))
        if memory is None:
            continue
        changed = False
        for slot_key, value in valid_values.get(int(row["id"]), {}).items():
            if slot_key in memory:
                continue
            memory[slot_key] = value
            changed = True
        if changed:
            bind.execute(
                owner.update()
                .where(owner.c.id == int(row["id"]))
                .values({owner_memory_column: json.dumps(memory, ensure_ascii=False)})
            )


def upgrade() -> None:
    _retire_matching_business_slots(
        owner_table_name="project",
        owner_memory_column="context_memory_json",
        slot_table_name="projectmemoryslot",
        slot_owner_column="project_id",
        slot_keys=PROJECT_MEMORY_SLOT_KEYS,
        editable_slot_keys=PROJECT_EDITABLE_SLOT_KEYS,
    )
    _retire_matching_business_slots(
        owner_table_name="clientrecord",
        owner_memory_column="client_memory_json",
        slot_table_name="clientmemoryslot",
        slot_owner_column="client_id",
        slot_keys=CLIENT_MEMORY_SLOT_KEYS,
    )


def downgrade() -> None:
    _restore_business_slots(
        owner_table_name="clientrecord",
        owner_memory_column="client_memory_json",
        slot_table_name="clientmemoryslot",
        slot_owner_column="client_id",
        slot_keys=CLIENT_MEMORY_SLOT_KEYS,
    )
    _restore_business_slots(
        owner_table_name="project",
        owner_memory_column="context_memory_json",
        slot_table_name="projectmemoryslot",
        slot_owner_column="project_id",
        slot_keys=PROJECT_MEMORY_SLOT_KEYS,
    )
