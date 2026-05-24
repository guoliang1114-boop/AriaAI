"""V1.8 - Client memory snapshots

Revision ID: 008_v1_8
Revises: 007_v1_7
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "008_v1_8"
down_revision = "007_v1_7"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()
    if "clientmemorysnapshot" not in tables:
        op.create_table(
            "clientmemorysnapshot",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("client_id", sa.Integer(), nullable=False),
            sa.Column("memory_version", sa.Integer(), nullable=False),
            sa.Column("trigger", sa.String(), nullable=False, server_default=""),
            sa.Column("memory_json", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["client_id"], ["clientrecord.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = {index["name"] for index in inspector.get_indexes("clientmemorysnapshot")}
    if "ix_clientmemorysnapshot_client_id" not in indexes:
        op.create_index("ix_clientmemorysnapshot_client_id", "clientmemorysnapshot", ["client_id"])
    if "ix_clientmemorysnapshot_memory_version" not in indexes:
        op.create_index("ix_clientmemorysnapshot_memory_version", "clientmemorysnapshot", ["memory_version"])
    if "ix_clientmemorysnapshot_trigger" not in indexes:
        op.create_index("ix_clientmemorysnapshot_trigger", "clientmemorysnapshot", ["trigger"])
    if "ix_clientmemorysnapshot_created_at" not in indexes:
        op.create_index("ix_clientmemorysnapshot_created_at", "clientmemorysnapshot", ["created_at"])


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "clientmemorysnapshot" not in inspector.get_table_names():
        return
    indexes = {index["name"] for index in inspector.get_indexes("clientmemorysnapshot")}
    for index_name in (
        "ix_clientmemorysnapshot_created_at",
        "ix_clientmemorysnapshot_trigger",
        "ix_clientmemorysnapshot_memory_version",
        "ix_clientmemorysnapshot_client_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="clientmemorysnapshot")
    op.drop_table("clientmemorysnapshot")
