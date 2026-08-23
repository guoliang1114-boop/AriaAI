"""Knowledge base router — document upload, indexing, RAG retrieval."""
from __future__ import annotations

import asyncio
import json
import shutil
import uuid
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, BackgroundTasks, Query
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.config import UPLOADS_DIR
from app.database import get_session, engine
from app.models.db import KnowledgeDocument, DocumentChunk, Project, User
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeDocumentEvent,
    KnowledgeJob,
    KnowledgeSource,
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
from app.services.knowledge_ingestion import (
    SUPPORTED_SOURCE_FILE_TYPES,
    create_document_from_bytes,
    normalize_file_type,
    parse_json_object,
    sha256_bytes,
)
from app.services.knowledge_permissions import can_access_source
from app.services.knowledge_retrieval import search_knowledge
from app.services.knowledge_templates import seed_builtin_templates, template_to_dict
from app.services.storage import StorageService
from app.services.time_utils import utc_now_naive

from app.routers.auth import get_current_user, require_admin

router = APIRouter(
    prefix="/knowledge",
    tags=["knowledge"],
    dependencies=[Depends(get_current_user)],
)

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
    config: dict[str, Any] = {}


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
) -> None:
    if not can_access_source(current_user, source, session):
        raise HTTPException(403, "Knowledge source access denied")


def _job_or_404(session: Session, job_id: int) -> KnowledgeJob:
    job = session.get(KnowledgeJob, job_id)
    if not job:
        raise HTTPException(404, "Knowledge job not found")
    return job


def _require_job_access(
    session: Session,
    current_user: User,
    job: KnowledgeJob,
) -> None:
    source = session.get(KnowledgeSource, job.source_id) if job.source_id else None
    if not source and job.document_id:
        document = session.get(KnowledgeV1Document, job.document_id)
        source = session.get(KnowledgeSource, document.source_id) if document else None
    if not source or not can_access_source(current_user, source, session):
        raise HTTPException(403, "Knowledge job access denied")


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
    if not can_access_source(current_user, source, session):
        raise HTTPException(403, "Knowledge source scope access denied")
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
    _require_source_access(session, current_user, source)
    file_name = file.filename or "document.txt"
    file_type = normalize_file_type(file_name)
    if file_type not in SUPPORTED_SOURCE_FILE_TYPES:
        raise HTTPException(400, f"Unsupported knowledge file type: {file_type}")
    content = await file.read()
    if not content:
        raise HTTPException(400, "Knowledge document is empty")
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
    job = enqueue_knowledge_job(
        session,
        job_type="index_document",
        document_id=document.id,
        source_id=source.id,
        requested_by_user_id=current_user.id,
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
    _require_source_access(session, current_user, source)
    job = enqueue_knowledge_job(
        session,
        job_type="sync_source",
        source_id=source.id,
        requested_by_user_id=current_user.id,
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
    _require_source_access(session, current_user, source)
    document = _document_or_404(session, document_id)
    if document.source_id != source.id:
        raise HTTPException(404, "Knowledge document not found in source")
    job = enqueue_knowledge_job(
        session,
        job_type="index_document",
        source_id=source.id,
        document_id=document.id,
        requested_by_user_id=current_user.id,
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
    _require_source_access(session, current_user, source)
    document = _document_or_404(session, document_id)
    if document.source_id != source.id:
        raise HTTPException(404, "Knowledge document not found in source")
    active_job = session.exec(
        select(KnowledgeJob).where(
            KnowledgeJob.document_id == document.id,
            KnowledgeJob.status.in_(ACTIVE_JOB_STATUSES),
        )
    ).first()
    if active_job:
        raise HTTPException(409, "Knowledge document still has an active ingestion job")

    for model in (KnowledgeChunk, KnowledgeTemplateExtraction, KnowledgeDocumentEvent, KnowledgeJob):
        rows = session.exec(select(model).where(model.document_id == document.id)).all()
        for row in rows:
            session.delete(row)
    storage = StorageService(UPLOADS_DIR)
    for storage_key in (
        document.original_storage_key,
        document.extracted_text_storage_key,
        document.chunks_storage_key,
        document.preview_storage_key,
    ):
        if storage_key:
            storage.delete(storage_key)
    session.delete(document)
    session.commit()
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
    _require_job_access(session, current_user, job)
    if force and not current_user.is_admin:
        raise HTTPException(403, "Admin access is required to force a permanent failure retry")
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
    return {"templates": [template_to_dict(item) for item in seed_builtin_templates(session)]}


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


@router.get("/documents")
def list_documents(
    project_id: Optional[int] = None,
    client_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    stmt = select(KnowledgeDocument).order_by(KnowledgeDocument.uploaded_at.desc())
    if project_id is not None:
        stmt = stmt.where(KnowledgeDocument.project_id == project_id)
    elif client_id is not None:
        stmt = stmt.where(KnowledgeDocument.client_id == client_id)
    return session.exec(stmt).all()


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
):
    scope_filters = _knowledge_scope_filters(project_id, client_id)
    search_filter = _knowledge_search_filter(search)
    file_type_values = _knowledge_file_type_values(file_type) if file_type and file_type != "all" else []

    stmt = select(KnowledgeDocument)
    count_stmt = select(func.count(KnowledgeDocument.id))
    for condition in scope_filters:
        stmt = stmt.where(condition)
        count_stmt = count_stmt.where(condition)
    if search_filter is not None:
        stmt = stmt.where(search_filter)
        count_stmt = count_stmt.where(search_filter)
    if category and category != "all":
        stmt = stmt.where(KnowledgeDocument.category == category)
        count_stmt = count_stmt.where(KnowledgeDocument.category == category)
    if file_type_values:
        stmt = stmt.where(KnowledgeDocument.file_type.in_(file_type_values))
        count_stmt = count_stmt.where(KnowledgeDocument.file_type.in_(file_type_values))
    if status and status != "all":
        stmt = stmt.where(KnowledgeDocument.vector_status == status)
        count_stmt = count_stmt.where(KnowledgeDocument.vector_status == status)

    total = session.exec(count_stmt).one()
    items = session.exec(
        stmt.order_by(KnowledgeDocument.uploaded_at.desc(), KnowledgeDocument.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()

    category_stmt = (
        select(KnowledgeDocument.category, func.count(KnowledgeDocument.id))
        .group_by(KnowledgeDocument.category)
        .order_by(func.count(KnowledgeDocument.id).desc())
    )
    status_stmt = (
        select(KnowledgeDocument.vector_status, func.count(KnowledgeDocument.id))
        .group_by(KnowledgeDocument.vector_status)
    )
    file_type_stmt = (
        select(KnowledgeDocument.file_type, func.count(KnowledgeDocument.id))
        .group_by(KnowledgeDocument.file_type)
    )
    indexed_stmt = select(func.count(KnowledgeDocument.id)).where(KnowledgeDocument.vector_status == "synced")
    recent_stmt = select(KnowledgeDocument).order_by(KnowledgeDocument.uploaded_at.desc(), KnowledgeDocument.id.desc()).limit(5)
    for condition in scope_filters:
        category_stmt = category_stmt.where(condition)
        status_stmt = status_stmt.where(condition)
        file_type_stmt = file_type_stmt.where(condition)
        indexed_stmt = indexed_stmt.where(condition)
        recent_stmt = recent_stmt.where(condition)

    categories = [
        KnowledgeCategoryCount(category=(row[0] or "uncategorized"), count=row[1])
        for row in session.exec(category_stmt).all()
    ]
    status_counts = [
        KnowledgeStatusCount(status=(row[0] or "pending"), count=row[1])
        for row in session.exec(status_stmt).all()
    ]
    file_type_counts = [
        KnowledgeFileTypeCount(file_type=(row[0] or "other"), count=row[1])
        for row in session.exec(file_type_stmt).all()
    ]
    return KnowledgeDocumentListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        categories=categories,
        status_counts=status_counts,
        file_type_counts=file_type_counts,
        recent=session.exec(recent_stmt).all(),
        indexed_count=session.exec(indexed_stmt).one(),
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
):
    category = category_form or category_query
    project_id = project_id_form if project_id_form is not None else project_id_query
    client_id = client_id_form if client_id_form is not None else client_id_query

    if project_id is not None:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "Project not found")

    suffix = Path(file.filename or "file").suffix.lower()
    dest_name = f"{uuid.uuid4().hex}{suffix}"
    dest_file = KB_UPLOADS / dest_name

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

    background_tasks.add_task(_index_background, doc.id, str(dest_file))
    return doc


def _index_background(doc_id: int, file_path: str) -> None:
    with Session(engine) as session:
        doc = session.get(KnowledgeDocument, doc_id)
        if not doc:
            return
        doc.vector_status = "processing"
        doc.vector_progress = 0.0
        session.add(doc)
        session.commit()
        try:
            text = parser.extract_text(file_path)
        except Exception:
            doc.vector_status = "failed"
            doc.vector_progress = 0.0
            session.add(doc)
            session.commit()
            return
        if not text.strip():
            doc.vector_status = "failed"
            doc.vector_progress = 0.0
            session.add(doc)
            session.commit()
            return
        asyncio.run(rag.index_document(doc, text, session))


@router.post("/documents/{doc_id}/reindex")
def reindex_document(
    doc_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    doc = session.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    full_path = UPLOADS_DIR / doc.path
    if not full_path.is_file():
        raise HTTPException(404, "Document file not found")

    doc.vector_status = "pending"
    doc.vector_progress = 0.0
    doc.chunk_count = 0
    session.add(doc)
    session.commit()
    session.refresh(doc)

    background_tasks.add_task(_index_background, doc.id, str(full_path))
    return doc


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int, session: Session = Depends(get_session)):
    doc = session.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    for c in session.exec(select(DocumentChunk).where(DocumentChunk.document_id == doc_id)).all():
        session.delete(c)
    full_path = UPLOADS_DIR / doc.path
    if full_path.is_file():
        full_path.unlink()
    session.delete(doc)
    session.commit()
    return {"ok": True}


@router.get("/stats")
def get_stats(session: Session = Depends(get_session)):
    doc_count = session.exec(select(func.count(KnowledgeDocument.id))).one()
    chunk_count = session.exec(select(func.count(DocumentChunk.id))).one()
    return {"document_count": doc_count, "total_vectors": chunk_count}


@router.post("/query")
def query_knowledge(
    query: str,
    doc_ids: Optional[List[int]] = None,
    project_id: Optional[int] = None,
    client_id: Optional[int] = None,
    session: Session = Depends(get_session),
):
    result = rag.retrieve(query, session, doc_ids, project_id=project_id, client_id=client_id)
    return {"context": result}
