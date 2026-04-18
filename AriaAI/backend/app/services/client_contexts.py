from __future__ import annotations

from datetime import datetime
from typing import Any
import json

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import ClientMemorySummary, ClientRecord, Project
from app.services.project_contexts import _resolve_output_language, normalize_summary_language

SUPPORTED_CLIENT_MEMORY_SUMMARY_TYPES = {
    "overview",
    "stakeholder",
    "lessons",
    "client-facing",
    "risk",
    "opportunity",
}


def _default_client_memory(client: ClientRecord) -> dict[str, Any]:
    return {
        "client_profile": client.notes[:400] if client.notes else "",
        "decision_patterns": [],
        "key_contacts": [],
        "lessons_learned": [],
        "project_history": [],
        "sensitive_topics": [],
        "memory_version": client.client_memory_version,
        "last_updated_at": client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else "",
        "stale": client.client_memory_stale,
        "rebuild_log": [],
        "source_project_ids": [],
    }


def get_client_memory_payload(client: ClientRecord) -> dict[str, Any]:
    base = _default_client_memory(client)
    try:
        parsed = json.loads(client.client_memory_json or "{}")
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    return {
        **base,
        **parsed,
        "memory_version": client.client_memory_version,
        "last_updated_at": client.client_memory_updated_at.isoformat() if client.client_memory_updated_at else "",
        "stale": client.client_memory_stale,
    }


def mark_client_memory_stale(session: Session, client_id: int, trigger: str = "data_changed") -> None:
    client = session.get(ClientRecord, client_id)
    if not client:
        return
    client.client_memory_stale = True
    session.add(client)
    session.commit()


def mark_client_memory_stale_by_name(session: Session, client_name: str, trigger: str = "project_changed") -> None:
    normalized = (client_name or "").strip().lower()
    if not normalized:
        return
    client = session.exec(select(ClientRecord).where(ClientRecord.name == client_name)).first()
    if client is None:
        client = next(
            (
                record
                for record in session.exec(select(ClientRecord)).all()
                if (record.name or "").strip().lower() == normalized
            ),
            None,
        )
    if client is None:
        return
    mark_client_memory_stale(session, client.id, trigger=trigger)


def build_client_memory_data(session: Session, client_id: int) -> tuple[ClientRecord, str, list[int]]:
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    normalized = (client.name or "").strip().lower()
    projects = [
        project
        for project in session.exec(select(Project).order_by(Project.updated_at.desc())).all()
        if (project.client or "").strip().lower() == normalized
    ]

    lines = [
        f"Client: {client.name}",
        f"Industry: {client.industry}",
        f"Contact: {client.contact}",
    ]
    if client.notes:
        lines.append(f"Client notes:\n{client.notes[:1200]}")

    if projects:
        lines.append(f"Related projects ({len(projects)} total):")
        for project in projects[:12]:
            lines.append(f"- {project.name} | status={project.status} | contract_amount={project.contract_amount}")
            if project.context_summary:
                lines.append(f"  Summary: {project.context_summary[:320]}")
            if project.context_memory_json:
                try:
                    memory = json.loads(project.context_memory_json)
                    if isinstance(memory, dict):
                        brief = str(memory.get("project_brief", "")).strip()
                        risks = memory.get("key_risks", [])
                        next_actions = memory.get("next_actions", [])
                        if brief:
                            lines.append(f"  Project brief: {brief[:240]}")
                        if isinstance(risks, list) and risks:
                            lines.append(f"  Risks: {'; '.join(str(item) for item in risks[:3])}")
                        if isinstance(next_actions, list) and next_actions:
                            lines.append(f"  Next actions: {'; '.join(str(item) for item in next_actions[:3])}")
                except json.JSONDecodeError:
                    pass

    return client, "\n".join(lines), [project.id for project in projects]


def build_client_memory_prompt(client_data: str) -> str:
    return (
        "You are building long-term client memory for a consulting team. "
        "Use only the client and project evidence below. Do not invent missing facts. "
        "Return valid JSON only with these exact keys: "
        "client_profile, decision_patterns, key_contacts, lessons_learned, project_history, sensitive_topics. "
        "Rules: decision_patterns, lessons_learned, sensitive_topics must be arrays of strings. "
        "key_contacts must be an array of objects with keys name, role, note. "
        "project_history must be an array of objects with keys project_name, status, outcome, key_factor. "
        "Prefer concise, reusable guidance for future projects.\n\n"
        f"Client data:\n{client_data}"
    )


def build_client_memory_promote_prompt(
    current_memory: dict[str, Any],
    project_name: str,
    project_memory: dict[str, Any],
) -> str:
    return (
        "You are updating client-level consulting memory using one project's structured memory. "
        "Preserve useful long-term client knowledge. Do not copy temporary delivery noise. "
        "Return valid JSON only with these exact keys: "
        "client_profile, decision_patterns, key_contacts, lessons_learned, project_history, sensitive_topics.\n\n"
        f"Current client memory JSON:\n{json.dumps(current_memory, ensure_ascii=False)}\n\n"
        f"Project to absorb: {project_name}\n"
        f"Project memory JSON:\n{json.dumps(project_memory, ensure_ascii=False)}"
    )


def parse_client_memory(raw: str, client: ClientRecord) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Client memory model returned invalid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="Client memory model returned non-object JSON")

    existing = get_client_memory_payload(client)
    memory = {
        **_default_client_memory(client),
        **parsed,
    }
    memory["rebuild_log"] = existing.get("rebuild_log", []) if isinstance(existing.get("rebuild_log"), list) else []
    memory["source_project_ids"] = (
        existing.get("source_project_ids", []) if isinstance(existing.get("source_project_ids"), list) else []
    )
    return memory


def save_client_memory(
    session: Session,
    client_id: int,
    memory: dict[str, Any],
    *,
    trigger: str = "manual",
    source_project_ids: list[int] | None = None,
) -> dict[str, Any]:
    client = session.get(ClientRecord, client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    client.client_memory_version = int(client.client_memory_version or 0) + 1
    client.client_memory_updated_at = datetime.utcnow()
    memory["memory_version"] = client.client_memory_version
    memory["last_updated_at"] = client.client_memory_updated_at.isoformat()
    memory["stale"] = False

    rebuild_log = memory.get("rebuild_log", [])
    if not isinstance(rebuild_log, list):
        rebuild_log = []
    rebuild_log.append(
        {
            "at": client.client_memory_updated_at.isoformat(),
            "trigger": trigger,
            "version": client.client_memory_version,
        }
    )
    memory["rebuild_log"] = rebuild_log[-10:]

    existing_source_ids = memory.get("source_project_ids", [])
    if not isinstance(existing_source_ids, list):
        existing_source_ids = []
    merged_source_ids = [
        *[int(item) for item in existing_source_ids if str(item).isdigit()],
        *[int(item) for item in (source_project_ids or [])],
    ]
    memory["source_project_ids"] = list(dict.fromkeys(merged_source_ids))

    client.client_memory_json = json.dumps(memory, ensure_ascii=False)
    client.client_memory_stale = False
    client.client_memory_rebuild_status = "idle"
    client.client_memory_rebuild_failed_at = None
    session.add(client)
    session.commit()
    session.refresh(client)
    return get_client_memory_payload(client)


def build_client_memory_summary_prompt(
    memory: dict[str, Any],
    client_name: str,
    summary_type: str = "overview",
    language: str | None = None,
) -> str:
    output_language = _resolve_output_language(language)
    normalized_type = summary_type if summary_type in SUPPORTED_CLIENT_MEMORY_SUMMARY_TYPES else "overview"
    compact_memory = build_client_memory_summary_payload(memory, normalized_type)
    instructions = {
        "overview": (
            "Write exactly 3 concise bullet points. Focus on who this client is, how they decide, "
            "the most reusable lessons learned, and what future teams should remember."
        ),
        "stakeholder": (
            "Write exactly 3 concise bullet points focused on stakeholders. Highlight key contacts, "
            "decision style, alignment expectations, and relationship signals future teams should remember."
        ),
        "lessons": (
            "Write exactly 3 concise bullet points focused on reusable lessons learned. Highlight what worked, "
            "what caused friction, and what future teams should repeat or avoid."
        ),
        "client-facing": (
            "Write exactly 3 concise bullet points that are safe to share with a client-facing team. "
            "Focus on current relationship context, collaboration style, and helpful next-step guidance."
        ),
        "risk": (
            "Write exactly 3 concise bullet points focused on client relationship risk. Highlight sensitive topics, "
            "decision friction, stakeholder gaps, and what future teams should handle carefully."
        ),
        "opportunity": (
            "Write exactly 3 concise bullet points focused on growth opportunity. Highlight reusable trust signals, "
            "potential next projects, expansion whitespace, and the strongest momentum hints."
        ),
    }
    return (
        "You are an AI consultant assistant. "
        f"{instructions[normalized_type]} "
        f"Return ONLY bullet points, one per line, starting with '- '. Write the answer in {output_language}.\n\n"
        f"Client: {client_name}\n"
        f"Summary type: {normalized_type}\n"
        f"Structured client memory JSON:\n{json.dumps(compact_memory, ensure_ascii=False)}"
    )


def _trim_text(value: Any, limit: int = 240) -> str:
    text = str(value or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _trim_list(values: Any, limit: int = 5, text_limit: int = 120) -> list[str]:
    if not isinstance(values, list):
        return []
    trimmed: list[str] = []
    for item in values:
        text = _trim_text(item, text_limit)
        if text:
            trimmed.append(text)
        if len(trimmed) >= limit:
            break
    return trimmed


def _trim_contacts(values: Any, limit: int = 4) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    contacts: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        contact = {
            "name": _trim_text(item.get("name", ""), 40),
            "role": _trim_text(item.get("role", ""), 40),
            "note": _trim_text(item.get("note", ""), 100),
        }
        if contact["name"] or contact["role"] or contact["note"]:
            contacts.append(contact)
        if len(contacts) >= limit:
            break
    return contacts


def _trim_project_history(values: Any, limit: int = 4) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    history: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        row = {
            "project_name": _trim_text(item.get("project_name", ""), 80),
            "status": _trim_text(item.get("status", ""), 40),
            "outcome": _trim_text(item.get("outcome", ""), 100),
            "key_factor": _trim_text(item.get("key_factor", ""), 100),
        }
        if any(row.values()):
            history.append(row)
        if len(history) >= limit:
            break
    return history


def build_client_memory_summary_payload(memory: dict[str, Any], summary_type: str) -> dict[str, Any]:
    base = {
        "client_profile": _trim_text(memory.get("client_profile", ""), 320),
        "decision_patterns": _trim_list(memory.get("decision_patterns", [])),
        "key_contacts": _trim_contacts(memory.get("key_contacts", [])),
        "lessons_learned": _trim_list(memory.get("lessons_learned", [])),
        "project_history": _trim_project_history(memory.get("project_history", [])),
        "sensitive_topics": _trim_list(memory.get("sensitive_topics", [])),
    }
    if summary_type == "stakeholder":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "sensitive_topics": base["sensitive_topics"],
        }
    if summary_type == "lessons":
        return {
            "client_profile": base["client_profile"],
            "lessons_learned": base["lessons_learned"],
            "project_history": base["project_history"],
            "sensitive_topics": base["sensitive_topics"],
        }
    if summary_type == "client-facing":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
        }
    if summary_type == "risk":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "sensitive_topics": base["sensitive_topics"],
            "lessons_learned": base["lessons_learned"],
        }
    if summary_type == "opportunity":
        return {
            "client_profile": base["client_profile"],
            "decision_patterns": base["decision_patterns"],
            "key_contacts": base["key_contacts"],
            "lessons_learned": base["lessons_learned"],
            "project_history": base["project_history"],
        }
    return base


def get_client_memory_summary_cache(
    session: Session,
    client_id: int,
    summary_type: str,
    language: str | None,
    memory_version: int,
) -> ClientMemorySummary | None:
    normalized_language = normalize_summary_language(language)
    return session.exec(
        select(ClientMemorySummary)
        .where(ClientMemorySummary.client_id == client_id)
        .where(ClientMemorySummary.summary_type == summary_type)
        .where(ClientMemorySummary.language == normalized_language)
        .where(ClientMemorySummary.memory_version == memory_version)
        .order_by(ClientMemorySummary.updated_at.desc())
    ).first()


def save_client_memory_summary_cache(
    session: Session,
    client_id: int,
    summary_type: str,
    language: str | None,
    memory_version: int,
    content: str,
) -> ClientMemorySummary:
    normalized_language = normalize_summary_language(language)
    cached = get_client_memory_summary_cache(
        session,
        client_id=client_id,
        summary_type=summary_type,
        language=normalized_language,
        memory_version=memory_version,
    )
    now = datetime.utcnow()
    if cached:
        cached.content = content
        cached.updated_at = now
        session.add(cached)
        session.commit()
        session.refresh(cached)
        return cached

    cached = ClientMemorySummary(
        client_id=client_id,
        summary_type=summary_type,
        language=normalized_language,
        memory_version=memory_version,
        content=content,
        created_at=now,
        updated_at=now,
    )
    session.add(cached)
    session.commit()
    session.refresh(cached)
    return cached
