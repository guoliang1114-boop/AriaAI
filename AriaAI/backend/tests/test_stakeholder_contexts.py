"""Tests for stakeholder_contexts pure functions."""
import unittest
from types import SimpleNamespace

from app.services.stakeholder_contexts import (
    _normalized_client_name,
    serialize_client_stakeholder,
    format_client_stakeholders_for_prompt,
)


def _make_stakeholder(**kwargs):
    defaults = dict(
        name="Alice", role="CEO", organization_level="C-suite",
        influence_type="decision", relationship_status="active",
        concerns="", sensitivities="", communication_preference="",
        contact="", last_action="", personality_profile="",
        decision_style="", communication_strategy="",
        trust_signals="", note="",
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


class NormalizedClientNameTestCase(unittest.TestCase):
    def test_lowercase(self):
        self.assertEqual(_normalized_client_name("Alice Corp"), "alice corp")

    def test_strips_whitespace(self):
        self.assertEqual(_normalized_client_name("  Hello  "), "hello")

    def test_none_returns_empty(self):
        self.assertEqual(_normalized_client_name(None), "")

    def test_empty_string(self):
        self.assertEqual(_normalized_client_name(""), "")


class SerializeClientStakeholderTestCase(unittest.TestCase):
    def test_basic_stakeholder(self):
        s = _make_stakeholder()
        result = serialize_client_stakeholder(s)
        self.assertEqual(result["name"], "Alice")
        self.assertEqual(result["role"], "CEO")
        self.assertEqual(result["influence_type"], "decision")

    def test_none_fields_excluded(self):
        s = _make_stakeholder(role=None, influence_type=None, concerns=None)
        result = serialize_client_stakeholder(s)
        self.assertEqual(result["name"], "Alice")
        self.assertNotIn("role", result)
        self.assertNotIn("influence_type", result)

    def test_empty_string_fields_excluded(self):
        s = _make_stakeholder(role="", concerns="", note="")
        result = serialize_client_stakeholder(s)
        self.assertNotIn("role", result)
        self.assertNotIn("concerns", result)


class FormatClientStakeholdersForPromptTestCase(unittest.TestCase):
    def test_with_stakeholders(self):
        stakeholders = [
            {"name": "Alice", "role": "CEO", "influence_type": "decision"},
            {"name": "Bob", "role": "CTO", "influence_type": "technical"},
        ]
        result = format_client_stakeholders_for_prompt(stakeholders, "Key Contacts")
        self.assertIn("Alice", result)
        self.assertIn("Bob", result)
        self.assertIn("Key Contacts", result)

    def test_empty_list(self):
        result = format_client_stakeholders_for_prompt([], "Contacts")
        self.assertIsInstance(result, str)

    def test_missing_fields(self):
        stakeholders = [{"name": "Alice"}]
        result = format_client_stakeholders_for_prompt(stakeholders, "Contacts")
        self.assertIn("Alice", result)
