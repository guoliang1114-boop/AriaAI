"""Tests for auth module pure functions — password hashing, rate limit key, attempt pruning."""
import unittest
import time
from unittest.mock import MagicMock

from app.config import LOGIN_RATE_LIMIT_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_SECONDS


class PasswordHashTestCase(unittest.TestCase):
    def test_hash_and_verify_roundtrip(self):
        from app.routers.auth import _hash, _verify
        hashed = _hash("mypassword")
        self.assertTrue(_verify("mypassword", hashed))
        self.assertFalse(_verify("wrongpassword", hashed))

    def test_different_passwords_different_hashes(self):
        from app.routers.auth import _hash
        h1 = _hash("password1")
        h2 = _hash("password2")
        self.assertNotEqual(h1, h2)

    def test_empty_password(self):
        from app.routers.auth import _hash, _verify
        hashed = _hash("")
        self.assertTrue(_verify("", hashed))
        self.assertFalse(_verify("notempty", hashed))


class GetLoginRateLimitKeyTestCase(unittest.TestCase):
    def test_with_forwarded_for(self):
        from app.routers.auth import _get_login_rate_limit_key
        request = MagicMock()
        request.headers = {"x-forwarded-for": "1.2.3.4, 5.6.7.8"}
        request.client = None
        result = _get_login_rate_limit_key(request, "User@Email.COM")
        self.assertEqual(result, "1.2.3.4:user@email.com")

    def test_fallback_to_client_host(self):
        from app.routers.auth import _get_login_rate_limit_key
        request = MagicMock()
        request.headers = {}
        request.client = MagicMock(host="10.0.0.1")
        result = _get_login_rate_limit_key(request, "test@test.com")
        self.assertEqual(result, "10.0.0.1:test@test.com")

    def test_no_client_unknown(self):
        from app.routers.auth import _get_login_rate_limit_key
        request = MagicMock()
        request.headers = {}
        request.client = None
        result = _get_login_rate_limit_key(request, "a@b.com")
        self.assertEqual(result, "unknown:a@b.com")

    def test_email_normalized_to_lowercase(self):
        from app.routers.auth import _get_login_rate_limit_key
        request = MagicMock()
        request.headers = {}
        request.client = MagicMock(host="127.0.0.1")
        result = _get_login_rate_limit_key(request, "ADMIN@TEST.COM")
        self.assertEqual(result, "127.0.0.1:admin@test.com")


class PruneLoginAttemptsTestCase(unittest.TestCase):
    def test_prunes_old_attempts(self):
        from app.routers.auth import _prune_login_attempts
        now = 1000.0
        window = LOGIN_RATE_LIMIT_WINDOW_SECONDS
        attempts = [now - window - 10, now - window + 10, now - 5]
        result = _prune_login_attempts(now, attempts)
        self.assertEqual(len(result), 2)
        self.assertAlmostEqual(result[0], now - window + 10)
        self.assertAlmostEqual(result[1], now - 5)

    def test_all_old(self):
        from app.routers.auth import _prune_login_attempts
        now = 1000.0
        window = LOGIN_RATE_LIMIT_WINDOW_SECONDS
        attempts = [now - window - 100, now - window - 50]
        result = _prune_login_attempts(now, attempts)
        self.assertEqual(len(result), 0)

    def test_all_recent(self):
        from app.routers.auth import _prune_login_attempts
        now = 1000.0
        attempts = [now - 10, now - 5, now - 1]
        result = _prune_login_attempts(now, attempts)
        self.assertEqual(len(result), 3)

    def test_empty_list(self):
        from app.routers.auth import _prune_login_attempts
        result = _prune_login_attempts(1000.0, [])
        self.assertEqual(result, [])


class TokenCacheTestCase(unittest.TestCase):
    def tearDown(self):
        from app.services.token_cache import clear_token_cache
        clear_token_cache()

    def test_cache_roundtrip_and_invalidate(self):
        from app.services.token_cache import cache_token, get_cached_user_id, invalidate_token_cache

        cache_token("token-1", 42, 60)
        self.assertEqual(get_cached_user_id("token-1"), 42)

        invalidate_token_cache("token-1")
        self.assertIsNone(get_cached_user_id("token-1"))

    def test_cache_entry_expires(self):
        from app.services.token_cache import cache_token, get_cached_user_id

        cache_token("token-2", 43, -1)
        self.assertIsNone(get_cached_user_id("token-2"))
