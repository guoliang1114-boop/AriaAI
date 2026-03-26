"""Knowledge base router — document upload, indexing, RAG retrieval."""
from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlmodel import Session, select, func

from app.config import UPLOADS_DIR
from app.database import get_session, engine
from app.models.db import KnowledgeDocument, DocumentChunk
from app.services import parser, rag

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

KB_UPLOADS = UPLOADS_DIR / "knowledge"
KB_UPLOADS.mkdir(parents=True, exist_ok=True)


@router.get("/documents")
def list_documents(session: Session = Depends(get_session)):
    return session.exec(select(KnowledgeDocument).order_by(KnowledgeDocument.uploaded_at.desc())).all()


@router.post("/documents", status_code=201)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = "",
    session: Session = Depends(get_session),
):
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
        text = parser.extract_text(file_path)
        if not text.strip():
            doc.vector_status = "failed"
            session.add(doc)
            session.commit()
            return
        asyncio.run(rag.index_document(doc, text, session))


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: int, session: Session = Depends(get_session)):
    doc = session.get(KnowledgeDocument, doc_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    for c in session.exec(select(DocumentChunk).where(DocumentChunk.document_id == doc_id)).all():
        session.delete(c)
    full_path = UPLOADS_DIR / doc.path
    if full_path.exists():
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
    session: Session = Depends(get_session),
):
    result = rag.retrieve(query, session, doc_ids)
    return {"context": result}
