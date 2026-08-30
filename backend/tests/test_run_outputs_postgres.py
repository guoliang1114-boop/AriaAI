"""PostgreSQL contract test for verified outputs and reviewed memory.

This file intentionally uses ``tests.test_database.create_test_engine``. It is
run by the production-database E2E workflow inside its disposable
``ariaai_test_*`` schema, never against ``public`` application tables.
"""
from __future__ import annotations

import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, SQLModel, select

from app.models.db import (
    ClientRecord,
    Conversation,
    GeneratedFile,
    MemoryCandidate,
    Message,
    Project,
    ProjectMember,
    User,
)
from app.routers import clients as clients_router
from app.routers.clients_deps import ClientCreate
from app.services.agent_harness.run_output_record import build_artifact_output_record
from app.services.chat_store import persist_run_artifacts
from app.services import memory_candidates as memory_candidates_service
from app.services.memory_candidates import accept_memory_candidate, create_memory_candidate
from tests.test_database import create_test_engine, drop_all_tables


class RunOutputsPostgresContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_test_engine()

    @classmethod
    def tearDownClass(cls) -> None:
        drop_all_tables(cls.engine)
        cls.engine.dispose()

    def setUp(self) -> None:
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def test_verified_artifact_and_reviewed_memory_round_trip(self) -> None:
        with Session(self.engine) as session:
            user = User(email="postgres-output@example.com", password_hash="x")
            project = Project(name="Output Contract", client="Acme")
            session.add(user)
            session.add(project)
            session.commit()
            session.refresh(user)
            session.refresh(project)
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(user.id),
                    role="owner",
                )
            )
            session.commit()
            conversation = Conversation(
                title="PostgreSQL output contract",
                project_id=project.id,
                owner_user_id=user.id,
            )
            session.add(conversation)
            session.commit()
            session.refresh(conversation)
            user_id = int(user.id)
            project_id = int(project.id)
            conversation_id = int(conversation.id)

            candidate, created = create_memory_candidate(
                session,
                owner_user_id=user_id,
                scope="project",
                candidate_type="project_next_action",
                content="安排项目启动会并确认责任人。",
                source_type="manual",
                project_id=project_id,
            )
            self.assertTrue(created)
            session.commit()
            session.refresh(candidate)
            accept_memory_candidate(session, candidate, user_id=user_id)

        with tempfile.TemporaryDirectory() as temp_dir:
            uploads = Path(temp_dir)
            output_path = uploads / "generated" / "verified.md"
            output_path.parent.mkdir(parents=True)
            output_path.write_text("# Verified output\n", encoding="utf-8")
            artifact = {
                "name": "verified.md",
                "file_type": "md",
                "path": "generated/verified.md",
                "source_tool": "write_project_markdown_document",
                "tool_use_id": "postgres-call-1",
            }
            record = build_artifact_output_record(
                artifact,
                run_id="run_postgres_output_contract",
                source_tool=artifact["source_tool"],
                tool_use_id=artifact["tool_use_id"],
            )
            artifact["output_id"] = record["output_id"]
            with patch("app.services.chat_store.UPLOADS_DIR", uploads):
                batch = persist_run_artifacts(
                    self.engine,
                    conversation_id,
                    [artifact],
                    project_id,
                    run_id="run_postgres_output_contract",
                    run_outputs=[record],
                )

        self.assertEqual(batch.failures, [])
        self.assertEqual(batch.run_outputs[0]["status"], "persisted")
        with Session(self.engine) as session:
            candidate = session.exec(select(MemoryCandidate)).one()
            self.assertEqual(candidate.status, "accepted")
            project = session.get(Project, project_id)
            memory = json.loads(project.context_memory_json)
            self.assertIn("安排项目启动会并确认责任人。", memory["next_actions"])
            generated = session.exec(select(GeneratedFile)).one()
            self.assertEqual(generated.run_id, "run_postgres_output_contract")
            self.assertEqual(generated.output_id, record["output_id"])
            self.assertEqual(len(generated.content_sha256), 64)

    def _seed_project_memory_candidate(
        self,
        *,
        decision: str,
    ) -> tuple[int, int, int, int, str]:
        content = f"Real {decision} keeps final authorization linearizable."
        with Session(self.engine) as setup:
            user = User(
                email=f"candidate-{decision}-lock@example.com",
                password_hash="x",
            )
            project = Project(
                name=f"Candidate {decision} lock contract",
                client="Acme",
            )
            setup.add(user)
            setup.add(project)
            setup.commit()
            setup.refresh(user)
            setup.refresh(project)
            setup.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(user.id),
                    role="editor",
                )
            )
            conversation = Conversation(
                title=f"Candidate {decision} source",
                project_id=int(project.id),
                owner_user_id=int(user.id),
            )
            setup.add(conversation)
            setup.commit()
            setup.refresh(conversation)
            message = Message(
                conversation_id=int(conversation.id),
                role="assistant",
                content=content,
                metadata_json=json.dumps(
                    {
                        "activity_timeline": {
                            "run_id": f"run-candidate-{decision}-lock"
                        }
                    }
                ),
            )
            setup.add(message)
            setup.commit()
            setup.refresh(message)
            candidate, created = create_memory_candidate(
                setup,
                owner_user_id=int(user.id),
                scope="project",
                candidate_type="project_fact",
                content=content,
                source_type="chat_message",
                source_id=str(message.id),
                project_id=int(project.id),
            )
            self.assertTrue(created)
            memory_candidates_service.sync_candidate_source_message(setup, candidate)
            setup.commit()
            setup.refresh(candidate)
            return (
                int(user.id),
                int(project.id),
                int(message.id),
                int(candidate.id),
                content,
            )

    def _seed_client_memory_candidate(
        self,
        *,
        scenario: str,
    ) -> tuple[int, int, int, str]:
        content = f"Real {scenario} protects the client identity predicate."
        with Session(self.engine) as setup:
            user = User(
                email=f"client-candidate-{scenario}@example.com",
                password_hash="x",
            )
            project = Project(
                name=f"Client candidate {scenario}",
                client="Acme",
            )
            client = ClientRecord(name="Acme", industry="Technology")
            setup.add(user)
            setup.add(project)
            setup.add(client)
            setup.commit()
            setup.refresh(user)
            setup.refresh(project)
            setup.refresh(client)
            setup.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(user.id),
                    role="editor",
                )
            )
            setup.commit()
            candidate, created = create_memory_candidate(
                setup,
                owner_user_id=int(user.id),
                scope="client",
                candidate_type="client_preference",
                content=content,
                client_id=int(client.id),
            )
            self.assertTrue(created)
            setup.commit()
            setup.refresh(candidate)
            return int(user.id), int(client.id), int(candidate.id), content

    def _assert_client_candidate_state(
        self,
        *,
        candidate_id: int,
        client_id: int,
        content: str,
        expected_status: str,
    ) -> None:
        with Session(self.engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            client = verify.get(ClientRecord, client_id)
            self.assertIsNotNone(candidate)
            self.assertIsNotNone(client)
            self.assertEqual(candidate.status, expected_status)
            memory = json.loads(client.client_memory_json or "{}")
            if expected_status == "accepted":
                self.assertEqual(int(client.client_memory_version or 0), 1)
                self.assertIn(content, memory.get("decision_patterns", []))
            else:
                self.assertEqual(int(client.client_memory_version or 0), 0)
                self.assertNotIn(content, memory.get("decision_patterns", []))

    def _assert_project_candidate_state(
        self,
        *,
        candidate_id: int,
        project_id: int,
        message_id: int,
        content: str,
        expected_status: str,
    ) -> None:
        with Session(self.engine) as verify:
            candidate = verify.get(MemoryCandidate, candidate_id)
            project = verify.get(Project, project_id)
            source = verify.get(Message, message_id)
            self.assertIsNotNone(candidate)
            self.assertIsNotNone(project)
            self.assertIsNotNone(source)
            self.assertEqual(candidate.status, expected_status)
            memory = json.loads(project.context_memory_json or "{}")
            if expected_status == "accepted":
                self.assertEqual(int(project.memory_version or 0), 1)
                self.assertIn(content, memory.get("recent_progress", []))
            else:
                self.assertEqual(int(project.memory_version or 0), 0)
                self.assertNotIn(content, memory.get("recent_progress", []))
            source_metadata = json.loads(source.metadata_json or "{}")
            source_ref = next(
                item
                for item in source_metadata.get("memory_candidates", [])
                if int(item.get("candidate_id") or 0) == candidate_id
            )
            self.assertEqual(source_ref["status"], expected_status)

    def _assert_real_decision_blocks_membership_revocation(
        self,
        *,
        decision: str,
    ) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL row-lock contract")

        user_id, project_id, message_id, candidate_id, content = (
            self._seed_project_memory_candidate(decision=decision)
        )
        authorization_locked = threading.Event()
        release_decision = threading.Event()
        decision_errors: list[BaseException] = []
        decision_statuses: list[str] = []
        original_lock = (
            memory_candidates_service._lock_candidate_owner_then_candidate
        )

        def lock_then_wait(*args, **kwargs):
            locked = original_lock(*args, **kwargs)
            authorization_locked.set()
            if not release_decision.wait(timeout=10):
                raise AssertionError("Timed out waiting to release candidate decision")
            return locked

        def run_real_decision() -> None:
            try:
                with Session(self.engine) as decision_session:
                    locator = decision_session.get(MemoryCandidate, candidate_id)
                    self.assertIsNotNone(locator)
                    if decision == "accept":
                        resolved = accept_memory_candidate(
                            decision_session,
                            locator,
                            user_id=user_id,
                        )
                    else:
                        resolved = memory_candidates_service.reject_memory_candidate(
                            decision_session,
                            locator,
                            user_id=user_id,
                        )
                    decision_statuses.append(str(resolved.status))
            except BaseException as exc:  # pragma: no cover - asserted in caller
                decision_errors.append(exc)

        with patch.object(
            memory_candidates_service,
            "_lock_candidate_owner_then_candidate",
            new=lock_then_wait,
        ):
            decision_thread = threading.Thread(
                target=run_real_decision,
                name=f"candidate-{decision}-decision",
                daemon=True,
            )
            decision_thread.start()
            try:
                self.assertTrue(
                    authorization_locked.wait(timeout=10),
                    "Candidate decision did not acquire final authorization locks",
                )
                with Session(self.engine) as revocation_session:
                    revocation_session.exec(
                        text("SET LOCAL lock_timeout = '250ms'")
                    )
                    membership = revocation_session.exec(
                        select(ProjectMember).where(
                            ProjectMember.project_id == project_id,
                            ProjectMember.user_id == user_id,
                        )
                    ).one()
                    revocation_session.delete(membership)
                    with self.assertRaises(OperationalError):
                        revocation_session.flush()
                    revocation_session.rollback()
            finally:
                release_decision.set()
                decision_thread.join(timeout=10)

        self.assertFalse(decision_thread.is_alive(), "Candidate decision thread hung")
        self.assertEqual(decision_errors, [])
        self.assertEqual(decision_statuses, [f"{decision}ed"])
        self._assert_project_candidate_state(
            candidate_id=candidate_id,
            project_id=project_id,
            message_id=message_id,
            content=content,
            expected_status=f"{decision}ed",
        )

    def _assert_revocation_before_real_decision_is_denied(
        self,
        *,
        decision: str,
    ) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL row-lock contract")

        user_id, project_id, message_id, candidate_id, content = (
            self._seed_project_memory_candidate(decision=f"revoked-{decision}")
        )
        with Session(self.engine) as revocation_session:
            membership = revocation_session.exec(
                select(ProjectMember).where(
                    ProjectMember.project_id == project_id,
                    ProjectMember.user_id == user_id,
                )
            ).one()
            revocation_session.delete(membership)
            revocation_session.commit()

        with Session(self.engine) as decision_session:
            locator = decision_session.get(MemoryCandidate, candidate_id)
            self.assertIsNotNone(locator)
            with self.assertRaises(HTTPException) as raised:
                if decision == "accept":
                    accept_memory_candidate(
                        decision_session,
                        locator,
                        user_id=user_id,
                    )
                else:
                    memory_candidates_service.reject_memory_candidate(
                        decision_session,
                        locator,
                        user_id=user_id,
                    )
            self.assertEqual(raised.exception.status_code, 403)
            decision_session.rollback()

        self._assert_project_candidate_state(
            candidate_id=candidate_id,
            project_id=project_id,
            message_id=message_id,
            content=content,
            expected_status="pending",
        )

    def test_real_accept_holds_authorization_through_commit(self) -> None:
        self._assert_real_decision_blocks_membership_revocation(decision="accept")

    def test_real_reject_holds_authorization_through_commit(self) -> None:
        self._assert_real_decision_blocks_membership_revocation(decision="reject")

    def test_revocation_committed_before_real_accept_is_denied(self) -> None:
        self._assert_revocation_before_real_decision_is_denied(decision="accept")

    def test_revocation_committed_before_real_reject_is_denied(self) -> None:
        self._assert_revocation_before_real_decision_is_denied(decision="reject")

    def test_client_candidate_namespace_blocks_concurrent_same_name_create(self) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL client-identity advisory-lock contract")

        user_id, client_id, candidate_id, content = (
            self._seed_client_memory_candidate(scenario="namespace-lock")
        )
        authorization_locked = threading.Event()
        release_decision = threading.Event()
        decision_errors: list[BaseException] = []
        decision_statuses: list[str] = []
        original_lock = (
            memory_candidates_service._lock_candidate_owner_then_candidate
        )

        def lock_then_wait(*args, **kwargs):
            locked = original_lock(*args, **kwargs)
            authorization_locked.set()
            if not release_decision.wait(timeout=10):
                raise AssertionError("Timed out waiting to release client candidate decision")
            return locked

        def run_real_accept() -> None:
            try:
                with Session(self.engine) as decision_session:
                    locator = decision_session.get(MemoryCandidate, candidate_id)
                    self.assertIsNotNone(locator)
                    resolved = accept_memory_candidate(
                        decision_session,
                        locator,
                        user_id=user_id,
                    )
                    decision_statuses.append(str(resolved.status))
            except BaseException as exc:  # pragma: no cover - asserted in caller
                decision_errors.append(exc)

        with patch.object(
            memory_candidates_service,
            "_lock_candidate_owner_then_candidate",
            new=lock_then_wait,
        ):
            decision_thread = threading.Thread(
                target=run_real_accept,
                name="client-candidate-namespace-lock",
                daemon=True,
            )
            decision_thread.start()
            try:
                self.assertTrue(
                    authorization_locked.wait(timeout=10),
                    "Client candidate did not acquire its identity namespace lock",
                )
                with Session(self.engine) as create_session:
                    create_session.exec(text("SET LOCAL lock_timeout = '250ms'"))
                    with self.assertRaises(OperationalError):
                        clients_router.create_client(
                            ClientCreate(name="  ACME  ", industry="Finance"),
                            session=create_session,
                        )
                    create_session.rollback()
            finally:
                release_decision.set()
                decision_thread.join(timeout=10)

        self.assertFalse(decision_thread.is_alive(), "Client candidate decision thread hung")
        self.assertEqual(decision_errors, [])
        self.assertEqual(decision_statuses, ["accepted"])
        with Session(self.engine) as verify:
            self.assertEqual(len(verify.exec(select(ClientRecord)).all()), 1)
        self._assert_client_candidate_state(
            candidate_id=candidate_id,
            client_id=client_id,
            content=content,
            expected_status="accepted",
        )

    def test_same_name_client_create_committed_before_decision_is_ambiguous(self) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL client-identity advisory-lock contract")

        user_id, client_id, candidate_id, content = (
            self._seed_client_memory_candidate(scenario="precommitted-duplicate")
        )
        with Session(self.engine) as create_session:
            created = clients_router.create_client(
                ClientCreate(name="  ACME  ", industry="Finance"),
                session=create_session,
            )
            self.assertNotEqual(int(created.id), client_id)

        with Session(self.engine) as decision_session:
            locator = decision_session.get(MemoryCandidate, candidate_id)
            self.assertIsNotNone(locator)
            with self.assertRaises(HTTPException) as raised:
                accept_memory_candidate(
                    decision_session,
                    locator,
                    user_id=user_id,
                )
            self.assertEqual(raised.exception.status_code, 409)
            self.assertIn("ambiguous", str(raised.exception.detail).lower())
            decision_session.rollback()

        with Session(self.engine) as verify:
            self.assertEqual(len(verify.exec(select(ClientRecord)).all()), 2)
        self._assert_client_candidate_state(
            candidate_id=candidate_id,
            client_id=client_id,
            content=content,
            expected_status="pending",
        )


if __name__ == "__main__":
    unittest.main()
