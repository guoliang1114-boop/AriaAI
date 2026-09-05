"""V1.52 - Move rebuild projection metadata out of aggregate memory.

Revision ID: 052_v1_52
Revises: 051_v1_51
Create Date: 2026-09-05
"""
from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "052_v1_52"
down_revision = "051_v1_51"
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


def _normalize_source_project_ids(value: Any) -> list[int] | None:
    if not isinstance(value, list):
        return None
    normalized: list[int] = []
    for item in value:
        if isinstance(item, bool) or not str(item).isdigit():
            return None
        project_id = int(item)
        if project_id <= 0:
            return None
        if project_id not in normalized:
            normalized.append(project_id)
    return normalized


def _parse_source_project_ids(raw: Any) -> list[int] | None:
    if raw is None or not str(raw).strip():
        return []
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return None
    return _normalize_source_project_ids(value)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _add_columns() -> None:
    if "project" in _tables() and "memory_coverage_json" not in _columns("project"):
        op.add_column(
            "project",
            sa.Column(
                "memory_coverage_json",
                sa.Text(),
                nullable=False,
                server_default="{}",
            ),
        )
    if (
        "clientrecord" in _tables()
        and "client_memory_source_project_ids_json" not in _columns("clientrecord")
    ):
        op.add_column(
            "clientrecord",
            sa.Column(
                "client_memory_source_project_ids_json",
                sa.Text(),
                nullable=False,
                server_default="[]",
            ),
        )


def _migrate_project_coverage() -> None:
    required = {"id", "context_memory_json", "memory_coverage_json"}
    if "project" not in _tables() or not required.issubset(_columns("project")):
        return
    table = sa.table(
        "project",
        sa.column("id", sa.Integer()),
        sa.column("context_memory_json", sa.Text()),
        sa.column("memory_coverage_json", sa.Text()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("context_memory_json"))
        native = _parse_object(row.get("memory_coverage_json"))
        if memory is None or native is None or "_coverage" not in memory:
            continue
        legacy = memory.get("_coverage")
        if not isinstance(legacy, dict):
            continue
        values: dict[str, str] = {}
        if not native:
            native = dict(legacy)
            values["memory_coverage_json"] = _json(native)
        if native != legacy:
            continue
        memory.pop("_coverage", None)
        values["context_memory_json"] = _json(memory)
        bind.execute(
            table.update().where(table.c.id == int(row["id"])).values(**values)
        )


def _migrate_client_source_project_ids() -> None:
    required = {
        "id",
        "client_memory_json",
        "client_memory_source_project_ids_json",
    }
    if "clientrecord" not in _tables() or not required.issubset(
        _columns("clientrecord")
    ):
        return
    table = sa.table(
        "clientrecord",
        sa.column("id", sa.Integer()),
        sa.column("client_memory_json", sa.Text()),
        sa.column("client_memory_source_project_ids_json", sa.Text()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("client_memory_json"))
        native = _parse_source_project_ids(
            row.get("client_memory_source_project_ids_json")
        )
        if memory is None or native is None or "source_project_ids" not in memory:
            continue
        legacy = _normalize_source_project_ids(memory.get("source_project_ids"))
        if legacy is None:
            continue
        values: dict[str, str] = {}
        if not native:
            native = legacy
            values["client_memory_source_project_ids_json"] = _json(native)
        if native != legacy:
            continue
        memory.pop("source_project_ids", None)
        values["client_memory_json"] = _json(memory)
        bind.execute(
            table.update().where(table.c.id == int(row["id"])).values(**values)
        )


def _restore_project_coverage() -> None:
    required = {"id", "context_memory_json", "memory_coverage_json"}
    if "project" not in _tables() or not required.issubset(_columns("project")):
        return
    table = sa.table(
        "project",
        sa.column("id", sa.Integer()),
        sa.column("context_memory_json", sa.Text()),
        sa.column("memory_coverage_json", sa.Text()),
    )
    bind = op.get_bind()
    for row in bind.execute(sa.select(table).with_for_update()).mappings().all():
        memory = _parse_object(row.get("context_memory_json"))
        native = _parse_object(row.get("memory_coverage_json"))
        if memory is None or native is None or "_coverage" in memory:
            continue
        memory["_coverage"] = native
        bind.execute(
            table.update()
            .where(table.c.id == int(row["id"]))
            .values(context_memory_json=_json(memory))
        )


def _restore_client_source_project_ids() -> None:
    required = {
        "id",
        "client_memory_json",
        "client_memory_source_project_ids_json",
    }
    if "clientrecord" not in _tables() or not required.issubset(
        _columns("clientrecord")
    ):
        return
    table = sa.table(
        "clientrecord",
        sa.column("id", sa.Integer()),
        sa.column("client_memory_json", sa.Text()),
        sa.column("client_memory_source_project_ids_json", sa.Text()),
    )
    bind = op.get_bind()
    for row in bind.execute(sa.select(table).with_for_update()).mappings().all():
        memory = _parse_object(row.get("client_memory_json"))
        native = _parse_source_project_ids(
            row.get("client_memory_source_project_ids_json")
        )
        if memory is None or native is None or "source_project_ids" in memory:
            continue
        memory["source_project_ids"] = native
        bind.execute(
            table.update()
            .where(table.c.id == int(row["id"]))
            .values(client_memory_json=_json(memory))
        )


def upgrade() -> None:
    _add_columns()
    _migrate_project_coverage()
    _migrate_client_source_project_ids()


def downgrade() -> None:
    if "clientrecord" in _tables():
        _restore_client_source_project_ids()
        if "client_memory_source_project_ids_json" in _columns("clientrecord"):
            with op.batch_alter_table("clientrecord") as batch_op:
                batch_op.drop_column("client_memory_source_project_ids_json")
    if "project" in _tables():
        _restore_project_coverage()
        if "memory_coverage_json" in _columns("project"):
            with op.batch_alter_table("project") as batch_op:
                batch_op.drop_column("memory_coverage_json")
