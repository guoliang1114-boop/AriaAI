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


class ClientMemoryJobsTestCase(unittest.TestCase):
    def setUp(self):
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = db_path
        self.engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
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
        Path(self.db_path).unlink(missing_ok=True)

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


if __name__ == "__main__":
    unittest.main()
