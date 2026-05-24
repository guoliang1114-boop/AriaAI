"""V1.9 - Project file origin and source_file_id

Revision ID: 009_v1_9
Revises: 008_v1_8
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "009_v1_9"
down_revision = "008_v1_8"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("projectfile")}

    if "source_file_id" not in columns:
        op.add_column("projectfile", sa.Column("source_file_id", sa.Integer(), nullable=True))
    if "origin" not in columns:
        op.add_column("projectfile", sa.Column("origin", sa.String(), nullable=False, server_default="uploaded"))

    indexes = {index["name"] for index in inspector.get_indexes("projectfile")}
    if "ix_projectfile_source_file_id" not in indexes:
        op.create_index("ix_projectfile_source_file_id", "projectfile", ["source_file_id"])


def downgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    indexes = {index["name"] for index in inspector.get_indexes("projectfile")}
    if "ix_projectfile_source_file_id" in indexes:
        op.drop_index("ix_projectfile_source_file_id", table_name="projectfile")
    columns = {col["name"] for col in inspector.get_columns("projectfile")}
    if "origin" in columns:
        op.drop_column("projectfile", "origin")
    if "source_file_id" in columns:
        op.drop_column("projectfile", "source_file_id")
