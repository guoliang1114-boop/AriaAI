"""V1.46 - Deliverable business rules and explicit knowledge archives.

Revision ID: 046_v1_46
Revises: 045_v1_45
Create Date: 2026-09-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "046_v1_46"
down_revision = "045_v1_45"
branch_labels = None
depends_on = None


GENERATED_FILE_TABLE = "generatedfile"
ARCHIVE_TABLE = "artifact_knowledge_archive"
VERIFIER_COLUMN = "deliverable_business_verifiers_json"
ARCHIVE_INDEXES = {
    "ix_artifact_knowledge_archive_generated_file_id": ["generated_file_id"],
    "ix_artifact_knowledge_archive_knowledge_source_id": ["knowledge_source_id"],
    "ix_artifact_knowledge_archive_knowledge_document_id": [
        "knowledge_document_id"
    ],
    "ix_artifact_knowledge_archive_content_sha256": ["content_sha256"],
    "ix_artifact_knowledge_archive_deliverable_contract_sha256": [
        "deliverable_contract_sha256"
    ],
    "ix_artifact_knowledge_archive_requested_by_user_id": [
        "requested_by_user_id"
    ],
    "ix_artifact_knowledge_archive_created_at": ["created_at"],
}


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    if table not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_columns(table)
    }


def _indexes(table: str) -> set[str]:
    if table not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(table)
    }


def _create_archive_table() -> None:
    op.create_table(
        ARCHIVE_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("generated_file_id", sa.Integer(), nullable=False),
        sa.Column("knowledge_source_id", sa.Integer(), nullable=True),
        sa.Column("knowledge_document_id", sa.Integer(), nullable=True),
        sa.Column("content_sha256", sa.String(), nullable=False),
        sa.Column(
            "deliverable_contract_sha256",
            sa.String(),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "source_name",
            sa.String(length=255),
            nullable=False,
            server_default="",
        ),
        sa.Column(
            "source_scope_type",
            sa.String(length=50),
            nullable=False,
            server_default="",
        ),
        sa.Column("source_scope_id", sa.Integer(), nullable=True),
        sa.Column("requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "length(content_sha256) = 64 "
            "AND length(deliverable_contract_sha256) IN (0, 64)",
            name="ck_artifact_knowledge_archive_identity",
        ),
        sa.ForeignKeyConstraint(
            ["generated_file_id"],
            ["generatedfile.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_source_id"],
            ["knowledge_source.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_document_id"],
            ["knowledge_document.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["requested_by_user_id"],
            ["user.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "generated_file_id",
            "knowledge_source_id",
            "content_sha256",
            name="uq_artifact_knowledge_archive_target",
        ),
    )


def upgrade() -> None:
    if VERIFIER_COLUMN not in _columns(GENERATED_FILE_TABLE):
        op.add_column(
            GENERATED_FILE_TABLE,
            sa.Column(
                VERIFIER_COLUMN,
                sa.String(),
                nullable=False,
                server_default="[]",
            ),
        )
    if ARCHIVE_TABLE not in _tables():
        _create_archive_table()
    existing_indexes = _indexes(ARCHIVE_TABLE)
    for name, columns in ARCHIVE_INDEXES.items():
        if name not in existing_indexes:
            op.create_index(name, ARCHIVE_TABLE, columns, unique=False)


def downgrade() -> None:
    if ARCHIVE_TABLE in _tables():
        op.drop_table(ARCHIVE_TABLE)
    if VERIFIER_COLUMN in _columns(GENERATED_FILE_TABLE):
        op.drop_column(GENERATED_FILE_TABLE, VERIFIER_COLUMN)
