"""V1.7 - Project memory snapshots

Revision ID: 007_v1_7
Revises: 006_v1_6
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "007_v1_7"
down_revision = "006_v1_6"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()
    if "projectmemorysnapshot" not in tables:
        op.create_table(
            "projectmemorysnapshot",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("project_id", sa.Integer(), nullable=False),
            sa.Column("memory_version", sa.Integer(), nullable=False),
            sa.Column("trigger", sa.String(), nullable=False, server_default=""),
            sa.Column("memory_json", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = {index["name"] for index in inspector.get_indexes("projectmemorysnapshot")}
    if "ix_projectmemorysnapshot_project_id" not in indexes:
        op.create_index("ix_projectmemorysnapshot_project_id", "projectmemorysnapshot", ["project_id"])
    if "ix_projectmemorysnapshot_memory_version" not in indexes:
        op.create_index("ix_projectmemorysnapshot_memory_version", "projectmemorysnapshot", ["memory_version"])
    if "ix_projectmemorysnapshot_trigger" not in indexes:
        op.create_index("ix_projectmemorysnapshot_trigger", "projectmemorysnapshot", ["trigger"])
    if "ix_projectmemorysnapshot_created_at" not in indexes:
        op.create_index("ix_projectmemorysnapshot_created_at", "projectmemorysnapshot", ["created_at"])


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "projectmemorysnapshot" not in inspector.get_table_names():
        return
    indexes = {index["name"] for index in inspector.get_indexes("projectmemorysnapshot")}
    for index_name in (
        "ix_projectmemorysnapshot_created_at",
        "ix_projectmemorysnapshot_trigger",
        "ix_projectmemorysnapshot_memory_version",
        "ix_projectmemorysnapshot_project_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="projectmemorysnapshot")
    op.drop_table("projectmemorysnapshot")
