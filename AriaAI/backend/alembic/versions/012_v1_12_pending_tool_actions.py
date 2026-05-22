"""V1.12 - Pending tool actions

Revision ID: 012_v1_12
Revises: 011_v1_11
Create Date: 2026-05-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "012_v1_12"
down_revision = "011_v1_11"
branch_labels = None
depends_on = None


def _index_names(inspector, table_name: str) -> set[str]:
    return {index["name"] for index in inspector.get_indexes(table_name)}


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()
    if "pendingtoolaction" not in tables:
        op.create_table(
            "pendingtoolaction",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("trace_id", sa.String(), nullable=False, server_default=""),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("message_id", sa.Integer(), nullable=True),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("tool_name", sa.String(), nullable=False, server_default=""),
            sa.Column("tool_input_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("action_type", sa.String(), nullable=False, server_default=""),
            sa.Column("title", sa.String(), nullable=False, server_default=""),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column("details_json", sa.String(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("confirmed_by_user_id", sa.Integer(), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
            sa.Column("result_json", sa.String(), nullable=True),
            sa.Column("error_message", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["conversation_id"], ["conversation.id"]),
            sa.ForeignKeyConstraint(["message_id"], ["message.id"]),
            sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        inspector = inspect(bind)

    indexes = _index_names(inspector, "pendingtoolaction")
    for index_name, columns in {
        "ix_pendingtoolaction_trace_id": ["trace_id"],
        "ix_pendingtoolaction_conversation_id": ["conversation_id"],
        "ix_pendingtoolaction_message_id": ["message_id"],
        "ix_pendingtoolaction_project_id": ["project_id"],
    }.items():
        if index_name not in indexes:
            op.create_index(index_name, "pendingtoolaction", columns)


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "pendingtoolaction" not in inspector.get_table_names():
        return
    indexes = _index_names(inspector, "pendingtoolaction")
    for index_name in (
        "ix_pendingtoolaction_project_id",
        "ix_pendingtoolaction_message_id",
        "ix_pendingtoolaction_conversation_id",
        "ix_pendingtoolaction_trace_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="pendingtoolaction")
    op.drop_table("pendingtoolaction")
