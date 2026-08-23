"""V1.28 - Controlled legacy knowledge migration

Revision ID: 028_v1_28
Revises: 027_v1_27
Create Date: 2026-08-24
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "028_v1_28"
down_revision = "027_v1_27"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        column["name"]
        for column in inspect(op.get_bind()).get_columns(table_name)
    }


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        index["name"]
        for index in inspect(op.get_bind()).get_indexes(table_name)
    }


def upgrade() -> None:
    if "knowledge_legacy_migration" not in _tables():
        op.create_table(
            "knowledge_legacy_migration",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("legacy_document_id", sa.Integer(), nullable=False),
            sa.Column("document_id", sa.Integer(), nullable=True),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("job_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=False),
            sa.Column("scope_type", sa.String(length=50), nullable=False),
            sa.Column("scope_id", sa.Integer(), nullable=True),
            sa.Column("content_hash", sa.String(length=64), nullable=False),
            sa.Column("created_document", sa.Boolean(), nullable=False),
            sa.Column("error_code", sa.String(length=100), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["document_id"], ["knowledge_document.id"]),
            sa.ForeignKeyConstraint(["job_id"], ["knowledge_job.id"]),
            sa.ForeignKeyConstraint(["source_id"], ["knowledge_source.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "legacy_document_id",
                name="uq_knowledge_legacy_migration_legacy_document",
            ),
        )

    indexes = _indexes("knowledge_legacy_migration")
    for name, columns in {
        "ix_knowledge_legacy_migration_document_id": ["document_id"],
        "ix_knowledge_legacy_migration_job_id": ["job_id"],
        "ix_knowledge_legacy_migration_legacy_document_id": ["legacy_document_id"],
        "ix_knowledge_legacy_migration_scope_id": ["scope_id"],
        "ix_knowledge_legacy_migration_source_id": ["source_id"],
        "ix_knowledge_legacy_migration_status": ["status"],
    }.items():
        if name not in indexes:
            op.create_index(name, "knowledge_legacy_migration", columns)

    if (
        "knowledge_source" in _tables()
        and "external_key" not in _columns("knowledge_source")
    ):
        # The server default safely backfills existing sources. The model also
        # writes an explicit empty string for ordinary user-created sources.
        op.add_column(
            "knowledge_source",
            sa.Column(
                "external_key",
                sa.String(length=255),
                nullable=False,
                server_default="",
            ),
        )
    if (
        "knowledge_source" in _tables()
        and "uq_knowledge_source_external_key"
        not in _indexes("knowledge_source")
    ):
        non_empty_filter = sa.text("external_key <> ''")
        op.create_index(
            "uq_knowledge_source_external_key",
            "knowledge_source",
            ["external_key"],
            unique=True,
            postgresql_where=non_empty_filter,
            sqlite_where=non_empty_filter,
        )
    if (
        "knowledge_job" in _tables()
        and "uq_knowledge_job_active_legacy_migration"
        not in _indexes("knowledge_job")
    ):
        active_migration_filter = sa.text(
            "job_type = 'migrate_legacy_knowledge' "
            "AND status IN ('queued', 'running', 'retrying')"
        )
        op.create_index(
            "uq_knowledge_job_active_legacy_migration",
            "knowledge_job",
            ["job_type"],
            unique=True,
            postgresql_where=active_migration_filter,
            sqlite_where=active_migration_filter,
        )


def downgrade() -> None:
    if (
        "knowledge_job" in _tables()
        and "uq_knowledge_job_active_legacy_migration"
        in _indexes("knowledge_job")
    ):
        op.drop_index(
            "uq_knowledge_job_active_legacy_migration",
            table_name="knowledge_job",
        )
    if "knowledge_legacy_migration" in _tables():
        op.drop_table("knowledge_legacy_migration")
    if "knowledge_source" in _tables():
        if "uq_knowledge_source_external_key" in _indexes("knowledge_source"):
            op.drop_index(
                "uq_knowledge_source_external_key",
                table_name="knowledge_source",
            )
        if "external_key" in _columns("knowledge_source"):
            op.drop_column("knowledge_source", "external_key")
