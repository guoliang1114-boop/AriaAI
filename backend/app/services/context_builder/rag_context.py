"""RAG context builder for legacy and source-scoped knowledge documents."""
from __future__ import annotations

from dataclasses import dataclass
import logging
import sys
from typing import Optional

from sqlmodel import Session, select

from app.models.db import KnowledgeDocument, Project, User
from app.services.agent_harness.knowledge_evidence import (
    build_knowledge_evidence_manifest,
    build_knowledge_evidence_prompt,
    knowledge_evidence_references,
)
from app.services.rag import retrieve_structured as _retrieve_structured
from app.services.knowledge_retrieval import search_knowledge
from app.services.project_clients import find_client_for_project


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _SourceScopedRetrievalResult:
    """Adapter into the existing content-free Knowledge Evidence contract."""

    content: str
    document_name: str
    document_id: int
    knowledge_source_id: int
    chunk_index: int
    score: float
    document_namespace: str = "source_scoped"


def retrieve_structured(*args, **kwargs):
    """Compatibility wrapper kept patchable from app.services.context_builder."""

    return _retrieve_structured(*args, **kwargs)


def _current_retrieve_structured():
    package = sys.modules.get("app.services.context_builder")
    return getattr(package, "retrieve_structured", retrieve_structured) if package else retrieve_structured


def _source_scoped_scope_pairs(
    *,
    knowledge_scope: str,
    project_id: int | None,
    client_id: int | None,
    user_id: int,
) -> list[tuple[str, int | None]]:
    """Return exact scope identities; IDs from different domains never mix."""

    if knowledge_scope == "project":
        return [("project", project_id)] if project_id is not None else []
    if knowledge_scope == "client":
        if client_id is not None:
            return [("client", client_id)]
        return [("project", project_id)] if project_id is not None else []
    if knowledge_scope in {"global", "workspace"}:
        return [
            ("user", user_id),
            ("workspace", None),
            ("global", None),
        ]
    return []


def _source_scoped_results(
    *,
    session: Session,
    user: User,
    query: str,
    scope_pairs: list[tuple[str, int | None]],
) -> list[_SourceScopedRetrievalResult]:
    if not scope_pairs:
        return []
    payload = search_knowledge(
        session=session,
        user=user,
        query=query,
        scope_pairs=scope_pairs,
    )
    results: list[_SourceScopedRetrievalResult] = []
    for item in list(payload.get("chunks") or []):
        if not isinstance(item, dict):
            continue
        try:
            document_id = int(item.get("document_id"))
            knowledge_source_id = int(item.get("source_id"))
            chunk_index = max(0, int(item.get("chunk_index") or 0))
            score = float(item.get("relevance") or 0.0)
        except (TypeError, ValueError):
            continue
        content = str(item.get("content") or "")
        title = str(item.get("document_title") or "").strip()
        if (
            document_id <= 0
            or knowledge_source_id <= 0
            or not content.strip()
            or not title
        ):
            continue
        results.append(
            _SourceScopedRetrievalResult(
                content=content,
                document_name=title,
                document_id=document_id,
                knowledge_source_id=knowledge_source_id,
                chunk_index=chunk_index,
                score=score,
            )
        )
    return results


def _rag_payload(
    results: list[object],
    *,
    query: str,
    knowledge_scope: str,
    project_id: int | None,
    retrieval_mode: str,
    source_scoped_attempted: bool,
    source_scoped_unavailable: bool = False,
) -> dict:
    evidence_manifest = build_knowledge_evidence_manifest(
        results,
        knowledge_scope=knowledge_scope,
        project_id=project_id,
    )
    return {
        "text": build_knowledge_evidence_prompt(results, evidence_manifest),
        "sources": knowledge_evidence_references(evidence_manifest),
        "query": query,
        "evidence_manifest": evidence_manifest,
        "retrieval_mode": retrieval_mode,
        "source_scoped_attempted": source_scoped_attempted,
        "source_scoped_unavailable": source_scoped_unavailable,
        "legacy_fallback_used": retrieval_mode == "legacy_fallback",
    }


def build_rag_context(
    session: Session,
    query: str,
    rag_doc_ids: Optional[list[int]] = None,
    project_id: Optional[int] = None,
    knowledge_scope: str = "global",
    auto_trigger: bool = True,
    accessible_project_ids: Optional[list[int]] = None,
    accessible_client_ids: Optional[list[int]] = None,
    requesting_user_id: Optional[int] = None,
) -> dict:
    """
    Build RAG context from knowledge documents.
    
    Returns structured dict with both text for LLM and sources for citations.
    """
    # Perform structured retrieval. In a project chat, the selected knowledge scope
    # should behave like ambient workspace context: if scoped vectorized documents
    # exist, retrieve from them without requiring the user to type #doc.
    client_id = None
    effective_project_id = None
    if not rag_doc_ids and knowledge_scope == "project" and project_id is not None:
        effective_project_id = project_id
    elif not rag_doc_ids and knowledge_scope == "client" and project_id is not None:
        project = session.get(Project, project_id)
        if project is not None:
            client = find_client_for_project(session, project)
            if client is not None:
                client_id = client.id
            else:
                # An unlinked or dangling client identity must stay bounded to
                # the current project instead of widening to global retrieval.
                effective_project_id = project_id

    source_scoped_attempted = False
    source_scoped_unavailable = False
    source_scoped_trigger = (
        not rag_doc_ids
        and requesting_user_id is not None
        and auto_trigger
        and (
            "#doc" in query
            or (project_id is not None and knowledge_scope in {"project", "client"})
        )
    )
    if source_scoped_trigger:
        source_scoped_attempted = True
        user = session.get(User, requesting_user_id)
        if user is not None and user.is_active:
            scope_pairs = _source_scoped_scope_pairs(
                knowledge_scope=knowledge_scope,
                project_id=effective_project_id,
                client_id=client_id,
                user_id=int(user.id or 0),
            )
            try:
                source_scoped_results = _source_scoped_results(
                    session=session,
                    user=user,
                    query=query,
                    scope_pairs=scope_pairs,
                )
            except Exception:
                source_scoped_unavailable = True
                logger.warning(
                    "Source-scoped knowledge retrieval failed; using bounded legacy fallback",
                    exc_info=True,
                )
            else:
                if source_scoped_results:
                    return _rag_payload(
                        list(source_scoped_results),
                        query=query,
                        knowledge_scope=knowledge_scope,
                        project_id=project_id,
                        retrieval_mode="source_scoped",
                        source_scoped_attempted=True,
                    )

    should_retrieve = bool(rag_doc_ids) or (auto_trigger and "#doc" in query)
    if not should_retrieve and auto_trigger and project_id is not None and knowledge_scope in {"project", "client"}:
        scoped_docs_stmt = select(KnowledgeDocument.id).where(KnowledgeDocument.vector_status == "synced")
        if effective_project_id is not None:
            scoped_docs_stmt = scoped_docs_stmt.where(KnowledgeDocument.project_id == effective_project_id)
        elif client_id is not None:
            scoped_docs_stmt = scoped_docs_stmt.where(KnowledgeDocument.client_id == client_id)
        else:
            scoped_docs_stmt = scoped_docs_stmt.where(KnowledgeDocument.project_id == project_id)
        should_retrieve = session.exec(scoped_docs_stmt.limit(1)).first() is not None

    if not should_retrieve:
        return {
            "text": "",
            "sources": [],
            "evidence_manifest": {},
            "retrieval_mode": "none",
            "source_scoped_attempted": source_scoped_attempted,
            "source_scoped_unavailable": source_scoped_unavailable,
            "legacy_fallback_used": False,
        }

    ctx = _current_retrieve_structured()(
        query,
        session,
        rag_doc_ids,
        project_id=effective_project_id,
        client_id=client_id,
        accessible_project_ids=accessible_project_ids,
        accessible_client_ids=accessible_client_ids,
    )
    results = list(getattr(ctx, "results", None) or [])
    if not results:
        # Compatibility for test/internal retrieval adapters that still return
        # prompt text without structured result identities. Such text may enter
        # the provider context but cannot become a durable citation claim.
        legacy_text = ctx.to_text()
        has_legacy_text = bool(legacy_text)
        return {
            "text": legacy_text,
            "sources": [],
            "query": getattr(ctx, "query", query),
            "evidence_manifest": {},
            "retrieval_mode": (
                "legacy_fallback"
                if source_scoped_attempted and has_legacy_text
                else "legacy_explicit"
                if rag_doc_ids and has_legacy_text
                else "legacy"
                if has_legacy_text
                else "none"
            ),
            "source_scoped_attempted": source_scoped_attempted,
            "source_scoped_unavailable": source_scoped_unavailable,
            "legacy_fallback_used": source_scoped_attempted and has_legacy_text,
        }
    return _rag_payload(
        results,
        query=getattr(ctx, "query", query),
        knowledge_scope=knowledge_scope,
        project_id=project_id,
        retrieval_mode=(
            "legacy_fallback"
            if source_scoped_attempted
            else "legacy_explicit"
            if rag_doc_ids
            else "legacy"
        ),
        source_scoped_attempted=source_scoped_attempted,
        source_scoped_unavailable=source_scoped_unavailable,
    )
