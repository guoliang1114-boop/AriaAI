"""V1.18 - User memory (V0.0.4 main track B)

Adds the ``usermemory`` table. One row per user, holding cross-project user
preferences as JSON. Schema is purely additive — no changes to existing tables.

Revision ID: 018_v1_18
Revises: 017_v1_17
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "018_v1_18"
down_revision = "017_v1_17"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if table_name not in _tables():
        return
    if index_name not in _indexes(table_name):
        op.create_index(index_name, table_name, columns)


def upgrade():
    tables = _tables()
    if "usermemory" not in tables:
        op.create_table(
            "usermemory",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("preferences_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["user.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", name="uq_usermemory_user_id"),
        )
    _create_index_if_missing("ix_usermemory_user_id", "usermemory", ["user_id"])


def downgrade():
    if "usermemory" in _tables():
        op.drop_table("usermemory")
