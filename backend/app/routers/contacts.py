"""Cross-client contact lookup endpoints.

The original frontend stakeholder routes are all scoped under
``/clients/{client_id}/stakeholders/...``, which forces the contact
detail page to fetch the entire client list and then walk every
client's stakeholders to find one by ID. Production showed this as
~12 sequential ``stakeholders`` XHRs taking ~6 s on contacts/3.

This router gives the contact detail page a single round-trip:
``GET /contacts/{stakeholder_id}`` returns the stakeholder, its
parent client (in the same shape as ``/clients`` list items), the
sibling stakeholders, projects, and recent history. The page makes
one call instead of N.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import (
    ClientRecord,
    ClientStakeholder,
    ClientStakeholderHistory,
    KnowledgeDocument,
    Project,
)
from app.routers.clients_deps import (
    ClientOut,
    ClientStakeholderOut,
    _build_client_out,
    _normalized_name,
    _serialize_client_stakeholder,
)

router = APIRouter(tags=["contacts"])


class ContactProjectOut(BaseModel):
    id: int
    name: str
    status: str
    contract_amount: float | None = None
    memory_version: int | None = None
    memory_stale: bool | None = None


class ContactHistoryOut(BaseModel):
    id: int
    field_name: str
    old_value: str
    new_value: str
    trigger: str
    changed_at: str | None = None


class ContactDetailOut(BaseModel):
    client: ClientOut
    stakeholder: ClientStakeholderOut
    sibling_stakeholders: list[ClientStakeholderOut]
    projects: list[ContactProjectOut]
    history: list[ContactHistoryOut]


@router.get("/{stakeholder_id}", response_model=ContactDetailOut)
def get_contact(stakeholder_id: int, session: Session = Depends(get_session)) -> ContactDetailOut:
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder:
        raise HTTPException(status_code=404, detail="Contact not found")
    client = session.get(ClientRecord, stakeholder.client_id)
    if not client:
        # Orphaned stakeholder — shouldn't happen because of the FK, but
        # better to 404 explicitly than blow up in the serializer.
        raise HTTPException(status_code=404, detail="Contact's client is missing")

    # Sibling stakeholders for the side rail. Same ordering as
    # ``list_client_stakeholders`` so the column matches what the
    # /clients/{id}/stakeholders endpoint would return.
    siblings = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client.id)
        .order_by(ClientStakeholder.updated_at.desc(), ClientStakeholder.id.desc())
    ).all()

    # Project list — mirrors ``/clients/{id}/projects``: normalized
    # client-name match because Project.client is a free-text column,
    # not an FK.
    client_key = _normalized_name(client.name)
    all_projects = session.exec(select(Project)).all()
    matching_projects = [p for p in all_projects if _normalized_name(p.client) == client_key]

    # Documents for the client-out shape (same as the /clients list).
    docs = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.client_id == client.id)
    ).all()
    docs_by_client = {client.id: list(docs)}
    projects_by_name = {client_key: [p.name for p in matching_projects]}

    # Recent history for this stakeholder — same shape + cap as
    # ``get_stakeholder_history``.
    history = session.exec(
        select(ClientStakeholderHistory)
        .where(ClientStakeholderHistory.stakeholder_id == stakeholder_id)
        .order_by(ClientStakeholderHistory.changed_at.desc())
        .limit(50)
    ).all()

    return ContactDetailOut(
        client=_build_client_out(client, docs_by_client, projects_by_name),
        stakeholder=_serialize_client_stakeholder(stakeholder),
        sibling_stakeholders=[_serialize_client_stakeholder(s) for s in siblings],
        projects=[
            ContactProjectOut(
                id=p.id,
                name=p.name,
                status=p.status,
                contract_amount=p.contract_amount,
                memory_version=p.memory_version,
                memory_stale=p.memory_stale,
            )
            for p in matching_projects
        ],
        history=[
            ContactHistoryOut(
                id=h.id,
                field_name=h.field_name,
                old_value=h.old_value,
                new_value=h.new_value,
                trigger=h.trigger,
                changed_at=h.changed_at.isoformat() if h.changed_at else None,
            )
            for h in history
        ],
    )
