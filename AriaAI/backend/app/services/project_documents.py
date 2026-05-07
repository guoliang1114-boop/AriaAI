from __future__ import annotations

from datetime import datetime
from pathlib import Path
import uuid
from typing import Callable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectFile, ProjectFolder
from app.services.time_utils import utc_now_naive


def ensure_markdown_filename(name: str) -> str:
    sanitized = "_".join((name or "document").strip().split())
    sanitized = sanitized.replace("/", "_").replace("\\", "_")
    if not sanitized:
        sanitized = "document"
    if not sanitized.lower().endswith(".md"):
        sanitized = f"{sanitized}.md"
    return sanitized


def build_markdown_export_header(timestamp: datetime | None = None) -> str:
    current = timestamp or utc_now_naive()
    return f"\n\n---\n\n> From project conversation | {current.strftime('%Y-%m-%d %H:%M')}\n\n"


def build_timestamped_markdown_filename(base_name: str, timestamp: datetime | None = None) -> str:
    current = timestamp or utc_now_naive()
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
        if existing and not existing.endswith("\n"):
            existing = f"{existing}\n"
        next_content = f"{existing}{content.lstrip() if existing else content}"

    full_path.write_text(next_content, encoding="utf-8")
    return full_path.stat().st_size


def sanitize_markdown_filename(name: str) -> str:
    return ensure_markdown_filename(name).removesuffix(".md")[:80] or "conversation"


def project_documents_dir(project_id: int, uploads_dir: Path) -> Path:
    dest_dir = uploads_dir / "projects" / str(project_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    return dest_dir


def create_markdown_project_file(
    session: Session,
    project_id: int,
    name: str,
    content: str,
    *,
    uploads_dir: Path,
    folder_id: int | None = None,
    summary: str = "",
) -> ProjectFile:
    safe_name = name if name.lower().endswith(".md") else f"{name}.md"
    dest_dir = project_documents_dir(project_id, uploads_dir)
    dest_file = dest_dir / f"{uuid.uuid4().hex}_{safe_name}"
    dest_file.write_text(content, encoding="utf-8")

    project_file = ProjectFile(
        project_id=project_id,
        folder_id=folder_id,
        name=safe_name,
        file_type="md",
        path=str(dest_file.relative_to(uploads_dir)),
        size_bytes=dest_file.stat().st_size,
        summary=summary,
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file


def get_project_document_file_or_404(session: Session, project_id: int, file_id: int) -> ProjectFile:
    project_file = session.get(ProjectFile, file_id)
    if not project_file or project_file.project_id != project_id:
        raise HTTPException(404, "File not found")
    return project_file


def read_project_document_content(project_file: ProjectFile, *, uploads_dir: Path) -> str:
    full_path = uploads_dir / project_file.path
    if not full_path.exists():
        raise HTTPException(404, "File not found on disk")
    return full_path.read_text(encoding="utf-8", errors="replace")


def resolve_project_folder(
    session: Session,
    project_id: int,
    *,
    init_default_folders: Callable[[int, Session], list[ProjectFolder]],
    preferred_folder_id: int | None = None,
) -> ProjectFolder | None:
    if preferred_folder_id is not None:
        folder = session.get(ProjectFolder, preferred_folder_id)
        if not folder or folder.project_id != project_id:
            raise HTTPException(404, "Folder not found")
        return folder

    folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order, ProjectFolder.id)
    ).all()
    if not folders:
        folders = init_default_folders(project_id, session)

    for folder in folders:
        if folder.sort_order == 2:
            return folder
    return folders[0] if folders else None


def create_project_document_record(
    session: Session,
    project_id: int,
    *,
    name: str,
    content: str,
    uploads_dir: Path,
    init_default_folders: Callable[[int, Session], list[ProjectFolder]],
    folder_id: int | None = None,
    summary: str = "Project note document",
) -> ProjectFile:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    folder = (
        resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_folders,
            preferred_folder_id=folder_id,
        )
        if folder_id is not None
        else None
    )
    filename = sanitize_markdown_filename(name)
    if not filename.lower().endswith(".md"):
        filename = f"{filename}.md"

    return create_markdown_project_file(
        session=session,
        project_id=project_id,
        folder_id=folder.id if folder else None,
        name=filename,
        content=content,
        uploads_dir=uploads_dir,
        summary=summary,
    )


def get_project_document_payload(
    session: Session,
    project_id: int,
    file_id: int,
    *,
    uploads_dir: Path,
) -> dict:
    project_file = get_project_document_file_or_404(session, project_id, file_id)
    if project_file.file_type.lower() != "md":
        raise HTTPException(400, "Only markdown documents are supported")
    return {
        "id": project_file.id,
        "project_id": project_file.project_id,
        "folder_id": project_file.folder_id,
        "name": project_file.name,
        "content": read_project_document_content(project_file, uploads_dir=uploads_dir),
        "summary": project_file.summary,
        "uploaded_at": project_file.uploaded_at,
    }


def update_project_document_record(
    session: Session,
    project_id: int,
    file_id: int,
    *,
    uploads_dir: Path,
    init_default_folders: Callable[[int, Session], list[ProjectFolder]],
    content: str | None = None,
    name: str | None = None,
    folder_id: int | None = None,
) -> dict:
    project_file = get_project_document_file_or_404(session, project_id, file_id)
    if project_file.file_type.lower() != "md":
        raise HTTPException(400, "Only markdown documents are supported")

    full_path = uploads_dir / project_file.path
    if not full_path.exists():
        raise HTTPException(404, "File not found on disk")

    if content is not None:
        project_file.size_bytes = write_project_markdown_file(project_file, content, uploads_dir=uploads_dir)

    if name is not None:
        next_name = sanitize_markdown_filename(name)
        if not next_name.lower().endswith(".md"):
            next_name = f"{next_name}.md"
        project_file.name = next_name

    if folder_id is not None:
        folder = resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_folders,
            preferred_folder_id=folder_id,
        )
        project_file.folder_id = folder.id if folder else None

    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return {
        "ok": True,
        "id": project_file.id,
        "name": project_file.name,
        "folder_id": project_file.folder_id,
        "size_bytes": project_file.size_bytes,
    }

