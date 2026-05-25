"""RAG context builder for knowledge documents."""
import sys
from typing import Optional

from sqlmodel import Session, select

from app.models.db import ClientRecord, KnowledgeDocument, Project
from app.services.rag import retrieve_structured as _retrieve_structured


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
        if project and project.client.strip():
            client = session.exec(
                select(ClientRecord).where(ClientRecord.name.ilike(project.client.strip()))
            ).first()
            if client:
                client_id = client.id
            else:
                # Fall back to the current project instead of widening to global retrieval.
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
        return {"text": "", "sources": []}

    ctx = _current_retrieve_structured()(
        query,
        session,
        rag_doc_ids,
        project_id=effective_project_id,
        client_id=client_id,
    )
    
    return {
        "text": ctx.to_text(),
        "sources": [r.to_dict() for r in ctx.results],
        "query": ctx.query,
    }
