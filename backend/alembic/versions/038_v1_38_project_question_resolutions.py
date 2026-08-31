"""V1.38 - User-confirmed project question resolution ledger.

Revision ID: 038_v1_38
Revises: 037_v1_37
Create Date: 2026-08-31
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "038_v1_38"
down_revision = "037_v1_37"
branch_labels = None
depends_on = None


TABLE_NAME = "projectquestionresolution"
EVENT_TABLE_NAME = "projectquestionresolutionevent"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes() -> set[str]:
    if TABLE_NAME not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(TABLE_NAME)
    }


def _event_indexes() -> set[str]:
    if EVENT_TABLE_NAME not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(EVENT_TABLE_NAME)
    }


def _create_table() -> None:
    op.create_table(
        TABLE_NAME,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_sha256", sa.String(), nullable=False),
        sa.Column("question_fact_key", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="resolved"),
        sa.Column("resolution_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("resolution_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("answer_message_id", sa.Integer(), nullable=True),
        sa.Column("answer_conversation_id", sa.Integer(), nullable=True),
        sa.Column("resolved_by_user_id", sa.Integer(), nullable=True),
        sa.Column("reopened_by_user_id", sa.Integer(), nullable=True),
        sa.Column("source_memory_version", sa.Integer(), nullable=False),
        sa.Column("source_slot_version", sa.Integer(), nullable=False),
        sa.Column("resolved_memory_version", sa.Integer(), nullable=False),
        sa.Column("resolved_slot_version", sa.Integer(), nullable=False),
        sa.Column("reopened_memory_version", sa.Integer(), nullable=True),
        sa.Column("reopened_slot_version", sa.Integer(), nullable=True),
        sa.Column("reopen_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("resolved_at", sa.DateTime(), nullable=False),
        sa.Column("reopened_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('resolved', 'open')",
            name="ck_projectquestionresolution_status",
        ),
        sa.CheckConstraint(
            "resolution_revision >= 1",
            name="ck_projectquestionresolution_revision",
        ),
        sa.CheckConstraint(
            "source_memory_version >= 1 AND resolved_memory_version >= 1",
            name="ck_projectquestionresolution_memory_versions",
        ),
        sa.CheckConstraint(
            "source_slot_version >= 1 AND resolved_slot_version >= 1",
            name="ck_projectquestionresolution_slot_versions",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["answer_message_id"], ["message.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["answer_conversation_id"], ["conversation.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["resolved_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reopened_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "question_sha256",
            name="uq_projectquestionresolution_project_question",
        ),
    )


def _ensure_indexes() -> None:
    existing = _indexes()
    for name, columns in {
        "ix_projectquestionresolution_project_id": ["project_id"],
        "ix_projectquestionresolution_question_sha256": ["question_sha256"],
        "ix_projectquestionresolution_question_fact_key": ["question_fact_key"],
        "ix_projectquestionresolution_status": ["status"],
        "ix_projectquestionresolution_answer_message_id": ["answer_message_id"],
        "ix_projectquestionresolution_answer_conversation_id": ["answer_conversation_id"],
        "ix_projectquestionresolution_resolved_by_user_id": ["resolved_by_user_id"],
        "ix_projectquestionresolution_reopened_by_user_id": ["reopened_by_user_id"],
        "ix_projectquestionresolution_source_memory_version": ["source_memory_version"],
        "ix_projectquestionresolution_source_slot_version": ["source_slot_version"],
        "ix_projectquestionresolution_resolved_memory_version": ["resolved_memory_version"],
        "ix_projectquestionresolution_resolved_slot_version": ["resolved_slot_version"],
        "ix_projectquestionresolution_resolved_at": ["resolved_at"],
        "ix_projectquestionresolution_reopened_at": ["reopened_at"],
        "ix_projectquestionresolution_updated_at": ["updated_at"],
    }.items():
        if name not in existing:
            op.create_index(name, TABLE_NAME, columns, unique=False)


def _create_event_table() -> None:
    op.create_table(
        EVENT_TABLE_NAME,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("resolution_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("resolution_revision", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_fact_key", sa.String(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("answer_message_id", sa.Integer(), nullable=True),
        sa.Column("answer_conversation_id", sa.Integer(), nullable=True),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("memory_version", sa.Integer(), nullable=False),
        sa.Column("slot_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "action IN ('resolved', 'reopened')",
            name="ck_projectquestionresolutionevent_action",
        ),
        sa.CheckConstraint(
            "resolution_revision >= 1 AND memory_version >= 1 AND slot_version >= 1",
            name="ck_projectquestionresolutionevent_versions",
        ),
        sa.ForeignKeyConstraint(["resolution_id"], [f"{TABLE_NAME}.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["answer_message_id"], ["message.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["answer_conversation_id"], ["conversation.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "resolution_id",
            "resolution_revision",
            name="uq_projectquestionresolutionevent_resolution_revision",
        ),
    )


def _ensure_event_indexes() -> None:
    existing = _event_indexes()
    for name, columns in {
        "ix_projectquestionresolutionevent_resolution_id": ["resolution_id"],
        "ix_projectquestionresolutionevent_project_id": ["project_id"],
        "ix_projectquestionresolutionevent_action": ["action"],
        "ix_projectquestionresolutionevent_resolution_revision": ["resolution_revision"],
        "ix_projectquestionresolutionevent_question_fact_key": ["question_fact_key"],
        "ix_projectquestionresolutionevent_answer_message_id": ["answer_message_id"],
        "ix_projectquestionresolutionevent_answer_conversation_id": ["answer_conversation_id"],
        "ix_projectquestionresolutionevent_actor_user_id": ["actor_user_id"],
        "ix_projectquestionresolutionevent_memory_version": ["memory_version"],
        "ix_projectquestionresolutionevent_slot_version": ["slot_version"],
        "ix_projectquestionresolutionevent_created_at": ["created_at"],
    }.items():
        if name not in existing:
            op.create_index(name, EVENT_TABLE_NAME, columns, unique=False)


def upgrade() -> None:
    if TABLE_NAME not in _tables():
        _create_table()
    _ensure_indexes()
    if EVENT_TABLE_NAME not in _tables():
        _create_event_table()
    _ensure_event_indexes()


def downgrade() -> None:
    if EVENT_TABLE_NAME in _tables():
        op.drop_table(EVENT_TABLE_NAME)
    if TABLE_NAME in _tables():
        op.drop_table(TABLE_NAME)
