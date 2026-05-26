from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlmodel import Session, select

from app.models.db import GeneratedFile, ProjectFile, TaskArtifact
from app.services.upload_paths import resolve_upload_path
from app.services.time_utils import utc_now_naive
from app.services.project_todos import ensure_project_exists


def active_project_files_stmt(project_id: int):
    return select(ProjectFile).where(
        ProjectFile.project_id == project_id,
        ProjectFile.deleted_at.is_(None),
    )


def list_project_files(session: Session, project_id: int) -> list[ProjectFile]:
    ensure_project_exists(session, project_id)
    return session.exec(active_project_files_stmt(project_id)).all()


def list_archived_project_files(session: Session, project_id: int) -> list[ProjectFile]:
    ensure_project_exists(session, project_id)
    return session.exec(
        select(ProjectFile)
        .where(ProjectFile.project_id == project_id, ProjectFile.deleted_at.is_not(None))
        .order_by(ProjectFile.deleted_at.desc(), ProjectFile.id.desc())
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
        origin="uploaded",
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file, dest_file, suffix.lstrip(".")


def get_project_file_or_404(session: Session, project_id: int, file_id: int) -> ProjectFile:
    project_file = session.get(ProjectFile, file_id)
    if not project_file or project_file.project_id != project_id or project_file.deleted_at is not None:
        raise HTTPException(404, "File not found")
    return project_file


def resolve_project_file_path(project_file: ProjectFile, uploads_dir: Path) -> Path:
    return resolve_upload_path(uploads_dir, project_file.path)


def delete_project_file(session: Session, project_id: int, file_id: int, *, uploads_dir: Path) -> None:
    project_file = session.get(ProjectFile, file_id)
    if not project_file or project_file.project_id != project_id:
        raise HTTPException(404, "File not found")
    full_path = resolve_upload_path(uploads_dir, project_file.path, must_exist=False)

    derivative_files = session.exec(
        select(ProjectFile).where(ProjectFile.source_file_id == file_id)
    ).all()
    for derivative_file in derivative_files:
        derivative_file.source_file_id = None
        session.add(derivative_file)

    task_artifacts = session.exec(
        select(TaskArtifact).where(TaskArtifact.project_file_id == file_id)
    ).all()
    for task_artifact in task_artifacts:
        task_artifact.project_file_id = None
        session.add(task_artifact)

    generated_files = session.exec(
        select(GeneratedFile).where(
            GeneratedFile.project_id == project_id,
            GeneratedFile.path == project_file.path,
        )
    ).all()
    for generated_file in generated_files:
        session.delete(generated_file)

    session.delete(project_file)
    session.commit()

    if full_path.is_file():
        full_path.unlink()


def archive_project_file(
    session: Session,
    project_id: int,
    file_id: int,
    *,
    deleted_by_user_id: int | None = None,
    reason: str | None = None,
    batch_id: str | None = None,
) -> ProjectFile:
    """Move a project file to the logical trash without deleting bytes from disk."""
    project_file = get_project_file_or_404(session, project_id, file_id)

    derivative_files = session.exec(
        select(ProjectFile).where(
            ProjectFile.source_file_id == file_id,
            ProjectFile.deleted_at.is_(None),
        )
    ).all()
    for derivative_file in derivative_files:
        derivative_file.source_file_id = None
        session.add(derivative_file)

    project_file.deleted_at = utc_now_naive()
    project_file.deleted_by_user_id = deleted_by_user_id
    project_file.delete_reason = (reason or "").strip()
    project_file.delete_batch_id = batch_id or uuid.uuid4().hex
    project_file.folder_id = None
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file


def restore_project_file(session: Session, project_id: int, file_id: int) -> ProjectFile:
    ensure_project_exists(session, project_id)
    project_file = session.get(ProjectFile, file_id)
    if not project_file or project_file.project_id != project_id or project_file.deleted_at is None:
        raise HTTPException(404, "Archived file not found")
    project_file.deleted_at = None
    project_file.deleted_by_user_id = None
    project_file.delete_reason = ""
    project_file.delete_batch_id = ""
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    return project_file
