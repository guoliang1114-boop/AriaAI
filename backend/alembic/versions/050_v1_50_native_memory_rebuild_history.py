"""V1.50 - Move rebuild history and owner envelope out of aggregate memory.

Revision ID: 050_v1_50
Revises: 049_v1_49
Create Date: 2026-09-05
"""
from __future__ import annotations

from datetime import datetime
import json
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "050_v1_50"
down_revision = "049_v1_49"
branch_labels = None
depends_on = None

_ENVELOPE_KEYS = ("memory_version", "last_updated_at", "stale")


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


def _parse_list(raw: Any) -> list[Any] | None:
    if raw is None or not str(raw).strip():
        return []
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return None
    return list(value) if isinstance(value, list) else None


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _add_columns() -> None:
    if "project" in _tables() and "memory_rebuild_log_json" not in _columns(
        "project"
    ):
        op.add_column(
            "project",
            sa.Column(
                "memory_rebuild_log_json",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
        )
    if (
        "clientrecord" in _tables()
        and "client_memory_rebuild_log_json" not in _columns("clientrecord")
    ):
        op.add_column(
            "clientrecord",
            sa.Column(
                "client_memory_rebuild_log_json",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
        )


def _migrate_owner(
    *,
    table_name: str,
    memory_column: str,
    rebuild_log_column: str,
) -> None:
    required = {"id", memory_column, rebuild_log_column}
    if table_name not in _tables() or not required.issubset(_columns(table_name)):
        return
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer()),
        sa.column(memory_column, sa.Text()),
        sa.column(rebuild_log_column, sa.Text()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get(memory_column))
        native_log = _parse_list(row.get(rebuild_log_column))
        if memory is None or native_log is None:
            continue

        active_memory = dict(memory)
        changed = False
        values: dict[str, str] = {}
        legacy_log = active_memory.get("rebuild_log")
        if isinstance(legacy_log, list) and (
            not native_log or native_log == legacy_log
        ):
            if native_log != legacy_log:
                values[rebuild_log_column] = _json(legacy_log)
            active_memory.pop("rebuild_log", None)
            changed = True

        for key in _ENVELOPE_KEYS:
            if key in active_memory:
                active_memory.pop(key, None)
                changed = True
        if changed:
            values[memory_column] = _json(active_memory)
        if values:
            bind.execute(
                table.update()
                .where(table.c.id == int(row["id"]))
                .values(**values)
            )


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value or "")


def _restore_owner(
    *,
    table_name: str,
    memory_column: str,
    version_column: str,
    updated_at_column: str,
    stale_column: str,
    rebuild_log_column: str,
) -> None:
    required = {
        "id",
        memory_column,
        version_column,
        updated_at_column,
        stale_column,
        rebuild_log_column,
    }
    if table_name not in _tables() or not required.issubset(_columns(table_name)):
        return
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer()),
        sa.column(memory_column, sa.Text()),
        sa.column(version_column, sa.Integer()),
        sa.column(updated_at_column, sa.DateTime()),
        sa.column(stale_column, sa.Boolean()),
        sa.column(rebuild_log_column, sa.Text()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get(memory_column))
        native_log = _parse_list(row.get(rebuild_log_column))
        if memory is None or native_log is None:
            continue
        restored = dict(memory)
        restored.setdefault("memory_version", max(0, int(row[version_column] or 0)))
        restored.setdefault("last_updated_at", _iso(row[updated_at_column]))
        restored.setdefault("stale", bool(row[stale_column]))
        restored.setdefault("rebuild_log", native_log)
        if restored != memory:
            bind.execute(
                table.update()
                .where(table.c.id == int(row["id"]))
                .values(**{memory_column: _json(restored)})
            )


def upgrade() -> None:
    _add_columns()
    _migrate_owner(
        table_name="project",
        memory_column="context_memory_json",
        rebuild_log_column="memory_rebuild_log_json",
    )
    _migrate_owner(
        table_name="clientrecord",
        memory_column="client_memory_json",
        rebuild_log_column="client_memory_rebuild_log_json",
    )


def downgrade() -> None:
    if "clientrecord" in _tables():
        _restore_owner(
            table_name="clientrecord",
            memory_column="client_memory_json",
            version_column="client_memory_version",
            updated_at_column="client_memory_updated_at",
            stale_column="client_memory_stale",
            rebuild_log_column="client_memory_rebuild_log_json",
        )
        if "client_memory_rebuild_log_json" in _columns("clientrecord"):
            with op.batch_alter_table("clientrecord") as batch_op:
                batch_op.drop_column("client_memory_rebuild_log_json")
    if "project" in _tables():
        _restore_owner(
            table_name="project",
            memory_column="context_memory_json",
            version_column="memory_version",
            updated_at_column="memory_updated_at",
            stale_column="memory_stale",
            rebuild_log_column="memory_rebuild_log_json",
        )
        if "memory_rebuild_log_json" in _columns("project"):
            with op.batch_alter_table("project") as batch_op:
                batch_op.drop_column("memory_rebuild_log_json")
