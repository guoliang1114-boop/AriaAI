from __future__ import annotations

import json
from pathlib import Path
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
    MemoryCandidate,
    Milestone,
    Project,
    ProjectMember,
    ProjectPayment,
    ProjectProgressUpdate,
    ProjectMemoryFact,
    ProjectMemorySnapshot,
    ProjectMemorySlot,
    ProjectMemorySummary,
    ProjectFile,
    ProjectTodo,
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
                trusted_system=True,
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
                trusted_system=True,
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
                        trusted_system=True,
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
async def test_project_run_now_keeps_scheduler_job_when_provider_fails():
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
    actor = User(
        id=1,
        email="project-run-now-owner@example.com",
        display_name="Owner",
        password_hash="h",
    )

    with patch.object(projects_memory.scheduler_service, "remove_job") as remove_job, patch.object(
        projects_memory,
        "_require_project_memory_write",
        return_value=1,
    ), patch.object(
        projects_memory,
        "get_project_or_404",
        return_value=project,
    ), patch.object(
        projects_memory,
        "_rebuild_project_memory",
        new=AsyncMock(side_effect=RuntimeError("invalid full memory payload")),
    ), patch.object(projects_memory, "_bust_project"):
        with pytest.raises(RuntimeError, match="invalid full memory payload"):
            await projects_memory.run_project_memory_jobs_now(41, session, actor)

    remove_job.assert_not_called()
    assert project.memory_rebuild_status == "queued"
    assert project.memory_rebuild_failed_at is None
    assert "_last_failure" not in json.loads(project.context_memory_json)
    assert session.commit_count == 0


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
    actor = User(
        id=1,
        email="client-run-now-admin@example.com",
        display_name="Admin",
        password_hash="h",
        is_admin=True,
    )

    with patch.object(clients_memory.scheduler_service, "remove_job"), patch.object(
        clients_memory,
        "require_client_access",
        return_value=client,
    ), patch.object(
        clients_memory,
        "_lock_client_write",
        return_value=client,
    ), patch.object(
        clients_memory,
        "_rebuild_client_memory",
        new=AsyncMock(side_effect=RuntimeError("truncated client memory payload")),
    ), patch.object(clients_memory.clients_cache, "delete"):
        with pytest.raises(RuntimeError, match="truncated client memory payload"):
            await clients_memory.run_client_memory_jobs_now(52, session, actor)

    failure = json.loads(client.client_memory_json)["_last_failure"]
    native_failure = json.loads(client.client_memory_last_failure_json)
    assert client.client_memory_rebuild_status == "failed"
    assert client.client_memory_rebuild_failed_at is not None
    assert failure["stage"] == "rebuild"
    assert failure["message"] == "truncated client memory payload"
    assert failure["retry_count"] == 0
    assert native_failure == failure
    assert session.rollback_count == 2
    assert session.commit_count == 1


@pytest.mark.asyncio
async def test_client_run_now_drops_failure_receipt_after_actor_deactivation():
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            actor = User(
                email="client-run-now-revoked@example.com",
                display_name="Revoked Admin",
                password_hash="h",
                is_admin=True,
            )
            client = ClientRecord(
                name="Protected failed client rebuild",
                client_memory_version=2,
                client_memory_stale=True,
                client_memory_rebuild_status="queued",
                client_memory_json="{}",
            )
            setup.add(actor)
            setup.add(client)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(client)
            actor_id = int(actor.id)
            client_id = int(client.id)

        with Session(engine) as session:
            actor = session.get(User, actor_id)
            assert actor is not None

            async def deactivate_then_fail(*_args, **_kwargs):
                current_actor = session.get(User, actor_id)
                assert current_actor is not None
                current_actor.is_active = False
                session.add(current_actor)
                session.commit()
                raise RuntimeError("provider failed after account deactivation")

            with patch.object(
                clients_memory.scheduler_service,
                "remove_job",
            ), patch.object(
                clients_memory,
                "_rebuild_client_memory",
                new=deactivate_then_fail,
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await clients_memory.run_client_memory_jobs_now(
                        client_id,
                        session,
                        actor,
                    )

            assert exc_info.value.status_code == 403

        with Session(engine) as verify:
            saved = verify.get(ClientRecord, client_id)
            assert saved is not None
            assert saved.client_memory_rebuild_status == "queued"
            assert saved.client_memory_rebuild_failed_at is None
            assert "_last_failure" not in json.loads(saved.client_memory_json or "{}")
    finally:
        engine.dispose()


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

    def update_record(_session, _project_id, changes, *, actor_user_id):
        assert actor_user_id == 1
        previous_status = project.status
        previous_client = project.client
        previous_client_id = project.client_id
        for key, value in changes.items():
            setattr(project, key, value)
        return project, previous_status, previous_client, previous_client_id

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        side_effect=update_record,
    ), patch.object(projects, "_mark_project_memory_stale"), patch.object(
        projects,
        "_auto_promote_archived_project_to_client_memory",
        new=AsyncMock(side_effect=RuntimeError("provider unavailable")),
    ), patch.object(
        projects,
        "lock_and_require_project_write",
        return_value=(
            project,
            User(id=1, email="owner@example.com", is_admin=True),
        ),
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
    native_promotion = json.loads(project.client_memory_promotion_json)
    native_failure = json.loads(project.memory_last_failure_json)
    assert visible_failure["category"] == "unknown"
    assert visible_failure["stage"] == "client_promotion"
    # retry_count counts retries already attempted; the initial attempt is 0.
    assert visible_failure["retry_count"] == 0
    assert native_promotion == promotion
    assert native_failure == visible_failure


@pytest.mark.asyncio
async def test_archive_promotion_final_authorization_failure_propagates_without_receipt():
    project = Project(
        id=632,
        name="Archive permission revoked",
        client="Acme",
        status="delivering",
        context_memory_json="{}",
    )
    session = _OwnerSession(project)
    actor = User(
        id=1,
        email="revoked-owner@example.com",
        display_name="Revoked owner",
    )

    def update_record(_session, _project_id, changes, *, actor_user_id):
        assert actor_user_id == 1
        previous_status = project.status
        previous_client = project.client
        previous_client_id = project.client_id
        for key, value in changes.items():
            setattr(project, key, value)
        return project, previous_status, previous_client, previous_client_id

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        side_effect=update_record,
    ), patch.object(projects, "_mark_project_memory_stale"), patch.object(
        projects,
        "_auto_promote_archived_project_to_client_memory",
        new=AsyncMock(side_effect=HTTPException(403, "Source project write permission required")),
    ), patch.object(projects, "_record_client_promotion_failure") as record_failure, patch.object(
        projects,
        "_bust_project",
    ):
        with pytest.raises(HTTPException) as exc_info:
            await projects.update_project(
                632,
                ProjectUpdate(status="archived"),
                session,
                actor,
            )

    assert exc_info.value.status_code == 403
    record_failure.assert_not_called()
    assert session.rollback_count == 1
    assert "_client_promotion" not in json.loads(project.context_memory_json)


@pytest.mark.parametrize(
    ("final_actor_state", "expected_recorded"),
    [
        ("source_membership_revoked", False),
        ("actor_inactive", False),
        ("still_authorized", True),
    ],
)
def test_provider_failure_receipt_rechecks_exact_source_authorization(
    final_actor_state: str,
    expected_recorded: bool,
):
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            actor = User(
                email=f"provider-failure-{final_actor_state}@example.com",
                password_hash="x",
            )
            project = Project(
                name=f"Provider failure {final_actor_state}",
                client="Failure receipt client",
                status="archived",
                context_memory_json="{}",
            )
            setup.add(actor)
            setup.add(project)
            setup.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="owner",
            )
            setup.add(membership)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(project)
            setup.refresh(membership)
            actor_id = int(actor.id)
            project_id = int(project.id)
            membership_id = int(membership.id)

        # This state change represents revocation/deactivation while the model
        # provider was running and before its ordinary failure was handled.
        with Session(engine) as revoke:
            if final_actor_state == "source_membership_revoked":
                membership = revoke.get(ProjectMember, membership_id)
                revoke.delete(membership)
            elif final_actor_state == "actor_inactive":
                actor = revoke.get(User, actor_id)
                actor.is_active = False
                revoke.add(actor)
            revoke.commit()

        with Session(engine) as recorder:
            recorded = projects._record_client_promotion_failure(
                recorder,
                project_id,
                RuntimeError("provider unavailable"),
                actor_user_id=actor_id,
            )

        assert recorded is expected_recorded
        with Session(engine) as verify:
            saved = verify.get(Project, project_id)
            memory = json.loads(saved.context_memory_json)
        if expected_recorded:
            assert memory["_client_promotion"]["status"] == "failed"
            assert memory["_client_promotion"]["message"] == "provider unavailable"
            assert memory["_last_failure"]["stage"] == "client_promotion"
            assert json.loads(saved.client_memory_promotion_json) == memory["_client_promotion"]
            assert json.loads(saved.memory_last_failure_json) == memory["_last_failure"]
        else:
            assert "_client_promotion" not in memory
            assert "_last_failure" not in memory
            assert saved.client_memory_promotion_json == ""
            assert saved.memory_last_failure_json == ""
    finally:
        engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "final_actor_state",
    ["source_membership_revoked", "actor_inactive"],
)
async def test_provider_failure_during_revocation_keeps_patch_without_receipt(
    final_actor_state: str,
):
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            actor = User(
                email=f"provider-catch-{final_actor_state}@example.com",
                password_hash="x",
            )
            project = Project(
                name=f"Provider catch {final_actor_state}",
                client="Best effort client",
                status="delivering",
                context_memory_json="{}",
            )
            setup.add(actor)
            setup.add(project)
            setup.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="owner",
            )
            setup.add(membership)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(project)
            setup.refresh(membership)
            actor_id = int(actor.id)
            project_id = int(project.id)
            membership_id = int(membership.id)

        with Session(engine) as session:
            actor = session.get(User, actor_id)

            async def fail_after_final_state_change(*_args, **_kwargs):
                if final_actor_state == "source_membership_revoked":
                    membership = session.get(ProjectMember, membership_id)
                    session.delete(membership)
                else:
                    current_actor = session.get(User, actor_id)
                    current_actor.is_active = False
                    session.add(current_actor)
                session.commit()
                raise RuntimeError("provider unavailable after authorization changed")

            with patch.object(projects, "require_project_access"), patch.object(
                projects,
                "_mark_project_memory_stale",
            ), patch.object(
                projects,
                "_auto_promote_archived_project_to_client_memory",
                new=fail_after_final_state_change,
            ), patch.object(projects, "_bust_project"):
                result = await projects.update_project(
                    project_id,
                    ProjectUpdate(status="archived"),
                    session,
                    actor,
                )

            assert result.status == "archived"

        with Session(engine) as verify:
            saved = verify.get(Project, project_id)
            memory = json.loads(saved.context_memory_json)
            assert saved.status == "archived"
            assert "_client_promotion" not in memory
            assert "_last_failure" not in memory
    finally:
        engine.dispose()


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

    def update_record(_session, _project_id, changes, *, actor_user_id):
        assert actor_user_id == 1
        previous_status = project.status
        previous_client = project.client
        previous_client_id = project.client_id
        for key, value in changes.items():
            setattr(project, key, value)
        return project, previous_status, previous_client, previous_client_id

    with patch.object(projects, "require_project_access"), patch.object(
        projects,
        "update_project_record",
        side_effect=update_record,
    ), patch.object(projects, "_mark_project_memory_stale"), patch.object(
        projects,
        "_auto_promote_archived_project_to_client_memory",
        new=AsyncMock(return_value=False),
    ), patch.object(
        projects,
        "lock_and_require_project_write",
        return_value=(
            project,
            User(id=1, email="owner@example.com", is_admin=True),
        ),
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
        return_value=(project, "archived", "Acme", None),
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
        return_value=(project, "archived", "Acme", None),
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
        actor_user_id=1,
    )

    assert json.loads(project.context_memory_json) == completed_memory
    assert session.rollback_count == 1
    assert session.commit_count == 0
    assert session.added == []


def test_create_project_stales_matching_client_memory():
    project = Project(id=642, name="New pilot", client="Acme", client_id=72)
    session = _OwnerSession(project)
    stale_client = Mock()

    with patch.object(projects, "create_project_record", return_value=project), patch.object(
        projects, "save_project_memory"
    ), patch.object(
        projects,
        "mark_client_memory_stale",
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
        72,
        trigger="project_created",
    )


@pytest.mark.asyncio
async def test_project_reassignment_stales_previous_and_current_client_scopes():
    project = Project(
        id=643,
        name="Reassigned pilot",
        client="Old client",
        client_id=73,
        status="delivering",
    )
    session = _OwnerSession(project)
    mark_project = Mock()
    stale_clients = Mock()

    def update_record(_session, _project_id, changes, *, actor_user_id):
        assert actor_user_id == 1
        previous_status = project.status
        previous_client = project.client
        previous_client_id = project.client_id
        for key, value in changes.items():
            setattr(project, key, value)
        return project, previous_status, previous_client, previous_client_id

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
        "mark_client_memory_stale",
        stale_clients,
    ), patch.object(projects, "_bust_project"):
        result = await projects.update_project(
            643,
            ProjectUpdate(client="New client", client_id=74),
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
        73,
        trigger="project_reassigned",
    )
    stale_clients.assert_any_call(
        session,
        74,
        trigger="project_reassigned",
    )


@pytest.mark.asyncio
async def test_manual_promotion_rejects_project_client_reassignment_during_provider():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(
                email="manual-promotion-admin@example.com",
                password_hash="h",
                is_admin=True,
            )
            session.add(actor)
            session.flush()
            client = ClientRecord(
                name="Acme",
                created_by_user_id=int(actor.id),
            )
            replacement_client = ClientRecord(
                name="Other client",
                created_by_user_id=int(actor.id),
            )
            session.add(client)
            session.add(replacement_client)
            session.flush()
            project = Project(
                name="Pilot",
                client="Acme",
                client_id=int(client.id),
                context_memory_json=json.dumps({"project_brief": "ERP pilot"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(project)
            session.commit()
            session.refresh(actor)
            session.refresh(client)
            session.refresh(replacement_client)
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
                current.client = replacement_client.name
                current.client_id = replacement_client.id
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
                        actor,
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
            actor = User(
                email="manual-promotion-rename-admin@example.com",
                password_hash="h",
                is_admin=True,
            )
            session.add(actor)
            session.flush()
            client = ClientRecord(
                name="Acme",
                created_by_user_id=int(actor.id),
            )
            session.add(client)
            session.flush()
            project = Project(
                name="Interleaved pilot",
                client="Acme",
                client_id=int(client.id),
                context_memory_json=json.dumps({"project_brief": "ERP pilot"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(project)
            session.commit()
            session.refresh(actor)
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
                        actor,
                    )

            assert renamed is True
            assert exc_info.value.status_code == 409
            assert "client changed" in str(exc_info.value.detail).lower()
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_auto_promotion_rejects_project_client_reassignment_during_provider():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(
                email="promotion-reassign-owner@example.com",
                password_hash="x",
            )
            session.add(actor)
            session.flush()
            client = ClientRecord(
                name="Acme",
                created_by_user_id=int(actor.id),
            )
            session.add(client)
            session.flush()
            project = Project(
                name="Pilot",
                client="Acme",
                client_id=int(client.id),
                status="archived",
                context_memory_json=json.dumps({"project_brief": "ERP pilot"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(actor.id),
                    role="owner",
                )
            )
            session.commit()
            session.refresh(actor)
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
                current.client_id = None
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
                        actor=actor,
                        previous_status="delivering",
                    )
            assert locked_entities[:2] == [Project, ClientRecord]
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_auto_promotion_rechecks_client_write_after_provider_wait():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(
                email="promotion-revoked-editor@example.com",
                password_hash="x",
            )
            client_owner = User(
                email="promotion-client-owner@example.com",
                password_hash="x",
            )
            session.add(actor)
            session.add(client_owner)
            session.flush()
            client = ClientRecord(
                name="Permission client",
                created_by_user_id=int(client_owner.id),
            )
            session.add(client)
            session.flush()
            project = Project(
                name="Permission pilot",
                client=client.name,
                client_id=int(client.id),
                status="archived",
                context_memory_json=json.dumps({"project_brief": "Protected pilot"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(project)
            other_project = Project(
                name="Other writable project",
                client=client.name,
                client_id=int(client.id),
                status="delivering",
            )
            session.add(other_project)
            session.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="editor",
            )
            session.add(membership)
            session.add(
                ProjectMember(
                    project_id=int(other_project.id),
                    user_id=int(actor.id),
                    role="editor",
                )
            )
            session.commit()
            session.refresh(actor)
            session.refresh(client)
            session.refresh(project)
            session.refresh(membership)
            membership_id = int(membership.id)

            async def revoke_client_write(**_kwargs):
                current = session.get(ProjectMember, membership_id)
                session.delete(current)
                session.commit()
                return "{}"

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=revoke_client_write,
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await projects_deps._auto_promote_archived_project_to_client_memory(
                        session,
                        int(project.id),
                        actor=actor,
                        previous_status="delivering",
                    )

            assert exc_info.value.status_code == 403
            assert "source project" in str(exc_info.value.detail).lower()
            session.rollback()
            session.expire_all()
            saved_client = session.get(ClientRecord, int(client.id))
            assert int(saved_client.client_memory_version or 0) == 0
    finally:
        engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "final_actor_state",
    ["source_membership_revoked", "actor_inactive"],
)
async def test_stale_archive_rebuild_drops_first_provider_result_after_authorization_change(
    final_actor_state: str,
):
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(
                email=f"stale-archive-{final_actor_state}@example.com",
                password_hash="x",
            )
            client_owner = User(
                email=f"stale-archive-client-owner-{final_actor_state}@example.com",
                password_hash="x",
            )
            session.add(actor)
            session.add(client_owner)
            session.flush()
            original_client_memory = {
                "client_profile": "Original client memory",
                "memory_version": 4,
            }
            client = ClientRecord(
                name=f"Stale archive client {final_actor_state}",
                created_by_user_id=int(client_owner.id),
                client_memory_json=json.dumps(original_client_memory),
                client_memory_version=4,
                client_memory_stale=False,
            )
            session.add(client)
            session.flush()
            original_project_memory = {"project_brief": "Original project memory"}
            source_project = Project(
                name=f"Stale archive source {final_actor_state}",
                client=client.name,
                client_id=int(client.id),
                status="archived",
                context_memory_json=json.dumps(original_project_memory),
                memory_version=0,
                memory_stale=True,
            )
            other_project = Project(
                name=f"Other writable project {final_actor_state}",
                client=client.name,
                client_id=int(client.id),
                status="delivering",
            )
            session.add(source_project)
            session.add(other_project)
            session.flush()
            source_membership = ProjectMember(
                project_id=int(source_project.id),
                user_id=int(actor.id),
                role="owner",
            )
            session.add(source_membership)
            session.add(
                ProjectMember(
                    project_id=int(other_project.id),
                    user_id=int(actor.id),
                    role="editor",
                )
            )
            session.commit()
            session.refresh(actor)
            session.refresh(source_project)
            session.refresh(source_membership)
            actor_id = int(actor.id)
            source_project_id = int(source_project.id)
            source_membership_id = int(source_membership.id)
            client_id = int(client.id)
            provider_payload = projects_deps._default_project_memory(source_project)
            provider_payload["project_brief"] = "Unauthorized provider overwrite"
            provider_calls = 0

            async def change_authorization_during_first_provider(**_kwargs):
                nonlocal provider_calls
                provider_calls += 1
                if final_actor_state == "source_membership_revoked":
                    current_membership = session.get(ProjectMember, source_membership_id)
                    assert current_membership is not None
                    session.delete(current_membership)
                else:
                    current_actor = session.get(User, actor_id)
                    assert current_actor is not None
                    current_actor.is_active = False
                    session.add(current_actor)
                session.commit()
                return json.dumps(provider_payload)

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=change_authorization_during_first_provider,
            ):
                with pytest.raises(HTTPException) as exc_info:
                    await projects_deps._auto_promote_archived_project_to_client_memory(
                        session,
                        source_project_id,
                        actor=actor,
                        previous_status="delivering",
                    )

            assert exc_info.value.status_code == 403
            assert provider_calls == 1

        with Session(engine) as verify:
            saved_project = verify.get(Project, source_project_id)
            saved_client = verify.get(ClientRecord, client_id)
            project_memory = json.loads(saved_project.context_memory_json)
            client_memory = json.loads(saved_client.client_memory_json)
            snapshots = verify.exec(
                select(ProjectMemorySnapshot).where(
                    ProjectMemorySnapshot.project_id == source_project_id
                )
            ).all()
            assert saved_project.memory_version == 0
            assert saved_project.memory_stale is True
            assert project_memory == original_project_memory
            assert "_last_failure" not in project_memory
            assert "_client_promotion" not in project_memory
            assert snapshots == []
            assert saved_client.client_memory_version == 4
            assert saved_client.client_memory_stale is False
            assert client_memory == original_client_memory
    finally:
        engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "final_actor_state",
    ["source_membership_revoked", "actor_inactive"],
)
async def test_stale_archive_rebuild_provider_failure_after_authorization_change_has_no_receipt(
    final_actor_state: str,
):
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(
                email=f"stale-archive-failure-{final_actor_state}@example.com",
                password_hash="x",
            )
            session.add(actor)
            session.flush()
            client = ClientRecord(
                name=f"Stale archive failure client {final_actor_state}",
                created_by_user_id=int(actor.id),
                client_memory_json=json.dumps({"client_profile": "Original client"}),
                client_memory_version=2,
                client_memory_stale=False,
            )
            session.add(client)
            session.flush()
            project = Project(
                name=f"Stale archive failure source {final_actor_state}",
                client=client.name,
                client_id=int(client.id),
                status="archived",
                context_memory_json=json.dumps({"project_brief": "Original project"}),
                memory_version=0,
                memory_stale=True,
            )
            session.add(project)
            session.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="owner",
            )
            session.add(membership)
            session.commit()
            session.refresh(actor)
            session.refresh(project)
            session.refresh(membership)
            actor_id = int(actor.id)
            project_id = int(project.id)
            client_id = int(client.id)
            membership_id = int(membership.id)

            async def revoke_then_fail(**_kwargs):
                if final_actor_state == "source_membership_revoked":
                    current_membership = session.get(ProjectMember, membership_id)
                    assert current_membership is not None
                    session.delete(current_membership)
                else:
                    current_actor = session.get(User, actor_id)
                    assert current_actor is not None
                    current_actor.is_active = False
                    session.add(current_actor)
                session.commit()
                raise RuntimeError("first rebuild provider failed")

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=revoke_then_fail,
            ):
                with pytest.raises(RuntimeError, match="first rebuild provider failed"):
                    await projects_deps._auto_promote_archived_project_to_client_memory(
                        session,
                        project_id,
                        actor=actor,
                        previous_status="delivering",
                    )

        with Session(engine) as verify:
            saved_project = verify.get(Project, project_id)
            saved_client = verify.get(ClientRecord, client_id)
            project_memory = json.loads(saved_project.context_memory_json)
            client_memory = json.loads(saved_client.client_memory_json)
            assert saved_project.memory_version == 0
            assert project_memory == {"project_brief": "Original project"}
            assert "_last_failure" not in project_memory
            assert "_client_promotion" not in project_memory
            assert saved_client.client_memory_version == 2
            assert client_memory == {"client_profile": "Original client"}
    finally:
        engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("final_rebuild_status", ["idle", "queued"])
async def test_project_rebuild_drops_provider_result_after_cancel_generation_change(
    final_rebuild_status: str,
):
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(
                email=f"project-rebuild-cancel-{final_rebuild_status}@example.com",
                password_hash="x",
            )
            project = Project(
                name=f"Cancelled rebuild {final_rebuild_status}",
                client="Cancel client",
                context_memory_json=json.dumps({"project_brief": "Original"}),
                memory_version=0,
                memory_stale=True,
                memory_rebuild_status="queued",
            )
            session.add(actor)
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(actor.id),
                    role="owner",
                )
            )
            session.commit()
            session.refresh(actor)
            session.refresh(project)
            actor_id = int(actor.id)
            project_id = int(project.id)
            initial_updated_at = project.updated_at
            provider_payload = projects_deps._default_project_memory(project)
            provider_payload["project_brief"] = "Cancelled provider overwrite"

            async def cancel_and_optionally_requeue(**_kwargs):
                with Session(engine) as cancel_session:
                    current = cancel_session.get(Project, project_id)
                    assert current is not None
                    current.memory_rebuild_status = final_rebuild_status
                    current.updated_at = utc_now_naive()
                    assert current.updated_at != initial_updated_at
                    cancel_session.add(current)
                    cancel_session.commit()
                return json.dumps(provider_payload)

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=cancel_and_optionally_requeue,
            ):
                with pytest.raises(
                    MemoryRebuildConflict,
                    match="cancelled or superseded",
                ):
                    await projects_deps._rebuild_project_memory(
                        session,
                        project_id,
                        trigger="manual_queue_run",
                        actor_user_id=actor_id,
                    )

        with Session(engine) as verify:
            saved = verify.get(Project, project_id)
            memory = json.loads(saved.context_memory_json)
            assert saved.memory_version == 0
            assert saved.memory_rebuild_status == final_rebuild_status
            assert memory == {"project_brief": "Original"}
            assert "_last_failure" not in memory
            assert verify.exec(
                select(ProjectMemorySnapshot).where(
                    ProjectMemorySnapshot.project_id == project_id
                )
            ).all() == []
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_scheduled_project_cancel_between_claim_and_provider_discards_job():
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            project = Project(
                name="Cancel scheduled claim",
                client="Cancel client",
                context_memory_json=json.dumps({"project_brief": "Original"}),
                memory_version=0,
                memory_stale=True,
                memory_rebuild_status="queued",
            )
            setup.add(project)
            setup.commit()
            setup.refresh(project)
            project_id = int(project.id)

        real_rebuild = projects_deps._rebuild_project_memory
        start_contract: dict[str, object] = {}

        async def cancel_before_rebuild(session, project_id, **kwargs):
            start_contract["status"] = kwargs.get("start_rebuild_status")
            start_contract["updated_at"] = kwargs.get("start_project_updated_at")
            with Session(engine) as cancel_session:
                current = cancel_session.get(Project, project_id)
                assert current is not None
                current.memory_rebuild_status = "idle"
                current.updated_at = utc_now_naive()
                assert current.updated_at != start_contract["updated_at"]
                cancel_session.add(current)
                cancel_session.commit()
            return await real_rebuild(session, project_id, **kwargs)

        provider = AsyncMock(return_value="{}")
        with patch.object(
            projects_deps,
            "engine",
            engine,
        ), patch.object(
            projects_deps,
            "_rebuild_project_memory",
            new=cancel_before_rebuild,
        ), patch.object(
            projects_deps,
            "complete_with_selected_model",
            new=provider,
        ):
            await projects_deps._run_project_memory_rebuild_job(project_id)

        provider.assert_not_awaited()
        assert start_contract["status"] == "rebuilding"
        with Session(engine) as verify:
            saved = verify.get(Project, project_id)
            snapshots = verify.exec(
                select(ProjectMemorySnapshot).where(
                    ProjectMemorySnapshot.project_id == project_id
                )
            ).all()
        assert saved is not None
        assert saved.memory_rebuild_status == "idle"
        assert saved.memory_version == 0
        assert json.loads(saved.context_memory_json) == {"project_brief": "Original"}
        assert snapshots == []
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_cancelled_scheduled_project_is_not_reclaimed_from_idle():
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            project = Project(
                name="Already cancelled scheduled project",
                client="Cancel client",
                context_memory_json="{}",
                memory_version=0,
                memory_stale=True,
                memory_rebuild_status="idle",
            )
            setup.add(project)
            setup.commit()
            setup.refresh(project)
            project_id = int(project.id)

        with patch.object(
            projects_deps,
            "engine",
            engine,
        ), patch.object(
            projects_deps,
            "_rebuild_project_memory",
            new=AsyncMock(),
        ) as rebuild:
            await projects_deps._run_project_memory_rebuild_job(project_id)
            rebuild.assert_not_awaited()

        with Session(engine) as verify:
            saved = verify.get(Project, project_id)
        assert saved is not None
        assert saved.memory_rebuild_status == "idle"
        assert saved.memory_version == 0
    finally:
        engine.dispose()


def test_project_memory_final_lock_order_places_client_before_membership_and_sources():
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(email="project-memory-lock-order@example.com", password_hash="x")
            session.add(actor)
            session.flush()
            client = ClientRecord(
                name="Project memory lock-order client",
                created_by_user_id=int(actor.id),
            )
            session.add(client)
            session.flush()
            project = Project(
                name="Project memory lock-order project",
                client=client.name,
                client_id=int(client.id),
            )
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(actor.id),
                    role="owner",
                )
            )
            session.commit()
            actor_id = int(actor.id)
            project_id = int(project.id)
            locked_entities = []
            original_exec = session.exec

            def track_locked_entities(statement, *args, **kwargs):
                if getattr(statement, "_for_update_arg", None) is not None:
                    for description in getattr(statement, "column_descriptions", []):
                        entity = description.get("entity")
                        if entity is not None:
                            locked_entities.append(entity)
                            break
                return original_exec(statement, *args, **kwargs)

            with patch.object(session, "exec", side_effect=track_locked_entities):
                locked_project, locked_client = (
                    projects_deps._lock_project_memory_rebuild_writer(
                        session,
                        project_id,
                        actor_user_id=actor_id,
                        trusted_system=False,
                    )
                )
                projects_deps._lock_project_memory_prompt_sources(
                    session,
                    locked_project,
                    client=locked_client,
                )

            assert locked_entities == [
                User,
                Project,
                ClientRecord,
                ProjectMember,
                ProjectProgressUpdate,
                Milestone,
                ProjectTodo,
                ProjectFile,
                ProjectPayment,
                MemoryCandidate,
                ClientStakeholder,
            ]
            session.rollback()
    finally:
        engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("final_actor_state", "provider_fails"),
    [
        ("source_membership_revoked", False),
        ("actor_inactive", False),
        ("source_membership_revoked", True),
        ("actor_inactive", True),
    ],
)
async def test_uploaded_file_provider_cannot_write_after_authorization_change(
    tmp_path: Path,
    final_actor_state: str,
    provider_fails: bool,
):
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            actor = User(
                email=f"upload-summary-{final_actor_state}-{provider_fails}@example.com",
                password_hash="x",
            )
            project = Project(
                name=f"Upload summary {final_actor_state}",
                client="Upload client",
                context_memory_json=json.dumps({"project_brief": "Original memory"}),
                memory_version=1,
                memory_stale=False,
            )
            setup.add(actor)
            setup.add(project)
            setup.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="editor",
            )
            setup.add(membership)
            source_dir = tmp_path / "projects" / str(project.id)
            source_dir.mkdir(parents=True)
            source_path = source_dir / "source.txt"
            source_path.write_text(
                "This source document contains enough text for an automatic project summary. "
                "It must not be persisted after access is revoked.",
                encoding="utf-8",
            )
            project_file = ProjectFile(
                project_id=int(project.id),
                name="source.txt",
                file_type="txt",
                path=str(source_path.relative_to(tmp_path)),
                size_bytes=source_path.stat().st_size,
                origin="uploaded",
            )
            setup.add(project_file)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(project)
            setup.refresh(membership)
            setup.refresh(project_file)
            actor_id = int(actor.id)
            project_id = int(project.id)
            membership_id = int(membership.id)
            file_id = int(project_file.id)
            provider_calls = 0

        async def change_authorization_during_provider(*_args, **_kwargs):
            nonlocal provider_calls
            provider_calls += 1
            with Session(engine) as revoke:
                if final_actor_state == "source_membership_revoked":
                    current_membership = revoke.get(ProjectMember, membership_id)
                    assert current_membership is not None
                    revoke.delete(current_membership)
                else:
                    current_actor = revoke.get(User, actor_id)
                    assert current_actor is not None
                    current_actor.is_active = False
                    revoke.add(current_actor)
                revoke.commit()
            if provider_fails:
                raise RuntimeError("upload summary provider failed")
            return "Unauthorized generated summary"

        with patch("app.database.engine", engine), patch.object(
            projects_deps,
            "UPLOADS_DIR",
            tmp_path,
        ), patch.object(
            projects_deps,
            "complete_with_selected_model",
            new=change_authorization_during_provider,
        ):
            await projects_deps._auto_summarize_file(
                file_id,
                str(source_path),
                "txt",
                project_id,
                None,
                actor_id,
            )

        assert provider_calls == 1

        with Session(engine) as verify:
            saved_file = verify.get(ProjectFile, file_id)
            saved_project = verify.get(Project, project_id)
            project_files = verify.exec(
                select(ProjectFile).where(ProjectFile.project_id == project_id)
            ).all()
            assert saved_file is not None
            assert not saved_file.summary
            assert len(project_files) == 1
            assert saved_project.memory_version == 1
            assert saved_project.memory_stale is False
            assert json.loads(saved_project.context_memory_json) == {
                "project_brief": "Original memory"
            }
            assert "_last_failure" not in json.loads(saved_project.context_memory_json)
        assert list(source_dir.glob("*_extracted.md")) == []
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_uploaded_file_summary_drops_output_when_source_changes_during_provider(
    tmp_path: Path,
):
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            actor = User(
                email="upload-summary-source-drift@example.com",
                password_hash="x",
            )
            project = Project(name="Upload source drift", client="Upload client")
            setup.add(actor)
            setup.add(project)
            setup.flush()
            setup.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(actor.id),
                    role="editor",
                )
            )
            source_dir = tmp_path / "projects" / str(project.id)
            source_dir.mkdir(parents=True)
            source_path = source_dir / "source.txt"
            source_path.write_text(
                "Version A contains the original source facts supplied to the provider.",
                encoding="utf-8",
            )
            project_file = ProjectFile(
                project_id=int(project.id),
                name="source.txt",
                file_type="txt",
                path=str(source_path.relative_to(tmp_path)),
                size_bytes=source_path.stat().st_size,
                origin="uploaded",
            )
            setup.add(project_file)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(project)
            setup.refresh(project_file)
            actor_id = int(actor.id)
            project_id = int(project.id)
            file_id = int(project_file.id)
            provider_calls = 0

        async def replace_source_during_provider(*_args, **_kwargs):
            nonlocal provider_calls
            provider_calls += 1
            source_path.write_text(
                "Version B replaces every original fact while the provider is waiting.",
                encoding="utf-8",
            )
            with Session(engine) as concurrent:
                current_file = concurrent.get(ProjectFile, file_id)
                assert current_file is not None
                current_file.size_bytes = source_path.stat().st_size
                concurrent.add(current_file)
                concurrent.commit()
            return "Stale summary generated from version A"

        with patch("app.database.engine", engine), patch.object(
            projects_deps,
            "UPLOADS_DIR",
            tmp_path,
        ), patch.object(
            projects_deps,
            "complete_with_selected_model",
            new=replace_source_during_provider,
        ):
            await projects_deps._auto_summarize_file(
                file_id,
                str(source_path),
                "txt",
                project_id,
                None,
                actor_id,
            )

        assert provider_calls == 1
        with Session(engine) as verify:
            saved_file = verify.get(ProjectFile, file_id)
            project_files = verify.exec(
                select(ProjectFile).where(ProjectFile.project_id == project_id)
            ).all()
            assert saved_file is not None
            assert not saved_file.summary
            assert len(project_files) == 1
        assert "Version B" in source_path.read_text(encoding="utf-8")
        assert list(source_dir.glob("*_extracted.md")) == []
    finally:
        engine.dispose()


def test_manual_stakeholder_crud_uses_user_project_client_child_lock_order() -> None:
    engine = _sqlite_engine()
    try:
        with Session(engine) as session:
            actor = User(
                email="stakeholder-lock-admin@example.com",
                password_hash="h",
                is_admin=True,
            )
            session.add(actor)
            session.flush()
            client = ClientRecord(
                name="Lock-order client",
                created_by_user_id=int(actor.id),
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = int(client.id)
            project = Project(
                name="Lock-order project",
                client=client.name,
                client_id=client_id,
            )
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(actor.id),
                    role="owner",
                )
            )
            session.commit()
            original_exec = session.exec
            locked_entities = []

            def track_locked_entities(statement, *args, **kwargs):
                if getattr(statement, "_for_update_arg", None) is not None:
                    entity = statement.column_descriptions[0].get("entity")
                    if entity in {
                        User,
                        Project,
                        ClientRecord,
                        ProjectMember,
                        ClientStakeholder,
                    }:
                        locked_entities.append(entity)
                return original_exec(statement, *args, **kwargs)

            with patch.object(
                session,
                "exec",
                side_effect=track_locked_entities,
            ), patch.object(
                clients_stakeholders,
                "mark_client_memory_stale",
            ), patch.object(
                clients_stakeholders,
                "mark_project_memories_stale_by_client_id",
            ):
                created = clients_stakeholders.create_client_stakeholder(
                    client_id,
                    clients_stakeholders.ClientStakeholderCreate(
                        name="Alice",
                        role="Sponsor",
                    ),
                    session,
                    current_user=actor,
                )
                stakeholder_id = int(created.id)
                assert locked_entities == [
                    User,
                    Project,
                    ClientRecord,
                    ProjectMember,
                ]

                locked_entities.clear()
                clients_stakeholders.update_client_stakeholder(
                    client_id,
                    stakeholder_id,
                    clients_stakeholders.ClientStakeholderUpdate(role="Chair"),
                    session,
                    current_user=actor,
                )
                assert locked_entities == [
                    User,
                    Project,
                    ClientRecord,
                    ProjectMember,
                    ClientStakeholder,
                ]
    finally:
        engine.dispose()


def test_stakeholder_delete_respects_history_foreign_key_order() -> None:
    engine = _sqlite_engine()
    try:
        with Session(engine) as setup:
            actor = User(
                email="stakeholder-delete-admin@example.com",
                password_hash="h",
                is_admin=True,
            )
            setup.add(actor)
            setup.flush()
            client = ClientRecord(
                name="FK client",
                created_by_user_id=int(actor.id),
            )
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
            actor_id = int(actor.id)
            stakeholder_id = int(stakeholder.id)
            history_id = int(history.id)

        with Session(engine) as session, patch.object(
            clients_stakeholders,
            "mark_client_memory_stale",
        ), patch.object(
            clients_stakeholders,
            "mark_project_memories_stale_by_client_id",
        ):
            current_user = session.get(User, actor_id)
            assert current_user is not None
            clients_stakeholders.delete_client_stakeholder(
                client_id,
                stakeholder_id,
                session,
                current_user=current_user,
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
            admin = User(
                email="client-delete-admin@example.com",
                password_hash="x",
                is_admin=True,
            )
            setup.add(admin)
            setup.flush()
            client = ClientRecord(
                name="FK graph client",
                created_by_user_id=int(admin.id),
            )
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
            admin_id = int(admin.id)
            stakeholder_id = int(stakeholder.id)
            history_id = int(history.id)

        with Session(engine) as session, patch.object(
            clients,
            "mark_project_memory_stale",
        ):
            current_user = session.get(User, admin_id)
            assert current_user is not None
            clients.delete_client(client_id, session, current_user)

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
            actor = User(
                email="stakeholder-analysis-admin@example.com",
                password_hash="h",
                is_admin=True,
            )
            session.add(actor)
            session.flush()
            client = ClientRecord(
                name="Acme",
                notes="Strategic account",
                created_by_user_id=int(actor.id),
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            stakeholder = ClientStakeholder(
                client_id=int(client.id or 0),
                name="Alex",
                role="Sponsor",
                note="Original note",
            )
            project = Project(
                name="Stakeholder source",
                client="Acme",
                client_id=int(client.id or 0),
            )
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
                        current_user=actor,
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
                        trusted_system=True,
                    )

        with Session(engine) as verify_session:
            summaries = verify_session.exec(select(ClientMemorySummary)).all()
            assert summaries == []
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_client_summary_write_requires_actor_or_explicit_trusted_system(
    tmp_path,
) -> None:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'client-summary-context.db'}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            client = ClientRecord(
                name="Summary authorization client",
                client_memory_json=json.dumps({"client_profile": "Current"}),
                client_memory_version=1,
                client_memory_stale=False,
            )
            session.add(client)
            session.commit()
            session.refresh(client)

            with pytest.raises(ValueError, match="exactly one"):
                await clients_deps._generate_client_memory_summary_cache(
                    session,
                    client,
                    get_client_memory_payload(client),
                    "overview",
                    force_refresh=True,
                )
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
                        trusted_system=True,
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
            actor = User(
                email="project-summary-endpoint-admin@example.com",
                display_name="Summary admin",
                password_hash="h",
                is_admin=True,
            )
            project = Project(
                name="Endpoint pilot",
                client="Acme",
                context_memory_json=json.dumps({"project_brief": "Before"}),
                memory_version=1,
                memory_stale=False,
            )
            session.add(actor)
            session.add(project)
            session.commit()
            session.refresh(actor)
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
                        actor,
                    )

            assert exc_info.value.status_code == 409

        with Session(engine) as verify_session:
            summaries = verify_session.exec(select(ProjectMemorySummary)).all()
            assert summaries == []
    finally:
        engine.dispose()
