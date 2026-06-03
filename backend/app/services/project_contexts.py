from __future__ import annotations

from datetime import datetime
from typing import Any, AsyncIterator
import json

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectMemorySnapshot, ProjectMemorySummary
from app.services.project_files import list_project_files
from app.services.project_financials import list_project_payments
from app.services.project_milestones import list_project_milestones
from app.services.project_progress import list_project_progress_updates
from app.services.project_todos import list_project_todos
from app.services.stakeholder_contexts import (
    format_client_stakeholders_for_prompt,
    list_client_stakeholder_dicts_by_name,
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


def mark_project_memory_stale(session: Session, project_id: int, trigger: str = "data_changed") -> None:
    project = session.get(Project, project_id)
    if not project:
        return
    project.memory_stale = True
    if project.memory_rebuild_status != "rebuilding":
        project.memory_rebuild_status = "idle"
    project.updated_at = utc_now_naive()
    session.add(project)
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
            by = update.created_by.display_name if update.created_by else "unknown"
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


def build_project_memory_data(session: Session, project_id: int) -> tuple[Project, str, dict[str, Any]]:
    """Full context for structured memory rebuild."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    milestones = list_project_milestones(session, project_id)
    files = list_project_files(session, project_id)
    todos = list_project_todos(session, project_id)
    payments = list_project_payments(session, project_id)
    progress_updates = list_project_progress_updates(session, project_id, limit=MAX_MEMORY_PROGRESS_UPDATES)
    client_stakeholders = list_client_stakeholder_dicts_by_name(session, project.client)

    lines = [
        f"Project: {project.name}",
        f"Client: {project.client}",
        f"Status: {project.status}",
        f"Contract amount: {project.contract_amount}",
    ]
    if project.description:
        lines.append(f"Description: {project.description[:MAX_MEMORY_DESCRIPTION_CHARS]}")
    if project.notes:
        lines.append(f"Notes:\n{project.notes[:MAX_MEMORY_DESCRIPTION_CHARS]}")
    if project.md_notes:
        lines.append(f"Markdown notes:\n{project.md_notes[:MAX_MEMORY_DESCRIPTION_CHARS]}")
    if progress_updates:
        lines.append(f"Progress updates ({len(progress_updates)} recent):")
        for update in progress_updates:
            by = update.created_by.display_name if update.created_by else "unknown"
            lines.append(f"  - {by}: {update.content}")
            if update.next_step:
                lines.append(f"    next: {update.next_step}")
            if update.risk:
                lines.append(f"    risk: {update.risk}")
    if milestones:
        completed_count = sum(1 for milestone in milestones if milestone.is_done)
        lines.append(f"Milestones ({len(milestones)} total, {completed_count} completed):")
        for milestone in milestones:
            status = "done" if milestone.is_done else "pending"
            priority = f" [{milestone.priority}]" if milestone.priority == "high" else ""
            due_hint = f" (due {milestone.due_date})" if milestone.due_date else ""
            lines.append(f"  - {status} {milestone.title}{priority}{due_hint}")
    if todos:
        pending_count = sum(1 for todo in todos if not todo.is_done)
        lines.append(f"Todos ({len(todos)} total, {pending_count} pending):")
        for todo in todos:
            status = "done" if todo.is_done else "pending"
            due_hint = f" (due {todo.due_date})" if todo.due_date else ""
            lines.append(f"  - {status} {todo.content}{due_hint}")
    if files:
        lines.append(f"Uploaded files ({len(files)} total):")
        for project_file in files:
            lines.append(
                f"  - {project_file.name}"
                + (
                    f": {project_file.summary[:MAX_MEMORY_FILE_SUMMARY_CHARS]}"
                    if project_file.summary
                    else ""
                )
            )
    if payments:
        lines.append(f"Payments ({len(payments)} total):")
        for payment in payments[-20:]:
            lines.append(
                f"  - {payment.payment_date} | {payment.payment_type} | {payment.amount} | {payment.note}"
            )
    stakeholder_context = format_client_stakeholders_for_prompt(client_stakeholders)
    if stakeholder_context:
        lines.append(stakeholder_context)

    coverage = {
        "milestones_total": len(milestones),
        "files_total": len(files),
        "todos_total": len(todos),
        "payments_total": len(payments),
        "client_stakeholders_total": len(client_stakeholders),
        "client_stakeholders": client_stakeholders,
        "built_at": utc_now_naive().isoformat(),
    }

    return project, "\n".join(lines), coverage


def build_project_memory_prompt(project_data: str) -> str:
    return (
        "You are building a structured long-term memory for a consulting project. "
        "Use only the project data below. Do not invent missing facts. "
        "Return valid JSON only with these exact keys: "
        "project_brief, current_stage, current_objective, recent_progress, key_risks, "
        "open_questions, next_actions, important_documents, financial_status, delivery_signals, stakeholder_notes, client_stakeholders. "
        "Rules: "
        "recent_progress, key_risks, open_questions, next_actions, delivery_signals, stakeholder_notes must be arrays of strings. "
        "important_documents must be an array of objects with keys name and reason. "
        "client_stakeholders must be an array of objects with keys name, role, influence_type, relationship_status, concerns, communication_preference, note. "
        "Keep each item concise and concrete. Prefer empty string or empty arrays over guessing. "
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


def parse_project_memory(raw: str, project: Project) -> dict[str, Any]:
    base = _default_project_memory(project)
    existing_raw = _get_existing_raw_memory(project)
    try:
        parsed = json.loads(_extract_first_json_object(raw))
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    memory = {**base, **parsed}
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

    return memory


def save_project_memory(
    session: Session,
    project_id: int,
    memory: dict[str, Any],
    trigger: str = "manual",
    coverage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    project.memory_version = (project.memory_version or 0) + 1
    project.memory_updated_at = utc_now_naive()
    rebuild_log = memory.get("rebuild_log", [])
    if not isinstance(rebuild_log, list):
        rebuild_log = []
    rebuild_log.append(
        {
            "at": project.memory_updated_at.isoformat(),
            "trigger": trigger,
            "version": project.memory_version,
        }
    )
    memory["rebuild_log"] = rebuild_log[-10:]
    memory["_coverage"] = {
        **(memory.get("_coverage", {}) if isinstance(memory.get("_coverage"), dict) else {}),
        **(coverage or {}),
        "built_at": project.memory_updated_at.isoformat(),
    }
    if coverage and isinstance(coverage.get("client_stakeholders"), list):
        memory["client_stakeholders"] = coverage["client_stakeholders"]
    memory["memory_version"] = project.memory_version
    memory["last_updated_at"] = project.memory_updated_at.isoformat()
    memory["stale"] = False
    project.context_memory_json = json.dumps(memory, ensure_ascii=False)
    project.memory_stale = False
    project.memory_rebuild_status = "idle"
    project.memory_rebuild_failed_at = None
    project.updated_at = utc_now_naive()
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
    session.commit()
    session.refresh(project)
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
