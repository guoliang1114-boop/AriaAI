"""Integration tests for clients router — CRUD endpoints with TestClient."""
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientMemoryFact,
    ClientMemorySlot,
    ClientMemorySnapshot,
    ClientMemorySummary,
    ClientRecord,
    ClientStakeholder,
    ClientStakeholderHistory,
    KnowledgeDocument,
    MemoryCandidate,
    Project,
    ProjectMember,
    User,
)
from app.routers import clients as clients_module
from app.routers import clients_stakeholders as clients_stakeholders_module
from app.routers.auth import get_current_user
from app.routers.clients import router
from app.services.cache import clients_cache
from tests.test_database import create_test_engine, drop_all_tables


def _override_admin_user():
    """Shared dependency override for R74 router-level auth floor.

    Tests in this module construct their own FastAPI app per setUp
    and don't otherwise carry an auth token — the override returns a
    canned admin user so the router-level ``Depends(get_current_user)``
    resolves instead of 401-ing."""
    return User(
        id=1, email="test@example.com", display_name="Test", is_admin=True
    )


class ClientsCrudTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            user = User(email="admin@test.com", password_hash="h", display_name="Admin", is_admin=True)
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user_id = user.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[clients_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = _override_admin_user

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)
        clients_cache.clear()

    def tearDown(self):
        clients_cache.clear()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _create_client(self, name="TestCorp", industry="Tech"):
        resp = self.client.post("/clients", json={"name": name, "industry": industry})
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def test_create_client(self):
        data = self._create_client("Acme Corp", "Finance")
        self.assertEqual(data["name"], "Acme Corp")
        self.assertEqual(data["industry"], "Finance")
        self.assertIn("id", data)

    def test_list_clients(self):
        self._create_client("Corp A")
        self._create_client("Corp B")
        resp = self.client.get("/clients")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 2)

    def test_get_client(self):
        created = self._create_client("GetCorp")
        resp = self.client.get(f"/clients/{created['id']}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "GetCorp")

    def test_get_nonexistent_client(self):
        resp = self.client.get("/clients/99999")
        self.assertEqual(resp.status_code, 404)

    def test_update_client(self):
        created = self._create_client("OldName")
        with Session(self.engine) as session:
            old_project = Project(
                name="Old-name project",
                client="OldName",
                client_id=created["id"],
                memory_stale=False,
            )
            new_project = Project(
                name="New-name project",
                client="NewName",
                memory_stale=False,
            )
            session.add(old_project)
            session.add(new_project)
            session.commit()
            session.refresh(old_project)
            session.refresh(new_project)
            project_ids = (old_project.id, new_project.id)
        resp = self.client.put(f"/clients/{created['id']}", json={"name": "NewName"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "NewName")
        with Session(self.engine) as session:
            renamed_project = session.get(Project, project_ids[0])
            unrelated_project = session.get(Project, project_ids[1])
            self.assertTrue(renamed_project.memory_stale)
            self.assertEqual(renamed_project.client_id, created["id"])
            self.assertEqual(renamed_project.client, "NewName")
            self.assertFalse(unrelated_project.memory_stale)
            self.assertIsNone(unrelated_project.client_id)

    def test_update_client_industry(self):
        created = self._create_client("Corp", "Old Industry")
        resp = self.client.put(f"/clients/{created['id']}", json={"industry": "New Industry"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["industry"], "New Industry")

    def test_update_client_display_case_syncs_stable_project_snapshot(self):
        created = self._create_client("Case Client")
        with Session(self.engine) as session:
            project = Project(
                name="Case-linked project",
                client="Case Client",
                client_id=created["id"],
                memory_stale=False,
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = int(project.id)

        response = self.client.put(
            f"/clients/{created['id']}",
            json={"name": "CASE CLIENT"},
        )

        self.assertEqual(response.status_code, 200)
        with Session(self.engine) as session:
            project = session.get(Project, project_id)
            self.assertEqual(project.client_id, created["id"])
            self.assertEqual(project.client, "CASE CLIENT")
            self.assertTrue(project.memory_stale)

    def test_delete_client(self):
        created = self._create_client("DeleteCorp")
        resp = self.client.delete(f"/clients/{created['id']}")
        self.assertIn(resp.status_code, [200, 204])
        resp2 = self.client.get(f"/clients/{created['id']}")
        self.assertEqual(resp2.status_code, 404)

    def test_delete_client_refuses_to_globalize_client_only_document(self):
        created = self._create_client("ScopedDocsCorp")
        with Session(self.engine) as session:
            document = KnowledgeDocument(
                name="client-only.md",
                file_type="md",
                path="/tmp/client-only.md",
                client_id=created["id"],
            )
            session.add(document)
            session.commit()
            session.refresh(document)
            document_id = int(document.id)

        response = self.client.delete(f"/clients/{created['id']}")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json()["detail"]["code"],
            "client_documents_require_reassignment",
        )
        with Session(self.engine) as session:
            self.assertIsNotNone(session.get(ClientRecord, created["id"]))
            self.assertEqual(
                session.get(KnowledgeDocument, document_id).client_id,
                created["id"],
            )

    def test_delete_client_removes_all_owned_memory_and_stakeholder_records(self):
        created = self._create_client("DeleteGraphCorp")
        client_id = created["id"]
        with Session(self.engine) as session:
            linked_project = Project(
                name="Linked project",
                client="DeleteGraphCorp",
                client_id=client_id,
                memory_stale=False,
            )
            session.add(linked_project)
            session.flush()
            stakeholder = ClientStakeholder(client_id=client_id, name="Alice")
            document = KnowledgeDocument(
                name="client-note.md",
                file_type="md",
                path="/tmp/client-note.md",
                client_id=client_id,
                project_id=int(linked_project.id),
            )
            session.add(stakeholder)
            session.add(document)
            session.commit()
            session.refresh(stakeholder)
            session.refresh(document)
            session.refresh(linked_project)
            document_id = document.id
            linked_project_id = linked_project.id
            session.add(
                ClientStakeholderHistory(
                    stakeholder_id=stakeholder.id,
                    client_id=client_id,
                    field_name="role",
                    new_value="Sponsor",
                    trigger="manual",
                )
            )
            session.add(
                ClientMemorySummary(
                    client_id=client_id,
                    summary_type="briefing",
                    language="zh",
                    memory_version=1,
                    content="summary",
                )
            )
            session.add(
                ClientMemorySnapshot(
                    client_id=client_id,
                    memory_version=1,
                    trigger="test",
                    memory_json="{}",
                )
            )
            session.add(
                ClientMemorySlot(
                    client_id=client_id,
                    slot_key="relationship_summary",
                )
            )
            session.add(
                ClientMemoryFact(
                    client_id=client_id,
                    slot_key="relationship_summary",
                    fact_key="fact-1",
                )
            )
            session.add(
                MemoryCandidate(
                    owner_user_id=self.user_id,
                    scope="client",
                    candidate_type="memory",
                    content="candidate",
                    content_sha256="delete-graph-candidate",
                    client_id=client_id,
                )
            )
            session.commit()

        resp = self.client.delete(f"/clients/{client_id}")
        self.assertIn(resp.status_code, [200, 204])

        with Session(self.engine) as session:
            self.assertIsNone(session.get(ClientRecord, client_id))
            for model in (
                ClientStakeholder,
                ClientStakeholderHistory,
                ClientMemorySummary,
                ClientMemorySnapshot,
                ClientMemorySlot,
                ClientMemoryFact,
                MemoryCandidate,
            ):
                self.assertEqual(
                    session.exec(select(model).where(model.client_id == client_id)).all(),
                    [],
                )
            document = session.get(KnowledgeDocument, document_id)
            self.assertIsNotNone(document)
            self.assertIsNone(document.client_id)
            detached_project = session.get(Project, linked_project_id)
            self.assertTrue(detached_project.memory_stale)
            self.assertIsNone(detached_project.client_id)
            self.assertEqual(detached_project.client, "DeleteGraphCorp")

    def test_delete_nonexistent_client(self):
        resp = self.client.delete("/clients/99999")
        self.assertEqual(resp.status_code, 404)

    def test_ai_suggest_uses_selected_model_adapter(self):
        with patch.object(
            clients_module,
            "complete_with_selected_model",
            new=AsyncMock(
                return_value="""```json
[
  {
    "name": "广州岭南商旅投资集团有限公司",
    "industry": "文旅投资",
    "contact": "",
    "notes": "地方文旅投资平台，可关注项目储备、资产运营和数字化营销机会。"
  }
]
```"""
            ),
        ) as mocked_complete:
            resp = self.client.post("/clients/ai-suggest", json={"query": "广州岭南商旅投资集团有限公司"})

        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body[0]["name"], "广州岭南商旅投资集团有限公司")
        mocked_complete.assert_awaited_once()
        self.assertIn("system", mocked_complete.await_args.kwargs)
        self.assertEqual(mocked_complete.await_args.kwargs["max_tokens"], 800)

    def test_ai_suggest_handles_prose_wrapped_json(self):
        """Regression: kimi-k2.* often returns the array behind a prose
        preamble / fenced block. The old parser only stripped a leading
        ``` and otherwise hit json.loads on non-JSON, raising
        "Expecting value: line 1 column 1 (char 0)" (a 500 in prod)."""
        with patch.object(
            clients_module,
            "complete_with_selected_model",
            new=AsyncMock(
                return_value=(
                    "Here are some suggestions for you:\n\n```json\n"
                    '[{"name": "Acme Corp", "industry": "Manufacturing", '
                    '"contact": "", "notes": "Industrial supplier."}]\n```'
                )
            ),
        ):
            resp = self.client.post("/clients/ai-suggest", json={"query": "acme"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()[0]["name"], "Acme Corp")

    def test_ai_suggest_empty_model_output_degrades_to_no_suggestions(self):
        """An empty / non-JSON model response should return [] (UI shows
        'no suggestions') rather than 500."""
        with patch.object(
            clients_module,
            "complete_with_selected_model",
            new=AsyncMock(return_value="I'm not able to help with that."),
        ):
            resp = self.client.post("/clients/ai-suggest", json={"query": "acme"})

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])


class ClientsStakeholderTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            user = User(email="admin@test.com", password_hash="h", display_name="Admin", is_admin=True)
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user_id = user.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[clients_module.get_session] = override_session
        self.current_user = _override_admin_user()
        app.dependency_overrides[get_current_user] = lambda: self.current_user

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)
        clients_cache.clear()

        resp = self.client.post("/clients", json={"name": "StakeCorp", "industry": "Tech"})
        self.client_id = resp.json()["id"]

    def _switch_to_project_member(self, role: str | None) -> int:
        with Session(self.engine) as session:
            user = User(
                email=f"{role or 'outsider'}@stakeholder.test",
                password_hash="h",
                display_name=role or "Outsider",
            )
            session.add(user)
            session.flush()
            user_id = int(user.id)
            if role is not None:
                project = Project(
                    name=f"{role} project",
                    client="StakeCorp",
                    client_id=self.client_id,
                )
                session.add(project)
                session.flush()
                session.add(
                    ProjectMember(
                        project_id=int(project.id),
                        user_id=user_id,
                        role=role,
                    )
                )
            session.commit()
        self.current_user = User(
            id=user_id,
            email=f"{role or 'outsider'}@stakeholder.test",
            password_hash="",
            display_name=role or "Outsider",
        )
        return user_id

    def tearDown(self):
        clients_cache.clear()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_create_stakeholder(self):
        resp = self.client.post(f"/clients/{self.client_id}/stakeholders", json={
            "name": "Alice", "role": "CEO", "influence_type": "decision"
        })
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data["name"], "Alice")
        self.assertEqual(data["role"], "CEO")

    def test_create_stakeholder_empty_name_fails(self):
        resp = self.client.post(f"/clients/{self.client_id}/stakeholders", json={
            "name": "", "role": "CEO"
        })
        self.assertIn(resp.status_code, [400, 422])

    def test_list_stakeholders(self):
        self.client.post(f"/clients/{self.client_id}/stakeholders", json={"name": "Alice", "role": "CEO"})
        self.client.post(f"/clients/{self.client_id}/stakeholders", json={"name": "Bob", "role": "CTO"})
        resp = self.client.get(f"/clients/{self.client_id}/stakeholders")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.json()), 2)

    def test_update_stakeholder(self):
        create_resp = self.client.post(f"/clients/{self.client_id}/stakeholders", json={
            "name": "Alice", "role": "CEO"
        })
        stakeholder_id = create_resp.json()["id"]
        resp = self.client.put(
            f"/clients/{self.client_id}/stakeholders/{stakeholder_id}",
            json={"role": "Chair"}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["role"], "Chair")

    def test_delete_stakeholder(self):
        create_resp = self.client.post(f"/clients/{self.client_id}/stakeholders", json={
            "name": "Alice", "role": "CEO"
        })
        stakeholder_id = create_resp.json()["id"]
        update_resp = self.client.put(
            f"/clients/{self.client_id}/stakeholders/{stakeholder_id}",
            json={"role": "Chair"},
        )
        self.assertEqual(update_resp.status_code, 200)
        with Session(self.engine) as session:
            self.assertTrue(
                session.exec(
                    select(ClientStakeholderHistory).where(
                        ClientStakeholderHistory.stakeholder_id == stakeholder_id
                    )
                ).all()
            )
        resp = self.client.delete(f"/clients/{self.client_id}/stakeholders/{stakeholder_id}")
        self.assertIn(resp.status_code, [200, 204])
        with Session(self.engine) as session:
            self.assertIsNone(session.get(ClientStakeholder, stakeholder_id))
            self.assertEqual(
                session.exec(
                    select(ClientStakeholderHistory).where(
                        ClientStakeholderHistory.stakeholder_id == stakeholder_id
                    )
                ).all(),
                [],
            )

    def test_nonmember_cannot_read_stakeholders_or_history(self):
        created = self.client.post(
            f"/clients/{self.client_id}/stakeholders",
            json={"name": "Alice", "role": "CEO"},
        )
        stakeholder_id = created.json()["id"]
        self._switch_to_project_member(None)

        list_response = self.client.get(
            f"/clients/{self.client_id}/stakeholders"
        )
        history_response = self.client.get(
            f"/clients/{self.client_id}/stakeholders/{stakeholder_id}/history"
        )

        self.assertEqual(list_response.status_code, 403, list_response.text)
        self.assertEqual(history_response.status_code, 403, history_response.text)

    def test_viewer_can_read_but_cannot_mutate_stakeholders(self):
        created = self.client.post(
            f"/clients/{self.client_id}/stakeholders",
            json={"name": "Alice", "role": "CEO"},
        )
        stakeholder_id = created.json()["id"]
        self._switch_to_project_member("viewer")

        self.assertEqual(
            self.client.get(
                f"/clients/{self.client_id}/stakeholders"
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get(
                f"/clients/{self.client_id}/stakeholders/{stakeholder_id}/history"
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.post(
                f"/clients/{self.client_id}/stakeholders",
                json={"name": "Blocked create"},
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.put(
                f"/clients/{self.client_id}/stakeholders/{stakeholder_id}",
                json={"role": "Blocked update"},
            ).status_code,
            403,
        )
        analyze_model = AsyncMock(return_value="{}")
        with patch.object(
            clients_stakeholders_module,
            "complete_with_selected_model",
            new=analyze_model,
        ):
            analyze_response = self.client.post(
                f"/clients/{self.client_id}/stakeholders/{stakeholder_id}/analyze",
                json={},
            )
        self.assertEqual(analyze_response.status_code, 403, analyze_response.text)
        analyze_model.assert_not_awaited()
        self.assertEqual(
            self.client.delete(
                f"/clients/{self.client_id}/stakeholders/{stakeholder_id}"
            ).status_code,
            403,
        )

    def test_editor_can_update_stakeholder(self):
        created = self.client.post(
            f"/clients/{self.client_id}/stakeholders",
            json={"name": "Alice", "role": "CEO"},
        )
        stakeholder_id = created.json()["id"]
        self._switch_to_project_member("editor")

        response = self.client.put(
            f"/clients/{self.client_id}/stakeholders/{stakeholder_id}",
            json={"role": "Chair"},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["role"], "Chair")


class ClientsMemoryTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            user = User(email="admin@test.com", password_hash="h", display_name="Admin", is_admin=True)
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user_id = user.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[clients_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = _override_admin_user

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)
        clients_cache.clear()

        resp = self.client.post("/clients", json={"name": "MemCorp", "industry": "Tech"})
        self.client_id = resp.json()["id"]

    def tearDown(self):
        clients_cache.clear()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_get_client_memory(self):
        resp = self.client.get(f"/clients/{self.client_id}/memory")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("memory", data)

    def test_get_client_memory_status(self):
        resp = self.client.get(f"/clients/{self.client_id}/memory/status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("has_memory", data)
        self.assertIn("memory_stale", data)

    def test_get_client_memory_snapshots_empty(self):
        resp = self.client.get(f"/clients/{self.client_id}/memory/snapshots")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), list)


class ClientsDocumentsTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            user = User(email="admin@test.com", password_hash="h", display_name="Admin", is_admin=True)
            session.add(user)
            session.commit()
            session.refresh(user)
            self.user_id = user.id

            client = ClientRecord(name="DocCorp", industry="Tech")
            session.add(client)
            session.commit()
            session.refresh(client)
            self.client_id = client.id

            doc = KnowledgeDocument(name="test.pdf", file_type="pdf", path="/tmp/test.pdf", client_id=client.id)
            session.add(doc)
            session.commit()
            session.refresh(doc)
            self.doc_id = doc.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[clients_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = _override_admin_user

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)
        clients_cache.clear()

    def tearDown(self):
        clients_cache.clear()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_client_documents(self):
        resp = self.client.get(f"/clients/{self.client_id}/documents")
        self.assertEqual(resp.status_code, 200)
        self.assertGreaterEqual(len(resp.json()), 1)

    def test_unlink_document(self):
        resp = self.client.delete(f"/clients/{self.client_id}/documents/{self.doc_id}")
        self.assertIn(resp.status_code, [200, 204])

    def test_link_document(self):
        # First unlink
        self.client.delete(f"/clients/{self.client_id}/documents/{self.doc_id}")
        # Then re-link
        resp = self.client.post(f"/clients/{self.client_id}/documents/{self.doc_id}")
        self.assertIn(resp.status_code, [200, 204])


class ClientAuthorizationTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            actor = User(
                email="client-actor@test.com",
                password_hash="x",
                display_name="Client Actor",
            )
            other = User(
                email="client-other@test.com",
                password_hash="x",
                display_name="Client Other",
            )
            admin = User(
                email="client-admin@test.com",
                password_hash="x",
                display_name="Client Admin",
                is_admin=True,
            )
            session.add_all([actor, other, admin])
            session.commit()
            for user in (actor, other, admin):
                session.refresh(user)
            self.actor_id = int(actor.id)
            self.other_id = int(other.id)
            self.admin_id = int(admin.id)

        self.current_user_id = [self.actor_id]
        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        def override_current_user():
            with Session(self.engine) as session:
                user = session.get(User, self.current_user_id[0])
                assert user is not None
                return user

        app.dependency_overrides[clients_module.get_session] = override_session
        app.dependency_overrides[get_current_user] = override_current_user
        self.client = TestClient(app, raise_server_exceptions=False)
        clients_cache.clear()

    def tearDown(self):
        self.client.close()
        clients_cache.clear()
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _client_record(self, name: str, creator_id: int | None) -> int:
        with Session(self.engine) as session:
            client = ClientRecord(name=name, created_by_user_id=creator_id)
            session.add(client)
            session.commit()
            session.refresh(client)
            return int(client.id)

    def test_client_lists_and_reads_are_filtered_by_stable_access(self):
        own_id = self._client_record("Own Client", self.actor_id)
        shared_id = self._client_record("Shared Client", self.other_id)
        hidden_id = self._client_record("Hidden Client", self.other_id)
        with Session(self.engine) as session:
            project = Project(
                name="Shared Project",
                client="Shared Client",
                client_id=shared_id,
            )
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=self.actor_id,
                    role="viewer",
                )
            )
            session.commit()

        response = self.client.get("/clients")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {item["id"] for item in response.json()},
            {own_id, shared_id},
        )
        self.assertEqual(self.client.get(f"/clients/{shared_id}").status_code, 200)
        self.assertEqual(self.client.get(f"/clients/{hidden_id}").status_code, 403)
        self.assertEqual(
            self.client.put(
                f"/clients/{shared_id}",
                json={"notes": "viewer must not write"},
            ).status_code,
            403,
        )

    def test_single_project_editor_cannot_rename_or_delete_shared_client(self):
        shared_id = self._client_record("Shared Boundary", self.other_id)
        with Session(self.engine) as session:
            project_a = Project(
                name="Writable Project A",
                client="Shared Boundary",
                client_id=shared_id,
                memory_stale=False,
            )
            project_b = Project(
                name="Protected Project B",
                client="Shared Boundary",
                client_id=shared_id,
                memory_stale=False,
            )
            session.add_all([project_a, project_b])
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project_a.id),
                    user_id=self.actor_id,
                    role="editor",
                )
            )
            session.commit()
            project_ids = (int(project_a.id), int(project_b.id))

        # Preserve the established client ACL: an editor of any linked project
        # may update ordinary shared metadata.
        metadata_update = self.client.put(
            f"/clients/{shared_id}",
            json={"notes": "Shared account context"},
        )
        rename = self.client.put(
            f"/clients/{shared_id}",
            json={"name": "Cross-scope rename"},
        )
        delete = self.client.delete(f"/clients/{shared_id}")

        self.assertEqual(metadata_update.status_code, 200, metadata_update.text)
        self.assertEqual(rename.status_code, 403, rename.text)
        self.assertEqual(delete.status_code, 403, delete.text)
        with Session(self.engine) as session:
            client = session.get(ClientRecord, shared_id)
            self.assertIsNotNone(client)
            self.assertEqual(client.name, "Shared Boundary")
            self.assertEqual(client.notes, "Shared account context")
            for project_id in project_ids:
                project = session.get(Project, project_id)
                self.assertEqual(project.client_id, shared_id)
                self.assertEqual(project.client, "Shared Boundary")

    def test_editor_of_every_linked_project_can_rename_and_delete_client(self):
        shared_id = self._client_record("Fully Writable", self.other_id)
        with Session(self.engine) as session:
            projects = [
                Project(
                    name="Writable Project A",
                    client="Fully Writable",
                    client_id=shared_id,
                    memory_stale=False,
                ),
                Project(
                    name="Writable Project B",
                    client="Fully Writable",
                    client_id=shared_id,
                    memory_stale=False,
                ),
            ]
            session.add_all(projects)
            session.flush()
            session.add_all(
                [
                    ProjectMember(
                        project_id=int(project.id),
                        user_id=self.actor_id,
                        role="editor",
                    )
                    for project in projects
                ]
            )
            session.commit()
            project_ids = [int(project.id) for project in projects]

        rename = self.client.put(
            f"/clients/{shared_id}",
            json={"name": "Fully Writable Renamed"},
        )
        self.assertEqual(rename.status_code, 200, rename.text)
        with Session(self.engine) as session:
            for project_id in project_ids:
                project = session.get(Project, project_id)
                self.assertEqual(project.client_id, shared_id)
                self.assertEqual(project.client, "Fully Writable Renamed")

        delete = self.client.delete(f"/clients/{shared_id}")

        self.assertIn(delete.status_code, [200, 204], delete.text)
        with Session(self.engine) as session:
            self.assertIsNone(session.get(ClientRecord, shared_id))
            for project_id in project_ids:
                self.assertIsNone(session.get(Project, project_id).client_id)

    def test_client_views_do_not_expose_other_linked_projects_or_documents(self):
        shared_id = self._client_record("Partitioned Client", self.other_id)
        with Session(self.engine) as session:
            visible_project = Project(
                name="Visible Project",
                client="Partitioned Client",
                client_id=shared_id,
            )
            hidden_project = Project(
                name="Hidden Project",
                client="Partitioned Client",
                client_id=shared_id,
            )
            session.add_all([visible_project, hidden_project])
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(visible_project.id),
                    user_id=self.actor_id,
                    role="viewer",
                )
            )
            session.add_all(
                [
                    KnowledgeDocument(
                        name="client-visible.md",
                        file_type="md",
                        path="client-visible.md",
                        client_id=shared_id,
                    ),
                    KnowledgeDocument(
                        name="project-visible.md",
                        file_type="md",
                        path="project-visible.md",
                        client_id=shared_id,
                        project_id=int(visible_project.id),
                    ),
                    KnowledgeDocument(
                        name="project-hidden.md",
                        file_type="md",
                        path="project-hidden.md",
                        client_id=shared_id,
                        project_id=int(hidden_project.id),
                    ),
                ]
            )
            session.commit()

        documents = self.client.get(f"/clients/{shared_id}/documents")
        detail = self.client.get(f"/clients/{shared_id}")
        listing = self.client.get("/clients")
        paginated = self.client.get("/clients/list")
        projects = self.client.get(f"/clients/{shared_id}/projects")

        self.assertEqual(documents.status_code, 200, documents.text)
        self.assertEqual(
            {item["name"] for item in documents.json()},
            {"client-visible.md", "project-visible.md"},
        )
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["document_count"], 2)
        self.assertEqual(detail.json()["project_names"], ["Visible Project"])
        listed = next(item for item in listing.json() if item["id"] == shared_id)
        self.assertEqual(listed["document_count"], 2)
        self.assertEqual(listed["project_names"], ["Visible Project"])
        paginated_item = next(
            item for item in paginated.json()["items"] if item["id"] == shared_id
        )
        self.assertEqual(paginated_item["document_count"], 2)
        self.assertEqual(paginated_item["project_names"], ["Visible Project"])
        self.assertEqual(
            [item["name"] for item in projects.json()],
            ["Visible Project"],
        )

    def test_unrelated_user_cannot_delete_client_or_descope_document(self):
        hidden_id = self._client_record("Protected Client", self.other_id)
        with Session(self.engine) as session:
            document = KnowledgeDocument(
                name="protected.md",
                file_type="md",
                path="/tmp/protected.md",
                client_id=hidden_id,
            )
            session.add(document)
            session.commit()
            session.refresh(document)
            document_id = int(document.id)

        response = self.client.delete(f"/clients/{hidden_id}")

        self.assertEqual(response.status_code, 403)
        with Session(self.engine) as session:
            self.assertIsNotNone(session.get(ClientRecord, hidden_id))
            self.assertEqual(
                session.get(KnowledgeDocument, document_id).client_id,
                hidden_id,
            )

    def test_document_reassignment_requires_source_and_target_write_access(self):
        target_id = self._client_record("Writable Target", self.actor_id)
        source_id = self._client_record("Read-only Source", self.other_id)
        with Session(self.engine) as session:
            project = Project(
                name="Read-only Source Project",
                client="Read-only Source",
                client_id=source_id,
            )
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=self.actor_id,
                    role="viewer",
                )
            )
            client_document = KnowledgeDocument(
                name="source-client.md",
                file_type="md",
                path="source-client.md",
                client_id=source_id,
            )
            project_document = KnowledgeDocument(
                name="source-project.md",
                file_type="md",
                path="source-project.md",
                project_id=int(project.id),
                client_id=target_id,
            )
            session.add_all([client_document, project_document])
            session.commit()
            session.refresh(client_document)
            session.refresh(project_document)
            client_document_id = int(client_document.id)
            project_document_id = int(project_document.id)

        client_move = self.client.post(
            f"/clients/{target_id}/documents/{client_document_id}"
        )
        project_unlink = self.client.delete(
            f"/clients/{target_id}/documents/{project_document_id}"
        )

        self.assertEqual(client_move.status_code, 403, client_move.text)
        self.assertEqual(project_unlink.status_code, 403, project_unlink.text)
        with Session(self.engine) as session:
            self.assertEqual(
                session.get(KnowledgeDocument, client_document_id).client_id,
                source_id,
            )
            self.assertEqual(
                session.get(KnowledgeDocument, project_document_id).client_id,
                target_id,
            )

    def test_creator_can_write_and_legacy_unowned_client_is_admin_only(self):
        own_id = self._client_record("Creator Client", self.actor_id)
        legacy_id = self._client_record("Legacy Client", None)

        updated = self.client.put(
            f"/clients/{own_id}",
            json={"notes": "creator update"},
        )
        denied = self.client.get(f"/clients/{legacy_id}")
        self.current_user_id[0] = self.admin_id
        allowed = self.client.get(f"/clients/{legacy_id}")

        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["notes"], "creator update")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(allowed.status_code, 200)

    def test_create_rechecks_inactive_actor_under_lock(self):
        with Session(self.engine) as session:
            actor = session.get(User, self.actor_id)
            actor.is_active = False
            session.add(actor)
            session.commit()

        response = self.client.post(
            "/clients",
            json={"name": "Inactive Create"},
        )

        self.assertEqual(response.status_code, 403)
        with Session(self.engine) as session:
            self.assertEqual(session.exec(select(ClientRecord)).all(), [])


if __name__ == "__main__":
    unittest.main()
