from __future__ import annotations

import json

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientMemoryFact,
    ClientMemorySlot,
    ClientMemorySnapshot,
    ClientRecord,
    Conversation,
    MemoryCandidate,
    Message,
    Project,
    ProjectMember,
    ProjectMemoryFact,
    ProjectMemorySlot,
    ProjectMemorySnapshot,
    User,
    UserMemory,
)
from app.services.client_contexts import (
    get_client_memory_payload,
    parse_client_memory,
    save_client_memory,
)
from app.services.client_identity import lock_client_identity_namespaces
from app.services.chat_store import delete_conversation_with_messages
from app.services.project_contexts import (
    get_project_memory_payload,
    parse_project_memory,
    save_project_memory,
)
from app.services.memory_slots import (
    load_client_memory_slot_values,
    load_project_memory_slot_values,
)
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


def test_client_identity_namespace_locks_are_sorted_and_deduplicated() -> None:
    class _Dialect:
        name = "postgresql"

    class _Bind:
        dialect = _Dialect()

    class _Result:
        def one(self):
            return None

    class _LockSession:
        bind = _Bind()

        def __init__(self):
            self.keys: list[str] = []

        def exec(self, statement):
            params = statement.compile().params
            self.keys.append(str(params["hashtextextended_1"]))
            return _Result()

    session = _LockSession()
    lock_client_identity_namespaces(
        session,
        ("beta", "acme", "beta", ""),
    )
    assert session.keys == [
        "aria.client-identity.v1:",
        "aria.client-identity.v1:acme",
        "aria.client-identity.v1:beta",
    ]


def test_candidate_decision_locks_actor_scope_permission_then_rechecks_status() -> None:
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
    actor = User(
        id=9,
        email="locked-actor@example.com",
        password_hash="x",
        is_active=True,
    )
    project = Project(id=41, name="Locked owner", client="Acme", memory_version=3)
    membership = ProjectMember(id=51, project_id=41, user_id=9, role="editor")

    class _Result:
        def __init__(self, value):
            self.value = value

        def first(self):
            return self.value

        def all(self):
            return self.value if isinstance(self.value, list) else [self.value]

    class _OrderedSession:
        def __init__(self):
            self.entities = []
            self.results = iter((actor, project, [membership], locked))

        def exec(self, statement):
            self.entities.append(statement.column_descriptions[0].get("entity"))
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
    assert session.entities == [User, Project, ProjectMember, MemoryCandidate]


def test_client_candidate_decision_uses_cross_owner_authorization_lock_order() -> None:
    locator = MemoryCandidate(
        id=72,
        owner_user_id=9,
        scope="client",
        candidate_type="client_preference",
        content="Candidate preference",
        content_sha256="c" * 64,
        client_id=61,
        base_memory_version=4,
        status="pending",
    )
    locked = locator.model_copy()
    locked.status = "rejected"
    actor = User(
        id=9,
        email="client-lock-actor@example.com",
        password_hash="x",
        is_active=True,
    )
    project = Project(id=41, name="Client source", client="Acme", client_id=61)
    client = ClientRecord(id=61, name="Acme", client_memory_version=4)
    membership = ProjectMember(id=52, project_id=41, user_id=9, role="editor")

    class _Result:
        def __init__(self, value):
            self.value = value

        def first(self):
            return self.value

        def all(self):
            return self.value if isinstance(self.value, list) else [self.value]

        def one(self):
            return self.value

    class _OrderedSession:
        def __init__(self):
            self.entities = []
            self.results = iter(
                (
                    "acme",
                    actor,
                    [project],
                    client,
                    "acme",
                    [membership],
                    locked,
                )
            )

        def exec(self, statement):
            self.entities.append(statement.column_descriptions[0].get("entity"))
            if len(self.entities) in {1, 5}:
                assert statement._for_update_arg is None
            else:
                assert statement._for_update_arg is not None
            return _Result(next(self.results))

        def expire_all(self):
            return None

    session = _OrderedSession()
    rejected = memory_candidates_service.reject_memory_candidate(
        session,
        locator,
        user_id=9,
    )
    assert rejected.status == "rejected"
    assert session.entities == [
        ClientRecord,
        User,
        Project,
        ClientRecord,
        None,
        ProjectMember,
        MemoryCandidate,
    ]


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
            setup.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(owner.id),
                    role="owner",
                )
            )
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


@pytest.mark.parametrize("decision", ["accept", "reject"])
def test_project_candidate_decision_rechecks_write_access_after_router_check(
    decision: str,
) -> None:
    engine = _engine()
    try:
        owner_id, _, project_id, _ = _seed(engine)
        content = f"Project permission revoked before {decision}."
        with Session(engine) as setup:
            candidate, _ = memory_candidates_service.create_memory_candidate(
                setup,
                owner_user_id=owner_id,
                scope="project",
                candidate_type="project_fact",
                content=content,
                project_id=project_id,
            )
            setup.commit()
            setup.refresh(candidate)
            candidate_id = int(candidate.id)

        with Session(engine) as decision_session:
            actor = decision_session.get(User, owner_id)
            locator = decision_session.get(MemoryCandidate, candidate_id)
            assert actor is not None and locator is not None
            # Reproduce the router's early check, then revoke access in a
            # second transaction before the service acquires final locks.
            candidates_module._require_candidate_scope_access(
                decision_session,
                locator,
                actor,
                require_write=True,
            )
            with Session(engine) as revocation_session:
                membership = revocation_session.exec(
                    select(ProjectMember).where(
                        ProjectMember.project_id == project_id,
                        ProjectMember.user_id == owner_id,
                    )
                ).one()
                revocation_session.delete(membership)
                revocation_session.commit()

            with pytest.raises(HTTPException) as exc_info:
                if decision == "accept":
                    memory_candidates_service.accept_memory_candidate(
                        decision_session,
                        locator,
                        user_id=owner_id,
                    )
                else:
                    memory_candidates_service.reject_memory_candidate(
                        decision_session,
                        locator,
                        user_id=owner_id,
                    )
            assert exc_info.value.status_code == 403
            decision_session.rollback()

        with Session(engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            project = verify.get(Project, project_id)
            assert candidate is not None and candidate.status == "pending"
            assert project is not None and int(project.memory_version or 0) == 0
            assert content not in project.context_memory_json
    finally:
        engine.dispose()


@pytest.mark.parametrize("decision", ["accept", "reject"])
@pytest.mark.parametrize("revocation", ["viewer", "removed"])
def test_user_candidate_decision_rechecks_chat_source_project_write_access(
    decision: str,
    revocation: str,
) -> None:
    engine = _engine()
    try:
        owner_id, _, project_id, message_id = _seed(engine)
        client = _client(engine, [owner_id])
        created = client.post(
            "/memory-candidates",
            json={
                "scope": "user",
                "candidate_type": "user_preference",
                "content": "Give the conclusion before the supporting detail.",
                "source_type": "chat_message",
                "source_id": str(message_id),
            },
        )
        assert created.status_code == 200, created.text
        candidate_id = int(created.json()["candidate"]["id"])

        with Session(engine) as revocation_session:
            membership = revocation_session.exec(
                select(ProjectMember).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == owner_id,
                )
            ).one()
            if revocation == "viewer":
                membership.role = "viewer"
                revocation_session.add(membership)
            else:
                revocation_session.delete(membership)
            revocation_session.commit()

        with Session(engine) as before:
            source = before.get(Message, message_id)
            assert source is not None
            metadata_before = source.metadata_json

        response = client.post(
            f"/memory-candidates/{candidate_id}/{decision}",
            json={},
        )
        assert response.status_code == 403, response.text

        with Session(engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            source = verify.get(Message, message_id)
            assert candidate is not None and candidate.status == "pending"
            assert candidate.resolved_at is None
            assert verify.exec(select(UserMemory)).first() is None
            assert source is not None and source.metadata_json == metadata_before
    finally:
        engine.dispose()


@pytest.mark.parametrize("decision", ["accept", "reject"])
def test_client_candidate_decision_rechecks_write_access_after_router_check(
    decision: str,
) -> None:
    engine = _engine()
    try:
        owner_id, _, project_id, _ = _seed(engine)
        content = f"Client permission revoked before {decision}."
        with Session(engine) as setup:
            client = ClientRecord(name="Acme", industry="Technology")
            setup.add(client)
            setup.commit()
            setup.refresh(client)
            client_id = int(client.id)
            project = setup.get(Project, project_id)
            assert project is not None
            project.client_id = client_id
            setup.add(project)
            candidate, _ = memory_candidates_service.create_memory_candidate(
                setup,
                owner_user_id=owner_id,
                scope="client",
                candidate_type="client_preference",
                content=content,
                client_id=client_id,
            )
            setup.commit()
            setup.refresh(candidate)
            candidate_id = int(candidate.id)

        with Session(engine) as decision_session:
            actor = decision_session.get(User, owner_id)
            locator = decision_session.get(MemoryCandidate, candidate_id)
            assert actor is not None and locator is not None
            candidates_module._require_candidate_scope_access(
                decision_session,
                locator,
                actor,
                require_write=True,
            )
            with Session(engine) as revocation_session:
                membership = revocation_session.exec(
                    select(ProjectMember).where(
                        ProjectMember.project_id == project_id,
                        ProjectMember.user_id == owner_id,
                    )
                ).one()
                revocation_session.delete(membership)
                revocation_session.commit()

            with pytest.raises(HTTPException) as exc_info:
                if decision == "accept":
                    memory_candidates_service.accept_memory_candidate(
                        decision_session,
                        locator,
                        user_id=owner_id,
                    )
                else:
                    memory_candidates_service.reject_memory_candidate(
                        decision_session,
                        locator,
                        user_id=owner_id,
                    )
            assert exc_info.value.status_code == 403
            decision_session.rollback()

        with Session(engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            client = verify.get(ClientRecord, client_id)
            assert candidate is not None and candidate.status == "pending"
            assert client is not None and int(client.client_memory_version or 0) == 0
            assert content not in client.client_memory_json
    finally:
        engine.dispose()


@pytest.mark.parametrize("decision", ["accept", "reject"])
@pytest.mark.parametrize("target_index", [0, 1])
@pytest.mark.parametrize("duplicate_name", ["  ACME  ", "\tACME\t", "\xa0ACME\xa0"])
def test_client_candidate_decision_uses_stable_id_with_duplicate_client_names(
    decision: str,
    target_index: int,
    duplicate_name: str,
) -> None:
    engine = _engine()
    try:
        owner_id, _, project_id, _ = _seed(engine)
        content = f"Stable client {target_index} may {decision}."
        with Session(engine) as setup:
            clients = [
                ClientRecord(name="Acme", industry="Technology"),
                ClientRecord(name=duplicate_name, industry="Finance"),
            ]
            for client in clients:
                setup.add(client)
            setup.commit()
            for client in clients:
                setup.refresh(client)
            target_client_id = int(clients[target_index].id)
            project = setup.get(Project, project_id)
            assert project is not None
            project.client_id = target_client_id
            project.client = clients[target_index].name
            setup.add(project)
            candidate, _ = memory_candidates_service.create_memory_candidate(
                setup,
                owner_user_id=owner_id,
                scope="client",
                candidate_type="client_preference",
                content=content,
                client_id=target_client_id,
            )
            setup.commit()
            setup.refresh(candidate)
            candidate_id = int(candidate.id)

        with Session(engine) as decision_session:
            actor = decision_session.get(User, owner_id)
            locator = decision_session.get(MemoryCandidate, candidate_id)
            assert actor is not None and locator is not None
            candidates_module._require_candidate_scope_access(
                decision_session,
                locator,
                actor,
                require_write=True,
            )
            if decision == "accept":
                memory_candidates_service.accept_memory_candidate(
                    decision_session,
                    locator,
                    user_id=owner_id,
                )
            else:
                memory_candidates_service.reject_memory_candidate(
                    decision_session,
                    locator,
                    user_id=owner_id,
                )

        with Session(engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            target = verify.get(ClientRecord, target_client_id)
            assert candidate is not None and candidate.status == f"{decision}ed"
            assert target is not None
            if decision == "accept":
                assert int(target.client_memory_version or 0) == 1
                assert content in target.client_memory_json
            else:
                assert int(target.client_memory_version or 0) == 0
                assert content not in target.client_memory_json
    finally:
        engine.dispose()


@pytest.mark.parametrize("decision", ["accept", "reject"])
@pytest.mark.parametrize("blank_identity", ["   ", "\t\xa0\t"])
def test_client_candidate_decision_uses_stable_id_with_blank_legacy_name(
    decision: str,
    blank_identity: str,
) -> None:
    engine = _engine()
    try:
        owner_id, _, _, _ = _seed(engine)
        content = f"Blank client relationship must not {decision}."
        with Session(engine) as setup:
            project = Project(name="Blank client project", client=blank_identity)
            client = ClientRecord(name=blank_identity, industry="Unknown")
            setup.add(project)
            setup.add(client)
            setup.commit()
            setup.refresh(project)
            setup.refresh(client)
            project.client_id = int(client.id)
            setup.add(project)
            setup.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=owner_id,
                    role="editor",
                )
            )
            setup.commit()
            client_id = int(client.id)
            candidate, _ = memory_candidates_service.create_memory_candidate(
                setup,
                owner_user_id=owner_id,
                scope="client",
                candidate_type="client_preference",
                content=content,
                client_id=client_id,
            )
            setup.commit()
            setup.refresh(candidate)
            candidate_id = int(candidate.id)

        with Session(engine) as decision_session:
            actor = decision_session.get(User, owner_id)
            locator = decision_session.get(MemoryCandidate, candidate_id)
            assert actor is not None and locator is not None
            candidates_module._require_candidate_scope_access(
                decision_session,
                locator,
                actor,
                require_write=True,
            )
            if decision == "accept":
                memory_candidates_service.accept_memory_candidate(
                    decision_session,
                    locator,
                    user_id=owner_id,
                )
            else:
                memory_candidates_service.reject_memory_candidate(
                    decision_session,
                    locator,
                    user_id=owner_id,
                )

        with Session(engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            client = verify.get(ClientRecord, client_id)
            assert candidate is not None and candidate.status == f"{decision}ed"
            assert client is not None
            if decision == "accept":
                assert int(client.client_memory_version or 0) == 1
                assert content in client.client_memory_json
            else:
                assert int(client.client_memory_version or 0) == 0
                assert content not in client.client_memory_json
    finally:
        engine.dispose()


def test_candidate_decision_rechecks_actor_active_state_in_final_transaction() -> None:
    engine = _engine()
    try:
        owner_id, _, _, _ = _seed(engine)
        with Session(engine) as setup:
            candidate, _ = memory_candidates_service.create_memory_candidate(
                setup,
                owner_user_id=owner_id,
                scope="user",
                candidate_type="user_preference",
                content="Use concise final answers.",
            )
            setup.commit()
            setup.refresh(candidate)
            candidate_id = int(candidate.id)

        with Session(engine) as decision_session:
            # This actor instance represents get_current_user having succeeded.
            assert decision_session.get(User, owner_id) is not None
            locator = decision_session.get(MemoryCandidate, candidate_id)
            assert locator is not None
            with Session(engine) as deactivation_session:
                actor = deactivation_session.get(User, owner_id)
                assert actor is not None
                actor.is_active = False
                deactivation_session.add(actor)
                deactivation_session.commit()

            with pytest.raises(HTTPException) as exc_info:
                memory_candidates_service.accept_memory_candidate(
                    decision_session,
                    locator,
                    user_id=owner_id,
                )
            assert exc_info.value.status_code == 403
            decision_session.rollback()

        with Session(engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            assert candidate is not None and candidate.status == "pending"
            assert verify.exec(
                select(UserMemory).where(UserMemory.user_id == owner_id)
            ).first() is None
    finally:
        engine.dispose()


def test_candidate_create_rechecks_project_write_access_before_source_sync(
    monkeypatch,
) -> None:
    engine = _engine()
    try:
        alice_id, _, project_id, message_id = _seed(engine)
        client = _client(engine, [alice_id])
        original_lock = candidates_module._lock_candidate_create_context

        def revoke_then_lock(session, **kwargs):
            membership = session.exec(
                select(ProjectMember).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == alice_id,
                )
            ).one()
            session.delete(membership)
            session.commit()
            return original_lock(session, **kwargs)

        monkeypatch.setattr(
            candidates_module,
            "_lock_candidate_create_context",
            revoke_then_lock,
        )
        response = client.post(
            "/memory-candidates",
            json={
                "scope": "project",
                "candidate_type": "project_fact",
                "content": "This must not survive revoked access.",
                "source_type": "chat_message",
                "source_id": str(message_id),
                "project_id": project_id,
            },
        )
        assert response.status_code == 403, response.text

        with Session(engine) as verify:
            assert verify.exec(select(MemoryCandidate)).first() is None
            source = verify.get(Message, message_id)
            assert source is not None
            metadata = source.get_metadata()
            assert "memory_candidates" not in metadata
            assert "run_outputs" not in metadata
    finally:
        engine.dispose()


def test_candidate_create_rechecks_client_link_before_source_sync(monkeypatch) -> None:
    engine = _engine()
    try:
        alice_id, _, project_id, message_id = _seed(engine)
        with Session(engine) as setup:
            client_record = ClientRecord(
                name="Acme",
                industry="Technology",
                created_by_user_id=alice_id,
            )
            setup.add(client_record)
            setup.flush()
            project = setup.get(Project, project_id)
            assert project is not None
            project.client_id = int(client_record.id)
            setup.add(project)
            setup.commit()
            client_id = int(client_record.id)

        client = _client(engine, [alice_id])
        original_lock = candidates_module._lock_candidate_create_context

        def unlink_then_lock(session, **kwargs):
            project = session.get(Project, project_id)
            assert project is not None
            project.client_id = None
            session.add(project)
            session.commit()
            return original_lock(session, **kwargs)

        monkeypatch.setattr(
            candidates_module,
            "_lock_candidate_create_context",
            unlink_then_lock,
        )
        response = client.post(
            "/memory-candidates",
            json={
                "scope": "client",
                "candidate_type": "client_preference",
                "content": "This must remain scoped to the stable client.",
                "source_type": "chat_message",
                "source_id": str(message_id),
                "client_id": client_id,
            },
        )
        assert response.status_code == 409, response.text

        with Session(engine) as verify:
            assert verify.exec(select(MemoryCandidate)).first() is None
            source = verify.get(Message, message_id)
            assert source is not None
            assert "memory_candidates" not in source.get_metadata()
    finally:
        engine.dispose()


def test_candidate_create_does_not_mutate_viewer_source_message(monkeypatch) -> None:
    engine = _engine()
    try:
        alice_id, _, project_id, message_id = _seed(engine)
        with Session(engine) as setup:
            client_record = ClientRecord(
                name="Creator-owned client",
                created_by_user_id=alice_id,
            )
            setup.add(client_record)
            setup.flush()
            project = setup.get(Project, project_id)
            assert project is not None
            project.client_id = int(client_record.id)
            setup.add(project)
            setup.commit()
            client_id = int(client_record.id)

        client = _client(engine, [alice_id])
        original_lock = candidates_module._lock_candidate_create_context

        def downgrade_then_lock(session, **kwargs):
            membership = session.exec(
                select(ProjectMember).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == alice_id,
                )
            ).one()
            membership.role = "viewer"
            session.add(membership)
            session.commit()
            return original_lock(session, **kwargs)

        monkeypatch.setattr(
            candidates_module,
            "_lock_candidate_create_context",
            downgrade_then_lock,
        )
        response = client.post(
            "/memory-candidates",
            json={
                "scope": "client",
                "candidate_type": "client_preference",
                "content": "A viewer source must stay read-only.",
                "source_type": "chat_message",
                "source_id": str(message_id),
                "client_id": client_id,
            },
        )

        assert response.status_code == 403, response.text
        with Session(engine) as verify:
            assert verify.exec(select(MemoryCandidate)).first() is None
            source = verify.get(Message, message_id)
            assert source is not None
            assert "memory_candidates" not in source.get_metadata()
            assert "run_outputs" not in source.get_metadata()
    finally:
        engine.dispose()


def test_candidate_create_rechecks_actor_active_state(monkeypatch) -> None:
    engine = _engine()
    try:
        alice_id, _, _, _ = _seed(engine)
        client = _client(engine, [alice_id])
        original_lock = candidates_module._lock_candidate_create_context

        def deactivate_then_lock(session, **kwargs):
            actor = session.get(User, alice_id)
            assert actor is not None
            actor.is_active = False
            session.add(actor)
            session.commit()
            return original_lock(session, **kwargs)

        monkeypatch.setattr(
            candidates_module,
            "_lock_candidate_create_context",
            deactivate_then_lock,
        )
        response = client.post(
            "/memory-candidates",
            json={
                "scope": "user",
                "candidate_type": "user_preference",
                "content": "This inactive user must not create memory.",
            },
        )
        assert response.status_code == 403, response.text

        with Session(engine) as verify:
            assert verify.exec(select(MemoryCandidate)).first() is None
    finally:
        engine.dispose()


def test_candidate_create_rejects_source_conversation_project_rebind(
    monkeypatch,
) -> None:
    engine = _engine()
    try:
        alice_id, _, project_id, message_id = _seed(engine)
        with Session(engine) as setup:
            other_project = Project(name="Other source project", client="Other")
            setup.add(other_project)
            setup.flush()
            setup.add(
                ProjectMember(
                    project_id=int(other_project.id),
                    user_id=alice_id,
                    role="owner",
                )
            )
            setup.commit()
            other_project_id = int(other_project.id)

        client = _client(engine, [alice_id])
        original_lock = candidates_module._lock_candidate_create_context

        def rebind_then_lock(session, **kwargs):
            source = session.get(Message, message_id)
            assert source is not None
            conversation = session.get(Conversation, source.conversation_id)
            assert conversation is not None
            conversation.project_id = other_project_id
            session.add(conversation)
            session.commit()
            return original_lock(session, **kwargs)

        monkeypatch.setattr(
            candidates_module,
            "_lock_candidate_create_context",
            rebind_then_lock,
        )
        response = client.post(
            "/memory-candidates",
            json={
                "scope": "project",
                "candidate_type": "project_fact",
                "content": "A rebound source must not cross project scope.",
                "source_type": "chat_message",
                "source_id": str(message_id),
                "project_id": project_id,
            },
        )
        assert response.status_code == 409, response.text

        with Session(engine) as verify:
            assert verify.exec(select(MemoryCandidate)).first() is None
            source = verify.get(Message, message_id)
            assert source is not None
            assert "memory_candidates" not in source.get_metadata()
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
        memory = load_project_memory_slot_values(
            session,
            project,
            get_project_memory_payload(project),
        )
        assert payload["content"] in memory["recent_progress"]
        assert "recent_progress" not in json.loads(project.context_memory_json)
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
        persisted_rebuild = load_project_memory_slot_values(
            session,
            refreshed_project,
            get_project_memory_payload(refreshed_project),
        )
        assert payload["content"] in persisted_rebuild["recent_progress"]
    engine.dispose()


@pytest.mark.parametrize("scope", ["project", "client"])
def test_candidate_acceptance_rolls_back_every_projection_when_source_sync_fails(
    scope: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    engine = _engine()
    try:
        owner_id, _, project_id, message_id = _seed(engine)
        content = f"Atomic {scope} candidate."
        with Session(engine) as setup:
            client_id = None
            if scope == "client":
                client = ClientRecord(name="Acme", industry="Technology")
                setup.add(client)
                setup.commit()
                setup.refresh(client)
                client_id = int(client.id)
                project = setup.get(Project, project_id)
                assert project is not None
                project.client_id = client_id
                setup.add(project)
            candidate, _ = memory_candidates_service.create_memory_candidate(
                setup,
                owner_user_id=owner_id,
                scope=scope,
                candidate_type=(
                    "project_fact" if scope == "project" else "client_preference"
                ),
                content=content,
                source_type="chat_message",
                source_id=str(message_id),
                project_id=project_id if scope == "project" else None,
                client_id=client_id,
            )
            setup.commit()
            setup.refresh(candidate)
            candidate_id = int(candidate.id)
            source = setup.get(Message, message_id)
            assert source is not None
            initial_source_metadata = source.metadata_json

        def fail_source_sync(*_args, **_kwargs) -> None:
            raise RuntimeError("injected source sync failure")

        monkeypatch.setattr(
            memory_candidates_service,
            "sync_candidate_source_message",
            fail_source_sync,
        )
        with Session(engine) as decision_session:
            locator = decision_session.get(MemoryCandidate, candidate_id)
            assert locator is not None
            with pytest.raises(RuntimeError, match="injected source sync failure"):
                memory_candidates_service.accept_memory_candidate(
                    decision_session,
                    locator,
                    user_id=owner_id,
                )
            decision_session.rollback()

        with Session(engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            source = verify.get(Message, message_id)
            assert candidate is not None and candidate.status == "pending"
            assert candidate.applied_memory_version is None
            assert source is not None
            assert source.metadata_json == initial_source_metadata
            if scope == "project":
                project = verify.get(Project, project_id)
                assert project is not None and int(project.memory_version or 0) == 0
                assert content not in project.context_memory_json
                assert verify.exec(
                    select(ProjectMemorySnapshot).where(
                        ProjectMemorySnapshot.project_id == project_id
                    )
                ).all() == []
                assert verify.exec(
                    select(ProjectMemorySlot).where(
                        ProjectMemorySlot.project_id == project_id
                    )
                ).all() == []
                assert verify.exec(
                    select(ProjectMemoryFact).where(
                        ProjectMemoryFact.project_id == project_id
                    )
                ).all() == []
            else:
                assert client_id is not None
                client = verify.get(ClientRecord, client_id)
                assert client is not None
                assert int(client.client_memory_version or 0) == 0
                assert content not in client.client_memory_json
                assert verify.exec(
                    select(ClientMemorySnapshot).where(
                        ClientMemorySnapshot.client_id == client_id
                    )
                ).all() == []
                assert verify.exec(
                    select(ClientMemorySlot).where(
                        ClientMemorySlot.client_id == client_id
                    )
                ).all() == []
                assert verify.exec(
                    select(ClientMemoryFact).where(
                        ClientMemoryFact.client_id == client_id
                    )
                ).all() == []
    finally:
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
        session.flush()
        project.client_id = int(client_record.id)
        session.add(project)
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
        memory = load_client_memory_slot_values(
            session,
            record,
            get_client_memory_payload(record),
        )
        assert payload["content"] in memory["relationship_signals"]
        assert "relationship_signals" not in json.loads(record.client_memory_json)
        rebuilt = parse_client_memory('{"relationship_signals": []}', record)
        assert payload["content"] in rebuilt["relationship_signals"]
        save_client_memory(
            session,
            client_id,
            {"relationship_signals": []},
            trigger="test_stale_rebuild",
        )
        refreshed_client = session.get(ClientRecord, client_id)
        persisted_rebuild = load_client_memory_slot_values(
            session,
            refreshed_client,
            get_client_memory_payload(refreshed_client),
        )
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
