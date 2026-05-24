"""V1.13 - HITAS governance fields

Revision ID: 013_v1_13
Revises: 012_v1_12
Create Date: 2026-05-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "013_v1_13"
down_revision = "012_v1_12"
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
        "projectmember",
        sa.Column("role", sa.String(), nullable=False, server_default="editor"),
    )
    _create_index_if_missing("ix_projectmember_role", "projectmember", ["role"])

    _add_column_if_missing("projectfile", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    _add_column_if_missing("projectfile", sa.Column("deleted_by_user_id", sa.Integer(), nullable=True))
    _add_column_if_missing("projectfile", sa.Column("delete_reason", sa.String(), nullable=False, server_default=""))
    _add_column_if_missing("projectfile", sa.Column("delete_batch_id", sa.String(), nullable=False, server_default=""))
    _create_index_if_missing("ix_projectfile_deleted_at", "projectfile", ["deleted_at"])
    _create_index_if_missing("ix_projectfile_deleted_by_user_id", "projectfile", ["deleted_by_user_id"])

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


def downgrade():
    inspector = inspect(op.get_bind())
    if "pendingtoolaction" in inspector.get_table_names():
        columns = _columns(inspector, "pendingtoolaction")
        for column_name in ("tool_input_hash", "policy_at_creation", "risk_level"):
            if column_name in columns:
                op.drop_column("pendingtoolaction", column_name)

    inspector = inspect(op.get_bind())
    if "projectfile" in inspector.get_table_names():
        indexes = _indexes(inspector, "projectfile")
        if "ix_projectfile_deleted_by_user_id" in indexes:
            op.drop_index("ix_projectfile_deleted_by_user_id", table_name="projectfile")
        if "ix_projectfile_deleted_at" in indexes:
            op.drop_index("ix_projectfile_deleted_at", table_name="projectfile")
        columns = _columns(inspector, "projectfile")
        for column_name in ("delete_batch_id", "delete_reason", "deleted_by_user_id", "deleted_at"):
            if column_name in columns:
                op.drop_column("projectfile", column_name)

    inspector = inspect(op.get_bind())
    if "projectmember" in inspector.get_table_names():
        indexes = _indexes(inspector, "projectmember")
        if "ix_projectmember_role" in indexes:
            op.drop_index("ix_projectmember_role", table_name="projectmember")
        if "role" in _columns(inspector, "projectmember"):
            op.drop_column("projectmember", "role")
