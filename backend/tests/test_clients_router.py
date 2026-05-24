"""Integration tests for clients router — CRUD endpoints with TestClient."""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import User, ClientRecord, ClientStakeholder, KnowledgeDocument, Project
from app.routers import clients as clients_module
from app.routers.clients import router
from app.services.cache import clients_cache
from tests.test_database import create_test_engine, drop_all_tables


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
        resp = self.client.put(f"/clients/{created['id']}", json={"name": "NewName"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["name"], "NewName")

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

    def test_delete_nonexistent_client(self):
        resp = self.client.delete("/clients/99999")
        self.assertEqual(resp.status_code, 404)


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
        resp = self.client.delete(f"/clients/{self.client_id}/stakeholders/{stakeholder_id}")
        self.assertIn(resp.status_code, [200, 204])


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
