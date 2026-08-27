"""V1.30 - Optimistic version guard for memory candidate review.

Revision ID: 030_v1_30
Revises: 029_v1_29
Create Date: 2026-08-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "030_v1_30"
down_revision = "029_v1_29"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if "memorycandidate" in inspect(op.get_bind()).get_table_names() and "base_memory_version" not in _columns("memorycandidate"):
        op.add_column(
            "memorycandidate",
            sa.Column("base_memory_version", sa.Integer(), nullable=True),
        )


def downgrade() -> None:
    if "base_memory_version" in _columns("memorycandidate"):
        op.drop_column("memorycandidate", "base_memory_version")
