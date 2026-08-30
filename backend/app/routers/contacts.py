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

import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import (
    ClientRecord,
    ClientStakeholder,
    ClientStakeholderHistory,
    KnowledgeDocument,
    User,
)
from app.services.client_permissions import (
    accessible_client_ids,
    require_client_access,
)
from app.services.knowledge_permissions import accessible_project_ids
from app.services.project_clients import list_projects_for_client
from app.services.time_utils import utc_now_naive
from app.routers.clients_deps import (
    ClientOut,
    ClientStakeholderOut,
    _build_client_out,
    _serialize_client_stakeholder,
)

from app.routers.auth import get_current_user

router = APIRouter(
    tags=["contacts"],
    dependencies=[Depends(get_current_user)],
)


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


class ContactRecordOut(BaseModel):
    client: ClientOut
    stakeholder: ClientStakeholderOut


class ContactListResponse(BaseModel):
    items: list[ContactRecordOut]
    total: int
    limit: int
    offset: int
    clients: list[ClientOut]
    partial_failures: int = 0


def _build_client_directory_rows(
    session: Session,
    *,
    current_user: User,
    allowed_client_ids: set[int] | None = None,
) -> list[ClientOut]:
    client_statement = select(ClientRecord).order_by(ClientRecord.name)
    if allowed_client_ids is not None:
        if not allowed_client_ids:
            return []
        client_statement = client_statement.where(
            ClientRecord.id.in_(sorted(allowed_client_ids))
        )
    clients = session.exec(client_statement).all()

    document_statement = select(KnowledgeDocument)
    if allowed_client_ids is not None:
        document_statement = document_statement.where(
            KnowledgeDocument.client_id.in_(sorted(allowed_client_ids))
        )
    all_docs = session.exec(document_statement).all()

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


def _contact_level(stakeholder: ClientStakeholder | ClientStakeholderOut) -> str:
    text = " ".join(
        [
            stakeholder.organization_level or "",
            stakeholder.influence_type or "",
            stakeholder.role or "",
            stakeholder.decision_style or "",
            stakeholder.note or "",
        ]
    ).lower()
    if re.search(r"决策|拍板|decision|decision maker|approver|ceo|cto|coo|cfo|vp|总裁|总经理|董事|负责人|总监", text, re.I):
        return "decision"
    if re.search(r"影响|influence|influencer|champion|财务|采购|法务|业务|安全|it|信息化|数据|运营", text, re.I):
        return "influence"
    return "execution"


def _contact_has_direct_action(stakeholder: ClientStakeholder | ClientStakeholderOut) -> bool:
    return bool((stakeholder.last_action or "").strip())


def _contact_activity_timestamp(stakeholder: ClientStakeholder | ClientStakeholderOut) -> float:
    value = stakeholder.updated_at or stakeholder.created_at
    if isinstance(value, datetime):
        return value.timestamp()
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except ValueError:
        return 0.0


def _contact_is_recent(stakeholder: ClientStakeholder | ClientStakeholderOut) -> bool:
    if not _contact_has_direct_action(stakeholder):
        return False
    return _contact_activity_timestamp(stakeholder) >= (utc_now_naive() - timedelta(days=7)).timestamp()


def _contact_matches_search(record: ContactRecordOut, search: str) -> bool:
    keyword = search.strip().lower()
    if not keyword:
        return True
    stakeholder = record.stakeholder
    client = record.client
    values = [
        stakeholder.name,
        stakeholder.role,
        stakeholder.contact,
        stakeholder.organization_level,
        stakeholder.influence_type,
        stakeholder.communication_preference,
        stakeholder.note,
        stakeholder.last_action,
        client.name,
        client.industry,
        *client.project_names,
    ]
    return any(keyword in str(value or "").lower() for value in values)


def _contact_matches_filter(record: ContactRecordOut, filter_key: str) -> bool:
    stakeholder = record.stakeholder
    if filter_key == "all":
        return True
    if filter_key == "recent":
        return _contact_is_recent(stakeholder)
    if filter_key == "unreached":
        return not _contact_has_direct_action(stakeholder)
    return _contact_level(stakeholder) == filter_key


def _contact_sort_key(record: ContactRecordOut) -> tuple[int, float, str]:
    stakeholder = record.stakeholder
    rank = {"decision": 3, "influence": 2, "execution": 1}
    timestamp = _contact_activity_timestamp(stakeholder)
    return (-rank[_contact_level(stakeholder)], -timestamp, stakeholder.name.lower())


@router.get("", response_model=ContactListResponse)
def list_contacts(
    search: str = "",
    filter: str = "all",
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ContactListResponse:
    clients = _build_client_directory_rows(
        session,
        current_user=current_user,
        allowed_client_ids=accessible_client_ids(session, current_user),
    )
    clients_by_id = {client.id: client for client in clients}
    if clients_by_id:
        stakeholders = session.exec(
            select(ClientStakeholder)
            .where(ClientStakeholder.client_id.in_(sorted(clients_by_id)))
            .order_by(
                ClientStakeholder.updated_at.desc(),
                ClientStakeholder.id.desc(),
            )
        ).all()
    else:
        stakeholders = []
    records = [
        ContactRecordOut(
            client=clients_by_id[stakeholder.client_id],
            stakeholder=_serialize_client_stakeholder(stakeholder),
        )
        for stakeholder in stakeholders
        if stakeholder.client_id in clients_by_id
    ]
    filtered = [
        record
        for record in records
        if _contact_matches_search(record, search)
        and _contact_matches_filter(record, filter)
    ]
    filtered.sort(key=_contact_sort_key)
    return ContactListResponse(
        items=filtered[offset : offset + limit],
        total=len(filtered),
        limit=limit,
        offset=offset,
        clients=clients,
        partial_failures=0,
    )


@router.get("/{stakeholder_id}", response_model=ContactDetailOut)
def get_contact(
    stakeholder_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> ContactDetailOut:
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder:
        raise HTTPException(status_code=404, detail="Contact not found")
    client = require_client_access(
        session,
        stakeholder.client_id,
        current_user,
    )

    # Sibling stakeholders for the side rail. Same ordering as
    # ``list_client_stakeholders`` so the column matches what the
    # /clients/{id}/stakeholders endpoint would return.
    siblings = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client.id)
        .order_by(ClientStakeholder.updated_at.desc(), ClientStakeholder.id.desc())
    ).all()

    visible_project_ids = set(accessible_project_ids(current_user, session))
    matching_projects = [
        project
        for project in list_projects_for_client(session, client)
        if project.id is not None and int(project.id) in visible_project_ids
    ]

    # Documents for the client-out shape (same as the /clients list).
    docs = session.exec(
        select(KnowledgeDocument).where(KnowledgeDocument.client_id == client.id)
    ).all()
    docs_by_client = {
        client.id: [
            document
            for document in docs
            if document.project_id is None
            or int(document.project_id) in visible_project_ids
        ]
    }
    projects_by_client_id = {int(client.id): [p.name for p in matching_projects]}

    # Recent history for this stakeholder — same shape + cap as
    # ``get_stakeholder_history``.
    history = session.exec(
        select(ClientStakeholderHistory)
        .where(ClientStakeholderHistory.stakeholder_id == stakeholder_id)
        .order_by(ClientStakeholderHistory.changed_at.desc())
        .limit(50)
    ).all()

    return ContactDetailOut(
        client=_build_client_out(client, docs_by_client, projects_by_client_id),
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
