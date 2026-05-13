"""Unit tests for config module utilities."""
import unittest
import os
from unittest.mock import patch


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

    def test_database_url_uses_postgresql(self):
        from app.config import DATABASE_URL
        self.assertTrue(
            DATABASE_URL.startswith("postgresql://"),
            f"Expected DATABASE_URL to start with postgresql://, got: {DATABASE_URL}"
        )


if __name__ == "__main__":
    unittest.main()
