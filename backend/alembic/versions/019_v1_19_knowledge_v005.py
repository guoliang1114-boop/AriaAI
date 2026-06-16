"""V1.19 - Knowledge v0.0.5 tables

Revision ID: 019_v1_19
Revises: 018_v1_18
Create Date: 2026-05-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

revision = "019_v1_19"
down_revision = "018_v1_18"
branch_labels = None
depends_on = None


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    inspector = inspect(op.get_bind())
    if table_name not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table_name)}


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if table_name in _tables() and index_name not in _indexes(table_name):
        op.create_index(index_name, table_name, columns)


def upgrade():
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"
    vector_enabled = False
    embedding_type = sa.Text()
    if is_postgres:
        vector_available = bind.execute(
            text("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'")
        ).scalar()
        if vector_available:
            bind.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            from pgvector.sqlalchemy import Vector

            embedding_type = Vector(1536)
            vector_enabled = True

    tables = _tables()
    if "knowledge_source" not in tables:
        op.create_table(
            "knowledge_source",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("source_type", sa.String(length=50), nullable=False),
            sa.Column("scope_type", sa.String(length=50), nullable=False),
            sa.Column("scope_id", sa.Integer(), nullable=True),
            sa.Column("owner_user_id", sa.Integer(), nullable=True),
            sa.Column("sync_mode", sa.String(length=50), nullable=True),
            sa.Column("include_patterns", sa.String(), nullable=False),
            sa.Column("exclude_patterns", sa.String(), nullable=False),
            sa.Column("tags", sa.String(), nullable=False),
            sa.Column("config_json", sa.String(), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "knowledge_document" not in tables:
        op.create_table(
            "knowledge_document",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=500), nullable=False),
            sa.Column("file_name", sa.String(length=500), nullable=False),
            sa.Column("file_type", sa.String(length=50), nullable=False),
            sa.Column("path", sa.String(length=1000), nullable=False),
            sa.Column("content_hash", sa.String(length=64), nullable=False),
            sa.Column("metadata_json", sa.String(), nullable=False),
            sa.Column("original_storage_key", sa.String(), nullable=False),
            sa.Column("extracted_text_storage_key", sa.String(), nullable=False),
            sa.Column("chunks_storage_key", sa.String(), nullable=False),
            sa.Column("preview_storage_key", sa.String(), nullable=False),
            sa.Column("file_size_bytes", sa.Integer(), nullable=False),
            sa.Column("page_count", sa.Integer(), nullable=False),
            sa.Column("slide_count", sa.Integer(), nullable=False),
            sa.Column("token_count", sa.Integer(), nullable=False),
            sa.Column("chunk_count", sa.Integer(), nullable=False),
            sa.Column("scope_type", sa.String(length=50), nullable=False),
            sa.Column("scope_id", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("error_message", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["source_id"], ["knowledge_source.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("source_id", "content_hash", name="uq_knowledge_document_source_hash"),
        )

    if "knowledge_chunk" not in tables:
        op.create_table(
            "knowledge_chunk",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("document_id", sa.Integer(), nullable=False),
            sa.Column("chunk_index", sa.Integer(), nullable=False),
            sa.Column("heading_path", sa.String(), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("token_count", sa.Integer(), nullable=False),
            sa.Column("embedding_model", sa.String(length=100), nullable=False),
            sa.Column("embedding", embedding_type, nullable=True),
            sa.Column("metadata_json", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["document_id"], ["knowledge_document.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "knowledge_case" not in tables:
        op.create_table(
            "knowledge_case",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=False),
            sa.Column("case_title", sa.String(length=500), nullable=False),
            sa.Column("industry", sa.String(length=100), nullable=True),
            sa.Column("service_line", sa.String(length=100), nullable=True),
            sa.Column("project_type", sa.String(length=100), nullable=True),
            sa.Column("client_stage", sa.String(length=50), nullable=True),
            sa.Column("business_problem", sa.Text(), nullable=True),
            sa.Column("solution_summary", sa.Text(), nullable=True),
            sa.Column("deliverables", sa.String(), nullable=False),
            sa.Column("methods_used", sa.String(), nullable=False),
            sa.Column("key_risks", sa.String(), nullable=False),
            sa.Column("lessons_learned", sa.String(), nullable=False),
            sa.Column("reusable_assets", sa.String(), nullable=False),
            sa.Column("source_document_ids", sa.String(), nullable=False),
            sa.Column("confidential_level", sa.String(length=50), nullable=True),
            sa.Column("anonymized", sa.Boolean(), nullable=False),
            sa.Column("scope_type", sa.String(length=50), nullable=False),
            sa.Column("scope_id", sa.Integer(), nullable=True),
            sa.Column("owner_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"]),
            sa.ForeignKeyConstraint(["source_id"], ["knowledge_source.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "knowledge_method" not in tables:
        op.create_table(
            "knowledge_method",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("source_id", sa.Integer(), nullable=False),
            sa.Column("method_title", sa.String(length=500), nullable=False),
            sa.Column("method_type", sa.String(length=100), nullable=True),
            sa.Column("industry", sa.String(length=100), nullable=True),
            sa.Column("service_line", sa.String(length=100), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("applicable_stages", sa.String(), nullable=False),
            sa.Column("key_components", sa.String(), nullable=False),
            sa.Column("source_document_ids", sa.String(), nullable=False),
            sa.Column("confidential_level", sa.String(length=50), nullable=True),
            sa.Column("scope_type", sa.String(length=50), nullable=False),
            sa.Column("scope_id", sa.Integer(), nullable=True),
            sa.Column("owner_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"]),
            sa.ForeignKeyConstraint(["source_id"], ["knowledge_source.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "knowledge_template" not in tables:
        op.create_table(
            "knowledge_template",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("key", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("supported_file_types", sa.String(), nullable=False),
            sa.Column("required_fields", sa.String(), nullable=False),
            sa.Column("optional_fields", sa.String(), nullable=False),
            sa.Column("extraction_schema_json", sa.String(), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key"),
        )

    if "knowledge_template_extraction" not in tables:
        op.create_table(
            "knowledge_template_extraction",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("document_id", sa.Integer(), nullable=False),
            sa.Column("template_key", sa.String(length=100), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("extracted_json", sa.String(), nullable=False),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("error_message", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["document_id"], ["knowledge_document.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "knowledge_document_event" not in tables:
        op.create_table(
            "knowledge_document_event",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("document_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.String(length=100), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=False),
            sa.Column("message", sa.Text(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=False),
            sa.Column("metadata_json", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["document_id"], ["knowledge_document.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    if "knowledge_job" not in tables:
        op.create_table(
            "knowledge_job",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("job_type", sa.String(length=100), nullable=False),
            sa.Column("status", sa.String(length=50), nullable=True),
            sa.Column("document_id", sa.Integer(), nullable=True),
            sa.Column("source_id", sa.Integer(), nullable=True),
            sa.Column("requested_by_user_id", sa.Integer(), nullable=True),
            sa.Column("payload_json", sa.String(), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("attempt", sa.Integer(), nullable=False),
            sa.Column("max_attempts", sa.Integer(), nullable=False),
            sa.Column("trace_id", sa.String(length=100), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["document_id"], ["knowledge_document.id"]),
            sa.ForeignKeyConstraint(["source_id"], ["knowledge_source.id"]),
            sa.ForeignKeyConstraint(["requested_by_user_id"], ["user.id"]),
            sa.PrimaryKeyConstraint("id"),
        )

    for table, columns in {
        "knowledge_source": ["scope_id", "owner_user_id"],
        "knowledge_document": ["source_id", "content_hash", "scope_id"],
        "knowledge_chunk": ["document_id"],
        "knowledge_case": ["source_id", "scope_id", "owner_user_id"],
        "knowledge_method": ["source_id", "scope_id", "owner_user_id"],
        "knowledge_template_extraction": ["document_id", "template_key"],
        "knowledge_document_event": ["document_id", "event_type"],
        "knowledge_job": ["job_type", "status", "document_id", "source_id", "requested_by_user_id", "trace_id"],
    }.items():
        for column in columns:
            _create_index_if_missing(f"ix_{table}_{column}", table, [column])

    if vector_enabled and "knowledge_chunk" in _tables():
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_knowledge_chunk_embedding_hnsw "
            "ON knowledge_chunk USING hnsw (embedding vector_cosine_ops)"
        )


def downgrade():
    for table in [
        "knowledge_job",
        "knowledge_document_event",
        "knowledge_template_extraction",
        "knowledge_template",
        "knowledge_method",
        "knowledge_case",
        "knowledge_chunk",
        "knowledge_document",
        "knowledge_source",
    ]:
        if table in _tables():
            op.drop_table(table)
