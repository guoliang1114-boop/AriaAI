"""Tests for auth module — record/clear login attempts."""
import unittest
import time

from app.routers.auth import (
    _LOGIN_ATTEMPTS,
    _record_failed_login_attempt,
    _clear_failed_login_attempts,
    _ensure_login_not_rate_limited,
)
from app.config import LOGIN_RATE_LIMIT_ATTEMPTS


class RecordFailedLoginAttemptTestCase(unittest.TestCase):
    def setUp(self):
        _LOGIN_ATTEMPTS.clear()

    def tearDown(self):
        _LOGIN_ATTEMPTS.clear()

    def test_records_attempt(self):
        _record_failed_login_attempt("test:key")
        self.assertIn("test:key", _LOGIN_ATTEMPTS)
        self.assertEqual(len(_LOGIN_ATTEMPTS["test:key"]), 1)

    def test_appends_to_existing(self):
        _record_failed_login_attempt("test:key")
        _record_failed_login_attempt("test:key")
        self.assertEqual(len(_LOGIN_ATTEMPTS["test:key"]), 2)

    def test_different_keys_independent(self):
        _record_failed_login_attempt("key1")
        _record_failed_login_attempt("key2")
        self.assertEqual(len(_LOGIN_ATTEMPTS["key1"]), 1)
        self.assertEqual(len(_LOGIN_ATTEMPTS["key2"]), 1)


class ClearFailedLoginAttemptsTestCase(unittest.TestCase):
    def setUp(self):
        _LOGIN_ATTEMPTS.clear()

    def tearDown(self):
        _LOGIN_ATTEMPTS.clear()

    def test_clears_key(self):
        _LOGIN_ATTEMPTS["test:key"] = [time.time()]
        _clear_failed_login_attempts("test:key")
        self.assertNotIn("test:key", _LOGIN_ATTEMPTS)

    def test_clear_nonexistent_no_error(self):
        _clear_failed_login_attempts("nonexistent")


class EnsureLoginNotRateLimitedTestCase(unittest.TestCase):
    def setUp(self):
        _LOGIN_ATTEMPTS.clear()

    def tearDown(self):
        _LOGIN_ATTEMPTS.clear()

    def test_allows_when_under_limit(self):
        _LOGIN_ATTEMPTS["test:key"] = [time.time() - 10]
        _ensure_login_not_rate_limited("test:key")

    def test_raises_when_at_limit(self):
        now = time.time()
        _LOGIN_ATTEMPTS["test:key"] = [now - 10] * LOGIN_RATE_LIMIT_ATTEMPTS
        with self.assertRaises(Exception):
            _ensure_login_not_rate_limited("test:key")

    def test_allows_new_key(self):
        _ensure_login_not_rate_limited("brand:new")
