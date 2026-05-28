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

    def test_preferred_name_is_promoted_to_lead_line_not_bullet(self):
        """``personal_info.preferred_name`` must render as a dedicated lead line
        ("用户希望被称呼为：X") so the model treats it as a profile fact, not a
        generic preference toggle. It must NOT also appear as a bullet."""
        out = format_user_memory_for_prompt(
            {
                "personal_info": {"preferred_name": "李总"},
                "response_preferences": {"tone": "direct"},
            }
        )
        self.assertIn("用户希望被称呼为：李总", out)
        self.assertIn("- response_preferences.tone: direct", out)
        # Promoted, not duplicated as a bullet.
        self.assertNotIn("- personal_info.preferred_name:", out)
        self.assertNotIn("personal_info.preferred_name: 李总", out)

    def test_preferred_name_alone_still_renders_section(self):
        """A user who only set 称呼 (no other preferences) should still get the
        section emitted so the model knows how to address them."""
        out = format_user_memory_for_prompt({"personal_info": {"preferred_name": "小高"}})
        self.assertIn("User Memory", out)
        self.assertIn("用户希望被称呼为：小高", out)

    def test_empty_preferred_name_does_not_emit_lead_line(self):
        """Whitespace/empty values must not produce a dangling
        "用户希望被称呼为：" with nothing after it."""
        out = format_user_memory_for_prompt(
            {
                "personal_info": {"preferred_name": "   "},
                "response_preferences": {"tone": "direct"},
            }
        )
        self.assertNotIn("用户希望被称呼为", out)
        self.assertIn("- response_preferences.tone: direct", out)

    def test_other_personal_info_keys_still_become_bullets(self):
        """Only ``preferred_name`` is promoted — sibling personal_info keys keep
        the bullet path so we don't accidentally hide them."""
        out = format_user_memory_for_prompt(
            {"personal_info": {"preferred_name": "李总", "title": "CEO"}}
        )
        self.assertIn("用户希望被称呼为：李总", out)
        self.assertIn("- personal_info.title: CEO", out)

    def test_onboarding_seen_is_treated_as_housekeeping_not_a_preference(self):
        """``personal_info.onboarding_seen`` is the post-login welcome-page
        completion flag. It must never appear in the model's prompt — it's
        operational state, not user-stated preference."""
        out = format_user_memory_for_prompt(
            {"personal_info": {"preferred_name": "李总", "onboarding_seen": True}}
        )
        self.assertIn("用户希望被称呼为：李总", out)
        self.assertNotIn("onboarding_seen", out)

    def test_onboarding_seen_alone_yields_empty_section(self):
        """A user who only clicked '稍后再说' has nothing for the model to read."""
        out = format_user_memory_for_prompt({"personal_info": {"onboarding_seen": True}})
        self.assertEqual(out, "")


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
