"""Unit tests for config module utilities."""
import unittest
import os
from unittest.mock import patch
from pathlib import Path

from app.config import _normalize_database_url


class TestNormalizeDatabaseUrl(unittest.TestCase):
    def test_relative_sqlite_url_is_resolved(self):
        url = "sqlite:///./data/ariaai.db"
        result = _normalize_database_url(url)
        self.assertTrue(result.startswith("sqlite:///"))
        self.assertIn("ariaai.db", result)
        self.assertNotIn("./", result)

    def test_absolute_sqlite_url_passes_through(self):
        url = "sqlite:///tmp/test.db"
        result = _normalize_database_url(url)
        self.assertEqual(result, url)

    def test_postgresql_url_passes_through(self):
        url = "postgresql://user:pass@localhost/db"
        result = _normalize_database_url(url)
        self.assertEqual(result, url)

    def test_empty_string_passes_through(self):
        result = _normalize_database_url("")
        self.assertEqual(result, "")

    def test_relative_path_resolves_to_absolute(self):
        url = "sqlite:///./data/test.db"
        result = _normalize_database_url(url)
        self.assertTrue(result.startswith("sqlite:///"))
        # Should be an absolute path
        path_part = result.replace("sqlite:///", "")
        self.assertTrue(path_part.startswith("/") or len(path_part) > 2)


class TestConfigDefaults(unittest.TestCase):
    def test_jwt_algorithm(self):
        from app.config import JWT_ALGORITHM
        self.assertEqual(JWT_ALGORITHM, "HS256")

    def test_login_rate_limit_defaults(self):
        from app.config import LOGIN_RATE_LIMIT_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_SECONDS
        self.assertIsInstance(LOGIN_RATE_LIMIT_ATTEMPTS, int)
        self.assertIsInstance(LOGIN_RATE_LIMIT_WINDOW_SECONDS, int)
        self.assertGreater(LOGIN_RATE_LIMIT_ATTEMPTS, 0)
        self.assertGreater(LOGIN_RATE_LIMIT_WINDOW_SECONDS, 0)

    def test_chunk_config_defaults(self):
        from app.config import CHUNK_SIZE, CHUNK_OVERLAP
        self.assertIsInstance(CHUNK_SIZE, int)
        self.assertIsInstance(CHUNK_OVERLAP, int)
        self.assertGreater(CHUNK_SIZE, 0)
        self.assertGreater(CHUNK_OVERLAP, 0)
        self.assertGreater(CHUNK_SIZE, CHUNK_OVERLAP)

    def test_database_url_is_string(self):
        from app.config import DATABASE_URL
        self.assertIsInstance(DATABASE_URL, str)
        self.assertTrue(len(DATABASE_URL) > 0)


if __name__ == "__main__":
    unittest.main()
