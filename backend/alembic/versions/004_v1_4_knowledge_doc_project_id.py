"""V1.4 – KnowledgeDocument project_id

Revision ID: 004_v1_4
Revises: 003_v1_3
Create Date: 2026-04-14
"""
from alembic import op
import sqlalchemy as sa

revision = "004_v1_4"
down_revision = "003_v1_3"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "knowledgedocument",
        sa.Column("project_id", sa.Integer(), nullable=True, index=True),
    )
    op.create_foreign_key(
        "fk_knowledgedocument_project",
        "knowledgedocument",
        "project",
        ["project_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_knowledgedocument_project", "knowledgedocument", type_="foreignkey")
    op.drop_column("knowledgedocument", "project_id")
