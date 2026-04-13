"""V1.2 – Project md_notes; ProjectTodo table

Revision ID: 002_v1_2
Revises: 001_v1_1
Create Date: 2026-04-12
"""
from alembic import op
import sqlalchemy as sa

revision = "002_v1_2"
down_revision = "001_v1_1"
branch_labels = None
depends_on = None


def upgrade():
    # Project: Markdown notes field
    op.add_column("project", sa.Column("md_notes", sa.Text(), nullable=False, server_default=""))

    # ProjectTodo: project-level todo list
    op.create_table(
        "projecttodo",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("project_id", sa.Integer(), nullable=False, index=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_done", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
    )


def downgrade():
    op.drop_table("projecttodo")
    op.drop_column("project", "md_notes")
