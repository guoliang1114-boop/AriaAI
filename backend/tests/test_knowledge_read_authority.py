from __future__ import annotations

import json

from sqlmodel import SQLModel, Session

from app.models.db import DocumentChunk, KnowledgeDocument
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeLegacyMigration,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.services.knowledge_ingestion import deterministic_embedding, sha256_bytes
from app.services.knowledge_read_authority import build_knowledge_read_authority_report
from tests.test_database import create_test_engine, drop_all_tables


def test_knowledge_authority_report_tracks_verified_cutover_without_content() -> None:
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            empty = build_knowledge_read_authority_report(session)
            assert empty["source_scoped_cutover_ready"] is True

            legacy = KnowledgeDocument(
                name="private legacy name",
                file_type="md",
                path="private/legacy.md",
                vector_status="synced",
            )
            session.add(legacy)
            session.flush()
            session.add(
                DocumentChunk(
                    document_id=legacy.id,
                    chunk_index=0,
                    content="private legacy content",
                    embedding_json="[1.0]",
                )
            )
            session.commit()

            unmapped = build_knowledge_read_authority_report(session)
            assert unmapped["source_scoped_cutover_ready"] is False
            assert unmapped["unmapped_legacy_document_count"] == 1

            source = KnowledgeSource(
                name="private source name",
                source_type="manual_upload",
                scope_type="workspace",
                status="active",
            )
            session.add(source)
            session.flush()
            content = "private source-scoped content"
            document = KnowledgeV1Document(
                source_id=source.id,
                title="private document title",
                file_name="private.md",
                file_type="md",
                path="private/new.md",
                content_hash=sha256_bytes(content.encode("utf-8")),
                scope_type="workspace",
                status="indexed",
            )
            session.add(document)
            session.flush()
            session.add(
                KnowledgeChunk(
                    document_id=document.id,
                    chunk_index=0,
                    heading_path="[]",
                    content=content,
                    embedding_model="test",
                    embedding=json.dumps(deterministic_embedding(content)),
                )
            )
            session.add(
                KnowledgeLegacyMigration(
                    legacy_document_id=int(legacy.id),
                    document_id=int(document.id),
                    source_id=int(source.id),
                    status="completed",
                    scope_type="workspace",
                )
            )
            session.commit()

            migrated = build_knowledge_read_authority_report(session)

        assert migrated["source_scoped_cutover_ready"] is True
        assert migrated["mapped_legacy_document_count"] == 1
        assert migrated["invalid_completed_mapping_count"] == 0
        serialized = json.dumps(migrated, ensure_ascii=False)
        assert "private" not in serialized
        assert migrated["content_included"] is False
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_knowledge_authority_report_fails_closed_for_broken_completed_mapping() -> None:
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            legacy = KnowledgeDocument(
                name="legacy",
                file_type="md",
                path="legacy.md",
                vector_status="synced",
            )
            session.add(legacy)
            session.flush()
            source = KnowledgeSource(
                name="source",
                source_type="manual_upload",
                scope_type="workspace",
                status="active",
            )
            session.add(source)
            session.flush()
            document = KnowledgeV1Document(
                source_id=int(source.id),
                title="failed target",
                file_name="failed.md",
                file_type="md",
                path="failed.md",
                content_hash="a" * 64,
                scope_type="workspace",
                status="failed",
            )
            session.add(document)
            session.flush()
            session.add(
                KnowledgeLegacyMigration(
                    legacy_document_id=int(legacy.id),
                    document_id=int(document.id),
                    source_id=int(source.id),
                    status="completed",
                    scope_type="workspace",
                )
            )
            session.commit()
            report = build_knowledge_read_authority_report(session)

        assert report["source_scoped_cutover_ready"] is False
        assert report["invalid_completed_mapping_count"] == 1
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()
