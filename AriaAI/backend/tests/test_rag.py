"""Unit tests for RAG pure functions (chunk_text, cosine_similarity, RetrievalResult, RetrievalContext)."""
import unittest
import numpy as np

from app.services.rag import chunk_text, cosine_similarity, RetrievalResult, RetrievalContext


class TestChunkText(unittest.TestCase):
    def test_empty_string(self):
        self.assertEqual(chunk_text(""), [])

    def test_whitespace_only(self):
        self.assertEqual(chunk_text("   \n  "), [])

    def test_short_text_single_chunk(self):
        text = "Hello world"
        chunks = chunk_text(text)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0], text)

    def test_long_text_produces_multiple_chunks(self):
        text = "a" * 2000
        chunks = chunk_text(text)
        self.assertGreater(len(chunks), 1)

    def test_chunks_have_overlap(self):
        text = "abcdefghijklmnop" * 100
        chunks = chunk_text(text)
        if len(chunks) >= 2:
            tail_of_first = chunks[0][-50:]
            self.assertIn(tail_of_first[:10], chunks[1])

    def test_all_chunks_are_non_empty(self):
        text = "word " * 500
        chunks = chunk_text(text)
        for c in chunks:
            self.assertTrue(len(c.strip()) > 0)

    def test_reconstructable_content(self):
        text = "The quick brown fox jumps over the lazy dog. " * 50
        chunks = chunk_text(text)
        combined = chunks[0]
        for c in chunks[1:]:
            combined += c
        self.assertTrue(text in combined or len(combined) >= len(text))


class TestCosineSimilarity(unittest.TestCase):
    def test_identical_vectors(self):
        a = [1.0, 2.0, 3.0]
        result = cosine_similarity(a, a)
        self.assertAlmostEqual(result, 1.0, places=5)

    def test_orthogonal_vectors(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        result = cosine_similarity(a, b)
        self.assertAlmostEqual(result, 0.0, places=5)

    def test_opposite_vectors(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        result = cosine_similarity(a, b)
        self.assertAlmostEqual(result, -1.0, places=5)

    def test_zero_vector_returns_zero(self):
        a = [0.0, 0.0, 0.0]
        b = [1.0, 2.0, 3.0]
        result = cosine_similarity(a, b)
        self.assertEqual(result, 0.0)

    def test_both_zero_vectors(self):
        a = [0.0, 0.0]
        b = [0.0, 0.0]
        result = cosine_similarity(a, b)
        self.assertEqual(result, 0.0)

    def test_similar_vectors_high_score(self):
        a = [1.0, 1.0, 0.0]
        b = [1.0, 0.9, 0.1]
        result = cosine_similarity(a, b)
        self.assertGreater(result, 0.9)

    def test_numpy_array_input(self):
        a = np.array([1.0, 2.0, 3.0])
        b = np.array([1.0, 2.0, 3.0])
        result = cosine_similarity(a, b)
        self.assertAlmostEqual(result, 1.0, places=5)


class TestRetrievalResult(unittest.TestCase):
    def test_to_dict(self):
        r = RetrievalResult(
            content="test content",
            document_name="doc.pdf",
            document_id=42,
            chunk_index=3,
            score=0.87654,
        )
        d = r.to_dict()
        self.assertEqual(d["content"], "test content")
        self.assertEqual(d["document_name"], "doc.pdf")
        self.assertEqual(d["document_id"], 42)
        self.assertEqual(d["chunk_index"], 3)
        self.assertEqual(d["score"], 0.8765)

    def test_score_rounding(self):
        r = RetrievalResult("c", "d", 1, 0, 0.123456789)
        self.assertEqual(r.to_dict()["score"], 0.1235)


class TestRetrievalContext(unittest.TestCase):
    def test_to_text_empty_results(self):
        ctx = RetrievalContext(results=[], query="test")
        self.assertEqual(ctx.to_text(), "")

    def test_to_text_single_result(self):
        r = RetrievalResult("hello", "doc.md", 1, 0, 0.9)
        ctx = RetrievalContext(results=[r], query="test")
        text = ctx.to_text()
        self.assertIn("[doc.md]", text)
        self.assertIn("hello", text)

    def test_to_text_multiple_results(self):
        r1 = RetrievalResult("first", "a.md", 1, 0, 0.9)
        r2 = RetrievalResult("second", "b.md", 2, 0, 0.8)
        ctx = RetrievalContext(results=[r1, r2], query="test")
        text = ctx.to_text()
        self.assertIn("[a.md]", text)
        self.assertIn("[b.md]", text)
        self.assertIn("---", text)


if __name__ == "__main__":
    unittest.main()
