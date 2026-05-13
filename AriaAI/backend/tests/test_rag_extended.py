"""Extended tests for RAG service — RetrievalContext.to_dict, chunk_text edge cases."""
import unittest
from app.services.rag import (
    chunk_text,
    cosine_similarity,
    RetrievalResult,
    RetrievalContext,
)


class RetrievalContextToDictTestCase(unittest.TestCase):
    def test_to_dict_empty(self):
        ctx = RetrievalContext(results=[], query="test")
        d = ctx.to_dict()
        self.assertEqual(d["query"], "test")
        self.assertEqual(d["results"], [])

    def test_to_dict_with_results(self):
        r = RetrievalResult("content", "doc.pdf", 1, 0, 0.95)
        ctx = RetrievalContext(results=[r], query="AI")
        d = ctx.to_dict()
        self.assertEqual(d["query"], "AI")
        self.assertEqual(len(d["results"]), 1)
        self.assertEqual(d["results"][0]["content"], "content")
        self.assertEqual(d["results"][0]["score"], 0.95)

    def test_to_dict_multiple_results(self):
        r1 = RetrievalResult("first", "a.md", 1, 0, 0.9)
        r2 = RetrievalResult("second", "b.md", 2, 1, 0.8)
        ctx = RetrievalContext(results=[r1, r2], query="test")
        d = ctx.to_dict()
        self.assertEqual(len(d["results"]), 2)


class ChunkTextExtendedTestCase(unittest.TestCase):
    def test_chunks_respect_overlap(self):
        text = "abcdefghij" * 200
        chunks = chunk_text(text)
        if len(chunks) >= 2:
            overlap_found = False
            for i in range(len(chunks) - 1):
                tail = chunks[i][-20:]
                if tail in chunks[i + 1]:
                    overlap_found = True
                    break
            self.assertTrue(overlap_found)

    def test_single_char_text(self):
        chunks = chunk_text("x")
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0], "x")

    def test_multiline_text(self):
        text = "Line 1\nLine 2\nLine 3\n" * 100
        chunks = chunk_text(text)
        self.assertGreater(len(chunks), 1)

    def test_chinese_text(self):
        text = "你好世界" * 500
        chunks = chunk_text(text)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertTrue(len(c.strip()) > 0)


class CosineSimilarityExtendedTestCase(unittest.TestCase):
    def test_large_vectors(self):
        a = [float(i) for i in range(100)]
        b = [float(i) for i in range(100)]
        result = cosine_similarity(a, b)
        self.assertAlmostEqual(result, 1.0, places=5)

    def test_single_element_vectors(self):
        self.assertAlmostEqual(cosine_similarity([5.0], [3.0]), 1.0, places=5)
        self.assertAlmostEqual(cosine_similarity([5.0], [-3.0]), -1.0, places=5)


if __name__ == "__main__":
    unittest.main()
