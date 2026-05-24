"""Tests for project_members serialize_member."""
import unittest
from unittest.mock import MagicMock

from app.services.project_members import serialize_member


class SerializeMemberTestCase(unittest.TestCase):
    def test_basic_member(self):
        member = MagicMock()
        member.id = 1
        member.project_id = 100
        member.user_id = 10
        member.created_at = None
        member.user = MagicMock()
        member.user.id = 10
        member.user.display_name = "Alice"
        result = serialize_member(member)
        self.assertEqual(result["id"], 1)
        self.assertEqual(result["project_id"], 100)
        self.assertEqual(result["user_id"], 10)
        self.assertEqual(result["user"]["display_name"], "Alice")
        self.assertEqual(result["user"]["id"], 10)

    def test_member_without_user(self):
        member = MagicMock()
        member.id = 2
        member.project_id = 100
        member.user_id = 20
        member.created_at = None
        member.user = None
        result = serialize_member(member)
        self.assertEqual(result["id"], 2)
        self.assertEqual(result["user_id"], 20)
        self.assertIsNone(result["user"])

    def test_returns_dict(self):
        member = MagicMock()
        member.id = 3
        member.project_id = 200
        member.user_id = 30
        member.created_at = "2024-01-01"
        member.user = None
        result = serialize_member(member)
        self.assertIsInstance(result, dict)
        self.assertEqual(result["created_at"], "2024-01-01")
