"""V1.5 - ProjectTodo due_date

Revision ID: 005_v1_5
Revises: 004_v1_4
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = "005_v1_5"
down_revision = "004_v1_4"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("projecttodo", sa.Column("due_date", sa.String(), nullable=True))


def downgrade():
    op.drop_column("projecttodo", "due_date")
