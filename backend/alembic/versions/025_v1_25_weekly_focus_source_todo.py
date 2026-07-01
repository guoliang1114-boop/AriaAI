"""V1.25 - Weekly focus: link back to source todo

Adds ``weeklyfocusitem.source_todo_id`` so a weekly focus item can record the
project todo it was promoted from ("设为本周重点"). This keeps promotion
idempotent (one item per todo per week) and lets the todo list flag which
todos are already this week's focus.

Purely additive + idempotent (skips when the column already exists, e.g. on
dev databases created from ``SQLModel.metadata``). No DB-level FK constraint is
added here — the link is soft (a stale id from a deleted todo is harmless), and
ALTER-ADD-CONSTRAINT is awkward on SQLite; the ORM model still declares the FK.

Revision ID: 025_v1_25
Revises: 024_v1_24
Create Date: 2026-07-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "025_v1_25"
down_revision = "024_v1_24"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    inspector = inspect(op.get_bind())
    if "weeklyfocusitem" not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns("weeklyfocusitem")}


def upgrade():
    if "weeklyfocusitem" not in inspect(op.get_bind()).get_table_names():
        # Table not created yet — the base SQLModel.create_all path will
        # include the column when it eventually runs.
        return
    if "source_todo_id" not in _columns():
        op.add_column("weeklyfocusitem", sa.Column("source_todo_id", sa.Integer(), nullable=True))
        # Unique index → promotion is idempotent per (week, todo) at the DB layer.
        # NULL source_todo_id rows (normal items) are unconstrained (NULLs distinct).
        op.create_index(
            "uq_weeklyfocusitem_week_source",
            "weeklyfocusitem",
            ["week_start", "source_todo_id"],
            unique=True,
        )


def downgrade():
    if "source_todo_id" in _columns():
        op.drop_index("uq_weeklyfocusitem_week_source", table_name="weeklyfocusitem")
        op.drop_column("weeklyfocusitem", "source_todo_id")
