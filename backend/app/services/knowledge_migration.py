"""Controlled, non-destructive migration of legacy knowledge documents.

The frozen-plan verification and restart-safe item mapping apply the same
verify-before-write and checkpoint principles adapted from OpenAI Codex
``codex-rs/apply-patch/src/file_update.rs`` and
``codex-rs/rollout/src/recorder.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0).

Modified for AriaAI on 2026-08-24: the plan fingerprints legacy database and
file facts, copies originals without deleting the legacy system, maps multiple
legacy rows to deduplicated source-scoped documents, and persists only safe
migration metadata. No Codex runtime, protocol, process, account, or API is
used.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Callable

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.models.db import ClientRecord, KnowledgeDocument, Project
from app.models.knowledge import (
    KnowledgeLegacyMigration,
    KnowledgeSource,
    KnowledgeV1Document,
)
from app.services.knowledge_ingestion import (
    SUPPORTED_SOURCE_FILE_TYPES,
    create_document_from_bytes,
    index_document,
    sha256_bytes,
)
from app.services.storage import StorageService
from app.services.time_utils import utc_now_naive

LEGACY_MIGRATION_VERSION = "legacy-knowledge-v1"
MAX_LEGACY_MIGRATION_DOCUMENTS = 5000
MAX_LEGACY_MIGRATION_BATCH = 500
MAX_PREVIEW_ITEMS = 200
_LEGACY_BINARY_TYPES = {"ppt", "doc", "xls"}
_MAX_SAFE_ERROR_CHARS = 500


class LegacyMigrationFailure(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


def _stable_hash(value: Any) -> str:
    serialized = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _legacy_scope(document: KnowledgeDocument) -> tuple[str, int | None]:
    if document.project_id is not None:
        return "project", int(document.project_id)
    if document.client_id is not None:
        return "client", int(document.client_id)
    return "workspace", None


def _legacy_file_type(document: KnowledgeDocument) -> str:
    suffix = Path(document.name or "").suffix.lower().lstrip(".")
    value = suffix or str(document.file_type or "").strip().lower().lstrip(".")
    aliases = {"markdown": "md", "word": "docx", "excel": "xlsx", "slides": "pptx"}
    return aliases.get(value, value)


def _legacy_path(
    document: KnowledgeDocument,
    *,
    uploads_root: Path,
) -> Path:
    return StorageService(uploads_root).resolve_path(document.path)


def _mapping_for_legacy(
    session: Session,
    legacy_document_id: int,
) -> KnowledgeLegacyMigration | None:
    return session.exec(
        select(KnowledgeLegacyMigration).where(
            KnowledgeLegacyMigration.legacy_document_id == legacy_document_id
        )
    ).first()


def _preview_item(
    session: Session,
    document: KnowledgeDocument,
    *,
    uploads_root: Path,
) -> dict[str, Any]:
    scope_type, scope_id = _legacy_scope(document)
    file_type = _legacy_file_type(document)
    mapping = _mapping_for_legacy(session, int(document.id))
    mapped_document = (
        session.get(KnowledgeV1Document, mapping.document_id)
        if mapping and mapping.document_id
        else None
    )
    base = {
        "legacy_document_id": int(document.id),
        "name": str(document.name or "")[:500],
        "file_type": file_type,
        "category": str(document.category or "")[:100],
        "scope_type": scope_type,
        "scope_id": scope_id,
        "legacy_status": str(document.vector_status or "pending")[:50],
        "uploaded_at": document.uploaded_at.isoformat() if document.uploaded_at else None,
        "migrated_document_id": mapped_document.id if mapped_document else None,
        "migrated_source_id": mapped_document.source_id if mapped_document else None,
    }
    if mapping and mapping.status == "completed" and mapped_document:
        return {
            **base,
            "state": "migrated",
            "reason_code": "already_migrated",
            "message": "The legacy document is already mapped to the source-scoped model.",
            "content_hash": mapping.content_hash,
        }

    reason_code = ""
    message = ""
    content_hash = ""
    file_size_bytes = 0
    if file_type in _LEGACY_BINARY_TYPES:
        reason_code = "legacy_format_requires_conversion"
        message = f"Legacy .{file_type} files must be converted before migration."
    elif file_type not in SUPPORTED_SOURCE_FILE_TYPES:
        reason_code = "unsupported_file_type"
        message = f"The .{file_type or 'unknown'} file type is not supported by v0.0.5 ingestion."
    else:
        try:
            path = _legacy_path(document, uploads_root=uploads_root)
            if not path.is_file():
                reason_code = "source_file_missing"
                message = "The legacy source file is no longer available."
            else:
                file_size_bytes = path.stat().st_size
                if file_size_bytes <= 0:
                    reason_code = "source_file_empty"
                    message = "The legacy source file is empty."
                else:
                    content_hash = _sha256_file(path)
        except (OSError, ValueError):
            reason_code = "source_file_unreadable"
            message = "The legacy source file cannot be read safely."

    if (
        not reason_code
        and mapping
        and mapping.status == "failed"
        and mapping.error_code in {"document_not_indexed"}
        and mapping.content_hash == content_hash
    ):
        reason_code = mapping.error_code
        message = mapping.error_message or "The migrated document requires operator attention."

    state = "blocked" if reason_code else "ready"
    snapshot = {
        "version": LEGACY_MIGRATION_VERSION,
        "legacy_document_id": int(document.id),
        "name": base["name"],
        "file_type": file_type,
        "category": base["category"],
        "scope_type": scope_type,
        "scope_id": scope_id,
        "legacy_status": base["legacy_status"],
        "uploaded_at": base["uploaded_at"],
        "file_size_bytes": file_size_bytes,
        "content_hash": content_hash,
        "state": state,
        "reason_code": reason_code,
    }
    return {
        **base,
        "state": state,
        "reason_code": reason_code,
        "message": message,
        "content_hash": content_hash,
        "file_size_bytes": file_size_bytes,
        "snapshot_hash": _stable_hash(snapshot),
    }


def build_legacy_migration_preview(
    session: Session,
    *,
    uploads_root: Path | None = None,
) -> dict[str, Any]:
    uploads_root = uploads_root or UPLOADS_DIR
    documents = session.exec(
        select(KnowledgeDocument).order_by(
            KnowledgeDocument.id.asc()
        )
    ).all()
    if len(documents) > MAX_LEGACY_MIGRATION_DOCUMENTS:
        raise LegacyMigrationFailure(
            "migration_inventory_too_large",
            f"Legacy migration inventory exceeds {MAX_LEGACY_MIGRATION_DOCUMENTS} documents.",
            retryable=False,
        )
    items = [
        _preview_item(session, document, uploads_root=uploads_root)
        for document in documents
    ]
    plan_hash = _stable_hash(
        {
            "version": LEGACY_MIGRATION_VERSION,
            "items": [
                {
                    key: item.get(key)
                    for key in (
                        "legacy_document_id",
                        "snapshot_hash",
                        "state",
                        "reason_code",
                        "migrated_document_id",
                    )
                }
                for item in items
            ],
        }
    )
    counts = {
        state: sum(1 for item in items if item["state"] == state)
        for state in ("ready", "migrated", "blocked")
    }
    return {
        "version": LEGACY_MIGRATION_VERSION,
        "plan_hash": plan_hash,
        "total": len(items),
        **counts,
        "items": items[:MAX_PREVIEW_ITEMS],
        "has_more": len(items) > MAX_PREVIEW_ITEMS,
        "ready_plans": [item for item in items if item["state"] == "ready"],
    }


def migration_preview_to_dict(preview: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in preview.items() if key != "ready_plans"}


def _source_external_key(scope_type: str, scope_id: int | None) -> str:
    suffix = str(scope_id) if scope_id is not None else "workspace"
    return f"{LEGACY_MIGRATION_VERSION}:{scope_type}:{suffix}"


def _source_name(session: Session, scope_type: str, scope_id: int | None) -> str:
    if scope_type == "project" and scope_id is not None:
        project = session.get(Project, scope_id)
        return f"历史项目知识 · {project.name if project else scope_id}"[:255]
    if scope_type == "client" and scope_id is not None:
        client = session.get(ClientRecord, scope_id)
        return f"历史客户知识 · {client.name if client else scope_id}"[:255]
    return "历史共享知识库"


def _get_or_create_source(
    session: Session,
    *,
    scope_type: str,
    scope_id: int | None,
    requested_by_user_id: int | None,
) -> KnowledgeSource:
    external_key = _source_external_key(scope_type, scope_id)
    existing = session.exec(
        select(KnowledgeSource).where(KnowledgeSource.external_key == external_key)
    ).first()
    if existing:
        return existing
    source = KnowledgeSource(
        name=_source_name(session, scope_type, scope_id),
        source_type="manual_upload",
        scope_type=scope_type,
        scope_id=scope_id,
        owner_user_id=requested_by_user_id,
        sync_mode="manual",
        tags="legacy-migration,managed",
        config_json=json.dumps(
            {
                "managed_by": LEGACY_MIGRATION_VERSION,
                "non_destructive": True,
            },
            ensure_ascii=False,
        ),
        external_key=external_key,
        status="active",
    )
    session.add(source)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.exec(
            select(KnowledgeSource).where(KnowledgeSource.external_key == external_key)
        ).first()
        if existing:
            return existing
        raise
    session.refresh(source)
    return source


def _upsert_mapping(
    session: Session,
    *,
    legacy_document_id: int,
    job_id: int,
    scope_type: str,
    scope_id: int | None,
    status: str,
    document_id: int | None = None,
    source_id: int | None = None,
    content_hash: str = "",
    created_document: bool = False,
    error_code: str = "",
    error_message: str = "",
) -> KnowledgeLegacyMigration:
    mapping = _mapping_for_legacy(session, legacy_document_id)
    if not mapping:
        mapping = KnowledgeLegacyMigration(
            legacy_document_id=legacy_document_id,
            created_at=utc_now_naive(),
        )
    mapping.job_id = job_id
    mapping.scope_type = scope_type
    mapping.scope_id = scope_id
    mapping.status = status
    if document_id is not None:
        mapping.document_id = document_id
    if source_id is not None:
        mapping.source_id = source_id
    if content_hash:
        mapping.content_hash = content_hash
    mapping.created_document = bool(mapping.created_document or created_document)
    mapping.error_code = error_code[:100]
    mapping.error_message = error_message[:_MAX_SAFE_ERROR_CHARS]
    mapping.updated_at = utc_now_naive()
    mapping.completed_at = utc_now_naive() if status == "completed" else None
    session.add(mapping)
    session.commit()
    session.refresh(mapping)
    return mapping


def _planned_snapshot_matches(
    current: dict[str, Any],
    planned: dict[str, Any],
) -> bool:
    return all(
        current.get(key) == planned.get(key)
        for key in (
            "legacy_document_id",
            "snapshot_hash",
            "content_hash",
            "scope_type",
            "scope_id",
            "file_type",
        )
    )


def migrate_legacy_documents(
    session: Session,
    *,
    job_id: int,
    requested_by_user_id: int | None,
    planned_documents: list[dict[str, Any]],
    uploads_root: Path | None = None,
    checkpoint: Callable[[str, dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    uploads_root = uploads_root or UPLOADS_DIR
    storage = StorageService(uploads_root)
    completed_legacy_ids: list[int] = []
    failed_legacy_ids: list[int] = []
    migrated_count = 0
    skipped_count = 0

    for planned in planned_documents[:MAX_LEGACY_MIGRATION_BATCH]:
        legacy_id = int(planned.get("legacy_document_id") or 0)
        legacy = session.get(KnowledgeDocument, legacy_id)
        if not legacy:
            failed_legacy_ids.append(legacy_id)
            _upsert_mapping(
                session,
                legacy_document_id=legacy_id,
                job_id=job_id,
                scope_type=str(planned.get("scope_type") or "workspace"),
                scope_id=planned.get("scope_id"),
                status="failed",
                error_code="legacy_document_missing",
                error_message="The legacy database record no longer exists.",
            )
            continue

        mapping = _mapping_for_legacy(session, legacy_id)
        mapped_document = (
            session.get(KnowledgeV1Document, mapping.document_id)
            if mapping and mapping.document_id
            else None
        )
        if mapping and mapping.status == "completed" and mapped_document:
            completed_legacy_ids.append(legacy_id)
            skipped_count += 1
            continue

        current = _preview_item(session, legacy, uploads_root=uploads_root)
        if current.get("state") != "ready" or not _planned_snapshot_matches(current, planned):
            failed_legacy_ids.append(legacy_id)
            _upsert_mapping(
                session,
                legacy_document_id=legacy_id,
                job_id=job_id,
                scope_type=str(current.get("scope_type") or "workspace"),
                scope_id=current.get("scope_id"),
                status="failed",
                content_hash=str(current.get("content_hash") or ""),
                error_code="migration_plan_stale",
                error_message="The legacy document changed after migration preview.",
            )
            continue

        scope_type = str(current["scope_type"])
        scope_id = current.get("scope_id")
        try:
            source_path = _legacy_path(legacy, uploads_root=uploads_root)
            content = source_path.read_bytes()
            if sha256_bytes(content) != planned["content_hash"]:
                raise LegacyMigrationFailure(
                    "migration_plan_stale",
                    "The legacy document content changed after migration preview.",
                    retryable=False,
                )
            source = _get_or_create_source(
                session,
                scope_type=scope_type,
                scope_id=scope_id,
                requested_by_user_id=requested_by_user_id,
            )
            storage_key = (
                f"knowledge/originals/source-{source.id}/"
                f"{planned['content_hash']}.{planned['file_type']}"
            )
            storage.put_bytes(storage_key, content)
            existing = session.exec(
                select(KnowledgeV1Document).where(
                    KnowledgeV1Document.source_id == source.id,
                    KnowledgeV1Document.content_hash == planned["content_hash"],
                    KnowledgeV1Document.status != "deleted",
                )
            ).first()
            document = create_document_from_bytes(
                session=session,
                source=source,
                file_name=str(legacy.name or f"legacy-{legacy_id}.{planned['file_type']}"),
                content=content,
                relative_path=storage_key,
                source_metadata={
                    "category": str(legacy.category or ""),
                    "legacy_document_id": legacy_id,
                    "legacy_vector_status": str(legacy.vector_status or "pending"),
                    "migration_version": LEGACY_MIGRATION_VERSION,
                },
            )
            created_document = existing is None
            _upsert_mapping(
                session,
                legacy_document_id=legacy_id,
                job_id=job_id,
                scope_type=scope_type,
                scope_id=scope_id,
                status="processing",
                document_id=int(document.id),
                source_id=int(source.id),
                content_hash=planned["content_hash"],
                created_document=created_document,
            )

            def document_checkpoint(phase: str, facts: dict[str, Any]) -> None:
                if checkpoint:
                    checkpoint(
                        "migrating",
                        {
                            **facts,
                            "current_legacy_document_id": legacy_id,
                            "current_document_id": int(document.id),
                            "document_phase": phase,
                            "completed_legacy_document_ids": completed_legacy_ids,
                            "failed_legacy_document_ids": failed_legacy_ids,
                            "migrated_document_count": migrated_count,
                            "skipped_document_count": skipped_count,
                            "failed_document_count": len(failed_legacy_ids),
                        },
                    )

            indexed = (
                document
                if document.status == "indexed"
                else index_document(
                    session,
                    int(document.id),
                    resume_checkpoint={},
                    checkpoint=document_checkpoint,
                )
            )
            if indexed.status != "indexed":
                failed_legacy_ids.append(legacy_id)
                _upsert_mapping(
                    session,
                    legacy_document_id=legacy_id,
                    job_id=job_id,
                    scope_type=scope_type,
                    scope_id=scope_id,
                    status="failed",
                    document_id=int(document.id),
                    source_id=int(source.id),
                    content_hash=planned["content_hash"],
                    created_document=created_document,
                    error_code="document_not_indexed",
                    error_message=indexed.error_message or "The migrated document could not be indexed.",
                )
                continue
            completed_legacy_ids.append(legacy_id)
            migrated_count += 1
            _upsert_mapping(
                session,
                legacy_document_id=legacy_id,
                job_id=job_id,
                scope_type=scope_type,
                scope_id=scope_id,
                status="completed",
                document_id=int(document.id),
                source_id=int(source.id),
                content_hash=planned["content_hash"],
                created_document=created_document,
            )
            if checkpoint:
                checkpoint(
                    "migrating",
                    {
                        "current_legacy_document_id": legacy_id,
                        "current_document_id": int(document.id),
                        "completed_legacy_document_ids": completed_legacy_ids,
                        "failed_legacy_document_ids": failed_legacy_ids,
                        "migrated_document_count": migrated_count,
                        "skipped_document_count": skipped_count,
                        "failed_document_count": len(failed_legacy_ids),
                    },
                )
        except LegacyMigrationFailure as exc:
            session.rollback()
            failed_legacy_ids.append(legacy_id)
            _upsert_mapping(
                session,
                legacy_document_id=legacy_id,
                job_id=job_id,
                scope_type=scope_type,
                scope_id=scope_id,
                status="failed",
                content_hash=str(planned.get("content_hash") or ""),
                error_code=exc.code,
                error_message=str(exc),
            )
            if exc.retryable:
                raise
        except (TimeoutError, ConnectionError, OSError) as exc:
            session.rollback()
            _upsert_mapping(
                session,
                legacy_document_id=legacy_id,
                job_id=job_id,
                scope_type=scope_type,
                scope_id=scope_id,
                status="failed",
                content_hash=str(planned.get("content_hash") or ""),
                error_code="transient_io_error",
                error_message="A temporary storage error interrupted legacy migration.",
            )
            raise LegacyMigrationFailure(
                "transient_io_error",
                "A temporary storage error interrupted legacy migration.",
                retryable=True,
            ) from exc
        except Exception as exc:
            session.rollback()
            _upsert_mapping(
                session,
                legacy_document_id=legacy_id,
                job_id=job_id,
                scope_type=scope_type,
                scope_id=scope_id,
                status="failed",
                content_hash=str(planned.get("content_hash") or ""),
                error_code="internal_migration_error",
                error_message="An unexpected error interrupted legacy migration.",
            )
            raise LegacyMigrationFailure(
                "internal_migration_error",
                "An unexpected error interrupted legacy migration.",
                retryable=True,
            ) from exc

    result = {
        "completed_legacy_document_ids": completed_legacy_ids,
        "failed_legacy_document_ids": failed_legacy_ids,
        "migrated_document_count": migrated_count,
        "skipped_document_count": skipped_count,
        "failed_document_count": len(failed_legacy_ids),
    }
    if checkpoint:
        checkpoint("migration_completed", result)
    if failed_legacy_ids:
        raise LegacyMigrationFailure(
            "migration_items_failed",
            f"{len(failed_legacy_ids)} legacy document(s) require operator attention.",
            retryable=False,
        )
    return result
