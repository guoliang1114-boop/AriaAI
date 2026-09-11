from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from sqlalchemy import and_, case, or_
from sqlmodel import Session, select

from app.models.db import User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_ingestion import deterministic_embedding, parse_embedding
from app.services.knowledge_permissions import can_access_source
from app.services.knowledge_ranking import expanded_terms, lexical_score, normalize_text

TOP_K_DEFAULT = 8
RELEVANCE_THRESHOLD = 0.6


@dataclass
class KnowledgeSearchResult:
    id: int
    document_id: int
    chunk_index: int
    document_title: str
    document_path: str
    heading_path: list[str]
    content: str
    scope_type: str
    scope_id: int | None
    source_id: int
    relevance: float
    metadata: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "document_id": self.document_id,
            "chunk_index": self.chunk_index,
            "document_title": self.document_title,
            "document_path": self.document_path,
            "heading_path": self.heading_path,
            "content": self.content,
            "source_type": self.scope_type,
            "scope_type": self.scope_type,
            "scope_id": self.scope_id,
            "source_id": self.source_id,
            "relevance": round(self.relevance, 4),
            "metadata": self.metadata,
        }


def cosine_similarity(a: list[float], b: list[float]) -> float:
    try:
        va = np.asarray(a, dtype=float)
        vb = np.asarray(b, dtype=float)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    if va.ndim != 1 or vb.ndim != 1 or va.size == 0 or va.shape != vb.shape:
        return 0.0
    if not np.isfinite(va).all() or not np.isfinite(vb).all():
        return 0.0
    with np.errstate(over="ignore", invalid="ignore"):
        denom = np.linalg.norm(va) * np.linalg.norm(vb)
        if not np.isfinite(denom) or denom == 0:
            return 0.0
        return float(np.clip(np.dot(va, vb) / denom, -1.0, 1.0))


def _parse_json(raw: str, default):
    try:
        value = json.loads(raw or "")
    except (TypeError, ValueError):
        return default
    return value if isinstance(value, type(default)) else default


def _metadata_matches(metadata: dict, **filters) -> bool:
    # Malformed policy fields are not permission to reuse the document.
    for field in ("confidential_level", "reuse_policy"):
        if field in metadata and not isinstance(metadata[field], str):
            return False
    if metadata.get("confidential_level") == "do_not_generate" or metadata.get("reuse_policy") == "do_not_generate":
        return False
    for field, values in (("confidential_level", filters["confidential_levels"]), ("template_key", filters["template_keys"])):
        if values and metadata.get(field) not in values:
            return False
    for field in ("industries", "service_lines"):
        values = filters[field]
        stored = metadata.get(field)
        if values and not (isinstance(stored, list) and any(isinstance(item, str) and item in values for item in stored)):
            return False
    return filters["can_generate"] is not True or metadata.get("reuse_policy") in ("can_generate", "reference_only")


def search_knowledge(
    *,
    session: Session,
    user: User,
    query: str,
    scope_types: list[str] | None = None,
    scope_ids: list[int] | None = None,
    template_keys: list[str] | None = None,
    industries: list[str] | None = None,
    service_lines: list[str] | None = None,
    confidential_levels: list[str] | None = None,
    can_generate: bool | None = None,
    top_k: int = TOP_K_DEFAULT,
    document_ids: list[int] | None = None,
    scope_pairs: list[tuple[str, int | None]] | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    normalized_top_k = max(1, min(int(top_k or TOP_K_DEFAULT), 20))
    primary, related = expanded_terms(query)
    scope_used: dict[str, Any] = {"scope_types": scope_types, "scope_ids": scope_ids}
    normalized_pairs = list(dict.fromkeys(
        (str(kind).strip().lower(), identity)
        for kind, identity in (scope_pairs or [])[:20]
        if isinstance(kind, str) and kind.strip()
        and (identity is None or (type(identity) is int and identity > 0))
    ))
    if scope_pairs is not None:
        scope_used = {"scope_pairs": [
            {"scope_type": kind, "scope_id": identity} for kind, identity in normalized_pairs
        ]}
        if scope_types is not None:
            scope_used["scope_types"] = scope_types
        if scope_ids is not None:
            scope_used["scope_ids"] = scope_ids

    def response(results: list[KnowledgeSearchResult]) -> dict[str, Any]:
        return {
            "chunks": [result.to_dict() for result in results],
            "total_found": len(results),
            "query_time_ms": round((time.perf_counter() - started) * 1000),
            "low_confidence": sum(result.relevance >= RELEVANCE_THRESHOLD for result in results) < min(3, normalized_top_k),
            "expanded_terms": sorted(primary | related),
            "scope_used": scope_used,
        }

    if not primary or not user.is_active:
        return response([])
    normalized_document_ids = sorted({
        value for value in (document_ids or [])[:100] if type(value) is int and value > 0
    })
    # Explicit empty/invalid selections mean nothing selected, never "all".
    if document_ids is not None and not normalized_document_ids:
        return response([])
    if scope_pairs is not None and not normalized_pairs:
        return response([])
    if scope_types == [] or scope_ids == []:
        return response([])

    doc, source = KnowledgeV1Document, KnowledgeSource
    scope_identity = case((source.scope_type == "user", source.owner_user_id), else_=source.scope_id)
    stmt = select(doc, source).join(source, source.id == doc.source_id).where(
        doc.status == "indexed",
        source.status == "active",
        doc.scope_type == source.scope_type,
        or_(doc.scope_id == source.scope_id, and_(doc.scope_id.is_(None), source.scope_id.is_(None))),
    )
    if normalized_document_ids:
        stmt = stmt.where(doc.id.in_(normalized_document_ids))
    if scope_pairs is not None:
        stmt = stmt.where(or_(*[
            and_(source.scope_type == kind, scope_identity.is_(None) if identity is None else scope_identity == identity)
            for kind, identity in normalized_pairs
        ]))
    # Both filter styles are hard bounds; no fallback to a wider namespace.
    if scope_types is not None:
        stmt = stmt.where(source.scope_type.in_(scope_types))
    if scope_ids is not None:
        stmt = stmt.where(scope_identity.in_([value for value in scope_ids if type(value) is int and value > 0]))

    docs: dict[int, tuple[KnowledgeV1Document, dict]] = {}
    source_access: dict[int, bool] = {}
    for document, knowledge_source in session.exec(stmt):
        source_id = int(knowledge_source.id)
        if source_id not in source_access:
            source_access[source_id] = can_access_source(user, knowledge_source, session)
        if not source_access[source_id]:
            continue
        metadata = _parse_json(document.metadata_json, {})
        if _metadata_matches(
            metadata, template_keys=template_keys, industries=industries,
            service_lines=service_lines, confidential_levels=confidential_levels,
            can_generate=can_generate,
        ):
            docs[int(document.id)] = (document, metadata)
    if not docs:
        return response([])

    query_embedding = deterministic_embedding(query)
    # Keep at most top_k bodies in memory while iterating authorized chunks.
    # Content duplicates cannot crowd out independent evidence.
    best: dict[str, tuple[tuple[float, int, int, int], KnowledgeSearchResult]] = {}
    document_ids_to_read = sorted(docs)
    # Bound SQL IN parameters for large authorized libraries on SQLite and PG.
    for offset in range(0, len(document_ids_to_read), 500):
        chunk_stmt = select(KnowledgeChunk).where(
            KnowledgeChunk.document_id.in_(document_ids_to_read[offset:offset + 500])
        ).execution_options(yield_per=100)
        for chunk in session.exec(chunk_stmt):
            if not chunk.content.strip():
                continue
            document, metadata = docs[chunk.document_id]
            heading_path = [
                item for item in _parse_json(chunk.heading_path, []) if isinstance(item, str)
            ]
            text_score = lexical_score(
                primary, related, chunk.content, " ".join([document.title, *heading_path]),
            )
            if text_score <= 0:
                continue
            vector_score = max(0.0, cosine_similarity(query_embedding, parse_embedding(chunk.embedding)))
            relevance = min(1.0, text_score + 0.05 * vector_score)
            chunk_index = max(0, int(chunk.chunk_index or 0))
            rank = (relevance, -int(document.id), -chunk_index, -int(chunk.id))
            fingerprint = hashlib.sha256(
                " ".join(normalize_text(chunk.content).split()).encode("utf-8")
            ).hexdigest()
            if fingerprint in best and best[fingerprint][0] >= rank:
                continue
            if fingerprint not in best and len(best) >= normalized_top_k:
                weakest = min(best, key=lambda key: best[key][0])
                if best[weakest][0] >= rank:
                    continue
                del best[weakest]
            best[fingerprint] = (rank, KnowledgeSearchResult(
                id=int(chunk.id), document_id=int(document.id), chunk_index=chunk_index,
                document_title=document.title, document_path=document.path,
                heading_path=heading_path, content=chunk.content,
                scope_type=document.scope_type, scope_id=document.scope_id,
                source_id=document.source_id, relevance=relevance, metadata=metadata,
            ))

    return response([item[1] for item in sorted(best.values(), key=lambda item: item[0], reverse=True)])
