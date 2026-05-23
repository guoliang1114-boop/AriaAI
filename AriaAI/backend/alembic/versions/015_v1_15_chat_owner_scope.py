"""V1.15 - Chat conversation owner scope

Revision ID: 015_v1_15
Revises: 014_v1_14
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "015_v1_15"
down_revision = "014_v1_14"
branch_labels = None
depends_on = None


def _columns(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _indexes(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return
    if column.name not in _columns(inspector, table_name):
        op.add_column(table_name, column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return
    if index_name not in _indexes(inspector, table_name):
        op.create_index(index_name, table_name, columns)


def upgrade():
    _add_column_if_missing("conversation", sa.Column("owner_user_id", sa.Integer(), nullable=True))
    _create_index_if_missing("ix_conversation_owner_user_id", "conversation", ["owner_user_id"])


def downgrade():
    inspector = inspect(op.get_bind())
    if "conversation" not in inspector.get_table_names():
        return
    if "ix_conversation_owner_user_id" in _indexes(inspector, "conversation"):
        op.drop_index("ix_conversation_owner_user_id", table_name="conversation")
    if "owner_user_id" in _columns(inspector, "conversation"):
        op.drop_column("conversation", "owner_user_id")
