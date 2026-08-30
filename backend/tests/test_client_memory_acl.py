from __future__ import annotations

import json
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, select

from app.models.db import (
    ClientMemorySummary,
    ClientRecord,
    Project,
    ProjectMember,
    User,
)
from app.routers import clients as clients_router_module
from app.routers import clients_memory as clients_memory_module
from app.routers.auth import get_current_user
from tests.test_database import create_test_engine, drop_all_tables


_MEMORY_PAYLOAD = {
    "client_profile": "Strategic account",
    "decision_patterns": ["Needs proof before scale"],
    "key_contacts": [],
    "structured_stakeholders": [],
    "lessons_learned": [],
    "relationship_signals": [],
    "project_history": [],
    "sensitive_topics": [],
}


class ClientMemoryAclTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            users = [
                User(
                    id=1,
                    email="admin-memory-acl@example.com",
                    display_name="Admin",
                    password_hash="h",
                    is_admin=True,
                ),
                User(
                    id=2,
                    email="owner-memory-acl@example.com",
                    display_name="Owner",
                    password_hash="h",
                ),
                User(
                    id=3,
                    email="viewer-memory-acl@example.com",
                    display_name="Viewer",
                    password_hash="h",
                ),
                User(
                    id=4,
                    email="outsider-memory-acl@example.com",
                    display_name="Outsider",
                    password_hash="h",
                ),
                User(
                    id=5,
                    email="editor-memory-acl@example.com",
                    display_name="Editor",
                    password_hash="h",
                ),
            ]
            session.add_all(users)
            session.commit()

            client = ClientRecord(
                name="ACL Client",
                created_by_user_id=2,
                client_memory_json=json.dumps(_MEMORY_PAYLOAD),
                client_memory_version=1,
                client_memory_stale=False,
            )
            session.add(client)
            session.flush()
            project = Project(
                name="ACL Project",
                client=client.name,
                client_id=client.id,
            )
            session.add(project)
            session.flush()
            session.add_all(
                [
                    ProjectMember(project_id=project.id, user_id=3, role="viewer"),
                    ProjectMember(project_id=project.id, user_id=5, role="editor"),
                ]
            )
            session.add(
                ClientMemorySummary(
                    client_id=client.id,
                    summary_type="overview",
                    language="zh",
                    memory_version=1,
                    content="cached overview",
                )
            )
            session.commit()
            self.client_id = int(client.id)
            self.project_id = int(project.id)

        self.current_user_id = 1

        def override_session():
            with Session(self.engine) as session:
                yield session

        def override_current_user():
            with Session(self.engine) as session:
                return session.get(User, self.current_user_id)

        app = FastAPI()
        app.include_router(clients_router_module.router)
        app.dependency_overrides[clients_router_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = override_current_user
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_all_client_memory_reads_require_client_access(self):
        self.current_user_id = 4
        paths = [
            f"/clients/{self.client_id}/memory",
            f"/clients/{self.client_id}/memory/status",
            f"/clients/{self.client_id}/memory/slots",
            f"/clients/{self.client_id}/memory/facts",
            f"/clients/{self.client_id}/memory/snapshots",
            f"/clients/{self.client_id}/memory/snapshots/999",
            f"/clients/{self.client_id}/memory/snapshots/999/diff",
            f"/clients/{self.client_id}/memory/summaries/overview",
        ]

        for path in paths:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 403)

        self.current_user_id = 3
        response = self.client.get(f"/clients/{self.client_id}/memory")
        self.assertEqual(response.status_code, 200)

    def test_all_record_writes_require_client_write_access(self):
        self.current_user_id = 3
        requests = [
            (
                f"/clients/{self.client_id}/memory/snapshots/999/rollback",
                None,
            ),
            (f"/clients/{self.client_id}/memory/rebuild", None),
            (
                f"/clients/{self.client_id}/memory/promote-project",
                {"project_id": self.project_id},
            ),
            (
                f"/clients/{self.client_id}/memory/summarize",
                {"language": "zh", "summary_type": "overview"},
            ),
        ]

        for path, payload in requests:
            with self.subTest(path=path):
                response = self.client.post(path, json=payload)
                self.assertEqual(response.status_code, 403)

        self.current_user_id = 5
        response = self.client.post(
            f"/clients/{self.client_id}/memory/summarize",
            json={"language": "zh", "summary_type": "overview"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["cached"])

    def test_all_memory_job_and_batch_operations_require_admin(self):
        self.current_user_id = 2
        requests = [
            ("get", "/clients/memory/jobs", None),
            (
                "post",
                f"/clients/memory/jobs/{self.client_id}/cancel",
                None,
            ),
            (
                "post",
                f"/clients/memory/jobs/{self.client_id}/run-now",
                None,
            ),
            (
                "post",
                "/clients/memory/rebuild-batch",
                {"client_ids": [self.client_id]},
            ),
            (
                "post",
                "/clients/memory/warm-summaries-batch",
                {"client_ids": [self.client_id]},
            ),
        ]

        for method, path, payload in requests:
            with self.subTest(path=path):
                response = self.client.request(method, path, json=payload)
                self.assertEqual(response.status_code, 403)

    def test_rebuild_rechecks_active_user_after_provider_wait_before_save(self):
        self.current_user_id = 2
        with Session(self.engine) as session:
            client = session.get(ClientRecord, self.client_id)
            client.client_memory_json = "{}"
            client.client_memory_version = 0
            client.client_memory_stale = True
            session.add(client)
            session.commit()

        async def deactivate_actor(**_kwargs):
            with Session(self.engine) as session:
                actor = session.get(User, 2)
                actor.is_active = False
                session.add(actor)
                session.commit()
            return json.dumps(_MEMORY_PAYLOAD)

        with patch.object(
            clients_router_module,
            "complete_with_selected_model",
            new=AsyncMock(side_effect=deactivate_actor),
        ):
            response = self.client.post(
                f"/clients/{self.client_id}/memory/rebuild"
            )

        self.assertEqual(response.status_code, 403)
        with Session(self.engine) as session:
            client = session.get(ClientRecord, self.client_id)
            self.assertEqual(client.client_memory_version, 0)
            self.assertEqual(client.client_memory_json, "{}")

    def test_summary_rechecks_ownership_after_provider_wait_before_save(self):
        self.current_user_id = 2

        async def transfer_client(**_kwargs):
            with Session(self.engine) as session:
                client = session.get(ClientRecord, self.client_id)
                client.created_by_user_id = 1
                session.add(client)
                session.commit()
            return "fresh summary"

        with patch.object(
            clients_router_module,
            "complete_with_selected_model",
            new=AsyncMock(side_effect=transfer_client),
        ):
            response = self.client.post(
                f"/clients/{self.client_id}/memory/summarize",
                json={
                    "language": "en",
                    "summary_type": "risk",
                    "force_refresh": True,
                },
            )

        self.assertEqual(response.status_code, 403)
        with Session(self.engine) as session:
            summaries = session.exec(
                select(ClientMemorySummary).where(
                    ClientMemorySummary.client_id == self.client_id,
                    ClientMemorySummary.summary_type == "risk",
                )
            ).all()
            self.assertEqual(summaries, [])

    def test_manual_rebuild_reauthorizes_before_scheduling_summary_warm(self):
        self.current_user_id = 2

        async def rebuild_then_deactivate(*_args, **_kwargs):
            with Session(self.engine) as session:
                actor = session.get(User, 2)
                actor.is_active = False
                session.add(actor)
                session.commit()
            return dict(_MEMORY_PAYLOAD)

        with (
            patch.object(
                clients_memory_module,
                "_rebuild_client_memory",
                new=AsyncMock(side_effect=rebuild_then_deactivate),
            ),
            patch.object(
                clients_memory_module,
                "_schedule_client_memory_summary_warm",
            ) as schedule_warm,
        ):
            response = self.client.post(
                f"/clients/{self.client_id}/memory/rebuild"
            )

        self.assertEqual(response.status_code, 403)
        schedule_warm.assert_not_called()


if __name__ == "__main__":
    unittest.main()
