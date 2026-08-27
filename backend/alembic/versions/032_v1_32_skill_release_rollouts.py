"""V1.32 - Immutable Skill releases and deterministic rollout governance.

Revision ID: 032_v1_32
Revises: 031_v1_31
Create Date: 2026-08-27
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "032_v1_32"
down_revision = "031_v1_31"
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


def _foreign_key_columns(table_name: str) -> set[tuple[str, ...]]:
    if table_name not in _tables():
        return set()
    return {
        tuple(foreign_key.get("constrained_columns") or ())
        for foreign_key in inspect(op.get_bind()).get_foreign_keys(table_name)
    }


def _release_sha256(row: dict[str, object]) -> str:
    current = str(row.get("package_sha256") or "").strip().lower()
    if len(current) == 64 and all(char in "0123456789abcdef" for char in current):
        return current
    payload = {
        "name": row.get("name") or "",
        "category": row.get("category") or "",
        "description": row.get("description") or "",
        "system_prompt": row.get("system_prompt") or "",
        "user_template": row.get("user_template") or "",
        "estimated_time": row.get("estimated_time") or "",
        "max_tokens": int(row.get("max_tokens") or 0),
        "tools_definition_json": row.get("tools_definition_json") or "[]",
        "tools_json": row.get("tools_json") or "[]",
        "package_version": row.get("package_version") or "",
        "package_status": row.get("package_status") or "",
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _create_release_table() -> None:
    op.create_table(
        "skillrelease",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("skill_id", sa.Integer(), nullable=True),
        sa.Column("skill_name", sa.String(), nullable=False, server_default=""),
        sa.Column("name", sa.String(), nullable=False, server_default=""),
        sa.Column("category", sa.String(), nullable=False, server_default=""),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("system_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("user_template", sa.Text(), nullable=False, server_default=""),
        sa.Column("estimated_time", sa.String(), nullable=False, server_default=""),
        sa.Column("max_tokens", sa.Integer(), nullable=False, server_default="4096"),
        sa.Column("tools_definition_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("tools_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("package_version", sa.String(), nullable=False, server_default="1.0.0"),
        sa.Column("package_status", sa.String(), nullable=False, server_default="stable"),
        sa.Column("package_sha256", sa.String(), nullable=False, server_default=""),
        sa.Column("source", sa.String(), nullable=False, server_default="migration"),
        sa.Column("rollback_of_release_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["skill_id"], ["skill.id"]),
        sa.ForeignKeyConstraint(["rollback_of_release_id"], ["skillrelease.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("skill_id", "package_sha256", name="uq_skillrelease_skill_sha256"),
    )
    for name, columns in (
        ("ix_skillrelease_skill_id", ["skill_id"]),
        ("ix_skillrelease_skill_name", ["skill_name"]),
        ("ix_skillrelease_package_version", ["package_version"]),
        ("ix_skillrelease_package_status", ["package_status"]),
        ("ix_skillrelease_package_sha256", ["package_sha256"]),
        ("ix_skillrelease_source", ["source"]),
        ("ix_skillrelease_created_by_user_id", ["created_by_user_id"]),
        ("ix_skillrelease_created_at", ["created_at"]),
    ):
        op.create_index(name, "skillrelease", columns)


def _create_rollout_table() -> None:
    op.create_table(
        "skillrollout",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("skill_id", sa.Integer(), nullable=True),
        sa.Column("baseline_release_id", sa.Integer(), nullable=False),
        sa.Column("candidate_release_id", sa.Integer(), nullable=False),
        sa.Column("percentage", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("min_sample_size", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("max_failure_rate", sa.Float(), nullable=False, server_default="0.25"),
        sa.Column("auto_stop", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("stop_reason", sa.String(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("stopped_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["skill_id"], ["skill.id"]),
        sa.ForeignKeyConstraint(["baseline_release_id"], ["skillrelease.id"]),
        sa.ForeignKeyConstraint(["candidate_release_id"], ["skillrelease.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_skillrollout_skill_id", ["skill_id"]),
        ("ix_skillrollout_baseline_release_id", ["baseline_release_id"]),
        ("ix_skillrollout_candidate_release_id", ["candidate_release_id"]),
        ("ix_skillrollout_status", ["status"]),
        ("ix_skillrollout_created_by_user_id", ["created_by_user_id"]),
        ("ix_skillrollout_created_at", ["created_at"]),
        ("ix_skillrollout_updated_at", ["updated_at"]),
        ("ix_skillrollout_stopped_at", ["stopped_at"]),
    ):
        op.create_index(name, "skillrollout", columns)
    op.create_index(
        "uq_skillrollout_one_open_per_skill",
        "skillrollout",
        ["skill_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('active', 'paused')"),
        sqlite_where=sa.text("status IN ('active', 'paused')"),
    )


def _backfill_current_releases() -> None:
    if "skill" not in _tables() or "skillrelease" not in _tables():
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT * FROM skill ORDER BY id")).mappings().all()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    release_table = sa.table(
        "skillrelease",
        sa.column("id", sa.Integer()),
        sa.column("skill_id", sa.Integer()),
        sa.column("skill_name", sa.String()),
        sa.column("name", sa.String()),
        sa.column("category", sa.String()),
        sa.column("description", sa.String()),
        sa.column("system_prompt", sa.Text()),
        sa.column("user_template", sa.Text()),
        sa.column("estimated_time", sa.String()),
        sa.column("max_tokens", sa.Integer()),
        sa.column("tools_definition_json", sa.Text()),
        sa.column("tools_json", sa.Text()),
        sa.column("package_version", sa.String()),
        sa.column("package_status", sa.String()),
        sa.column("package_sha256", sa.String()),
        sa.column("source", sa.String()),
        sa.column("created_at", sa.DateTime()),
    )
    for raw_row in rows:
        row = dict(raw_row)
        digest = _release_sha256(row)
        existing_id = bind.execute(
            sa.text(
                "SELECT id FROM skillrelease "
                "WHERE skill_id = :skill_id AND package_sha256 = :digest"
            ),
            {"skill_id": row["id"], "digest": digest},
        ).scalar()
        release_id = existing_id
        if release_id is None:
            bind.execute(
                release_table.insert().values(
                    skill_id=row["id"],
                    skill_name=row.get("name") or "",
                    name=row.get("name") or "",
                    category=row.get("category") or "",
                    description=row.get("description") or "",
                    system_prompt=row.get("system_prompt") or "",
                    user_template=row.get("user_template") or "",
                    estimated_time=row.get("estimated_time") or "",
                    max_tokens=int(row.get("max_tokens") or 0),
                    tools_definition_json=row.get("tools_definition_json") or "[]",
                    tools_json=row.get("tools_json") or "[]",
                    package_version=row.get("package_version") or "1.0.0",
                    package_status=row.get("package_status") or "stable",
                    package_sha256=digest,
                    source="migration",
                    created_at=now,
                )
            )
            release_id = bind.execute(
                sa.text(
                    "SELECT id FROM skillrelease "
                    "WHERE skill_id = :skill_id AND package_sha256 = :digest"
                ),
                {"skill_id": row["id"], "digest": digest},
            ).scalar_one()
        bind.execute(
            sa.text(
                "UPDATE skill SET package_sha256 = :digest, active_release_id = :release_id "
                "WHERE id = :skill_id AND active_release_id IS NULL"
            ),
            {"digest": digest, "release_id": release_id, "skill_id": row["id"]},
        )


def upgrade() -> None:
    if "skill" in _tables():
        if "active_release_id" not in _columns("skill"):
            op.add_column("skill", sa.Column("active_release_id", sa.Integer(), nullable=True))
        if "ix_skill_active_release_id" not in _indexes("skill"):
            op.create_index("ix_skill_active_release_id", "skill", ["active_release_id"])

    if "skillrelease" not in _tables():
        _create_release_table()
    _backfill_current_releases()

    if "skillrollout" not in _tables():
        _create_rollout_table()
    elif "uq_skillrollout_one_open_per_skill" not in _indexes("skillrollout"):
        op.create_index(
            "uq_skillrollout_one_open_per_skill",
            "skillrollout",
            ["skill_id"],
            unique=True,
            postgresql_where=sa.text("status IN ('active', 'paused')"),
            sqlite_where=sa.text("status IN ('active', 'paused')"),
        )

    if "chatrun" in _tables():
        run_columns = _columns("chatrun")
        definitions = {
            "skill_release_id": sa.Column("skill_release_id", sa.Integer(), nullable=True),
            "skill_rollout_id": sa.Column("skill_rollout_id", sa.Integer(), nullable=True),
            "skill_rollout_variant": sa.Column(
                "skill_rollout_variant", sa.String(), nullable=False, server_default=""
            ),
            "skill_rollout_bucket": sa.Column("skill_rollout_bucket", sa.Integer(), nullable=True),
        }
        for name, column in definitions.items():
            if name not in run_columns:
                op.add_column("chatrun", column)
        for name, columns in (
            ("ix_chatrun_skill_release_id", ["skill_release_id"]),
            ("ix_chatrun_skill_rollout_id", ["skill_rollout_id"]),
            ("ix_chatrun_skill_rollout_variant", ["skill_rollout_variant"]),
        ):
            if name not in _indexes("chatrun"):
                op.create_index(name, "chatrun", columns)
        if op.get_bind().dialect.name != "sqlite":
            foreign_keys = _foreign_key_columns("chatrun")
            if ("skill_release_id",) not in foreign_keys:
                op.create_foreign_key(
                    "fk_chatrun_skill_release_id_skillrelease",
                    "chatrun",
                    "skillrelease",
                    ["skill_release_id"],
                    ["id"],
                )
            if ("skill_rollout_id",) not in foreign_keys:
                op.create_foreign_key(
                    "fk_chatrun_skill_rollout_id_skillrollout",
                    "chatrun",
                    "skillrollout",
                    ["skill_rollout_id"],
                    ["id"],
                )


def downgrade() -> None:
    if "chatrun" in _tables():
        if op.get_bind().dialect.name != "sqlite":
            for name in (
                "fk_chatrun_skill_rollout_id_skillrollout",
                "fk_chatrun_skill_release_id_skillrelease",
            ):
                op.drop_constraint(name, "chatrun", type_="foreignkey")
        for name in (
            "ix_chatrun_skill_rollout_variant",
            "ix_chatrun_skill_rollout_id",
            "ix_chatrun_skill_release_id",
        ):
            if name in _indexes("chatrun"):
                op.drop_index(name, table_name="chatrun")
        for name in (
            "skill_rollout_bucket",
            "skill_rollout_variant",
            "skill_rollout_id",
            "skill_release_id",
        ):
            if name in _columns("chatrun"):
                op.drop_column("chatrun", name)

    if "skillrollout" in _tables():
        op.drop_table("skillrollout")
    if "skill" in _tables():
        if "ix_skill_active_release_id" in _indexes("skill"):
            op.drop_index("ix_skill_active_release_id", table_name="skill")
        if "active_release_id" in _columns("skill"):
            op.drop_column("skill", "active_release_id")
    if "skillrelease" in _tables():
        op.drop_table("skillrelease")
