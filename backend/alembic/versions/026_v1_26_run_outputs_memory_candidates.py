"""V1.26 - Verified run outputs and memory candidate review.

Adds source/run/digest facts to generated files and introduces the additive
``memorycandidate`` sidecar table. Existing project/client/user memory remains
authoritative until a pending candidate is explicitly accepted.

Revision ID: 026_v1_26
Revises: 025_v1_25
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "026_v1_26"
down_revision = "025_v1_25"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _add_generated_file_columns() -> None:
    if "generatedfile" not in _tables():
        return
    columns = _columns("generatedfile")
    additions = {
        "run_id": sa.Column("run_id", sa.String(), nullable=False, server_default=""),
        "output_id": sa.Column("output_id", sa.String(), nullable=False, server_default=""),
        "source_tool": sa.Column("source_tool", sa.String(), nullable=False, server_default=""),
        "content_sha256": sa.Column("content_sha256", sa.String(), nullable=False, server_default=""),
        "output_record_version": sa.Column(
            "output_record_version", sa.Integer(), nullable=False, server_default="1"
        ),
    }
    for name, column in additions.items():
        if name not in columns:
            op.add_column("generatedfile", column)
    indexes = _indexes("generatedfile")
    for name, columns_list in (
        ("ix_generatedfile_run_id", ["run_id"]),
        ("ix_generatedfile_output_id", ["output_id"]),
        ("ix_generatedfile_content_sha256", ["content_sha256"]),
    ):
        if name not in indexes:
            op.create_index(name, "generatedfile", columns_list)


def _create_memory_candidates() -> None:
    if "memorycandidate" not in _tables():
        op.create_table(
            "memorycandidate",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("owner_user_id", sa.Integer(), nullable=False),
            sa.Column("scope", sa.String(), nullable=False),
            sa.Column("candidate_type", sa.String(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("content_sha256", sa.String(), nullable=False),
            sa.Column("source_type", sa.String(), nullable=False, server_default="manual"),
            sa.Column("source_id", sa.String(), nullable=False, server_default=""),
            sa.Column("source_run_id", sa.String(), nullable=False, server_default=""),
            sa.Column("source_refs_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("project_id", sa.Integer(), nullable=True),
            sa.Column("client_id", sa.Integer(), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="1"),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("created_by", sa.String(), nullable=False, server_default="user"),
            sa.Column("target_slot", sa.String(), nullable=False, server_default=""),
            sa.Column("applied_memory_version", sa.Integer(), nullable=True),
            sa.Column("resolved_by_user_id", sa.Integer(), nullable=True),
            sa.Column("decision_note", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"]),
            sa.ForeignKeyConstraint(["resolved_by_user_id"], ["user.id"]),
            sa.ForeignKeyConstraint(["project_id"], ["project.id"]),
            sa.ForeignKeyConstraint(["client_id"], ["clientrecord.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    indexes = _indexes("memorycandidate")
    index_specs = (
        ("ix_memorycandidate_owner_user_id", ["owner_user_id"], False),
        ("ix_memorycandidate_scope", ["scope"], False),
        ("ix_memorycandidate_candidate_type", ["candidate_type"], False),
        ("ix_memorycandidate_content_sha256", ["content_sha256"], False),
        ("ix_memorycandidate_source_type", ["source_type"], False),
        ("ix_memorycandidate_source_id", ["source_id"], False),
        ("ix_memorycandidate_source_run_id", ["source_run_id"], False),
        ("ix_memorycandidate_project_id", ["project_id"], False),
        ("ix_memorycandidate_client_id", ["client_id"], False),
        ("ix_memorycandidate_status", ["status"], False),
        ("ix_memorycandidate_resolved_by_user_id", ["resolved_by_user_id"], False),
        ("ix_memorycandidate_created_at", ["created_at"], False),
        (
            "uq_memorycandidate_owner_source_digest",
            [
                "owner_user_id",
                "scope",
                "candidate_type",
                "source_type",
                "source_id",
                "content_sha256",
            ],
            True,
        ),
    )
    for name, columns, unique in index_specs:
        if name not in indexes:
            op.create_index(name, "memorycandidate", columns, unique=unique)


def upgrade():
    _add_generated_file_columns()
    _create_memory_candidates()


def downgrade():
    if "memorycandidate" in _tables():
        op.drop_table("memorycandidate")
    if "generatedfile" not in _tables():
        return
    columns = _columns("generatedfile")
    indexes = _indexes("generatedfile")
    for name in (
        "ix_generatedfile_content_sha256",
        "ix_generatedfile_output_id",
        "ix_generatedfile_run_id",
    ):
        if name in indexes:
            op.drop_index(name, table_name="generatedfile")
    for column in (
        "output_record_version",
        "content_sha256",
        "source_tool",
        "output_id",
        "run_id",
    ):
        if column in columns:
            op.drop_column("generatedfile", column)
