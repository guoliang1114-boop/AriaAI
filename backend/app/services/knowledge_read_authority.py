"""Content-free authority audit for source-scoped and legacy knowledge reads."""
from __future__ import annotations

from collections import Counter
from typing import Any

from sqlmodel import Session, select

from app.models.db import KnowledgeDocument
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeLegacyMigration,
    KnowledgeSource,
    KnowledgeV1Document,
)


_LEGACY_STATUSES = ("pending", "processing", "synced", "failed")
_V1_STATUSES = ("uploaded", "queued", "processing", "indexed", "failed", "deleted")
_MIGRATION_STATUSES = ("pending", "processing", "completed", "failed")
_SCOPE_TYPES = ("user", "project", "client", "workspace", "skill", "global")


def _bounded_counts(values: list[str], known: tuple[str, ...]) -> dict[str, int]:
    counts = Counter(str(value or "").strip().lower() for value in values)
    payload = {key: int(counts.pop(key, 0)) for key in known}
    payload["other"] = int(sum(counts.values()))
    return payload


def build_knowledge_read_authority_report(session: Session) -> dict[str, Any]:
    """Report whether the legacy vector reader can be retired without content."""

    legacy_rows = session.exec(
        select(KnowledgeDocument.id, KnowledgeDocument.vector_status)
    ).all()
    source_rows = session.exec(
        select(KnowledgeSource.id, KnowledgeSource.status)
    ).all()
    document_rows = session.exec(
        select(
            KnowledgeV1Document.id,
            KnowledgeV1Document.source_id,
            KnowledgeV1Document.status,
            KnowledgeV1Document.scope_type,
        )
    ).all()
    chunk_rows = session.exec(
        select(KnowledgeChunk.id, KnowledgeChunk.document_id)
    ).all()
    chunk_document_ids = {int(row[1]) for row in chunk_rows}
    migration_rows = session.exec(
        select(
            KnowledgeLegacyMigration.legacy_document_id,
            KnowledgeLegacyMigration.document_id,
            KnowledgeLegacyMigration.source_id,
            KnowledgeLegacyMigration.status,
        )
    ).all()

    legacy_ids = {int(row[0]) for row in legacy_rows if row[0] is not None}
    source_status_by_id = {
        int(row[0]): str(row[1] or "")
        for row in source_rows
        if row[0] is not None
    }
    documents_by_id = {
        int(row[0]): {
            "source_id": int(row[1]) if row[1] is not None else None,
            "status": str(row[2] or ""),
            "scope_type": str(row[3] or ""),
        }
        for row in document_rows
        if row[0] is not None
    }
    completed_by_legacy: dict[int, tuple[int | None, int | None]] = {}
    for legacy_id, document_id, source_id, status in migration_rows:
        if legacy_id is None or str(status or "") != "completed":
            continue
        completed_by_legacy[int(legacy_id)] = (
            int(document_id) if document_id is not None else None,
            int(source_id) if source_id is not None else None,
        )

    invalid_completed_mapping_count = 0
    for legacy_id, (document_id, source_id) in completed_by_legacy.items():
        document = documents_by_id.get(document_id or -1)
        if legacy_id not in legacy_ids or document is None:
            invalid_completed_mapping_count += 1
            continue
        if (
            document["status"] != "indexed"
            or document_id not in chunk_document_ids
            or document["source_id"] != source_id
            or source_status_by_id.get(source_id or -1) != "active"
        ):
            invalid_completed_mapping_count += 1

    mapped_legacy_ids = legacy_ids.intersection(completed_by_legacy)
    unmapped_legacy_count = len(legacy_ids - mapped_legacy_ids)
    indexed_without_chunks_count = sum(
        document["status"] == "indexed" and document_id not in chunk_document_ids
        for document_id, document in documents_by_id.items()
    )
    source_scoped_cutover_ready = (
        unmapped_legacy_count == 0 and invalid_completed_mapping_count == 0
    )

    return {
        "schema_version": 1,
        "content_included": False,
        "runtime_read_mode": "source_scoped_first",
        "legacy_fallback_enabled": True,
        "explicit_legacy_selection_enabled": True,
        "source_scoped_cutover_ready": source_scoped_cutover_ready,
        "active_source_count": sum(
            status == "active" for status in source_status_by_id.values()
        ),
        "source_scoped_document_count": len(document_rows),
        "source_scoped_document_statuses": _bounded_counts(
            [str(row[2] or "") for row in document_rows],
            _V1_STATUSES,
        ),
        "source_scoped_document_scopes": _bounded_counts(
            [str(row[3] or "") for row in document_rows],
            _SCOPE_TYPES,
        ),
        "source_scoped_chunk_count": len(chunk_rows),
        "indexed_without_chunks_count": int(indexed_without_chunks_count),
        "legacy_document_count": len(legacy_rows),
        "legacy_document_statuses": _bounded_counts(
            [str(row[1] or "") for row in legacy_rows],
            _LEGACY_STATUSES,
        ),
        "migration_statuses": _bounded_counts(
            [str(row[3] or "") for row in migration_rows],
            _MIGRATION_STATUSES,
        ),
        "mapped_legacy_document_count": len(mapped_legacy_ids),
        "unmapped_legacy_document_count": int(unmapped_legacy_count),
        "invalid_completed_mapping_count": int(invalid_completed_mapping_count),
    }
