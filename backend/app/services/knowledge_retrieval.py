from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from sqlmodel import Session, select

from app.models.db import User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_ingestion import deterministic_embedding, parse_embedding
from app.services.knowledge_permissions import can_access_source, filter_chunks_by_permission

TOP_K_DEFAULT = 8
RELEVANCE_THRESHOLD = 0.6
QUERY_EXPANSIONS: dict[str, set[str]] = {
    "战略": {"strategy", "规划", "蓝图"},
    "诊断": {"assessment", "评估", "现状"},
    "会员": {"member", "crm", "用户"},
    "运营": {"operation", "增长", "转化"},
    "方法论": {"methodology", "框架", "模型"},
    "案例": {"case", "复盘", "经验"},
}


@dataclass
class KnowledgeSearchResult:
    id: int
    document_id: int
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
    if not a or not b:
        return 0.0
    va = np.array(a, dtype=float)
    vb = np.array(b, dtype=float)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def _parse_json(raw: str, default):
    try:
        value = json.loads(raw or "")
    except json.JSONDecodeError:
        return default
    return value if isinstance(value, type(default)) else default


def _matches_scope(doc: KnowledgeV1Document, scope_types: list[str] | None, scope_ids: list[int] | None) -> bool:
    if scope_types and doc.scope_type not in scope_types:
        return False
    if scope_ids and doc.scope_id not in scope_ids:
        return False
    return True


def _expanded_query_terms(query: str) -> set[str]:
    terms = {term.lower() for term in query.split() if term.strip()}
    compact = query.lower().strip()
    if compact:
        terms.add(compact)
    for key, expansions in QUERY_EXPANSIONS.items():
        if key in query:
            terms.update(item.lower() for item in expansions)
    return terms


def _scope_attempts(scope_types: list[str] | None, scope_ids: list[int] | None) -> list[tuple[list[str] | None, list[int] | None]]:
    attempts: list[tuple[list[str] | None, list[int] | None]] = [(scope_types, scope_ids)]
    normalized = set(scope_types or [])
    if "project" in normalized:
        attempts.append((["project", "client", "workspace"], scope_ids))
        attempts.append((["client", "workspace"], None))
    elif "client" in normalized:
        attempts.append((["client", "workspace"], scope_ids))
        attempts.append((["workspace"], None))
    elif scope_types:
        attempts.append((None, None))
    seen: set[tuple[tuple[str, ...] | None, tuple[int, ...] | None]] = set()
    unique: list[tuple[list[str] | None, list[int] | None]] = []
    for types, ids in attempts:
        key = (tuple(types) if types else None, tuple(ids) if ids else None)
        if key not in seen:
            unique.append((types, ids))
            seen.add(key)
    return unique


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
) -> dict[str, Any]:
    started = time.perf_counter()
    normalized_top_k = max(1, min(int(top_k or TOP_K_DEFAULT), 20))
    query_embedding = deterministic_embedding(query)

    stmt = (
        select(KnowledgeChunk)
        .join(KnowledgeV1Document, KnowledgeV1Document.id == KnowledgeChunk.document_id)
        .where(KnowledgeV1Document.status == "indexed")
    )
    chunks = session.exec(stmt).all()
    chunks = filter_chunks_by_permission(user, chunks, session)

    doc_ids = {chunk.document_id for chunk in chunks}
    docs = session.exec(select(KnowledgeV1Document).where(KnowledgeV1Document.id.in_(doc_ids))).all() if doc_ids else []
    doc_map = {doc.id: doc for doc in docs}
    source_ids = {doc.source_id for doc in docs}
    sources = session.exec(select(KnowledgeSource).where(KnowledgeSource.id.in_(source_ids))).all() if source_ids else []
    source_map = {source.id: source for source in sources}

    scored: list[tuple[float, KnowledgeChunk]] = []
    query_terms = _expanded_query_terms(query)
    attempted_scope: dict[str, Any] = {"scope_types": scope_types, "scope_ids": scope_ids}
    for attempt_scope_types, attempt_scope_ids in _scope_attempts(scope_types, scope_ids):
        scored = []
        for chunk in chunks:
            doc = doc_map.get(chunk.document_id)
            if not doc or not _matches_scope(doc, attempt_scope_types, attempt_scope_ids):
                continue
            source = source_map.get(doc.source_id)
            if not source or not can_access_source(user, source, session):
                continue
            metadata = _parse_json(doc.metadata_json, {})
            if metadata.get("confidential_level") == "do_not_generate" or metadata.get("reuse_policy") == "do_not_generate":
                continue
            if confidential_levels and metadata.get("confidential_level") not in confidential_levels:
                continue
            if template_keys and metadata.get("template_key") not in template_keys:
                continue
            if industries and not set(industries).intersection(set(metadata.get("industries") or [])):
                continue
            if service_lines and not set(service_lines).intersection(set(metadata.get("service_lines") or [])):
                continue
            if can_generate is True and metadata.get("reuse_policy") not in {"can_generate", "reference_only"}:
                continue

            vector_score = cosine_similarity(query_embedding, parse_embedding(chunk.embedding))
            lowered = chunk.content.lower()
            text_score = 0.0
            if query_terms:
                text_score = sum(1 for term in query_terms if term and term in lowered) / len(query_terms)
            relevance = 0.7 * vector_score + 0.3 * text_score
            if relevance > 0:
                scored.append((relevance, chunk))
        if scored:
            attempted_scope = {"scope_types": attempt_scope_types, "scope_ids": attempt_scope_ids}
            break

    scored.sort(key=lambda item: item[0], reverse=True)
    selected = scored[:normalized_top_k]
    results: list[KnowledgeSearchResult] = []
    for relevance, chunk in selected:
        doc = doc_map[chunk.document_id]
        metadata = _parse_json(doc.metadata_json, {})
        results.append(
            KnowledgeSearchResult(
                id=chunk.id or 0,
                document_id=doc.id or 0,
                document_title=doc.title,
                document_path=doc.path,
                heading_path=_parse_json(chunk.heading_path, []),
                content=chunk.content,
                scope_type=doc.scope_type,
                scope_id=doc.scope_id,
                source_id=doc.source_id,
                relevance=relevance,
                metadata=metadata,
            )
        )

    return {
        "chunks": [result.to_dict() for result in results],
        "total_found": len(results),
        "query_time_ms": round((time.perf_counter() - started) * 1000),
        "low_confidence": len([r for r in results if r.relevance >= RELEVANCE_THRESHOLD]) < min(3, normalized_top_k),
        "expanded_terms": sorted(query_terms),
        "scope_used": attempted_scope,
    }
