"""V1.45 - Bind generated files to immutable Skill deliverable contracts.

Revision ID: 045_v1_45
Revises: 044_v1_44
Create Date: 2026-09-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "045_v1_45"
down_revision = "044_v1_44"
branch_labels = None
depends_on = None


TABLE = "generatedfile"
COLUMNS = {
    "project_file_id": sa.Column("project_file_id", sa.Integer(), nullable=True),
    "deliverable_id": sa.Column(
        "deliverable_id", sa.String(), nullable=False, server_default=""
    ),
    "deliverable_name": sa.Column(
        "deliverable_name", sa.String(), nullable=False, server_default=""
    ),
    "deliverable_contract_sha256": sa.Column(
        "deliverable_contract_sha256", sa.String(), nullable=False, server_default=""
    ),
    "deliverable_catalog_sha256": sa.Column(
        "deliverable_catalog_sha256", sa.String(), nullable=False, server_default=""
    ),
    "deliverable_skill_release_sha256": sa.Column(
        "deliverable_skill_release_sha256",
        sa.String(),
        nullable=False,
        server_default="",
    ),
    "saved_to_project_by_user_id": sa.Column(
        "saved_to_project_by_user_id", sa.Integer(), nullable=True
    ),
    "saved_to_project_at": sa.Column(
        "saved_to_project_at", sa.DateTime(), nullable=True
    ),
}
INDEXES = {
    "ix_generatedfile_project_file_id": ["project_file_id"],
    "ix_generatedfile_deliverable_id": ["deliverable_id"],
    "ix_generatedfile_deliverable_contract_sha256": [
        "deliverable_contract_sha256"
    ],
    "ix_generatedfile_deliverable_catalog_sha256": [
        "deliverable_catalog_sha256"
    ],
    "ix_generatedfile_deliverable_skill_release_sha256": [
        "deliverable_skill_release_sha256"
    ],
    "ix_generatedfile_saved_to_project_by_user_id": [
        "saved_to_project_by_user_id"
    ],
    "ix_generatedfile_saved_to_project_at": ["saved_to_project_at"],
}
FOREIGN_KEYS = {
    "fk_generatedfile_project_file_id_projectfile": (
        ["project_file_id"],
        "projectfile",
        ["id"],
        "SET NULL",
    ),
    "fk_generatedfile_saved_to_project_by_user_id_user": (
        ["saved_to_project_by_user_id"],
        "user",
        ["id"],
        "SET NULL",
    ),
}


def _columns() -> set[str]:
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_columns(TABLE)
    }


def _indexes() -> set[str]:
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(TABLE)
    }


def _foreign_keys() -> set[str]:
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_foreign_keys(TABLE)
        if item.get("name")
    }


def upgrade() -> None:
    existing_columns = _columns()
    for name, column in COLUMNS.items():
        if name not in existing_columns:
            op.add_column(TABLE, column)

    existing_indexes = _indexes()
    for name, columns in INDEXES.items():
        if name not in existing_indexes:
            op.create_index(name, TABLE, columns, unique=False)

    if op.get_bind().dialect.name != "sqlite":
        existing_foreign_keys = _foreign_keys()
        for name, (
            local_columns,
            remote_table,
            remote_columns,
            ondelete,
        ) in FOREIGN_KEYS.items():
            if name not in existing_foreign_keys:
                op.create_foreign_key(
                    name,
                    TABLE,
                    remote_table,
                    local_columns,
                    remote_columns,
                    ondelete=ondelete,
                )


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        existing_foreign_keys = _foreign_keys()
        for name in reversed(tuple(FOREIGN_KEYS)):
            if name in existing_foreign_keys:
                op.drop_constraint(name, TABLE, type_="foreignkey")

    existing_indexes = _indexes()
    for name in reversed(tuple(INDEXES)):
        if name in existing_indexes:
            op.drop_index(name, table_name=TABLE)

    existing_columns = _columns()
    for name in reversed(tuple(COLUMNS)):
        if name in existing_columns:
            op.drop_column(TABLE, name)
