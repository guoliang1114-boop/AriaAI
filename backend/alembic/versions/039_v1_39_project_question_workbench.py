"""V1.39 - Project question workbench accountability ledger.

Revision ID: 039_v1_39
Revises: 038_v1_38
Create Date: 2026-08-31
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "039_v1_39"
down_revision = "038_v1_38"
branch_labels = None
depends_on = None


PROFILE_TABLE = "projectquestionprofile"
EVENT_TABLE = "projectquestionprofileevent"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(table_name)
    }


def _create_profile_table() -> None:
    op.create_table(
        PROFILE_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_sha256", sa.String(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("priority", sa.String(), nullable=False, server_default="normal"),
        sa.Column("due_date", sa.String(), nullable=False, server_default=""),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'critical')",
            name="ck_projectquestionprofile_priority",
        ),
        sa.CheckConstraint(
            "revision >= 1",
            name="ck_projectquestionprofile_revision",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "question_sha256",
            name="uq_projectquestionprofile_project_question",
        ),
    )


def _ensure_profile_indexes() -> None:
    existing = _indexes(PROFILE_TABLE)
    for name, columns in {
        "ix_projectquestionprofile_project_id": ["project_id"],
        "ix_projectquestionprofile_question_sha256": ["question_sha256"],
        "ix_projectquestionprofile_owner_user_id": ["owner_user_id"],
        "ix_projectquestionprofile_priority": ["priority"],
        "ix_projectquestionprofile_due_date": ["due_date"],
        "ix_projectquestionprofile_created_by_user_id": ["created_by_user_id"],
        "ix_projectquestionprofile_updated_by_user_id": ["updated_by_user_id"],
        "ix_projectquestionprofile_updated_at": ["updated_at"],
    }.items():
        if name not in existing:
            op.create_index(name, PROFILE_TABLE, columns, unique=False)


def _create_event_table() -> None:
    op.create_table(
        EVENT_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("previous_owner_user_id", sa.Integer(), nullable=True),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("previous_priority", sa.String(), nullable=False, server_default="normal"),
        sa.Column("priority", sa.String(), nullable=False, server_default="normal"),
        sa.Column("previous_due_date", sa.String(), nullable=False, server_default=""),
        sa.Column("due_date", sa.String(), nullable=False, server_default=""),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "revision >= 1",
            name="ck_projectquestionprofileevent_revision",
        ),
        sa.CheckConstraint(
            "previous_priority IN ('low', 'normal', 'high', 'critical') "
            "AND priority IN ('low', 'normal', 'high', 'critical')",
            name="ck_projectquestionprofileevent_priorities",
        ),
        sa.ForeignKeyConstraint(["profile_id"], [f"{PROFILE_TABLE}.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["previous_owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "profile_id",
            "revision",
            name="uq_projectquestionprofileevent_profile_revision",
        ),
    )


def _ensure_event_indexes() -> None:
    existing = _indexes(EVENT_TABLE)
    for name, columns in {
        "ix_projectquestionprofileevent_profile_id": ["profile_id"],
        "ix_projectquestionprofileevent_project_id": ["project_id"],
        "ix_projectquestionprofileevent_revision": ["revision"],
        "ix_projectquestionprofileevent_owner_user_id": ["owner_user_id"],
        "ix_projectquestionprofileevent_priority": ["priority"],
        "ix_projectquestionprofileevent_due_date": ["due_date"],
        "ix_projectquestionprofileevent_actor_user_id": ["actor_user_id"],
        "ix_projectquestionprofileevent_created_at": ["created_at"],
    }.items():
        if name not in existing:
            op.create_index(name, EVENT_TABLE, columns, unique=False)


def upgrade() -> None:
    if PROFILE_TABLE not in _tables():
        _create_profile_table()
    _ensure_profile_indexes()
    if EVENT_TABLE not in _tables():
        _create_event_table()
    _ensure_event_indexes()


def downgrade() -> None:
    if EVENT_TABLE in _tables():
        op.drop_table(EVENT_TABLE)
    if PROFILE_TABLE in _tables():
        op.drop_table(PROFILE_TABLE)
