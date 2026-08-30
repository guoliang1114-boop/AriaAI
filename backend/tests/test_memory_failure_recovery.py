from __future__ import annotations

import json
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientMemoryFact,
    ClientMemorySlot,
    ClientRecord,
    ClientMemorySummary,
    ClientStakeholder,
    ClientStakeholderHistory,
    Project,
    ProjectMemoryFact,
    ProjectMemorySlot,
    ProjectMemorySummary,
    User,
)
from app.routers import (
    clients,
    clients_deps,
    clients_memory,
    clients_stakeholders,
    projects,
    projects_deps,
    projects_memory,
)
from app.routers.clients_deps import PromoteProjectMemoryRequest
from app.routers.projects_deps import ProjectCreate, ProjectMemorySummarizeRequest, ProjectUpdate
from app.services.memory_rebuilds import MemoryRebuildConflict
from app.services.client_contexts import get_client_memory_payload, mark_client_memory_stale
from app.services.project_contexts import get_project_memory_payload, mark_project_memory_stale
from app.services.time_utils import utc_now_naive


class _OwnerSession:
    def __init__(self, owner):
        self.owner = owner
        self.rollback_count = 0
        self.commit_count = 0
        self.added = []

    def get(self, _model, owner_id):
        return self.owner if self.owner.id == owner_id else None

    def exec(self, _statement):
        owner = self.owner

        class _Result:
            def first(self):
                return owner

        return _Result()

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.commit_count += 1

    def rollback(self):
        self.rollback_count += 1

    def expire_all(self):
        return None


def _sqlite_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    return engine


def test_project_failure_receipt_does_not_overwrite_concurrent_success():
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            project = Project(
                name="Concurrent project",
                client="Acme",
                memory_version=1,
                memory_rebuild_status="rebuilding",
                context_memory_json=json.dumps({"project_brief": "old"}),
            )
            setup.add(project)
            setup.commit()
            setup.refresh(project)
            project_id = project.id

        with Session(engine) as stale_session:
            stale_project = stale_session.get(Project, project_id)
            with Session(engine) as success_session:
                current = success_session.get(Project, project_id)
                current.memory_version = 2
                current.memory_rebuild_status = "idle"
                current.context_memory_json = json.dumps(
                    {"project_brief": "successful rebuild", "rebuild_log": [{"version": 2}]}
                )
                success_session.add(current)
                success_session.commit()

            recorded = projects_deps._set_project_memory_failure(
                stale_session,
                stale_project,
                stage="summary_warm",
                message="late provider failure",
            )

        with Session(engine) as verify:
            current = verify.get(Project, project_id)
            memory = json.loads(current.context_memory_json)
        assert recorded is False
        assert current.memory_version == 2
        assert current.memory_rebuild_status == "idle"
        assert memory["project_brief"] == "successful rebuild"
        assert "_last_failure" not in memory
    finally:
        engine.dispose()


def test_client_failure_receipt_does_not_overwrite_concurrent_success():
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            client = ClientRecord(
                name="Concurrent client",
                client_memory_version=3,
                client_memory_rebuild_status="rebuilding",
                client_memory_json=json.dumps({"overview": "old"}),
            )
            setup.add(client)
            setup.commit()
            setup.refresh(client)
            client_id = client.id

        with Session(engine) as stale_session:
            stale_client = stale_session.get(ClientRecord, client_id)
            with Session(engine) as success_session:
                current = success_session.get(ClientRecord, client_id)
                current.client_memory_version = 4
                current.client_memory_rebuild_status = "idle"
                current.client_memory_json = json.dumps(
                    {"overview": "successful rebuild", "rebuild_log": [{"version": 4}]}
                )
                success_session.add(current)
                success_session.commit()

            recorded = clients_deps._set_client_memory_failure(
                stale_session,
                stale_client,
                stage="summary_warm",
                message="late provider failure",
            )

        with Session(engine) as verify:
            current = verify.get(ClientRecord, client_id)
            memory = json.loads(current.client_memory_json)
        assert recorded is False
        assert current.client_memory_version == 4
        assert current.client_memory_rebuild_status == "idle"
        assert memory["overview"] == "successful rebuild"
        assert "_last_failure" not in memory
    finally:
        engine.dispose()


def test_project_stale_mark_refreshes_cached_owner_slot_and_fact() -> None:
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            project = Project(
                name="Cached project",
                client="Acme",
                memory_stale=True,
            )
            setup.add(project)
            setup.commit()
            setup.refresh(project)
            slot = ProjectMemorySlot(
                project_id=int(project.id),
                slot_key="project_brief",
                is_stale=True,
            )
            fact = ProjectMemoryFact(
                project_id=int(project.id),
                slot_key="project_brief",
                fact_key="cached-project-fact",
                is_stale=True,
            )
            setup.add(slot)
            setup.add(fact)
            setup.commit()
            setup.refresh(slot)
            setup.refresh(fact)
            project_id = int(project.id)
            slot_id = int(slot.id)
            fact_id = int(fact.id)

        with Session(engine) as stale_session:
            assert stale_session.get(Project, project_id).memory_stale is True
            assert stale_session.get(ProjectMemorySlot, slot_id).is_stale is True
            assert stale_session.get(ProjectMemoryFact, fact_id).is_stale is True
            with Session(engine) as concurrent:
                current_project = concurrent.get(Project, project_id)
                current_slot = concurrent.get(ProjectMemorySlot, slot_id)
                current_fact = concurrent.get(ProjectMemoryFact, fact_id)
                current_project.memory_stale = False
                current_slot.is_stale = False
                current_fact.is_stale = False
                concurrent.add(current_project)
                concurrent.add(current_slot)
                concurrent.add(current_fact)
                concurrent.commit()

            mark_project_memory_stale(
                stale_session,
                project_id,
                trigger="project_reassigned",
            )

        with Session(engine) as verify:
            assert verify.get(Project, project_id).memory_stale is True
            assert verify.get(ProjectMemorySlot, slot_id).is_stale is True
            assert verify.get(ProjectMemoryFact, fact_id).is_stale is True
    finally:
        engine.dispose()


def test_client_stale_mark_refreshes_cached_owner_slot_and_fact() -> None:
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            client = ClientRecord(name="Cached client", client_memory_stale=True)
            setup.add(client)
            setup.commit()
            setup.refresh(client)
            slot = ClientMemorySlot(
                client_id=int(client.id),
                slot_key="decision_patterns",
                is_stale=True,
            )
            fact = ClientMemoryFact(
                client_id=int(client.id),
                slot_key="decision_patterns",
                fact_key="cached-client-fact",
                is_stale=True,
            )
            setup.add(slot)
            setup.add(fact)
            setup.commit()
            setup.refresh(slot)
            setup.refresh(fact)
            client_id = int(client.id)
            slot_id = int(slot.id)
            fact_id = int(fact.id)

        with Session(engine) as stale_session:
            assert stale_session.get(ClientRecord, client_id).client_memory_stale is True
            assert stale_session.get(ClientMemorySlot, slot_id).is_stale is True
            assert stale_session.get(ClientMemoryFact, fact_id).is_stale is True
            with Session(engine) as concurrent:
                current_client = concurrent.get(ClientRecord, client_id)
                current_slot = concurrent.get(ClientMemorySlot, slot_id)
                current_fact = concurrent.get(ClientMemoryFact, fact_id)
                current_client.client_memory_stale = False
                current_slot.is_stale = False
                current_fact.is_stale = False
                concurrent.add(current_client)
                concurrent.add(current_slot)
                concurrent.add(current_fact)
                concurrent.commit()

            mark_client_memory_stale(
                stale_session,
                client_id,
                trigger="stakeholder_updated",
            )

        with Session(engine) as verify:
            assert verify.get(ClientRecord, client_id).client_memory_stale is True
            assert verify.get(ClientMemorySlot, slot_id).is_stale is True
            assert verify.get(ClientMemoryFact, fact_id).is_stale is True
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_project_rebuild_conflict_does_not_attach_failure_to_winner():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            project = Project(
                name="Conflicting rebuild",
                client="Acme",
                memory_version=1,
                memory_stale=True,
                memory_rebuild_status="rebuilding",
                context_memory_json=json.dumps({"project_brief": "Before"}),
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id or 0)

            async def complete_after_concurrent_success(**_kwargs):
                with Session(engine) as concurrent:
                    winner = concurrent.get(Project, project_id)
                    assert winner is not None
                    provider_payload = projects_deps._default_project_memory(winner)
                    winner.memory_version = 2
                    winner.memory_stale = False
                    winner.memory_rebuild_status = "idle"
                    winner.context_memory_json = json.dumps(
                        {
                            "project_brief": "Concurrent winner",
                            "memory_version": 2,
                            "rebuild_log": [{"version": 2}],
                        }
                    )
                    concurrent.add(winner)
                    concurrent.commit()
                return json.dumps(provider_payload)

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=complete_after_concurrent_success,
            ):
                with pytest.raises(MemoryRebuildConflict):
                    await projects_deps._rebuild_project_memory(
                        session,
                        project_id,
                        trigger="manual",
                    )

        with Session(engine) as verify:
            winner = verify.get(Project, project_id)
            assert winner is not None
            memory = json.loads(winner.context_memory_json)
            assert winner.memory_version == 2
            assert winner.memory_rebuild_status == "idle"
            assert memory["project_brief"] == "Concurrent winner"
            assert "_last_failure" not in memory
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_scheduled_project_retry_does_not_requeue_after_concurrent_success():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            project = Project(
                name="Scheduled project",
                client="Acme",
                memory_version=1,
                memory_stale=True,
                memory_rebuild_status="queued",
                context_memory_json="{}",
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = project.id

        async def succeed_elsewhere_then_fail(*_args, **_kwargs):
            with Session(engine) as concurrent:
                current = concurrent.get(Project, project_id)
                current.memory_version = 2
                current.memory_stale = False
                current.memory_rebuild_status = "idle"
                current.context_memory_json = json.dumps({"project_brief": "success"})
                concurrent.add(current)
                concurrent.commit()
            raise RuntimeError("late retryable failure")

        with patch.object(projects_deps, "engine", engine), patch.object(
            projects_deps,
            "_rebuild_project_memory",
            side_effect=succeed_elsewhere_then_fail,
        ), patch.object(
            projects_deps.scheduler_service,
            "is_running",
            return_value=True,
        ), patch.object(
            projects_deps.scheduler_service,
            "add_or_replace_date_job",
        ) as add_job:
            await projects_deps._run_project_memory_rebuild_job(project_id)

        add_job.assert_not_called()
        with Session(engine) as session:
            current = session.get(Project, project_id)
            memory = json.loads(current.context_memory_json)
        assert current.memory_version == 2
        assert current.memory_rebuild_status == "idle"
        assert "_last_failure" not in memory
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_scheduled_client_retry_does_not_requeue_after_concurrent_success():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(
                name="Scheduled client",
                client_memory_version=1,
                client_memory_stale=True,
                client_memory_rebuild_status="queued",
                client_memory_json="{}",
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = client.id

        async def succeed_elsewhere_then_fail(*_args, **_kwargs):
            with Session(engine) as concurrent:
                current = concurrent.get(ClientRecord, client_id)
                current.client_memory_version = 2
                current.client_memory_stale = False
                current.client_memory_rebuild_status = "idle"
                current.client_memory_json = json.dumps({"overview": "success"})
                concurrent.add(current)
                concurrent.commit()
            raise RuntimeError("late retryable failure")

        with patch.object(clients_deps, "engine", engine), patch.object(
            clients_deps,
            "_rebuild_client_memory",
            side_effect=succeed_elsewhere_then_fail,
        ), patch.object(
            clients_deps.scheduler_service,
            "is_running",
            return_value=True,
        ), patch.object(
            clients_deps.scheduler_service,
            "add_or_replace_date_job",
        ) as add_job:
            await clients_deps._run_client_memory_rebuild_job(client_id)

        add_job.assert_not_called()
        with Session(engine) as session:
            current = session.get(ClientRecord, client_id)
            memory = json.loads(current.client_memory_json)
        assert current.client_memory_version == 2
        assert current.client_memory_rebuild_status == "idle"
        assert "_last_failure" not in memory
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_project_run_now_persists_failed_owner_after_removed_job():
    project = Project(
        id=41,
        name="Failed project rebuild",
        client="Acme",
        memory_version=1,
        memory_stale=True,
        memory_rebuild_status="queued",
        context_memory_json="{}",
    )
    session = _OwnerSession(project)

    with patch.object(projects_memory.scheduler_service, "remove_job"), patch.object(
        projects_memory,
        "get_project_or_404",
        return_value=project,
    ), patch.object(
        projects_memory,
        "_rebuild_project_memory",
        new=AsyncMock(side_effect=RuntimeError("invalid full memory payload")),
    ), patch.object(projects_memory, "_bust_project"):
        with pytest.raises(RuntimeError, match="invalid full memory payload"):
            await projects_memory.run_project_memory_jobs_now(41, session)

    failure = json.loads(project.context_memory_json)["_last_failure"]
    assert project.memory_rebuild_status == "failed"
    assert project.memory_rebuild_failed_at is not None
    assert failure["stage"] == "rebuild"
    assert failure["message"] == "invalid full memory payload"
    assert failure["retry_count"] == 0
    # The route releases its failed rebuild transaction; the helper then locks
    # the owner and atomically commits both receipt and terminal status.
    assert session.rollback_count == 2
    assert session.commit_count == 1


@pytest.mark.asyncio
async def test_client_run_now_persists_failed_owner_after_removed_job():
    client = ClientRecord(
        id=52,
        name="Failed client rebuild",
        client_memory_version=2,
        client_memory_stale=True,
        client_memory_rebuild_status="queued",
        client_memory_json="{}",
    )
    session = _OwnerSession(client)

    with patch.object(clients_memory.scheduler_service, "remove_job"), patch.object(
        clients_memory,
        "_rebuild_client_memory",
        new=AsyncMock(side_effect=RuntimeError("truncated client memory payload")),
    ), patch.object(clients_memory.clients_cache, "delete"):
        with pytest.raises(RuntimeError, match="truncated client memory payload"):
            await clients_memory.run_client_memory_jobs_now(52, session)

    failure = json.loads(client.client_memory_json)["_last_failure"]
    assert client.client_memory_rebuild_status == "failed"
    assert client.client_memory_rebuild_failed_at is not None
    assert failure["stage"] == "rebuild"
    assert failure["message"] == "truncated client memory payload"
    assert failure["retry_count"] == 0
    assert session.rollback_count == 2
    assert session.commit_count == 1


@pytest.mark.asyncio
async def test_archive_promotion_failure_is_persisted_without_failing_project_patch():
    project = Project(
        id=63,
        name="Archive safely",
        client="Acme",
        status="delivering",
        context_memory_json="{}",
    )
    session = _OwnerSession(project)

    def update_record(_session, _project_id, changes):
        previous_status = project.status
        previous_client = project.client
        for key, value in changes.items():
            setattr(project, key, value)
        return project, previous_status, previous_client

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        side_effect=update_record,
    ), patch.object(projects, "_mark_project_memory_stale"), patch.object(
        projects,
        "_auto_promote_archived_project_to_client_memory",
        new=AsyncMock(side_effect=RuntimeError("provider unavailable")),
    ), patch.object(projects, "_bust_project"):
        result = await projects.update_project(
            63,
            ProjectUpdate(status="archived"),
            session,
            User(id=1, email="owner@example.com", display_name="Owner", is_admin=True),
        )

    promotion = json.loads(project.context_memory_json)["_client_promotion"]
    assert result.status == "archived"
    assert promotion["status"] == "failed"
    assert promotion["attempt_count"] == 1
    assert promotion["message"] == "provider unavailable"
    assert promotion["failed_at"]
    visible_failure = json.loads(project.context_memory_json)["_last_failure"]
    assert visible_failure["category"] == "unknown"
    assert visible_failure["stage"] == "client_promotion"
    # retry_count counts retries already attempted; the initial attempt is 0.
    assert visible_failure["retry_count"] == 0


@pytest.mark.asyncio
async def test_archive_promotion_missing_client_is_recorded_instead_of_silently_skipped():
    project = Project(
        id=631,
        name="Archive without CRM match",
        client="Missing client",
        status="delivering",
        context_memory_json="{}",
    )
    session = _OwnerSession(project)

    def update_record(_session, _project_id, changes):
        previous_status = project.status
        previous_client = project.client
        for key, value in changes.items():
            setattr(project, key, value)
        return project, previous_status, previous_client

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        side_effect=update_record,
    ), patch.object(projects, "_mark_project_memory_stale"), patch.object(
        projects,
        "_auto_promote_archived_project_to_client_memory",
        new=AsyncMock(return_value=False),
    ), patch.object(projects, "_bust_project"):
        result = await projects.update_project(
            631,
            ProjectUpdate(status="archived"),
            session,
            User(id=1, email="owner@example.com", display_name="Owner", is_admin=True),
        )

    promotion = json.loads(project.context_memory_json)["_client_promotion"]
    assert result.status == "archived"
    assert promotion["status"] == "failed"
    assert promotion["attempt_count"] == 1
    assert "no client record" in promotion["message"].lower()
    assert json.loads(project.context_memory_json)["_last_failure"]["category"] == "data"


@pytest.mark.asyncio
async def test_failed_archive_promotion_retries_but_completed_receipt_is_idempotent():
    project = Project(
        id=64,
        name="Retry archive promotion",
        client="Acme",
        status="archived",
        context_memory_json=json.dumps(
            {
                "_client_promotion": {
                    "status": "failed",
                    "attempt_count": 1,
                    "message": "temporary failure",
                }
            }
        ),
    )
    session = _OwnerSession(project)
    promote = AsyncMock(return_value=True)

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        return_value=(project, "archived", "Acme"),
    ), patch.object(projects, "_mark_project_memory_stale"), patch.object(
        projects,
        "_auto_promote_archived_project_to_client_memory",
        new=promote,
    ), patch.object(projects, "_bust_project"):
        await projects.update_project(
            64,
            ProjectUpdate(status="archived"),
            session,
            User(id=1, email="owner@example.com", display_name="Owner", is_admin=True),
        )

    promote.assert_awaited_once()
    assert promote.await_args.kwargs["previous_status"] is None

    project.context_memory_json = json.dumps(
        {
            "_client_promotion": {
                "promoted_at": "2026-08-28T10:00:00",
            }
        }
    )
    promote.reset_mock()

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        return_value=(project, "archived", "Acme"),
    ), patch.object(projects, "_mark_project_memory_stale"), patch.object(
        projects,
        "_auto_promote_archived_project_to_client_memory",
        new=promote,
    ), patch.object(projects, "_bust_project"):
        await projects.update_project(
            64,
            ProjectUpdate(status="archived"),
            session,
            User(id=1, email="owner@example.com", display_name="Owner", is_admin=True),
        )

    promote.assert_not_awaited()


def test_losing_archive_promotion_cannot_overwrite_completed_receipt():
    completed_memory = {
        "_client_promotion": {
            "status": "completed",
            "attempt_count": 1,
            "promoted_at": "2026-08-28T10:00:00",
        }
    }
    project = Project(
        id=641,
        name="Concurrent archive promotion",
        client="Acme",
        status="archived",
        context_memory_json=json.dumps(completed_memory),
    )
    session = _OwnerSession(project)

    projects._record_client_promotion_failure(
        session,
        int(project.id or 0),
        MemoryRebuildConflict("memory version baseline changed"),
    )

    assert json.loads(project.context_memory_json) == completed_memory
    assert session.rollback_count == 1
    assert session.commit_count == 0
    assert session.added == []


def test_create_project_stales_matching_client_memory():
    project = Project(id=642, name="New pilot", client="Acme")
    session = _OwnerSession(project)
    stale_client = Mock()

    with patch.object(projects, "create_project_record", return_value=project), patch.object(
        projects,
        "add_project_member",
    ), patch.object(projects, "save_project_memory"), patch.object(
        projects,
        "mark_client_memory_stale_by_name",
        stale_client,
    ), patch.object(projects, "_schedule_project_memory_rebuild"), patch.object(
        projects.scheduler_service,
        "is_running",
        return_value=False,
    ), patch.object(projects.projects_cache, "delete_prefix"):
        result = projects.create_project(
            ProjectCreate(name="New pilot", client="Acme"),
            session,
            User(id=1, email="owner@example.com", display_name="Owner", is_admin=True),
        )

    assert result is project
    stale_client.assert_called_once_with(
        session,
        "Acme",
        trigger="project_created",
    )


@pytest.mark.asyncio
async def test_project_reassignment_stales_previous_and_current_client_scopes():
    project = Project(
        id=643,
        name="Reassigned pilot",
        client="Old client",
        status="delivering",
    )
    session = _OwnerSession(project)
    mark_project = Mock()
    stale_clients = Mock()

    def update_record(_session, _project_id, changes):
        previous_status = project.status
        previous_client = project.client
        for key, value in changes.items():
            setattr(project, key, value)
        return project, previous_status, previous_client

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        side_effect=update_record,
    ), patch.object(
        projects,
        "_mark_project_memory_stale",
        mark_project,
    ), patch.object(
        projects,
        "mark_client_memory_stale_by_name",
        stale_clients,
    ), patch.object(projects, "_bust_project"):
        result = await projects.update_project(
            643,
            ProjectUpdate(client="New client"),
            session,
            User(id=1, email="owner@example.com", display_name="Owner", is_admin=True),
        )

    assert result.client == "New client"
    mark_project.assert_called_once_with(
        session,
        643,
        trigger="project_profile_project_reassigned_changed",
    )
    assert stale_clients.call_count == 2
    stale_clients.assert_any_call(
        session,
        "Old client",
        trigger="project_reassigned",
    )
    stale_clients.assert_any_call(
        session,
        "New client",
        trigger="project_reassigned",
    )


@pytest.mark.asyncio
async def test_manual_promotion_rejects_project_client_reassignment_during_provider():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            project = Project(
                name="Pilot",
                client="Acme",
                context_memory_json=json.dumps({"project_brief": "ERP pilot"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            locked_entities = []
            original_exec = session.exec

            def track_locked_entities(statement, *args, **kwargs):
                if getattr(statement, "_for_update_arg", None) is not None:
                    for description in getattr(statement, "column_descriptions", []):
                        entity = description.get("entity")
                        if entity in {Project, ClientRecord}:
                            locked_entities.append(entity)
                            break
                return original_exec(statement, *args, **kwargs)

            async def reassign_project(**_kwargs):
                current = session.get(Project, int(project.id or 0))
                current.client = "Other client"
                session.add(current)
                session.commit()
                return "{}"

            with patch.object(
                clients_memory,
                "_current_complete_with_selected_model",
                return_value=reassign_project,
            ), patch.object(session, "exec", side_effect=track_locked_entities):
                with pytest.raises(HTTPException) as exc_info:
                    await clients_memory.promote_project_memory_to_client(
                        int(client.id or 0),
                        PromoteProjectMemoryRequest(project_id=int(project.id or 0)),
                        session,
                    )
            assert exc_info.value.status_code == 409
            assert "ownership changed" in str(exc_info.value.detail).lower()
            assert locked_entities[:2] == [Project, ClientRecord]
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_manual_promotion_refreshes_client_renamed_between_owner_locks():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            project = Project(
                name="Interleaved pilot",
                client="Acme",
                context_memory_json=json.dumps({"project_brief": "ERP pilot"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            client_id = int(client.id)
            project_id = int(project.id)
            original_exec = session.exec
            renamed = False

            def rename_client_after_project_lock(statement, *args, **kwargs):
                nonlocal renamed
                result = original_exec(statement, *args, **kwargs)
                if not renamed and getattr(statement, "_for_update_arg", None) is not None:
                    entity = statement.column_descriptions[0].get("entity")
                    if entity is Project:
                        renamed = True
                        with Session(engine) as concurrent:
                            current = concurrent.get(ClientRecord, client_id)
                            assert current is not None
                            current.name = "Renamed client"
                            concurrent.add(current)
                            concurrent.commit()
                return result

            async def provider(**_kwargs):
                return "{}"

            with patch.object(
                clients_memory,
                "_current_complete_with_selected_model",
                return_value=provider,
            ), patch.object(
                session,
                "exec",
                side_effect=rename_client_after_project_lock,
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await clients_memory.promote_project_memory_to_client(
                        client_id,
                        PromoteProjectMemoryRequest(project_id=project_id),
                        session,
                    )

            assert renamed is True
            assert exc_info.value.status_code == 409
            assert "ownership changed" in str(exc_info.value.detail).lower()
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_auto_promotion_rejects_project_client_reassignment_during_provider():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            project = Project(
                name="Pilot",
                client="Acme",
                status="archived",
                context_memory_json=json.dumps({"project_brief": "ERP pilot"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            locked_entities = []
            original_exec = session.exec

            def track_locked_entities(statement, *args, **kwargs):
                if getattr(statement, "_for_update_arg", None) is not None:
                    for description in getattr(statement, "column_descriptions", []):
                        entity = description.get("entity")
                        if entity in {Project, ClientRecord}:
                            locked_entities.append(entity)
                            break
                return original_exec(statement, *args, **kwargs)

            async def reassign_project(**_kwargs):
                current = session.get(Project, int(project.id or 0))
                current.client = "Other client"
                session.add(current)
                session.commit()
                return "{}"

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=reassign_project,
            ), patch.object(session, "exec", side_effect=track_locked_entities):
                with pytest.raises(MemoryRebuildConflict, match="ownership changed"):
                    await projects_deps._auto_promote_archived_project_to_client_memory(
                        session,
                        int(project.id or 0),
                        previous_status="delivering",
                    )
            assert locked_entities[:2] == [Project, ClientRecord]
    finally:
        engine.dispose()


def test_manual_stakeholder_crud_locks_client_before_child() -> None:
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Lock-order client")
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = int(client.id)
            original_exec = session.exec
            locked_entities = []

            def track_locked_entities(statement, *args, **kwargs):
                if getattr(statement, "_for_update_arg", None) is not None:
                    entity = statement.column_descriptions[0].get("entity")
                    if entity in {ClientRecord, ClientStakeholder}:
                        locked_entities.append(entity)
                return original_exec(statement, *args, **kwargs)

            with patch.object(
                session,
                "exec",
                side_effect=track_locked_entities,
            ), patch.object(
                clients_stakeholders,
                "_mark_client_memory_stale",
            ), patch.object(
                clients_stakeholders,
                "mark_project_memories_stale_by_client_name",
            ):
                created = clients_stakeholders.create_client_stakeholder(
                    client_id,
                    clients_stakeholders.ClientStakeholderCreate(
                        name="Alice",
                        role="Sponsor",
                    ),
                    session,
                )
                stakeholder_id = int(created.id)
                assert locked_entities == [ClientRecord]

                locked_entities.clear()
                clients_stakeholders.update_client_stakeholder(
                    client_id,
                    stakeholder_id,
                    clients_stakeholders.ClientStakeholderUpdate(role="Chair"),
                    session,
                )
                assert locked_entities == [ClientRecord, ClientStakeholder]
    finally:
        engine.dispose()


def test_stakeholder_delete_respects_history_foreign_key_order() -> None:
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            client = ClientRecord(name="FK client")
            setup.add(client)
            setup.commit()
            setup.refresh(client)
            stakeholder = ClientStakeholder(
                client_id=int(client.id),
                name="Alice",
                role="Sponsor",
            )
            setup.add(stakeholder)
            setup.commit()
            setup.refresh(stakeholder)
            history = ClientStakeholderHistory(
                stakeholder_id=int(stakeholder.id),
                client_id=int(client.id),
                field_name="role",
                old_value="CEO",
                new_value="Chair",
                trigger="manual",
            )
            setup.add(history)
            setup.commit()
            setup.refresh(history)
            client_id = int(client.id)
            stakeholder_id = int(stakeholder.id)
            history_id = int(history.id)

        with Session(engine) as session, patch.object(
            clients_stakeholders,
            "_mark_client_memory_stale",
        ), patch.object(
            clients_stakeholders,
            "mark_project_memories_stale_by_client_name",
        ):
            clients_stakeholders.delete_client_stakeholder(
                client_id,
                stakeholder_id,
                session,
            )

        with Session(engine) as verify:
            assert verify.get(ClientStakeholderHistory, history_id) is None
            assert verify.get(ClientStakeholder, stakeholder_id) is None
            assert verify.get(ClientRecord, client_id) is not None
    finally:
        engine.dispose()


def test_client_delete_respects_owned_record_foreign_key_order() -> None:
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            client = ClientRecord(name="FK graph client")
            setup.add(client)
            setup.commit()
            setup.refresh(client)
            stakeholder = ClientStakeholder(
                client_id=int(client.id),
                name="Alice",
                role="Sponsor",
            )
            setup.add(stakeholder)
            setup.commit()
            setup.refresh(stakeholder)
            history = ClientStakeholderHistory(
                stakeholder_id=int(stakeholder.id),
                client_id=int(client.id),
                field_name="role",
                old_value="CEO",
                new_value="Chair",
                trigger="manual",
            )
            setup.add(history)
            setup.commit()
            setup.refresh(history)
            client_id = int(client.id)
            stakeholder_id = int(stakeholder.id)
            history_id = int(history.id)

        with Session(engine) as session, patch.object(
            clients,
            "mark_project_memories_stale_by_client_name",
        ):
            clients.delete_client(client_id, session)

        with Session(engine) as verify:
            assert verify.get(ClientStakeholderHistory, history_id) is None
            assert verify.get(ClientStakeholder, stakeholder_id) is None
            assert verify.get(ClientRecord, client_id) is None
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_stakeholder_analysis_does_not_overwrite_concurrent_manual_update(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'stakeholder-analysis.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme", notes="Strategic account")
            session.add(client)
            session.commit()
            session.refresh(client)
            stakeholder = ClientStakeholder(
                client_id=int(client.id or 0),
                name="Alex",
                role="Sponsor",
                note="Original note",
            )
            project = Project(name="Stakeholder source", client=" acme ")
            session.add(stakeholder)
            session.add(project)
            session.commit()
            session.refresh(stakeholder)
            client_id = int(client.id or 0)
            stakeholder_id = int(stakeholder.id or 0)
            locked_entities = []
            original_exec = session.exec

            def track_locked_entities(statement, *args, **kwargs):
                if getattr(statement, "_for_update_arg", None) is not None:
                    for description in getattr(statement, "column_descriptions", []):
                        entity = description.get("entity")
                        if entity in {Project, ClientRecord, ClientStakeholder}:
                            locked_entities.append(entity)
                            break
                return original_exec(statement, *args, **kwargs)

            async def update_manually_during_provider(**_kwargs):
                with Session(engine) as concurrent_session:
                    current = concurrent_session.get(ClientStakeholder, stakeholder_id)
                    assert current is not None
                    current.note = "Manual update wins"
                    current.updated_at = utc_now_naive()
                    concurrent_session.add(current)
                    concurrent_session.commit()
                return json.dumps({"note": "Stale AI overwrite"})

            with patch.object(
                clients_stakeholders,
                "complete_with_selected_model",
                new=update_manually_during_provider,
            ), patch.object(session, "exec", side_effect=track_locked_entities):
                with pytest.raises(HTTPException) as exc_info:
                    await clients_stakeholders.analyze_client_stakeholder(
                        client_id,
                        stakeholder_id,
                        None,
                        session,
                    )

            assert exc_info.value.status_code == 409
            assert "changed during" in str(exc_info.value.detail).lower()
            assert locked_entities[:3] == [Project, ClientRecord, ClientStakeholder]

        with Session(engine) as verify_session:
            current = verify_session.get(ClientStakeholder, stakeholder_id)
            assert current is not None
            assert current.note == "Manual update wins"
            ai_history = verify_session.exec(
                select(ClientStakeholderHistory).where(
                    ClientStakeholderHistory.stakeholder_id == stakeholder_id,
                    ClientStakeholderHistory.trigger == "ai_analyze",
                )
            ).all()
            assert ai_history == []
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_client_summary_drops_output_when_memory_changes_during_provider(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'client-summary.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            client = ClientRecord(
                name="Acme",
                client_memory_json=json.dumps({"client_profile": "Before"}),
                client_memory_version=1,
                client_memory_stale=False,
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = int(client.id or 0)
            memory = get_client_memory_payload(client)

            async def change_memory_during_provider(**_kwargs):
                with Session(engine) as concurrent_session:
                    current = concurrent_session.get(ClientRecord, client_id)
                    assert current is not None
                    current.client_memory_json = json.dumps({"client_profile": "After"})
                    current.client_memory_version = 2
                    current.client_memory_updated_at = utc_now_naive()
                    concurrent_session.add(current)
                    concurrent_session.commit()
                return "Stale client summary"

            with patch.object(
                clients_deps,
                "_current_complete_with_selected_model",
                return_value=change_memory_during_provider,
            ):
                with pytest.raises(MemoryRebuildConflict, match="client memory changed"):
                    await clients_deps._generate_client_memory_summary_cache(
                        session,
                        client,
                        memory,
                        "overview",
                        force_refresh=True,
                    )

        with Session(engine) as verify_session:
            summaries = verify_session.exec(select(ClientMemorySummary)).all()
            assert summaries == []
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_project_summary_drops_output_when_memory_changes_during_provider(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'project-summary.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project = Project(
                name="Pilot",
                client="Acme",
                context_memory_json=json.dumps({"project_brief": "Before"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id or 0)
            memory = get_project_memory_payload(project)

            async def change_memory_during_provider(**_kwargs):
                with Session(engine) as concurrent_session:
                    current = concurrent_session.get(Project, project_id)
                    assert current is not None
                    current.context_memory_json = json.dumps({"project_brief": "After"})
                    current.memory_version = 2
                    current.memory_updated_at = utc_now_naive()
                    current.updated_at = utc_now_naive()
                    concurrent_session.add(current)
                    concurrent_session.commit()
                return "Stale project summary"

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=change_memory_during_provider,
            ):
                with pytest.raises(MemoryRebuildConflict, match="project memory changed"):
                    await projects_deps._generate_memory_summary_cache(
                        session,
                        project,
                        memory,
                        "overview",
                    )

        with Session(engine) as verify_session:
            summaries = verify_session.exec(select(ProjectMemorySummary)).all()
            assert summaries == []
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_non_stream_project_summary_returns_conflict_for_changed_memory(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'project-summary-endpoint.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            project = Project(
                name="Endpoint pilot",
                client="Acme",
                context_memory_json=json.dumps({"project_brief": "Before"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id or 0)

            async def change_memory_during_provider(**_kwargs):
                with Session(engine) as concurrent_session:
                    current = concurrent_session.get(Project, project_id)
                    assert current is not None
                    current.context_memory_json = json.dumps({"project_brief": "After"})
                    current.memory_version = 2
                    current.memory_updated_at = utc_now_naive()
                    current.updated_at = utc_now_naive()
                    concurrent_session.add(current)
                    concurrent_session.commit()
                return "Stale endpoint summary"

            with patch.object(
                projects_memory,
                "complete_with_selected_model",
                new=change_memory_during_provider,
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await projects_memory.summarize_project_memory(
                        project_id,
                        ProjectMemorySummarizeRequest(
                            rebuild_if_stale=False,
                            stream=False,
                            force_refresh=True,
                        ),
                        session,
                    )

            assert exc_info.value.status_code == 409

        with Session(engine) as verify_session:
            summaries = verify_session.exec(select(ProjectMemorySummary)).all()
            assert summaries == []
    finally:
        engine.dispose()
