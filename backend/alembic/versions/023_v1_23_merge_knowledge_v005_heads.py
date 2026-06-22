"""V1.23 - Merge knowledge_v005 (019) and project-member backfill (022) heads

Revision 019_v1_19 (knowledge v0.0.5 tables) was authored with
down_revision = 018_v1_18, but by then the live chain had already advanced
018 -> 020 -> 021 -> 022, so 019 forked off 018 in parallel. That left the
repo with two Alembic heads (019_v1_19 and 022_v1_22), which makes
``alembic upgrade head`` ambiguous and aborts the deploy.

This is a no-op merge revision: it has no DDL of its own and simply ties the
two heads back together so there is a single head again. ``upgrade head`` from
022 first applies the still-pending 019 (the knowledge_* tables) and then this
merge point.

Revision ID: 023_v1_23
Revises: 019_v1_19, 022_v1_22
Create Date: 2026-06-22
"""

revision = "023_v1_23"
down_revision = ("019_v1_19", "022_v1_22")
branch_labels = None
depends_on = None


def upgrade():
    # Merge-only revision: no schema changes.
    pass


def downgrade():
    # Merge-only revision: no schema changes.
    pass
