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
from app.models.db import (
    ClientMemoryFact,
    ClientMemorySnapshot,
    ClientMemorySummary,
    ClientMemorySlot,
    ClientRecord,
    ClientStakeholder,
    ClientStakeholderHistory,
    KnowledgeDocument,
    MemoryCandidate,
    Project,
    User,
)
from app.services import scheduler as scheduler_service
from app.services.cache import clients_cache, projects_cache
from app.services.client_contexts import build_client_memory_summary_prompt
from app.services.client_identity import lock_client_identity_values
from app.services.client_permissions import (
    accessible_client_ids,
    lock_and_require_client_access,
    require_client_access,
)
from app.services.knowledge_permissions import (
    accessible_project_ids,
    can_write_legacy_document,
    lock_and_require_legacy_document_write,
)
from app.services.project_ai import extract_json_array_from_text
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_clients import list_projects_for_client
from app.services.project_llm import complete_with_selected_model
from app.routers.clients_deps import (
    _CLIENTS_KEY,
    _CLIENTS_TTL,
    _build_client_out,
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


def _build_all_client_rows(
    session: Session,
    *,
    current_user: User,
    allowed_client_ids: set[int] | None = None,
) -> list[ClientOut]:
    statement = select(ClientRecord).order_by(ClientRecord.name)
    if allowed_client_ids is not None:
        if not allowed_client_ids:
            return []
        statement = statement.where(ClientRecord.id.in_(sorted(allowed_client_ids)))
    clients = session.exec(statement).all()
    all_docs = session.exec(select(KnowledgeDocument)).all()
    visible_project_ids = set(accessible_project_ids(current_user, session))

    docs_by_client: dict[int, list] = {}
    for document in all_docs:
        if (
            document.client_id is not None
            and (
                document.project_id is None
                or int(document.project_id) in visible_project_ids
            )
        ):
            docs_by_client.setdefault(document.client_id, []).append(document)

    projects_by_client_id = {
        int(client.id): [
            project.name
            for project in list_projects_for_client(session, client)
            if project.id is not None and int(project.id) in visible_project_ids
        ]
        for client in clients
        if client.id is not None
    }

    return [
        _build_client_out(client, docs_by_client, projects_by_client_id)
        for client in clients
    ]


def _build_visible_client_out(
    session: Session,
    client: ClientRecord,
    current_user: User,
) -> ClientOut:
    """Serialize one client without exposing inaccessible project children."""

    visible_project_ids = set(accessible_project_ids(current_user, session))
    documents = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.client_id == client.id)
    ).all()
    visible_documents = [
        document
        for document in documents
        if document.project_id is None
        or int(document.project_id) in visible_project_ids
    ]
    visible_project_names = [
        project.name
        for project in list_projects_for_client(session, client)
        if project.id is not None and int(project.id) in visible_project_ids
    ]
    return _build_client_out(
        client,
        {int(client.id): visible_documents},
        {int(client.id): visible_project_names},
    )


@router.get("", response_model=list[ClientOut])
def list_clients(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    allowed_ids = accessible_client_ids(session, current_user)
    cached = clients_cache.get(_CLIENTS_KEY) if allowed_ids is None else None
    if cached is not None:
        return cached

    result = _build_all_client_rows(
        session,
        current_user=current_user,
        allowed_client_ids=allowed_ids,
    )
    if allowed_ids is None:
        clients_cache.set(_CLIENTS_KEY, result, _CLIENTS_TTL)
    return result


@router.get("/list", response_model=ClientListResponse)
def list_clients_paginated(
    search: str = "",
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    rows = _build_all_client_rows(
        session,
        current_user=current_user,
        allowed_client_ids=accessible_client_ids(session, current_user),
    )
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
def create_client(
    body: ClientCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    lock_client_identity_values(session, (body.name,))
    actor = session.exec(
        select(User)
        .where(User.id == current_user.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if actor is None:
        raise HTTPException(401, "Not authenticated")
    if not actor.is_active:
        raise HTTPException(403, "User account is inactive")
    client = ClientRecord(
        **body.model_dump(),
        created_by_user_id=actor.id,
    )
    session.add(client)
    session.commit()
    session.refresh(client)
    _mark_client_memory_stale(session, client.id, trigger="client_created")
    clients_cache.delete(_CLIENTS_KEY)
    return _build_visible_client_out(session, client, current_user)


@router.get("/{client_id}", response_model=ClientOut)
def get_client(
    client_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    client = require_client_access(session, client_id, current_user)
    return _build_visible_client_out(session, client, current_user)


@router.put("/{client_id}", response_model=ClientOut)
def update_client(
    client_id: int,
    body: ClientUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    locator = require_client_access(
        session,
        client_id,
        current_user,
        require_write=True,
    )
    changes = body.model_dump(exclude_none=True)
    requested_name = str(changes.get("name", locator.name) or "")
    client, _actor, locked_projects = lock_and_require_client_access(
        session,
        client_id,
        current_user,
        require_write=True,
        require_all_linked_project_write=(requested_name != locator.name),
        additional_identity_values=(requested_name,),
    )

    previous_name = client.name
    name_changed = "name" in changes and previous_name != requested_name
    linked_projects = locked_projects if name_changed else []
    for field, value in changes.items():
        setattr(client, field, value)
    for project in linked_projects:
        project.client_id = client_id
        project.client = client.name
        session.add(project)
    session.add(client)
    session.commit()
    session.refresh(client)
    _mark_client_memory_stale(session, client_id, trigger="client_updated")
    if name_changed:
        for project in linked_projects:
            if project.id is not None:
                mark_project_memory_stale(
                    session,
                    int(project.id),
                    trigger="client_renamed",
                )
    session.expire_all()
    client = session.exec(
        select(ClientRecord)
        .where(ClientRecord.id == client_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if client is None:
        raise HTTPException(
            status_code=409,
            detail="Client was deleted during update; reload the client list.",
        )
    clients_cache.delete(_CLIENTS_KEY)
    if linked_projects:
        projects_cache.delete_prefix("list:")
        for project in linked_projects:
            if project.id is not None:
                projects_cache.delete(f"detail:{project.id}")
    return _build_visible_client_out(session, client, current_user)


@router.delete("/{client_id}", status_code=204)
def delete_client(
    client_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_client_access(
        session,
        client_id,
        current_user,
        require_write=True,
    )
    client, _actor, linked_projects = lock_and_require_client_access(
        session,
        client_id,
        current_user,
        require_write=True,
        require_all_linked_project_write=True,
    )
    linked_project_ids = [
        int(project.id)
        for project in linked_projects
        if project.id is not None
    ]
    docs = session.exec(
        select(KnowledgeDocument)
        .where(KnowledgeDocument.client_id == client_id)
        .order_by(KnowledgeDocument.id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).all()
    client_only_docs = [document for document in docs if document.project_id is None]
    if client_only_docs:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "client_documents_require_reassignment",
                "message": (
                    "Client-only documents must be reassigned or explicitly "
                    "removed before deleting this client."
                ),
                "document_ids": [
                    int(document.id)
                    for document in client_only_docs
                    if document.id is not None
                ],
            },
        )
    # Validate every scope-preservation precondition before mutating an ORM
    # object. This keeps the rejected path side-effect free even for direct
    # service callers that catch the HTTPException and reuse the session.
    for project in linked_projects:
        if project.client_id == client_id:
            project.client_id = None
            session.add(project)
    for document in docs:
        document.client_id = None
        session.add(document)
    for history in session.exec(
        select(ClientStakeholderHistory).where(
            ClientStakeholderHistory.client_id == client_id
        )
    ).all():
        session.delete(history)
    # The history table's legacy foreign keys do not cascade and the mapped
    # objects have no relationship that guarantees unit-of-work ordering.
    # Persist both document detachment and history removal before deleting
    # stakeholder and other client-owned parent rows.
    session.flush()
    for stakeholder in session.exec(
        select(ClientStakeholder).where(ClientStakeholder.client_id == client_id)
    ).all():
        session.delete(stakeholder)
    for summary in session.exec(
        select(ClientMemorySummary).where(ClientMemorySummary.client_id == client_id)
    ).all():
        session.delete(summary)
    for snapshot in session.exec(
        select(ClientMemorySnapshot).where(ClientMemorySnapshot.client_id == client_id)
    ).all():
        session.delete(snapshot)
    for candidate in session.exec(
        select(MemoryCandidate).where(MemoryCandidate.client_id == client_id)
    ).all():
        session.delete(candidate)
    for slot in session.exec(
        select(ClientMemorySlot).where(ClientMemorySlot.client_id == client_id)
    ).all():
        session.delete(slot)
    for fact in session.exec(
        select(ClientMemoryFact).where(ClientMemoryFact.client_id == client_id)
    ).all():
        session.delete(fact)
    # Keep the final owner delete in its own flush phase so every explicit
    # child deletion is visible to databases with immediate FK enforcement.
    session.flush()
    session.delete(client)
    session.commit()
    for project_id in linked_project_ids:
        mark_project_memory_stale(session, project_id, trigger="client_deleted")
    clients_cache.delete(_CLIENTS_KEY)
    if linked_project_ids:
        projects_cache.delete_prefix("list:")
        for project_id in linked_project_ids:
            projects_cache.delete(f"detail:{project_id}")


@router.get("/{client_id}/documents")
def list_client_documents(
    client_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_client_access(session, client_id, current_user)
    visible_project_ids = set(accessible_project_ids(current_user, session))
    documents = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.client_id == client_id)
    ).all()
    return [
        document
        for document in documents
        if document.project_id is None
        or int(document.project_id) in visible_project_ids
    ]


@router.get("/{client_id}/projects")
def list_client_projects(
    client_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    client = require_client_access(session, client_id, current_user)

    visible_project_ids = set(accessible_project_ids(current_user, session))
    matching = [
        project
        for project in list_projects_for_client(session, client)
        if project.id is not None and int(project.id) in visible_project_ids
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
def link_document(
    client_id: int,
    doc_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_client_access(session, client_id, current_user, require_write=True)
    document = session.get(KnowledgeDocument, doc_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not can_write_legacy_document(current_user, document, session):
        raise HTTPException(status_code=403, detail="Document write permission required")
    document, _actor = lock_and_require_legacy_document_write(
        session,
        doc_id,
        current_user,
        additional_client_ids=(client_id,),
    )
    original_client_id = document.client_id
    document.client_id = client_id
    session.add(document)
    session.commit()
    if original_client_id is not None and original_client_id != client_id:
        _mark_client_memory_stale(
            session,
            int(original_client_id),
            trigger="document_reassigned",
        )
    _mark_client_memory_stale(session, client_id, trigger="document_linked")
    return {"ok": True}


@router.delete("/{client_id}/documents/{doc_id}", status_code=200)
def unlink_document(
    client_id: int,
    doc_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    require_client_access(session, client_id, current_user, require_write=True)
    document = session.get(KnowledgeDocument, doc_id)
    if not document or document.client_id != client_id:
        raise HTTPException(status_code=404, detail="Document not found")
    if not can_write_legacy_document(current_user, document, session):
        raise HTTPException(status_code=403, detail="Document write permission required")
    document, actor = lock_and_require_legacy_document_write(
        session,
        doc_id,
        current_user,
    )
    if document.client_id != client_id:
        raise HTTPException(status_code=409, detail="Document client scope changed; retry.")
    if document.project_id is None and not actor.is_admin:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "client_document_scope_required",
                "message": (
                    "A client-only document cannot be converted into a global "
                    "document through unlink. Reassign or remove it explicitly."
                ),
            },
        )

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
