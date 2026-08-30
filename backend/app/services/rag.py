"""RAG service — chunking, embedding, retrieval."""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import HTTPException

import numpy as np
from fastembed import TextEmbedding
from sqlalchemy import and_, or_
from sqlmodel import Session, select

from app.config import CHUNK_SIZE, CHUNK_OVERLAP, TOP_K_RESULTS, EMBEDDING_MODEL
from app.models.db import ClientRecord, DocumentChunk, KnowledgeDocument, Project, User
from app.services.knowledge_permissions import (
    lock_and_require_legacy_document_write,
    lock_legacy_document_for_trusted_system,
)
from app.services.project_clients import find_client_for_project

_model: Optional[TextEmbedding] = None


def _get_model() -> TextEmbedding:
    global _model
    if _model is None:
        _model = TextEmbedding(f"sentence-transformers/{EMBEDDING_MODEL}")
    return _model


def chunk_text(text: str) -> List[str]:
    chunks, start = [], 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end])
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return [c for c in chunks if c.strip()]


def embed_texts(texts: List[str]) -> List[List[float]]:
    model = _get_model()
    return [emb.tolist() for emb in model.embed(texts)]


def cosine_similarity(a: List[float], b: List[float]) -> float:
    va, vb = np.array(a), np.array(b)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


class RetrievalResult:
    """Structured RAG retrieval result with source attribution."""
    def __init__(self, content: str, document_name: str, document_id: int, 
                 chunk_index: int, score: float):
        self.content = content
        self.document_name = document_name
        self.document_id = document_id
        self.chunk_index = chunk_index
        self.score = score
    
    def to_dict(self) -> dict:
        return {
            "content": self.content,
            "document_name": self.document_name,
            "document_id": self.document_id,
            "chunk_index": self.chunk_index,
            "score": round(self.score, 4),
        }


class RetrievalContext:
    """Complete RAG context with sources for frontend display."""
    def __init__(self, results: List[RetrievalResult], query: str):
        self.results = results
        self.query = query
    
    def to_text(self) -> str:
        """Convert to legacy text format for LLM prompt."""
        if not self.results:
            return ""
        lines = []
        for r in self.results:
            lines.append(f"[{r.document_name}] {r.content}")
        return "\n\n---\n\n".join(lines)
    
    def to_dict(self) -> dict:
        """Convert to structured format for API response."""
        return {
            "query": self.query,
            "results_count": len(self.results),
            "results": [r.to_dict() for r in self.results],
            "text": self.to_text(),
        }


def retrieve_structured(
    query: str,
    session: Session,
    doc_ids: Optional[List[int]] = None,
    project_id: Optional[int] = None,
    client_id: Optional[int] = None,
    accessible_project_ids: Optional[List[int]] = None,
    accessible_client_ids: Optional[List[int]] = None,
) -> RetrievalContext:
    """
    Retrieve relevant chunks with full source attribution.
    
    This is the new primary retrieval function. Use to_text() for LLM prompts,
    or to_dict() for API responses with citation support.
    """
    query_embedding = embed_texts([query])[0]

    stmt = select(DocumentChunk).join(KnowledgeDocument, KnowledgeDocument.id == DocumentChunk.document_id)
    # User-facing chat callers pass their exact ProjectMember inventory. This
    # closes the explicit-doc-id path as well as ambient project/client
    # retrieval: a caller cannot widen retrieval merely by guessing another
    # KnowledgeDocument id. ``None`` is reserved for trusted internal callers;
    # an empty list grants only legacy workspace/global documents.
    if accessible_project_ids is not None or accessible_client_ids is not None:
        allowed_project_ids = list(
            dict.fromkeys(
                int(value)
                for value in (accessible_project_ids or [])
                if isinstance(value, int) and value >= 0
            )
        )
        allowed_client_ids = list(
            dict.fromkeys(
                int(value)
                for value in (accessible_client_ids or [])
                if isinstance(value, int) and value >= 0
            )
        )
        if allowed_project_ids:
            allowed_projects = session.exec(
                select(Project).where(Project.id.in_(allowed_project_ids))
            ).all()
            allowed_client_ids = sorted(
                set(allowed_client_ids)
                | {
                    int(client.id)
                    for project in allowed_projects
                    if (client := find_client_for_project(session, project)) is not None
                    and client.id is not None
                }
            )
        permission_clauses = [
            and_(
                KnowledgeDocument.project_id.is_(None),
                KnowledgeDocument.client_id.is_(None),
            )
        ]
        if allowed_project_ids:
            permission_clauses.append(
                KnowledgeDocument.project_id.in_(allowed_project_ids)
            )
        if allowed_client_ids:
            permission_clauses.append(
                and_(
                    KnowledgeDocument.project_id.is_(None),
                    KnowledgeDocument.client_id.in_(allowed_client_ids),
                )
            )
        stmt = stmt.where(or_(*permission_clauses))
    if doc_ids:
        stmt = stmt.where(DocumentChunk.document_id.in_(doc_ids))
    elif project_id is not None:
        stmt = stmt.where(KnowledgeDocument.project_id == project_id)
    elif client_id is not None:
        stmt = stmt.where(KnowledgeDocument.client_id == client_id)

    chunks = session.exec(stmt).all()
    if not chunks:
        return RetrievalContext([], query)

    scored = [
        (cosine_similarity(query_embedding, chunk.embedding), chunk)
        for chunk in chunks
        if chunk.embedding_json != "[]"
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:TOP_K_RESULTS]

    if not top:
        return RetrievalContext([], query)

    # Fetch document names
    doc_ids_found = list(set(chunk.document_id for _, chunk in top))
    docs = session.exec(select(KnowledgeDocument).where(
        KnowledgeDocument.id.in_(doc_ids_found)
    )).all()
    doc_map = {d.id: d for d in docs}

    results = []
    for score, chunk in top:
        doc = doc_map.get(chunk.document_id)
        results.append(RetrievalResult(
            content=chunk.content,
            document_name=doc.name if doc else "Unknown",
            document_id=chunk.document_id,
            chunk_index=chunk.chunk_index,
            score=score,
        ))

    return RetrievalContext(results, query)


def retrieve(
    query: str,
    session: Session,
    doc_ids: Optional[List[int]] = None,
    project_id: Optional[int] = None,
    client_id: Optional[int] = None,
    accessible_project_ids: Optional[List[int]] = None,
    accessible_client_ids: Optional[List[int]] = None,
) -> str:
    """
    Legacy retrieve function — returns text for LLM prompt.
    
    Use retrieve_structured() for new code that needs source attribution.
    """
    return retrieve_structured(
        query,
        session,
        doc_ids,
        project_id=project_id,
        client_id=client_id,
        accessible_project_ids=accessible_project_ids,
        accessible_client_ids=accessible_client_ids,
    ).to_text()


async def index_document(
    document: KnowledgeDocument,
    text: str,
    session: Session,
    *,
    actor_user_id: int | None = None,
    trusted_system: bool = False,
    expected_source: tuple[object, ...] | None = None,
) -> None:
    """Atomically replace legacy chunks after final actor/scope authorization."""

    if (actor_user_id is None) == (not trusted_system):
        raise ValueError(
            "Legacy knowledge indexing requires actor_user_id or trusted_system=True"
        )
    if document.id is None:
        raise ValueError("Legacy knowledge document must be persisted before indexing")
    document_id = int(document.id)
    expected_source = expected_source or (
        document.project_id,
        document.client_id,
        document.path,
        document.name,
        document.file_type,
    )

    # Chunking/embedding may call a remote provider in production. Do all of it
    # before opening the final write transaction so revocation cannot leave a
    # partially replaced chunk set or a misleading processing receipt.
    chunks = chunk_text(text)
    embeddings = embed_texts(chunks)
    session.rollback()
    if actor_user_id is not None:
        actor = session.get(User, actor_user_id)
        if actor is None:
            raise HTTPException(401, "Not authenticated")
        current, _ = lock_and_require_legacy_document_write(
            session,
            document_id,
            actor,
        )
    else:
        current = lock_legacy_document_for_trusted_system(session, document_id)
    if (
        current.project_id,
        current.client_id,
        current.path,
        current.name,
        current.file_type,
    ) != expected_source:
        session.rollback()
        raise HTTPException(409, "Knowledge document source changed during indexing")

    old_chunks = session.exec(
        select(DocumentChunk)
        .where(DocumentChunk.document_id == document_id)
        .order_by(DocumentChunk.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    for old_chunk in old_chunks:
        session.delete(old_chunk)
    for i, (chunk_text_val, emb) in enumerate(zip(chunks, embeddings)):
        session.add(
            DocumentChunk(
                document_id=document_id,
                chunk_index=i,
                content=chunk_text_val,
                embedding_json=json.dumps(emb),
            )
        )
    current.chunk_count = len(chunks)
    current.vector_status = "synced"
    current.vector_progress = 1.0
    session.add(current)
    session.commit()
