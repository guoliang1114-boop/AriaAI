"""V1.42 - Human adjudication for review-required remediation evidence.

Revision ID: 042_v1_42
Revises: 041_v1_41
Create Date: 2026-09-01
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "042_v1_42"
down_revision = "041_v1_41"
branch_labels = None
depends_on = None


ATTACHMENT_TABLE = "projectquestionremediationevidenceattachment"
EXECUTION_TABLE = "projectquestionremediationexecution"
REVIEW_TABLE = "projectquestionremediationevidencereview"
REVIEW_EVENT_TABLE = "projectquestionremediationevidencereviewevent"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(table_name)
    }


def _ensure_indexes(table_name: str, definitions: dict[str, list[str]]) -> None:
    existing = _indexes(table_name)
    for name, columns in definitions.items():
        if name not in existing:
            op.create_index(name, table_name, columns, unique=False)


def _create_review_table() -> None:
    op.create_table(
        REVIEW_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("attachment_id", sa.Integer(), nullable=False),
        sa.Column("execution_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("question_sha256", sa.String(), nullable=False),
        sa.Column("evidence_sha256", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("reviewed_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('accepted', 'rejected')",
            name="ck_pq_rereview_status",
        ),
        sa.CheckConstraint(
            "revision >= 1 AND length(question_sha256) = 64 "
            "AND length(evidence_sha256) = 64",
            name="ck_pq_rereview_revision_identity",
        ),
        sa.ForeignKeyConstraint(
            ["attachment_id"], [f"{ATTACHMENT_TABLE}.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["execution_id"], [f"{EXECUTION_TABLE}.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["reviewed_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("attachment_id", name="uq_pq_rereview_attachment"),
    )


def _ensure_review_indexes() -> None:
    _ensure_indexes(
        REVIEW_TABLE,
        {
            "ix_pq_rereview_execution": ["execution_id"],
            "ix_pq_rereview_project": ["project_id"],
            "ix_pq_rereview_question": ["question_sha256"],
            "ix_pq_rereview_status": ["status"],
            "ix_pq_rereview_reviewed": ["reviewed_at"],
        },
    )


def _create_review_event_table() -> None:
    op.create_table(
        REVIEW_EVENT_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("review_id", sa.Integer(), nullable=False),
        sa.Column("attachment_id", sa.Integer(), nullable=False),
        sa.Column("execution_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("previous_status", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("evidence_sha256", sa.String(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "previous_status IN ('pending', 'accepted', 'rejected')",
            name="ck_pq_rerevent_previous",
        ),
        sa.CheckConstraint(
            "status IN ('accepted', 'rejected')",
            name="ck_pq_rerevent_status",
        ),
        sa.CheckConstraint(
            "revision >= 1 AND length(evidence_sha256) = 64",
            name="ck_pq_rerevent_revision_identity",
        ),
        sa.ForeignKeyConstraint(
            ["review_id"], [f"{REVIEW_TABLE}.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["attachment_id"], [f"{ATTACHMENT_TABLE}.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["execution_id"], [f"{EXECUTION_TABLE}.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "review_id", "revision", name="uq_pq_rerevent_revision"
        ),
    )


def _ensure_review_event_indexes() -> None:
    _ensure_indexes(
        REVIEW_EVENT_TABLE,
        {
            "ix_pq_rerevent_review": ["review_id"],
            "ix_pq_rerevent_attachment": ["attachment_id"],
            "ix_pq_rerevent_execution": ["execution_id"],
            "ix_pq_rerevent_project": ["project_id"],
            "ix_pq_rerevent_status": ["status"],
            "ix_pq_rerevent_actor": ["actor_user_id"],
            "ix_pq_rerevent_created": ["created_at"],
        },
    )


def upgrade() -> None:
    if REVIEW_TABLE not in _tables():
        _create_review_table()
    _ensure_review_indexes()
    if REVIEW_EVENT_TABLE not in _tables():
        _create_review_event_table()
    _ensure_review_event_indexes()


def downgrade() -> None:
    if REVIEW_EVENT_TABLE in _tables():
        op.drop_table(REVIEW_EVENT_TABLE)
    if REVIEW_TABLE in _tables():
        op.drop_table(REVIEW_TABLE)
