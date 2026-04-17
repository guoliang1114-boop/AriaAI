"""Client management router — CRUD for clients, related docs/projects, and client memory."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ClientRecord, KnowledgeDocument, Project
from app.services.cache import clients_cache
from app.services.claude import complete
from app.services.client_contexts import (
    build_client_memory_data,
    build_client_memory_prompt,
    build_client_memory_promote_prompt,
    build_client_memory_summary_prompt,
    get_client_memory_payload,
    mark_client_memory_stale,
    parse_client_memory,
    save_client_memory,
)
from app.services.project_contexts import normalize_summary_language
from app.services.project_llm import complete_with_selected_model

_CLIENTS_KEY = "all"
_CLIENTS_TTL = 120.0

router = APIRouter(prefix="/clients", tags=["clients"])


class ClientCreate(BaseModel):
    name: str
    industry: str = ""
    contact: str = ""
    notes: str = ""


class ClientUpdate(BaseModel):
    name: Optional[str] = None
    industry: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class AISuggestQuery(BaseModel):
    query: str


class AISuggestion(BaseModel):
    name: str
    industry: str
    contact: str
    notes: str


class ClientOut(BaseModel):
    id: int
    name: str
    industry: str
    contact: str
    notes: str
    created_at: str
    document_count: int
    project_names: list[str]
    client_memory_version: int = 0
    client_memory_stale: bool = True
    client_memory_updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class ClientMemoryResponse(BaseModel):
    client_id: int
    memory: dict
    memory_version: int
    memory_stale: bool
    memory_updated_at: Optional[str] = None


class ClientMemoryStatusResponse(BaseModel):
    client_id: int
    has_memory: bool
    memory_version: int
    memory_stale: bool
    memory_updated_at: Optional[str] = None


class PromoteProjectMemoryRequest(BaseModel):
    project_id: int


class ClientMemorySummaryRequest(BaseModel):
    language: Optional[str] = None


def _normalized_name(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _build_client_out(
    client: ClientRecord,
    docs_by_client: dict[int, list],
    projects_by_client_name: dict[str, list[str]],
) -> ClientOut:
    docs = docs_by_client.get(client.id, [])
    matching = projects_by_client_name.get(_normalized_name(client.name), [])
    return ClientOut(
        id=client.id,
        name=client.name,
        industry=client.industry,
        contact=client.contact,
        notes=client.notes,
        created_at=client.created_at.isoformat(),
        document_count=len(docs),
        project_names=matching,
        client_memory_version=client.client_memory_version,
        client_memory_stale=client.client_memory_stale,
        client_memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
    )


def _client_out(client: ClientRecord, session: Session) -> ClientOut:
    docs = session.exec(select(KnowledgeDocument).where(KnowledgeDocument.client_id == client.id)).all()
    all_projects = session.exec(select(Project)).all()
    client_key = _normalized_name(client.name)
    matching = [project.name for project in all_projects if _normalized_name(project.client) == client_key]
    return ClientOut(
        id=client.id,
        name=client.name,
        industry=client.industry,
        contact=client.contact,
        notes=client.notes,
        created_at=client.created_at.isoformat(),
        document_count=len(docs),
        project_names=matching,
        client_memory_version=client.client_memory_version,
        client_memory_stale=client.client_memory_stale,
        client_memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
    )


@router.get("", response_model=list[ClientOut])
def list_clients(session: Session = Depends(get_session)):
    cached = clients_cache.get(_CLIENTS_KEY)
    if cached is not None:
        return cached

    clients = session.exec(select(ClientRecord).order_by(ClientRecord.name)).all()
    all_docs = session.exec(select(KnowledgeDocument)).all()
    all_projects = session.exec(select(Project)).all()

    docs_by_client: dict[int, list] = {}
    for document in all_docs:
        if document.client_id is not None:
            docs_by_client.setdefault(document.client_id, []).append(document)

    projects_by_name: dict[str, list[str]] = {}
    for project in all_projects:
        key = _normalized_name(project.client)
        if key:
            projects_by_name.setdefault(key, []).append(project.name)

    result = [_build_client_out(client, docs_by_client, projects_by_name) for client in clients]
    clients_cache.set(_CLIENTS_KEY, result, _CLIENTS_TTL)
    return result


@router.post("", response_model=ClientOut)
def create_client(body: ClientCreate, session: Session = Depends(get_session)):
    client = ClientRecord(**body.model_dump())
    session.add(client)
    session.commit()
    session.refresh(client)
    clients_cache.delete(_CLIENTS_KEY)
    return _client_out(client, session)


@router.get("/{client_id}", response_model=ClientOut)
def get_client(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return _client_out(client, session)


@router.put("/{client_id}", response_model=ClientOut)
def update_client(client_id: int, body: ClientUpdate, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(client, field, value)
    session.add(client)
    session.commit()
    session.refresh(client)
    mark_client_memory_stale(session, client_id, trigger="client_updated")
    clients_cache.delete(_CLIENTS_KEY)
    return _client_out(client, session)


@router.delete("/{client_id}", status_code=204)
def delete_client(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    docs = session.exec(select(KnowledgeDocument).where(KnowledgeDocument.client_id == client_id)).all()
    for document in docs:
        document.client_id = None
        session.add(document)
    session.delete(client)
    session.commit()
    clients_cache.delete(_CLIENTS_KEY)


@router.get("/{client_id}/documents")
def list_client_documents(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return session.exec(select(KnowledgeDocument).where(KnowledgeDocument.client_id == client_id)).all()


@router.get("/{client_id}/projects")
def list_client_projects(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    client_key = _normalized_name(client.name)
    matching = [
        project
        for project in session.exec(select(Project)).all()
        if _normalized_name(project.client) == client_key
    ]
    return [
        {
            "id": project.id,
            "name": project.name,
            "status": project.status,
            "contract_amount": project.contract_amount,
            "memory_version": project.memory_version,
            "memory_stale": project.memory_stale,
        }
        for project in matching
    ]


@router.post("/{client_id}/documents/{doc_id}", status_code=200)
def link_document(client_id: int, doc_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    document = session.get(KnowledgeDocument, doc_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    document.client_id = client_id
    session.add(document)
    session.commit()
    mark_client_memory_stale(session, client_id, trigger="document_linked")
    return {"ok": True}


@router.delete("/{client_id}/documents/{doc_id}", status_code=200)
def unlink_document(client_id: int, doc_id: int, session: Session = Depends(get_session)):
    document = session.get(KnowledgeDocument, doc_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    original_client_id = document.client_id
    document.client_id = None
    session.add(document)
    session.commit()
    if original_client_id:
        mark_client_memory_stale(session, original_client_id, trigger="document_unlinked")
    return {"ok": True}


@router.get("/{client_id}/memory", response_model=ClientMemoryResponse)
def get_client_memory(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientMemoryResponse(
        client_id=client_id,
        memory=get_client_memory_payload(client),
        memory_version=client.client_memory_version,
        memory_stale=client.client_memory_stale,
        memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
    )


@router.get("/{client_id}/memory/status", response_model=ClientMemoryStatusResponse)
def get_client_memory_status(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return ClientMemoryStatusResponse(
        client_id=client_id,
        has_memory=(client.client_memory_version or 0) > 0,
        memory_version=client.client_memory_version,
        memory_stale=client.client_memory_stale,
        memory_updated_at=client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else None,
    )


@router.post("/{client_id}/memory/rebuild", response_model=ClientMemoryResponse)
async def rebuild_client_memory(client_id: int, session: Session = Depends(get_session)):
    client, client_data, source_project_ids = build_client_memory_data(session, client_id)
    raw_memory = await complete_with_selected_model(
        messages=[{"role": "user", "content": build_client_memory_prompt(client_data)}],
        max_tokens=2200,
    )
    parsed_memory = parse_client_memory(raw_memory, client)
    payload = save_client_memory(
        session,
        client_id,
        parsed_memory,
        trigger="manual",
        source_project_ids=source_project_ids,
    )
    clients_cache.delete(_CLIENTS_KEY)
    refreshed = session.get(ClientRecord, client_id)
    return ClientMemoryResponse(
        client_id=client_id,
        memory=payload,
        memory_version=refreshed.client_memory_version if refreshed else 0,
        memory_stale=refreshed.client_memory_stale if refreshed else True,
        memory_updated_at=refreshed.client_memory_updated_at.isoformat() if refreshed and refreshed.client_memory_updated_at else None,
    )


@router.post("/{client_id}/memory/promote-project", response_model=ClientMemoryResponse)
async def promote_project_memory_to_client(
    client_id: int,
    body: PromoteProjectMemoryRequest,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    project = session.get(Project, body.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if _normalized_name(project.client) != _normalized_name(client.name):
        raise HTTPException(status_code=400, detail="Project does not belong to this client")

    try:
        project_memory = json.loads(project.context_memory_json or "{}")
        if not isinstance(project_memory, dict):
            project_memory = {}
    except json.JSONDecodeError:
        project_memory = {}

    current_memory = get_client_memory_payload(client)
    raw_memory = await complete_with_selected_model(
        messages=[
            {
                "role": "user",
                "content": build_client_memory_promote_prompt(current_memory, project.name, project_memory),
            }
        ],
        max_tokens=2200,
    )
    parsed_memory = parse_client_memory(raw_memory, client)
    payload = save_client_memory(
        session,
        client_id,
        parsed_memory,
        trigger="project_promoted",
        source_project_ids=[project.id],
    )
    clients_cache.delete(_CLIENTS_KEY)
    refreshed = session.get(ClientRecord, client_id)
    return ClientMemoryResponse(
        client_id=client_id,
        memory=payload,
        memory_version=refreshed.client_memory_version if refreshed else 0,
        memory_stale=refreshed.client_memory_stale if refreshed else True,
        memory_updated_at=refreshed.client_memory_updated_at.isoformat() if refreshed and refreshed.client_memory_updated_at else None,
    )


@router.post("/{client_id}/memory/summarize")
async def summarize_client_memory(
    client_id: int,
    body: ClientMemorySummaryRequest,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    memory = get_client_memory_payload(client)
    if (client.client_memory_version or 0) == 0 or client.client_memory_stale:
        client, client_data, source_project_ids = build_client_memory_data(session, client_id)
        raw_memory = await complete_with_selected_model(
            messages=[{"role": "user", "content": build_client_memory_prompt(client_data)}],
            max_tokens=2200,
        )
        parsed_memory = parse_client_memory(raw_memory, client)
        memory = save_client_memory(
            session,
            client_id,
            parsed_memory,
            trigger="on_demand",
            source_project_ids=source_project_ids,
        )

    normalized_language = normalize_summary_language(body.language)
    content = await complete_with_selected_model(
        messages=[{"role": "user", "content": build_client_memory_summary_prompt(memory, client.name, body.language)}],
        max_tokens=900,
    )
    return {
        "client_id": client_id,
        "language": normalized_language,
        "content": content.strip(),
        "memory_version": int(memory.get("memory_version", 0) or 0),
    }


@router.post("/ai-suggest", response_model=list[AISuggestion])
async def ai_suggest(body: AISuggestQuery):
    system = (
        "You are an expert business analyst assistant for a consulting firm. "
        "When given a company name or description, return structured client profile suggestions."
    )
    prompt = f"""The user typed: "{body.query}"

Based on this, generate 1 to 3 plausible client profile suggestions for a consulting firm CRM.
If the query is unambiguous, return 1 suggestion.
If the query could match multiple entities, return up to 3 distinct suggestions.

Return ONLY a valid JSON array with this exact schema:
[
  {{
    "name": "Full official company name",
    "industry": "Industry / sector",
    "contact": "",
    "notes": "1-2 sentence background relevant to consulting engagements"
  }}
]
"""

    try:
        raw = await complete(
            messages=[{"role": "user", "content": prompt}],
            system=system,
            max_tokens=800,
        )
        text = raw.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        suggestions = json.loads(text)
        return [AISuggestion(**item) for item in suggestions[:3]]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {exc}") from exc
