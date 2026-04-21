"""V1.6 - Client stakeholders

Revision ID: 006_v1_6
Revises: 005_v1_5
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa

revision = "006_v1_6"
down_revision = "005_v1_5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "clientstakeholder",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default=""),
        sa.Column("organization_level", sa.String(), nullable=False, server_default=""),
        sa.Column("influence_type", sa.String(), nullable=False, server_default=""),
        sa.Column("relationship_status", sa.String(), nullable=False, server_default="unknown"),
        sa.Column("concerns", sa.Text(), nullable=False, server_default=""),
        sa.Column("sensitivities", sa.Text(), nullable=False, server_default=""),
        sa.Column("communication_preference", sa.Text(), nullable=False, server_default=""),
        sa.Column("contact", sa.String(), nullable=False, server_default=""),
        sa.Column("last_action", sa.Text(), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["client_id"], ["clientrecord.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clientstakeholder_client_id", "clientstakeholder", ["client_id"])


def downgrade():
    op.drop_index("ix_clientstakeholder_client_id", table_name="clientstakeholder")
    op.drop_table("clientstakeholder")
