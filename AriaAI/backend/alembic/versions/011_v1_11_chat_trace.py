"""V1.11 - Chat trace diagnostics

Revision ID: 011_v1_11
Revises: 010_v1_10
Create Date: 2026-05-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "011_v1_11"
down_revision = "010_v1_10"
branch_labels = None
depends_on = None


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()
    if "chattrace" not in tables:
        op.create_table(
            "chattrace",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("trace_id", sa.String(), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("message_id", sa.Integer(), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("chat_mode", sa.String(), nullable=False, server_default=""),
            sa.Column("action_policy", sa.String(), nullable=False, server_default=""),
            sa.Column("intent_method", sa.String(), nullable=False, server_default=""),
            sa.Column("intent_reason", sa.String(), nullable=False, server_default=""),
            sa.Column("model_used", sa.String(), nullable=False, server_default=""),
            sa.Column("prompt_layers_json", sa.String(), nullable=False, server_default="[]"),
            sa.Column("tool_decisions_json", sa.String(), nullable=False, server_default="[]"),
            sa.Column("artifacts_json", sa.String(), nullable=False, server_default="[]"),
            sa.Column("stage_timings_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("fallback_events_json", sa.String(), nullable=False, server_default="[]"),
            sa.Column("metadata_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["conversation_id"], ["conversation.id"]),
            sa.ForeignKeyConstraint(["message_id"], ["message.id"]),
            sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        inspector = inspect(bind)

    indexes = _index_names(inspector, "chattrace")
    for index_name, columns in {
        "ix_chattrace_trace_id": ["trace_id"],
        "ix_chattrace_conversation_id": ["conversation_id"],
        "ix_chattrace_message_id": ["message_id"],
        "ix_chattrace_project_id": ["project_id"],
        "ix_chattrace_chat_mode": ["chat_mode"],
        "ix_chattrace_action_policy": ["action_policy"],
        "ix_chattrace_created_at": ["created_at"],
    }.items():
        if index_name not in indexes:
            op.create_index(index_name, "chattrace", columns)


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "chattrace" not in inspector.get_table_names():
        return
    indexes = _index_names(inspector, "chattrace")
    for index_name in (
        "ix_chattrace_created_at",
        "ix_chattrace_action_policy",
        "ix_chattrace_chat_mode",
        "ix_chattrace_project_id",
        "ix_chattrace_message_id",
        "ix_chattrace_conversation_id",
        "ix_chattrace_trace_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="chattrace")
    op.drop_table("chattrace")
