from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Column, String, Text, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.services.time_utils import utc_now_naive

_ENABLE_NATIVE_PGVECTOR = os.getenv("ARIA_ENABLE_PGVECTOR", "").lower() in {"1", "true", "yes"}

try:  # pragma: no cover - exercised only when native pgvector is enabled.
    from pgvector.sqlalchemy import Vector

    _EMBEDDING_COLUMN = Column(Vector(1536), nullable=True) if _ENABLE_NATIVE_PGVECTOR else Column(Text, nullable=True)
except Exception:  # pragma: no cover - keeps local/test envs importable.
    _EMBEDDING_COLUMN = Column(Text, nullable=True)


class KnowledgeSource(SQLModel, table=True):
    __tablename__ = "knowledge_source"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(sa_column=Column(String(255), nullable=False))
    source_type: str = Field(sa_column=Column(String(50), nullable=False))
    scope_type: str = Field(sa_column=Column(String(50), nullable=False))
    scope_id: Optional[int] = Field(default=None, index=True)
    owner_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    sync_mode: str = Field(default="manual", sa_column=Column(String(50)))
    include_patterns: str = Field(default="**/*.pptx,**/*.pdf,**/*.docx,**/*.md")
    exclude_patterns: str = Field(default=".obsidian/**,node_modules/**")
    tags: str = Field(default="")
    config_json: str = Field(default="{}")
    status: str = Field(default="active", sa_column=Column(String(50)))
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeV1Document(SQLModel, table=True):
    __tablename__ = "knowledge_document"

    __table_args__ = (
        UniqueConstraint("source_id", "content_hash", name="uq_knowledge_document_source_hash"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="knowledge_source.id", nullable=False, index=True)
    title: str = Field(sa_column=Column(String(500), nullable=False))
    file_name: str = Field(sa_column=Column(String(500), nullable=False))
    file_type: str = Field(sa_column=Column(String(50), nullable=False))
    path: str = Field(sa_column=Column(String(1000), nullable=False))
    content_hash: str = Field(sa_column=Column(String(64), nullable=False, index=True))
    metadata_json: str = Field(default="{}")
    original_storage_key: str = Field(default="")
    extracted_text_storage_key: str = Field(default="")
    chunks_storage_key: str = Field(default="")
    preview_storage_key: str = Field(default="")
    file_size_bytes: int = Field(default=0)
    page_count: int = Field(default=0)
    slide_count: int = Field(default=0)
    token_count: int = Field(default=0)
    chunk_count: int = Field(default=0)
    scope_type: str = Field(sa_column=Column(String(50), nullable=False))
    scope_id: Optional[int] = Field(default=None, index=True)
    status: str = Field(default="uploaded", sa_column=Column(String(50)))
    error_message: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeChunk(SQLModel, table=True):
    __tablename__ = "knowledge_chunk"

    id: Optional[int] = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="knowledge_document.id", nullable=False, index=True)
    chunk_index: int = Field(nullable=False)
    heading_path: str = Field(default="[]")
    content: str = Field(sa_column=Column(Text, nullable=False))
    token_count: int = Field(default=0)
    embedding_model: str = Field(sa_column=Column(String(100), nullable=False))
    embedding: Any = Field(default=None, sa_column=_EMBEDDING_COLUMN)
    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeCase(SQLModel, table=True):
    __tablename__ = "knowledge_case"

    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="knowledge_source.id", nullable=False, index=True)
    case_title: str = Field(sa_column=Column(String(500), nullable=False))
    industry: str = Field(default="", sa_column=Column(String(100)))
    service_line: str = Field(default="", sa_column=Column(String(100)))
    project_type: str = Field(default="", sa_column=Column(String(100)))
    client_stage: str = Field(default="", sa_column=Column(String(50)))
    business_problem: str = Field(default="", sa_column=Column(Text))
    solution_summary: str = Field(default="", sa_column=Column(Text))
    deliverables: str = Field(default="[]")
    methods_used: str = Field(default="[]")
    key_risks: str = Field(default="[]")
    lessons_learned: str = Field(default="[]")
    reusable_assets: str = Field(default="[]")
    source_document_ids: str = Field(default="[]")
    confidential_level: str = Field(default="public_internal", sa_column=Column(String(50)))
    anonymized: bool = Field(default=False)
    scope_type: str = Field(sa_column=Column(String(50), nullable=False))
    scope_id: Optional[int] = Field(default=None, index=True)
    owner_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeMethod(SQLModel, table=True):
    __tablename__ = "knowledge_method"

    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="knowledge_source.id", nullable=False, index=True)
    method_title: str = Field(sa_column=Column(String(500), nullable=False))
    method_type: str = Field(default="", sa_column=Column(String(100)))
    industry: str = Field(default="", sa_column=Column(String(100)))
    service_line: str = Field(default="", sa_column=Column(String(100)))
    description: str = Field(default="", sa_column=Column(Text))
    applicable_stages: str = Field(default="[]")
    key_components: str = Field(default="[]")
    source_document_ids: str = Field(default="[]")
    confidential_level: str = Field(default="public_internal", sa_column=Column(String(50)))
    scope_type: str = Field(sa_column=Column(String(50), nullable=False))
    scope_id: Optional[int] = Field(default=None, index=True)
    owner_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeTemplate(SQLModel, table=True):
    __tablename__ = "knowledge_template"

    id: Optional[int] = Field(default=None, primary_key=True)
    key: str = Field(sa_column=Column(String(100), nullable=False, unique=True))
    name: str = Field(sa_column=Column(String(255), nullable=False))
    description: str = Field(default="", sa_column=Column(Text))
    supported_file_types: str = Field(default="[]")
    required_fields: str = Field(default="[]")
    optional_fields: str = Field(default="[]")
    extraction_schema_json: str = Field(default="{}")
    status: str = Field(default="active", sa_column=Column(String(50)))
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeTemplateExtraction(SQLModel, table=True):
    __tablename__ = "knowledge_template_extraction"

    id: Optional[int] = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="knowledge_document.id", nullable=False, index=True)
    template_key: str = Field(sa_column=Column(String(100), nullable=False, index=True))
    status: str = Field(default="queued", sa_column=Column(String(50)))
    extracted_json: str = Field(default="{}")
    confidence: float = Field(default=0.0)
    error_message: Optional[str] = Field(default=None)
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeDocumentEvent(SQLModel, table=True):
    __tablename__ = "knowledge_document_event"

    id: Optional[int] = Field(default=None, primary_key=True)
    document_id: int = Field(foreign_key="knowledge_document.id", nullable=False, index=True)
    event_type: str = Field(sa_column=Column(String(100), nullable=False, index=True))
    status: str = Field(sa_column=Column(String(50), nullable=False))
    message: str = Field(default="", sa_column=Column(Text))
    duration_ms: int = Field(default=0)
    metadata_json: str = Field(default="{}")
    created_at: datetime = Field(default_factory=utc_now_naive)


class KnowledgeJob(SQLModel, table=True):
    __tablename__ = "knowledge_job"

    id: Optional[int] = Field(default=None, primary_key=True)
    job_type: str = Field(sa_column=Column(String(100), nullable=False, index=True))
    status: str = Field(default="queued", sa_column=Column(String(50), index=True))
    document_id: Optional[int] = Field(default=None, foreign_key="knowledge_document.id", index=True)
    source_id: Optional[int] = Field(default=None, foreign_key="knowledge_source.id", index=True)
    requested_by_user_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    payload_json: str = Field(default="{}")
    checkpoint_json: str = Field(default="{}", sa_column=Column(Text, nullable=False))
    error_message: str = Field(default="", sa_column=Column(Text))
    failure_code: str = Field(default="", sa_column=Column(String(100), nullable=False))
    retryable: bool = Field(default=False)
    attempt: int = Field(default=0)
    max_attempts: int = Field(default=3)
    trace_id: str = Field(default="", sa_column=Column(String(100), index=True))
    idempotency_key: str = Field(default="", sa_column=Column(String(64), nullable=False))
    lease_token: str = Field(default="", sa_column=Column(String(64), nullable=False))
    created_at: datetime = Field(default_factory=utc_now_naive)
    updated_at: datetime = Field(default_factory=utc_now_naive)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    next_attempt_at: Optional[datetime] = None
    lease_expires_at: Optional[datetime] = None
    last_heartbeat_at: Optional[datetime] = None
