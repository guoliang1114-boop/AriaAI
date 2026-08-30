from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.db import ProjectFile, ProjectFolder
from app.services.project_files import active_project_files_stmt
from app.services.project_todos import ensure_project_exists


def list_project_folders(
    session: Session,
    project_id: int,
) -> list[ProjectFolder]:
    """List folders without turning a read request into a persistent write.

    Default folders are created by the project creation transaction.  Legacy
    projects without folders return an empty list and owners/editors can create
    folders explicitly instead of allowing a viewer GET to seed database rows.
    """

    ensure_project_exists(session, project_id)
    return list(
        session.exec(
            select(ProjectFolder)
            .where(ProjectFolder.project_id == project_id)
            .order_by(ProjectFolder.sort_order)
        ).all()
    )


def create_project_folder(
    session: Session,
    project_id: int,
    *,
    name: str,
    sort_order: int,
) -> ProjectFolder:
    ensure_project_exists(session, project_id)
    folder = ProjectFolder(project_id=project_id, name=name, sort_order=sort_order)
    session.add(folder)
    session.commit()
    session.refresh(folder)
    return folder


def delete_project_folder(session: Session, project_id: int, folder_id: int) -> None:
    folder = session.get(ProjectFolder, folder_id)
    if not folder or folder.project_id != project_id:
        raise HTTPException(404, "Folder not found")

    files = session.exec(active_project_files_stmt(project_id).where(ProjectFile.folder_id == folder_id)).all()
    for file in files:
        file.folder_id = None
        session.add(file)

    session.delete(folder)
    session.commit()
