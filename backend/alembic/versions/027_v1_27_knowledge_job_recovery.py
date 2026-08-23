"""V1.27 - Durable knowledge ingestion recovery

Revision ID: 027_v1_27
Revises: 026_v1_26
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "027_v1_27"
down_revision = "026_v1_26"
branch_labels = None
depends_on = None


def _columns() -> set[str]:
    inspector = inspect(op.get_bind())
    if "knowledge_job" not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns("knowledge_job")}


def _indexes() -> set[str]:
    inspector = inspect(op.get_bind())
    if "knowledge_job" not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes("knowledge_job")}


def _add_column_if_missing(column: sa.Column) -> None:
    if "knowledge_job" in inspect(op.get_bind()).get_table_names() and column.name not in _columns():
        op.add_column("knowledge_job", column)


def upgrade() -> None:
    _add_column_if_missing(
        sa.Column("checkpoint_json", sa.Text(), nullable=False, server_default="{}")
    )
    _add_column_if_missing(
        sa.Column("failure_code", sa.String(length=100), nullable=False, server_default="")
    )
    _add_column_if_missing(
        sa.Column("retryable", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    _add_column_if_missing(
        sa.Column("idempotency_key", sa.String(length=64), nullable=False, server_default="")
    )
    _add_column_if_missing(
        sa.Column("lease_token", sa.String(length=64), nullable=False, server_default="")
    )
    _add_column_if_missing(sa.Column("next_attempt_at", sa.DateTime(), nullable=True))
    _add_column_if_missing(sa.Column("lease_expires_at", sa.DateTime(), nullable=True))
    _add_column_if_missing(sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True))

    indexes = _indexes()
    for name, columns in {
        "ix_knowledge_job_idempotency_key": ["idempotency_key"],
        "ix_knowledge_job_next_attempt_at": ["next_attempt_at"],
        "ix_knowledge_job_lease_expires_at": ["lease_expires_at"],
    }.items():
        if name not in indexes:
            op.create_index(name, "knowledge_job", columns)

    # Historical code did not enforce one active worker per document. Preserve
    # the oldest active row and close only duplicate queue records before adding
    # the partial unique index.
    op.execute(
        sa.text(
            "UPDATE knowledge_job SET status = 'cancelled', "
            "failure_code = 'duplicate_active_job', retryable = false, "
            "error_message = 'Superseded by the earliest active ingestion job.', "
            "completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) "
            "WHERE id IN ("
            "SELECT id FROM ("
            "SELECT id, ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY created_at, id) AS row_num "
            "FROM knowledge_job WHERE document_id IS NOT NULL "
            "AND status IN ('queued', 'running', 'retrying')"
            ") ranked WHERE row_num > 1"
            ")"
        )
    )

    if "uq_knowledge_job_active_idempotency" not in _indexes():
        active_filter = sa.text(
            "idempotency_key <> '' AND status IN ('queued', 'running', 'retrying')"
        )
        op.create_index(
            "uq_knowledge_job_active_idempotency",
            "knowledge_job",
            ["idempotency_key"],
            unique=True,
            postgresql_where=active_filter,
            sqlite_where=active_filter,
        )
    if "uq_knowledge_job_active_document" not in _indexes():
        active_document_filter = sa.text(
            "document_id IS NOT NULL AND status IN ('queued', 'running', 'retrying')"
        )
        op.create_index(
            "uq_knowledge_job_active_document",
            "knowledge_job",
            ["document_id"],
            unique=True,
            postgresql_where=active_document_filter,
            sqlite_where=active_document_filter,
        )


def downgrade() -> None:
    indexes = _indexes()
    for name in (
        "uq_knowledge_job_active_document",
        "uq_knowledge_job_active_idempotency",
        "ix_knowledge_job_lease_expires_at",
        "ix_knowledge_job_next_attempt_at",
        "ix_knowledge_job_idempotency_key",
    ):
        if name in indexes:
            op.drop_index(name, table_name="knowledge_job")
    for name in (
        "last_heartbeat_at",
        "lease_expires_at",
        "next_attempt_at",
        "lease_token",
        "idempotency_key",
        "retryable",
        "failure_code",
        "checkpoint_json",
    ):
        if name in _columns():
            op.drop_column("knowledge_job", name)
