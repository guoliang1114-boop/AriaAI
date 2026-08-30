from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.database import get_session
from app.models.db import Project, ProjectFile, ProjectFolder, ProjectMember, TaskRun, User
from app.routers import projects_files, projects_tasks
from app.routers.auth import get_current_user


@pytest.fixture
def project_subroute_api() -> Iterator[tuple[TestClient, object, int, int]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        viewer = User(
            email="project-subroute-viewer@example.com",
            password_hash="x",
            display_name="Project Subroute Viewer",
        )
        project = Project(
            name="Project subroute ACL",
            client="Read only client",
            memory_stale=False,
        )
        session.add(viewer)
        session.add(project)
        session.commit()
        session.refresh(viewer)
        session.refresh(project)
        session.add(
            ProjectMember(
                project_id=int(project.id),
                user_id=int(viewer.id),
                role="viewer",
            )
        )
        session.commit()
        viewer_id = int(viewer.id)
        project_id = int(project.id)

    app = FastAPI()
    app.include_router(projects_files.router, prefix="/projects")
    app.include_router(projects_tasks.router, prefix="/projects")

    def override_session():
        with Session(engine) as session:
            yield session

    def override_current_user():
        with Session(engine) as session:
            user = session.get(User, viewer_id)
            assert user is not None
            return user

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_current_user] = override_current_user
    with TestClient(app, raise_server_exceptions=False) as api:
        yield api, engine, viewer_id, project_id
    engine.dispose()


def test_viewer_reads_do_not_seed_project_subresources(project_subroute_api) -> None:
    api, engine, _viewer_id, project_id = project_subroute_api

    for path in (
        f"/projects/{project_id}/files",
        f"/projects/{project_id}/folders",
        f"/projects/{project_id}/task-runs",
    ):
        response = api.get(path)
        assert response.status_code == 200, (path, response.text)
        assert response.json() == []

    with Session(engine) as session:
        assert session.exec(select(ProjectFolder)).all() == []
        assert session.exec(select(ProjectFile)).all() == []
        assert session.exec(select(TaskRun)).all() == []


def test_viewer_cannot_mutate_files_documents_folders_or_tasks(project_subroute_api) -> None:
    api, engine, _viewer_id, project_id = project_subroute_api
    requests: list[tuple[str, str, dict]] = [
        ("post", f"/projects/{project_id}/files/900/restore", {}),
        (
            "post",
            f"/projects/{project_id}/documents",
            {"json": {"name": "viewer.md", "content": "must not persist"}},
        ),
        (
            "patch",
            f"/projects/{project_id}/documents/900",
            {"json": {"content": "must not persist"}},
        ),
        (
            "post",
            f"/projects/{project_id}/conversations/900/save-markdown",
            {"json": {"action": "new", "file_name": "viewer.md"}},
        ),
        (
            "post",
            f"/projects/{project_id}/messages/900/save-to-document",
            {"json": {"action": "new", "file_name": "viewer.md"}},
        ),
        (
            "post",
            f"/projects/{project_id}/messages/900/confirm-markdown-save",
            {"json": {"pending_index": 0}},
        ),
        (
            "patch",
            f"/projects/{project_id}/files/900/folder",
            {"json": {"folder_id": None}},
        ),
        (
            "post",
            f"/projects/{project_id}/files/900/versions/901/restore",
            {},
        ),
        (
            "post",
            f"/projects/{project_id}/files",
            {"files": {"file": ("viewer.txt", b"must not persist", "text/plain")}},
        ),
        ("delete", f"/projects/{project_id}/files/900", {}),
        (
            "post",
            f"/projects/{project_id}/folders",
            {"json": {"name": "Viewer folder", "sort_order": 0}},
        ),
        ("delete", f"/projects/{project_id}/folders/900", {}),
        (
            "post",
            f"/projects/{project_id}/task-runs",
            {
                "json": {
                    "task_type": "generate_client_ppt",
                    "goal": "must not start",
                    "start": False,
                }
            },
        ),
        ("post", f"/projects/{project_id}/task-runs/900/retry", {}),
        ("post", f"/projects/{project_id}/task-runs/900/cancel", {}),
        ("post", f"/projects/{project_id}/task-runs/900/pause", {}),
        ("post", f"/projects/{project_id}/task-runs/900/resume", {}),
    ]

    for method, path, kwargs in requests:
        response = getattr(api, method)(path, **kwargs)
        assert response.status_code == 403, (method, path, response.text)
        assert response.json()["detail"] == "Project write permission required"

    with Session(engine) as session:
        assert session.exec(select(ProjectFolder)).all() == []
        assert session.exec(select(ProjectFile)).all() == []
        assert session.exec(select(TaskRun)).all() == []


def test_editor_can_create_project_folder_and_durable_task(project_subroute_api) -> None:
    api, engine, viewer_id, project_id = project_subroute_api
    with Session(engine) as session:
        membership = session.exec(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == viewer_id,
            )
        ).one()
        membership.role = "editor"
        session.add(membership)
        session.commit()

    folder_response = api.post(
        f"/projects/{project_id}/folders",
        json={"name": "Editor folder", "sort_order": 3},
    )
    task_response = api.post(
        f"/projects/{project_id}/task-runs",
        json={
            "task_type": "generate_client_ppt",
            "goal": "Create an authorized durable task",
            "start": False,
        },
    )

    assert folder_response.status_code == 201, folder_response.text
    assert task_response.status_code == 200, task_response.text
    assert task_response.json()["created_by_user_id"] == viewer_id
    with Session(engine) as session:
        assert len(session.exec(select(ProjectFolder)).all()) == 1
        assert len(session.exec(select(TaskRun)).all()) == 1
