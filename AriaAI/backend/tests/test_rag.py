"""Tests for RAG service — chunking, embedding, retrieval, indexing."""
import unittest
from unittest.mock import MagicMock, patch
import json

from sqlmodel import Session, SQLModel, create_engine

from app.models.db import DocumentChunk, KnowledgeDocument
from app.services import rag as rag_module
from sqlmodel import select
from tests.test_database import create_test_engine, drop_all_tables


class ChunkTextTestCase(unittest.TestCase):
    @patch.object(rag_module, "CHUNK_SIZE", 10)
    @patch.object(rag_module, "CHUNK_OVERLAP", 2)
    def test_chunking(self):
        text = "a" * 25
        chunks = rag_module.chunk_text(text)
        self.assertEqual(len(chunks), 4)  # 0-10, 8-18, 16-26, 24-34
        self.assertEqual(chunks[0], "a" * 10)

    def test_empty_text(self):
        self.assertEqual(rag_module.chunk_text(""), [])

    def test_whitespace_only_filtered(self):
        self.assertEqual(rag_module.chunk_text("   \n\t  "), [])


class CosineSimilarityTestCase(unittest.TestCase):
    def test_identical_vectors(self):
        a = [1.0, 0.0, 0.0]
        b = [1.0, 0.0, 0.0]
        self.assertAlmostEqual(rag_module.cosine_similarity(a, b), 1.0, places=5)

    def test_orthogonal_vectors(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        self.assertAlmostEqual(rag_module.cosine_similarity(a, b), 0.0, places=5)

    def test_zero_vector(self):
        a = [0.0, 0.0]
        b = [1.0, 0.0]
        self.assertEqual(rag_module.cosine_similarity(a, b), 0.0)


class RetrieveStructuredTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    @patch.object(rag_module, "embed_texts")
    def test_retrieve_by_doc_ids(self, mock_embed):
        mock_embed.return_value = [[1.0, 0.0, 0.0]]
        with Session(self.engine) as session:
            doc = KnowledgeDocument(name="test.pdf", file_type="pdf", path="t.pdf")
            session.add(doc)
            session.commit()
            session.refresh(doc)

            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=0,
                content="AI strategy for 2025",
                embedding_json=json.dumps([1.0, 0.0, 0.0]),
            )
            session.add(chunk)
            session.commit()

            ctx = rag_module.retrieve_structured("AI", session, doc_ids=[doc.id])
            self.assertEqual(len(ctx.results), 1)
            self.assertEqual(ctx.results[0].content, "AI strategy for 2025")

    @patch.object(rag_module, "embed_texts")
    def test_retrieve_no_match_returns_empty(self, mock_embed):
        mock_embed.return_value = [[0.0, 1.0, 0.0]]
        with Session(self.engine) as session:
            doc = KnowledgeDocument(name="test.pdf", file_type="pdf", path="t.pdf")
            session.add(doc)
            session.commit()
            session.refresh(doc)

            # Empty embedding_json causes chunk to be filtered out
            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=0,
                content="hello world",
                embedding_json="[]",
            )
            session.add(chunk)
            session.commit()

            ctx = rag_module.retrieve_structured("completely different", session, doc_ids=[doc.id])
            self.assertEqual(len(ctx.results), 0)

    @patch.object(rag_module, "embed_texts")
    def test_retrieve_by_project_id(self, mock_embed):
        mock_embed.return_value = [[1.0, 0.0, 0.0]]
        with Session(self.engine) as session:
            doc = KnowledgeDocument(name="proj.pdf", file_type="pdf", path="p.pdf", project_id=42)
            session.add(doc)
            session.commit()
            session.refresh(doc)

            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=0,
                content="Project details",
                embedding_json=json.dumps([1.0, 0.0, 0.0]),
            )
            session.add(chunk)
            session.commit()

            ctx = rag_module.retrieve_structured("details", session, project_id=42)
            self.assertEqual(len(ctx.results), 1)

    @patch.object(rag_module, "embed_texts")
    def test_retrieve_by_client_id(self, mock_embed):
        mock_embed.return_value = [[1.0, 0.0, 0.0]]
        with Session(self.engine) as session:
            doc = KnowledgeDocument(name="client.pdf", file_type="pdf", path="c.pdf", client_id=7)
            session.add(doc)
            session.commit()
            session.refresh(doc)

            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=0,
                content="Client briefing",
                embedding_json=json.dumps([1.0, 0.0, 0.0]),
            )
            session.add(chunk)
            session.commit()

            ctx = rag_module.retrieve_structured("briefing", session, client_id=7)
            self.assertEqual(len(ctx.results), 1)


class RetrieveTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    @patch.object(rag_module, "embed_texts")
    def test_returns_text_format(self, mock_embed):
        mock_embed.return_value = [[1.0, 0.0, 0.0]]
        with Session(self.engine) as session:
            doc = KnowledgeDocument(name="x.pdf", file_type="pdf", path="x.pdf")
            session.add(doc)
            session.commit()
            session.refresh(doc)

            chunk = DocumentChunk(
                document_id=doc.id,
                chunk_index=0,
                content="Chunk text",
                embedding_json=json.dumps([1.0, 0.0, 0.0]),
            )
            session.add(chunk)
            session.commit()

            text = rag_module.retrieve("query", session, doc_ids=[doc.id])
            self.assertIn("Chunk text", text)


class RetrievalContextTestCase(unittest.TestCase):
    def test_empty_results(self):
        ctx = rag_module.RetrievalContext([], "q")
        self.assertEqual(ctx.to_text(), "")
        self.assertEqual(ctx.to_dict()["results_count"], 0)

    def test_to_text_format(self):
        r = rag_module.RetrievalResult("content", "doc.pdf", 1, 0, 0.95)
        ctx = rag_module.RetrievalContext([r], "q")
        self.assertEqual(ctx.to_text(), "[doc.pdf] content")

    def test_to_dict(self):
        r = rag_module.RetrievalResult("content", "doc.pdf", 1, 0, 0.95)
        ctx = rag_module.RetrievalContext([r], "q")
        d = ctx.to_dict()
        self.assertEqual(d["query"], "q")
        self.assertEqual(d["results_count"], 1)
        self.assertEqual(d["results"][0]["score"], 0.95)


class IndexDocumentTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    @patch.object(rag_module, "embed_texts")
    @patch.object(rag_module, "chunk_text")
    async def _index(self, mock_chunk, mock_embed, text="Hello world"):
        mock_chunk.return_value = [text]
        mock_embed.return_value = [[0.1, 0.2, 0.3]]
        with Session(self.engine) as session:
            doc = KnowledgeDocument(name="idx.pdf", file_type="pdf", path="i.pdf")
            session.add(doc)
            session.commit()
            session.refresh(doc)
            await rag_module.index_document(doc, text, session)
            return doc.id

    def test_indexing(self):
        import asyncio
        doc_id = asyncio.run(self._index(text="AI strategy"))
        with Session(self.engine) as session:
            doc = session.get(KnowledgeDocument, doc_id)
            self.assertEqual(doc.vector_status, "synced")
            self.assertEqual(doc.vector_progress, 1.0)
            chunks = session.exec(
                select(DocumentChunk).where(DocumentChunk.document_id == doc_id)
            ).all()
            self.assertEqual(len(chunks), 1)
            self.assertEqual(chunks[0].content, "AI strategy")
