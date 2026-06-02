"""Tests for knowledge router — document CRUD, stats."""
import os
import tempfile
import unittest
from unittest.mock import patch, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import User, KnowledgeDocument, DocumentChunk
from app.routers import knowledge as knowledge_module
from app.routers.knowledge import router
from app.services.time_utils import utc_now_naive
from tests.test_database import create_test_engine, drop_all_tables


class KnowledgeRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
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
        app.dependency_overrides[knowledge_module.get_current_user] = lambda: User(
            id=1,
            email="test@example.com",
            display_name="Test User",
            password_hash="",
            is_admin=True,
            is_active=True,
        )
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

    def test_list_documents_by_client_id(self):
        resp = self.client.get("/knowledge/documents?client_id=999")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 0)

    def test_upload_document(self):
        import io
        file_content = b"test file content"
        resp = self.client.post(
            "/knowledge/documents?category=test",
            files={"file": ("test.txt", io.BytesIO(file_content), "text/plain")},
        )
        self.assertIn(resp.status_code, [200, 201])
        data = resp.json()
        self.assertEqual(data["name"], "test.txt")

    def test_upload_document_with_project(self):
        with Session(self.engine) as session:
            from app.models.db import Project
            project = Project(name="Test Project", client="Test Client")
            session.add(project)
            session.commit()
            session.refresh(project)
            project_id = project.id

        import io
        resp = self.client.post(
            f"/knowledge/documents?project_id={project_id}",
            files={"file": ("test.txt", io.BytesIO(b"content"), "text/plain")},
        )
        self.assertIn(resp.status_code, [200, 201])

    def test_upload_document_invalid_project(self):
        import io
        resp = self.client.post(
            "/knowledge/documents?project_id=99999",
            files={"file": ("test.txt", io.BytesIO(b"content"), "text/plain")},
        )
        self.assertEqual(resp.status_code, 404)

    def test_reindex_document_queues_background_index(self):
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
            f.write("retry me")
            path = f.name
        try:
            with Session(self.engine) as session:
                doc = KnowledgeDocument(
                    name="failed.txt",
                    file_type="txt",
                    path=path,
                    category="general",
                    vector_status="failed",
                )
                session.add(doc)
                session.commit()
                session.refresh(doc)
                doc_id = doc.id

            with patch.object(knowledge_module, "_index_background") as mock_index:
                resp = self.client.post(f"/knowledge/documents/{doc_id}/reindex")

            self.assertEqual(resp.status_code, 200)
            mock_index.assert_called_once()
            with Session(self.engine) as session:
                refreshed = session.get(KnowledgeDocument, doc_id)
                self.assertEqual(refreshed.vector_status, "pending")
                self.assertEqual(refreshed.vector_progress, 0.0)
        finally:
            os.unlink(path)

    def test_stats_endpoint_values(self):
        resp = self.client.get("/knowledge/stats")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("document_count", data)
        self.assertIn("total_vectors", data)
        self.assertGreaterEqual(data["document_count"], 1)
        self.assertGreaterEqual(data["total_vectors"], 1)

    def test_list_documents_includes_status_counts(self):
        with Session(self.engine) as session:
            failed_doc = KnowledgeDocument(
                name="failed.pptx",
                file_type="pptx",
                path="/tmp/failed.pptx",
                category="general",
                vector_status="failed",
            )
            session.add(failed_doc)
            session.commit()

        resp = self.client.get("/knowledge/documents/list")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        counts = {item["status"]: item["count"] for item in data["status_counts"]}
        self.assertGreaterEqual(counts.get("synced", 0), 1)
        self.assertEqual(counts.get("failed"), 1)

    def test_list_documents_filters_by_file_type_and_status(self):
        with Session(self.engine) as session:
            ppt_doc = KnowledgeDocument(
                name="deck.pptx",
                file_type="pptx",
                path="/tmp/deck.pptx",
                category="general",
                vector_status="failed",
            )
            session.add(ppt_doc)
            session.commit()

        resp = self.client.get("/knowledge/documents/list?file_type=ppt&status=failed")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["name"], "deck.pptx")
        type_counts = {item["file_type"]: item["count"] for item in data["file_type_counts"]}
        self.assertGreaterEqual(type_counts.get("pptx", 0), 1)


if __name__ == "__main__":
    unittest.main()
