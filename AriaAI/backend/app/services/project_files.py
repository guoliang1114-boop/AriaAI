from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, select

from app.models.db import ProjectFile
from app.services.project_todos import ensure_project_exists


def list_project_files(session: Session, project_id: int) -> list[ProjectFile]:
    ensure_project_exists(session, project_id)
    return session.exec(
        select(ProjectFile).where(ProjectFile.project_id == project_id)
    ).all()


def create_project_upload(
    session: Session,
    project_id: int,
    *,
    upload: UploadFile,
    uploads_dir: Path,
    folder_id: int | None = None,
) -> tuple[ProjectFile, Path, str]:
    ensure_project_exists(session, project_id)

    suffix = Path(upload.filename or "file").suffix.lower()
    dest_name = f"{uuid.uuid4().hex}{suffix}"
    dest_dir = uploads_dir / "projects" / str(project_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_file = dest_dir / dest_name

    with dest_file.open("wb") as target:
        shutil.copyfileobj(upload.file, target)

    project_file = ProjectFile(
        project_id=project_id,
        folder_id=folder_id,
        name=upload.filename or dest_name,
        file_type=suffix.lstrip("."),
        path=str(dest_file.relative_to(uploads_dir)),
        size_bytes=dest_file.stat().st_size,
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file, dest_file, suffix.lstrip(".")


def get_project_file_or_404(session: Session, project_id: int, file_id: int) -> ProjectFile:
    project_file = session.get(ProjectFile, file_id)
    if not project_file or project_file.project_id != project_id:
        raise HTTPException(404, "File not found")
    return project_file


def resolve_project_file_path(project_file: ProjectFile, uploads_dir: Path) -> Path:
    full_path = uploads_dir / project_file.path
    if not full_path.is_file():
        raise HTTPException(404, "File not found on disk")
    return full_path


def delete_project_file(session: Session, project_id: int, file_id: int, *, uploads_dir: Path) -> None:
    project_file = get_project_file_or_404(session, project_id, file_id)
    full_path = uploads_dir / project_file.path
    if full_path.is_file():
        full_path.unlink()
    session.delete(project_file)
    session.commit()
