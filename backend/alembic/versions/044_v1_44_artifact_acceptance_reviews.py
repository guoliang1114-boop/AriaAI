"""V1.44 - Artifact business acceptance review and append-only audit.

Revision ID: 044_v1_44
Revises: 043_v1_43
Create Date: 2026-09-03
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "044_v1_44"
down_revision = "043_v1_43"
branch_labels = None
depends_on = None


REVIEW_TABLE = "artifactacceptancereview"
EVENT_TABLE = "artifactacceptancereviewevent"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table: str) -> set[str]:
    if table not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(table)
    }


def _create_review_table() -> None:
    op.create_table(
        REVIEW_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("generated_file_id", sa.Integer(), nullable=False),
        sa.Column("verification_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(), nullable=False, server_default=""),
        sa.Column("output_id", sa.String(), nullable=False, server_default=""),
        sa.Column("content_sha256", sa.String(), nullable=False),
        sa.Column("evidence_sha256", sa.String(), nullable=False),
        sa.Column(
            "verification_plan_sha256",
            sa.String(),
            nullable=False,
            server_default="",
        ),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('accepted', 'rejected')",
            name="ck_artifactacceptancereview_status",
        ),
        sa.CheckConstraint(
            "revision >= 1 AND length(content_sha256) = 64 "
            "AND length(evidence_sha256) = 64 "
            "AND length(verification_plan_sha256) IN (0, 64)",
            name="ck_artifactacceptancereview_identity",
        ),
        sa.ForeignKeyConstraint(
            ["generated_file_id"],
            ["generatedfile.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["verification_id"],
            ["artifactverification.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"],
            ["user.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "verification_id",
            name="uq_artifactacceptancereview_verification",
        ),
    )


def _create_event_table() -> None:
    op.create_table(
        EVENT_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("review_id", sa.Integer(), nullable=False),
        sa.Column("generated_file_id", sa.Integer(), nullable=False),
        sa.Column("verification_id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("previous_status", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("content_sha256", sa.String(), nullable=False),
        sa.Column("evidence_sha256", sa.String(), nullable=False),
        sa.Column(
            "verification_plan_sha256",
            sa.String(),
            nullable=False,
            server_default="",
        ),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "previous_status IN ('pending', 'accepted', 'rejected')",
            name="ck_artifactacceptancereviewevent_previous",
        ),
        sa.CheckConstraint(
            "status IN ('accepted', 'rejected')",
            name="ck_artifactacceptancereviewevent_status",
        ),
        sa.CheckConstraint(
            "revision >= 1 AND length(content_sha256) = 64 "
            "AND length(evidence_sha256) = 64 "
            "AND length(verification_plan_sha256) IN (0, 64)",
            name="ck_artifactacceptancereviewevent_identity",
        ),
        sa.ForeignKeyConstraint(
            ["review_id"],
            [f"{REVIEW_TABLE}.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["generated_file_id"],
            ["generatedfile.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["verification_id"],
            ["artifactverification.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["user.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "review_id",
            "revision",
            name="uq_artifactacceptancereviewevent_revision",
        ),
    )


def _ensure_indexes() -> None:
    definitions = {
        REVIEW_TABLE: {
            "ix_artifactacceptancereview_generated_file_id": ["generated_file_id"],
            "ix_artifactacceptancereview_verification_id": ["verification_id"],
            "ix_artifactacceptancereview_run_id": ["run_id"],
            "ix_artifactacceptancereview_output_id": ["output_id"],
            "ix_artifactacceptancereview_content_sha256": ["content_sha256"],
            "ix_artifactacceptancereview_evidence_sha256": ["evidence_sha256"],
            "ix_artifactacceptancereview_verification_plan_sha256": [
                "verification_plan_sha256"
            ],
            "ix_artifactacceptancereview_status": ["status"],
            "ix_artifactacceptancereview_reviewed_by_user_id": [
                "reviewed_by_user_id"
            ],
            "ix_artifactacceptancereview_reviewed_at": ["reviewed_at"],
            "ix_artifactacceptancereview_created_at": ["created_at"],
            "ix_artifactacceptancereview_updated_at": ["updated_at"],
        },
        EVENT_TABLE: {
            "ix_artifactacceptancereviewevent_review_id": ["review_id"],
            "ix_artifactacceptancereviewevent_generated_file_id": [
                "generated_file_id"
            ],
            "ix_artifactacceptancereviewevent_verification_id": ["verification_id"],
            "ix_artifactacceptancereviewevent_status": ["status"],
            "ix_artifactacceptancereviewevent_content_sha256": ["content_sha256"],
            "ix_artifactacceptancereviewevent_evidence_sha256": ["evidence_sha256"],
            "ix_artifactacceptancereviewevent_verification_plan_sha256": [
                "verification_plan_sha256"
            ],
            "ix_artifactacceptancereviewevent_actor_user_id": ["actor_user_id"],
            "ix_artifactacceptancereviewevent_created_at": ["created_at"],
        },
    }
    for table, table_indexes in definitions.items():
        existing = _indexes(table)
        for name, columns in table_indexes.items():
            if name not in existing:
                op.create_index(name, table, columns, unique=False)


def upgrade() -> None:
    tables = _tables()
    if REVIEW_TABLE not in tables:
        _create_review_table()
    if EVENT_TABLE not in _tables():
        _create_event_table()
    _ensure_indexes()


def downgrade() -> None:
    tables = _tables()
    if EVENT_TABLE in tables:
        op.drop_table(EVENT_TABLE)
    if REVIEW_TABLE in tables:
        op.drop_table(REVIEW_TABLE)
