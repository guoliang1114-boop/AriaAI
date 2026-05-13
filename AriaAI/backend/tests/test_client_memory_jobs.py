from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import ClientRecord
from app.routers import clients as clients_router_module
from app.services.client_contexts import parse_client_memory
from tests.test_database import create_test_engine, drop_all_tables


class ClientMemoryJobsTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(clients_router_module.router)
        app.dependency_overrides[clients_router_module.get_session] = override_session
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_missing_rebuild_job_is_restored_from_stale_client_status(self):
        with Session(self.engine) as session:
            client = ClientRecord(
                name="Queued Client",
                client_memory_version=0,
                client_memory_stale=True,
                client_memory_rebuild_status="idle",
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
        self.assertTrue(add_job.called)

        with Session(self.engine) as session:
            refreshed = session.get(ClientRecord, client_id)
            self.assertEqual(refreshed.client_memory_rebuild_status, "queued")

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


if __name__ == "__main__":
    unittest.main()
