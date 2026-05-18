from __future__ import annotations

from datetime import datetime
from pathlib import Path
import uuid
from typing import Callable

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectFile, ProjectFolder
from app.services.time_utils import utc_now_naive

_MARKDOWN_FILENAME_MAX_BYTES = 120


def _truncate_utf8(value: str, max_bytes: int) -> str:
    if len(value.encode("utf-8")) <= max_bytes:
        return value
    output: list[str] = []
    used = 0
    for char in value:
        size = len(char.encode("utf-8"))
        if used + size > max_bytes:
            break
        output.append(char)
        used += size
    return "".join(output).rstrip("._- ")


def ensure_markdown_filename(name: str) -> str:
    sanitized = "_".join((name or "document").strip().split())
    for char in '/\\:*?"<>|':
        sanitized = sanitized.replace(char, "_")
    if not sanitized:
        sanitized = "document"
    stem = sanitized[:-3] if sanitized.lower().endswith(".md") else sanitized
    stem = _truncate_utf8(stem, _MARKDOWN_FILENAME_MAX_BYTES - len(".md"))
    return f"{stem or 'document'}.md"


def build_markdown_export_header(timestamp: datetime | None = None) -> str:
    current = timestamp or utc_now_naive()
    return f"\n\n---\n\n> From project conversation | {current.strftime('%Y-%m-%d %H:%M')}\n\n"


def build_timestamped_markdown_filename(base_name: str, timestamp: datetime | None = None) -> str:
    current = timestamp or utc_now_naive()
    suffix = f"_{current.strftime('%Y%m%d_%H%M%S')}"
    safe_name = ensure_markdown_filename(base_name).removesuffix(".md")
    safe_name = _truncate_utf8(safe_name, _MARKDOWN_FILENAME_MAX_BYTES - len(suffix.encode("utf-8")) - len(".md"))
    return f"{safe_name}_{current.strftime('%Y%m%d_%H%M%S')}.md"


def write_project_markdown_file(
    project_file: ProjectFile,
    content: str,
    *,
    uploads_dir: Path,
    append: bool = False,
) -> int:
    full_path = uploads_dir / Path(project_file.path)
    if not full_path.is_file():
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
    return ensure_markdown_filename(name).removesuffix(".md") or "conversation"


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
    source_file_id: int | None = None,
    origin: str = "manual",
) -> ProjectFile:
    safe_name = ensure_markdown_filename(name)
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
        source_file_id=source_file_id,
        origin=origin,
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
    if not full_path.is_file():
        raise HTTPException(404, "File not found on disk")
    return full_path.read_text(encoding="utf-8", errors="replace")


def resolve_project_folder(
    session: Session,
    project_id: int,
    *,
    init_default_folders: Callable[[Session, int], list[ProjectFolder]],
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
        folders = init_default_folders(session, project_id)

    for folder in folders:
        if folder.sort_order == 2:
            return folder
    return folders[0] if folders else None


def _folder_signal_score(folder_name: str, text: str) -> int:
    name = folder_name.lower()
    score = 0
    signal_groups = [
        (("需求", "requirement", "brief", "背景", "痛点", "调研"), ("需求", "requirement")),
        (("方案", "报价", "ppt", "presentation", "proposal", "quote", "建议", "目录"), ("方案", "报价", "proposal")),
        (("交付", "计划", "会议", "纪要", "里程碑", "deliver", "meeting", "plan"), ("交付", "deliver")),
        (("归档", "结项", "验收", "合同", "archive", "final"), ("归档", "archive")),
    ]
    for text_keywords, folder_keywords in signal_groups:
        if any(keyword in name for keyword in folder_keywords):
            score += sum(2 for keyword in text_keywords if keyword in text)
    if folder_name and folder_name.lower() in text:
        score += 5
    return score


def infer_project_folder(
    session: Session,
    project_id: int,
    *,
    init_default_folders: Callable[[Session, int], list[ProjectFolder]],
    preferred_folder_id: int | None = None,
    name: str = "",
    content: str = "",
    summary: str = "",
) -> ProjectFolder | None:
    if preferred_folder_id is not None:
        return resolve_project_folder(
            session,
            project_id,
            init_default_folders=init_default_folders,
            preferred_folder_id=preferred_folder_id,
        )

    folders = session.exec(
        select(ProjectFolder)
        .where(ProjectFolder.project_id == project_id)
        .order_by(ProjectFolder.sort_order, ProjectFolder.id)
    ).all()
    if not folders:
        folders = init_default_folders(session, project_id)
    if not folders:
        return None

    text = f"{name}\n{summary}\n{content[:4000]}".lower()
    best_folder = max(folders, key=lambda folder: (_folder_signal_score(folder.name, text), -folder.sort_order))
    if _folder_signal_score(best_folder.name, text) > 0:
        return best_folder

    for folder in folders:
        if "交付" in folder.name or "deliver" in folder.name.lower():
            return folder
    return folders[0]


def create_project_document_record(
    session: Session,
    project_id: int,
    *,
    name: str,
    content: str,
    uploads_dir: Path,
    init_default_folders: Callable[[Session, int], list[ProjectFolder]],
    folder_id: int | None = None,
    summary: str = "Project note document",
    auto_assign_folder: bool = False,
) -> ProjectFile:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")

    folder = None
    if folder_id is not None or auto_assign_folder:
        folder = infer_project_folder(
            session,
            project_id,
            init_default_folders=init_default_folders,
            preferred_folder_id=folder_id,
            name=name,
            content=content,
            summary=summary,
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
    init_default_folders: Callable[[Session, int], list[ProjectFolder]],
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
