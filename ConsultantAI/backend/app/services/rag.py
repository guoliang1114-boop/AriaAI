"""RAG service — chunking, embedding, retrieval."""
from __future__ import annotations

import json
from typing import List, Optional

import numpy as np
from fastembed import TextEmbedding
from sqlmodel import Session, select

from app.config import CHUNK_SIZE, CHUNK_OVERLAP, TOP_K_RESULTS, EMBEDDING_MODEL
from app.models.db import DocumentChunk, KnowledgeDocument

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


def retrieve(query: str, session: Session, doc_ids: Optional[List[int]] = None) -> str:
    query_embedding = embed_texts([query])[0]

    stmt = select(DocumentChunk)
    if doc_ids:
        stmt = stmt.where(DocumentChunk.document_id.in_(doc_ids))

    chunks = session.exec(stmt).all()
    if not chunks:
        return ""

    scored = [
        (cosine_similarity(query_embedding, chunk.embedding), chunk)
        for chunk in chunks
        if chunk.embedding_json != "[]"
    ]
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:TOP_K_RESULTS]

    if not top:
        return ""

    lines = []
    for score, chunk in top:
        doc = session.get(KnowledgeDocument, chunk.document_id)
        doc_name = doc.name if doc else "Unknown"
        lines.append(f"[{doc_name}] {chunk.content}")

    return "\n\n---\n\n".join(lines)


async def index_document(document: KnowledgeDocument, text: str, session: Session) -> None:
    document.vector_status = "processing"
    document.vector_progress = 0.0
    session.add(document)
    session.commit()

    old_chunks = session.exec(
        select(DocumentChunk).where(DocumentChunk.document_id == document.id)
    ).all()
    for c in old_chunks:
        session.delete(c)
    session.commit()

    chunks = chunk_text(text)
    document.chunk_count = len(chunks)

    embeddings = embed_texts(chunks)

    for i, (chunk_text_val, emb) in enumerate(zip(chunks, embeddings)):
        chunk = DocumentChunk(
            document_id=document.id,
            chunk_index=i,
            content=chunk_text_val,
            embedding_json=json.dumps(emb),
        )
        session.add(chunk)
        document.vector_progress = (i + 1) / len(chunks)
        session.add(document)
        session.commit()

    document.vector_status = "synced"
    document.vector_progress = 1.0
    session.add(document)
    session.commit()
