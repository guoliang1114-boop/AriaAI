"""V1.16 - HITAS schema guard

Revision ID: 016_v1_16
Revises: 015_v1_15
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "016_v1_16"
down_revision = "015_v1_15"
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
    """Idempotently verify HITAS columns for databases with partial history."""
    _add_column_if_missing(
        "pendingtoolaction",
        sa.Column("risk_level", sa.String(), nullable=False, server_default="medium"),
    )
    _add_column_if_missing(
        "pendingtoolaction",
        sa.Column("policy_at_creation", sa.String(), nullable=False, server_default=""),
    )
    _add_column_if_missing(
        "pendingtoolaction",
        sa.Column("tool_input_hash", sa.String(), nullable=False, server_default=""),
    )
    _add_column_if_missing(
        "pendingtoolaction",
        sa.Column("approval_batch_id", sa.String(), nullable=False, server_default=""),
    )
    _add_column_if_missing(
        "pendingtoolaction",
        sa.Column("sequence_index", sa.Integer(), nullable=False, server_default="0"),
    )
    _create_index_if_missing("ix_pendingtoolaction_approval_batch_id", "pendingtoolaction", ["approval_batch_id"])

    _add_column_if_missing("conversation", sa.Column("owner_user_id", sa.Integer(), nullable=True))
    _create_index_if_missing("ix_conversation_owner_user_id", "conversation", ["owner_user_id"])


def downgrade():
    # This migration is a non-destructive schema guard. Earlier migrations own
    # the actual downgrade behavior for these columns.
    pass
