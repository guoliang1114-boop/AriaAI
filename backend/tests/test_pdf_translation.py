"""Tests for PDF translation tool — path resolution, headers, early returns."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

from app.tools import pdf_translation as pt


class ResolvePathTestCase(unittest.TestCase):
    def test_absolute_path_unchanged(self):
        self.assertEqual(pt._resolve_path("/tmp/file.pdf"), Path("/tmp/file.pdf"))

    def test_relative_path_resolved_under_uploads(self):
        from app.config import UPLOADS_DIR
        self.assertEqual(pt._resolve_path("docs/file.pdf"), UPLOADS_DIR / "docs" / "file.pdf")


class HeadersTestCase(unittest.TestCase):
    def test_headers_format(self):
        h = pt._headers("my-token")
        self.assertEqual(h["Authorization"], "Bearer my-token")
        self.assertEqual(h["Accept"], "application/json")


class TranslateDocumentTestCase(unittest.TestCase):
    async def _call(self, **kwargs):
        return await pt.translate_document(**kwargs)

    def test_missing_token_returns_error(self):
        import asyncio
        with patch.object(pt, "_DEFAULT_CTOOLS_TOKEN", ""):
            result = asyncio.run(self._call(file_path="/tmp/a.pdf", target_language="zh"))
        self.assertFalse(result["success"])
        self.assertIn("token", result["error"].lower())

    def test_missing_file_returns_error(self):
        import asyncio
        with patch.object(pt, "_DEFAULT_CTOOLS_TOKEN", "tk"):
            with patch("pathlib.Path.is_file", return_value=False):
                result = asyncio.run(self._call(file_path="/tmp/missing.pdf", target_language="zh"))
        self.assertFalse(result["success"])
        self.assertIn("not found", result["error"].lower())
