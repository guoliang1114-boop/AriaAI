"""V1.14 - HITAS approval batches

Revision ID: 014_v1_14
Revises: 013_v1_13
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "014_v1_14"
down_revision = "013_v1_13"
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
    _add_column_if_missing(
        "pendingtoolaction",
        sa.Column("approval_batch_id", sa.String(), nullable=False, server_default=""),
    )
    _add_column_if_missing(
        "pendingtoolaction",
        sa.Column("sequence_index", sa.Integer(), nullable=False, server_default="0"),
    )
    _create_index_if_missing("ix_pendingtoolaction_approval_batch_id", "pendingtoolaction", ["approval_batch_id"])


def downgrade():
    inspector = inspect(op.get_bind())
    if "pendingtoolaction" not in inspector.get_table_names():
        return
    indexes = _indexes(inspector, "pendingtoolaction")
    if "ix_pendingtoolaction_approval_batch_id" in indexes:
        op.drop_index("ix_pendingtoolaction_approval_batch_id", table_name="pendingtoolaction")
    columns = _columns(inspector, "pendingtoolaction")
    for column_name in ("sequence_index", "approval_batch_id"):
        if column_name in columns:
            op.drop_column("pendingtoolaction", column_name)
