"""Unit tests for time utilities."""
import unittest
from datetime import datetime, timezone

from app.services.time_utils import utc_now_naive


class TestUtcNowNaive(unittest.TestCase):
    def test_returns_naive_datetime(self):
        result = utc_now_naive()
        self.assertIsInstance(result, datetime)
        self.assertIsNone(result.tzinfo)

    def test_is_close_to_utc_now(self):
        before = datetime.now(timezone.utc).replace(tzinfo=None)
        result = utc_now_naive()
        after = datetime.now(timezone.utc).replace(tzinfo=None)
        self.assertGreaterEqual(result, before)
        self.assertLessEqual(result, after)

    def test_has_microsecond_precision(self):
        result = utc_now_naive()
        self.assertIsNotNone(result.microsecond)


if __name__ == "__main__":
    unittest.main()
