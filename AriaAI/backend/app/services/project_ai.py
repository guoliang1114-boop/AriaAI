from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Awaitable, Callable

from sqlmodel import Session

from app.models.db import ProjectFile


def build_project_ai_suggest_messages(
    query: str,
    *,
    client_name: str = "",
    client_industry: str = "",
) -> list[dict[str, str]]:
    client_context = ""
    if client_name:
        client_context = f"Client: {client_name}"
        if client_industry:
            client_context += f" ({client_industry})"

    prompt = f"""You are a senior consultant at a top-tier consulting firm.
{f"The project is for: {client_context}" if client_context else ""}
The user described the project as: "{query}"

Generate 1 to 3 consulting project name and description suggestions.
- If the idea is specific, return 1 suggestion.
- If the idea is broad or ambiguous, return up to 3 distinct angle variations.

Return ONLY a valid JSON array (no markdown, no extra text):
[
  {{
    "name": "Crisp, professional project title (5-8 words max)",
    "description": "2-3 sentence scope statement: objectives, key workstreams, and expected deliverable"
  }}
]

Rules:
- name: concise, consulting-style (e.g. "China Market Entry Strategy", "Digital Transformation Roadmap")
- description: professional, specific, actionable — no filler phrases
- Return pure JSON array only"""
    return [{"role": "user", "content": prompt}]


def parse_project_ai_suggestions(raw: str) -> list[dict[str, str]]:
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    suggestions = json.loads(text)
    return [
        {
            "name": suggestion["name"],
            "description": suggestion["description"],
        }
        for suggestion in suggestions[:3]
    ]


def build_project_file_summary_prompt(text: str) -> str:
    return (
        "You are a professional consultant analyst. "
        "Read the following document excerpt and write a concise 2-3 sentence summary "
        "covering: what this document is, its main purpose, and the most important information it contains. "
        "Be specific and professional. Return ONLY the summary, no preamble.\n\n"
        f"Document excerpt:\n{text}"
    )


async def summarize_uploaded_project_file(
    file_id: int,
    *,
    file_path: str,
    file_type: str,
    extract_file_text: Callable[[Path, str, int], str],
    complete: Callable[[list[dict[str, str]], int], Awaitable[str]],
    session_factory: Callable[[], Session],
) -> None:
    text = extract_file_text(Path(file_path), file_type, 3000)
    if not text or text.startswith("["):
        return

    prompt = build_project_file_summary_prompt(text)
    try:
        summary = await complete([{"role": "user", "content": prompt}], 2000)
        summary = summary.strip()
        if not summary:
            return
        with session_factory() as session:
            project_file = session.get(ProjectFile, file_id)
            if project_file:
                project_file.summary = summary
                session.add(project_file)
                session.commit()
    except Exception:
        pass
