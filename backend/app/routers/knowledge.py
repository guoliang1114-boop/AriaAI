"""Knowledge base router — document upload, indexing, RAG retrieval."""
from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File, BackgroundTasks, Query
from pydantic import BaseModel
from sqlmodel import Session, select, func

from app.config import UPLOADS_DIR
from app.database import get_session, engine
from app.models.db import KnowledgeDocument, DocumentChunk, Project
from app.services import parser, rag

from app.routers.auth import get_current_user

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
