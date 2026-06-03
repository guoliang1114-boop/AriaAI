"""V1.21 - Project progress updates

Adds lightweight human-authored progress updates for project activity.

Revision ID: 021_v1_21
Revises: 020_v1_20
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "021_v1_21"
down_revision = "020_v1_20"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if "projectprogressupdate" in inspector.get_table_names():
        return
    op.create_table(
        "projectprogressupdate",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("next_step", sa.Text(), nullable=False, server_default=""),
        sa.Column("risk", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"]),
    )
    op.create_index("ix_projectprogressupdate_project_id", "projectprogressupdate", ["project_id"])
    op.create_index("ix_projectprogressupdate_created_at", "projectprogressupdate", ["created_at"])
    op.create_index("ix_projectprogressupdate_created_by_user_id", "projectprogressupdate", ["created_by_user_id"])


def downgrade():
    inspector = inspect(op.get_bind())
    if "projectprogressupdate" not in inspector.get_table_names():
        return
    op.drop_index("ix_projectprogressupdate_created_by_user_id", table_name="projectprogressupdate")
    op.drop_index("ix_projectprogressupdate_created_at", table_name="projectprogressupdate")
    op.drop_index("ix_projectprogressupdate_project_id", table_name="projectprogressupdate")
    op.drop_table("projectprogressupdate")
