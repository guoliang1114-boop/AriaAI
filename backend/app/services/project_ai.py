from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable

from sqlmodel import Session, select

from app.models.db import ProjectFile
from app.services.agent_harness.structured_patch import locked_text_path


def _project_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class ProjectFileSourceSnapshot:
    project_id: int
    file_id: int
    name: str
    file_type: str
    path: str
    size_bytes: int
    folder_id: int | None
    source_file_id: int | None
    origin: str
    content_sha256: str

    def matches_record(self, project_file: ProjectFile) -> bool:
        return (
            project_file.id == self.file_id
            and int(project_file.project_id) == self.project_id
            and project_file.name == self.name
            and project_file.file_type == self.file_type
            and project_file.path == self.path
            and int(project_file.size_bytes or 0) == self.size_bytes
            and project_file.folder_id == self.folder_id
            and project_file.source_file_id == self.source_file_id
            and project_file.origin == self.origin
            and project_file.deleted_at is None
        )

    def matches_file(self, file_path: Path) -> bool:
        return file_path.is_file() and _project_file_sha256(file_path) == self.content_sha256


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

All field values MUST be written in Simplified Chinese (简体中文).

Return ONLY a valid JSON array (no markdown, no extra text):
[
  {{
    "name": "简洁专业的项目名称（中文，控制在 8-15 字）",
    "description": "2-3 句项目范围说明：目标、关键工作流和预期交付物（中文）"
  }}
]

Rules:
- name: 简洁、咨询风格（如“中国市场进入战略”“数字化转型路线图”）
- description: 专业、具体、可执行 —— 不要套话
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
    project_id: int,
    file_path: str,
    file_type: str,
    extract_file_text: Callable[[Path, str, int], str],
    complete: Callable[[list[dict[str, str]], int], Awaitable[str]],
    session_factory: Callable[[], Session],
    authorize_write: Callable[[Session], Any],
) -> ProjectFileSourceSnapshot | None:
    source_path = Path(file_path)
    try:
        with session_factory() as session:
            # Do not even send the file to a provider if the upload actor has
            # already lost access before this background task starts.
            authorize_write(session)
            project_file = session.exec(
                select(ProjectFile)
                .where(ProjectFile.id == file_id)
                .with_for_update()
            ).first()
            if (
                project_file is None
                or int(project_file.project_id) != project_id
                or project_file.deleted_at is not None
            ):
                session.rollback()
                return None
            with locked_text_path(source_path):
                source_hash = _project_file_sha256(source_path)
                text = extract_file_text(source_path, file_type, 3000)
            source_snapshot = ProjectFileSourceSnapshot(
                project_id=project_id,
                file_id=file_id,
                name=project_file.name,
                file_type=project_file.file_type,
                path=project_file.path,
                size_bytes=int(project_file.size_bytes or 0),
                folder_id=project_file.folder_id,
                source_file_id=project_file.source_file_id,
                origin=project_file.origin,
                content_sha256=source_hash,
            )
            session.rollback()
    except Exception:
        return None
    if not text or text.startswith("["):
        return None

    prompt = build_project_file_summary_prompt(text)
    try:
        summary = await complete([{"role": "user", "content": prompt}], 2000)
        summary = summary.strip()
        if not summary:
            return None
        with session_factory() as session:
            # The callback must final-lock and authorize the parent Project in
            # this same transaction. Lock the child only afterwards so a
            # provider result can never outlive revoked Project access.
            authorize_write(session)
            project_file = session.exec(
                select(ProjectFile)
                .where(ProjectFile.id == file_id)
                .with_for_update()
            ).first()
            if (
                project_file
                and source_snapshot.matches_record(project_file)
            ):
                with locked_text_path(source_path):
                    if not source_snapshot.matches_file(source_path):
                        session.rollback()
                        return None
                    # Keep the source artifact frozen until the database write
                    # commits; otherwise a document writer can replace the
                    # source in the hash-check -> summary-commit gap.
                    project_file.summary = summary
                    session.add(project_file)
                    session.commit()
                return source_snapshot
    except Exception:
        return None
    return None
