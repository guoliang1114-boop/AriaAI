"""V1.36 - Durable chat run inputs and recovery parent identity.

Revision ID: 036_v1_36
Revises: 035_v1_35
Create Date: 2026-08-30
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "036_v1_36"
down_revision = "035_v1_35"
branch_labels = None
depends_on = None


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


def _unique_constraints(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(item.get("name") or "")
        for item in _inspector().get_unique_constraints(table_name)
    }


def _check_constraints(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(item.get("name") or "")
        for item in _inspector().get_check_constraints(table_name)
    }


def _foreign_key_columns(table_name: str) -> set[tuple[str, ...]]:
    if table_name not in _tables():
        return set()
    return {
        tuple(str(value) for value in item.get("constrained_columns") or [])
        for item in _inspector().get_foreign_keys(table_name)
    }


def _create_indexes(table_name: str, definitions: dict[str, list[str]]) -> None:
    existing = _indexes(table_name)
    for name, columns in definitions.items():
        if name not in existing:
            op.create_index(name, table_name, columns, unique=False)


def upgrade() -> None:
    if "chatrun" not in _tables():
        return

    chatrun_columns = _columns("chatrun")
    if "parent_run_id" not in chatrun_columns:
        op.add_column(
            "chatrun",
            sa.Column("parent_run_id", sa.String(), nullable=True),
        )
    if "recovery_snapshot_sha256" not in chatrun_columns:
        op.add_column(
            "chatrun",
            sa.Column(
                "recovery_snapshot_sha256",
                sa.String(),
                nullable=False,
                server_default="",
            ),
        )
    dialect = op.get_bind().dialect.name
    if dialect != "sqlite":
        if ("parent_run_id",) not in _foreign_key_columns("chatrun"):
            op.create_foreign_key(
                "fk_chatrun_parent_run_id_chatrun",
                "chatrun",
                "chatrun",
                ["parent_run_id"],
                ["run_id"],
                ondelete="SET NULL",
            )
        if (
            "uq_chatrun_parent_recovery_snapshot"
            not in _unique_constraints("chatrun")
        ):
            op.create_unique_constraint(
                "uq_chatrun_parent_recovery_snapshot",
                "chatrun",
                ["parent_run_id", "recovery_snapshot_sha256"],
            )
        if "ck_chatrun_recovery_identity" not in _check_constraints("chatrun"):
            op.create_check_constraint(
                "ck_chatrun_recovery_identity",
                "chatrun",
                "parent_run_id IS NULL OR length(recovery_snapshot_sha256) = 64",
            )
    else:
        # SQLite cannot ALTER an existing table to add FK / CHECK / UNIQUE
        # constraints. Rebuild it once so migrated databases have the same
        # recovery CAS invariants as SQLModel-created and PostgreSQL schemas.
        # A prior interrupted version of this migration may have left the
        # recovery uniqueness rule as an equivalent named unique index; keep
        # that index and add only the still-missing constraints.
        foreign_keys = _foreign_key_columns("chatrun")
        unique_constraints = _unique_constraints("chatrun")
        indexes = _indexes("chatrun")
        check_constraints = _check_constraints("chatrun")
        has_unique_identity = (
            "uq_chatrun_parent_recovery_snapshot" in unique_constraints
            or "uq_chatrun_parent_recovery_snapshot" in indexes
        )
        if (
            ("parent_run_id",) not in foreign_keys
            or not has_unique_identity
            or "ck_chatrun_recovery_identity" not in check_constraints
        ):
            with op.batch_alter_table("chatrun", recreate="always") as batch_op:
                if ("parent_run_id",) not in foreign_keys:
                    batch_op.create_foreign_key(
                        "fk_chatrun_parent_run_id_chatrun",
                        "chatrun",
                        ["parent_run_id"],
                        ["run_id"],
                        ondelete="SET NULL",
                    )
                if not has_unique_identity:
                    batch_op.create_unique_constraint(
                        "uq_chatrun_parent_recovery_snapshot",
                        ["parent_run_id", "recovery_snapshot_sha256"],
                    )
                if "ck_chatrun_recovery_identity" not in check_constraints:
                    batch_op.create_check_constraint(
                        "ck_chatrun_recovery_identity",
                        "parent_run_id IS NULL OR "
                        "length(recovery_snapshot_sha256) = 64",
                    )

    # Create indexes after a possible SQLite batch rebuild. Alembic normally
    # preserves reflected indexes, and this second idempotent check also
    # repairs databases left between the column and index steps.
    _create_indexes(
        "chatrun",
        {
            "ix_chatrun_parent_run_id": ["parent_run_id"],
            "ix_chatrun_recovery_snapshot_sha256": ["recovery_snapshot_sha256"],
        },
    )

    if "chatruninput" not in _tables():
        op.create_table(
            "chatruninput",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("run_id", sa.String(), nullable=False),
            sa.Column("chat_run_id", sa.Integer(), nullable=False),
            sa.Column("conversation_id", sa.Integer(), nullable=False),
            sa.Column("message_id", sa.Integer(), nullable=True),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("content_sha256", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="accepted"),
            sa.Column("accepted_at", sa.DateTime(), nullable=False),
            sa.Column("applied_at", sa.DateTime(), nullable=True),
            sa.CheckConstraint(
                "kind IN ('steering', 'cancel')",
                name="ck_chatruninput_kind",
            ),
            sa.CheckConstraint(
                "status IN ('accepted', 'applied', 'unapplied', 'retracted')",
                name="ck_chatruninput_status",
            ),
            sa.CheckConstraint("sequence > 0", name="ck_chatruninput_sequence"),
            sa.CheckConstraint(
                "length(content_sha256) = 64",
                name="ck_chatruninput_content_sha256",
            ),
            sa.ForeignKeyConstraint(
                ["chat_run_id"],
                ["chatrun.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["conversation_id"],
                ["conversation.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["message_id"],
                ["message.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "chat_run_id",
                "sequence",
                name="uq_chatruninput_chat_run_sequence",
            ),
        )
    _create_indexes(
        "chatruninput",
        {
            "ix_chatruninput_run_id": ["run_id"],
            "ix_chatruninput_chat_run_id": ["chat_run_id"],
            "ix_chatruninput_conversation_id": ["conversation_id"],
            "ix_chatruninput_message_id": ["message_id"],
            "ix_chatruninput_kind": ["kind"],
            "ix_chatruninput_content_sha256": ["content_sha256"],
            "ix_chatruninput_status": ["status"],
            "ix_chatruninput_accepted_at": ["accepted_at"],
            "ix_chatruninput_applied_at": ["applied_at"],
        },
    )


def downgrade() -> None:
    if "chatruninput" in _tables():
        op.drop_table("chatruninput")
    if "chatrun" not in _tables():
        return
    dialect = op.get_bind().dialect.name
    if dialect != "sqlite":
        if "ck_chatrun_recovery_identity" in _check_constraints("chatrun"):
            op.drop_constraint(
                "ck_chatrun_recovery_identity",
                "chatrun",
                type_="check",
            )
        if (
            "uq_chatrun_parent_recovery_snapshot"
            in _unique_constraints("chatrun")
        ):
            op.drop_constraint(
                "uq_chatrun_parent_recovery_snapshot",
                "chatrun",
                type_="unique",
            )
        if ("parent_run_id",) in _foreign_key_columns("chatrun"):
            op.drop_constraint(
                "fk_chatrun_parent_run_id_chatrun",
                "chatrun",
                type_="foreignkey",
            )
        for index_name in (
            "ix_chatrun_recovery_snapshot_sha256",
            "ix_chatrun_parent_run_id",
        ):
            if index_name in _indexes("chatrun"):
                op.drop_index(index_name, table_name="chatrun")
        columns = _columns("chatrun")
        if "recovery_snapshot_sha256" in columns:
            op.drop_column("chatrun", "recovery_snapshot_sha256")
        if "parent_run_id" in columns:
            op.drop_column("chatrun", "parent_run_id")
        return

    # The SQLite upgrade used a table rebuild to install real constraints, so
    # downgrade must remove those constraints and columns in one rebuild too.
    if "uq_chatrun_parent_recovery_snapshot" in _indexes("chatrun"):
        op.drop_index("uq_chatrun_parent_recovery_snapshot", table_name="chatrun")
    for index_name in (
        "ix_chatrun_recovery_snapshot_sha256",
        "ix_chatrun_parent_run_id",
    ):
        if index_name in _indexes("chatrun"):
            op.drop_index(index_name, table_name="chatrun")
    foreign_keys = _foreign_key_columns("chatrun")
    unique_constraints = _unique_constraints("chatrun")
    check_constraints = _check_constraints("chatrun")
    columns = _columns("chatrun")
    with op.batch_alter_table("chatrun", recreate="always") as batch_op:
        if "ck_chatrun_recovery_identity" in check_constraints:
            batch_op.drop_constraint(
                "ck_chatrun_recovery_identity",
                type_="check",
            )
        if "uq_chatrun_parent_recovery_snapshot" in unique_constraints:
            batch_op.drop_constraint(
                "uq_chatrun_parent_recovery_snapshot",
                type_="unique",
            )
        if ("parent_run_id",) in foreign_keys:
            batch_op.drop_constraint(
                "fk_chatrun_parent_run_id_chatrun",
                type_="foreignkey",
            )
        if "recovery_snapshot_sha256" in columns:
            batch_op.drop_column("recovery_snapshot_sha256")
        if "parent_run_id" in columns:
            batch_op.drop_column("parent_run_id")
