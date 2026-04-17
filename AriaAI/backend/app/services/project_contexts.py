from __future__ import annotations

from datetime import datetime
from typing import Any, AsyncIterator
import json

from fastapi import HTTPException
from sqlmodel import Session

from app.models.db import Project
from app.services.project_files import list_project_files
from app.services.project_financials import list_project_payments
from app.services.project_milestones import list_project_milestones
from app.services.project_todos import list_project_todos

MAX_SUMMARY_MILESTONES = 6
MAX_SUMMARY_FILES = 8
MAX_FILE_SUMMARY_CHARS = 60
MAX_DESCRIPTION_CHARS = 240
OUTPUT_TRUNCATED_MARKER = "[OUTPUT_TRUNCATED]"

MAX_MEMORY_FILE_SUMMARY_CHARS = 200
MAX_MEMORY_DESCRIPTION_CHARS = 1200
SUPPORTED_MEMORY_SUMMARY_TYPES = {
    "overview",
    "risk",
    "stakeholder",
    "delivery",
    "client-facing",
}


def _resolve_output_language(language: str | None) -> str:
    normalized = (language or "").strip().lower()
    if normalized.startswith("zh"):
        return "Chinese"
    if normalized.startswith("en"):
        return "English"
    return "the user's selected language"


def _default_project_memory(project: Project) -> dict[str, Any]:
    return {
        "project_brief": project.description[:300] if project.description else "",
        "current_stage": project.status,
        "current_objective": "",
        "recent_progress": [],
        "key_risks": [],
        "open_questions": [],
        "next_actions": [],
        "important_documents": [],
        "financial_status": "",
        "delivery_signals": [],
        "stakeholder_notes": [],
        "memory_version": project.memory_version,
        "last_updated_at": project.memory_updated_at.isoformat() if project.memory_updated_at else "",
        "stale": project.memory_stale,
    }


def get_project_memory_payload(project: Project) -> dict[str, Any]:
    base = _default_project_memory(project)
    try:
        parsed = json.loads(project.context_memory_json or "{}")
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}
    return {
        **base,
        **parsed,
        "memory_version": project.memory_version,
        "last_updated_at": project.memory_updated_at.isoformat() if project.memory_updated_at else "",
        "stale": project.memory_stale,
    }


def mark_project_memory_stale(session: Session, project_id: int) -> None:
    project = session.get(Project, project_id)
    if not project:
        return
    project.memory_stale = True
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()


def build_project_context_data(session: Session, project_id: int) -> tuple[Project, str]:
    """Lightweight context for real-time view summary (capped quantities)."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    milestones = list_project_milestones(session, project_id)
    files = list_project_files(session, project_id)

    lines = [
        f"Project: {project.name}",
        f"Client: {project.client}",
        f"Status: {project.status}",
    ]
    if project.description:
        lines.append(f"Description: {project.description[:MAX_DESCRIPTION_CHARS]}")
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


def build_project_memory_data(session: Session, project_id: int) -> tuple[Project, str]:
    """Full context for structured memory rebuild."""
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    milestones = list_project_milestones(session, project_id)
    files = list_project_files(session, project_id)
    todos = list_project_todos(session, project_id)
    payments = list_project_payments(session, project_id)

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

    return project, "\n".join(lines)


def build_project_memory_prompt(project_data: str) -> str:
    return (
        "You are building a structured long-term memory for a consulting project. "
        "Use only the project data below. Do not invent missing facts. "
        "Return valid JSON only with these exact keys: "
        "project_brief, current_stage, current_objective, recent_progress, key_risks, "
        "open_questions, next_actions, important_documents, financial_status, delivery_signals, stakeholder_notes. "
        "Rules: "
        "recent_progress, key_risks, open_questions, next_actions, delivery_signals, stakeholder_notes must be arrays of strings. "
        "important_documents must be an array of objects with keys name and reason. "
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
    instructions = {
        "overview": (
            "Write exactly 3-4 bullet points for an overview card. Focus on core objective, "
            "current stage, major progress, key risks or open questions, and next actions."
        ),
        "risk": (
            "Write exactly 3-4 bullet points focused on project risks. Highlight key risks, "
            "blocked decisions, weak delivery signals, and what needs attention next."
        ),
        "stakeholder": (
            "Write exactly 3-4 bullet points focused on stakeholder alignment. Highlight who matters, "
            "what each stakeholder cares about, open alignment issues, and suggested follow-ups."
        ),
        "delivery": (
            "Write exactly 3-4 bullet points focused on delivery. Highlight current stage, progress, "
            "important documents, delivery signals, and immediate execution next steps."
        ),
        "client-facing": (
            "Write exactly 3-4 bullet points that are safe to share with a client. Focus on progress, "
            "current priorities, confirmed next steps, and avoid speculative internal wording."
        ),
    }
    return (
        "You are an AI consultant assistant. "
        f"{instructions[normalized_type]} "
        "Each bullet must be specific and concise. Use **bold** sparingly for key terms. "
        f"Return ONLY bullet points, one per line, starting with '- '. Keep the full answer under 120 words. Write the answer in {output_language}.\n\n"
        f"Project: {project_name}\n"
        f"Summary type: {normalized_type}\n"
        f"Structured memory JSON:\n{json.dumps(memory, ensure_ascii=False)}"
    )


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
    try:
        parsed = json.loads(_extract_first_json_object(raw))
        if not isinstance(parsed, dict):
            parsed = {}
    except json.JSONDecodeError:
        parsed = {}

    memory = {**base, **parsed}
    for key in (
        "recent_progress",
        "key_risks",
        "open_questions",
        "next_actions",
        "delivery_signals",
        "stakeholder_notes",
    ):
        value = memory.get(key)
        memory[key] = value if isinstance(value, list) else []

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

    return memory


def save_project_memory(session: Session, project_id: int, memory: dict[str, Any]) -> dict[str, Any]:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    project.memory_version = (project.memory_version or 0) + 1
    project.memory_updated_at = datetime.utcnow()
    memory["memory_version"] = project.memory_version
    memory["last_updated_at"] = project.memory_updated_at.isoformat()
    memory["stale"] = False
    project.context_memory_json = json.dumps(memory, ensure_ascii=False)
    project.memory_stale = False
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()
    session.refresh(project)
    return get_project_memory_payload(project)


def save_project_context_summary(session: Session, project_id: int, summary: str) -> None:
    project = session.get(Project, project_id)
    if not project:
        return
    project.context_summary = summary
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()


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
