"""Tests for knowledge router — document CRUD, stats."""
import unittest
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.models.db import User, KnowledgeDocument, DocumentChunk
from app.routers import knowledge as knowledge_module
from app.routers.knowledge import router
from app.services.time_utils import utc_now_naive


class KnowledgeRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            doc = KnowledgeDocument(
                name="test-doc.pdf",
                file_type="pdf",
                path="/tmp/test-doc.pdf",
                category="general",
                vector_status="synced",
                chunk_count=3,
            )
            session.add(doc)
            session.commit()
            session.refresh(doc)
            self.doc_id = doc.id

            for i in range(3):
                chunk = DocumentChunk(
                    document_id=doc.id,
                    chunk_index=i,
                    content=f"Chunk {i} content about AI strategy",
                    embedding_json="[0.1, 0.2, 0.3]",
                )
                session.add(chunk)
            session.commit()

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[knowledge_module.get_session] = override_session
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_documents(self):
        resp = self.client.get("/knowledge/documents")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, list)
        self.assertGreaterEqual(len(data), 1)
        self.assertEqual(data[0]["name"], "test-doc.pdf")
        self.assertEqual(data[0]["vector_status"], "synced")

    def test_list_documents_empty_filter(self):
        resp = self.client.get("/knowledge/documents?project_id=999")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 0)

    def test_delete_document(self):
        resp = self.client.delete(f"/knowledge/documents/{self.doc_id}")
        self.assertIn(resp.status_code, [200, 204])
        with Session(self.engine) as session:
            doc = session.get(KnowledgeDocument, self.doc_id)
            self.assertIsNone(doc)

    def test_delete_nonexistent_document(self):
        resp = self.client.delete("/knowledge/documents/99999")
        self.assertEqual(resp.status_code, 404)

    def test_stats_endpoint(self):
        resp = self.client.get("/knowledge/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data, dict)

    def test_query_endpoint(self):
        with patch("app.services.rag.retrieve_structured") as mock_retrieve:
            mock_result = MagicMock()
            mock_result.to_dict.return_value = {
                "results": [{"content": "test", "document_name": "doc.pdf", "document_id": 1, "chunk_index": 0, "score": 0.9}],
                "query": "AI strategy",
            }
            mock_result.results = [MagicMock(
                content="test", document_name="doc.pdf",
                document_id=1, chunk_index=0, score=0.9,
                to_dict=lambda: {"content": "test", "document_name": "doc.pdf", "document_id": 1, "chunk_index": 0, "score": 0.9},
            )]
            mock_retrieve.return_value = mock_result
            resp = self.client.post("/knowledge/query", json={"query": "AI strategy"})
            self.assertIn(resp.status_code, [200, 422])


if __name__ == "__main__":
    unittest.main()
