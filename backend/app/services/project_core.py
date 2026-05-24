from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import Project, ProjectFolder, ProjectMember
from app.services.time_utils import utc_now_naive


DEFAULT_PROJECT_FOLDER_NAMES = ["项目需求", "方案和报价", "项目交付文档", "项目归档信息"]


def _normalize_project_identity(value: str | None) -> str:
    return " ".join(str(value or "").strip().lower().split())


def init_default_project_folders(session: Session, project_id: int) -> list[ProjectFolder]:
    existing = session.exec(
        select(ProjectFolder).where(ProjectFolder.project_id == project_id)
    ).all()
    if existing:
        return existing

    folders = [
        ProjectFolder(project_id=project_id, name=name, sort_order=index)
        for index, name in enumerate(DEFAULT_PROJECT_FOLDER_NAMES)
    ]
    for folder in folders:
        session.add(folder)
    session.commit()
    for folder in folders:
        session.refresh(folder)
    return folders


def list_projects_basic(
    session: Session,
    *,
    status: str | None = None,
    member_user_id: int | None = None,
) -> list[Project]:
    stmt = select(Project).order_by(Project.updated_at.desc())
    if status:
        stmt = stmt.where(Project.status == status)
    if member_user_id is not None:
        stmt = (
            stmt.join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(ProjectMember.user_id == member_user_id)
            .distinct()
        )
    return session.exec(stmt).all()


def find_duplicate_project(session: Session, *, name: str, client: str) -> Project | None:
    normalized_name = _normalize_project_identity(name)
    normalized_client = _normalize_project_identity(client)
    if not normalized_name or not normalized_client:
        return None
    candidates = session.exec(
        select(Project)
        .where(Project.status != "archived")
        .order_by(Project.updated_at.desc(), Project.id.desc())
    ).all()
    for project in candidates:
        if (
            _normalize_project_identity(project.name) == normalized_name
            and _normalize_project_identity(project.client) == normalized_client
        ):
            return project
    return None


def create_project_record(session: Session, data: dict) -> Project:
    duplicate = find_duplicate_project(
        session,
        name=str(data.get("name") or ""),
        client=str(data.get("client") or ""),
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_project",
                "message": "Project already exists for this client",
                "project_id": duplicate.id,
                "project_name": duplicate.name,
                "client": duplicate.client,
            },
        )
    project = Project(**data)
    project.memory_stale = True
    session.add(project)
    session.commit()
    session.refresh(project)
    init_default_project_folders(session, project.id)
    session.refresh(project)
    return project


def get_project_or_404(session: Session, project_id: int) -> Project:
    project = session.get(Project, project_id)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def update_project_record(session: Session, project_id: int, changes: dict) -> Project:
    project = get_project_or_404(session, project_id)
    for key, value in changes.items():
        setattr(project, key, value)
    project.memory_stale = True
    project.updated_at = utc_now_naive()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project
