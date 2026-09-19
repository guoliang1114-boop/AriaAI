from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ClientMemorySnapshot, ClientRecord, User
from app.routers import clients as clients_router_module
from app.routers import clients_deps, clients_memory, memory_operations
from app.routers.auth import get_current_user
from app.services.client_contexts import get_client_memory_payload, parse_client_memory
from tests.test_database import create_test_engine, drop_all_tables


class ClientMemoryJobsTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(
                User(
                    id=1,
                    email="test@example.com",
                    display_name="Test",
                    password_hash="h",
                    is_admin=True,
                )
            )
            session.commit()

        def override_session():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(clients_router_module.router)
        app.include_router(memory_operations.router)
        app.dependency_overrides[clients_router_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = lambda: User(
            id=1,
            email="test@example.com",
            display_name="Test",
            password_hash="h",
            is_admin=True,
        )
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_missing_queued_job_remains_visible_without_recovery_on_read(self):
        with Session(self.engine) as session:
            client = ClientRecord(
                name="Queued Client",
                client_memory_version=0,
                client_memory_stale=True,
                client_memory_rebuild_status="queued",
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = client.id

        with patch.object(clients_router_module.scheduler_service, "is_running", return_value=True), patch.object(
            clients_router_module.scheduler_service, "get_jobs", return_value=[]
        ), patch.object(clients_router_module.scheduler_service, "add_or_replace_date_job") as add_job:
            resp = self.client.get("/clients/memory/jobs")

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["jobs"][0]["client_id"], client_id)
        self.assertEqual(body["jobs"][0]["job_type"], "rebuild")
        self.assertEqual(body["jobs"][0]["status_source"], "client_status")
        self.assertEqual(body["jobs"][0]["status_note"], "queued")
        self.assertEqual(body["jobs"][0]["trigger"], "status_only")
        add_job.assert_not_called()

        with Session(self.engine) as session:
            refreshed = session.get(ClientRecord, client_id)
            self.assertEqual(refreshed.client_memory_rebuild_status, "queued")

    def test_job_and_operations_reads_preserve_memory_failure_and_schedule_state(self):
        failed_at = datetime(2026, 9, 19, 12, 0)
        with Session(self.engine) as session:
            for status, version, stale in (
                ("idle", 0, True),
                ("failed", 3, True),
                ("queued", 3, True),
                ("rebuilding", 3, True),
                ("idle", 0, False),
            ):
                session.add(ClientRecord(
                    name=f"Read-only {status} {stale}",
                    client_memory_version=version,
                    client_memory_stale=stale,
                    client_memory_rebuild_status=status,
                    client_memory_rebuild_failed_at=failed_at,
                    client_memory_last_failure_json=json.dumps({
                        "stage": "rebuild",
                        "message": "Invalid memory payload",
                        "failed_at": failed_at.isoformat(),
                    }),
                ))
            session.commit()
            before = {row.id: row.model_dump() for row in session.exec(select(ClientRecord)).all()}

        for path in ("/clients/memory/jobs", "/memory/operations/summary"):
            with self.subTest(path=path), patch.object(
                clients_router_module.scheduler_service, "is_running", return_value=True
            ), patch.object(
                clients_router_module.scheduler_service, "get_jobs", return_value=[]
            ), patch.object(
                clients_router_module.scheduler_service, "add_or_replace_date_job"
            ) as add_job, patch.object(
                clients_router_module.scheduler_service, "remove_job"
            ) as remove_job:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                add_job.assert_not_called()
                remove_job.assert_not_called()
                body = response.json()
                jobs = body["jobs"] if path == "/clients/memory/jobs" else body["pages"]["jobs"]["items"]
                self.assertEqual(len(jobs), 2)
                self.assertEqual({job["status_note"] for job in jobs}, {"queued", "rebuilding"})
                self.assertTrue(all(job["trigger"] == "status_only" for job in jobs))
                with Session(self.engine) as session:
                    after = {row.id: row.model_dump() for row in session.exec(select(ClientRecord)).all()}
                    self.assertEqual(after, before)
                    self.assertEqual(session.exec(select(ClientMemorySnapshot)).all(), [])

    def test_existing_scheduler_job_is_reported_once(self):
        with Session(self.engine) as session:
            client = ClientRecord(name="Scheduled", client_memory_rebuild_status="queued")
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = client.id
        job = SimpleNamespace(
            id=f"client_memory_rebuild_{client_id}",
            next_run_time=datetime.utcnow() + timedelta(minutes=5),
        )
        with patch.object(clients_router_module.scheduler_service, "get_jobs", return_value=[job]):
            response = self.client.get("/clients/memory/jobs")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 1)
        self.assertEqual(response.json()["jobs"][0]["job_id"], job.id)

    def test_batch_rebuild_queues_clients_when_scheduler_is_running(self):
        with Session(self.engine) as session:
            first = ClientRecord(name="First Client", client_memory_stale=True)
            second = ClientRecord(name="Second Client", client_memory_stale=True)
            session.add(first)
            session.add(second)
            session.commit()
            session.refresh(first)
            session.refresh(second)
            client_ids = [first.id, second.id]

        with patch.object(clients_router_module.scheduler_service, "is_running", return_value=True), patch.object(
            clients_router_module.scheduler_service, "get_job", return_value=None
        ), patch.object(clients_router_module.scheduler_service, "add_or_replace_date_job") as add_job:
            resp = self.client.post(
                "/clients/memory/rebuild-batch",
                json={"client_ids": client_ids, "stale_only": True},
            )

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["rebuilt_count"], 0)
        self.assertEqual(body["queued_count"], 2)
        self.assertEqual([item["client_id"] for item in body["queued"]], client_ids)
        self.assertEqual(add_job.call_count, 2)

        with Session(self.engine) as session:
            refreshed = [session.get(ClientRecord, client_id) for client_id in client_ids]
            self.assertEqual([client.client_memory_rebuild_status for client in refreshed], ["queued", "queued"])

    def test_client_memory_parser_extracts_json_from_model_text(self):
        client = ClientRecord(name="JSON Client", industry="Tech")
        raw = """Here is the memory:
```json
{"client_profile":"Tech account","decision_patterns":["fast"],"project_history":[]}
```
"""

        memory = parse_client_memory(raw, client)

        self.assertEqual(memory["client_profile"], "Tech account")
        self.assertEqual(memory["decision_patterns"], ["fast"])
        self.assertEqual(memory["project_history"], [])

    def test_client_memory_parser_falls_back_to_default_for_non_json_text(self):
        client = ClientRecord(name="Fallback Client", industry="Tech")

        memory = parse_client_memory("The service is temporarily unavailable.", client)

        self.assertEqual(memory["client_profile"], "Fallback Client")
        self.assertEqual(memory["decision_patterns"], [])
        self.assertEqual(memory["project_history"], [])

    def _run_cancel_during_provider(
        self,
        *,
        requeue: bool,
        provider_raises: bool = False,
    ) -> int:
        with Session(self.engine) as session:
            client = ClientRecord(
                name=f"Cancel Race {'ABA' if requeue else 'Idle'}",
                created_by_user_id=1,
                client_memory_json="{}",
                client_memory_version=0,
                client_memory_stale=True,
                client_memory_rebuild_status="queued",
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = int(client.id)

        async def scenario() -> None:
            provider_started = asyncio.Event()
            release_provider = asyncio.Event()

            async def blocked_provider(**_kwargs):
                provider_started.set()
                await release_provider.wait()
                if provider_raises:
                    raise RuntimeError("provider failed after cancellation")
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
                await asyncio.wait_for(provider_started.wait(), timeout=2)

                with Session(self.engine) as cancel_session:
                    admin = cancel_session.get(User, 1)
                    assert admin is not None
                    clients_memory.cancel_client_memory_jobs(
                        client_id,
                        cancel_session,
                        admin,
                    )

                if requeue:
                    with Session(self.engine) as requeue_session:
                        current = requeue_session.get(ClientRecord, client_id)
                        assert current is not None
                        current.client_memory_rebuild_status = "rebuilding"
                        requeue_session.add(current)
                        requeue_session.commit()

                release_provider.set()
                await asyncio.wait_for(rebuild_task, timeout=2)
                schedule_warm.assert_not_called()

        asyncio.run(scenario())
        return client_id

    def test_cancel_during_provider_discards_old_client_rebuild(self):
        client_id = self._run_cancel_during_provider(requeue=False)

        with Session(self.engine) as session:
            client = session.get(ClientRecord, client_id)
            snapshots = session.exec(
                select(ClientMemorySnapshot).where(
                    ClientMemorySnapshot.client_id == client_id
                )
            ).all()
        self.assertIsNotNone(client)
        self.assertEqual(client.client_memory_rebuild_status, "idle")
        self.assertEqual(client.client_memory_version, 0)
        self.assertNotIn("client_profile", json.loads(client.client_memory_json))
        self.assertNotIn("_last_failure", json.loads(client.client_memory_json))
        self.assertNotIn("_rebuild_generation", get_client_memory_payload(client))
        self.assertEqual(snapshots, [])

    def test_cancel_then_requeue_aba_still_discards_old_client_rebuild(self):
        client_id = self._run_cancel_during_provider(requeue=True)

        with Session(self.engine) as session:
            client = session.get(ClientRecord, client_id)
            snapshots = session.exec(
                select(ClientMemorySnapshot).where(
                    ClientMemorySnapshot.client_id == client_id
                )
            ).all()
        self.assertIsNotNone(client)
        self.assertEqual(client.client_memory_rebuild_status, "rebuilding")
        self.assertEqual(client.client_memory_version, 0)
        self.assertNotIn("client_profile", json.loads(client.client_memory_json))
        self.assertNotIn("_last_failure", json.loads(client.client_memory_json))
        self.assertNotIn("_rebuild_generation", get_client_memory_payload(client))
        self.assertEqual(snapshots, [])

    def test_cancel_then_requeue_provider_failure_does_not_write_old_receipt(self):
        client_id = self._run_cancel_during_provider(
            requeue=True,
            provider_raises=True,
        )

        with Session(self.engine) as session:
            client = session.get(ClientRecord, client_id)
            snapshots = session.exec(
                select(ClientMemorySnapshot).where(
                    ClientMemorySnapshot.client_id == client_id
                )
            ).all()
        self.assertIsNotNone(client)
        self.assertEqual(client.client_memory_rebuild_status, "rebuilding")
        self.assertEqual(client.client_memory_version, 0)
        self.assertNotIn("_last_failure", json.loads(client.client_memory_json))
        self.assertEqual(snapshots, [])

    def test_cancel_after_job_claim_before_rebuild_start_discards_job(self):
        with Session(self.engine) as session:
            client = ClientRecord(
                name="Cancel Before Provider",
                created_by_user_id=1,
                client_memory_json="{}",
                client_memory_version=0,
                client_memory_stale=True,
                client_memory_rebuild_status="queued",
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = int(client.id)

        real_rebuild = clients_deps._rebuild_client_memory
        start_contract: dict[str, str | None] = {}

        async def cancel_before_rebuild(session, current_client_id, **kwargs):
            start_contract["status"] = kwargs.get("start_rebuild_status")
            start_contract["generation"] = kwargs.get("start_rebuild_generation")
            with Session(self.engine) as cancel_session:
                admin = cancel_session.get(User, 1)
                assert admin is not None
                clients_memory.cancel_client_memory_jobs(
                    current_client_id,
                    cancel_session,
                    admin,
                )
            return await real_rebuild(session, current_client_id, **kwargs)

        async def provider_must_not_run(**_kwargs):
            raise AssertionError("cancelled job reached the provider")

        async def scenario() -> None:
            with patch.object(
                clients_deps,
                "engine",
                self.engine,
            ), patch.object(
                clients_deps,
                "_rebuild_client_memory",
                new=cancel_before_rebuild,
            ), patch.object(
                clients_deps,
                "_current_complete_with_selected_model",
                return_value=provider_must_not_run,
            ), patch.object(
                clients_memory.scheduler_service,
                "remove_job",
            ):
                await clients_deps._run_client_memory_rebuild_job(client_id)

        asyncio.run(scenario())

        self.assertEqual(start_contract["status"], "rebuilding")
        self.assertEqual(start_contract["generation"], "")
        with Session(self.engine) as session:
            client = session.get(ClientRecord, client_id)
        self.assertIsNotNone(client)
        self.assertEqual(client.client_memory_rebuild_status, "idle")
        self.assertEqual(client.client_memory_version, 0)
        self.assertNotIn("_last_failure", json.loads(client.client_memory_json))

    def test_cancelled_client_job_is_not_reclaimed_after_status_is_idle(self):
        with Session(self.engine) as session:
            client = ClientRecord(
                name="Already Cancelled Client Job",
                created_by_user_id=1,
                client_memory_json="{}",
                client_memory_version=0,
                client_memory_stale=True,
                client_memory_rebuild_status="idle",
            )
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = int(client.id)

        async def scenario() -> None:
            with patch.object(
                clients_deps,
                "engine",
                self.engine,
            ), patch.object(
                clients_deps,
                "_rebuild_client_memory",
            ) as rebuild:
                await clients_deps._run_client_memory_rebuild_job(client_id)
                rebuild.assert_not_called()

        asyncio.run(scenario())

        with Session(self.engine) as session:
            client = session.get(ClientRecord, client_id)
        self.assertIsNotNone(client)
        self.assertEqual(client.client_memory_rebuild_status, "idle")
        self.assertEqual(client.client_memory_version, 0)


if __name__ == "__main__":
    unittest.main()
