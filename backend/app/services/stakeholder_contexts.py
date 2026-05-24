from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from app.models.db import ClientRecord, ClientStakeholder


MAX_STAKEHOLDERS_IN_PROMPT = 8


def _normalized_client_name(name: str | None) -> str:
    return (name or "").strip().lower()


def find_client_by_name(session: Session, client_name: str | None) -> ClientRecord | None:
    normalized = _normalized_client_name(client_name)
    if not normalized:
        return None
    direct = session.exec(select(ClientRecord).where(ClientRecord.name == client_name)).first()
    if direct:
        return direct
    return next(
        (
            client
            for client in session.exec(select(ClientRecord)).all()
            if _normalized_client_name(client.name) == normalized
        ),
        None,
    )


def list_client_stakeholder_dicts(session: Session, client_id: int, limit: int = MAX_STAKEHOLDERS_IN_PROMPT) -> list[dict[str, Any]]:
    stakeholders = session.exec(
        select(ClientStakeholder)
        .where(ClientStakeholder.client_id == client_id)
        .order_by(ClientStakeholder.updated_at.desc(), ClientStakeholder.id.desc())
        .limit(limit)
    ).all()
    return [serialize_client_stakeholder(stakeholder) for stakeholder in stakeholders]


def list_client_stakeholder_dicts_by_name(
    session: Session,
    client_name: str | None,
    limit: int = MAX_STAKEHOLDERS_IN_PROMPT,
) -> list[dict[str, Any]]:
    client = find_client_by_name(session, client_name)
    if not client or client.id is None:
        return []
    return list_client_stakeholder_dicts(session, client.id, limit=limit)


def serialize_client_stakeholder(stakeholder: ClientStakeholder) -> dict[str, Any]:
    fields = {
        "name": stakeholder.name,
        "role": stakeholder.role,
        "organization_level": stakeholder.organization_level,
        "influence_type": stakeholder.influence_type,
        "relationship_status": stakeholder.relationship_status,
        "concerns": stakeholder.concerns,
        "sensitivities": stakeholder.sensitivities,
        "communication_preference": stakeholder.communication_preference,
        "contact": stakeholder.contact,
        "last_action": stakeholder.last_action,
        "personality_profile": stakeholder.personality_profile,
        "decision_style": stakeholder.decision_style,
        "communication_strategy": stakeholder.communication_strategy,
        "trust_signals": stakeholder.trust_signals,
        "note": stakeholder.note,
    }
    return {key: str(value).strip() for key, value in fields.items() if str(value or "").strip()}


def format_client_stakeholders_for_prompt(stakeholders: list[dict[str, Any]], title: str = "Structured client stakeholders") -> str:
    if not stakeholders:
        return ""
    lines = [f"{title} ({len(stakeholders)} shown):"]
    for stakeholder in stakeholders:
        name = stakeholder.get("name", "Unnamed")
        role = stakeholder.get("role", "")
        influence = stakeholder.get("influence_type", "")
        relationship = stakeholder.get("relationship_status", "")
        concerns = stakeholder.get("concerns", "")
        preference = stakeholder.get("communication_preference", "")
        personality = stakeholder.get("personality_profile", "")
        decision_style = stakeholder.get("decision_style", "")
        communication_strategy = stakeholder.get("communication_strategy", "")
        note = stakeholder.get("note", "")
        profile = " | ".join(part for part in (role, influence, relationship) if part)
        detail = " ; ".join(part for part in (concerns, preference, personality, decision_style, communication_strategy, note) if part)
        line = f"- {name}"
        if profile:
            line += f" | {profile}"
        if detail:
            line += f" | {detail}"
        lines.append(line)
    return "\n".join(lines)
