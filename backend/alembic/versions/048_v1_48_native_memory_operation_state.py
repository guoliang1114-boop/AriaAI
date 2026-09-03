"""V1.48 - Move memory workflow state into native owner columns.

Revision ID: 048_v1_48
Revises: 047_v1_47
Create Date: 2026-09-04
"""
from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "048_v1_48"
down_revision = "047_v1_47"
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


def _parse_object(raw: Any) -> dict[str, Any]:
    if raw is None or not str(raw).strip():
        return {}
    try:
        value = json.loads(str(raw))
    except (json.JSONDecodeError, TypeError):
        return {}
    return dict(value) if isinstance(value, dict) else {}


def _json_object(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False) if isinstance(value, dict) else ""


def _add_columns() -> None:
    if "project" in _tables():
        columns = _columns("project")
        if "memory_last_failure_json" not in columns:
            op.add_column(
                "project",
                sa.Column(
                    "memory_last_failure_json",
                    sa.Text(),
                    nullable=False,
                    server_default="",
                ),
            )
        if "client_memory_promotion_json" not in columns:
            op.add_column(
                "project",
                sa.Column(
                    "client_memory_promotion_json",
                    sa.Text(),
                    nullable=False,
                    server_default="",
                ),
            )

    if "clientrecord" in _tables():
        columns = _columns("clientrecord")
        if "client_memory_last_failure_json" not in columns:
            op.add_column(
                "clientrecord",
                sa.Column(
                    "client_memory_last_failure_json",
                    sa.Text(),
                    nullable=False,
                    server_default="",
                ),
            )
        if "client_memory_rebuild_generation" not in columns:
            op.add_column(
                "clientrecord",
                sa.Column(
                    "client_memory_rebuild_generation",
                    sa.String(length=64),
                    nullable=False,
                    server_default="",
                ),
            )


def _backfill_project_state() -> None:
    required = {
        "id",
        "context_memory_json",
        "memory_last_failure_json",
        "client_memory_promotion_json",
    }
    if "project" not in _tables() or not required.issubset(_columns("project")):
        return
    table = sa.table(
        "project",
        sa.column("id", sa.Integer()),
        sa.column("context_memory_json", sa.Text()),
        sa.column("memory_last_failure_json", sa.Text()),
        sa.column("client_memory_promotion_json", sa.Text()),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("context_memory_json"))
        values: dict[str, str] = {}
        if not str(row.get("memory_last_failure_json") or ""):
            failure = _json_object(memory.get("_last_failure"))
            if failure:
                values["memory_last_failure_json"] = failure
        if not str(row.get("client_memory_promotion_json") or ""):
            promotion = _json_object(memory.get("_client_promotion"))
            if promotion:
                values["client_memory_promotion_json"] = promotion
        if values:
            bind.execute(
                table.update().where(table.c.id == int(row["id"])).values(**values)
            )


def _backfill_client_state() -> None:
    required = {
        "id",
        "client_memory_json",
        "client_memory_last_failure_json",
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
        sa.column("client_memory_last_failure_json", sa.Text()),
        sa.column("client_memory_rebuild_generation", sa.String(length=64)),
    )
    bind = op.get_bind()
    rows = bind.execute(sa.select(table).with_for_update()).mappings().all()
    for row in rows:
        memory = _parse_object(row.get("client_memory_json"))
        values: dict[str, str] = {}
        if not str(row.get("client_memory_last_failure_json") or ""):
            failure = _json_object(memory.get("_last_failure"))
            if failure:
                values["client_memory_last_failure_json"] = failure
        if not str(row.get("client_memory_rebuild_generation") or ""):
            generation = memory.get("_rebuild_generation")
            if isinstance(generation, str) and generation.strip():
                values["client_memory_rebuild_generation"] = generation.strip()[:64]
        if values:
            bind.execute(
                table.update().where(table.c.id == int(row["id"])).values(**values)
            )


def upgrade() -> None:
    _add_columns()
    _backfill_project_state()
    _backfill_client_state()


def downgrade() -> None:
    if "clientrecord" in _tables():
        columns = _columns("clientrecord")
        if "client_memory_rebuild_generation" in columns:
            op.drop_column("clientrecord", "client_memory_rebuild_generation")
        if "client_memory_last_failure_json" in columns:
            op.drop_column("clientrecord", "client_memory_last_failure_json")
    if "project" in _tables():
        columns = _columns("project")
        if "client_memory_promotion_json" in columns:
            op.drop_column("project", "client_memory_promotion_json")
        if "memory_last_failure_json" in columns:
            op.drop_column("project", "memory_last_failure_json")
