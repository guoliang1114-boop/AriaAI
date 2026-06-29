"""V1.24 - Weekly focus items

Adds per-person weekly key focus items ("每周重点事项") with a lightweight
follow-up model: one ``status`` + an in-place one-line ``progress_note`` per
item, scoped to an ISO week via ``week_start`` (the Monday of that week).

Revision ID: 024_v1_24
Revises: 023_v1_23
Create Date: 2026-06-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "024_v1_24"
down_revision = "023_v1_23"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    if "weeklyfocusitem" in inspector.get_table_names():
        return
    op.create_table(
        "weeklyfocusitem",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("week_start", sa.String(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="in_progress"),
        sa.Column("progress_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_weeklyfocusitem_week_start", "weeklyfocusitem", ["week_start"])
    op.create_index("ix_weeklyfocusitem_owner_user_id", "weeklyfocusitem", ["owner_user_id"])
    op.create_index("ix_weeklyfocusitem_created_by_user_id", "weeklyfocusitem", ["created_by_user_id"])
    op.create_index("ix_weeklyfocusitem_project_id", "weeklyfocusitem", ["project_id"])


def downgrade():
    inspector = inspect(op.get_bind())
    if "weeklyfocusitem" not in inspector.get_table_names():
        return
    op.drop_index("ix_weeklyfocusitem_project_id", table_name="weeklyfocusitem")
    op.drop_index("ix_weeklyfocusitem_created_by_user_id", table_name="weeklyfocusitem")
    op.drop_index("ix_weeklyfocusitem_owner_user_id", table_name="weeklyfocusitem")
    op.drop_index("ix_weeklyfocusitem_week_start", table_name="weeklyfocusitem")
    op.drop_table("weeklyfocusitem")
