"""Projects sub-router: meeting briefing and stakeholder capture."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.routers.projects_deps import get_session
from app.models.db import ClientStakeholder, ClientRecord, Project
from app.routers.projects_deps import (
    _build_project_briefing,
    _normalize_briefing_meeting_type,
    _briefing_cache_type,
    _briefing_source_version,
    _build_project_briefing_refine_prompt,
    _extract_stakeholder_candidates_from_text,
    _refresh_instance,
    _bust_project,
    _mark_project_memory_stale,
    _ensure_project_memory,
    _find_client_record_by_name,
    _serialize_client_stakeholder_dict,
    _extract_first_json_object_from_text,
    _normalize_name,
    _set_project_memory_failure,
    _project_summary_lock_key,
    _get_project_summary_lock,
    _CLIENTS_KEY,
    ProjectBriefingRefineRequest,
    ProjectStakeholderCaptureRequest,
    ProjectStakeholderAnalyzeRequest,
)
from app.services.project_contexts import (
    get_project_memory_summary_cache,
    get_project_memory_payload,
    normalize_summary_language,
    save_project_memory_summary_cache,
)
from app.services.client_contexts import (
    get_client_memory_payload,
    mark_client_memory_stale_by_name,
)
from app.services.project_core import get_project_or_404
from app.services.project_llm import complete_with_selected_model
from app.services.cache import clients_cache, projects_cache
from app.services.time_utils import utc_now_naive

router = APIRouter(tags=["projects"])

logger = logging.getLogger(__name__)


@router.get("/{project_id}/briefing")
def get_project_meeting_briefing(project_id: int, session: Session = Depends(get_session)):
    """Return a deterministic pre-meeting briefing assembled from memory and project signals."""
    return _build_project_briefing(session, project_id)


@router.post("/{project_id}/briefing/refine")
async def refine_project_meeting_briefing(
    project_id: int,
    body: ProjectBriefingRefineRequest,
    session: Session = Depends(get_session),
):
    """Generate or reuse an AI-refined briefing for the current deterministic briefing payload."""
    project = get_project_or_404(session, project_id)
    meeting_type = _normalize_briefing_meeting_type(body.meeting_type)
    normalized_language = normalize_summary_language(body.language)
    briefing = _build_project_briefing(session, project_id)
    cache_type = _briefing_cache_type(meeting_type)
    source_version = _briefing_source_version(briefing, meeting_type)

    if not body.force_refresh:
        cached = get_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=cache_type,
            language=normalized_language,
            memory_version=source_version,
        )
        if cached:
            return {
                "project_id": project_id,
                "meeting_type": meeting_type,
                "content": cached.content,
                "source_memory_version": source_version,
                "generated_at": cached.updated_at.isoformat(),
                "cached": True,
            }

    lock_key = _project_summary_lock_key(project_id, cache_type, normalized_language, source_version)
    summary_lock = _get_project_summary_lock(lock_key)
    async with summary_lock:
        if not body.force_refresh:
            fresh_cached = get_project_memory_summary_cache(
                session,
                project_id=project_id,
                summary_type=cache_type,
                language=normalized_language,
                memory_version=source_version,
            )
            if fresh_cached:
                return {
                    "project_id": project_id,
                    "meeting_type": meeting_type,
                    "content": fresh_cached.content,
                    "source_memory_version": source_version,
                    "generated_at": fresh_cached.updated_at.isoformat(),
                    "cached": True,
                }

        try:
            content = await complete_with_selected_model(
                messages=[{"role": "user", "content": _build_project_briefing_refine_prompt(briefing, meeting_type, normalized_language)}],
                max_tokens=1800,
            )
        except Exception as e:
            _set_project_memory_failure(
                session,
                project,
                stage=f"briefing_refine:{meeting_type}",
                message=str(e),
            )
            raise

        cached = save_project_memory_summary_cache(
            session,
            project_id=project_id,
            summary_type=cache_type,
            language=normalized_language,
            memory_version=source_version,
            content=content.strip(),
        )
        return {
            "project_id": project_id,
            "meeting_type": meeting_type,
            "content": cached.content,
            "source_memory_version": source_version,
            "generated_at": cached.updated_at.isoformat(),
            "cached": False,
        }


@router.post("/{project_id}/stakeholder-candidates")
def list_project_stakeholder_candidates(
    project_id: int,
    body: ProjectStakeholderCaptureRequest,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    client = _find_client_record_by_name(session, project.client)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")
    return {
        "project_id": project_id,
        "client_id": client.id,
        "client_name": client.name,
        "candidates": _extract_stakeholder_candidates_from_text(body.text),
    }


@router.post("/{project_id}/stakeholder-candidates/apply")
def apply_project_stakeholder_candidates(
    project_id: int,
    body: ProjectStakeholderCaptureRequest,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    client = _find_client_record_by_name(session, project.client)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")

    candidates = _extract_stakeholder_candidates_from_text(body.text)
    if not candidates:
        return {"project_id": project_id, "client_id": client.id, "candidates": [], "created": [], "skipped": []}

    existing = {
        _normalize_name(stakeholder.name)
        for stakeholder in session.exec(select(ClientStakeholder).where(ClientStakeholder.client_id == client.id)).all()
    }
    created: list[dict] = []
    skipped: list[dict] = []
    now = utc_now_naive()
    for candidate in candidates:
        normalized_name = _normalize_name(candidate.get("name"))
        if not normalized_name or normalized_name in existing:
            skipped.append({**candidate, "reason": "exists" if normalized_name in existing else "empty_name"})
            continue
        stakeholder = ClientStakeholder(
            client_id=client.id,
            name=candidate.get("name", ""),
            role=candidate.get("role", ""),
            influence_type=candidate.get("influence_type", ""),
            relationship_status=candidate.get("relationship_status", "unknown"),
            note=candidate.get("note", ""),
            created_at=now,
            updated_at=now,
        )
        session.add(stakeholder)
        session.commit()
        session.refresh(stakeholder)
        existing.add(normalized_name)
        created.append(
            {
                "id": stakeholder.id,
                "client_id": stakeholder.client_id,
                "name": stakeholder.name,
                "role": stakeholder.role,
                "influence_type": stakeholder.influence_type,
                "relationship_status": stakeholder.relationship_status,
                "note": stakeholder.note,
            }
        )

    if created:
        mark_client_memory_stale_by_name(session, project.client)
        _bust_project(project_id)

    return {
        "project_id": project_id,
        "client_id": client.id,
        "client_name": client.name,
        "candidates": candidates,
        "created": created,
        "skipped": skipped,
    }


@router.post("/{project_id}/stakeholders/{stakeholder_id}/analyze")
async def analyze_project_stakeholder(
    project_id: int,
    stakeholder_id: int,
    body: ProjectStakeholderAnalyzeRequest | None = None,
    session: Session = Depends(get_session),
):
    project = get_project_or_404(session, project_id)
    client = _find_client_record_by_name(session, project.client)
    if client is None:
        raise HTTPException(status_code=404, detail="Linked client not found")
    stakeholder = session.get(ClientStakeholder, stakeholder_id)
    if not stakeholder or stakeholder.client_id != client.id:
        raise HTTPException(status_code=404, detail="Stakeholder not found")

    project_memory = get_project_memory_payload(project)
    client_memory = get_client_memory_payload(client)
    focus = (body.focus if body else "") or ""
    prompt = (
        "You are a senior account strategy advisor. Analyze this contact for the current project and client.\n"
        "Return ONLY a valid JSON object with keys: personality_profile, decision_style, communication_strategy, trust_signals.\n"
        "Keep each value concise, practical, and based only on the provided facts. If evidence is limited, say what is inferred and what still needs validation.\n\n"
        f"Project:\n- name: {project.name}\n- client: {project.client}\n- status: {project.status}\n- description: {project.description}\n\n"
        f"Project memory JSON:\n{json.dumps(project_memory, ensure_ascii=False)[:6000]}\n\n"
        f"Client memory JSON:\n{json.dumps(client_memory, ensure_ascii=False)[:6000]}\n\n"
        "Contact profile:\n"
        f"- name: {stakeholder.name}\n"
        f"- role: {stakeholder.role}\n"
        f"- organization_level: {stakeholder.organization_level}\n"
        f"- influence_type: {stakeholder.influence_type}\n"
        f"- relationship_status: {stakeholder.relationship_status}\n"
        f"- concerns: {stakeholder.concerns}\n"
        f"- sensitivities: {stakeholder.sensitivities}\n"
        f"- communication_preference: {stakeholder.communication_preference}\n"
        f"- last_action: {stakeholder.last_action}\n"
        f"- existing_note: {stakeholder.note}\n"
        f"- focus: {focus}\n\n"
        "Write in Chinese unless the facts are clearly English-only."
    )
    raw = await complete_with_selected_model(messages=[{"role": "user", "content": prompt}], max_tokens=1600)
    try:
        parsed = json.loads(_extract_first_json_object_from_text(str(raw or "")))
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    stakeholder.personality_profile = str(parsed.get("personality_profile") or "").strip()[:2000]
    stakeholder.decision_style = str(parsed.get("decision_style") or "").strip()[:2000]
    stakeholder.communication_strategy = str(parsed.get("communication_strategy") or "").strip()[:2400]
    stakeholder.trust_signals = str(parsed.get("trust_signals") or "").strip()[:2000]
    stakeholder.updated_at = utc_now_naive()
    session.add(stakeholder)
    session.commit()
    session.refresh(stakeholder)
    mark_client_memory_stale_by_name(session, project.client, trigger="stakeholder_analyzed")
    _bust_project(project_id)
    clients_cache.delete(_CLIENTS_KEY)
    return _serialize_client_stakeholder_dict(stakeholder)
