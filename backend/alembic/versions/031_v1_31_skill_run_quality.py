"""V1.31 - Versioned Skill releases and content-free Run quality snapshots.

Existing Skill release hashes are populated from the exact published DB
contract during the normal startup Skill sync. Historical ChatRun rows remain
unversioned by design because their former release identity cannot be proven.

Revision ID: 031_v1_31
Revises: 030_v1_30
Create Date: 2026-08-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "031_v1_31"
down_revision = "030_v1_30"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {column["name"] for column in inspect(op.get_bind()).get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {index["name"] for index in inspect(op.get_bind()).get_indexes(table_name)}


def upgrade() -> None:
    if "skill" in _tables():
        skill_columns = _columns("skill")
        if "package_version" not in skill_columns:
            op.add_column(
                "skill",
                sa.Column("package_version", sa.String(), nullable=False, server_default="1.0.0"),
            )
        if "package_status" not in skill_columns:
            op.add_column(
                "skill",
                sa.Column("package_status", sa.String(), nullable=False, server_default="stable"),
            )
        if "package_sha256" not in skill_columns:
            op.add_column(
                "skill",
                sa.Column("package_sha256", sa.String(), nullable=False, server_default=""),
            )

    if "chatrun" in _tables():
        run_columns = _columns("chatrun")
        for name in (
            "skill_version",
            "skill_release_status",
            "skill_release_sha256",
            "skill_activation_source",
        ):
            if name not in run_columns:
                op.add_column(
                    "chatrun",
                    sa.Column(name, sa.String(), nullable=False, server_default=""),
                )
        if "ix_chatrun_skill_activation_source" not in _indexes("chatrun"):
            op.create_index(
                "ix_chatrun_skill_activation_source",
                "chatrun",
                ["skill_activation_source"],
            )


def downgrade() -> None:
    if "chatrun" in _tables():
        if "ix_chatrun_skill_activation_source" in _indexes("chatrun"):
            op.drop_index("ix_chatrun_skill_activation_source", table_name="chatrun")
        run_columns = _columns("chatrun")
        for name in (
            "skill_activation_source",
            "skill_release_sha256",
            "skill_release_status",
            "skill_version",
        ):
            if name in run_columns:
                op.drop_column("chatrun", name)

    if "skill" in _tables():
        skill_columns = _columns("skill")
        for name in ("package_sha256", "package_status", "package_version"):
            if name in skill_columns:
                op.drop_column("skill", name)
