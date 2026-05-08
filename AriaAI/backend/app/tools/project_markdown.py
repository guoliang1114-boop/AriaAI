from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import engine
from app.models.db import ProjectFile, ProjectFolder
from app.services.cache import projects_cache
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import init_default_project_folders
from app.services.project_documents import (
    create_project_document_record,
    get_project_document_file_or_404,
    read_project_document_content,
    update_project_document_record,
)
from app.tools import registry

PROJECT_MARKDOWN_TOOL_NAME = "update_project_markdown_document"


def _find_markdown_file(session: Session, project_id: int, file_name: str | None) -> ProjectFile | None:
    if not file_name:
        return None
    normalized = file_name.strip().lower()
    if not normalized:
        return None
    candidates = session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id, ProjectFile.file_type == "md")
    ).all()
    for candidate in candidates:
        if candidate.name.strip().lower() == normalized:
            return candidate
    if not normalized.endswith(".md"):
        with_suffix = f"{normalized}.md"
        for candidate in candidates:
            if candidate.name.strip().lower() == with_suffix:
                return candidate
    return None


def _bust_project_cache(project_id: int) -> None:
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")


def _init_default_folders(project_id: int, session: Session):
    return init_default_project_folders(session, project_id)


@registry.register(
    name=PROJECT_MARKDOWN_TOOL_NAME,
    description=(
        "Create or update a Markdown document in the current project. "
        "Call this tool whenever you need to save, modify, replace, rewrite, correct, or create any project Markdown documentation. "
        "Do not wait for user confirmation — write the file immediately when you have the content ready. "
        "For replace mode, provide the full final Markdown content."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_id": {
                "type": "integer",
                "description": "Existing project Markdown file id. Prefer this when the target file is known.",
            },
            "file_name": {
                "type": "string",
                "description": "Markdown file name to create or match, for example project-summary.md.",
            },
            "mode": {
                "type": "string",
                "enum": ["replace", "append", "create"],
                "description": "replace updates an existing MD file, append adds content to the end, create makes a new MD file.",
            },
            "content": {
                "type": "string",
                "description": "Markdown content to write. In replace mode this must be the full final document.",
            },
            "summary": {
                "type": "string",
                "description": "Short summary for a newly created document.",
            },
            "folder_id": {
                "type": "integer",
                "description": "Optional target folder id for newly created documents.",
            },
        },
        "required": ["mode", "content"],
    },
)
async def update_project_markdown_document(
    *,
    project_id: int,
    mode: Literal["replace", "append", "create"],
    content: str,
    file_id: int | None = None,
    file_name: str | None = None,
    summary: str | None = None,
    folder_id: int | None = None,
) -> dict:
    if not project_id:
        raise HTTPException(400, "Project id is required")
    if mode not in {"replace", "append", "create"}:
        raise HTTPException(400, "Unsupported markdown update mode")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(400, "Markdown content is required")

    with Session(engine) as session:
        project_file: ProjectFile | None = None
        if file_id is not None:
            project_file = get_project_document_file_or_404(session, project_id, file_id)
        elif mode != "create":
            project_file = _find_markdown_file(session, project_id, file_name)

        if mode == "create":
            created = create_project_document_record(
                session,
                project_id,
                name=file_name or "project-note.md",
                content=content,
                uploads_dir=UPLOADS_DIR,
                init_default_folders=_init_default_folders,
                folder_id=folder_id,
                summary=summary or "Updated from project chat",
            )
            mark_project_memory_stale(session, project_id, trigger="markdown_tool_create")
            _bust_project_cache(project_id)
            return {
                "ok": True,
                "action": "created",
                "id": created.id,
                "name": created.name,
                "size_bytes": created.size_bytes,
                "message": f"Created {created.name}",
            }

        if project_file is None:
            raise HTTPException(404, "Markdown document not found")

        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents are supported")

        next_content = content
        if mode == "append":
            existing = read_project_document_content(project_file, uploads_dir=UPLOADS_DIR)
            separator = "\n\n" if existing and not existing.endswith("\n") else "\n"
            next_content = f"{existing}{separator}{content}"

        updated = update_project_document_record(
            session,
            project_id,
            project_file.id,
            uploads_dir=UPLOADS_DIR,
            init_default_folders=_init_default_folders,
            content=next_content,
            name=file_name,
            folder_id=folder_id,
        )
        mark_project_memory_stale(session, project_id, trigger="markdown_tool_update")
        _bust_project_cache(project_id)
        return {
            "ok": True,
            "action": "appended" if mode == "append" else "updated",
            "id": updated["id"],
            "name": updated["name"],
            "size_bytes": updated["size_bytes"],
            "message": f"Updated {updated['name']}",
        }


READ_MARKDOWN_TOOL_NAME = "read_project_markdown_document"
_READ_MAX_CHARS = 12000


@registry.register(
    name=READ_MARKDOWN_TOOL_NAME,
    description=(
        "List or read Markdown documents in the current project. "
        "Call with action='list' to see all available MD files (returns id, name, folder, summary). "
        "Call with action='read' and a file_id or file_name to read the full content of a specific file."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "read"],
                "description": "list returns the file index; read returns the content of a specific file.",
            },
            "file_id": {
                "type": "integer",
                "description": "File id to read. Prefer this when the id is known.",
            },
            "file_name": {
                "type": "string",
                "description": "File name to read, e.g. project-summary.md. Used when file_id is unknown.",
            },
        },
        "required": ["action"],
    },
)
async def read_project_markdown_document(
    *,
    project_id: int,
    action: Literal["list", "read"],
    file_id: int | None = None,
    file_name: str | None = None,
) -> dict:
    if not project_id:
        raise HTTPException(400, "Project id is required")

    with Session(engine) as session:
        if action == "list":
            files = session.exec(
                select(ProjectFile).where(
                    ProjectFile.project_id == project_id,
                    ProjectFile.file_type == "md",
                )
            ).all()

            folder_names: dict[int, str] = {}
            folder_ids = {f.folder_id for f in files if f.folder_id is not None}
            if folder_ids:
                folders = session.exec(
                    select(ProjectFolder).where(ProjectFolder.id.in_(folder_ids))
                ).all()
                folder_names = {folder.id: folder.name for folder in folders}

            return {
                "ok": True,
                "count": len(files),
                "files": [
                    {
                        "id": f.id,
                        "name": f.name,
                        "folder": folder_names.get(f.folder_id, "") if f.folder_id else "",
                        "summary": f.summary or "",
                        "size_bytes": f.size_bytes,
                    }
                    for f in files
                ],
            }

        # action == "read"
        project_file: ProjectFile | None = None
        if file_id is not None:
            project_file = get_project_document_file_or_404(session, project_id, file_id)
        elif file_name:
            project_file = _find_markdown_file(session, project_id, file_name)

        if project_file is None:
            raise HTTPException(404, "Markdown document not found. Use action='list' to see available files.")

        if project_file.file_type.lower() != "md":
            raise HTTPException(400, "Only markdown documents are supported")

        content = read_project_document_content(project_file, uploads_dir=UPLOADS_DIR)
        truncated = len(content) > _READ_MAX_CHARS
        if truncated:
            content = content[:_READ_MAX_CHARS]

        return {
            "ok": True,
            "id": project_file.id,
            "name": project_file.name,
            "size_bytes": project_file.size_bytes,
            "truncated": truncated,
            "content": content,
        }
