"""Integration tests for clients router — CRUD endpoints with TestClient."""
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
    User,
)
from app.routers import clients as clients_module
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
            self.assertTrue(session.get(Project, project_ids[0]).memory_stale)
            self.assertTrue(session.get(Project, project_ids[1]).memory_stale)

    def test_update_client_industry(self):
        created = self._create_client("Corp", "Old Industry")
        resp = self.client.put(f"/clients/{created['id']}", json={"industry": "New Industry"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["industry"], "New Industry")

    def test_delete_client(self):
        created = self._create_client("DeleteCorp")
        resp = self.client.delete(f"/clients/{created['id']}")
        self.assertIn(resp.status_code, [200, 204])
        resp2 = self.client.get(f"/clients/{created['id']}")
        self.assertEqual(resp2.status_code, 404)

    def test_delete_client_removes_all_owned_memory_and_stakeholder_records(self):
        created = self._create_client("DeleteGraphCorp")
        client_id = created["id"]
        with Session(self.engine) as session:
            linked_project = Project(
                name="Linked project",
                client="DeleteGraphCorp",
                memory_stale=False,
            )
            stakeholder = ClientStakeholder(client_id=client_id, name="Alice")
            document = KnowledgeDocument(
                name="client-note.md",
                file_type="md",
                path="/tmp/client-note.md",
                client_id=client_id,
            )
            session.add(linked_project)
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
            self.assertTrue(session.get(Project, linked_project_id).memory_stale)

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
        app.dependency_overrides[get_current_user] = _override_admin_user

        @app.middleware("http")
        def inject_user(request, call_next):
            request.state.user_id = self.user_id
            request.state.is_admin = True
            return call_next(request)

        self.client = TestClient(app, raise_server_exceptions=False)
        clients_cache.clear()

        resp = self.client.post("/clients", json={"name": "StakeCorp", "industry": "Tech"})
        self.client_id = resp.json()["id"]

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


if __name__ == "__main__":
    unittest.main()
