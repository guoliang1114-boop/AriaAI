"""V1.33 - Durable project/client memory slot ledger.

Revision ID: 033_v1_33
Revises: 032_v1_32
Create Date: 2026-08-28
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "033_v1_33"
down_revision = "032_v1_32"
branch_labels = None
depends_on = None


PROJECT_SLOT_KEYS = (
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
CLIENT_SLOT_KEYS = (
    "client_profile",
    "decision_patterns",
    "key_contacts",
    "structured_stakeholders",
    "lessons_learned",
    "relationship_signals",
    "project_history",
    "sensitive_topics",
)


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {index["name"] for index in inspect(op.get_bind()).get_indexes(table_name)}


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


def _create_project_slot_table() -> None:
    op.create_table(
        "projectmemoryslot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("slot_key", sa.String(), nullable=False),
        sa.Column("slot_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("aggregate_memory_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("value_json", sa.Text(), nullable=False, server_default="null"),
        sa.Column("value_sha256", sa.String(), nullable=False, server_default=""),
        sa.Column("evidence_refs_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("evidence_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("stale_reason", sa.String(), nullable=False, server_default=""),
        sa.Column("stale_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "slot_key",
            name="uq_projectmemoryslot_project_slot",
        ),
    )
    for name, columns in (
        ("ix_projectmemoryslot_project_id", ["project_id"]),
        ("ix_projectmemoryslot_slot_key", ["slot_key"]),
        ("ix_projectmemoryslot_aggregate_memory_version", ["aggregate_memory_version"]),
        ("ix_projectmemoryslot_value_sha256", ["value_sha256"]),
        ("ix_projectmemoryslot_is_stale", ["is_stale"]),
        ("ix_projectmemoryslot_updated_at", ["updated_at"]),
    ):
        op.create_index(name, "projectmemoryslot", columns)


def _create_client_slot_table() -> None:
    op.create_table(
        "clientmemoryslot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("slot_key", sa.String(), nullable=False),
        sa.Column("slot_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("aggregate_memory_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("value_json", sa.Text(), nullable=False, server_default="null"),
        sa.Column("value_sha256", sa.String(), nullable=False, server_default=""),
        sa.Column("evidence_refs_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("evidence_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("stale_reason", sa.String(), nullable=False, server_default=""),
        sa.Column("stale_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clientrecord.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "client_id",
            "slot_key",
            name="uq_clientmemoryslot_client_slot",
        ),
    )
    for name, columns in (
        ("ix_clientmemoryslot_client_id", ["client_id"]),
        ("ix_clientmemoryslot_slot_key", ["slot_key"]),
        ("ix_clientmemoryslot_aggregate_memory_version", ["aggregate_memory_version"]),
        ("ix_clientmemoryslot_value_sha256", ["value_sha256"]),
        ("ix_clientmemoryslot_is_stale", ["is_stale"]),
        ("ix_clientmemoryslot_updated_at", ["updated_at"]),
    ):
        op.create_index(name, "clientmemoryslot", columns)


def _ensure_indexes(table_name: str, definitions: tuple[tuple[str, list[str]], ...]) -> None:
    existing = _indexes(table_name)
    for name, columns in definitions:
        if name not in existing:
            op.create_index(name, table_name, columns)


def _parse_memory(raw: Any) -> dict[str, Any]:
    try:
        value = json.loads(str(raw or "{}"))
    except json.JSONDecodeError:
        value = {}
    return value if isinstance(value, dict) else {}


def _legacy_ref(scope: str, entity_id: int, version: int) -> list[dict[str, str]]:
    return [
        {
            "source_type": "legacy_memory_aggregate",
            "source_id": str(entity_id),
            "source_label": f"Migrated {scope} memory v{version}; exact source unavailable",
            "captured_at": "",
        }
    ]


def _backfill_project_slots() -> None:
    if "project" not in _tables() or "projectmemoryslot" not in _tables():
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, memory_version, memory_stale, memory_updated_at, "
            "context_memory_json FROM project WHERE memory_version > 0"
        )
    ).mappings().all()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    slot_table = sa.table(
        "projectmemoryslot",
        sa.column("project_id", sa.Integer()),
        sa.column("slot_key", sa.String()),
        sa.column("slot_version", sa.Integer()),
        sa.column("aggregate_memory_version", sa.Integer()),
        sa.column("value_json", sa.Text()),
        sa.column("value_sha256", sa.String()),
        sa.column("evidence_refs_json", sa.Text()),
        sa.column("evidence_count", sa.Integer()),
        sa.column("is_stale", sa.Boolean()),
        sa.column("stale_reason", sa.String()),
        sa.column("stale_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    for row in rows:
        memory = _parse_memory(row.get("context_memory_json"))
        version = int(row.get("memory_version") or 0)
        refs = _legacy_ref("project", int(row["id"]), version)
        refs_json = _canonical_json(refs)
        updated_at = row.get("memory_updated_at") or now
        for slot_key in PROJECT_SLOT_KEYS:
            exists = bind.execute(
                sa.text(
                    "SELECT 1 FROM projectmemoryslot "
                    "WHERE project_id = :owner_id AND slot_key = :slot_key"
                ),
                {"owner_id": row["id"], "slot_key": slot_key},
            ).scalar()
            if exists:
                continue
            value_json = _canonical_json(memory.get(slot_key))
            bind.execute(
                slot_table.insert().values(
                    project_id=row["id"],
                    slot_key=slot_key,
                    slot_version=1,
                    aggregate_memory_version=version,
                    value_json=value_json,
                    value_sha256=_sha256(value_json),
                    evidence_refs_json=refs_json,
                    evidence_count=1,
                    is_stale=bool(row.get("memory_stale")),
                    stale_reason="migration_parent_stale" if row.get("memory_stale") else "",
                    stale_at=now if row.get("memory_stale") else None,
                    created_at=updated_at,
                    updated_at=updated_at,
                )
            )


def _backfill_client_slots() -> None:
    if "clientrecord" not in _tables() or "clientmemoryslot" not in _tables():
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, client_memory_version, client_memory_stale, "
            "client_memory_updated_at, client_memory_json FROM clientrecord "
            "WHERE client_memory_version > 0"
        )
    ).mappings().all()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    slot_table = sa.table(
        "clientmemoryslot",
        sa.column("client_id", sa.Integer()),
        sa.column("slot_key", sa.String()),
        sa.column("slot_version", sa.Integer()),
        sa.column("aggregate_memory_version", sa.Integer()),
        sa.column("value_json", sa.Text()),
        sa.column("value_sha256", sa.String()),
        sa.column("evidence_refs_json", sa.Text()),
        sa.column("evidence_count", sa.Integer()),
        sa.column("is_stale", sa.Boolean()),
        sa.column("stale_reason", sa.String()),
        sa.column("stale_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    for row in rows:
        memory = _parse_memory(row.get("client_memory_json"))
        version = int(row.get("client_memory_version") or 0)
        refs = _legacy_ref("client", int(row["id"]), version)
        refs_json = _canonical_json(refs)
        updated_at = row.get("client_memory_updated_at") or now
        for slot_key in CLIENT_SLOT_KEYS:
            exists = bind.execute(
                sa.text(
                    "SELECT 1 FROM clientmemoryslot "
                    "WHERE client_id = :owner_id AND slot_key = :slot_key"
                ),
                {"owner_id": row["id"], "slot_key": slot_key},
            ).scalar()
            if exists:
                continue
            value_json = _canonical_json(memory.get(slot_key))
            bind.execute(
                slot_table.insert().values(
                    client_id=row["id"],
                    slot_key=slot_key,
                    slot_version=1,
                    aggregate_memory_version=version,
                    value_json=value_json,
                    value_sha256=_sha256(value_json),
                    evidence_refs_json=refs_json,
                    evidence_count=1,
                    is_stale=bool(row.get("client_memory_stale")),
                    stale_reason="migration_parent_stale" if row.get("client_memory_stale") else "",
                    stale_at=now if row.get("client_memory_stale") else None,
                    created_at=updated_at,
                    updated_at=updated_at,
                )
            )


def upgrade() -> None:
    if "projectmemoryslot" not in _tables():
        _create_project_slot_table()
    if "clientmemoryslot" not in _tables():
        _create_client_slot_table()
    _ensure_indexes(
        "projectmemoryslot",
        (
            ("ix_projectmemoryslot_project_id", ["project_id"]),
            ("ix_projectmemoryslot_slot_key", ["slot_key"]),
            ("ix_projectmemoryslot_aggregate_memory_version", ["aggregate_memory_version"]),
            ("ix_projectmemoryslot_value_sha256", ["value_sha256"]),
            ("ix_projectmemoryslot_is_stale", ["is_stale"]),
            ("ix_projectmemoryslot_updated_at", ["updated_at"]),
        ),
    )
    _ensure_indexes(
        "clientmemoryslot",
        (
            ("ix_clientmemoryslot_client_id", ["client_id"]),
            ("ix_clientmemoryslot_slot_key", ["slot_key"]),
            ("ix_clientmemoryslot_aggregate_memory_version", ["aggregate_memory_version"]),
            ("ix_clientmemoryslot_value_sha256", ["value_sha256"]),
            ("ix_clientmemoryslot_is_stale", ["is_stale"]),
            ("ix_clientmemoryslot_updated_at", ["updated_at"]),
        ),
    )
    _backfill_project_slots()
    _backfill_client_slots()


def downgrade() -> None:
    if "clientmemoryslot" in _tables():
        op.drop_table("clientmemoryslot")
    if "projectmemoryslot" in _tables():
        op.drop_table("projectmemoryslot")
