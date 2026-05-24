"""Tests for scheduler pure functions."""
import unittest
from datetime import datetime, timezone, timedelta

from app.services.scheduler import _as_utc_aware


class AsUtcAwareTestCase(unittest.TestCase):
    def test_naive_becomes_utc(self):
        naive = datetime(2025, 1, 1, 12, 0, 0)
        result = _as_utc_aware(naive)
        self.assertEqual(result.tzinfo, timezone.utc)
        self.assertEqual(result.year, 2025)
        self.assertEqual(result.hour, 12)

    def test_already_utc_passthrough(self):
        aware = datetime(2025, 6, 15, 10, 30, 0, tzinfo=timezone.utc)
        result = _as_utc_aware(aware)
        self.assertEqual(result, aware)
        self.assertEqual(result.tzinfo, timezone.utc)

    def test_other_timezone_converted_to_utc(self):
        est = timezone(timedelta(hours=-5))
        aware = datetime(2025, 1, 1, 12, 0, 0, tzinfo=est)
        result = _as_utc_aware(aware)
        self.assertEqual(result.tzinfo, timezone.utc)
        self.assertEqual(result.hour, 17)

    def test_positive_offset(self):
        cst = timezone(timedelta(hours=8))
        aware = datetime(2025, 1, 1, 20, 0, 0, tzinfo=cst)
        result = _as_utc_aware(aware)
        self.assertEqual(result.tzinfo, timezone.utc)
        self.assertEqual(result.hour, 12)
