"""V1.43 - Immutable generated-artifact verification evidence.

Revision ID: 043_v1_43
Revises: 042_v1_42
Create Date: 2026-09-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "043_v1_43"
down_revision = "042_v1_42"
branch_labels = None
depends_on = None


TABLE = "artifactverification"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes() -> set[str]:
    if TABLE not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(TABLE)
    }


def _create_table() -> None:
    op.create_table(
        TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("generated_file_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=False, server_default=""),
        sa.Column("output_id", sa.String(), nullable=False, server_default=""),
        sa.Column("skill_id", sa.Integer(), nullable=True),
        sa.Column("skill_release_id", sa.Integer(), nullable=True),
        sa.Column("skill_release_sha256", sa.String(), nullable=False, server_default=""),
        sa.Column("content_sha256", sa.String(), nullable=False),
        sa.Column("evidence_sha256", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("technical_status", sa.String(), nullable=False),
        sa.Column("skill_status", sa.String(), nullable=False),
        sa.Column("verifier_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("automated_check_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("automated_passed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("automated_failed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("automated_skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skill_check_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("evidence_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('passed', 'failed', 'partial', 'manual_required')",
            name="ck_artifactverification_status",
        ),
        sa.CheckConstraint(
            "technical_status IN ('passed', 'failed', 'unsupported')",
            name="ck_artifactverification_technical_status",
        ),
        sa.CheckConstraint(
            "skill_status IN ('not_declared', 'manual_required', 'context_incomplete')",
            name="ck_artifactverification_skill_status",
        ),
        sa.CheckConstraint(
            "verifier_version >= 1 AND length(content_sha256) = 64 "
            "AND length(evidence_sha256) = 64 "
            "AND length(skill_release_sha256) IN (0, 64)",
            name="ck_artifactverification_identity",
        ),
        sa.CheckConstraint(
            "automated_check_count >= 0 AND automated_passed_count >= 0 "
            "AND automated_failed_count >= 0 AND automated_skipped_count >= 0 "
            "AND skill_check_count >= 0 "
            "AND automated_check_count = automated_passed_count "
            "+ automated_failed_count + automated_skipped_count",
            name="ck_artifactverification_counts",
        ),
        sa.ForeignKeyConstraint(
            ["generated_file_id"], ["generatedfile.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["skill_id"], ["skill.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["skill_release_id"], ["skillrelease.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "generated_file_id",
            "content_sha256",
            "verifier_version",
            "skill_release_sha256",
            name="uq_artifactverification_content_verifier_skill",
        ),
    )


def _ensure_indexes() -> None:
    definitions = {
        "ix_artifactverification_generated_file_id": ["generated_file_id"],
        "ix_artifactverification_run_id": ["run_id"],
        "ix_artifactverification_output_id": ["output_id"],
        "ix_artifactverification_skill_id": ["skill_id"],
        "ix_artifactverification_skill_release_id": ["skill_release_id"],
        "ix_artifactverification_skill_release_sha256": ["skill_release_sha256"],
        "ix_artifactverification_content_sha256": ["content_sha256"],
        "ix_artifactverification_evidence_sha256": ["evidence_sha256"],
        "ix_artifactverification_status": ["status"],
        "ix_artifactverification_technical_status": ["technical_status"],
        "ix_artifactverification_skill_status": ["skill_status"],
        "ix_artifactverification_created_at": ["created_at"],
    }
    existing = _indexes()
    for name, columns in definitions.items():
        if name not in existing:
            op.create_index(name, TABLE, columns, unique=False)


def upgrade() -> None:
    if TABLE not in _tables():
        _create_table()
    _ensure_indexes()


def downgrade() -> None:
    if TABLE in _tables():
        op.drop_table(TABLE)
