"""PostgreSQL contract test for verified outputs and reviewed memory.

This file intentionally uses ``tests.test_database.create_test_engine``. It is
run by the production-database E2E workflow inside its disposable
``ariaai_test_*`` schema, never against ``public`` application tables.
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import threading
import unittest
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import event, text
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, SQLModel, select

from app.models.db import (
    ClientMemorySnapshot,
    ClientStakeholder,
    ClientRecord,
    Conversation,
    GeneratedFile,
    MemoryCandidate,
    Message,
    Milestone,
    Project,
    ProjectFile,
    ProjectMember,
    ProjectPayment,
    ProjectProgressUpdate,
    ProjectTodo,
    PendingToolAction,
    User,
)
from app.routers import (
    chat_actions,
    clients as clients_router,
    clients_deps,
    clients_memory,
    projects_briefing,
    projects_deps,
)
from app.routers.clients_deps import ClientCreate, ClientUpdate
from app.services.agent_harness.run_output_record import build_artifact_output_record
from app.services.chat_store import persist_run_artifacts
from app.services.chat.action_project_writes import persist_prepared_project_write
from app.services.chat.action_reaper import reap_stale_executing_actions
from app.services import memory_candidates as memory_candidates_service
from app.services import project_core as project_core_service
from app.services.memory_candidates import accept_memory_candidate, create_memory_candidate
from app.services.project_contexts import (
    get_project_memory_payload,
    get_project_memory_summary_cache,
    save_project_memory_summary_cache,
)
from app.services.client_contexts import get_client_memory_payload
from app.services.memory_slots import (
    get_project_memory_slot_states,
    load_client_memory_slot_values,
    load_project_memory_slot_values,
)
from app.services.project_deletion import delete_project_cascade
from app.services.time_utils import utc_now_naive
from app.tools import office_documents
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
            memory = load_project_memory_slot_values(
                session,
                project,
                get_project_memory_payload(project),
            )
            self.assertIn("安排项目启动会并确认责任人。", memory["next_actions"])
            generated = session.exec(select(GeneratedFile)).one()
            self.assertEqual(generated.run_id, "run_postgres_output_contract")
            self.assertEqual(generated.output_id, record["output_id"])
            self.assertEqual(len(generated.content_sha256), 64)

    def test_hitas_finalizer_serializes_with_reaper_on_action_row(self) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL FOR UPDATE contract")

        with tempfile.TemporaryDirectory() as temp_dir:
            uploads = Path(temp_dir)
            generated = uploads / "generated"
            generated.mkdir(parents=True)
            prepared_path = generated / "prepared.pdf"
            prepared_path.write_bytes(b"postgres-hitas")

            with Session(self.engine) as session:
                actor = User(email="hitas-postgres@example.com", password_hash="x")
                project = Project(name="HITAS PG lock", client="Acme")
                session.add(actor)
                session.add(project)
                session.flush()
                session.add(
                    ProjectMember(
                        project_id=int(project.id),
                        user_id=int(actor.id),
                        role="editor",
                    )
                )
                conversation = Conversation(
                    title="HITAS PG lock",
                    project_id=int(project.id),
                    owner_user_id=int(actor.id),
                )
                session.add(conversation)
                session.flush()
                tool_input = {
                    "project_id": int(project.id),
                    "file_type": "pdf",
                    "file_name": "postgres-hitas.pdf",
                    "title": "PostgreSQL HITAS",
                    "content": "Approved",
                }
                action = PendingToolAction(
                    conversation_id=int(conversation.id),
                    project_id=int(project.id),
                    tool_name=office_documents.WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
                    tool_input_json=json.dumps(tool_input),
                    action_type="write_office_document",
                    title="Create PostgreSQL HITAS artifact",
                    status="executing",
                    confirmed_by_user_id=int(actor.id),
                    confirmed_at=utc_now_naive() - timedelta(hours=2),
                )
                session.add(action)
                session.commit()
                session.refresh(action)
                project_id = int(project.id)
                action_id = int(action.id)

            prepared = {
                "kind": "office_create",
                "cleanup_source": False,
                "source_path": str(prepared_path),
                "file_name": "postgres-hitas.pdf",
                "file_type": "pdf",
                "folder_id": None,
                "summary": "PostgreSQL HITAS lock contract",
                "preview_text": "Approved",
            }
            generation = chat_actions._capture_action_execution_generation(
                self.engine,
                action_id=action_id,
                expected_tool_name=office_documents.WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
                expected_tool_input=tool_input,
            )
            finalizer_locked = threading.Event()
            release_finalizer = threading.Event()
            reaper_started = threading.Event()
            reaper_done = threading.Event()
            final_result: dict = {}
            reaper_counts: list[int] = []
            errors: list[BaseException] = []
            original_persist = persist_prepared_project_write

            @contextmanager
            def blocking_persist(*args, **kwargs):
                with original_persist(*args, **kwargs) as result:
                    finalizer_locked.set()
                    if not release_finalizer.wait(timeout=10):
                        raise AssertionError("Timed out waiting to release HITAS finalizer")
                    yield result

            def finalize() -> None:
                try:
                    final_result.update(
                        chat_actions._persist_final_authorized_project_action_success(
                            self.engine,
                            action_id,
                            office_documents.WRITE_PROJECT_OFFICE_DOCUMENT_TOOL_NAME,
                            tool_input,
                            generation,
                            prepared,
                            emit_message=True,
                        )
                    )
                except BaseException as exc:  # pragma: no cover - surfaced below
                    errors.append(exc)

            def reap() -> None:
                try:
                    reaper_started.set()
                    with Session(self.engine) as session:
                        reaper_counts.append(
                            reap_stale_executing_actions(
                                session,
                                stale_after_minutes=30,
                            )
                        )
                except BaseException as exc:  # pragma: no cover - surfaced below
                    errors.append(exc)
                finally:
                    reaper_done.set()

            with patch.object(office_documents, "UPLOADS_DIR", uploads), patch.object(
                chat_actions,
                "persist_prepared_project_write",
                blocking_persist,
            ):
                final_thread = threading.Thread(target=finalize)
                reaper_thread = threading.Thread(target=reap)
                final_thread.start()
                self.assertTrue(finalizer_locked.wait(timeout=5))
                reaper_thread.start()
                self.assertTrue(reaper_started.wait(timeout=5))
                # PostgreSQL must make the reaper wait for the action row held
                # by the finalizer, rather than producing a competing receipt.
                self.assertFalse(reaper_done.wait(timeout=0.25))
                release_finalizer.set()
                final_thread.join(timeout=10)
                reaper_thread.join(timeout=10)

            self.assertFalse(final_thread.is_alive(), "HITAS finalizer thread hung")
            self.assertFalse(reaper_thread.is_alive(), "HITAS reaper thread hung")
            self.assertEqual(errors, [])
            self.assertEqual(final_result["status"], "completed")
            self.assertEqual(reaper_counts, [0])
            with Session(self.engine) as session:
                action = session.get(PendingToolAction, action_id)
                project_file = session.exec(
                    select(ProjectFile).where(ProjectFile.project_id == project_id)
                ).one()
                self.assertEqual(action.status, "completed")
                self.assertEqual(len(session.exec(select(Message)).all()), 1)
                self.assertEqual(
                    (uploads / project_file.path).read_bytes(),
                    b"postgres-hitas",
                )

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
            project.client_id = int(client.id)
            project.client = client.name
            setup.add(project)
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
            memory = load_client_memory_slot_values(
                verify,
                client,
                get_client_memory_payload(client),
            )
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
            memory = load_project_memory_slot_values(
                verify,
                project,
                get_project_memory_payload(project),
            )
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
                            current_user=create_session.get(User, user_id),
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

    def test_same_name_client_create_committed_before_decision_keeps_stable_identity(self) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL client-identity advisory-lock contract")

        user_id, client_id, candidate_id, content = (
            self._seed_client_memory_candidate(scenario="precommitted-duplicate")
        )
        with Session(self.engine) as create_session:
            created = clients_router.create_client(
                ClientCreate(name="  ACME  ", industry="Finance"),
                session=create_session,
                current_user=create_session.get(User, user_id),
            )
            self.assertNotEqual(int(created.id), client_id)

        with Session(self.engine) as decision_session:
            locator = decision_session.get(MemoryCandidate, candidate_id)
            self.assertIsNotNone(locator)
            resolved = accept_memory_candidate(
                decision_session,
                locator,
                user_id=user_id,
            )
            self.assertEqual(resolved.status, "accepted")

        with Session(self.engine) as verify:
            self.assertEqual(len(verify.exec(select(ClientRecord)).all()), 2)
        self._assert_client_candidate_state(
            candidate_id=candidate_id,
            client_id=client_id,
            content=content,
            expected_status="accepted",
        )

    def test_client_rename_serializes_after_project_to_client_writer(self) -> None:
        """A Project -> Client writer must never cross an inverse rename lock.

        The paused ORM hook is immediately before the rename's Project
        ``FOR UPDATE`` statement.  A promotion/analysis-equivalent transaction
        already owns that Project and must still be able to acquire Client.  If
        rename ever regresses to Client -> Projects, the 250 ms lock timeout
        below fails deterministically instead of relying on PostgreSQL's
        deadlock detector timing.
        """

        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL Project -> Client row-lock contract")

        with Session(self.engine) as setup:
            actor = User(
                email="client-rename-lock@example.com",
                password_hash="x",
            )
            setup.add(actor)
            setup.commit()
            setup.refresh(actor)
            client = ClientRecord(
                name="Rename Lock Client",
                notes="initial",
                created_by_user_id=int(actor.id),
            )
            setup.add(client)
            setup.commit()
            setup.refresh(client)
            project = Project(
                name="Rename Lock Project",
                client=client.name,
                client_id=int(client.id),
            )
            setup.add(project)
            setup.flush()
            setup.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(actor.id),
                    role="owner",
                )
            )
            setup.commit()
            actor_id = int(actor.id)
            client_id = int(client.id)
            project_id = int(project.id)

        project_lock_attempted = threading.Event()
        allow_project_lock = threading.Event()
        rename_errors: list[BaseException] = []

        def run_rename() -> None:
            try:
                with Session(self.engine) as rename_session:
                    rename_session.exec(text("SET LOCAL lock_timeout = '1s'"))
                    paused = False

                    def pause_before_project_lock(orm_execute_state) -> None:
                        nonlocal paused
                        statement = orm_execute_state.statement
                        if paused or getattr(statement, "_for_update_arg", None) is None:
                            return
                        entities = {
                            item.get("entity")
                            for item in getattr(statement, "column_descriptions", ())
                        }
                        if Project not in entities:
                            return
                        paused = True
                        project_lock_attempted.set()
                        if not allow_project_lock.wait(timeout=10):
                            raise AssertionError(
                                "Timed out before the client rename Project lock"
                            )

                    event.listen(
                        rename_session,
                        "do_orm_execute",
                        pause_before_project_lock,
                    )
                    actor = rename_session.get(User, actor_id)
                    self.assertIsNotNone(actor)
                    clients_router.update_client(
                        client_id,
                        ClientUpdate(name="Renamed Lock Client"),
                        session=rename_session,
                        current_user=actor,
                    )
            except BaseException as exc:  # pragma: no cover - asserted below
                rename_errors.append(exc)

        rename_thread = threading.Thread(
            target=run_rename,
            name="client-rename-project-client-lock-order",
            daemon=True,
        )
        with Session(self.engine) as promotion_session:
            promotion_session.exec(text("SET LOCAL lock_timeout = '250ms'"))
            locked_project = promotion_session.exec(
                select(Project)
                .where(Project.id == project_id)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).one()
            rename_thread.start()
            try:
                self.assertTrue(
                    project_lock_attempted.wait(timeout=10),
                    "Client rename did not reach its Project lock",
                )
                # This mirrors the final lock pair used by promotion/analysis.
                # It succeeds only when rename has not already taken Client.
                locked_client = promotion_session.exec(
                    select(ClientRecord)
                    .where(ClientRecord.id == client_id)
                    .execution_options(populate_existing=True)
                    .with_for_update()
                ).one()
                self.assertEqual(int(locked_project.client_id), client_id)
                locked_client.notes = "promotion committed first"
                promotion_session.add(locked_client)
                promotion_session.commit()
            finally:
                allow_project_lock.set()
                if promotion_session.in_transaction():
                    promotion_session.rollback()

        rename_thread.join(timeout=10)
        self.assertFalse(rename_thread.is_alive(), "Client rename thread hung")
        self.assertEqual(rename_errors, [])
        with Session(self.engine) as verify:
            client = verify.get(ClientRecord, client_id)
            project = verify.get(Project, project_id)
            self.assertIsNotNone(client)
            self.assertIsNotNone(project)
            self.assertEqual(client.name, "Renamed Lock Client")
            self.assertEqual(client.notes, "promotion committed first")
            self.assertEqual(project.client_id, client_id)
            self.assertEqual(project.client, "Renamed Lock Client")

    def test_membership_revocation_blocks_then_denies_project_client_link(self) -> None:
        """A target membership cannot be consumed after revocation wins."""

        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL membership authorization row-lock contract")

        with Session(self.engine) as setup:
            actor = User(email="project-link-actor@example.com", password_hash="x")
            target_owner = User(
                email="project-link-target-owner@example.com",
                password_hash="x",
            )
            setup.add(actor)
            setup.add(target_owner)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(target_owner)
            source_client = ClientRecord(
                name="Source Link Client",
                created_by_user_id=int(actor.id),
            )
            target_client = ClientRecord(
                name="Target Link Client",
                created_by_user_id=int(target_owner.id),
            )
            setup.add(source_client)
            setup.add(target_client)
            setup.commit()
            setup.refresh(source_client)
            setup.refresh(target_client)
            source_project = Project(
                name="Source Link Project",
                client=source_client.name,
                client_id=int(source_client.id),
            )
            target_project = Project(
                name="Existing Target Project",
                client=target_client.name,
                client_id=int(target_client.id),
            )
            setup.add(source_project)
            setup.add(target_project)
            setup.flush()
            source_membership = ProjectMember(
                project_id=int(source_project.id),
                user_id=int(actor.id),
                role="owner",
            )
            target_membership = ProjectMember(
                project_id=int(target_project.id),
                user_id=int(actor.id),
                role="editor",
            )
            setup.add(source_membership)
            setup.add(target_membership)
            setup.commit()
            setup.refresh(target_membership)
            actor_id = int(actor.id)
            source_client_id = int(source_client.id)
            target_client_id = int(target_client.id)
            source_project_id = int(source_project.id)
            target_membership_id = int(target_membership.id)

        with Session(self.engine) as revocation_session:
            membership = revocation_session.exec(
                select(ProjectMember)
                .where(ProjectMember.id == target_membership_id)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).one()
            revocation_session.delete(membership)
            revocation_session.flush()

            with Session(self.engine) as link_session:
                link_session.exec(text("SET LOCAL lock_timeout = '250ms'"))
                with self.assertRaises(OperationalError):
                    project_core_service.update_project_record(
                        link_session,
                        source_project_id,
                        {
                            "client": "Target Link Client",
                            "client_id": target_client_id,
                        },
                        actor_user_id=actor_id,
                    )
                link_session.rollback()

            # Revocation is the first committed serial action.
            revocation_session.commit()

        with Session(self.engine) as denied_session:
            with self.assertRaises(HTTPException) as raised:
                project_core_service.update_project_record(
                    denied_session,
                    source_project_id,
                    {
                        "client": "Target Link Client",
                        "client_id": target_client_id,
                    },
                    actor_user_id=actor_id,
                )
            self.assertEqual(raised.exception.status_code, 403)
            denied_session.rollback()

        with Session(self.engine) as verify:
            project = verify.get(Project, source_project_id)
            self.assertIsNotNone(project)
            self.assertEqual(project.client_id, source_client_id)
            self.assertEqual(project.client, "Source Link Client")
            self.assertIsNone(verify.get(ProjectMember, target_membership_id))

    def test_membership_revocation_blocks_then_denies_project_delete(self) -> None:
        """Deletion cannot consume a write membership after revocation wins."""

        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL project deletion authorization lock contract")

        with Session(self.engine) as setup:
            actor = User(
                email="project-delete-revoked@example.com",
                password_hash="x",
            )
            project = Project(
                name="Delete revocation contract",
                client="Deletion client",
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

        with Session(self.engine) as revocation_session:
            membership = revocation_session.exec(
                select(ProjectMember)
                .where(ProjectMember.id == membership_id)
                .execution_options(populate_existing=True)
                .with_for_update()
            ).one()
            revocation_session.delete(membership)
            revocation_session.flush()

            with Session(self.engine) as deletion_session:
                deletion_session.exec(text("SET LOCAL lock_timeout = '250ms'"))
                with self.assertRaises(OperationalError):
                    delete_project_cascade(
                        deletion_session,
                        project_id,
                        actor_user_id=actor_id,
                    )
                deletion_session.rollback()

            revocation_session.commit()

        with Session(self.engine) as denied_session:
            with self.assertRaises(HTTPException) as raised:
                delete_project_cascade(
                    denied_session,
                    project_id,
                    actor_user_id=actor_id,
                )
            self.assertEqual(raised.exception.status_code, 403)
            denied_session.rollback()

        with Session(self.engine) as verify:
            self.assertIsNotNone(verify.get(Project, project_id))
            self.assertIsNone(verify.get(ProjectMember, membership_id))

    def test_archive_promotion_rechecks_source_membership_after_provider_wait(self) -> None:
        """Another client project cannot mask source revocation during await."""

        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL archive-promotion authorization contract")

        with Session(self.engine) as setup:
            actor = User(
                email="promotion-source-revoked@example.com",
                password_hash="x",
            )
            client_owner = User(
                email="promotion-source-client-owner@example.com",
                password_hash="x",
            )
            setup.add(actor)
            setup.add(client_owner)
            setup.flush()
            client = ClientRecord(
                name="Promotion source client",
                created_by_user_id=int(client_owner.id),
            )
            setup.add(client)
            setup.flush()
            source_project = Project(
                name="Archived promotion source",
                client=client.name,
                client_id=int(client.id),
                status="archived",
                context_memory_json=json.dumps({"project_brief": "Guarded source"}),
                memory_version=1,
                memory_stale=False,
            )
            other_project = Project(
                name="Other writable client project",
                client=client.name,
                client_id=int(client.id),
            )
            setup.add(source_project)
            setup.add(other_project)
            setup.flush()
            source_membership = ProjectMember(
                project_id=int(source_project.id),
                user_id=int(actor.id),
                role="editor",
            )
            setup.add(source_membership)
            setup.add(
                ProjectMember(
                    project_id=int(other_project.id),
                    user_id=int(actor.id),
                    role="editor",
                )
            )
            setup.commit()
            setup.refresh(actor)
            setup.refresh(client)
            setup.refresh(source_project)
            setup.refresh(source_membership)
            actor_id = int(actor.id)
            client_id = int(client.id)
            source_project_id = int(source_project.id)
            source_membership_id = int(source_membership.id)

        async def revoke_source_membership(**_kwargs):
            with Session(self.engine) as revocation_session:
                membership = revocation_session.get(
                    ProjectMember,
                    source_membership_id,
                )
                self.assertIsNotNone(membership)
                revocation_session.delete(membership)
                revocation_session.commit()
            return "{}"

        with Session(self.engine) as promotion_session:
            actor = promotion_session.get(User, actor_id)
            self.assertIsNotNone(actor)
            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=revoke_source_membership,
            ):
                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(
                        projects_deps._auto_promote_archived_project_to_client_memory(
                            promotion_session,
                            source_project_id,
                            actor=actor,
                            previous_status="delivering",
                        )
                    )
            self.assertEqual(raised.exception.status_code, 403)
            self.assertIn("source project", str(raised.exception.detail).lower())
            promotion_session.rollback()

        with Session(self.engine) as verify:
            client = verify.get(ClientRecord, client_id)
            self.assertIsNotNone(client)
            self.assertEqual(int(client.client_memory_version or 0), 0)
            self.assertIsNone(verify.get(ProjectMember, source_membership_id))

    def test_briefing_final_source_locks_linearize_child_updates_after_cache_commit(
        self,
    ) -> None:
        """Final briefing locks freeze every mutable source through commit."""

        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL briefing source-lock contract")

        with Session(self.engine) as setup:
            actor = User(email="briefing-lock-owner@example.com", password_hash="x")
            setup.add(actor)
            setup.flush()
            client = ClientRecord(
                name="Briefing Lock Client",
                created_by_user_id=int(actor.id),
            )
            setup.add(client)
            setup.flush()
            project = Project(
                name="Briefing Lock Project",
                client=client.name,
                client_id=int(client.id),
                context_memory_json=json.dumps({"project_brief": "Old brief"}),
                memory_version=1,
                memory_stale=False,
            )
            setup.add(project)
            setup.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="owner",
            )
            milestone = Milestone(
                project_id=int(project.id),
                title="Old milestone",
            )
            todo = ProjectTodo(
                project_id=int(project.id),
                content="Old todo",
            )
            project_file = ProjectFile(
                project_id=int(project.id),
                name="old-file.md",
                file_type="md",
                path=f"projects/{project.id}/old-file.md",
                size_bytes=10,
                summary="Old file summary",
            )
            stakeholder = ClientStakeholder(
                client_id=int(client.id),
                name="Old stakeholder",
                note="Old stakeholder note",
            )
            conversation = Conversation(
                project_id=int(project.id),
                owner_user_id=int(actor.id),
                title="Old conversation",
            )
            setup.add(membership)
            setup.add(milestone)
            setup.add(todo)
            setup.add(project_file)
            setup.add(stakeholder)
            setup.add(conversation)
            setup.flush()
            setup.add(
                Message(
                    conversation_id=int(conversation.id),
                    role="user",
                    content="Old conversation source",
                )
            )
            setup.commit()
            actor_id = int(actor.id)
            client_id = int(client.id)
            project_id = int(project.id)
            milestone_id = int(milestone.id)
            project_file_id = int(project_file.id)
            stakeholder_id = int(stakeholder.id)

        with Session(self.engine) as baseline_session:
            baseline = projects_briefing._build_project_briefing(
                baseline_session,
                project_id,
            )
            source_version = projects_briefing._briefing_source_version(
                baseline,
                "status",
            )

        started = {
            "milestone": threading.Event(),
            "file": threading.Event(),
            "stakeholder": threading.Event(),
        }
        completed = {
            "milestone": threading.Event(),
            "file": threading.Event(),
            "stakeholder": threading.Event(),
        }
        writer_errors: list[BaseException] = []

        def update_source(kind: str, model, row_id: int, field: str, value) -> None:
            try:
                with Session(self.engine) as writer:
                    writer.exec(text("SET LOCAL lock_timeout = '5s'"))
                    started[kind].set()
                    row = writer.exec(
                        select(model)
                        .where(model.id == row_id)
                        .execution_options(populate_existing=True)
                        .with_for_update()
                    ).one()
                    setattr(row, field, value)
                    writer.add(row)
                    writer.commit()
                completed[kind].set()
            except BaseException as exc:  # pragma: no cover - asserted below
                writer_errors.append(exc)
                completed[kind].set()

        provider_result = "Briefing generated from the old frozen sources"
        threads = [
            threading.Thread(
                target=update_source,
                args=("milestone", Milestone, milestone_id, "title", "New milestone"),
                daemon=True,
            ),
            threading.Thread(
                target=update_source,
                args=("file", ProjectFile, project_file_id, "summary", "New file summary"),
                daemon=True,
            ),
            threading.Thread(
                target=update_source,
                args=("stakeholder", ClientStakeholder, stakeholder_id, "note", "New stakeholder note"),
                daemon=True,
            ),
        ]

        with Session(self.engine) as final_session:
            actor = final_session.get(User, actor_id)
            self.assertIsNotNone(actor)
            projects_briefing._lock_and_require_briefing_sources(
                final_session,
                project_id=project_id,
                expected_client_id=client_id,
                current_user=actor,
            )
            projects_briefing._require_current_briefing_source(
                final_session,
                project_id=project_id,
                meeting_type="status",
                expected_source_version=source_version,
            )
            for thread in threads:
                thread.start()
            for event_started in started.values():
                self.assertTrue(event_started.wait(timeout=10))
            for event_completed in completed.values():
                self.assertFalse(
                    event_completed.wait(timeout=0.2),
                    "Source writer crossed briefing final locks before cache commit",
                )

            saved = save_project_memory_summary_cache(
                final_session,
                project_id=project_id,
                summary_type="briefing:status",
                language="zh",
                memory_version=source_version,
                content=provider_result,
            )
            self.assertEqual(saved.content, provider_result)

        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "Briefing source writer hung")
        self.assertEqual(writer_errors, [])

        with Session(self.engine) as verify:
            current_briefing = projects_briefing._build_project_briefing(
                verify,
                project_id,
            )
            current_source_version = projects_briefing._briefing_source_version(
                current_briefing,
                "status",
            )
            self.assertNotEqual(current_source_version, source_version)
            old_cache = get_project_memory_summary_cache(
                verify,
                project_id=project_id,
                summary_type="briefing:status",
                language="zh",
                memory_version=source_version,
            )
            new_cache = get_project_memory_summary_cache(
                verify,
                project_id=project_id,
                summary_type="briefing:status",
                language="zh",
                memory_version=current_source_version,
            )
            self.assertIsNotNone(old_cache)
            self.assertIsNone(new_cache)

    def test_project_rebuild_final_source_locks_hold_every_family_through_save(
        self,
    ) -> None:
        """A rebuilt memory version linearizes before all later source edits."""

        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL project-memory source-lock contract")

        with Session(self.engine) as setup:
            actor = User(email="project-memory-lock-owner@example.com", password_hash="x")
            setup.add(actor)
            setup.flush()
            client = ClientRecord(
                name="Project Memory Lock Client",
                created_by_user_id=int(actor.id),
            )
            setup.add(client)
            setup.flush()
            project = Project(
                name="Project Memory Lock Project",
                client=client.name,
                client_id=int(client.id),
                memory_stale=True,
                memory_version=0,
                memory_rebuild_status="queued",
            )
            setup.add(project)
            setup.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="owner",
            )
            progress = ProjectProgressUpdate(
                project_id=int(project.id),
                content="Old progress",
                created_by_user_id=int(actor.id),
            )
            milestone = Milestone(
                project_id=int(project.id),
                title="Old milestone",
            )
            todo = ProjectTodo(
                project_id=int(project.id),
                content="Old todo",
            )
            project_file = ProjectFile(
                project_id=int(project.id),
                name="old-source.md",
                file_type="md",
                path=f"projects/{project.id}/old-source.md",
                size_bytes=10,
                summary="Old file summary",
            )
            payment = ProjectPayment(
                project_id=int(project.id),
                amount=100,
                payment_date="2026-08-30",
                note="Old payment",
            )
            candidate = MemoryCandidate(
                owner_user_id=int(actor.id),
                scope="project",
                candidate_type="memory_fact",
                content="Old accepted candidate",
                content_sha256="old-candidate",
                project_id=int(project.id),
                status="accepted",
                target_slot="key_risks",
            )
            stakeholder = ClientStakeholder(
                client_id=int(client.id),
                name="Old stakeholder",
                note="Old stakeholder note",
            )
            for row in (
                membership,
                progress,
                milestone,
                todo,
                project_file,
                payment,
                candidate,
                stakeholder,
            ):
                setup.add(row)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(project)
            actor_id = int(actor.id)
            project_id = int(project.id)
            source_rows = {
                "progress": (ProjectProgressUpdate, int(progress.id), "content", "New progress"),
                "milestone": (Milestone, int(milestone.id), "title", "New milestone"),
                "todo": (ProjectTodo, int(todo.id), "content", "New todo"),
                "file": (ProjectFile, int(project_file.id), "summary", "New file summary"),
                "payment": (ProjectPayment, int(payment.id), "note", "New payment"),
                "candidate": (MemoryCandidate, int(candidate.id), "content", "New accepted candidate"),
                "stakeholder": (ClientStakeholder, int(stakeholder.id), "note", "New stakeholder note"),
            }
            provider_payload = projects_deps._default_project_memory(project)
            provider_payload["project_brief"] = "Provider result from old sources"

        started = {kind: threading.Event() for kind in source_rows}
        completed = {kind: threading.Event() for kind in source_rows}
        writer_errors: list[BaseException] = []

        def update_source(kind: str) -> None:
            model, row_id, field, value = source_rows[kind]
            try:
                with Session(self.engine) as writer:
                    writer.exec(text("SET LOCAL lock_timeout = '120s'"))
                    started[kind].set()
                    row = writer.exec(
                        select(model)
                        .where(model.id == row_id)
                        .execution_options(populate_existing=True)
                        .with_for_update()
                    ).one()
                    setattr(row, field, value)
                    writer.add(row)
                    writer.commit()
                completed[kind].set()
            except BaseException as exc:  # pragma: no cover - asserted below
                writer_errors.append(exc)
                completed[kind].set()

        threads = {
            kind: threading.Thread(
                target=update_source,
                args=(kind,),
                daemon=True,
            )
            for kind in source_rows
        }
        original_save = projects_deps.save_project_memory
        final_save_checked = False

        def save_while_sources_are_locked(*args, **kwargs):
            nonlocal final_save_checked
            final_save_checked = True
            for thread in threads.values():
                thread.start()
            for event_started in started.values():
                self.assertTrue(event_started.wait(timeout=10))
            for event_completed in completed.values():
                self.assertFalse(
                    event_completed.wait(timeout=0.15),
                    "Project source writer crossed final locks before memory save",
                )
            result = original_save(*args, **kwargs)
            for thread in threads.values():
                thread.join(timeout=10)
                self.assertFalse(thread.is_alive(), "Project source writer hung")
            return result

        async def return_old_source_memory(**_kwargs):
            return json.dumps(provider_payload)

        with Session(self.engine) as rebuild_session:
            actor = rebuild_session.get(User, actor_id)
            self.assertIsNotNone(actor)
            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=return_old_source_memory,
            ), patch.object(
                projects_deps,
                "save_project_memory",
                new=save_while_sources_are_locked,
            ):
                saved_memory = asyncio.run(
                    projects_deps._rebuild_project_memory(
                        rebuild_session,
                        project_id,
                        trigger="manual",
                        actor_user_id=actor_id,
                    )
                )

        self.assertTrue(final_save_checked)
        self.assertEqual(writer_errors, [])
        self.assertEqual(saved_memory["project_brief"], "Provider result from old sources")
        with Session(self.engine) as verify:
            states = get_project_memory_slot_states(verify, project_id)
            self.assertTrue(
                any(state["status"] == "stale" for state in states),
                "Later source commits must invalidate the older linearized memory view",
            )

    def test_client_rebuild_cancel_during_provider_discards_old_generation(
        self,
    ) -> None:
        """A committed cancel owns the generation before the provider returns."""

        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL client-memory cancel-generation contract")

        with Session(self.engine) as setup:
            actor = User(
                email="client-memory-cancel-admin@example.com",
                password_hash="x",
                is_admin=True,
            )
            setup.add(actor)
            setup.flush()
            client = ClientRecord(
                name="Client Memory Cancel Race",
                created_by_user_id=int(actor.id),
                client_memory_json="{}",
                client_memory_version=0,
                client_memory_stale=True,
                client_memory_rebuild_status="queued",
            )
            setup.add(client)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(client)
            actor_id = int(actor.id)
            client_id = int(client.id)

        async def scenario() -> None:
            provider_started = asyncio.Event()
            release_provider = asyncio.Event()

            async def blocked_provider(**_kwargs):
                provider_started.set()
                await release_provider.wait()
                return "{}"

            with patch.object(
                clients_deps,
                "engine",
                self.engine,
            ), patch.object(
                clients_deps,
                "_current_complete_with_selected_model",
                return_value=blocked_provider,
            ), patch.object(
                clients_deps,
                "_schedule_client_memory_summary_warm",
            ) as schedule_warm, patch.object(
                clients_memory.scheduler_service,
                "remove_job",
            ):
                rebuild_task = asyncio.create_task(
                    clients_deps._run_client_memory_rebuild_job(client_id)
                )
                await asyncio.wait_for(provider_started.wait(), timeout=10)

                with Session(self.engine) as cancel_session:
                    actor = cancel_session.get(User, actor_id)
                    self.assertIsNotNone(actor)
                    clients_memory.cancel_client_memory_jobs(
                        client_id,
                        cancel_session,
                        actor,
                    )

                release_provider.set()
                await asyncio.wait_for(rebuild_task, timeout=10)
                schedule_warm.assert_not_called()

        asyncio.run(scenario())

        with Session(self.engine) as verify:
            client = verify.get(ClientRecord, client_id)
            snapshots = verify.exec(
                select(ClientMemorySnapshot).where(
                    ClientMemorySnapshot.client_id == client_id
                )
            ).all()
            self.assertIsNotNone(client)
            self.assertEqual(client.client_memory_rebuild_status, "idle")
            self.assertEqual(int(client.client_memory_version or 0), 0)
            raw_memory = json.loads(client.client_memory_json or "{}")
            self.assertNotIn("client_profile", raw_memory)
            self.assertNotIn("_last_failure", raw_memory)
            self.assertEqual(snapshots, [])


if __name__ == "__main__":
    unittest.main()
