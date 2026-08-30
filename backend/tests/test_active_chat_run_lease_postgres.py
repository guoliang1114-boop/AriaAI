"""PostgreSQL row-lock contract for active ChatRun lease fencing.

The production-database E2E workflow runs this file only inside its disposable
``ariaai_test_*`` schema; it never mutates ``public`` application tables.
"""
from __future__ import annotations

import threading
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from sqlmodel import Session, SQLModel, select

from app.models.db import ChatRun, Conversation, Message, TaskEvent
from app.services.agent_harness import active_run_lease as lease_service
from app.services.agent_harness.active_run_lease import (
    ChatRunLeaseError,
    new_chat_run_lease,
    reap_stale_chat_runs,
)
from app.services.agent_harness.run_rollout import (
    begin_chat_rollout,
    finalize_chat_rollout,
)
from app.services.time_utils import utc_now_naive
from tests.test_database import create_test_engine, drop_all_tables


class ActiveChatRunLeasePostgresTests(unittest.TestCase):
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

    def _start_run(self, run_id: str):
        with Session(self.engine) as session:
            conversation = Conversation(title="PostgreSQL lease fencing")
            session.add(conversation)
            session.flush()
            session.add(
                Message(
                    conversation_id=int(conversation.id),
                    role="user",
                    content="private postgres lease request",
                )
            )
            session.commit()
            conversation_id = int(conversation.id)
        runtime = SimpleNamespace(
            conv_id=conversation_id,
            project_id=None,
            selected_model="provider-model",
            chat_mode="agent",
            action_policy="read_only_tool",
            context_manifest={},
            skill_id=None,
            skill_name="",
        )
        lease = new_chat_run_lease(owner="worker_pg")
        task_id = begin_chat_rollout(
            self.engine,
            runtime,
            "private postgres lease request",
            run_id,
            lease=lease,
        )
        return task_id, lease

    def test_expired_reaper_wins_terminal_race_and_fences_late_finalizer(self) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL FOR UPDATE contract")
        task_id, lease = self._start_run("run_pg_expired_race")
        now = utc_now_naive()
        with Session(self.engine) as session:
            run = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_pg_expired_race")
            ).one()
            run.lease_expires_at = now - timedelta(seconds=1)
            session.add(run)
            session.commit()

        reaper_locked = threading.Event()
        release_reaper = threading.Event()
        finalizer_started = threading.Event()
        reaper_result = []
        finalizer_errors: list[BaseException] = []
        original_append = lease_service._append_interrupted_event

        def blocking_append(*args, **kwargs):
            reaper_locked.set()
            if not release_reaper.wait(timeout=10):
                raise AssertionError("Timed out waiting to release ChatRun reaper")
            return original_append(*args, **kwargs)

        def reap() -> None:
            try:
                with Session(self.engine) as session:
                    reaper_result.append(reap_stale_chat_runs(session, now=now))
            except BaseException as exc:  # pragma: no cover - surfaced below
                finalizer_errors.append(exc)

        def finalize() -> None:
            finalizer_started.set()
            try:
                finalize_chat_rollout(
                    self.engine,
                    task_id,
                    status="completed",
                    phase="persist",
                    lease=lease,
                )
            except BaseException as exc:
                finalizer_errors.append(exc)

        with patch.object(lease_service, "_append_interrupted_event", blocking_append):
            reaper_thread = threading.Thread(target=reap)
            reaper_thread.start()
            self.assertTrue(reaper_locked.wait(timeout=10))
            finalizer_thread = threading.Thread(target=finalize)
            finalizer_thread.start()
            self.assertTrue(finalizer_started.wait(timeout=10))
            release_reaper.set()
            reaper_thread.join(timeout=10)
            finalizer_thread.join(timeout=10)

        self.assertFalse(reaper_thread.is_alive())
        self.assertFalse(finalizer_thread.is_alive())
        self.assertEqual(reaper_result[0].reaped, 1)
        self.assertTrue(
            any(isinstance(exc, ChatRunLeaseError) for exc in finalizer_errors),
            finalizer_errors,
        )
        with Session(self.engine) as session:
            run = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_pg_expired_race")
            ).one()
            events = session.exec(
                select(TaskEvent).where(TaskEvent.task_run_id == task_id)
            ).all()
            self.assertEqual(run.status, "interrupted")
            self.assertEqual(
                [event.event_type for event in events].count("run_interrupted"),
                1,
            )
            self.assertNotIn("run_completed", [event.event_type for event in events])

    def test_reaper_skips_row_locked_by_live_worker_renewal(self) -> None:
        if self.engine.dialect.name != "postgresql":
            self.skipTest("PostgreSQL SKIP LOCKED contract")
        self._start_run("run_pg_live_lock")
        now = utc_now_naive()
        results = []
        errors: list[BaseException] = []

        # Commit an expired candidate first. The owner then locks and renews it
        # without committing, so a concurrent reaper sees the old expired row
        # but must skip its lock instead of waiting or recording interruption.
        with Session(self.engine) as session:
            run = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_pg_live_lock")
            ).one()
            run.lease_expires_at = now - timedelta(seconds=1)
            session.add(run)
            session.commit()

        with Session(self.engine) as owner_session:
            run = owner_session.exec(
                select(ChatRun)
                .where(ChatRun.run_id == "run_pg_live_lock")
                .with_for_update()
            ).one()
            run.last_heartbeat_at = now
            run.lease_expires_at = now + timedelta(minutes=2)
            owner_session.add(run)
            owner_session.flush()

            def reap() -> None:
                try:
                    with Session(self.engine) as session:
                        results.append(reap_stale_chat_runs(session, now=now))
                except BaseException as exc:  # pragma: no cover - surfaced below
                    errors.append(exc)

            thread = threading.Thread(target=reap)
            thread.start()
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive())
            owner_session.commit()

        self.assertEqual(errors, [])
        self.assertEqual(results[0].reaped, 0)
        with Session(self.engine) as session:
            run = session.exec(
                select(ChatRun).where(ChatRun.run_id == "run_pg_live_lock")
            ).one()
            self.assertEqual(run.status, "running")


if __name__ == "__main__":
    unittest.main()
