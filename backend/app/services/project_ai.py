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


def extract_json_array_from_text(raw: str) -> str:
    """Best-effort extraction of a JSON array from an LLM response.

    Models (notably thinking models like kimi-k2.*) often wrap the array in a
    prose preamble or a ```json fenced block instead of returning the bare
    array the prompt asks for. The previous parser only handled the exact case
    where the response *started* with ```, so anything else hit
    ``json.loads`` on non-JSON and raised "Expecting value: line 1 column 1
    (char 0)". This handles: bare arrays, fenced blocks (with or without a
    preamble), and arrays embedded in surrounding prose. Returns "[]" when no
    array-like content is found, so callers degrade to "no suggestions"
    instead of crashing.
    """
    text = (raw or "").strip()
    if not text:
        return "[]"
    # Prefer the body of a fenced code block if one is present anywhere.
    if "```" in text:
        segments = text.split("```")
        if len(segments) >= 2:
            block = segments[1].lstrip()
            if block[:4].lower() == "json":
                block = block[4:]
            block = block.strip()
            if block:
                text = block
    # Slice the outermost array, dropping any surrounding prose.
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        return text[start : end + 1]
    return "[]"


def parse_project_ai_suggestions(raw: str) -> list[dict[str, str]]:
    suggestions = json.loads(extract_json_array_from_text(raw))
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
            if project_file and project_file.deleted_at is None:
                project_file.summary = summary
                session.add(project_file)
                session.commit()
    except Exception:
        pass
