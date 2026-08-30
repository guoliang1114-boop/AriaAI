"""Knowledge base router — document upload, indexing, RAG retrieval."""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, BackgroundTasks, Query
from pydantic import BaseModel, Field as PydanticField
from sqlmodel import Session, select, func

from app.config import UPLOADS_DIR
from app.database import get_session, engine
from app.models.db import ClientRecord, KnowledgeDocument, DocumentChunk, Project, User
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeDocumentEvent,
    KnowledgeJob,
    KnowledgeLegacyMigration,
    KnowledgeSource,
    KnowledgeTemplate,
    KnowledgeTemplateExtraction,
    KnowledgeV1Document,
)
from app.jobs.knowledge_jobs import (
    ACTIVE_JOB_STATUSES,
    KnowledgeJobFailure,
    enqueue_knowledge_job,
    knowledge_job_to_dict,
    process_knowledge_job_by_id,
    retry_knowledge_job,
)
from app.services import parser, rag
from app.services.client_permissions import (
    accessible_client_ids as accessible_client_record_ids,
)
from app.services.knowledge_ingestion import (
    SUPPORTED_SOURCE_FILE_TYPES,
    create_document_from_bytes,
    normalize_file_type,
    parse_json_object,
    sha256_bytes,
)
from app.services.knowledge_migration import (
    LEGACY_MIGRATION_VERSION,
    MAX_LEGACY_MIGRATION_BATCH,
    LegacyMigrationFailure,
    build_legacy_migration_preview,
    migration_preview_to_dict,
)
from app.services.knowledge_permissions import (
    accessible_project_ids,
    can_access_legacy_document,
    can_access_source,
    can_write_legacy_document,
    can_write_legacy_scope,
    can_write_source,
    lock_and_require_knowledge_scope_write,
    lock_and_require_legacy_document_write,
    lock_and_require_legacy_scope_write,
    lock_and_require_source_document_write,
    lock_and_require_source_write,
)
from app.services.knowledge_retrieval import search_knowledge
from app.services.knowledge_templates import BUILTIN_KNOWLEDGE_TEMPLATES, template_to_dict
from app.services.storage import StorageService
from app.services.time_utils import utc_now_naive

from app.routers.auth import get_current_user, require_admin

router = APIRouter(
    prefix="/knowledge",
    tags=["knowledge"],
    dependencies=[Depends(get_current_user)],
)

logger = logging.getLogger(__name__)

KB_UPLOADS = UPLOADS_DIR / "knowledge"
KB_UPLOADS.mkdir(parents=True, exist_ok=True)


class KnowledgeCategoryCount(BaseModel):
    category: str
    count: int


class KnowledgeStatusCount(BaseModel):
    status: str
    count: int


class KnowledgeFileTypeCount(BaseModel):
    file_type: str
    count: int


class KnowledgeDocumentListResponse(BaseModel):
    items: list[KnowledgeDocument]
    total: int
    limit: int
    offset: int
    categories: list[KnowledgeCategoryCount]
    status_counts: list[KnowledgeStatusCount] = []
    file_type_counts: list[KnowledgeFileTypeCount] = []
    recent: list[KnowledgeDocument]
    indexed_count: int
    total_size: int = 0


class KnowledgeSourceCreate(BaseModel):
    name: str
    source_type: str = "manual_upload"
    scope_type: str = "workspace"
    scope_id: Optional[int] = None
    sync_mode: str = "manual"
    include_patterns: str = "**/*.pptx,**/*.pdf,**/*.docx,**/*.md"
    exclude_patterns: str = ".obsidian/**,node_modules/**"
    tags: str = ""
    root_path: str = ""
    config: dict[str, Any] = PydanticField(default_factory=dict)


class KnowledgeSearchRequest(BaseModel):
    query: str
    scope_types: Optional[list[str]] = None
    scope_ids: Optional[list[int]] = None
    template_keys: Optional[list[str]] = None
    industries: Optional[list[str]] = None
    service_lines: Optional[list[str]] = None
    confidential_levels: Optional[list[str]] = None
    can_generate: Optional[bool] = None
    top_k: int = 8


class LegacyMigrationExecute(BaseModel):
    plan_hash: str = PydanticField(min_length=64, max_length=64)
    batch_size: int = PydanticField(default=100, ge=1, le=MAX_LEGACY_MIGRATION_BATCH)


def _source_to_dict(source: KnowledgeSource) -> dict[str, Any]:
    return {
        "id": source.id,
        "name": source.name,
        "source_type": source.source_type,
        "scope_type": source.scope_type,
        "scope_id": source.scope_id,
        "owner_user_id": source.owner_user_id,
        "sync_mode": source.sync_mode,
        "include_patterns": source.include_patterns,
        "exclude_patterns": source.exclude_patterns,
        "tags": source.tags,
        "managed": bool(source.external_key),
        "status": source.status,
        "created_at": source.created_at.isoformat(),
        "updated_at": source.updated_at.isoformat(),
    }


def _latest_document_job(session: Session, document_id: int) -> KnowledgeJob | None:
    return session.exec(
        select(KnowledgeJob)
        .where(KnowledgeJob.document_id == document_id)
        .order_by(KnowledgeJob.created_at.desc(), KnowledgeJob.id.desc())
    ).first()


def _document_to_dict(
    document: KnowledgeV1Document,
    *,
    session: Session,
    job: KnowledgeJob | None = None,
) -> dict[str, Any]:
    latest_job = job or _latest_document_job(session, int(document.id))
    legacy_mappings = session.exec(
        select(KnowledgeLegacyMigration).where(
            KnowledgeLegacyMigration.document_id == document.id,
            KnowledgeLegacyMigration.status == "completed",
        )
        .order_by(KnowledgeLegacyMigration.legacy_document_id.asc())
    ).all()
    legacy_document_ids = [mapping.legacy_document_id for mapping in legacy_mappings]
    payload = {
        "id": document.id,
        "source_id": document.source_id,
        "title": document.title,
        "file_name": document.file_name,
        "file_type": document.file_type,
        "path": document.path,
        "metadata_json": document.metadata_json,
        "file_size_bytes": document.file_size_bytes,
        "page_count": document.page_count,
        "slide_count": document.slide_count,
        "token_count": document.token_count,
        "chunk_count": document.chunk_count,
        "scope_type": document.scope_type,
        "scope_id": document.scope_id,
        "status": document.status,
        "error_message": document.error_message,
        "created_at": document.created_at.isoformat(),
        "updated_at": document.updated_at.isoformat(),
        "job_id": latest_job.id if latest_job else None,
        "latest_job": knowledge_job_to_dict(latest_job) if latest_job else None,
        "legacy_document_id": legacy_document_ids[0] if legacy_document_ids else None,
        "legacy_document_ids": legacy_document_ids,
    }
    return payload


def _source_or_404(session: Session, source_id: int) -> KnowledgeSource:
    source = session.get(KnowledgeSource, source_id)
    if not source:
        raise HTTPException(404, "Knowledge source not found")
    return source


def _document_or_404(session: Session, document_id: int) -> KnowledgeV1Document:
    document = session.get(KnowledgeV1Document, document_id)
    if not document or document.status == "deleted":
        raise HTTPException(404, "Knowledge document not found")
    return document


def _require_source_access(
    session: Session,
    current_user: User,
    source: KnowledgeSource,
    *,
    require_write: bool = False,
) -> None:
    allowed = (
        can_write_source(current_user, source, session)
        if require_write
        else can_access_source(current_user, source, session)
    )
    if not allowed:
        permission = "write" if require_write else "access"
        raise HTTPException(403, f"Knowledge source {permission} denied")


def _job_or_404(session: Session, job_id: int) -> KnowledgeJob:
    job = session.get(KnowledgeJob, job_id)
    if not job:
        raise HTTPException(404, "Knowledge job not found")
    return job


def _require_job_access(
    session: Session,
    current_user: User,
    job: KnowledgeJob,
    *,
    require_write: bool = False,
) -> None:
    if current_user.is_admin and job.job_type == "migrate_legacy_knowledge":
        return
    source = session.get(KnowledgeSource, job.source_id) if job.source_id else None
    if not source and job.document_id:
        document = session.get(KnowledgeV1Document, job.document_id)
        source = session.get(KnowledgeSource, document.source_id) if document else None
    if source is None:
        allowed = False
    elif require_write:
        allowed = can_write_source(current_user, source, session)
    else:
        allowed = can_access_source(current_user, source, session)
    if not allowed:
        raise HTTPException(403, "Knowledge job access denied")


def _lock_and_require_job_write(
    session: Session,
    current_user: User,
    job: KnowledgeJob,
) -> tuple[KnowledgeJob, User]:
    """Finalize job authorization before retrying and dispatching it."""

    expected = (job.job_type, job.source_id, job.document_id)
    if job.job_type == "migrate_legacy_knowledge":
        actor = lock_and_require_knowledge_scope_write(
            session,
            current_user,
            scope_type="global",
            scope_id=None,
        )
    else:
        source_id = job.source_id
        if source_id is None and job.document_id is not None:
            document = session.get(KnowledgeV1Document, job.document_id)
            source_id = document.source_id if document is not None else None
        if source_id is None:
            raise HTTPException(403, "Knowledge job write permission required")
        if job.document_id is not None:
            _, _, actor = lock_and_require_source_document_write(
                session,
                int(source_id),
                int(job.document_id),
                current_user,
            )
        else:
            _, actor = lock_and_require_source_write(
                session,
                int(source_id),
                current_user,
            )

    session.expire(job)
    locked_job = session.exec(
        select(KnowledgeJob)
        .where(KnowledgeJob.id == job.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if locked_job is None:
        raise HTTPException(409, "Knowledge job was deleted; reload and retry.")
    if (locked_job.job_type, locked_job.source_id, locked_job.document_id) != expected:
        raise HTTPException(409, "Knowledge job scope changed; reload and retry.")
    return locked_job, actor


def _knowledge_scope_filters(project_id: Optional[int], client_id: Optional[int]):
    filters = []
    if project_id is not None:
        filters.append(KnowledgeDocument.project_id == project_id)
    elif client_id is not None:
        filters.append(KnowledgeDocument.client_id == client_id)
    return filters


def _knowledge_search_filter(search: str):
    keyword = search.strip()
    if not keyword:
        return None
    pattern = f"%{keyword}%"
    return (
        KnowledgeDocument.name.ilike(pattern)
        | KnowledgeDocument.file_type.ilike(pattern)
        | KnowledgeDocument.category.ilike(pattern)
        | KnowledgeDocument.path.ilike(pattern)
    )


def _knowledge_file_type_values(file_type: str) -> list[str]:
    normalized = file_type.strip().lower()
    if normalized in ("ppt", "slides"):
        return ["ppt", "pptx"]
    if normalized in ("word", "doc"):
        return ["doc", "docx"]
    if normalized == "excel":
        return ["xls", "xlsx"]
    if normalized in ("pdf", "pptx", "docx", "xlsx", "md", "txt", "csv", "json"):
        return [normalized]
    return []


# ── Knowledge v0.0.5 source + durable ingestion API ──────────────────────────


@router.get("/sources")
def list_knowledge_sources(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    sources = session.exec(
        select(KnowledgeSource).order_by(
            KnowledgeSource.updated_at.desc(),
            KnowledgeSource.id.desc(),
        )
    ).all()
    return [
        _source_to_dict(source)
        for source in sources
        if can_access_source(current_user, source, session)
    ]


@router.post("/sources", status_code=201)
def create_knowledge_source(
    body: KnowledgeSourceCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    source_type = body.source_type.strip().lower()
    scope_type = body.scope_type.strip().lower()
    if source_type not in {
        "manual_upload",
        "markdown_folder",
        "obsidian_vault",
        "git_repo",
        "project_space",
    }:
        raise HTTPException(400, "Unsupported knowledge source type")
    if scope_type not in {"user", "project", "client", "workspace", "skill", "global"}:
        raise HTTPException(400, "Unsupported knowledge source scope")
    if source_type in {"markdown_folder", "obsidian_vault", "git_repo"} and not current_user.is_admin:
        raise HTTPException(403, "Admin access is required for server filesystem sources")
    if scope_type in {"project", "client"} and body.scope_id is None:
        raise HTTPException(400, "scope_id is required for project/client knowledge")

    config = dict(body.config or {})
    if body.root_path.strip():
        config["root_path"] = body.root_path.strip()
    source = KnowledgeSource(
        name=body.name.strip()[:255],
        source_type=source_type,
        scope_type=scope_type,
        scope_id=body.scope_id,
        owner_user_id=current_user.id,
        sync_mode=body.sync_mode.strip()[:50] or "manual",
        include_patterns=body.include_patterns.strip(),
        exclude_patterns=body.exclude_patterns.strip(),
        tags=body.tags.strip(),
        config_json=json.dumps(config, ensure_ascii=False),
        status="active",
    )
    if not source.name:
        raise HTTPException(400, "Knowledge source name is required")
    if not can_write_source(current_user, source, session):
        raise HTTPException(403, "Knowledge source scope write denied")
    actor = lock_and_require_knowledge_scope_write(
        session,
        current_user,
        scope_type=source.scope_type,
        scope_id=source.scope_id,
        owner_user_id=source.owner_user_id,
    )
    if (
        source_type in {"markdown_folder", "obsidian_vault", "git_repo"}
        and not actor.is_admin
    ):
        raise HTTPException(403, "Admin access is required for server filesystem sources")
    source.owner_user_id = actor.id
    session.add(source)
    session.commit()
    session.refresh(source)
    return _source_to_dict(source)


@router.get("/sources/{source_id}/documents")
def list_source_documents(
    source_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    source = _source_or_404(session, source_id)
    _require_source_access(session, current_user, source)
    documents = session.exec(
        select(KnowledgeV1Document)
        .where(
            KnowledgeV1Document.source_id == source_id,
            KnowledgeV1Document.status != "deleted",
        )
        .order_by(KnowledgeV1Document.updated_at.desc(), KnowledgeV1Document.id.desc())
    ).all()
    return [_document_to_dict(document, session=session) for document in documents]


@router.post("/sources/{source_id}/documents", status_code=201)
async def upload_source_document(
    source_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    template_key: Optional[str] = Query(None),
    category: str = Form(""),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    source = _source_or_404(session, source_id)
    _require_source_access(session, current_user, source, require_write=True)
    file_name = file.filename or "document.txt"
    file_type = normalize_file_type(file_name)
    if file_type not in SUPPORTED_SOURCE_FILE_TYPES:
        raise HTTPException(400, f"Unsupported knowledge file type: {file_type}")
    content = await file.read()
    if not content:
        raise HTTPException(400, "Knowledge document is empty")
    source, actor = lock_and_require_source_write(session, source_id, current_user)
    content_hash = sha256_bytes(content)
    storage_key = f"knowledge/originals/source-{source.id}/{content_hash}.{file_type}"
    StorageService(UPLOADS_DIR).put_bytes(storage_key, content)
    document = create_document_from_bytes(
        session=session,
        source=source,
        file_name=file_name,
        content=content,
        relative_path=storage_key,
        template_key=template_key,
        source_metadata={"category": category.strip()} if category.strip() else None,
    )
    if document.status == "indexed":
        return _document_to_dict(document, session=session)
    source, document, actor = lock_and_require_source_document_write(
        session,
        source_id,
        int(document.id),
        actor,
    )
    job = enqueue_knowledge_job(
        session,
        job_type="index_document",
        document_id=document.id,
        source_id=source.id,
        requested_by_user_id=actor.id,
        payload={"template_key": template_key} if template_key else {},
    )
    background_tasks.add_task(process_knowledge_job_by_id, int(job.id), session.get_bind())
    session.refresh(document)
    return _document_to_dict(document, session=session, job=job)


@router.post("/sources/{source_id}/sync", status_code=202)
def sync_knowledge_source(
    source_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    source = _source_or_404(session, source_id)
    _require_source_access(session, current_user, source, require_write=True)
    source, actor = lock_and_require_source_write(session, source_id, current_user)
    job = enqueue_knowledge_job(
        session,
        job_type="sync_source",
        source_id=source.id,
        requested_by_user_id=actor.id,
    )
    background_tasks.add_task(process_knowledge_job_by_id, int(job.id), session.get_bind())
    return knowledge_job_to_dict(job)


@router.post("/sources/{source_id}/documents/{document_id}/reindex", status_code=202)
def reindex_source_document(
    source_id: int,
    document_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    source = _source_or_404(session, source_id)
    _require_source_access(session, current_user, source, require_write=True)
    document = _document_or_404(session, document_id)
    if document.source_id != source.id:
        raise HTTPException(404, "Knowledge document not found in source")
    source, document, actor = lock_and_require_source_document_write(
        session,
        source_id,
        document_id,
        current_user,
    )
    job = enqueue_knowledge_job(
        session,
        job_type="index_document",
        source_id=source.id,
        document_id=document.id,
        requested_by_user_id=actor.id,
        force_new=True,
    )
    background_tasks.add_task(process_knowledge_job_by_id, int(job.id), session.get_bind())
    return knowledge_job_to_dict(job)


@router.delete("/sources/{source_id}/documents/{document_id}")
def delete_source_document(
    source_id: int,
    document_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    source = _source_or_404(session, source_id)
    _require_source_access(session, current_user, source, require_write=True)
    document = _document_or_404(session, document_id)
    if document.source_id != source.id:
        raise HTTPException(404, "Knowledge document not found in source")
    _, document, _ = lock_and_require_source_document_write(
        session,
        source_id,
        document_id,
        current_user,
    )
    document_jobs = list(
        session.exec(
            select(KnowledgeJob)
            .where(KnowledgeJob.document_id == document.id)
            .order_by(KnowledgeJob.id)
            .execution_options(populate_existing=True)
            .with_for_update()
        ).all()
    )
    if any(job.status in ACTIVE_JOB_STATUSES for job in document_jobs):
        raise HTTPException(409, "Knowledge document still has an active ingestion job")

    migration_rows = session.exec(
        select(KnowledgeLegacyMigration).where(
            KnowledgeLegacyMigration.document_id == document.id
        )
    ).all()
    for migration_row in migration_rows:
        session.delete(migration_row)
    for model in (KnowledgeChunk, KnowledgeTemplateExtraction, KnowledgeDocumentEvent):
        rows = session.exec(select(model).where(model.document_id == document.id)).all()
        for row in rows:
            session.delete(row)
    for job in document_jobs:
        session.delete(job)
    storage_keys = tuple(
        storage_key
        for storage_key in (
            document.original_storage_key,
            document.extracted_text_storage_key,
            document.chunks_storage_key,
            document.preview_storage_key,
        )
        if storage_key
    )
    session.delete(document)
    session.commit()
    storage = StorageService(UPLOADS_DIR)
    for storage_key in storage_keys:
        try:
            storage.delete(storage_key)
        except Exception:
            logger.warning(
                "Knowledge document %s was deleted but storage cleanup failed for %s",
                document_id,
                storage_key,
                exc_info=True,
            )
    return {"ok": True}


@router.get("/jobs")
def list_knowledge_jobs(
    status: str = "",
    limit: int = Query(50, ge=1, le=100),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    stmt = select(KnowledgeJob).order_by(
        KnowledgeJob.created_at.desc(),
        KnowledgeJob.id.desc(),
    )
    if status.strip():
        stmt = stmt.where(KnowledgeJob.status == status.strip().lower())
    jobs = session.exec(stmt.limit(limit)).all()
    visible = []
    for job in jobs:
        try:
            _require_job_access(session, current_user, job)
        except HTTPException:
            continue
        visible.append(knowledge_job_to_dict(job))
    return {"items": visible, "total": len(visible)}


@router.get("/jobs/{job_id}")
def get_knowledge_job(
    job_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    job = _job_or_404(session, job_id)
    _require_job_access(session, current_user, job)
    return knowledge_job_to_dict(job)


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry_failed_knowledge_job(
    job_id: int,
    background_tasks: BackgroundTasks,
    force: bool = Query(False),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    job = _job_or_404(session, job_id)
    _require_job_access(session, current_user, job, require_write=True)
    job, actor = _lock_and_require_job_write(session, current_user, job)
    if force and not actor.is_admin:
        raise HTTPException(403, "Admin access is required to force a permanent failure retry")
    # A manual retry is a new user-triggered execution. Bind the durable job to
    # the actor who was just re-authorized instead of silently retaining a
    # deleted, inactive, or no-longer-authorized original requester.
    job.requested_by_user_id = int(actor.id)
    payload = parse_json_object(job.payload_json)
    payload.pop("_trusted_system", None)
    job.payload_json = json.dumps(payload, ensure_ascii=False)
    session.add(job)
    try:
        job = retry_knowledge_job(session, job_id, force=force)
    except KnowledgeJobFailure as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    background_tasks.add_task(process_knowledge_job_by_id, int(job.id), session.get_bind())
    return knowledge_job_to_dict(job)


@router.get("/documents/{document_id}/events")
def list_document_events(
    document_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    document = _document_or_404(session, document_id)
    source = _source_or_404(session, document.source_id)
    _require_source_access(session, current_user, source)
    events = session.exec(
        select(KnowledgeDocumentEvent)
        .where(KnowledgeDocumentEvent.document_id == document.id)
        .order_by(KnowledgeDocumentEvent.created_at.asc(), KnowledgeDocumentEvent.id.asc())
    ).all()
    return [
        {
            "id": event.id,
            "document_id": event.document_id,
            "event_type": event.event_type,
            "status": event.status,
            "message": event.message,
            "duration_ms": event.duration_ms,
            "metadata": parse_json_object(event.metadata_json),
            "created_at": event.created_at.isoformat(),
        }
        for event in events
    ]


@router.get("/documents/{document_id}/template-result")
def get_document_template_result(
    document_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    document = _document_or_404(session, document_id)
    source = _source_or_404(session, document.source_id)
    _require_source_access(session, current_user, source)
    extraction = session.exec(
        select(KnowledgeTemplateExtraction)
        .where(KnowledgeTemplateExtraction.document_id == document.id)
        .order_by(
            KnowledgeTemplateExtraction.updated_at.desc(),
            KnowledgeTemplateExtraction.id.desc(),
        )
    ).first()
    if not extraction:
        raise HTTPException(404, "Knowledge template extraction not found")
    return {
        "id": extraction.id,
        "document_id": extraction.document_id,
        "template_key": extraction.template_key,
        "status": extraction.status,
        "extracted": parse_json_object(extraction.extracted_json),
        "confidence": extraction.confidence,
        "error_message": extraction.error_message,
        "created_at": extraction.created_at.isoformat(),
        "updated_at": extraction.updated_at.isoformat(),
    }


@router.get("/templates")
def list_knowledge_templates(
    session: Session = Depends(get_session),
):
    # A read endpoint must not upsert global rows on behalf of a viewer. Return
    # persisted built-ins when present and a read-only static representation on
    # a fresh database; explicit setup code may still call seed_builtin_templates.
    stored = session.exec(
        select(KnowledgeTemplate).where(
            KnowledgeTemplate.key.in_(
                [str(item["key"]) for item in BUILTIN_KNOWLEDGE_TEMPLATES]
            )
        )
    ).all()
    stored_by_key = {template.key: template for template in stored}
    templates = []
    for item in BUILTIN_KNOWLEDGE_TEMPLATES:
        key = str(item["key"])
        persisted = stored_by_key.get(key)
        if persisted is not None:
            templates.append(template_to_dict(persisted))
            continue
        templates.append(
            {
                "id": None,
                "key": key,
                "name": item["name"],
                "description": item["description"],
                "supported_file_types": list(item["supported_file_types"]),
                "required_fields": list(item["required_fields"]),
                "optional_fields": list(item["optional_fields"]),
                "status": "active",
            }
        )
    return {"templates": templates}


@router.post("/search")
def search_knowledge_v005(
    body: KnowledgeSearchRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if not body.query.strip():
        raise HTTPException(400, "Knowledge search query is required")
    return search_knowledge(
        session=session,
        user=current_user,
        query=body.query.strip(),
        scope_types=body.scope_types,
        scope_ids=body.scope_ids,
        template_keys=body.template_keys,
        industries=body.industries,
        service_lines=body.service_lines,
        confidential_levels=body.confidential_levels,
        can_generate=body.can_generate,
        top_k=body.top_k,
    )


@router.get("/migrations/legacy/preview")
def preview_legacy_knowledge_migration(
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin),
):
    try:
        preview = build_legacy_migration_preview(session, uploads_root=UPLOADS_DIR)
    except LegacyMigrationFailure as exc:
        raise HTTPException(409, str(exc)) from exc
    active_job = session.exec(
        select(KnowledgeJob)
        .where(
            KnowledgeJob.job_type == "migrate_legacy_knowledge",
            KnowledgeJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        .order_by(KnowledgeJob.created_at.asc(), KnowledgeJob.id.asc())
    ).first()
    return {
        **migration_preview_to_dict(preview),
        "active_job": knowledge_job_to_dict(active_job) if active_job else None,
        "requested_by_user_id": current_user.id,
    }


@router.post("/migrations/legacy", status_code=202)
def execute_legacy_knowledge_migration(
    body: LegacyMigrationExecute,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(require_admin),
):
    try:
        preview = build_legacy_migration_preview(session, uploads_root=UPLOADS_DIR)
    except LegacyMigrationFailure as exc:
        raise HTTPException(409, str(exc)) from exc
    if body.plan_hash != preview["plan_hash"]:
        raise HTTPException(
            409,
            "Legacy knowledge changed after preview. Refresh the migration plan before executing.",
        )
    active_job = session.exec(
        select(KnowledgeJob)
        .where(
            KnowledgeJob.job_type == "migrate_legacy_knowledge",
            KnowledgeJob.status.in_(ACTIVE_JOB_STATUSES),
        )
        .order_by(KnowledgeJob.created_at.asc(), KnowledgeJob.id.asc())
    ).first()
    if active_job:
        raise HTTPException(409, "A legacy knowledge migration is already running")
    plans = list(preview["ready_plans"][: body.batch_size])
    if not plans:
        raise HTTPException(409, "No migration-ready legacy documents remain")
    actor = lock_and_require_knowledge_scope_write(
        session,
        current_user,
        scope_type="global",
        scope_id=None,
    )
    job = enqueue_knowledge_job(
        session,
        job_type="migrate_legacy_knowledge",
        requested_by_user_id=actor.id,
        payload={
            "migration_version": LEGACY_MIGRATION_VERSION,
            "plan_hash": preview["plan_hash"],
            "planned_documents": plans,
        },
    )
    background_tasks.add_task(process_knowledge_job_by_id, int(job.id), session.get_bind())
    return {
        **knowledge_job_to_dict(job),
        "planned_document_count": len(plans),
        "remaining_ready_count": max(0, int(preview["ready"]) - len(plans)),
    }


@router.get("/documents")
def list_documents(
    project_id: Optional[int] = None,
    client_id: Optional[int] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    stmt = select(KnowledgeDocument).order_by(KnowledgeDocument.uploaded_at.desc())
    if project_id is not None:
        stmt = stmt.where(KnowledgeDocument.project_id == project_id)
    elif client_id is not None:
        stmt = stmt.where(KnowledgeDocument.client_id == client_id)
    return [
        document
        for document in session.exec(stmt).all()
        if can_access_legacy_document(current_user, document, session)
    ]


@router.get("/documents/list", response_model=KnowledgeDocumentListResponse)
def list_documents_paginated(
    project_id: Optional[int] = None,
    client_id: Optional[int] = None,
    search: str = "",
    category: str = "all",
    file_type: str = "all",
    status: str = "all",
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    stmt = select(KnowledgeDocument).order_by(
        KnowledgeDocument.uploaded_at.desc(),
        KnowledgeDocument.id.desc(),
    )
    for condition in _knowledge_scope_filters(project_id, client_id):
        stmt = stmt.where(condition)
    accessible = [
        document
        for document in session.exec(stmt).all()
        if can_access_legacy_document(current_user, document, session)
    ]
    file_type_values = set(
        _knowledge_file_type_values(file_type)
        if file_type and file_type != "all"
        else []
    )
    keyword = search.strip().lower()

    def matches(document: KnowledgeDocument) -> bool:
        if keyword and not any(
            keyword in str(value or "").lower()
            for value in (
                document.name,
                document.file_type,
                document.category,
                document.path,
            )
        ):
            return False
        if category and category != "all" and document.category != category:
            return False
        if file_type_values and document.file_type.lower() not in file_type_values:
            return False
        if status and status != "all" and document.vector_status != status:
            return False
        return True

    filtered = [document for document in accessible if matches(document)]
    total = len(filtered)
    items = filtered[offset : offset + limit]

    def counts_for(attribute: str, fallback: str):
        counts: dict[str, int] = {}
        for document in accessible:
            key = str(getattr(document, attribute) or fallback)
            counts[key] = counts.get(key, 0) + 1
        return sorted(counts.items(), key=lambda item: (-item[1], item[0]))

    categories = [
        KnowledgeCategoryCount(category=value, count=count)
        for value, count in counts_for("category", "uncategorized")
    ]
    status_counts = [
        KnowledgeStatusCount(status=value, count=count)
        for value, count in counts_for("vector_status", "pending")
    ]
    file_type_counts = [
        KnowledgeFileTypeCount(file_type=value, count=count)
        for value, count in counts_for("file_type", "other")
    ]
    return KnowledgeDocumentListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        categories=categories,
        status_counts=status_counts,
        file_type_counts=file_type_counts,
        recent=accessible[:5],
        indexed_count=sum(1 for document in accessible if document.vector_status == "synced"),
        total_size=0,
    )


@router.post("/documents", status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    # Without ``Form(...)`` FastAPI looks for these in the query string on a
    # multipart request, so the frontend's ``FormData.append('category', ...)``
    # silently dropped the value and every doc ended up uncategorised.
    category_form: str = Form("", alias="category"),
    project_id_form: Optional[int] = Form(None, alias="project_id"),
    client_id_form: Optional[int] = Form(None, alias="client_id"),
    # Keep the older query-string call style working for tests, scripts, and
    # clients that post multipart files without adding metadata to FormData.
    category_query: str = Query("", alias="category"),
    project_id_query: Optional[int] = Query(None, alias="project_id"),
    client_id_query: Optional[int] = Query(None, alias="client_id"),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    category = category_form or category_query
    project_id = project_id_form if project_id_form is not None else project_id_query
    client_id = client_id_form if client_id_form is not None else client_id_query

    if project_id is not None:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "Project not found")
    if client_id is not None:
        client = session.get(ClientRecord, client_id)
        if not client:
            raise HTTPException(404, "Client not found")
    if not can_write_legacy_scope(
        current_user,
        project_id=project_id,
        client_id=client_id,
        session=session,
    ):
        raise HTTPException(403, "Knowledge document write permission required")

    suffix = Path(file.filename or "file").suffix.lower()
    dest_name = f"{uuid.uuid4().hex}{suffix}"
    dest_file = KB_UPLOADS / dest_name

    actor = lock_and_require_legacy_scope_write(
        session,
        current_user,
        project_id=project_id,
        client_id=client_id,
    )
    with dest_file.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    doc = KnowledgeDocument(
        name=file.filename or dest_name,
        file_type=suffix.lstrip("."),
        path=str(dest_file.relative_to(UPLOADS_DIR)),
        category=category,
        vector_status="pending",
        project_id=project_id,
        client_id=client_id,
    )
    session.add(doc)
    session.commit()
    session.refresh(doc)

    background_tasks.add_task(
        _index_background,
        doc.id,
        str(dest_file),
        int(actor.id),
    )
    return doc


def _index_background(doc_id: int, file_path: str, actor_user_id: int) -> None:
    with Session(engine) as session:
        actor = session.get(User, actor_user_id)
        if actor is None:
            return
        try:
            doc, _ = lock_and_require_legacy_document_write(
                session,
                doc_id,
                actor,
            )
        except HTTPException:
            session.rollback()
            return
        expected_source = (
            doc.project_id,
            doc.client_id,
            doc.path,
            doc.name,
            doc.file_type,
        )
        session.rollback()

        try:
            text = parser.extract_text(file_path)
        except Exception:
            _record_legacy_index_failure(
                session,
                doc_id,
                actor_user_id,
                expected_source,
            )
            return
        if not text.strip():
            _record_legacy_index_failure(
                session,
                doc_id,
                actor_user_id,
                expected_source,
            )
            return
        try:
            asyncio.run(
                rag.index_document(
                    doc,
                    text,
                    session,
                    actor_user_id=actor_user_id,
                    expected_source=expected_source,
                )
            )
        except Exception:
            session.rollback()
            _record_legacy_index_failure(
                session,
                doc_id,
                actor_user_id,
                expected_source,
            )


def _record_legacy_index_failure(
    session: Session,
    doc_id: int,
    actor_user_id: int,
    expected_source: tuple[object, ...],
) -> bool:
    """Write a failure receipt only while the original actor still owns scope."""

    session.rollback()
    actor = session.get(User, actor_user_id)
    if actor is None:
        return False
    try:
        document, _ = lock_and_require_legacy_document_write(
            session,
            doc_id,
            actor,
        )
    except HTTPException:
        session.rollback()
        return False
    if (
        document.project_id,
        document.client_id,
        document.path,
        document.name,
        document.file_type,
    ) != expected_source:
        session.rollback()
        return False
    document.vector_status = "failed"
    document.vector_progress = 0.0
    session.add(document)
    session.commit()
    return True


@router.post("/documents/{doc_id}/reindex")
def reindex_document(
    doc_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    doc = session.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if not can_write_legacy_document(current_user, doc, session):
        raise HTTPException(403, "Knowledge document write permission required")

    full_path = UPLOADS_DIR / doc.path
    if not full_path.is_file():
        raise HTTPException(404, "Document file not found")
    doc, actor = lock_and_require_legacy_document_write(session, doc_id, current_user)
    full_path = UPLOADS_DIR / doc.path
    if not full_path.is_file():
        raise HTTPException(404, "Document file not found")

    doc.vector_status = "pending"
    doc.vector_progress = 0.0
    doc.chunk_count = 0
    session.add(doc)
    session.commit()
    session.refresh(doc)

    background_tasks.add_task(
        _index_background,
        doc.id,
        str(full_path),
        int(actor.id),
    )
    return doc


@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    doc = session.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if not can_write_legacy_document(current_user, doc, session):
        raise HTTPException(403, "Knowledge document write permission required")
    doc, _ = lock_and_require_legacy_document_write(session, doc_id, current_user)
    storage_key = doc.path
    for c in session.exec(
        select(DocumentChunk).where(DocumentChunk.document_id == doc_id)
    ).all():
        session.delete(c)
    session.delete(doc)
    session.commit()
    try:
        StorageService(UPLOADS_DIR).delete(storage_key)
    except Exception:
        logger.warning(
            "Legacy knowledge document %s was deleted but storage cleanup failed for %s",
            doc_id,
            storage_key,
            exc_info=True,
        )
    return {"ok": True}


@router.get("/stats")
def get_stats(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    documents = [
        document
        for document in session.exec(select(KnowledgeDocument)).all()
        if can_access_legacy_document(current_user, document, session)
    ]
    document_ids = [int(document.id) for document in documents]
    chunk_count = (
        session.exec(
            select(func.count(DocumentChunk.id)).where(
                DocumentChunk.document_id.in_(document_ids)
            )
        ).one()
        if document_ids
        else 0
    )
    return {"document_count": len(documents), "total_vectors": chunk_count}


@router.post("/query")
def query_knowledge(
    query: str,
    doc_ids: Optional[List[int]] = None,
    project_id: Optional[int] = None,
    client_id: Optional[int] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    if current_user.is_admin:
        allowed_project_ids = None
        allowed_client_ids = None
    else:
        allowed_project_ids = accessible_project_ids(current_user, session)
        allowed_client_ids = sorted(
            accessible_client_record_ids(session, current_user) or set()
        )
    result = rag.retrieve(
        query,
        session,
        doc_ids,
        project_id=project_id,
        client_id=client_id,
        accessible_project_ids=allowed_project_ids,
        accessible_client_ids=allowed_client_ids,
    )
    return {"context": result}
