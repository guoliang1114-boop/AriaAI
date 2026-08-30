"""V1.37 - Active ChatRun worker leases and heartbeat fencing.

Revision ID: 037_v1_37
Revises: 036_v1_36
Create Date: 2026-08-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "037_v1_37"
down_revision = "036_v1_36"
branch_labels = None
depends_on = None


LEASE_COLUMNS = {
    "lease_owner": sa.Column(
        "lease_owner", sa.String(), nullable=False, server_default=""
    ),
    "lease_token": sa.Column(
        "lease_token", sa.String(), nullable=False, server_default=""
    ),
    "lease_generation": sa.Column(
        "lease_generation", sa.Integer(), nullable=False, server_default="0"
    ),
    "lease_expires_at": sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
    "last_heartbeat_at": sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True),
}


def _inspector():
    return inspect(op.get_bind())


def _tables() -> set[str]:
    return set(_inspector().get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {str(item["name"]) for item in _inspector().get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {str(item["name"]) for item in _inspector().get_indexes(table_name)}


def _check_constraints(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(item.get("name") or "")
        for item in _inspector().get_check_constraints(table_name)
    }


def _add_missing_columns() -> None:
    existing = _columns("chatrun")
    for name, column in LEASE_COLUMNS.items():
        if name not in existing:
            op.add_column("chatrun", column)


def _create_missing_indexes() -> None:
    existing = _indexes("chatrun")
    for name, columns in {
        "ix_chatrun_lease_owner": ["lease_owner"],
        "ix_chatrun_lease_expires_at": ["lease_expires_at"],
        "ix_chatrun_last_heartbeat_at": ["last_heartbeat_at"],
    }.items():
        if name not in existing:
            op.create_index(name, "chatrun", columns, unique=False)


def _create_missing_checks() -> None:
    existing = _check_constraints("chatrun")
    definitions = {
        "ck_chatrun_lease_generation": "lease_generation >= 0",
        "ck_chatrun_active_lease_identity": (
            "(lease_token = '' AND lease_owner = '' AND lease_expires_at IS NULL) "
            "OR (length(lease_token) = 64 AND length(lease_owner) > 0 "
            "AND lease_generation > 0 AND lease_expires_at IS NOT NULL)"
        ),
    }
    for name, condition in definitions.items():
        if name not in existing:
            op.create_check_constraint(name, "chatrun", condition)


def upgrade() -> None:
    if "chatrun" not in _tables():
        return
    _add_missing_columns()
    dialect = op.get_bind().dialect.name
    missing_checks = {
        "ck_chatrun_lease_generation",
        "ck_chatrun_active_lease_identity",
    }.difference(_check_constraints("chatrun"))
    if dialect == "sqlite" and missing_checks:
        # SQLite cannot ALTER a table to add CHECK constraints. Rebuild once;
        # reflected FKs, unique constraints and indexes are preserved by batch.
        with op.batch_alter_table("chatrun", recreate="always") as batch_op:
            if "ck_chatrun_lease_generation" in missing_checks:
                batch_op.create_check_constraint(
                    "ck_chatrun_lease_generation",
                    "lease_generation >= 0",
                )
            if "ck_chatrun_active_lease_identity" in missing_checks:
                batch_op.create_check_constraint(
                    "ck_chatrun_active_lease_identity",
                    "(lease_token = '' AND lease_owner = '' "
                    "AND lease_expires_at IS NULL) OR "
                    "(length(lease_token) = 64 AND length(lease_owner) > 0 "
                    "AND lease_generation > 0 AND lease_expires_at IS NOT NULL)",
                )
    elif missing_checks:
        _create_missing_checks()
    _create_missing_indexes()


def downgrade() -> None:
    if "chatrun" not in _tables():
        return
    dialect = op.get_bind().dialect.name
    if dialect == "sqlite":
        existing_columns = _columns("chatrun")
        with op.batch_alter_table("chatrun", recreate="always") as batch_op:
            for name in (
                "last_heartbeat_at",
                "lease_expires_at",
                "lease_generation",
                "lease_token",
                "lease_owner",
            ):
                if name in existing_columns:
                    batch_op.drop_column(name)
        return
    for name in (
        "ck_chatrun_active_lease_identity",
        "ck_chatrun_lease_generation",
    ):
        if name in _check_constraints("chatrun"):
            op.drop_constraint(name, "chatrun", type_="check")
    for name in (
        "ix_chatrun_last_heartbeat_at",
        "ix_chatrun_lease_expires_at",
        "ix_chatrun_lease_owner",
    ):
        if name in _indexes("chatrun"):
            op.drop_index(name, table_name="chatrun")
    existing_columns = _columns("chatrun")
    for name in (
        "last_heartbeat_at",
        "lease_expires_at",
        "lease_generation",
        "lease_token",
        "lease_owner",
    ):
        if name in existing_columns:
            op.drop_column("chatrun", name)
