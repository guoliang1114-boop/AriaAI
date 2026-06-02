"""V1.20 - Skill builtin tracking columns

Adds the two columns the ``Skill`` SQLModel has carried since R74 but
no migration ever shipped:

  - ``builtin_key``  TEXT, default ""   stable source key for the
    built-in Skill sync
  - ``builtin_hash`` TEXT, default ""   sha256 of the bundled source
    payload; mismatch triggers an in-place update on app startup

Production crashed at startup with
``AttributeError: 'Skill' object has no attribute 'builtin_hash'``
because the ORM model references these fields but the deployed
schema doesn't have the columns yet. This migration is purely
additive and idempotent (skips when a column already exists, e.g.
on dev databases that were created from ``SQLModel.metadata`` and
already include them).

Revision ID: 020_v1_20
Revises: 018_v1_18
Create Date: 2026-06-02

Note on chain: this migration intentionally chains off ``018_v1_18``,
not the local ``019_v1_19_knowledge_v005`` (which is a separate
in-progress workstream, not yet committed and therefore not on
prod). Once 019 is ready to ship, add an alembic merge migration
joining ``019_v1_19`` and ``020_v1_20`` into a single head.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "020_v1_20"
down_revision = "018_v1_18"
branch_labels = None
depends_on = None


def _skill_columns() -> set[str]:
    inspector = inspect(op.get_bind())
    if "skill" not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns("skill")}


def upgrade():
    columns = _skill_columns()
    if "skill" not in inspect(op.get_bind()).get_table_names():
        # Skill table itself doesn't exist yet — nothing to do (the
        # base SQLModel.create_all path will produce both columns
        # when it eventually runs).
        return
    if "builtin_key" not in columns:
        op.add_column(
            "skill",
            sa.Column("builtin_key", sa.Text(), nullable=False, server_default=""),
        )
    if "builtin_hash" not in columns:
        op.add_column(
            "skill",
            sa.Column("builtin_hash", sa.Text(), nullable=False, server_default=""),
        )


def downgrade():
    columns = _skill_columns()
    if "builtin_hash" in columns:
        op.drop_column("skill", "builtin_hash")
    if "builtin_key" in columns:
        op.drop_column("skill", "builtin_key")
