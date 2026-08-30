from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientRecord,
    Project,
    ProjectFolder,
    ProjectMember,
    User,
)
from app.routers import projects as projects_module
from app.routers.auth import get_current_user
from app.services import project_core as project_core_service
from app.services.cache import clients_cache, projects_cache
from app.services.project_clients import list_projects_for_client


@pytest.fixture
def project_api(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, object, int]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        actor = User(
            email="project-client-actor@example.com",
            password_hash="x",
            display_name="Project Client Actor",
        )
        session.add(actor)
        session.commit()
        session.refresh(actor)
        actor_id = int(actor.id)

    app = FastAPI()
    app.include_router(projects_module.router)

    def override_session():
        with Session(engine) as session:
            yield session

    def override_current_user():
        with Session(engine) as session:
            actor = session.get(User, actor_id)
            assert actor is not None
            return actor

    app.dependency_overrides[projects_module.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_current_user
    monkeypatch.setattr(
        projects_module,
        "_schedule_project_memory_rebuild",
        lambda *_args, **_kwargs: None,
    )
    clients_cache.clear()
    projects_cache.clear()
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, engine, actor_id
    clients_cache.clear()
    projects_cache.clear()
    engine.dispose()


def _create_client(
    engine,
    *,
    name: str,
    created_by_user_id: int | None,
) -> int:
    with Session(engine) as session:
        client = ClientRecord(
            name=name,
            created_by_user_id=created_by_user_id,
        )
        session.add(client)
        session.commit()
        session.refresh(client)
        return int(client.id)


def _create_linked_project(
    engine,
    *,
    actor_id: int,
    client_id: int,
    client_name: str,
    role: str = "owner",
) -> int:
    with Session(engine) as session:
        project = Project(
            name=f"Existing {client_id}",
            client=client_name,
            client_id=client_id,
        )
        session.add(project)
        session.flush()
        session.add(
            ProjectMember(
                project_id=int(project.id),
                user_id=actor_id,
                role=role,
            )
        )
        session.commit()
        session.refresh(project)
        return int(project.id)


def test_create_with_explicit_id_canonicalizes_name_and_is_atomic(project_api) -> None:
    api, engine, actor_id = project_api
    client_id = _create_client(
        engine,
        name="Canonical Client",
        created_by_user_id=actor_id,
    )

    response = api.post(
        "/projects",
        json={
            "name": "Stable Project",
            "client": "spoofed display text",
            "client_id": client_id,
        },
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["client_id"] == client_id
    assert body["client"] == "Canonical Client"
    project_id = int(body["id"])
    with Session(engine) as session:
        project = session.get(Project, project_id)
        assert project is not None
        assert project.client_id == client_id
        assert project.client == "Canonical Client"
        members = session.exec(
            select(ProjectMember).where(ProjectMember.project_id == project_id)
        ).all()
        assert [(member.user_id, member.role) for member in members] == [
            (actor_id, "owner")
        ]
        folders = session.exec(
            select(ProjectFolder)
            .where(ProjectFolder.project_id == project_id)
            .order_by(ProjectFolder.sort_order)
        ).all()
        assert [folder.name for folder in folders] == [
            "项目需求",
            "方案和报价",
            "项目交付文档",
            "项目归档信息",
        ]


def test_name_only_unique_client_resolves_to_stable_id(project_api) -> None:
    api, engine, actor_id = project_api
    client_id = _create_client(
        engine,
        name="  Unique Client  ",
        created_by_user_id=actor_id,
    )

    response = api.post(
        "/projects",
        json={"name": "Name-resolved Project", "client": "unique client"},
    )

    assert response.status_code == 201, response.text
    assert response.json()["client_id"] == client_id
    assert response.json()["client"] == "  Unique Client  "


def test_unknown_and_ambiguous_client_ids_fail_closed(project_api) -> None:
    api, engine, actor_id = project_api
    first_id = _create_client(
        engine,
        name="Duplicate Client",
        created_by_user_id=actor_id,
    )
    second_id = _create_client(
        engine,
        name=" duplicate client ",
        created_by_user_id=actor_id,
    )

    missing = api.post(
        "/projects",
        json={"name": "Missing", "client": "Missing", "client_id": 999999},
    )
    ambiguous = api.post(
        "/projects",
        json={"name": "Ambiguous", "client": "Duplicate Client"},
    )
    explicit_first = api.post(
        "/projects",
        json={"name": "Same Name", "client": "ignored", "client_id": first_id},
    )
    explicit_second = api.post(
        "/projects",
        json={"name": "Same Name", "client": "ignored", "client_id": second_id},
    )

    assert missing.status_code == 404
    assert ambiguous.status_code == 409
    assert ambiguous.json()["detail"]["code"] == "ambiguous_client"
    assert explicit_first.status_code == 201, explicit_first.text
    assert explicit_second.status_code == 201, explicit_second.text
    assert explicit_first.json()["client_id"] == first_id
    assert explicit_second.json()["client_id"] == second_id


def test_user_cannot_link_an_unrelated_existing_client(project_api) -> None:
    api, engine, _actor_id = project_api
    with Session(engine) as session:
        other = User(email="other@example.com", password_hash="x")
        session.add(other)
        session.commit()
        session.refresh(other)
        other_id = int(other.id)
    client_id = _create_client(
        engine,
        name="Other Owner Client",
        created_by_user_id=other_id,
    )

    response = api.post(
        "/projects",
        json={
            "name": "Unauthorized Link",
            "client": "Other Owner Client",
            "client_id": client_id,
        },
    )
    name_only = api.post(
        "/projects",
        json={"name": "Unauthorized Name Link", "client": "Other Owner Client"},
    )

    assert response.status_code == 403
    assert name_only.status_code == 403
    with Session(engine) as session:
        assert session.exec(select(Project)).all() == []


def test_existing_client_editor_can_create_another_linked_project(project_api) -> None:
    api, engine, actor_id = project_api
    with Session(engine) as session:
        other = User(email="client-owner@example.com", password_hash="x")
        session.add(other)
        session.commit()
        session.refresh(other)
        other_id = int(other.id)
    client_id = _create_client(
        engine,
        name="Shared Client",
        created_by_user_id=other_id,
    )
    _create_linked_project(
        engine,
        actor_id=actor_id,
        client_id=client_id,
        client_name="Shared Client",
        role="editor",
    )

    response = api.post(
        "/projects",
        json={"name": "Second Shared Project", "client": "Shared Client"},
    )

    assert response.status_code == 201, response.text
    assert response.json()["client_id"] == client_id


def test_existing_client_viewer_cannot_create_another_linked_project(project_api) -> None:
    api, engine, actor_id = project_api
    with Session(engine) as session:
        other = User(email="viewer-client-owner@example.com", password_hash="x")
        session.add(other)
        session.commit()
        session.refresh(other)
        other_id = int(other.id)
    client_id = _create_client(
        engine,
        name="Viewer-only Client",
        created_by_user_id=other_id,
    )
    _create_linked_project(
        engine,
        actor_id=actor_id,
        client_id=client_id,
        client_name="Viewer-only Client",
        role="viewer",
    )

    response = api.post(
        "/projects",
        json={"name": "Viewer Forbidden", "client": "Viewer-only Client"},
    )

    assert response.status_code == 403


def test_update_preserves_id_and_can_reassign_same_name_clients(project_api) -> None:
    api, engine, actor_id = project_api
    source_id = _create_client(
        engine,
        name="Same Display Name",
        created_by_user_id=actor_id,
    )
    target_id = _create_client(
        engine,
        name="Same Display Name",
        created_by_user_id=actor_id,
    )
    project_id = _create_linked_project(
        engine,
        actor_id=actor_id,
        client_id=source_id,
        client_name="Same Display Name",
    )

    ordinary = api.patch(
        f"/projects/{project_id}",
        json={"description": "ordinary edit"},
    )
    reassigned = api.patch(
        f"/projects/{project_id}",
        json={"client": "Same Display Name", "client_id": target_id},
    )

    assert ordinary.status_code == 200, ordinary.text
    assert ordinary.json()["client_id"] == source_id
    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["client_id"] == target_id


def test_update_rechecks_source_project_write_permission(project_api, monkeypatch) -> None:
    api, engine, actor_id = project_api
    client_id = _create_client(
        engine,
        name="Viewer Client",
        created_by_user_id=actor_id,
    )
    project_id = _create_linked_project(
        engine,
        actor_id=actor_id,
        client_id=client_id,
        client_name="Viewer Client",
        role="viewer",
    )
    # Simulate a stale/previous router authorization result. The service-layer
    # transaction must still reject the write after locking current membership.
    monkeypatch.setattr(projects_module, "require_project_access", lambda *_a, **_k: None)

    response = api.patch(
        f"/projects/{project_id}",
        json={"description": "must not persist"},
    )

    assert response.status_code == 403
    with Session(engine) as session:
        project = session.get(Project, project_id)
        assert project is not None
        assert project.description == ""


def test_reassignment_locks_source_and_target_projects_and_memberships_once_in_id_order(
    project_api,
    monkeypatch,
) -> None:
    _api, engine, actor_id = project_api
    with Session(engine) as setup:
        target_owner = User(
            email="target-lock-owner@example.com",
            password_hash="x",
        )
        setup.add(target_owner)
        setup.flush()
        source_client = ClientRecord(
            name="Union source",
            created_by_user_id=actor_id,
        )
        target_client = ClientRecord(
            name="Union target",
            created_by_user_id=int(target_owner.id),
        )
        setup.add(source_client)
        setup.add(target_client)
        setup.flush()
        target_first = Project(
            name="Target first",
            client=target_client.name,
            client_id=int(target_client.id),
        )
        source = Project(
            name="Source middle",
            client=source_client.name,
            client_id=int(source_client.id),
        )
        target_last = Project(
            name="Target last",
            client=target_client.name,
            client_id=int(target_client.id),
        )
        setup.add(target_first)
        setup.add(source)
        setup.add(target_last)
        setup.flush()
        source_membership = ProjectMember(
            project_id=int(source.id),
            user_id=actor_id,
            role="owner",
        )
        target_membership = ProjectMember(
            project_id=int(target_first.id),
            user_id=actor_id,
            role="editor",
        )
        setup.add(source_membership)
        setup.add(target_membership)
        setup.commit()
        expected_project_ids = sorted(
            [int(target_first.id), int(source.id), int(target_last.id)]
        )
        expected_membership_ids = sorted(
            [int(source_membership.id), int(target_membership.id)]
        )
        source_project_id = int(source.id)
        target_client_id = int(target_client.id)

    with Session(engine) as session:
        original_exec = session.exec
        locked_project_batches: list[list[int]] = []
        locked_membership_batches: list[list[int]] = []

        class _Rows:
            def __init__(self, rows):
                self._rows = rows

            def all(self):
                return self._rows

        def track_ordered_locks(statement, *args, **kwargs):
            if getattr(statement, "_for_update_arg", None) is not None:
                entities = {
                    description.get("entity")
                    for description in getattr(statement, "column_descriptions", ())
                }
                if Project in entities:
                    rows = list(original_exec(statement, *args, **kwargs).all())
                    locked_project_batches.append([int(row.id) for row in rows])
                    return _Rows(rows)
                if ProjectMember in entities:
                    rows = list(original_exec(statement, *args, **kwargs).all())
                    locked_membership_batches.append([int(row.id) for row in rows])
                    return _Rows(rows)
            return original_exec(statement, *args, **kwargs)

        monkeypatch.setattr(session, "exec", track_ordered_locks)
        project_core_service.update_project_record(
            session,
            source_project_id,
            {
                "client": "Union target",
                "client_id": target_client_id,
            },
            actor_user_id=actor_id,
        )

    assert locked_project_batches == [expected_project_ids]
    assert locked_membership_batches == [expected_membership_ids]


def test_project_owner_cannot_reassign_to_unrelated_client(project_api) -> None:
    api, engine, actor_id = project_api
    source_id = _create_client(
        engine,
        name="Owned Source",
        created_by_user_id=actor_id,
    )
    with Session(engine) as session:
        other = User(email="reassign-target-owner@example.com", password_hash="x")
        session.add(other)
        session.commit()
        session.refresh(other)
        other_id = int(other.id)
    target_id = _create_client(
        engine,
        name="Unrelated Target",
        created_by_user_id=other_id,
    )
    project_id = _create_linked_project(
        engine,
        actor_id=actor_id,
        client_id=source_id,
        client_name="Owned Source",
    )

    response = api.patch(
        f"/projects/{project_id}",
        json={"client": "Unrelated Target", "client_id": target_id},
    )

    assert response.status_code == 403
    with Session(engine) as session:
        assert session.get(Project, project_id).client_id == source_id


def test_explicit_null_detaches_while_field_absence_preserves_link(project_api) -> None:
    api, engine, actor_id = project_api
    client_id = _create_client(
        engine,
        name="Detach Client",
        created_by_user_id=actor_id,
    )
    project_id = _create_linked_project(
        engine,
        actor_id=actor_id,
        client_id=client_id,
        client_name="Detach Client",
    )

    preserved = api.patch(
        f"/projects/{project_id}",
        json={"description": "still linked"},
    )
    detached = api.patch(
        f"/projects/{project_id}",
        json={"client_id": None},
    )

    assert preserved.status_code == 200, preserved.text
    assert preserved.json()["client_id"] == client_id
    assert detached.status_code == 200, detached.text
    assert detached.json()["client_id"] is None
    assert detached.json()["client"] == "Detach Client"


def test_legacy_client_without_creator_or_projects_requires_admin(project_api) -> None:
    api, engine, actor_id = project_api
    client_id = _create_client(
        engine,
        name="Legacy Empty Client",
        created_by_user_id=None,
    )

    denied = api.post(
        "/projects",
        json={"name": "Legacy Denied", "client": "Legacy Empty Client"},
    )
    with Session(engine) as session:
        actor = session.get(User, actor_id)
        assert actor is not None
        actor.is_admin = True
        session.add(actor)
        session.commit()
    allowed = api.post(
        "/projects",
        json={"name": "Legacy Admin", "client": "Legacy Empty Client"},
    )

    assert denied.status_code == 403
    assert allowed.status_code == 201, allowed.text
    assert allowed.json()["client_id"] == client_id


def test_inactive_actor_is_rechecked_inside_create_transaction(project_api) -> None:
    api, engine, actor_id = project_api
    with Session(engine) as session:
        actor = session.get(User, actor_id)
        assert actor is not None
        actor.is_active = False
        session.add(actor)
        session.commit()

    response = api.post(
        "/projects",
        json={"name": "Inactive Actor Project", "client": "Free Text"},
    )

    assert response.status_code == 403
    with Session(engine) as session:
        assert session.exec(select(Project)).all() == []


def test_later_same_name_client_does_not_claim_unlinked_project(project_api) -> None:
    api, engine, actor_id = project_api
    response = api.post(
        "/projects",
        json={"name": "Unlinked Project", "client": "Future Client"},
    )
    assert response.status_code == 201, response.text
    project_id = int(response.json()["id"])
    assert response.json()["client_id"] is None

    client_id = _create_client(
        engine,
        name="Future Client",
        created_by_user_id=actor_id,
    )
    with Session(engine) as session:
        client = session.get(ClientRecord, client_id)
        project = session.get(Project, project_id)
        assert client is not None and project is not None
        assert project.client_id is None
        assert list_projects_for_client(session, client) == []
