"""V1.22 - Backfill owner members for orphan projects

R74 follow-up to ``fb3a95f`` (per-user conversation isolation). That change
made conversation access require a real ``ProjectMember`` row, with NO admin
super-user bypass. New projects auto-add their creator as owner, but projects
created before that logic existed have ZERO member rows — so every user
(admins included) now 403s on their conversations ("Project membership
required"). The original creator was never recorded (``project`` has no
``created_by`` column), so we backfill every admin as owner of any project
that currently has no members. Projects that already have members are left
untouched, preserving isolation.

Revision ID: 022_v1_22
Revises: 021_v1_21
Create Date: 2026-06-04
"""
from alembic import op
from sqlalchemy import inspect, text


revision = "022_v1_22"
down_revision = "021_v1_21"
branch_labels = None
depends_on = None


def upgrade():
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if not {"project", "projectmember", "user"}.issubset(tables):
        return
    # One owner row per (admin, orphan-project) pair. An orphan project is one
    # with no ProjectMember rows at all. Idempotent: re-running inserts nothing
    # because backfilled projects are no longer orphans.
    op.execute(
        text(
            """
            INSERT INTO projectmember (project_id, user_id, role, created_at)
            SELECT p.id, u.id, 'owner', CURRENT_TIMESTAMP
            FROM project p
            CROSS JOIN "user" u
            WHERE u.is_admin
              AND NOT EXISTS (
                  SELECT 1 FROM projectmember m WHERE m.project_id = p.id
              )
            """
        )
    )


def downgrade():
    # Data backfill — nothing to reverse safely (we cannot tell backfilled rows
    # apart from legitimately-added owner memberships). No-op.
    pass
