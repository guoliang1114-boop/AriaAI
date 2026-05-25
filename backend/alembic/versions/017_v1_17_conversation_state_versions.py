"""V1.17 - Conversation state and project file versions

Revision ID: 017_v1_17
Revises: 016_v1_16
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "017_v1_17"
down_revision = "016_v1_16"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if table_name not in _tables():
        return
    if index_name not in _indexes(table_name):
        op.create_index(index_name, table_name, columns)


def upgrade():
    tables = _tables()
    if "conversationstate" not in tables:
        op.create_table(
            "conversationstate",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("current_artifact_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("current_task_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("user_constraints_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("decisions_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("active_file_ids_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("last_intent_json", sa.Text(), nullable=False, server_default="{}"),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("last_user_request", sa.Text(), nullable=False, server_default=""),
            sa.Column("last_assistant_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["conversation_id"], ["conversation.id"]),
            sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("conversation_id", name="uq_conversationstate_conversation_id"),
        )
    _create_index_if_missing("ix_conversationstate_conversation_id", "conversationstate", ["conversation_id"])
    _create_index_if_missing("ix_conversationstate_project_id", "conversationstate", ["project_id"])
    _create_index_if_missing("ix_conversationstate_updated_at", "conversationstate", ["updated_at"])

    if "projectfileversion" not in tables:
        op.create_table(
            "projectfileversion",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_file_id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("file_type", sa.String(), nullable=False, server_default=""),
            sa.Column("path", sa.String(), nullable=False, server_default=""),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("content_hash", sa.String(), nullable=False, server_default=""),
            sa.Column("content_snapshot", sa.Text(), nullable=False, server_default=""),
            sa.Column("change_source", sa.String(), nullable=False, server_default=""),
            sa.Column("message_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["message_id"], ["message.id"]),
            sa.ForeignKeyConstraint(["project_file_id"], ["projectfile.id"]),
            sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("project_file_id", "version_number", name="uq_projectfileversion_file_version"),
        )
    _create_index_if_missing("ix_projectfileversion_project_file_id", "projectfileversion", ["project_file_id"])
    _create_index_if_missing("ix_projectfileversion_project_id", "projectfileversion", ["project_id"])
    _create_index_if_missing("ix_projectfileversion_version_number", "projectfileversion", ["version_number"])
    _create_index_if_missing("ix_projectfileversion_content_hash", "projectfileversion", ["content_hash"])
    _create_index_if_missing("ix_projectfileversion_message_id", "projectfileversion", ["message_id"])
    _create_index_if_missing("ix_projectfileversion_created_at", "projectfileversion", ["created_at"])


def downgrade():
    tables = _tables()
    if "projectfileversion" in tables:
        op.drop_table("projectfileversion")
    if "conversationstate" in tables:
        op.drop_table("conversationstate")
