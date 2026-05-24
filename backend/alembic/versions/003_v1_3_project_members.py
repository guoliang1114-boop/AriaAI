"""V1.3 – ProjectMember table

Revision ID: 003_v1_3
Revises: 002_v1_2
Create Date: 2026-04-13
"""
from alembic import op
import sqlalchemy as sa

revision = "003_v1_3"
down_revision = "002_v1_2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "projectmember",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False, index=True),
        sa.Column("user_id", sa.Integer(), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
    )


def downgrade():
    op.drop_table("projectmember")
