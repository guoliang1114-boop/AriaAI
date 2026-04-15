from __future__ import annotations

from datetime import datetime
from pathlib import Path

from app.models.db import ProjectFile


def ensure_markdown_filename(name: str) -> str:
    sanitized = "_".join((name or "document").strip().split())
    sanitized = sanitized.replace("/", "_").replace("\\", "_")
    if not sanitized:
        sanitized = "document"
    if not sanitized.lower().endswith(".md"):
        sanitized = f"{sanitized}.md"
    return sanitized


def build_markdown_export_header(timestamp: datetime | None = None) -> str:
    current = timestamp or datetime.utcnow()
    return f"\n\n---\n\n> From project conversation | {current.strftime('%Y-%m-%d %H:%M')}\n\n"


def build_timestamped_markdown_filename(base_name: str, timestamp: datetime | None = None) -> str:
    current = timestamp or datetime.utcnow()
    safe_name = ensure_markdown_filename(base_name).removesuffix(".md")
    return f"{safe_name}_{current.strftime('%Y%m%d_%H%M%S')}.md"


def write_project_markdown_file(
    project_file: ProjectFile,
    content: str,
    *,
    uploads_dir: Path,
    append: bool = False,
) -> int:
    full_path = uploads_dir / Path(project_file.path)
    if not full_path.exists():
        raise FileNotFoundError(full_path)

    next_content = content
    if append:
        existing = full_path.read_text(encoding="utf-8", errors="replace")
        next_content = existing + content

    full_path.write_text(next_content, encoding="utf-8")
    return full_path.stat().st_size
