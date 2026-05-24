"""Unit tests for TTLCache."""
import unittest
import time
from unittest.mock import patch

from app.services.cache import TTLCache


class TestTTLCache(unittest.TestCase):
    def setUp(self):
        self.cache = TTLCache()

    def test_get_nonexistent_key_returns_none(self):
        self.assertIsNone(self.cache.get("missing"))

    def test_set_and_get(self):
        self.cache.set("key1", "value1", ttl=60)
        self.assertEqual(self.cache.get("key1"), "value1")

    def test_get_expired_entry_returns_none(self):
        self.cache.set("key1", "value1", ttl=0.01)
        time.sleep(0.02)
        self.assertIsNone(self.cache.get("key1"))

    def test_delete_existing_key(self):
        self.cache.set("key1", "value1", ttl=60)
        self.cache.delete("key1")
        self.assertIsNone(self.cache.get("key1"))

    def test_delete_nonexistent_key_no_error(self):
        self.cache.delete("nonexistent")  # Should not raise

    def test_delete_prefix(self):
        self.cache.set("user:1", "alice", ttl=60)
        self.cache.set("user:2", "bob", ttl=60)
        self.cache.set("project:1", "proj", ttl=60)
        self.cache.delete_prefix("user:")
        self.assertIsNone(self.cache.get("user:1"))
        self.assertIsNone(self.cache.get("user:2"))
        self.assertEqual(self.cache.get("project:1"), "proj")

    def test_clear(self):
        self.cache.set("a", 1, ttl=60)
        self.cache.set("b", 2, ttl=60)
        self.cache.clear()
        self.assertIsNone(self.cache.get("a"))
        self.assertIsNone(self.cache.get("b"))

    def test_overwrite_key(self):
        self.cache.set("key", "old", ttl=60)
        self.cache.set("key", "new", ttl=60)
        self.assertEqual(self.cache.get("key"), "new")

    def test_stores_various_types(self):
        self.cache.set("str", "hello", ttl=60)
        self.cache.set("int", 42, ttl=60)
        self.cache.set("list", [1, 2, 3], ttl=60)
        self.cache.set("dict", {"a": 1}, ttl=60)
        self.assertEqual(self.cache.get("str"), "hello")
        self.assertEqual(self.cache.get("int"), 42)
        self.assertEqual(self.cache.get("list"), [1, 2, 3])
        self.assertEqual(self.cache.get("dict"), {"a": 1})

    def test_delete_prefix_no_match(self):
        self.cache.set("key", "value", ttl=60)
        self.cache.delete_prefix("zzz")
        self.assertEqual(self.cache.get("key"), "value")


if __name__ == "__main__":
    unittest.main()
