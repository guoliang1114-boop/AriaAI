"""RAG context builder for knowledge documents."""
import sys
from typing import Optional

from sqlmodel import Session, select

from app.models.db import KnowledgeDocument, Project
from app.services.agent_harness.knowledge_evidence import (
    build_knowledge_evidence_manifest,
    build_knowledge_evidence_prompt,
    knowledge_evidence_references,
)
from app.services.rag import retrieve_structured as _retrieve_structured
from app.services.project_clients import find_client_for_project


def retrieve_structured(*args, **kwargs):
    """Compatibility wrapper kept patchable from app.services.context_builder."""

    return _retrieve_structured(*args, **kwargs)


def _current_retrieve_structured():
    package = sys.modules.get("app.services.context_builder")
    return getattr(package, "retrieve_structured", retrieve_structured) if package else retrieve_structured


def build_rag_context(
    session: Session,
    query: str,
    rag_doc_ids: Optional[list[int]] = None,
    project_id: Optional[int] = None,
    knowledge_scope: str = "global",
    auto_trigger: bool = True,
    accessible_project_ids: Optional[list[int]] = None,
    accessible_client_ids: Optional[list[int]] = None,
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
        return {"text": "", "sources": [], "evidence_manifest": {}}

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
        return {
            "text": ctx.to_text(),
            "sources": [],
            "query": getattr(ctx, "query", query),
            "evidence_manifest": {},
        }
    evidence_manifest = build_knowledge_evidence_manifest(
        results,
        knowledge_scope=knowledge_scope,
        project_id=project_id,
    )
    return {
        "text": build_knowledge_evidence_prompt(results, evidence_manifest),
        "sources": knowledge_evidence_references(evidence_manifest),
        "query": getattr(ctx, "query", query),
        "evidence_manifest": evidence_manifest,
    }
