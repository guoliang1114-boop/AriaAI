"""V1.10 - Client stakeholder history tracking

Revision ID: 010_v1_10
Revises: 009_v1_9
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "010_v1_10"
down_revision = "009_v1_9"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    tables = inspector.get_table_names()
    if "clientstakeholderhistory" not in tables:
        op.create_table(
            "clientstakeholderhistory",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("stakeholder_id", sa.Integer(), nullable=False),
            sa.Column("client_id", sa.Integer(), nullable=False),
            sa.Column("field_name", sa.String(), nullable=False),
            sa.Column("old_value", sa.String(), nullable=False, server_default=""),
            sa.Column("new_value", sa.String(), nullable=False, server_default=""),
            sa.Column("trigger", sa.String(), nullable=False, server_default=""),
            sa.Column("changed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.ForeignKeyConstraint(["stakeholder_id"], ["clientstakeholder.id"]),
            sa.ForeignKeyConstraint(["client_id"], ["clientrecord.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = {index["name"] for index in inspector.get_indexes("clientstakeholderhistory")}
    if "ix_clientstakeholderhistory_stakeholder_id" not in indexes:
        op.create_index("ix_clientstakeholderhistory_stakeholder_id", "clientstakeholderhistory", ["stakeholder_id"])
    if "ix_clientstakeholderhistory_client_id" not in indexes:
        op.create_index("ix_clientstakeholderhistory_client_id", "clientstakeholderhistory", ["client_id"])


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if "clientstakeholderhistory" not in inspector.get_table_names():
        return
    indexes = {index["name"] for index in inspector.get_indexes("clientstakeholderhistory")}
    for index_name in (
        "ix_clientstakeholderhistory_client_id",
        "ix_clientstakeholderhistory_stakeholder_id",
    ):
        if index_name in indexes:
            op.drop_index(index_name, table_name="clientstakeholderhistory")
    op.drop_table("clientstakeholderhistory")
