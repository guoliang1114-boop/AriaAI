"""V1.51 - Retire legacy aggregate copies of native memory operation state.

Revision ID: 051_v1_51
Revises: 050_v1_50
Create Date: 2026-09-05
"""
from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "051_v1_51"
down_revision = "050_v1_50"
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


def _parse_object(raw: Any) -> dict[str, Any] | None:
    if raw is None or not str(raw).strip():
        return {}
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return None
    return dict(value) if isinstance(value, dict) else None
def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _retire_object_keys(
    *,
    table_name: str,
    memory_column: str,
    key_columns: tuple[tuple[str, str], ...],
) -> None:
    required = {"id", memory_column, *(column for _, column in key_columns)}
    if table_name not in _tables() or not required.issubset(_columns(table_name)):
        return
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer()),
        sa.column(memory_column, sa.Text()),
        *(sa.column(column, sa.Text()) for _, column in key_columns),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get(memory_column))
        if memory is None:
            continue
        values: dict[str, Any] = {}
        memory_changed = False
        for aggregate_key, native_column in key_columns:
            if aggregate_key not in memory:
                continue
            legacy = memory.get(aggregate_key)
            if not isinstance(legacy, dict):
                continue
            native = _parse_object(row.get(native_column))
            if native is None:
                continue
            if not str(row.get(native_column) or "").strip():
                values[native_column] = _json(legacy)
                native = legacy
            if native != legacy:
                continue
            memory.pop(aggregate_key, None)
            memory_changed = True
        if memory_changed:
            values[memory_column] = _json(memory)
        if values:
            bind.execute(
                table.update().where(table.c.id == int(row["id"])).values(**values)
            )


def _retire_client_generation() -> None:
    required = {
        "id",
        "client_memory_json",
        "client_memory_rebuild_generation",
    }
    if "clientrecord" not in _tables() or not required.issubset(
        _columns("clientrecord")
    ):
        return
    table = sa.table(
        "clientrecord",
        sa.column("id", sa.Integer()),
        sa.column("client_memory_json", sa.Text()),
        sa.column("client_memory_rebuild_generation", sa.String(length=64)),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("client_memory_json"))
        if memory is None or "_rebuild_generation" not in memory:
            continue
        raw_legacy = memory.get("_rebuild_generation")
        if not isinstance(raw_legacy, str):
            continue
        legacy = raw_legacy.strip()
        if len(legacy) > 64:
            continue
        native = str(row.get("client_memory_rebuild_generation") or "").strip()
        values: dict[str, Any] = {}
        if not native and legacy:
            values["client_memory_rebuild_generation"] = legacy
            native = legacy
        if native != legacy:
            continue
        memory.pop("_rebuild_generation", None)
        values["client_memory_json"] = _json(memory)
        bind.execute(
            table.update().where(table.c.id == int(row["id"])).values(**values)
        )


def _restore_object_keys(
    *,
    table_name: str,
    memory_column: str,
    key_columns: tuple[tuple[str, str], ...],
) -> None:
    required = {"id", memory_column, *(column for _, column in key_columns)}
    if table_name not in _tables() or not required.issubset(_columns(table_name)):
        return
    table = sa.table(
        table_name,
        sa.column("id", sa.Integer()),
        sa.column(memory_column, sa.Text()),
        *(sa.column(column, sa.Text()) for _, column in key_columns),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get(memory_column))
        if memory is None:
            continue
        restored = dict(memory)
        for aggregate_key, native_column in key_columns:
            if aggregate_key in restored:
                continue
            raw_native = row.get(native_column)
            if not str(raw_native or "").strip():
                continue
            native = _parse_object(raw_native)
            if native is not None:
                restored[aggregate_key] = native
        if restored != memory:
            bind.execute(
                table.update()
                .where(table.c.id == int(row["id"]))
                .values(**{memory_column: _json(restored)})
            )


def _restore_client_generation() -> None:
    required = {
        "id",
        "client_memory_json",
        "client_memory_rebuild_generation",
    }
    if "clientrecord" not in _tables() or not required.issubset(
        _columns("clientrecord")
    ):
        return
    table = sa.table(
        "clientrecord",
        sa.column("id", sa.Integer()),
        sa.column("client_memory_json", sa.Text()),
        sa.column("client_memory_rebuild_generation", sa.String(length=64)),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("client_memory_json"))
        generation = str(row.get("client_memory_rebuild_generation") or "").strip()
        if memory is None or not generation or "_rebuild_generation" in memory:
            continue
        restored = {**memory, "_rebuild_generation": generation}
        bind.execute(
            table.update()
            .where(table.c.id == int(row["id"]))
            .values(client_memory_json=_json(restored))
        )


def upgrade() -> None:
    _retire_object_keys(
        table_name="project",
        memory_column="context_memory_json",
        key_columns=(
            ("_last_failure", "memory_last_failure_json"),
            ("_client_promotion", "client_memory_promotion_json"),
        ),
    )
    _retire_object_keys(
        table_name="clientrecord",
        memory_column="client_memory_json",
        key_columns=(("_last_failure", "client_memory_last_failure_json"),),
    )
    _retire_client_generation()


def downgrade() -> None:
    _restore_object_keys(
        table_name="project",
        memory_column="context_memory_json",
        key_columns=(
            ("_last_failure", "memory_last_failure_json"),
            ("_client_promotion", "client_memory_promotion_json"),
        ),
    )
    _restore_object_keys(
        table_name="clientrecord",
        memory_column="client_memory_json",
        key_columns=(("_last_failure", "client_memory_last_failure_json"),),
    )
    _restore_client_generation()
