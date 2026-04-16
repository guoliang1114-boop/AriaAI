from __future__ import annotations

from datetime import datetime
from typing import AsyncIterator

from fastapi import HTTPException
from sqlmodel import Session

from app.models.db import Project
from app.services.project_files import list_project_files
from app.services.project_milestones import list_project_milestones

MAX_SUMMARY_MILESTONES = 6
MAX_SUMMARY_FILES = 8
MAX_FILE_SUMMARY_CHARS = 60
MAX_DESCRIPTION_CHARS = 240
OUTPUT_TRUNCATED_MARKER = "[OUTPUT_TRUNCATED]"

# Memory build: no quantity caps — feed all data to build comprehensive structured memory
MAX_MEMORY_FILE_SUMMARY_CHARS = 200
MAX_MEMORY_DESCRIPTION_CHARS = 1000


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
    """Full context for structured memory rebuild — no quantity caps on milestones or files."""
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
        lines.append(f"Description: {project.description[:MAX_MEMORY_DESCRIPTION_CHARS]}")
    if milestones:
        completed_count = sum(1 for milestone in milestones if milestone.is_done)
        lines.append(f"Milestones ({len(milestones)} total, {completed_count} completed):")
        for milestone in milestones:
            status = "done" if milestone.is_done else "pending"
            priority = f" [{milestone.priority}]" if milestone.priority == "high" else ""
            due_hint = f" (due {milestone.due_date})" if milestone.due_date else ""
            lines.append(f"  - {status} {milestone.title}{priority}{due_hint}")
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

    return project, "\n".join(lines)


def save_project_context_summary(session: Session, project_id: int, summary: str) -> None:
    project = session.get(Project, project_id)
    if not project:
        return
    project.context_summary = summary
    project.updated_at = datetime.utcnow()
    session.add(project)
    session.commit()


def build_project_context_prompt(project_data: str) -> str:
    return (
        "You are an AI consultant assistant. Based on the project data below, "
        "treat the current project as the only source of truth. "
        "Do not blend in facts, progress, or risks from other projects under the same client unless explicitly stated in the project data below. "
        "If some information appears ambiguous, stay conservative and note the uncertainty rather than borrowing context from elsewhere. "
        "Write a concise context summary of exactly 3-5 bullet points covering: "
        "the core objective, current stage, key risks or open questions, critical milestones, "
        "and the few most important facts a consultant should remember. "
        "Each bullet should be specific and actionable, not generic. "
        "Use **bold** only for the most important terms or milestones. "
        "Return ONLY bullet points, one per line, starting with '- '. "
        "Keep the full answer under 180 words. "
        "Write in the same language as the project name (Chinese if Chinese, English if English).\n\n"
        f"Project data:\n{project_data}"
    )


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
