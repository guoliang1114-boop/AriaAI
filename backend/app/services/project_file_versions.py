from __future__ import annotations

import hashlib

from sqlalchemy import func
from sqlmodel import Session, select

from app.models.db import ProjectFile, ProjectFileVersion


def _content_hash(content: str) -> str:
    return hashlib.sha256(str(content or "").encode("utf-8")).hexdigest()


def latest_project_file_version(session: Session, project_file_id: int) -> ProjectFileVersion | None:
    return session.exec(
        select(ProjectFileVersion)
        .where(ProjectFileVersion.project_file_id == project_file_id)
        .order_by(ProjectFileVersion.version_number.desc(), ProjectFileVersion.id.desc())
    ).first()


def create_project_file_version_snapshot(
    session: Session,
    project_file: ProjectFile,
    content: str,
    *,
    change_source: str = "",
    message_id: int | None = None,
) -> ProjectFileVersion | None:
    if project_file.id is None:
        return None
    content = str(content or "")
    content_hash = _content_hash(content)
    latest = latest_project_file_version(session, project_file.id)
    if latest and latest.content_hash == content_hash and latest.name == project_file.name:
        return latest

    max_version = session.exec(
        select(func.max(ProjectFileVersion.version_number)).where(ProjectFileVersion.project_file_id == project_file.id)
    ).one()
    next_version = int(max_version or 0) + 1
    snapshot = ProjectFileVersion(
        project_file_id=project_file.id,
        project_id=project_file.project_id,
        version_number=next_version,
        name=project_file.name,
        file_type=project_file.file_type,
        path=project_file.path,
        size_bytes=project_file.size_bytes,
        content_hash=content_hash,
        content_snapshot=content,
        change_source=change_source,
        message_id=message_id,
    )
    session.add(snapshot)
    session.flush()
    return snapshot


def ensure_initial_project_file_version(
    session: Session,
    project_file: ProjectFile,
    content: str,
    *,
    change_source: str = "initial_snapshot",
) -> ProjectFileVersion | None:
    if project_file.id is None:
        return None
    existing = latest_project_file_version(session, project_file.id)
    if existing:
        return existing
    return create_project_file_version_snapshot(
        session,
        project_file,
        content,
        change_source=change_source,
    )


def list_project_file_versions(
    session: Session,
    *,
    project_id: int,
    project_file_id: int,
) -> list[ProjectFileVersion]:
    return session.exec(
        select(ProjectFileVersion)
        .where(ProjectFileVersion.project_id == project_id)
        .where(ProjectFileVersion.project_file_id == project_file_id)
        .order_by(ProjectFileVersion.version_number.desc(), ProjectFileVersion.id.desc())
    ).all()
