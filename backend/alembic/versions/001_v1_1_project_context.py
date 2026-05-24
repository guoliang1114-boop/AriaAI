"""V1.1 – Project context_summary, notes; ProjectFile summary

Revision ID: 001_v1_1
Revises:
Create Date: 2026-03-27
"""
from alembic import op
import sqlalchemy as sa

revision = "001_v1_1"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Project: AI-generated context summary + accumulated notes
    op.add_column("project", sa.Column("context_summary", sa.Text(), nullable=False, server_default=""))
    op.add_column("project", sa.Column("notes", sa.Text(), nullable=False, server_default=""))
    # ProjectFile: AI-generated file summary
    op.add_column("projectfile", sa.Column("summary", sa.Text(), nullable=False, server_default=""))


def downgrade():
    op.drop_column("project", "context_summary")
    op.drop_column("project", "notes")
    op.drop_column("projectfile", "summary")
