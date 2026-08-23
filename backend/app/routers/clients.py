"""Client management router — CRUD for clients, related docs/projects, and client memory.

Memory, stakeholder endpoints live in sub-routers:
  - clients_memory.py
  - clients_stakeholders.py
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ClientRecord, KnowledgeDocument, MemoryCandidate, Project
from app.services import scheduler as scheduler_service
from app.services.cache import clients_cache
from app.services.client_contexts import build_client_memory_summary_prompt
from app.services.project_ai import extract_json_array_from_text
from app.services.project_llm import complete_with_selected_model
from app.routers.clients_deps import (
    _CLIENTS_KEY,
    _CLIENTS_TTL,
    _build_client_out,
    _client_out,
    _mark_client_memory_stale,
    _normalized_name,
    AISuggestQuery,
    AISuggestion,
    ClientCreate,
    ClientOut,
    ClientUpdate,
)

from app.routers.auth import get_current_user

# Auth floor: every endpoint in this router requires a valid token.
# Per-record ownership / multi-tenancy gates are a separate concern
# (see R75 backlog) — this just stops unauthenticated callers from
# reading or mutating the client list.
router = APIRouter(
    prefix="/clients",
    tags=["clients"],
    dependencies=[Depends(get_current_user)],
)


class ClientListStats(BaseModel):
    total: int
    active: int
    watch: int
    dormant: int


class ClientListResponse(BaseModel):
    items: list[ClientOut]
    total: int
    limit: int
    offset: int
    stats: ClientListStats


def _client_health(client: ClientOut) -> str:
    if client.project_names:
        return "active"
    if (
        client.document_count > 0
        or bool((client.contact or "").strip())
        or bool((client.notes or "").strip())
        or client.client_memory_version > 0
    ):
        return "watch"
    return "dormant"


def _client_matches_search(client: ClientOut, search: str) -> bool:
    keyword = search.strip().lower()
    if not keyword:
        return True
    haystack = [
        client.name,
        client.industry,
        client.contact,
        client.notes,
        *client.project_names,
    ]
    return any(keyword in str(value or "").lower() for value in haystack)


def _client_sort_key(client: ClientOut) -> tuple[int, int, int, str]:
    rank = {"active": 3, "watch": 2, "dormant": 1}
    return (
        -rank[_client_health(client)],
        -len(client.project_names),
        -client.document_count,
        client.name.lower(),
    )


def _build_all_client_rows(session: Session) -> list[ClientOut]:
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

    return [_build_client_out(client, docs_by_client, projects_by_name) for client in clients]


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


@router.get("/list", response_model=ClientListResponse)
def list_clients_paginated(
    search: str = "",
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    rows = _build_all_client_rows(session)
    stats_counts = {"active": 0, "watch": 0, "dormant": 0}
    for row in rows:
        stats_counts[_client_health(row)] += 1

    filtered = [row for row in rows if _client_matches_search(row, search)]
    filtered.sort(key=_client_sort_key)
    page_items = filtered[offset : offset + limit]
    return ClientListResponse(
        items=page_items,
        total=len(filtered),
        limit=limit,
        offset=offset,
        stats=ClientListStats(
            total=len(rows),
            active=stats_counts["active"],
            watch=stats_counts["watch"],
            dormant=stats_counts["dormant"],
        ),
    )


@router.post("", response_model=ClientOut)
def create_client(body: ClientCreate, session: Session = Depends(get_session)):
    client = ClientRecord(**body.model_dump())
    session.add(client)
    session.commit()
    session.refresh(client)
    _mark_client_memory_stale(session, client.id, trigger="client_created")
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
    _mark_client_memory_stale(session, client_id, trigger="client_updated")
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
    for candidate in session.exec(
        select(MemoryCandidate).where(MemoryCandidate.client_id == client_id)
    ).all():
        session.delete(candidate)
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
    _mark_client_memory_stale(session, client_id, trigger="document_linked")
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
        _mark_client_memory_stale(session, original_client_id, trigger="document_unlinked")
    return {"ok": True}


@router.post("/ai-suggest", response_model=list[AISuggestion])
async def ai_suggest(body: AISuggestQuery):
    system = (
        "You are an expert business analyst assistant for a Chinese consulting firm. "
        "When given a company name or description, return structured client profile suggestions. "
        "Always respond in Simplified Chinese (简体中文)."
    )
    prompt = f"""The user typed: "{body.query}"

Based on this, generate 1 to 3 plausible client profile suggestions for a consulting firm CRM.
If the query is unambiguous, return 1 suggestion.
If the query could match multiple entities, return up to 3 distinct suggestions.

All field values MUST be written in Simplified Chinese (简体中文):
- "name": the company's official Chinese name (use the registered Chinese name when the company has one).
- "industry": industry / sector, in Chinese.
- "notes": 1-2 sentence background relevant to consulting engagements, in Chinese.

Return ONLY a valid JSON array with this exact schema:
[
  {{
    "name": "公司全称（中文）",
    "industry": "行业 / 领域",
    "contact": "",
    "notes": "与咨询业务相关的 1-2 句背景介绍"
  }}
]
"""

    try:
        raw = await complete_with_selected_model(
            messages=[{"role": "user", "content": prompt}],
            system=system,
            max_tokens=800,
        )
        suggestions = json.loads(extract_json_array_from_text(raw))
        return [AISuggestion(**item) for item in suggestions[:3]]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {exc}") from exc


# ── Include sub-routers ──────────────────────────────────────────────────────
from app.routers import clients_memory as _clients_memory
from app.routers import clients_stakeholders as _clients_stakeholders

router.include_router(_clients_memory.router)
router.include_router(_clients_stakeholders.router)

# ── Re-exports for test / caller compatibility ───────────────────────────────
from app.routers.clients_memory import list_client_memory_jobs  # noqa: F401
from app.routers.clients_deps import (  # noqa: F401
    ClientMemoryResponse,
    ClientMemoryStatusResponse,
    ClientMemoryBatchRebuildRequest,
    ClientMemoryBatchRebuildItem,
    ClientMemoryBatchRebuildResponse,
    ClientMemoryJob,
    ClientMemoryJobsResponse,
    PromoteProjectMemoryRequest,
    ClientStakeholderBase,
    ClientStakeholderCreate,
    ClientStakeholderUpdate,
    ClientStakeholderAnalyzeRequest,
    ClientStakeholderOut,
    ClientMemorySummaryRequest,
    ClientMemoryBatchWarmSummariesRequest,
    ClientMemoryBatchWarmSummariesResponse,
)
