"""Clients sub-router: stakeholder management endpoints."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import ClientRecord, ClientStakeholder, ClientStakeholderHistory, Project
from app.services.cache import clients_cache
from app.services.client_contexts import get_client_memory_payload
from app.services.project_llm import complete_with_selected_model
from app.services.time_utils import utc_now_naive
from app.routers.clients_deps import (
    _CLIENTS_KEY,
    _extract_first_json_object_from_text,
    _mark_client_memory_stale,
    _normalized_name,
    _serialize_client_stakeholder,
    ClientStakeholderAnalyzeRequest,
    ClientStakeholderCreate,
    ClientStakeholderOut,
    ClientStakeholderUpdate,
)

router = APIRouter(tags=["clients"])


@router.get("/{client_id}/stakeholders", response_model=list[ClientStakeholderOut])
def list_client_stakeholders(client_id: int, session: Session = Depends(get_session)):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholders = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client_id)
        .order_by(ClientStakeholder.updated_at.desc(), ClientStakeholder.id.desc())
    ).all()
    return [_serialize_client_stakeholder(stakeholder) for stakeholder in stakeholders]


@router.post("/{client_id}/stakeholders", response_model=ClientStakeholderOut, status_code=201)
def create_client_stakeholder(
    client_id: int,
    body: ClientStakeholderCreate,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Stakeholder name is required")
    stakeholder = ClientStakeholder(client_id=client_id, **body.model_dump())
    stakeholder.name = name
    session.add(stakeholder)
    session.commit()
    session.refresh(stakeholder)
    _mark_client_memory_stale(session, client_id, trigger="stakeholder_created")
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder(stakeholder)


@router.put("/{client_id}/stakeholders/{stakeholder_id}", response_model=ClientStakeholderOut)
def update_client_stakeholder(
    client_id: int,
    stakeholder_id: int,
    body: ClientStakeholderUpdate,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client_id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")

    values = body.model_dump(exclude_none=True)
    if "name" in values:
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise HTTPException(status_code=400, detail="Stakeholder name is required")
    tracked_fields = {
        "role", "organization_level", "influence_type", "relationship_status",
        "concerns", "sensitivities", "communication_preference", "contact",
        "last_action", "personality_profile", "decision_style",
        "communication_strategy", "trust_signals", "note",
    }
    changes = []
    for field, value in values.items():
        old_val = str(getattr(stakeholder, field, "") or "")
        new_val = str(value or "")
        if field in tracked_fields and old_val != new_val:
            changes.append(ClientStakeholderHistory(
                stakeholder_id=stakeholder_id,
                client_id=client_id,
                field_name=field,
                old_value=old_val[:2000],
                new_value=new_val[:2000],
                trigger="manual",
            ))
        setattr(stakeholder, field, value)
    stakeholder.updated_at = utc_now_naive()
    session.add(stakeholder)
    for change in changes:
        session.add(change)
    session.commit()
    session.refresh(stakeholder)
    _mark_client_memory_stale(session, client_id, trigger="stakeholder_updated")
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder(stakeholder)


@router.post("/{client_id}/stakeholders/{stakeholder_id}/analyze", response_model=ClientStakeholderOut)
async def analyze_client_stakeholder(
    client_id: int,
    stakeholder_id: int,
    body: ClientStakeholderAnalyzeRequest | None = None,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client_id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")

    client_memory = get_client_memory_payload(client)
    linked_projects = session.exec(
        select(Project)
        .where(Project.client == client.name)
        .order_by(Project.updated_at.desc())
    ).all()
    project_context = [
        {
            "name": project.name,
            "status": project.status,
            "description": project.description,
            "memory_version": project.memory_version,
            "memory_stale": project.memory_stale,
        }
        for project in linked_projects[:12]
    ]
    linkedin_info = ((body.linkedin_info if body else "") or "").strip()[:6000]
    focus = ((body.focus if body else "") or "").strip()[:1000]
    prompt = (
        "You are a senior relationship strategist and executive communication advisor.\n"
        "Analyze this contact from the perspective of a consulting-firm partner. Do not stop at job title.\n"
        "Build a three-dimensional dynamic profile: person, power, and situation. The person may leave, move companies, or change responsibility.\n"
        "Use only the supplied facts. Treat LinkedIn/profile text as user-provided notes, not verified truth. If evidence is weak, clearly mark it as an inference.\n"
        "Return ONLY a valid JSON object with keys: personality_profile, decision_style, communication_strategy, trust_signals, relationship_status, concerns, sensitivities, communication_preference, last_action, note.\n"
        "Use the following partner-grade framework in the returned fields:\n"
        "1) Power Mapping: formal authority vs informal influence, decision-chain role, budget/signoff/procurement power, information-hub position, hidden vetoes.\n"
        "2) Personal Profile: career motivation (promotion, risk avoidance, professional reputation, political balance), simplified DISC style, background source such as client-side/vendor-side, education, past consulting experiences.\n"
        "3) Relationship Web: upward/peer/downward relationships, outside networks, competitor-consultant ties, relationship with us, openness of information, whether they invest political capital.\n"
        "4) Context & Stakes: what this project means to this person, political sensitivity, time pressure, department-interest redistribution, hidden agenda.\n"
        "5) Ongoing Intelligence: signals to track, including role changes, language changes, behavior changes, budget signals, and interpersonal shifts.\n"
        "Field guidance:\n"
        "- personality_profile: motivation matrix, DISC-style behavior, background source, what is inferred vs known.\n"
        "- decision_style: power map, decision-chain role, formal/informal influence, risk tolerance, likely veto points.\n"
        "- communication_strategy: how a partner should communicate, what materials to prepare, how to help them sell internally, next meeting moves.\n"
        "- trust_signals: relationship web, trust score reasoning, information openness, friendly-trap risk, anti-fragile relationship plan.\n"
        "- concerns: likely explicit and hidden concerns.\n"
        "- sensitivities: political sensitivities, language to avoid, stakeholder conflicts.\n"
        "- last_action: concrete next action and intelligence to collect.\n"
        "- note: a one-page partner summary with headings: 基本信息, 权力评估, 动机标签, 风格标签, 关系状态, 当前项目stakes, 下一步行动.\n"
        "Keep every value practical and concise. Write in Chinese unless the supplied facts are clearly English-only.\n\n"
        f"Client:\n- name: {client.name}\n- industry: {client.industry}\n- contact: {client.contact}\n- notes: {client.notes}\n\n"
        f"Linked projects JSON:\n{json.dumps(project_context, ensure_ascii=False)[:5000]}\n\n"
        f"Client memory JSON:\n{json.dumps(client_memory, ensure_ascii=False)[:6000]}\n\n"
        "Existing contact profile:\n"
        f"- name: {stakeholder.name}\n"
        f"- role: {stakeholder.role}\n"
        f"- organization_level: {stakeholder.organization_level}\n"
        f"- influence_type: {stakeholder.influence_type}\n"
        f"- relationship_status: {stakeholder.relationship_status}\n"
        f"- concerns: {stakeholder.concerns}\n"
        f"- sensitivities: {stakeholder.sensitivities}\n"
        f"- communication_preference: {stakeholder.communication_preference}\n"
        f"- contact: {stakeholder.contact}\n"
        f"- last_action: {stakeholder.last_action}\n"
        f"- personality_profile: {stakeholder.personality_profile}\n"
        f"- decision_style: {stakeholder.decision_style}\n"
        f"- communication_strategy: {stakeholder.communication_strategy}\n"
        f"- trust_signals: {stakeholder.trust_signals}\n"
        f"- note: {stakeholder.note}\n\n"
        f"User-provided LinkedIn/profile information:\n{linkedin_info or '(none)'}\n\n"
        f"Analysis focus:\n{focus or '(general full analysis)'}\n"
    )
    raw = await complete_with_selected_model(messages=[{"role": "user", "content": prompt}], max_tokens=2200)
    try:
        parsed = json.loads(_extract_first_json_object_from_text(str(raw or "")))
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    for field, limit in {
        "personality_profile": 2400,
        "decision_style": 2000,
        "communication_strategy": 2800,
        "trust_signals": 2400,
        "relationship_status": 120,
        "concerns": 1800,
        "sensitivities": 1800,
        "communication_preference": 1200,
        "last_action": 1200,
        "note": 2400,
    }.items():
        value = str(parsed.get(field) or "").strip()
        if value:
            old_val = str(getattr(stakeholder, field, "") or "")
            if old_val != value[:limit]:
                session.add(ClientStakeholderHistory(
                    stakeholder_id=stakeholder_id,
                    client_id=client_id,
                    field_name=field,
                    old_value=old_val[:2000],
                    new_value=value[:2000],
                    trigger="ai_analyze",
                ))
            setattr(stakeholder, field, value[:limit])

    stakeholder.updated_at = utc_now_naive()
    session.add(stakeholder)
    session.commit()
    session.refresh(stakeholder)
    _mark_client_memory_stale(session, client_id, trigger="stakeholder_analyzed")
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder(stakeholder)


@router.delete("/{client_id}/stakeholders/{stakeholder_id}", status_code=204)
def delete_client_stakeholder(
    client_id: int,
    stakeholder_id: int,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client_id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")
    session.delete(stakeholder)
    session.commit()
    _mark_client_memory_stale(session, client_id, trigger="stakeholder_deleted")
    clients_cache.delete(_CLIENTS_KEY)
    return None


@router.get("/{client_id}/stakeholders/{stakeholder_id}/history")
def get_stakeholder_history(
    client_id: int,
    stakeholder_id: int,
    session: Session = Depends(get_session),
):
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client_id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")
    history = session.exec(
        select(ClientStakeholderHistory)
        .where(ClientStakeholderHistory.stakeholder_id == stakeholder_id)
        .order_by(ClientStakeholderHistory.changed_at.desc())
        .limit(50)
    ).all()
    return [
        {
            "id": h.id,
            "field_name": h.field_name,
            "old_value": h.old_value,
            "new_value": h.new_value,
            "trigger": h.trigger,
            "changed_at": h.changed_at.isoformat() if h.changed_at else None,
        }
        for h in history
    ]
