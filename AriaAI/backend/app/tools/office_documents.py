from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any, Literal

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import UPLOADS_DIR
from app.database import engine
from app.models.db import Project, ProjectFile, ProjectFolder
from app.services.cache import projects_cache
from app.services.document_text import extract_text_from_file
from app.services.project_contexts import mark_project_memory_stale
from app.services.project_core import init_default_project_folders
from app.services.project_documents import infer_project_folder
from app.tools import registry
from app.tools.file_generators import generate_docx, generate_pdf, generate_ppt, generate_xlsx

READ_PROJECT_FILE_TOOL_NAME = "read_project_file"
WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME = "write_project_office_document"
MANAGE_PROJECT_FOLDERS_TOOL_NAME = "manage_project_folders"

_READABLE_TYPES = {"pdf", "docx", "pptx", "xlsx", "xls", "md", "txt", "csv", "json"}
_WRITABLE_TYPES = {"docx", "xlsx", "pptx", "pdf"}
_READ_MAX_CHARS = 20000


def _bust_project_cache(project_id: int) -> None:
    projects_cache.delete(f"detail:{project_id}")
    projects_cache.delete_prefix("list:")


def _safe_name(name: str, extension: str) -> str:
    stem = "_".join((name or "document").strip().split())
    for char in '/\\:*?"<>|':
        stem = stem.replace(char, "_")
    stem = stem.strip("._")[:96] or "document"
    suffix = f".{extension.lower()}"
    if not stem.lower().endswith(suffix):
        stem = f"{stem}{suffix}"
    return stem


def _file_path(project_file: ProjectFile) -> Path:
    full_path = UPLOADS_DIR / Path(project_file.path)
    try:
        full_path.resolve().relative_to(UPLOADS_DIR.resolve())
    except ValueError as exc:
        raise HTTPException(400, "Invalid project file path") from exc
    if not full_path.is_file():
        raise HTTPException(404, "File not found on disk")
    return full_path


def _find_project_file(session: Session, project_id: int, file_id: int | None, file_name: str | None) -> ProjectFile:
    if file_id is not None:
        project_file = session.get(ProjectFile, file_id)
        if not project_file or project_file.project_id != project_id:
            raise HTTPException(404, "File not found")
        return project_file

    normalized = (file_name or "").strip().lower()
    if not normalized:
        raise HTTPException(400, "Provide file_id or file_name")

    files = session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all()
    for project_file in files:
        if project_file.name.strip().lower() == normalized:
            return project_file
    raise HTTPException(404, "File not found")


def _list_files(session: Session, project_id: int, file_types: list[str] | None) -> dict:
    normalized_types = {item.lower().lstrip(".") for item in file_types or [] if item}
    stmt = select(ProjectFile).where(ProjectFile.project_id == project_id)
    if normalized_types:
        stmt = stmt.where(ProjectFile.file_type.in_(normalized_types))
    files = session.exec(stmt.order_by(ProjectFile.uploaded_at.desc(), ProjectFile.id.desc())).all()

    folder_names: dict[int, str] = {}
    folder_ids = {item.folder_id for item in files if item.folder_id is not None}
    if folder_ids:
        folders = session.exec(select(ProjectFolder).where(ProjectFolder.id.in_(folder_ids))).all()
        folder_names = {folder.id: folder.name for folder in folders}

    return {
        "ok": True,
        "count": len(files),
        "files": [
            {
                "id": item.id,
                "name": item.name,
                "file_type": item.file_type,
                "folder": folder_names.get(item.folder_id, "") if item.folder_id else "",
                "summary": item.summary or "",
                "origin": item.origin,
                "size_bytes": item.size_bytes,
            }
            for item in files
        ],
    }


def _list_folders(session: Session, project_id: int) -> list[ProjectFolder]:
    folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order, ProjectFolder.id)
    ).all()
    if not folders:
        folders = init_default_project_folders(session, project_id)
    return folders


def _folder_payload(session: Session, project_id: int) -> dict:
    folders = _list_folders(session, project_id)
    counts: dict[int, int] = {folder.id: 0 for folder in folders if folder.id is not None}
    files = session.exec(select(ProjectFile).where(ProjectFile.project_id == project_id)).all()
    unassigned_count = 0
    for project_file in files:
        if project_file.folder_id in counts:
            counts[project_file.folder_id] += 1
        else:
            unassigned_count += 1
    return {
        "ok": True,
        "folders": [
            {
                "id": folder.id,
                "name": folder.name,
                "sort_order": folder.sort_order,
                "file_count": counts.get(folder.id, 0),
            }
            for folder in folders
        ],
        "unassigned_file_count": unassigned_count,
    }


def _find_folder_by_name(session: Session, project_id: int, folder_name: str | None) -> ProjectFolder | None:
    normalized = (folder_name or "").strip().lower()
    if not normalized:
        return None
    folders = _list_folders(session, project_id)
    for folder in folders:
        if folder.name.strip().lower() == normalized:
            return folder
    return None


def _resolve_folder_target(
    session: Session,
    project_id: int,
    *,
    folder_id: int | None = None,
    folder_name: str | None = None,
) -> ProjectFolder:
    if folder_id is not None:
        folder = session.get(ProjectFolder, folder_id)
        if not folder or folder.project_id != project_id:
            raise HTTPException(404, "Folder not found")
        return folder
    folder = _find_folder_by_name(session, project_id, folder_name)
    if folder:
        return folder
    raise HTTPException(404, "Folder not found")


def _next_folder_sort_order(session: Session, project_id: int) -> int:
    folders = _list_folders(session, project_id)
    if not folders:
        return 0
    return max(folder.sort_order for folder in folders) + 1


@registry.register(
    name=MANAGE_PROJECT_FOLDERS_TOOL_NAME,
    description=(
        "Manage project space folders and file placement. "
        "Use it to list folders, create or rename folders, move generated files into the right folder, or delete empty folders."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "create", "rename", "move_file", "delete"],
                "description": "Folder operation to perform.",
            },
            "folder_id": {"type": "integer", "description": "Target folder id."},
            "folder_name": {"type": "string", "description": "Target folder name when id is not known."},
            "new_name": {"type": "string", "description": "New name for create or rename."},
            "sort_order": {"type": "integer", "description": "Optional folder order for create/rename."},
            "file_id": {"type": "integer", "description": "Project file id for move_file."},
            "file_name": {"type": "string", "description": "Project file name for move_file when file_id is not known."},
        },
        "required": ["action"],
    },
)
async def manage_project_folders(
    *,
    project_id: int,
    action: Literal["list", "create", "rename", "move_file", "delete"],
    folder_id: int | None = None,
    folder_name: str | None = None,
    new_name: str | None = None,
    sort_order: int | None = None,
    file_id: int | None = None,
    file_name: str | None = None,
) -> dict:
    if not project_id:
        raise HTTPException(400, "Project id is required")

    with Session(engine) as session:
        project = session.get(Project, project_id)
        if not project:
            raise HTTPException(404, "Project not found")

        if action == "list":
            return _folder_payload(session, project_id)

        if action == "create":
            name = (new_name or folder_name or "").strip()
            if not name:
                raise HTTPException(400, "Folder name is required")
            existing = _find_folder_by_name(session, project_id, name)
            if existing:
                return {"ok": True, "action": "exists", "folder": {"id": existing.id, "name": existing.name, "sort_order": existing.sort_order}}
            folder = ProjectFolder(
                project_id=project_id,
                name=name,
                sort_order=sort_order if sort_order is not None else _next_folder_sort_order(session, project_id),
            )
            session.add(folder)
            session.commit()
            session.refresh(folder)
            mark_project_memory_stale(session, project_id, trigger="folder_tool_create")
            _bust_project_cache(project_id)
            return {"ok": True, "action": "created", "folder": {"id": folder.id, "name": folder.name, "sort_order": folder.sort_order}}

        if action == "rename":
            folder = _resolve_folder_target(session, project_id, folder_id=folder_id, folder_name=folder_name)
            name = (new_name or "").strip()
            if not name:
                raise HTTPException(400, "new_name is required")
            folder.name = name
            if sort_order is not None:
                folder.sort_order = sort_order
            session.add(folder)
            session.commit()
            session.refresh(folder)
            mark_project_memory_stale(session, project_id, trigger="folder_tool_rename")
            _bust_project_cache(project_id)
            return {"ok": True, "action": "renamed", "folder": {"id": folder.id, "name": folder.name, "sort_order": folder.sort_order}}

        if action == "move_file":
            project_file = _find_project_file(session, project_id, file_id, file_name)
            folder = _resolve_folder_target(session, project_id, folder_id=folder_id, folder_name=folder_name)
            project_file.folder_id = folder.id
            session.add(project_file)
            session.commit()
            session.refresh(project_file)
            mark_project_memory_stale(session, project_id, trigger="folder_tool_move_file")
            _bust_project_cache(project_id)
            return {
                "ok": True,
                "action": "moved",
                "file": {"id": project_file.id, "name": project_file.name, "folder_id": project_file.folder_id},
                "folder": {"id": folder.id, "name": folder.name},
            }

        # action == "delete"
        folder = _resolve_folder_target(session, project_id, folder_id=folder_id, folder_name=folder_name)
        file_count = session.exec(select(ProjectFile).where(ProjectFile.folder_id == folder.id)).all()
        if file_count:
            raise HTTPException(400, "Folder is not empty. Move files before deleting it.")
        session.delete(folder)
        session.commit()
        mark_project_memory_stale(session, project_id, trigger="folder_tool_delete")
        _bust_project_cache(project_id)
        return {"ok": True, "action": "deleted", "folder_id": folder.id}


@registry.register(
    name=READ_PROJECT_FILE_TOOL_NAME,
    description=(
        "List or read files in the current project. Supports PDF, DOCX, PPTX, XLSX/XLS, Markdown, text, CSV, and JSON. "
        "Use action='list' to discover files. Use action='read' with file_id or file_name to extract text for analysis."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "enum": ["list", "read"],
                "description": "list returns project files; read extracts text from one file.",
            },
            "file_id": {
                "type": "integer",
                "description": "Project file id to read. Prefer this when available.",
            },
            "file_name": {
                "type": "string",
                "description": "Project file name to read when file_id is not known.",
            },
            "file_types": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional extensions for list, for example ['pdf', 'docx', 'xlsx'].",
            },
            "max_chars": {
                "type": "integer",
                "description": "Maximum extracted characters for read. Default 20000.",
            },
        },
        "required": ["action"],
    },
)
async def read_project_file(
    *,
    project_id: int,
    action: Literal["list", "read"],
    file_id: int | None = None,
    file_name: str | None = None,
    file_types: list[str] | None = None,
    max_chars: int = _READ_MAX_CHARS,
) -> dict:
    if not project_id:
        raise HTTPException(400, "Project id is required")

    with Session(engine) as session:
        if action == "list":
            return _list_files(session, project_id, file_types)

        project_file = _find_project_file(session, project_id, file_id, file_name)
        file_type = project_file.file_type.lower().lstrip(".")
        if file_type not in _READABLE_TYPES:
            raise HTTPException(400, f"Unsupported readable file type: {project_file.file_type}")

        content = extract_text_from_file(
            _file_path(project_file),
            file_type,
            max_chars=max(1000, min(max_chars or _READ_MAX_CHARS, 60000)),
            empty_placeholder="[No text extracted]",
            unsupported_placeholder="[Unsupported file type]",
            error_prefix="Extract failed: ",
        )
        return {
            "ok": True,
            "id": project_file.id,
            "name": project_file.name,
            "file_type": project_file.file_type,
            "size_bytes": project_file.size_bytes,
            "truncated": content.endswith("\n…[truncated]"),
            "content": content,
        }


def _content_preview(file_type: str, *, title: str, content: str, sections: list[dict] | None, sheets: list[dict] | None) -> str:
    if content:
        return content
    if sections:
        return "\n\n".join(f"{item.get('heading', '')}\n{item.get('content', '')}" for item in sections)
    if sheets:
        names = ", ".join(str(item.get("name", "")) for item in sheets)
        return f"{title}\nSheets: {names}"
    return file_type


def _register_generated_project_file(
    session: Session,
    project_id: int,
    *,
    source_path: Path,
    file_name: str,
    file_type: str,
    folder_id: int | None,
    summary: str,
    preview_text: str,
) -> ProjectFile:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    folder = infer_project_folder(
        session,
        project_id,
        init_default_folders=init_default_project_folders,
        preferred_folder_id=folder_id,
        name=file_name,
        content=preview_text,
        summary=summary,
    )

    dest_dir = UPLOADS_DIR / "projects" / str(project_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_name(file_name, file_type)
    dest_path = dest_dir / f"{uuid.uuid4().hex}_{safe_name}"
    shutil.copyfile(source_path, dest_path)

    project_file = ProjectFile(
        project_id=project_id,
        folder_id=folder.id if folder else None,
        name=safe_name,
        file_type=file_type,
        path=str(dest_path.relative_to(UPLOADS_DIR)),
        size_bytes=dest_path.stat().st_size,
        summary=summary,
        origin="ai_generated",
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file


@registry.register(
    name=WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
    description=(
        "Create a Word, Excel, PowerPoint, or PDF file and save it into the current project space. "
        "Use only when the user explicitly asks to create, generate, export, or save a DOCX/XLSX/PPTX/PDF deliverable. "
        "Do not use for analysis-only chat answers. Use DOCX/PDF for narrative documents, XLSX for tables, and PPTX for presentation slides."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "file_type": {
                "type": "string",
                "enum": ["docx", "xlsx", "pptx", "pdf"],
                "description": "Output file type.",
            },
            "file_name": {"type": "string", "description": "Output file name."},
            "title": {"type": "string", "description": "Document or presentation title."},
            "content": {"type": "string", "description": "Markdown/text content for PDF or simple DOCX."},
            "sections": {
                "type": "array",
                "description": "DOCX sections: heading/content/level.",
                "items": {"type": "object"},
            },
            "sheets": {
                "type": "array",
                "description": "XLSX sheets: name/headers/data.",
                "items": {"type": "object"},
            },
            "slides": {
                "type": "array",
                "description": (
                    "PPTX slides. Supported type values include title, section, content, two_column, "
                    "table, quote, process, roadmap, matrix, kpi, risk, and next_steps. "
                    "Use columns/rows for tables, items/steps for process slides, quote/source for quote slides."
                ),
                "items": {"type": "object"},
            },
            "folder_id": {"type": "integer", "description": "Optional project folder id."},
            "summary": {"type": "string", "description": "Short file summary for project space."},
        },
        "required": ["file_type", "file_name"],
    },
)
async def write_project_office_document(
    *,
    project_id: int,
    file_type: Literal["docx", "xlsx", "pptx", "pdf"],
    file_name: str,
    title: str = "",
    content: str = "",
    sections: list[dict] | None = None,
    sheets: list[dict] | None = None,
    slides: list[dict] | None = None,
    folder_id: int | None = None,
    summary: str = "",
) -> dict[str, Any]:
    if not project_id:
        raise HTTPException(400, "Project id is required")
    file_type = file_type.lower()
    if file_type not in _WRITABLE_TYPES:
        raise HTTPException(400, f"Unsupported writable file type: {file_type}")

    title = title.strip() or Path(file_name).stem or "Document"
    if file_type == "docx":
        doc_sections = sections or [{"heading": title, "content": content or title, "level": 1}]
        result = await generate_docx(title=title, sections=doc_sections)
    elif file_type == "xlsx":
        if not sheets:
            raise HTTPException(400, "sheets is required for xlsx")
        result = await generate_xlsx(sheets=sheets)
    elif file_type == "pptx":
        if not slides:
            raise HTTPException(400, "slides is required for pptx")
        result = await generate_ppt(title=title, slides=slides)
    else:
        if not content.strip():
            raise HTTPException(400, "content is required for pdf")
        result = await generate_pdf(title=title, content=content)

    if not result.get("success"):
        raise HTTPException(500, result.get("error") or "Failed to generate document")

    source_path = Path(str(result.get("full_path") or ""))
    if not source_path.is_file():
        raise HTTPException(500, "Generated file not found")

    preview_text = _content_preview(file_type, title=title, content=content, sections=sections, sheets=sheets)
    with Session(engine) as session:
        project_file = _register_generated_project_file(
            session,
            project_id,
            source_path=source_path,
            file_name=file_name,
            file_type=file_type,
            folder_id=folder_id,
            summary=summary or f"AI generated {file_type.upper()} document",
            preview_text=preview_text,
        )
        mark_project_memory_stale(session, project_id, trigger=f"{file_type}_tool_create")
        _bust_project_cache(project_id)
        output = {
            "ok": True,
            "id": project_file.id,
            "name": project_file.name,
            "file_type": project_file.file_type,
            "folder_id": project_file.folder_id,
            "size_bytes": project_file.size_bytes,
            "path": project_file.path,
            "message": f"Created {project_file.name}",
        }

    return output
