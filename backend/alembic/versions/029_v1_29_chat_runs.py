"""V1.29 - First-class content-free chat run lifecycle projection.

Revision ID: 029_v1_29
Revises: 028_v1_28
Create Date: 2026-08-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "029_v1_29"
down_revision = "028_v1_28"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {index["name"] for index in inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    if "chatrun" not in _tables():
        op.create_table(
            "chatrun",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("run_id", sa.String(), nullable=False),
            sa.Column("task_run_id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("owner_user_id", sa.Integer(), nullable=True),
            sa.Column("source_message_id", sa.Integer(), nullable=True),
            sa.Column("assistant_message_id", sa.Integer(), nullable=True),
            sa.Column("skill_id", sa.Integer(), nullable=True),
            sa.Column("skill_name", sa.String(), nullable=False, server_default=""),
            sa.Column("model", sa.String(), nullable=False, server_default=""),
            sa.Column("chat_mode", sa.String(), nullable=False, server_default=""),
            sa.Column("action_policy", sa.String(), nullable=False, server_default=""),
            sa.Column("display_mode", sa.String(), nullable=False, server_default="quiet"),
            sa.Column("status", sa.String(), nullable=False, server_default="running"),
            sa.Column("phase", sa.String(), nullable=False, server_default="run_start"),
            sa.Column("request_sha256", sa.String(), nullable=False, server_default=""),
            sa.Column("context_manifest_sha256", sa.String(), nullable=False, server_default=""),
            sa.Column("step_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tool_call_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("output_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error_code", sa.String(), nullable=False, server_default=""),
            sa.Column("retryable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("started_at", sa.DateTime(), nullable=False),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["task_run_id"], ["taskrun.id"]),
            sa.ForeignKeyConstraint(["conversation_id"], ["conversation.id"]),
            sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"]),
            sa.ForeignKeyConstraint(["source_message_id"], ["message.id"]),
            sa.ForeignKeyConstraint(["assistant_message_id"], ["message.id"]),
            sa.ForeignKeyConstraint(["skill_id"], ["skill.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("run_id", name="uq_chatrun_run_id"),
            sa.UniqueConstraint("task_run_id", name="uq_chatrun_task_run_id"),
        )
    existing = _indexes("chatrun")
    for name, columns in {
        "ix_chatrun_conversation_id": ["conversation_id"],
        "ix_chatrun_project_id": ["project_id"],
        "ix_chatrun_owner_user_id": ["owner_user_id"],
        "ix_chatrun_source_message_id": ["source_message_id"],
        "ix_chatrun_assistant_message_id": ["assistant_message_id"],
        "ix_chatrun_skill_id": ["skill_id"],
        "ix_chatrun_chat_mode": ["chat_mode"],
        "ix_chatrun_action_policy": ["action_policy"],
        "ix_chatrun_display_mode": ["display_mode"],
        "ix_chatrun_status": ["status"],
        "ix_chatrun_phase": ["phase"],
        "ix_chatrun_request_sha256": ["request_sha256"],
        "ix_chatrun_started_at": ["started_at"],
        "ix_chatrun_completed_at": ["completed_at"],
        "ix_chatrun_updated_at": ["updated_at"],
    }.items():
        if name not in existing:
            op.create_index(name, "chatrun", columns)


def downgrade() -> None:
    if "chatrun" in _tables():
        op.drop_table("chatrun")
