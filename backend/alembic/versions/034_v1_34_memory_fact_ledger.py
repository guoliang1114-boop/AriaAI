"""V1.34 - Fact-level project/client memory provenance ledger.

Content-addressed identities and reconstruction boundaries adapt OpenAI Codex
``codex-rs/core/src/context/world_state/mod.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0) into
Aria-native tables. No Codex runtime, SDK, protocol, or communication is used.

Revision ID: 034_v1_34
Revises: 033_v1_33
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


revision = "034_v1_34"
down_revision = "033_v1_33"
branch_labels = None
depends_on = None

PROJECT_EDITABLE_SLOT_KEYS = frozenset(
    {"key_risks", "open_questions", "stakeholder_notes"}
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


def _flatten(value: Any, slot_key: str, *, project_scope: bool) -> list[tuple[str, Any]]:
    values: list[tuple[str, Any]] = []
    if project_scope and slot_key in PROJECT_EDITABLE_SLOT_KEYS and isinstance(value, dict):
        for source_kind in ("pinned", "ai"):
            items = value.get(source_kind)
            if isinstance(items, list):
                values.extend((source_kind, item) for item in items)
    elif isinstance(value, list):
        values.extend(("item", item) for item in value)
    elif _has_value(value):
        values.append(("value", value))
    result: list[tuple[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for source_kind, item in values:
        if not _has_value(item):
            continue
        identity = (source_kind, _canonical_json(item))
        if identity in seen:
            continue
        seen.add(identity)
        result.append((source_kind, item))
    return result


def _parse_json(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except json.JSONDecodeError:
        return fallback


def _parse_datetime(value: Any, fallback: datetime | None = None) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return fallback
    else:
        return fallback
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _create_fact_table(*, table_name: str, owner_column: str, owner_table: str) -> None:
    unique_name = f"uq_{table_name}_{owner_column.removesuffix('_id')}_slot_fact"
    op.create_table(
        table_name,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column(owner_column, sa.Integer(), nullable=False),
        sa.Column("slot_key", sa.String(), nullable=False),
        sa.Column("fact_key", sa.String(), nullable=False),
        sa.Column("source_kind", sa.String(), nullable=False, server_default="item"),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("first_seen_memory_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_seen_memory_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("value_json", sa.Text(), nullable=False, server_default="null"),
        sa.Column("value_sha256", sa.String(), nullable=False, server_default=""),
        sa.Column("evidence_refs_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("evidence_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provenance_status", sa.String(), nullable=False, server_default="unresolved"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("stale_reason", sa.String(), nullable=False, server_default=""),
        sa.Column("stale_at", sa.DateTime(), nullable=True),
        sa.Column("retired_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint([owner_column], [f"{owner_table}.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            owner_column,
            "slot_key",
            "fact_key",
            name=unique_name,
        ),
    )


def _index_definitions(table_name: str, owner_column: str) -> tuple[tuple[str, list[str]], ...]:
    return tuple(
        (f"ix_{table_name}_{column}", [column])
        for column in (
            owner_column,
            "slot_key",
            "fact_key",
            "source_kind",
            "first_seen_memory_version",
            "last_seen_memory_version",
            "value_sha256",
            "provenance_status",
            "is_active",
            "is_stale",
            "updated_at",
        )
    )


def _ensure_indexes(table_name: str, owner_column: str) -> None:
    existing = _indexes(table_name)
    for name, columns in _index_definitions(table_name, owner_column):
        if name not in existing:
            op.create_index(name, table_name, columns)


def _backfill_facts(
    *,
    scope: str,
    slot_table_name: str,
    fact_table_name: str,
    owner_column: str,
) -> None:
    if slot_table_name not in _tables() or fact_table_name not in _tables():
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"SELECT {owner_column}, slot_key, aggregate_memory_version, value_json, "
            "evidence_refs_json, is_stale, stale_reason, stale_at, created_at, updated_at "
            f"FROM {slot_table_name}"
        )
    ).mappings().all()
    fact_table = sa.table(
        fact_table_name,
        sa.column(owner_column, sa.Integer()),
        sa.column("slot_key", sa.String()),
        sa.column("fact_key", sa.String()),
        sa.column("source_kind", sa.String()),
        sa.column("ordinal", sa.Integer()),
        sa.column("first_seen_memory_version", sa.Integer()),
        sa.column("last_seen_memory_version", sa.Integer()),
        sa.column("value_json", sa.Text()),
        sa.column("value_sha256", sa.String()),
        sa.column("evidence_refs_json", sa.Text()),
        sa.column("evidence_count", sa.Integer()),
        sa.column("provenance_status", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("is_stale", sa.Boolean()),
        sa.column("stale_reason", sa.String()),
        sa.column("stale_at", sa.DateTime()),
        sa.column("retired_at", sa.DateTime()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    for row in rows:
        value = _parse_json(row.get("value_json"), None)
        refs = _parse_json(row.get("evidence_refs_json"), [])
        refs = refs if isinstance(refs, list) else []
        if refs and all(
            isinstance(ref, dict)
            and str(ref.get("source_type") or "") == "legacy_memory_aggregate"
            for ref in refs
        ):
            provenance_status = "legacy"
            relation = "legacy_aggregate"
        elif refs:
            provenance_status = "scoped"
            relation = "slot_scope"
        else:
            provenance_status = "unresolved"
            relation = "slot_scope"
        normalized_refs = []
        for ref in refs[:6]:
            if not isinstance(ref, dict) or not str(ref.get("source_id") or ""):
                continue
            normalized_refs.append(
                {
                    "source_type": str(ref.get("source_type") or "unknown")[:48],
                    "source_id": str(ref.get("source_id") or "")[:80],
                    "source_label": " ".join(str(ref.get("source_label") or "").split())[:180],
                    "captured_at": str(ref.get("captured_at") or "")[:40],
                    "relation": relation,
                }
            )
        version = max(0, int(row.get("aggregate_memory_version") or 0))
        for ordinal, (source_kind, fact_value) in enumerate(
            _flatten(value, str(row["slot_key"]), project_scope=scope == "project")
        ):
            fact_key = _fact_key(scope, str(row["slot_key"]), source_kind, fact_value)
            exists = bind.execute(
                sa.text(
                    f"SELECT 1 FROM {fact_table_name} WHERE {owner_column} = :owner_id "
                    "AND slot_key = :slot_key AND fact_key = :fact_key"
                ),
                {
                    "owner_id": row[owner_column],
                    "slot_key": row["slot_key"],
                    "fact_key": fact_key,
                },
            ).scalar()
            if exists:
                continue
            value_json = _canonical_json(fact_value)
            bind.execute(
                fact_table.insert().values(
                    **{owner_column: row[owner_column]},
                    slot_key=row["slot_key"],
                    fact_key=fact_key,
                    source_kind=source_kind,
                    ordinal=ordinal,
                    first_seen_memory_version=version,
                    last_seen_memory_version=version,
                    value_json=value_json,
                    value_sha256=hashlib.sha256(value_json.encode("utf-8")).hexdigest(),
                    evidence_refs_json=_canonical_json(normalized_refs),
                    evidence_count=len(normalized_refs),
                    provenance_status=provenance_status,
                    is_active=True,
                    is_stale=bool(row.get("is_stale")),
                    stale_reason=str(row.get("stale_reason") or ""),
                    stale_at=_parse_datetime(row.get("stale_at")),
                    retired_at=None,
                    created_at=_parse_datetime(row.get("created_at"), now),
                    updated_at=_parse_datetime(row.get("updated_at"), now),
                )
            )


def upgrade() -> None:
    if "projectmemoryfact" not in _tables():
        _create_fact_table(
            table_name="projectmemoryfact",
            owner_column="project_id",
            owner_table="project",
        )
    if "clientmemoryfact" not in _tables():
        _create_fact_table(
            table_name="clientmemoryfact",
            owner_column="client_id",
            owner_table="clientrecord",
        )
    _ensure_indexes("projectmemoryfact", "project_id")
    _ensure_indexes("clientmemoryfact", "client_id")
    _backfill_facts(
        scope="project",
        slot_table_name="projectmemoryslot",
        fact_table_name="projectmemoryfact",
        owner_column="project_id",
    )
    _backfill_facts(
        scope="client",
        slot_table_name="clientmemoryslot",
        fact_table_name="clientmemoryfact",
        owner_column="client_id",
    )


def downgrade() -> None:
    if "clientmemoryfact" in _tables():
        op.drop_table("clientmemoryfact")
    if "projectmemoryfact" in _tables():
        op.drop_table("projectmemoryfact")
