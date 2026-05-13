"""Tests for client_contexts pure helper functions."""
import unittest
from types import SimpleNamespace

from app.services.client_contexts import (
    _extract_first_json_object,
    _trim_text,
    _trim_list,
    _trim_contacts,
    _trim_stakeholders,
    _trim_project_history,
    build_client_memory_prompt,
    build_client_memory_summary_payload,
)


class ExtractFirstJsonObjectTestCase(unittest.TestCase):
    def test_simple_json(self):
        result = _extract_first_json_object('{"key": "value"}')
        self.assertEqual(result, '{"key": "value"}')

    def test_json_with_surrounding_text(self):
        result = _extract_first_json_object('Here is the JSON: {"key": "value"} and more text')
        self.assertEqual(result, '{"key": "value"}')

    def test_no_json_returns_empty(self):
        result = _extract_first_json_object("no json here")
        self.assertEqual(result, "{}")

    def test_nested_json(self):
        result = _extract_first_json_object('{"a": {"b": 1}}')
        self.assertIn('"a"', result)
        self.assertIn('"b"', result)

    def test_empty_string(self):
        result = _extract_first_json_object("")
        self.assertEqual(result, "{}")


class TrimTextTestCase(unittest.TestCase):
    def test_short_text_unchanged(self):
        self.assertEqual(_trim_text("hello", limit=10), "hello")

    def test_long_text_truncated(self):
        result = _trim_text("a" * 300, limit=100)
        self.assertLessEqual(len(result), 103)  # 100 + "..."

    def test_none_returns_empty(self):
        self.assertEqual(_trim_text(None), "")

    def test_non_string_converts(self):
        self.assertEqual(_trim_text(12345), "12345")

    def test_whitespace_trimmed(self):
        self.assertEqual(_trim_text("  hello  "), "hello")


class TrimListTestCase(unittest.TestCase):
    def test_short_list_unchanged(self):
        result = _trim_list(["a", "b", "c"], limit=5)
        self.assertEqual(result, ["a", "b", "c"])

    def test_long_list_truncated(self):
        result = _trim_list(["a"] * 20, limit=3)
        self.assertEqual(len(result), 3)

    def test_non_list_returns_empty(self):
        self.assertEqual(_trim_list("not a list"), [])

    def test_none_returns_empty(self):
        self.assertEqual(_trim_list(None), [])

    def test_item_text_truncated(self):
        result = _trim_list(["a" * 200], limit=5, text_limit=50)
        self.assertLessEqual(len(result[0]), 53)  # 50 + "..."


class TrimContactsTestCase(unittest.TestCase):
    def test_normal_contacts(self):
        contacts = [
            {"name": "Alice", "role": "CEO"},
            {"name": "Bob", "role": "CTO"},
        ]
        result = _trim_contacts(contacts)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "Alice")

    def test_truncates_long_list(self):
        contacts = [{"name": f"Person {i}"} for i in range(20)]
        result = _trim_contacts(contacts, limit=3)
        self.assertEqual(len(result), 3)

    def test_non_list_returns_empty(self):
        self.assertEqual(_trim_contacts(None), [])


class TrimStakeholdersTestCase(unittest.TestCase):
    def test_normal_stakeholders(self):
        stakeholders = [
            {"name": "Alice", "role": "CEO", "influence": "high"},
        ]
        result = _trim_stakeholders(stakeholders)
        self.assertEqual(len(result), 1)

    def test_truncates(self):
        stakeholders = [{"name": f"S{i}", "role": "R", "influence": "low"} for i in range(20)]
        result = _trim_stakeholders(stakeholders, limit=5)
        self.assertEqual(len(result), 5)


class TrimProjectHistoryTestCase(unittest.TestCase):
    def test_normal_history(self):
        history = [
            {"name": "Project A", "status": "completed"},
        ]
        result = _trim_project_history(history)
        self.assertEqual(len(result), 1)

    def test_non_list_returns_empty(self):
        self.assertEqual(_trim_project_history(None), [])


class BuildClientMemoryPromptTestCase(unittest.TestCase):
    def test_contains_key_sections(self):
        result = build_client_memory_prompt("test client data")
        self.assertIn("test client data", result)
        self.assertIsInstance(result, str)
        self.assertGreater(len(result), 100)


class BuildClientMemorySummaryPayloadTestCase(unittest.TestCase):
    def test_stakeholder_type(self):
        memory = {
            "client_profile": "Tech company",
            "key_contacts": [{"name": "Alice"}],
            "structured_stakeholders": [{"name": "Bob"}],
            "sensitive_topics": ["budget"],
        }
        result = build_client_memory_summary_payload(memory, "stakeholder")
        self.assertIn("client_profile", result)
        self.assertIn("key_contacts", result)
        self.assertNotIn("lessons_learned", result)

    def test_lessons_type(self):
        memory = {
            "client_profile": "Tech company",
            "lessons_learned": ["lesson 1"],
            "project_history": [{"name": "P1"}],
        }
        result = build_client_memory_summary_payload(memory, "lessons")
        self.assertIn("lessons_learned", result)
        self.assertIn("project_history", result)
        self.assertNotIn("key_contacts", result)

    def test_relationship_type(self):
        memory = {
            "client_profile": "Tech company",
            "key_contacts": [],
            "structured_stakeholders": [],
        }
        result = build_client_memory_summary_payload(memory, "relationship")
        self.assertIn("client_profile", result)

    def test_unknown_type_returns_base(self):
        memory = {
            "client_profile": "Tech company",
            "key_contacts": [],
            "lessons_learned": [],
        }
        result = build_client_memory_summary_payload(memory, "unknown_type")
        self.assertIn("client_profile", result)
