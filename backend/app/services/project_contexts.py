from __future__ import annotations

from datetime import datetime
from typing import Any, AsyncIterator, Collection, Mapping
import json

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectMemorySnapshot, ProjectMemorySummary
from app.services.memory_facts import (
    MODEL_SOURCE_ATTRIBUTIONS_KEY,
    bind_model_source_attributions,
    normalize_model_source_attributions,
)
from app.services.memory_rebuilds import (
    MemoryPatchValidationError,
    MemoryRebuildPlan,
    assert_memory_rebuild_baseline,
)
from app.services.memory_source_tags import strip_memory_source_tags
from app.services.memory_slots import (
    PROJECT_MEMORY_SLOT_KEYS,
    build_project_slot_evidence_refs,
)
from app.services.project_files import list_project_files
from app.services.project_financials import list_project_payments
from app.services.project_milestones import list_project_milestones
from app.services.project_progress import list_project_progress_updates
from app.services.project_todos import list_project_todos
from app.services.project_clients import find_client_for_project
from app.services.stakeholder_contexts import (
    format_client_stakeholders_for_prompt,
    list_client_stakeholder_dicts,
)
from app.services.time_utils import utc_now_naive

MAX_SUMMARY_MILESTONES = 6
MAX_SUMMARY_FILES = 8
MAX_SUMMARY_PROGRESS_UPDATES = 5
MAX_FILE_SUMMARY_CHARS = 60
MAX_DESCRIPTION_CHARS = 240
OUTPUT_TRUNCATED_MARKER = "[OUTPUT_TRUNCATED]"

MAX_MEMORY_FILE_SUMMARY_CHARS = 200
MAX_MEMORY_DESCRIPTION_CHARS = 1200
MAX_MEMORY_PROGRESS_UPDATES = 8
PROJECT_MEMORY_SUMMARY_TYPES = (
    "overview",
    "risk",
    "delivery",
    "stakeholder",
    "client-facing",
    "financial",
    "documents",
)
SUPPORTED_MEMORY_SUMMARY_TYPES = set(PROJECT_MEMORY_SUMMARY_TYPES)

PROJECT_MEMORY_SUMMARY_INSTRUCTIONS = {
    "overview": (
        "Write exactly 3-4 bullet points for an overview card. Focus on core objective, "
        "current stage, major progress, key risks or open questions, and next actions."
    ),
    "risk": (
        "Write exactly 3-4 bullet points focused on project risks. Highlight key risks, "
        "blocked decisions, weak delivery signals, and what needs attention next."
    ),
    "delivery": (
        "Write exactly 3-4 bullet points focused on delivery. Highlight current stage, progress, "
        "important documents, delivery signals, and immediate execution next steps."
    ),
    "stakeholder": (
        "Write exactly 3-4 bullet points focused on stakeholder alignment. Highlight who matters, "
        "what each stakeholder cares about, open alignment issues, and suggested follow-ups."
    ),
    "client-facing": (
        "Write exactly 3-4 bullet points that are safe to share with a client. Focus on progress, "
        "current priorities, confirmed next steps, and avoid speculative internal wording."
    ),
    "financial": (
        "Write exactly 3-4 bullet points focused on the project's financial picture. Highlight payment status, "
        "collection risks, budget pressure, cash flow signals, and the next financial actions that matter."
    ),
    "documents": (
        "Write exactly 3-4 bullet points focused on project documents and knowledge signals. Highlight important "
        "documents, what each one supports, missing material, and the next documents worth reviewing or creating."
    ),
}

MAX_SUMMARY_FIELD_CHARS = 320
MAX_SUMMARY_LIST_ITEMS = 5
MAX_SUMMARY_LIST_ITEM_CHARS = 120
MAX_SUMMARY_DOCUMENT_ITEMS = 4
MAX_SUMMARY_DOCUMENT_NAME_CHARS = 80
MAX_SUMMARY_DOCUMENT_REASON_CHARS = 120
EDITABLE_MEMORY_SLOTS = ("key_risks", "open_questions", "stakeholder_notes")
ACCEPTED_MEMORY_CANDIDATES_KEY = "_accepted_memory_candidates"


def _resolve_output_language(language: str | None) -> str:
    normalized = (language or "").strip().lower()
    if normalized.startswith("zh"):
        return "Chinese"
    if normalized.startswith("en"):
        return "English"
    return "the user's selected language"


def normalize_summary_language(language: str | None) -> str:
    normalized = (language or "").strip().lower()
    if normalized.startswith("zh"):
        return "zh"
    if normalized.startswith("en"):
        return "en"
    return normalized or "default"


def _default_project_memory(project: Project) -> dict[str, Any]:
    return {
        "project_brief": project.description[:300] if project.description else "",
        "current_stage": project.status,
        "current_objective": "",
        "recent_progress": [],
        "key_risks": {"ai": [], "pinned": []},
        "open_questions": {"ai": [], "pinned": []},
        "next_actions": [],
        "important_documents": [],
        "financial_status": "",
        "delivery_signals": [],
        "stakeholder_notes": {"ai": [], "pinned": []},
        "client_stakeholders": [],
        "memory_version": project.memory_version,
        "last_updated_at": project.memory_updated_at.isoformat() if project.memory_updated_at else "",
        "stale": project.memory_stale,
        "rebuild_log": [],
        "_coverage": {},
        ACCEPTED_MEMORY_CANDIDATES_KEY: {},
    }


def _flatten_editable_slot(value: Any) -> list[str]:
    if isinstance(value, dict):
        merged: list[str] = []
        for key in ("ai", "pinned"):
            slot_value = value.get(key, [])
            if isinstance(slot_value, list):
                merged.extend(str(item).strip() for item in slot_value if str(item).strip())
        return merged
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _normalize_editable_slot(value: Any, pinned: list[str] | None = None) -> dict[str, list[str]]:
    pinned_values = [str(item).strip() for item in (pinned or []) if str(item).strip()]
    if isinstance(value, dict):
        ai_values = value.get("ai", [])
        pinned_values = [
            *pinned_values,
            *[str(item).strip() for item in value.get("pinned", []) if str(item).strip()],
        ]
        return {
            "ai": [str(item).strip() for item in ai_values if str(item).strip()] if isinstance(ai_values, list) else [],
            "pinned": list(dict.fromkeys(pinned_values)),
        }
    if isinstance(value, list):
        return {
            "ai": [str(item).strip() for item in value if str(item).strip()],
            "pinned": list(dict.fromkeys(pinned_values)),
        }
    return {"ai": [], "pinned": list(dict.fromkeys(pinned_values))}


def _get_existing_raw_memory(project: Project) -> dict[str, Any]:
    try:
        parsed = json.loads(project.context_memory_json or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _merge_accepted_memory_candidates(
    memory: dict[str, Any],
    existing_raw: dict[str, Any],
) -> dict[str, Any]:
    """Overlay user-accepted anchors onto a newly derived memory payload."""

    existing_candidates = existing_raw.get(ACCEPTED_MEMORY_CANDIDATES_KEY)
    existing_candidates = (
        dict(existing_candidates) if isinstance(existing_candidates, dict) else {}
    )
    incoming_candidates = memory.get(ACCEPTED_MEMORY_CANDIDATES_KEY)
    incoming_candidates = (
        dict(incoming_candidates) if isinstance(incoming_candidates, dict) else {}
    )
    accepted_candidates: dict[str, list[str]] = {}
    for slot_name in {*existing_candidates, *incoming_candidates}:
        combined: list[str] = []
        for source in (existing_candidates.get(slot_name), incoming_candidates.get(slot_name)):
            if isinstance(source, list):
                combined.extend(str(item).strip() for item in source if str(item).strip())
        accepted_candidates[str(slot_name)] = list(dict.fromkeys(combined))[-50:]
    for slot_name, raw_items in accepted_candidates.items():
        items = (
            [str(item).strip() for item in raw_items if str(item).strip()]
            if isinstance(raw_items, list)
            else []
        )
        if slot_name in EDITABLE_MEMORY_SLOTS:
            slot = _normalize_editable_slot(memory.get(slot_name))
            slot["pinned"] = list(dict.fromkeys([*slot["pinned"], *items]))[-50:]
            memory[slot_name] = slot
        elif slot_name in {"recent_progress", "next_actions", "delivery_signals"}:
            current = memory.get(slot_name)
            current = (
                [str(item).strip() for item in current if str(item).strip()]
                if isinstance(current, list)
                else []
            )
            memory[slot_name] = list(dict.fromkeys([*current, *items]))[-50:]
    memory[ACCEPTED_MEMORY_CANDIDATES_KEY] = accepted_candidates
    return memory


def get_project_memory_payload(project: Project) -> dict[str, Any]:
    base = _default_project_memory(project)
    try:
        parsed = json.loads(project.context_memory_json or "{}")
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}
    payload = {
        **base,
        **parsed,
        "memory_version": project.memory_version,
        "last_updated_at": project.memory_updated_at.isoformat() if project.memory_updated_at else "",
        "stale": project.memory_stale,
    }
    for slot_name in EDITABLE_MEMORY_SLOTS:
        raw_value = payload.get(slot_name)
        normalized = _normalize_editable_slot(raw_value)
        payload[f"{slot_name}_detail"] = normalized
        payload[slot_name] = _flatten_editable_slot(normalized)
    return payload


def mark_project_memory_stale(
    session: Session,
    project_id: int,
    trigger: str = "data_changed",
    *,
    commit: bool = True,
) -> None:
    project = session.exec(
        select(Project)
        .where(Project.id == project_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    ).first()
    if not project:
        return
    from app.services.memory_slots import mark_project_memory_slots_stale
    from app.services.memory_facts import mark_project_memory_facts_stale

    mark_project_memory_slots_stale(session, project_id, trigger)
    mark_project_memory_facts_stale(session, project_id, trigger)
    project.memory_stale = True
    if project.memory_rebuild_status != "rebuilding":
        project.memory_rebuild_status = "idle"
    project.updated_at = utc_now_naive()
    session.add(project)
    if commit:
        session.commit()


def mark_project_memories_stale_by_client_id(
    session: Session,
    client_id: int,
    *,
    trigger: str = "client_source_changed",
    commit: bool = True,
) -> None:
    """Invalidate projects linked to one stable client identity."""

    from app.models.db import ClientRecord
    from app.services.project_clients import list_projects_for_client

    client = session.get(ClientRecord, client_id)
    if client is None:
        return
    project_ids = sorted(
        [
        int(project.id)
        for project in list_projects_for_client(session, client)
        if project.id is not None
        ]
    )
    for project_id in project_ids:
        mark_project_memory_stale(
            session,
            project_id,
            trigger=trigger,
            commit=False,
        )
    if commit:
        session.commit()


def build_project_context_data(session: Session, project_id: int) -> tuple[Project, str]:
    """Lightweight context for real-time view summary (capped quantities)."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    milestones = list_project_milestones(session, project_id)
    files = list_project_files(session, project_id)
    progress_updates = list_project_progress_updates(session, project_id, limit=MAX_SUMMARY_PROGRESS_UPDATES)

    lines = [
        f"Project: {project.name}",
        f"Client: {project.client}",
        f"Status: {project.status}",
    ]
    if project.description:
        lines.append(f"Description: {project.description[:MAX_DESCRIPTION_CHARS]}")
    if progress_updates:
        lines.append(f"Progress updates (showing latest {len(progress_updates)}):")
        for update in progress_updates:
            # Keep provider inputs dependent only on the locked progress row.
            # User.display_name is mutable and the User row is intentionally
            # outside the Project -> child source-lock family.
            by = (
                f"user #{int(update.created_by_user_id)}"
                if update.created_by_user_id is not None
                else "unknown"
            )
            lines.append(f"  - {by}: {update.content}")
            if update.next_step:
                lines.append(f"    next: {update.next_step}")
            if update.risk:
                lines.append(f"    risk: {update.risk}")
    if milestones:
        completed_count = sum(1 for milestone in milestones if milestone.is_done)
        lines.append(
            f"Milestones ({len(milestones)} total, {completed_count} completed, showing latest {min(len(milestones), MAX_SUMMARY_MILESTONES)}):"
        )
        for milestone in milestones[:MAX_SUMMARY_MILESTONES]:
            status = "done" if milestone.is_done else "pending"
            priority = f" [{milestone.priority}]" if milestone.priority == "high" else ""
            due_hint = f" (due {milestone.due_date})" if milestone.due_date else ""
            lines.append(f"  - {status} {milestone.title}{priority}{due_hint}")
    if files:
        lines.append(
            f"Uploaded files ({len(files)} total, showing latest {min(len(files), MAX_SUMMARY_FILES)}):"
        )
        recent_files = sorted(files, key=lambda project_file: project_file.uploaded_at, reverse=True)
        for project_file in recent_files[:MAX_SUMMARY_FILES]:
            lines.append(
                f"  - {project_file.name}"
                + (
                    f": {project_file.summary[:MAX_FILE_SUMMARY_CHARS]}"
                    if project_file.summary
                    else ""
                )
            )

    return project, "\n".join(lines)


def build_project_memory_data(
    session: Session,
    project_id: int,
    slot_keys: tuple[str, ...] | None = None,
) -> tuple[Project, str, dict[str, Any]]:
    """Load only the source families needed by the requested memory slots."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    selected = set(slot_keys or PROJECT_MEMORY_SLOT_KEYS)
    needs_progress = bool(
        selected
        & {
            "current_objective",
            "recent_progress",
            "key_risks",
            "open_questions",
            "next_actions",
            "delivery_signals",
        }
    )
    needs_milestones = bool(
        selected
        & {
            "current_stage",
            "current_objective",
            "recent_progress",
            "key_risks",
            "open_questions",
            "next_actions",
            "delivery_signals",
        }
    )
    needs_todos = bool(
        selected
        & {
            "current_objective",
            "recent_progress",
            "open_questions",
            "next_actions",
            "delivery_signals",
        }
    )
    needs_files = bool(selected & {"important_documents", "delivery_signals"})
    needs_payments = bool(selected & {"financial_status", "key_risks"})
    needs_stakeholders = bool(
        selected & {"stakeholder_notes", "client_stakeholders"}
    )

    milestones = list_project_milestones(session, project_id) if needs_milestones else []
    files = list_project_files(session, project_id) if needs_files else []
    todos = list_project_todos(session, project_id) if needs_todos else []
    payments = list_project_payments(session, project_id) if needs_payments else []
    progress_updates = (
        list_project_progress_updates(
            session,
            project_id,
            limit=MAX_MEMORY_PROGRESS_UPDATES,
        )
        if needs_progress
        else []
    )
    project_client = find_client_for_project(session, project) if needs_stakeholders else None
    client_stakeholders = (
        list_client_stakeholder_dicts(
            session,
            int(project_client.id),
            include_source_id=True,
        )
        if project_client is not None and project_client.id is not None
        else []
    )
    prompt_milestones = sorted(
        milestones,
        key=lambda item: int(item.id or 0),
        reverse=True,
    )[:8]
    prompt_todos = sorted(
        todos,
        key=lambda item: item.updated_at,
        reverse=True,
    )[:8]
    prompt_files = sorted(
        files,
        key=lambda item: item.uploaded_at,
        reverse=True,
    )[:12]
    prompt_payments = sorted(
        payments,
        key=lambda item: int(item.id or 0),
        reverse=True,
    )[:12]

    project_source = f"[project:{project.id}]"
    lines = [
        f"{project_source} Project: {project.name}",
        f"{project_source} Client: {project.client}",
        f"{project_source} Status: {project.status}",
        f"{project_source} Contract amount: {project.contract_amount}",
    ]
    if project.description and selected & {
        "project_brief",
        "current_stage",
        "current_objective",
        "key_risks",
        "open_questions",
        "delivery_signals",
    }:
        lines.append(
            f"{project_source} Description: "
            f"{project.description[:MAX_MEMORY_DESCRIPTION_CHARS]}"
        )
    if project.notes and selected & {
        "project_brief",
        "current_stage",
        "current_objective",
        "key_risks",
        "open_questions",
        "delivery_signals",
    }:
        lines.append(
            f"{project_source} Notes:\n"
            f"{project.notes[:MAX_MEMORY_DESCRIPTION_CHARS]}"
        )
    if project.md_notes and selected & {
        "project_brief",
        "current_stage",
        "current_objective",
        "key_risks",
        "open_questions",
        "delivery_signals",
    }:
        lines.append(
            f"{project_source} Markdown notes:\n"
            f"{project.md_notes[:MAX_MEMORY_DESCRIPTION_CHARS]}"
        )
    if progress_updates:
        lines.append(f"Progress updates ({len(progress_updates)} recent):")
        for update in progress_updates:
            by = (
                f"user #{int(update.created_by_user_id)}"
                if update.created_by_user_id is not None
                else "unknown"
            )
            source = f"[project_progress:{update.id}]"
            lines.append(f"  - {source} {by}: {update.content}")
            if update.next_step:
                lines.append(f"    {source} next: {update.next_step}")
            if update.risk:
                lines.append(f"    {source} risk: {update.risk}")
    if milestones:
        completed_count = sum(1 for milestone in milestones if milestone.is_done)
        lines.append(
            f"Milestones ({len(milestones)} total, {completed_count} completed, "
            f"showing latest {len(prompt_milestones)}):"
        )
        for milestone in prompt_milestones:
            status = "done" if milestone.is_done else "pending"
            priority = f" [{milestone.priority}]" if milestone.priority == "high" else ""
            due_hint = f" (due {milestone.due_date})" if milestone.due_date else ""
            lines.append(
                f"  - [milestone:{milestone.id}] "
                f"{status} {milestone.title}{priority}{due_hint}"
            )
    if todos:
        pending_count = sum(1 for todo in todos if not todo.is_done)
        lines.append(
            f"Todos ({len(todos)} total, {pending_count} pending, "
            f"showing latest {len(prompt_todos)}):"
        )
        for todo in prompt_todos:
            status = "done" if todo.is_done else "pending"
            due_hint = f" (due {todo.due_date})" if todo.due_date else ""
            lines.append(
                f"  - [project_todo:{todo.id}] {status} {todo.content}{due_hint}"
            )
    if files:
        lines.append(
            f"Uploaded files ({len(files)} total, showing latest {len(prompt_files)}):"
        )
        for project_file in prompt_files:
            lines.append(
                f"  - [project_file:{project_file.id}] {project_file.name}"
                + (
                    f": {project_file.summary[:MAX_MEMORY_FILE_SUMMARY_CHARS]}"
                    if project_file.summary
                    else ""
                )
            )
    if payments:
        lines.append(
            f"Payments ({len(payments)} total, showing latest {len(prompt_payments)}):"
        )
        for payment in prompt_payments:
            lines.append(
                f"  - [project_payment:{payment.id}] {payment.payment_date} | "
                f"{payment.payment_type} | {payment.amount} | {payment.note}"
            )
    stakeholder_context = format_client_stakeholders_for_prompt(client_stakeholders)
    if stakeholder_context:
        lines.append(stakeholder_context)

    coverage: dict[str, Any] = {"built_at": utc_now_naive().isoformat()}
    source_handles = list(
        dict.fromkeys(
            [
                f"project:{project.id}",
                *[
                    f"project_progress:{update.id}"
                    for update in progress_updates
                    if update.id is not None
                ],
                *[
                    f"milestone:{milestone.id}"
                    for milestone in prompt_milestones
                    if milestone.id is not None
                ],
                *[
                    f"project_todo:{todo.id}"
                    for todo in prompt_todos
                    if todo.id is not None
                ],
                *[
                    f"project_file:{project_file.id}"
                    for project_file in prompt_files
                    if project_file.id is not None
                ],
                *[
                    f"project_payment:{payment.id}"
                    for payment in prompt_payments
                    if payment.id is not None
                ],
                *[
                    f"client_stakeholder:{stakeholder.get('_source_id')}"
                    for stakeholder in client_stakeholders
                    if stakeholder.get("_source_id")
                ],
            ]
        )
    )
    visible_source_handles = set(source_handles)
    evidence_by_slot = build_project_slot_evidence_refs(session, project)
    coverage["_source_snapshots"] = {
        handle: source_sha256
        for slot_key in selected
        for ref in evidence_by_slot.get(slot_key, [])
        if (
            handle := f"{ref.get('source_type', '')}:{ref.get('source_id', '')}"
        ) in visible_source_handles
        if (source_sha256 := str(ref.get("source_sha256") or ""))
    }
    if needs_milestones:
        coverage["milestones_total"] = len(milestones)
    if needs_files:
        coverage["files_total"] = len(files)
    if needs_todos:
        coverage["todos_total"] = len(todos)
    if needs_payments:
        coverage["payments_total"] = len(payments)
    if needs_stakeholders:
        coverage.update(
            {
                "client_stakeholders_total": len(client_stakeholders),
                "client_stakeholders": [
                    {
                        key: value
                        for key, value in stakeholder.items()
                        if key != "_source_id"
                    }
                    for stakeholder in client_stakeholders
                ],
                "_client_stakeholder_source_ids": [
                    str(stakeholder.get("_source_id") or "")
                    for stakeholder in client_stakeholders
                ],
            }
        )

    return project, "\n".join(lines), coverage


def build_project_memory_prompt(
    project_data: str,
    slot_keys: tuple[str, ...] | None = None,
) -> str:
    selected = tuple(slot_keys or PROJECT_MEMORY_SLOT_KEYS)
    exact_keys = ", ".join(selected)
    partial_instruction = (
        "This is a partial rebuild. Return every requested business key and no unrequested business keys. "
        if slot_keys is not None
        else ""
    )
    rules: list[str] = []
    if set(selected) & {
        "recent_progress",
        "key_risks",
        "open_questions",
        "next_actions",
        "delivery_signals",
        "stakeholder_notes",
    }:
        rules.append(
            "Requested narrative collection slots must be arrays of strings."
        )
    if "important_documents" in selected:
        rules.append(
            "important_documents must be an array of objects with keys name and reason."
        )
    if "client_stakeholders" in selected:
        rules.append(
            "client_stakeholders must be an array of objects with keys name, role, influence_type, relationship_status, concerns, communication_preference, note."
        )
    return (
        "You are building a structured long-term memory for a consulting project. "
        "Use only the project data below. Do not invent missing facts. "
        f"{partial_instruction}Return valid JSON only with these business keys: {exact_keys}, "
        f"plus the private {MODEL_SOURCE_ATTRIBUTIONS_KEY} key described below. "
        f"Rules: {' '.join(rules)} "
        "Keep each item concise and concrete. Prefer empty string or empty arrays over guessing. "
        f"Also return {MODEL_SOURCE_ATTRIBUTIONS_KEY} as an array of objects with keys "
        "slot_key, fact_index, source_ids. fact_index is zero-based within the returned "
        "slot (a scalar uses 0; an editable slot counts only its returned AI array). "
        "source_ids must contain only exact [source_type:id] IDs visible below, without "
        "the brackets. Return at most 48 attribution objects. Never copy a "
        "[source_type:id] marker into any business value; markers belong only in this "
        "private envelope. Attribute every supported non-empty fact; omit an attribution "
        "instead of guessing or citing a merely related source. "
        "Write in the same language as the project.\n\n"
        f"Project data:\n{project_data}"
    )


def build_project_context_prompt(project_data: str) -> str:
    return (
        "You are an AI consultant assistant preparing a project overview summary. "
        "Treat the current project as the only source of truth. "
        "Do not blend in facts, progress, or risks from other projects, even if they belong to the same client. "
        "If information is missing, say less rather than guessing. "
        "Write a concise project understanding based only on the material below.\n\n"
        f"Project data:\n{project_data}"
    )


def build_project_summary_from_memory_prompt(
    memory: dict[str, Any],
    project_name: str,
    language: str | None = None,
) -> str:
    output_language = _resolve_output_language(language)
    return (
        "You are an AI consultant assistant. "
        "Based on the structured project memory below, write exactly 3-4 bullet points for an overview card. "
        "Focus on core objective, current stage, key risks or open questions, critical milestones or progress, and next actions. "
        "Each bullet must be specific and actionable. Use **bold** sparingly for key terms. "
        f"Return ONLY bullet points, one per line, starting with '- '. Keep the full answer under 120 words. Write the answer in {output_language}.\n\n"
        f"Project: {project_name}\n"
        f"Structured memory JSON:\n{json.dumps(memory, ensure_ascii=False)}"
    )


def build_project_memory_view_prompt(
    memory: dict[str, Any],
    project_name: str,
    summary_type: str = "overview",
    language: str | None = None,
) -> str:
    normalized_type = summary_type if summary_type in SUPPORTED_MEMORY_SUMMARY_TYPES else "overview"
    output_language = _resolve_output_language(language)
    compact_memory = build_project_memory_summary_payload(memory, normalized_type)
    return (
        "You are an AI consultant assistant. "
        f"{PROJECT_MEMORY_SUMMARY_INSTRUCTIONS[normalized_type]} "
        "Each bullet must be specific and concise. Use **bold** sparingly for key terms. "
        "Do not restate every field. Synthesize only the most decision-relevant points. "
        f"Return ONLY bullet points, one per line, starting with '- '. Keep the full answer under 90 words. Write the answer in {output_language}.\n\n"
        f"Project: {project_name}\n"
        f"Summary type: {normalized_type}\n"
        f"Structured memory JSON:\n{json.dumps(compact_memory, ensure_ascii=False)}"
    )


def build_project_memory_multi_summary_prompt(
    memory: dict[str, Any],
    project_name: str,
    summary_types: list[str] | tuple[str, ...] = PROJECT_MEMORY_SUMMARY_TYPES,
    language: str | None = None,
) -> str:
    output_language = _resolve_output_language(language)
    normalized_types = [item for item in summary_types if item in SUPPORTED_MEMORY_SUMMARY_TYPES]
    if not normalized_types:
        normalized_types = list(PROJECT_MEMORY_SUMMARY_TYPES)

    sections = []
    payload = {}
    for summary_type in normalized_types:
        sections.append(f"- {summary_type}: {PROJECT_MEMORY_SUMMARY_INSTRUCTIONS[summary_type]}")
        payload[summary_type] = build_project_memory_summary_payload(memory, summary_type)

    return (
        "You are an AI consultant assistant. Generate all requested project summary views in one response. "
        "Each view must be exactly 3-4 Markdown bullet points, specific, concise, and decision-relevant. "
        "Use **bold** sparingly for key terms. Do not restate every field. "
        f"Write all summaries in {output_language}.\n\n"
        "Return ONLY a valid JSON object. The object keys must exactly match the requested summary types. "
        "Each value must be a single string containing Markdown bullet points separated by newline characters. "
        "Do not wrap the JSON in markdown fences.\n\n"
        f"Project: {project_name}\n"
        "Requested summary views:\n"
        + "\n".join(sections)
        + "\n\nStructured memory JSON by view:\n"
        + json.dumps(payload, ensure_ascii=False)
    )


def parse_project_memory_multi_summary(raw: str, summary_types: list[str] | tuple[str, ...]) -> dict[str, str]:
    summaries, missing = parse_project_memory_multi_summary_with_missing(raw, summary_types)
    if missing:
        raise ValueError(f"AI summary JSON missing required views: {', '.join(missing)}")
    return summaries


def parse_project_memory_multi_summary_with_missing(
    raw: str,
    summary_types: list[str] | tuple[str, ...],
) -> tuple[dict[str, str], list[str]]:
    try:
        parsed = json.loads(_extract_first_json_object(raw))
    except Exception as exc:
        raise ValueError("AI did not return valid summary JSON") from exc

    if not isinstance(parsed, dict):
        raise ValueError("AI summary JSON must be an object")

    summaries: dict[str, str] = {}
    for summary_type in summary_types:
        if summary_type not in SUPPORTED_MEMORY_SUMMARY_TYPES:
            continue
        value = parsed.get(summary_type)
        if isinstance(value, list):
            content = "\n".join(str(item).strip() for item in value if str(item).strip())
        else:
            content = str(value or "").strip()
        if content:
            summaries[summary_type] = content

    missing = [summary_type for summary_type in summary_types if summary_type in SUPPORTED_MEMORY_SUMMARY_TYPES and not summaries.get(summary_type)]
    return summaries, missing


def _trim_text(value: Any, max_chars: int = MAX_SUMMARY_FIELD_CHARS) -> str:
    text = str(value or "").strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def _trim_list(values: Any, limit: int = MAX_SUMMARY_LIST_ITEMS) -> list[str]:
    if not isinstance(values, list):
        return []
    trimmed: list[str] = []
    for item in values:
        text = _trim_text(item, MAX_SUMMARY_LIST_ITEM_CHARS)
        if text:
            trimmed.append(text)
        if len(trimmed) >= limit:
            break
    return trimmed


def _trim_documents(values: Any) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    documents: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        name = _trim_text(item.get("name", ""), MAX_SUMMARY_DOCUMENT_NAME_CHARS)
        reason = _trim_text(item.get("reason", ""), MAX_SUMMARY_DOCUMENT_REASON_CHARS)
        if name or reason:
            documents.append({"name": name, "reason": reason})
        if len(documents) >= MAX_SUMMARY_DOCUMENT_ITEMS:
            break
    return documents


def _trim_stakeholders(values: Any, limit: int = 6) -> list[dict[str, str]]:
    if not isinstance(values, list):
        return []
    stakeholders: list[dict[str, str]] = []
    for item in values:
        if not isinstance(item, dict):
            continue
        row = {
            "name": _trim_text(item.get("name", ""), 60),
            "role": _trim_text(item.get("role", ""), 60),
            "influence_type": _trim_text(item.get("influence_type", ""), 60),
            "relationship_status": _trim_text(item.get("relationship_status", ""), 60),
            "concerns": _trim_text(item.get("concerns", ""), 120),
            "communication_preference": _trim_text(item.get("communication_preference", ""), 100),
            "note": _trim_text(item.get("note", ""), 120),
        }
        if any(row.values()):
            stakeholders.append(row)
        if len(stakeholders) >= limit:
            break
    return stakeholders


def build_project_memory_summary_payload(memory: dict[str, Any], summary_type: str) -> dict[str, Any]:
    base = {
        "project_brief": _trim_text(memory.get("project_brief", "")),
        "current_stage": _trim_text(memory.get("current_stage", ""), 80),
        "current_objective": _trim_text(memory.get("current_objective", "")),
        "recent_progress": _trim_list(memory.get("recent_progress", [])),
        "key_risks": _trim_list(memory.get("key_risks", [])),
        "open_questions": _trim_list(memory.get("open_questions", [])),
        "next_actions": _trim_list(memory.get("next_actions", [])),
        "important_documents": _trim_documents(memory.get("important_documents", [])),
        "financial_status": _trim_text(memory.get("financial_status", "")),
        "delivery_signals": _trim_list(memory.get("delivery_signals", [])),
        "stakeholder_notes": _trim_list(memory.get("stakeholder_notes", [])),
        "client_stakeholders": _trim_stakeholders(memory.get("client_stakeholders", [])),
    }

    if summary_type == "risk":
        return {
            "current_stage": base["current_stage"],
            "current_objective": base["current_objective"],
            "key_risks": base["key_risks"],
            "open_questions": base["open_questions"],
            "delivery_signals": base["delivery_signals"],
            "next_actions": base["next_actions"],
        }
    if summary_type == "stakeholder":
        return {
            "project_brief": base["project_brief"],
            "current_stage": base["current_stage"],
            "stakeholder_notes": base["stakeholder_notes"],
            "client_stakeholders": base["client_stakeholders"],
            "open_questions": base["open_questions"],
            "next_actions": base["next_actions"],
        }
    if summary_type == "delivery":
        return {
            "current_stage": base["current_stage"],
            "current_objective": base["current_objective"],
            "recent_progress": base["recent_progress"],
            "delivery_signals": base["delivery_signals"],
            "next_actions": base["next_actions"],
            "important_documents": base["important_documents"],
        }
    if summary_type == "client-facing":
        return {
            "project_brief": base["project_brief"],
            "current_stage": base["current_stage"],
            "recent_progress": base["recent_progress"],
            "next_actions": base["next_actions"],
            "client_stakeholders": base["client_stakeholders"],
        }
    if summary_type == "financial":
        return {
            "current_stage": base["current_stage"],
            "financial_status": base["financial_status"],
            "key_risks": base["key_risks"],
            "open_questions": base["open_questions"],
            "next_actions": base["next_actions"],
        }
    if summary_type == "documents":
        return {
            "project_brief": base["project_brief"],
            "important_documents": base["important_documents"],
            "delivery_signals": base["delivery_signals"],
            "open_questions": base["open_questions"],
            "next_actions": base["next_actions"],
        }
    return base


def _extract_first_json_object(raw: str) -> str:
    raw = raw.strip()
    if raw.startswith("{") and raw.endswith("}"):
        return raw

    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        return raw[start : end + 1]
    return "{}"


def _project_model_fact_bindings(
    parsed: dict[str, Any],
    slot_keys: tuple[str, ...],
) -> dict[str, dict[int, tuple[str, Any]]]:
    """Bind provider indexes to the canonical values Aria will persist."""

    bindings: dict[str, dict[int, tuple[str, Any]]] = {}
    string_slots = {
        "project_brief",
        "current_stage",
        "current_objective",
        "financial_status",
    }
    list_string_slots = {"recent_progress", "next_actions", "delivery_signals"}
    for slot_key in slot_keys:
        if slot_key not in parsed:
            continue
        value = strip_memory_source_tags(parsed[slot_key])
        slot_bindings: dict[int, tuple[str, Any]] = {}
        if slot_key in string_slots and isinstance(value, str):
            canonical = value.strip()
            if canonical:
                slot_bindings[0] = ("value", canonical)
        elif slot_key in list_string_slots and isinstance(value, list):
            for raw_index, item in enumerate(value):
                if isinstance(item, str) and (canonical := item.strip()):
                    slot_bindings[raw_index] = ("item", canonical)
        elif slot_key in EDITABLE_MEMORY_SLOTS:
            ai_values = value.get("ai", []) if isinstance(value, dict) else value
            if isinstance(ai_values, list):
                for raw_index, item in enumerate(ai_values):
                    if isinstance(item, str) and (canonical := item.strip()):
                        slot_bindings[raw_index] = ("ai", canonical)
        elif slot_key == "important_documents" and isinstance(value, list):
            for raw_index, item in enumerate(value):
                if isinstance(item, dict):
                    slot_bindings[raw_index] = (
                        "item",
                        {
                            "name": str(item.get("name", "")),
                            "reason": str(item.get("reason", "")),
                        },
                    )
        elif slot_key == "client_stakeholders" and isinstance(value, list):
            for raw_index, item in enumerate(value):
                if isinstance(item, dict):
                    slot_bindings[raw_index] = ("item", item)
        if slot_bindings:
            bindings[slot_key] = slot_bindings
    return bindings


def parse_project_memory(raw: str, project: Project) -> dict[str, Any]:
    base = _default_project_memory(project)
    existing_raw = _get_existing_raw_memory(project)
    try:
        parsed = json.loads(_extract_first_json_object(raw))
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    parsed_business = {
        key: strip_memory_source_tags(value)
        for key, value in parsed.items()
        if key != MODEL_SOURCE_ATTRIBUTIONS_KEY
    }
    memory = {**base, **parsed_business}
    for key in ("recent_progress", "next_actions", "delivery_signals"):
        value = memory.get(key)
        memory[key] = value if isinstance(value, list) else []
    client_stakeholders = memory.get("client_stakeholders")
    memory["client_stakeholders"] = client_stakeholders if isinstance(client_stakeholders, list) else []

    for key in EDITABLE_MEMORY_SLOTS:
        existing_slot = existing_raw.get(key, {})
        existing_pinned = []
        if isinstance(existing_slot, dict):
            existing_pinned = [
                str(item).strip()
                for item in existing_slot.get("pinned", [])
                if str(item).strip()
            ]
        memory[key] = _normalize_editable_slot(memory.get(key), pinned=existing_pinned)

    _merge_accepted_memory_candidates(memory, existing_raw)

    important_documents = memory.get("important_documents")
    if isinstance(important_documents, list):
        memory["important_documents"] = [
            {
                "name": str(item.get("name", "")),
                "reason": str(item.get("reason", "")),
            }
            for item in important_documents
            if isinstance(item, dict)
        ]
    else:
        memory["important_documents"] = []

    memory["rebuild_log"] = existing_raw.get("rebuild_log", []) if isinstance(existing_raw.get("rebuild_log"), list) else []
    memory["_coverage"] = existing_raw.get("_coverage", {}) if isinstance(existing_raw.get("_coverage"), dict) else {}
    memory[MODEL_SOURCE_ATTRIBUTIONS_KEY] = bind_model_source_attributions(
        parsed.get(MODEL_SOURCE_ATTRIBUTIONS_KEY),
        PROJECT_MEMORY_SLOT_KEYS,
        _project_model_fact_bindings(parsed, PROJECT_MEMORY_SLOT_KEYS),
    )

    return memory


def parse_project_memory_patch(
    raw: str,
    project: Project,
    slot_keys: tuple[str, ...],
) -> dict[str, Any]:
    """Strictly validate and merge an LLM response for selected project slots."""

    try:
        parsed = json.loads(_extract_first_json_object(raw))
    except json.JSONDecodeError as exc:
        raise MemoryPatchValidationError("partial project memory is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise MemoryPatchValidationError("partial project memory must be an object")

    selected = tuple(slot_keys)
    missing = [key for key in selected if key not in parsed]
    if missing:
        raise MemoryPatchValidationError(
            f"partial project memory is missing slots: {', '.join(missing)}"
        )

    existing = _get_existing_raw_memory(project)
    memory = {**_default_project_memory(project), **existing}
    string_slots = {
        "project_brief",
        "current_stage",
        "current_objective",
        "financial_status",
    }
    list_slots = {"recent_progress", "next_actions", "delivery_signals"}
    for key in selected:
        value = strip_memory_source_tags(parsed[key])
        if key in string_slots:
            if not isinstance(value, str):
                raise MemoryPatchValidationError(f"slot {key} must be a string")
            memory[key] = value.strip()
        elif key in list_slots:
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise MemoryPatchValidationError(f"slot {key} must be an array of strings")
            memory[key] = [item.strip() for item in value if item.strip()]
        elif key in EDITABLE_MEMORY_SLOTS:
            valid_list = isinstance(value, list) and all(isinstance(item, str) for item in value)
            valid_dict = isinstance(value, dict) and all(
                isinstance(value.get(part, []), list)
                and all(isinstance(item, str) for item in value.get(part, []))
                for part in ("ai", "pinned")
            )
            if not (valid_list or valid_dict):
                raise MemoryPatchValidationError(
                    f"slot {key} must be an array of strings or editable slot object"
                )
            existing_slot = existing.get(key, {})
            existing_pinned = (
                [str(item).strip() for item in existing_slot.get("pinned", []) if str(item).strip()]
                if isinstance(existing_slot, dict)
                else []
            )
            memory[key] = _normalize_editable_slot(value, pinned=existing_pinned)
        elif key == "important_documents":
            if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
                raise MemoryPatchValidationError(
                    "slot important_documents must be an array of objects"
                )
            memory[key] = [
                {"name": str(item.get("name", "")), "reason": str(item.get("reason", ""))}
                for item in value
            ]
        elif key == "client_stakeholders":
            if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
                raise MemoryPatchValidationError(
                    "slot client_stakeholders must be an array of objects"
                )
            memory[key] = value
        else:
            raise MemoryPatchValidationError(f"unknown project memory slot: {key}")

    _merge_accepted_memory_candidates(memory, existing)
    memory["rebuild_log"] = existing.get("rebuild_log", []) if isinstance(existing.get("rebuild_log"), list) else []
    memory["_coverage"] = existing.get("_coverage", {}) if isinstance(existing.get("_coverage"), dict) else {}
    memory[MODEL_SOURCE_ATTRIBUTIONS_KEY] = bind_model_source_attributions(
        parsed.get(MODEL_SOURCE_ATTRIBUTIONS_KEY),
        selected,
        _project_model_fact_bindings(parsed, selected),
    )
    return memory


def save_project_memory(
    session: Session,
    project_id: int,
    memory: dict[str, Any],
    trigger: str = "manual",
    coverage: dict[str, Any] | None = None,
    *,
    rebuilt_slots: tuple[str, ...] | None = None,
    rebuild_mode: str | None = None,
    fallback_reason: str = "",
    rebuild_plan: MemoryRebuildPlan | None = None,
    removed_accepted_anchors: Mapping[str, Collection[str]] | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    if rebuild_plan is not None:
        session.expire_all()
    project = session.exec(
        select(Project).where(Project.id == project_id).with_for_update()
    ).first()
    if not project:
        raise HTTPException(404, "Project not found")

    selected_slots = tuple(rebuilt_slots or PROJECT_MEMORY_SLOT_KEYS)
    if not selected_slots or any(key not in PROJECT_MEMORY_SLOT_KEYS for key in selected_slots):
        raise ValueError("rebuilt_slots contains an unknown project memory slot")
    if rebuild_plan is not None:
        from app.services.memory_slots import get_project_memory_slot_states

        assert_memory_rebuild_baseline(
            rebuild_plan,
            current_memory_version=int(project.memory_version or 0),
            current_slot_states=get_project_memory_slot_states(
                session,
                project_id,
                for_update=True,
            ),
            rebuilt_slots=selected_slots,
        )

    existing_raw_memory = _get_existing_raw_memory(project)
    memory = _merge_accepted_memory_candidates(
        dict(memory),
        existing_raw_memory,
    )
    for slot_name, removed_values in (removed_accepted_anchors or {}).items():
        if slot_name not in EDITABLE_MEMORY_SLOTS:
            continue
        removed = {str(item).strip() for item in removed_values if str(item).strip()}
        if not removed:
            continue
        accepted = memory.get(ACCEPTED_MEMORY_CANDIDATES_KEY)
        if not isinstance(accepted, dict):
            continue
        current = accepted.get(slot_name)
        if isinstance(current, list):
            accepted[slot_name] = [
                str(item).strip()
                for item in current
                if str(item).strip() and str(item).strip() not in removed
            ]
        slot = _normalize_editable_slot(memory.get(slot_name))
        slot["pinned"] = [item for item in slot["pinned"] if item not in removed]
        memory[slot_name] = slot
    if isinstance(existing_raw_memory.get("_client_promotion"), dict):
        memory["_client_promotion"] = dict(existing_raw_memory["_client_promotion"])
    source_attributions = normalize_model_source_attributions(
        memory.pop(MODEL_SOURCE_ATTRIBUTIONS_KEY, []),
        selected_slots,
    )
    persisted_coverage = dict(coverage or {})
    persisted_coverage.pop("_source_handles", None)
    source_snapshots = persisted_coverage.pop("_source_snapshots", None)
    stakeholder_source_ids = persisted_coverage.pop(
        "_client_stakeholder_source_ids",
        [],
    )
    if "client_stakeholders" in selected_slots and isinstance(
        stakeholder_source_ids,
        list,
    ):
        source_attributions = [
            attribution
            for attribution in source_attributions
            if attribution.get("slot_key") != "client_stakeholders"
        ]
        authoritative_stakeholders = (
            list(persisted_coverage.get("client_stakeholders") or [])
            if isinstance(persisted_coverage.get("client_stakeholders"), list)
            else []
        )
        source_attributions.extend(
            bind_model_source_attributions(
                [
                    {
                        "slot_key": "client_stakeholders",
                        "fact_index": index,
                        "source_ids": [f"client_stakeholder:{source_id}"],
                    }
                    for index, source_id in enumerate(stakeholder_source_ids)
                    if str(source_id).strip()
                ],
                ("client_stakeholders",),
                {
                    "client_stakeholders": {
                        index: ("item", stakeholder)
                        for index, stakeholder in enumerate(authoritative_stakeholders)
                        if isinstance(stakeholder, dict)
                    }
                },
            )
        )

    project.memory_version = (project.memory_version or 0) + 1
    project.memory_updated_at = utc_now_naive()
    rebuild_log = memory.get("rebuild_log", [])
    if not isinstance(rebuild_log, list):
        rebuild_log = []
    log_entry: dict[str, Any] = {
        "at": project.memory_updated_at.isoformat(),
        "trigger": trigger,
        "version": project.memory_version,
    }
    if rebuild_mode:
        log_entry.update({"mode": rebuild_mode, "rebuilt_slots": list(selected_slots)})
    if fallback_reason:
        log_entry["fallback_reason"] = fallback_reason
    rebuild_log.append(log_entry)
    memory["rebuild_log"] = rebuild_log[-10:]
    existing_coverage = (
        dict(memory.get("_coverage", {}))
        if isinstance(memory.get("_coverage"), dict)
        else {}
    )
    existing_coverage.pop("_source_handles", None)
    existing_coverage.pop("_source_snapshots", None)
    existing_coverage.pop("_client_stakeholder_source_ids", None)
    memory["_coverage"] = {
        **existing_coverage,
        **persisted_coverage,
        "built_at": project.memory_updated_at.isoformat(),
    }
    if isinstance(persisted_coverage.get("client_stakeholders"), list):
        memory["client_stakeholders"] = persisted_coverage["client_stakeholders"]
    memory["memory_version"] = project.memory_version
    memory["last_updated_at"] = project.memory_updated_at.isoformat()
    project.memory_rebuild_status = "idle"
    project.memory_rebuild_failed_at = None
    project.updated_at = utc_now_naive()
    session.add(project)
    from app.services.memory_slots import sync_project_memory_slots
    from app.services.memory_facts import sync_project_memory_facts

    sync_project_memory_slots(
        session,
        project,
        memory,
        slot_keys=selected_slots,
        source_snapshots=source_snapshots,
    )
    sync_project_memory_facts(
        session,
        project,
        memory,
        slot_keys=selected_slots,
        source_attributions=source_attributions,
        source_snapshots=source_snapshots,
    )
    session.flush()
    from app.services.memory_slots import get_project_memory_slot_states

    current_states = get_project_memory_slot_states(session, project_id)
    project.memory_stale = (
        {state["slot_key"] for state in current_states}
        != set(PROJECT_MEMORY_SLOT_KEYS)
        or any(state["status"] != "ready" for state in current_states)
    )
    memory["stale"] = project.memory_stale
    project.context_memory_json = json.dumps(memory, ensure_ascii=False)
    session.add(project)
    session.add(
        ProjectMemorySnapshot(
            project_id=project_id,
            memory_version=project.memory_version,
            trigger=trigger,
            memory_json=project.context_memory_json,
            created_at=project.memory_updated_at,
        )
    )
    if commit:
        session.commit()
        session.refresh(project)
    else:
        session.flush()
    return get_project_memory_payload(project)


def save_project_context_summary(session: Session, project_id: int, summary: str) -> None:
    project = session.get(Project, project_id)
    if not project:
        return
    project.context_summary = summary
    project.updated_at = utc_now_naive()
    session.add(project)
    session.commit()


def get_project_memory_summary_cache(
    session: Session,
    project_id: int,
    summary_type: str,
    language: str | None,
    memory_version: int,
) -> ProjectMemorySummary | None:
    normalized_language = normalize_summary_language(language)
    return session.exec(
        select(ProjectMemorySummary)
        .where(ProjectMemorySummary.project_id == project_id)
        .where(ProjectMemorySummary.summary_type == summary_type)
        .where(ProjectMemorySummary.language == normalized_language)
        .where(ProjectMemorySummary.memory_version == memory_version)
        .order_by(ProjectMemorySummary.updated_at.desc())
    ).first()


def save_project_memory_summary_cache(
    session: Session,
    project_id: int,
    summary_type: str,
    language: str | None,
    memory_version: int,
    content: str,
) -> ProjectMemorySummary:
    normalized_language = normalize_summary_language(language)
    cached = get_project_memory_summary_cache(
        session,
        project_id=project_id,
        summary_type=summary_type,
        language=normalized_language,
        memory_version=memory_version,
    )
    now = utc_now_naive()
    if cached:
        cached.content = content
        cached.updated_at = now
        session.add(cached)
        session.commit()
        session.refresh(cached)
        return cached

    cached = ProjectMemorySummary(
        project_id=project_id,
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


def _split_text_for_sse(text: str, max_chars: int = 12) -> list[str]:
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    chunks: list[str] = []
    buffer = ""
    punctuation = "，。！？；：,.!?;:\n"

    for char in text:
        buffer += char
        if len(buffer) >= max_chars or char in punctuation:
            chunks.append(buffer)
            buffer = ""

    if buffer:
        chunks.append(buffer)

    return chunks


async def stream_llm_text_chunks(chunks: AsyncIterator[str]) -> AsyncIterator[str]:
    async for chunk in chunks:
        if chunk.startswith('{"type": "tool_use"') or chunk.startswith("[TOOL_START:"):
            continue
        if OUTPUT_TRUNCATED_MARKER in chunk:
            chunk = chunk.replace(OUTPUT_TRUNCATED_MARKER, "")
        if not chunk.strip():
            continue
        for piece in _split_text_for_sse(chunk):
            yield piece
