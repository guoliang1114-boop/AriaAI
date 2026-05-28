"""Tests for the user-memory → system-prompt injection helper."""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace

from sqlmodel import Session, SQLModel

from app.models.db import User, UserMemory
from app.services.chat.user_memory_prompt import (
    format_user_memory_for_prompt,
    load_user_memory_preferences,
)
from tests.test_database import create_test_engine, drop_all_tables


class FormatUserMemoryTest(unittest.TestCase):
    """Pure formatting tests — no DB needed."""

    def test_empty_input_yields_empty_string(self):
        self.assertEqual(format_user_memory_for_prompt(None), "")
        self.assertEqual(format_user_memory_for_prompt({}), "")
        # Whitespace-only / falsy values get filtered out and produce nothing.
        self.assertEqual(format_user_memory_for_prompt({"a": "", "b": None, "c": []}), "")

    def test_flat_preferences_render_as_bullets(self):
        out = format_user_memory_for_prompt({"language": "zh", "tone": "direct"})
        self.assertIn("User Memory", out)
        self.assertIn("- language: zh", out)
        self.assertIn("- tone: direct", out)

    def test_nested_one_level_renders_dotted_keys(self):
        out = format_user_memory_for_prompt(
            {
                "response_preferences": {"language": "zh", "verbosity": "normal"},
                "work_style": {"prefers_root_cause_first": True},
            }
        )
        self.assertIn("- response_preferences.language: zh", out)
        self.assertIn("- response_preferences.verbosity: normal", out)
        self.assertIn("- work_style.prefers_root_cause_first: 是", out)

    def test_list_values_join_with_chinese_punctuation(self):
        out = format_user_memory_for_prompt({"format_preferences": ["conclusion_first", "action_plan"]})
        self.assertIn("- format_preferences: conclusion_first、action_plan", out)

    def test_falsy_nested_values_are_dropped(self):
        out = format_user_memory_for_prompt(
            {
                "response_preferences": {
                    "language": "zh",
                    "verbosity": "",
                    "fancy_mode": False,
                },
            }
        )
        self.assertIn("response_preferences.language: zh", out)
        self.assertNotIn("verbosity", out)
        self.assertNotIn("fancy_mode", out)

    def test_overall_section_is_capped(self):
        big = {f"k{i}": "x" * 200 for i in range(50)}
        out = format_user_memory_for_prompt(big)
        # _MAX_PROMPT_CHARS is 1200; allow a tiny tail for the ellipsis.
        self.assertLessEqual(len(out), 1201)


class LoadUserMemoryFromDbTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(User(id=1, email="a@x.com", display_name="A", password_hash="x"))
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_returns_none_without_user_id(self):
        with Session(self.engine) as session:
            self.assertIsNone(load_user_memory_preferences(session, None))
            self.assertIsNone(load_user_memory_preferences(session, 0))

    def test_returns_none_when_no_row(self):
        with Session(self.engine) as session:
            self.assertIsNone(load_user_memory_preferences(session, 1))

    def test_returns_parsed_preferences(self):
        with Session(self.engine) as session:
            session.add(
                UserMemory(
                    user_id=1,
                    preferences_json=json.dumps({"language": "zh", "tone": "direct"}),
                    version=1,
                )
            )
            session.commit()
        with Session(self.engine) as session:
            prefs = load_user_memory_preferences(session, 1)
        self.assertEqual(prefs, {"language": "zh", "tone": "direct"})

    def test_returns_none_for_malformed_json(self):
        with Session(self.engine) as session:
            session.add(UserMemory(user_id=1, preferences_json="{not json", version=1))
            session.commit()
        with Session(self.engine) as session:
            self.assertIsNone(load_user_memory_preferences(session, 1))

    def test_returns_none_for_empty_object(self):
        with Session(self.engine) as session:
            session.add(UserMemory(user_id=1, preferences_json="{}", version=1))
            session.commit()
        with Session(self.engine) as session:
            self.assertIsNone(load_user_memory_preferences(session, 1))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
