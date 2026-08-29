from __future__ import annotations

import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientRecord,
    Conversation,
    MemoryCandidate,
    Message,
    Project,
    ProjectMember,
    User,
    UserMemory,
)
from app.services.client_contexts import parse_client_memory, save_client_memory
from app.services.chat_store import delete_conversation_with_messages
from app.services.project_contexts import parse_project_memory, save_project_memory
from app.services import memory_candidates as memory_candidates_service
from app.routers import memory_candidates as candidates_module
from app.routers.auth import get_current_user
from app.routers.memory_candidates import router


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _seed(engine) -> tuple[int, int, int, int]:
    with Session(engine) as session:
        alice = User(email="alice@example.com", password_hash="x", display_name="Alice")
        bob = User(email="bob@example.com", password_hash="x", display_name="Bob")
        session.add(alice)
        session.add(bob)
        session.commit()
        session.refresh(alice)
        session.refresh(bob)
        project = Project(name="Candidate Project", client="Acme")
        session.add(project)
        session.commit()
        session.refresh(project)
        session.add(ProjectMember(project_id=project.id, user_id=alice.id, role="owner"))
        conversation = Conversation(
            title="Memory source",
            project_id=project.id,
            owner_user_id=alice.id,
        )
        session.add(conversation)
        session.commit()
        session.refresh(conversation)
        message = Message(
            conversation_id=conversation.id,
            role="assistant",
            content="客户已经确认试点范围，下一步需要安排启动会。",
            metadata_json=json.dumps(
                {"activity_timeline": {"run_id": "run_memory_candidate_1"}},
                ensure_ascii=False,
            ),
        )
        session.add(message)
        session.commit()
        session.refresh(message)
        return int(alice.id), int(bob.id), int(project.id), int(message.id)


def _client(engine, current_user_id: list[int]) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    def get_test_session():
        with Session(engine) as session:
            yield session

    def current_user():
        with Session(engine) as session:
            return session.get(User, current_user_id[0])

    app.dependency_overrides[candidates_module.get_session] = get_test_session
    app.dependency_overrides[get_current_user] = current_user
    return TestClient(app, raise_server_exceptions=False)


def test_candidate_decision_locks_owner_before_candidate_and_rechecks_status() -> None:
    locator = MemoryCandidate(
        id=71,
        owner_user_id=9,
        scope="project",
        candidate_type="project_fact",
        content="Candidate fact",
        content_sha256="a" * 64,
        project_id=41,
        base_memory_version=3,
        status="pending",
    )
    locked = locator.model_copy()
    locked.status = "rejected"
    project = Project(id=41, name="Locked owner", client="Acme", memory_version=3)

    class _Result:
        def __init__(self, value):
            self.value = value

        def first(self):
            return self.value

    class _OrderedSession:
        def __init__(self):
            self.entities = []
            self.results = iter((project, locked))

        def exec(self, statement):
            self.entities.append(statement.column_descriptions[0]["entity"])
            assert statement._for_update_arg is not None
            return _Result(next(self.results))

        def expire_all(self):
            return None

    session = _OrderedSession()
    try:
        memory_candidates_service.accept_memory_candidate(
            session,
            locator,
            user_id=9,
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 409
        assert "already rejected" in str(getattr(exc, "detail", ""))
    else:
        raise AssertionError("fresh rejected status must block stale pending acceptance")
    assert session.entities == [Project, MemoryCandidate]


def test_candidate_decision_refreshes_cached_status_after_concurrent_reject() -> None:
    engine = _engine()
    try:
        with Session(engine) as setup:
            owner = User(
                email="candidate-owner@example.com",
                password_hash="x",
                display_name="Owner",
            )
            project = Project(name="Candidate owner", client="Acme")
            setup.add(owner)
            setup.add(project)
            setup.commit()
            setup.refresh(owner)
            setup.refresh(project)
            candidate = MemoryCandidate(
                owner_user_id=int(owner.id),
                scope="project",
                candidate_type="project_fact",
                content="Concurrent candidate",
                content_sha256="b" * 64,
                project_id=int(project.id),
                base_memory_version=0,
                status="pending",
            )
            setup.add(candidate)
            setup.commit()
            setup.refresh(candidate)
            candidate_id = int(candidate.id)

        with Session(engine) as stale_session:
            locator = stale_session.get(MemoryCandidate, candidate_id)
            assert locator is not None
            # Reproduce the identities already loaded by router access checks.
            assert stale_session.get(Project, locator.project_id) is not None
            with Session(engine) as concurrent:
                rejected = concurrent.get(MemoryCandidate, candidate_id)
                assert rejected is not None
                rejected.status = "rejected"
                concurrent.add(rejected)
                concurrent.commit()

            with pytest.raises(HTTPException) as exc_info:
                memory_candidates_service.accept_memory_candidate(
                    stale_session,
                    locator,
                    user_id=int(locator.owner_user_id),
                )
            assert exc_info.value.status_code == 409
            assert "already rejected" in str(exc_info.value.detail)
    finally:
        engine.dispose()


def test_chat_candidate_is_source_linked_idempotent_and_accepts_into_project_memory() -> None:
    engine = _engine()
    alice_id, _, project_id, message_id = _seed(engine)
    current_user_id = [alice_id]
    client = _client(engine, current_user_id)
    payload = {
        "scope": "project",
        "candidate_type": "project_fact",
        "content": "客户已经确认试点范围，下一步需要安排启动会。",
        "source_type": "chat_message",
        "source_id": str(message_id),
        "project_id": project_id,
    }

    created = client.post("/memory-candidates", json=payload)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["created"] is True
    assert body["candidate"]["source_run_id"] == "run_memory_candidate_1"
    assert body["product_event"]["type"] == "memory_candidate_ready"
    duplicate = client.post("/memory-candidates", json=payload).json()
    assert duplicate["created"] is False
    assert duplicate["candidate"]["id"] == body["candidate"]["id"]
    same_source_different_type = client.post(
        "/memory-candidates",
        json={**payload, "candidate_type": "project_next_action"},
    ).json()
    assert same_source_different_type["created"] is True
    assert same_source_different_type["candidate"]["id"] != body["candidate"]["id"]

    accepted = client.post(
        f"/memory-candidates/{body['candidate']['id']}/accept",
        json={"decision_note": "confirmed by project owner"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "accepted"
    assert accepted.json()["target_slot"] == "recent_progress"
    assert accepted.json()["applied_memory_version"] == 1
    already_accepted = client.post("/memory-candidates", json=payload).json()
    assert already_accepted["created"] is False
    assert already_accepted["candidate"]["status"] == "accepted"
    assert already_accepted["product_event"] is None

    with Session(engine) as session:
        project = session.get(Project, project_id)
        memory = json.loads(project.context_memory_json)
        assert payload["content"] in memory["recent_progress"]
        source = session.get(Message, message_id)
        metadata = json.loads(source.metadata_json)
        message_candidate = next(
            item
            for item in metadata["memory_candidates"]
            if item["candidate_id"] == body["candidate"]["id"]
        )
        assert message_candidate["status"] == "accepted"
        assert metadata["run_outputs"][-1]["kind"] == "memory_candidate"
        assert metadata["run_outputs"][-1]["status"] == "accepted"
        timeline_candidate = next(
            item
            for item in metadata["activity_timeline"]["memory_candidates"]
            if item["id"] == str(body["candidate"]["id"])
        )
        assert timeline_candidate["status"] == "accepted"
        rebuilt = parse_project_memory('{"recent_progress": []}', project)
        assert payload["content"] in rebuilt["recent_progress"]
        save_project_memory(
            session,
            project_id,
            {"recent_progress": []},
            trigger="test_stale_rebuild",
        )
        refreshed_project = session.get(Project, project_id)
        persisted_rebuild = json.loads(refreshed_project.context_memory_json)
        assert payload["content"] in persisted_rebuild["recent_progress"]
    engine.dispose()


def test_reject_keeps_formal_memory_unchanged_and_users_are_isolated() -> None:
    engine = _engine()
    alice_id, bob_id, project_id, message_id = _seed(engine)
    current_user_id = [alice_id]
    client = _client(engine, current_user_id)
    created = client.post(
        "/memory-candidates",
        json={
            "scope": "project",
            "candidate_type": "project_risk",
            "content": "试点资源尚未锁定。",
            "source_type": "chat_message",
            "source_id": str(message_id),
            "project_id": project_id,
        },
    ).json()["candidate"]
    rejected = client.post(f"/memory-candidates/{created['id']}/reject", json={})
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    current_user_id[0] = bob_id
    assert client.get(f"/memory-candidates/{created['id']}").status_code == 404
    assert client.get(
        "/memory-candidates",
        params={"scope": "project", "project_id": project_id},
    ).status_code == 403
    invisible = client.get("/memory-candidates", params={"scope": "project"})
    assert invisible.status_code == 200
    assert invisible.json()["items"] == []
    assert client.get("/memory-candidates", params={"scope": "unknown"}).status_code == 400
    with Session(engine) as session:
        project = session.get(Project, project_id)
        assert project.memory_version == 0
        candidate = session.exec(select(MemoryCandidate)).one()
        assert candidate.status == "rejected"
    engine.dispose()


def test_user_preference_candidate_only_changes_user_memory_after_accept() -> None:
    engine = _engine()
    alice_id, _, _, _ = _seed(engine)
    client = _client(engine, [alice_id])
    created = client.post(
        "/memory-candidates",
        json={
            "scope": "user",
            "candidate_type": "user_preference",
            "content": "回答时先给结论，再给证据。",
            "source_type": "manual",
        },
    ).json()["candidate"]
    with Session(engine) as session:
        assert session.exec(select(UserMemory)).first() is None
    accepted = client.post(f"/memory-candidates/{created['id']}/accept", json={})
    assert accepted.status_code == 200
    with Session(engine) as session:
        row = session.exec(select(UserMemory).where(UserMemory.user_id == alice_id)).one()
        preferences = json.loads(row.preferences_json)
        assert preferences["remembered_preferences"] == ["回答时先给结论，再给证据。"]
    engine.dispose()


def test_client_candidate_requires_related_project_write_access_and_survives_rebuild() -> None:
    engine = _engine()
    alice_id, bob_id, _, _ = _seed(engine)
    with Session(engine) as session:
        project = session.exec(select(Project).where(Project.client == "Acme")).one()
        client_record = ClientRecord(name="Acme", industry="Technology")
        session.add(client_record)
        session.add(ProjectMember(project_id=project.id, user_id=bob_id, role="viewer"))
        session.commit()
        session.refresh(client_record)
        client_id = int(client_record.id)

    current_user_id = [bob_id]
    client = _client(engine, current_user_id)
    payload = {
        "scope": "client",
        "candidate_type": "client_relationship_signal",
        "content": "发起人每周五会主动同步试点进度。",
        "source_type": "manual",
        "client_id": client_id,
    }
    assert client.post(
        "/memory-candidates",
        json={**payload, "scope": "Client"},
    ).status_code == 403

    current_user_id[0] = alice_id
    created = client.post("/memory-candidates", json=payload)
    assert created.status_code == 200, created.text
    candidate = created.json()["candidate"]
    assert candidate["target_slot"] == "relationship_signals"
    accepted = client.post(f"/memory-candidates/{candidate['id']}/accept", json={})
    assert accepted.status_code == 200, accepted.text
    with Session(engine) as session:
        record = session.get(ClientRecord, client_id)
        memory = json.loads(record.client_memory_json)
        assert payload["content"] in memory["relationship_signals"]
        rebuilt = parse_client_memory('{"relationship_signals": []}', record)
        assert payload["content"] in rebuilt["relationship_signals"]
        save_client_memory(
            session,
            client_id,
            {"relationship_signals": []},
            trigger="test_stale_rebuild",
        )
        refreshed_client = session.get(ClientRecord, client_id)
        persisted_rebuild = json.loads(refreshed_client.client_memory_json)
        assert payload["content"] in persisted_rebuild["relationship_signals"]
    engine.dispose()


def test_deleting_source_conversation_archives_pending_candidate() -> None:
    engine = _engine()
    alice_id, _, project_id, message_id = _seed(engine)
    client = _client(engine, [alice_id])
    created = client.post(
        "/memory-candidates",
        json={
            "scope": "project",
            "candidate_type": "project_risk",
            "content": "关键审批仍未完成。",
            "source_type": "chat_message",
            "source_id": str(message_id),
            "project_id": project_id,
        },
    )
    assert created.status_code == 200, created.text
    candidate_id = created.json()["candidate"]["id"]
    with Session(engine) as session:
        message = session.get(Message, message_id)
        delete_conversation_with_messages(session, int(message.conversation_id))
    with Session(engine) as session:
        candidate = session.get(MemoryCandidate, candidate_id)
        assert candidate.status == "archived"
        assert candidate.source_type == "deleted_chat_message"
        assert candidate.resolved_at is not None
    engine.dispose()


def test_deleting_source_conversation_preserves_concurrently_accepted_candidate() -> None:
    engine = _engine()
    alice_id, _, project_id, message_id = _seed(engine)
    client = _client(engine, [alice_id])
    created = client.post(
        "/memory-candidates",
        json={
            "scope": "project",
            "candidate_type": "project_risk",
            "content": "该候选已被负责人接受。",
            "source_type": "chat_message",
            "source_id": str(message_id),
            "project_id": project_id,
        },
    )
    assert created.status_code == 200, created.text
    candidate_id = created.json()["candidate"]["id"]

    with Session(engine) as deletion_session:
        message = deletion_session.get(Message, message_id)
        cached_candidate = deletion_session.get(MemoryCandidate, candidate_id)
        assert message is not None and cached_candidate is not None
        assert cached_candidate.status == "pending"
        with Session(engine) as concurrent:
            accepted = concurrent.get(MemoryCandidate, candidate_id)
            assert accepted is not None
            accepted.status = "accepted"
            concurrent.add(accepted)
            concurrent.commit()

        delete_conversation_with_messages(
            deletion_session,
            int(message.conversation_id),
        )

    with Session(engine) as verify:
        candidate = verify.get(MemoryCandidate, candidate_id)
        assert candidate is not None
        assert candidate.status == "accepted"
        assert candidate.source_type == "deleted_chat_message"
    engine.dispose()


def test_project_candidate_requires_explicit_merge_after_base_version_changes() -> None:
    engine = _engine()
    alice_id, _, project_id, _ = _seed(engine)
    client = _client(engine, [alice_id])
    created = client.post(
        "/memory-candidates",
        json={
            "scope": "project",
            "candidate_type": "project_next_action",
            "content": "安排试点启动会。",
            "source_type": "manual",
            "project_id": project_id,
        },
    ).json()["candidate"]
    assert created["base_memory_version"] == 0

    with Session(engine) as session:
        save_project_memory(
            session,
            project_id,
            {"recent_progress": ["范围已确认"]},
            trigger="concurrent_update",
        )

    listed = client.get(
        "/memory-candidates",
        params={"scope": "project", "project_id": project_id},
    ).json()["items"][0]
    assert listed["memory_relation"]["status"] == "stale_base"
    assert listed["memory_relation"]["base_memory_version"] == 0
    assert listed["memory_relation"]["current_memory_version"] == 1
    assert listed["memory_relation"]["requires_confirmation"] is True

    blocked = client.post(
        f"/memory-candidates/{created['id']}/accept",
        json={"expected_memory_version": 1},
    )
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "MEMORY_CONFLICT_CONFIRMATION_REQUIRED"

    accepted = client.post(
        f"/memory-candidates/{created['id']}/accept",
        json={"expected_memory_version": 1, "allow_conflict": True},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["applied_memory_version"] == 2
    engine.dispose()


def test_duplicate_candidate_acceptance_does_not_create_empty_memory_version() -> None:
    engine = _engine()
    alice_id, _, project_id, _ = _seed(engine)
    with Session(engine) as session:
        save_project_memory(
            session,
            project_id,
            {"recent_progress": ["范围已确认"]},
            trigger="seed",
        )
    client = _client(engine, [alice_id])
    created = client.post(
        "/memory-candidates",
        json={
            "scope": "project",
            "candidate_type": "project_fact",
            "content": "范围已确认",
            "source_type": "manual",
            "project_id": project_id,
        },
    ).json()["candidate"]
    assert created["memory_relation"]["status"] == "duplicate"

    accepted = client.post(
        f"/memory-candidates/{created['id']}/accept",
        json={"expected_memory_version": 1},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["applied_memory_version"] == 1
    with Session(engine) as session:
        assert session.get(Project, project_id).memory_version == 1
    engine.dispose()
