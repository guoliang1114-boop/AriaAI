"""Tests for project_ai — robust extraction/parsing of LLM JSON output.

Regression cover for the prod bug where AI-suggest returned 500
"AI suggestion failed: Expecting value: line 1 column 1 (char 0)": kimi-k2.*
wraps the JSON array in a prose preamble / fenced block, and the old parser
only stripped a fence when the response *started* with ```. Anything else fed
non-JSON to json.loads. ``extract_json_array_from_text`` is shared by both the
clients and projects AI-suggest features, so testing it here covers both.
"""
import json
import unittest

from app.services.project_ai import (
    extract_json_array_from_text,
    parse_project_ai_suggestions,
)

_ARRAY = '[{"name": "Acme", "description": "A test."}]'


class ExtractJsonArrayTestCase(unittest.TestCase):
    def _assert_parses_to_one(self, raw: str):
        parsed = json.loads(extract_json_array_from_text(raw))
        self.assertIsInstance(parsed, list)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["name"], "Acme")

    def test_bare_array(self):
        self._assert_parses_to_one(_ARRAY)

    def test_clean_json_fence(self):
        # The one case the old parser handled (response starts with ```).
        self._assert_parses_to_one(f"```json\n{_ARRAY}\n```")

    def test_fence_without_json_label(self):
        self._assert_parses_to_one(f"```\n{_ARRAY}\n```")

    def test_prose_preamble_then_fence(self):
        # The exact prod failure mode — a preamble before the fence.
        self._assert_parses_to_one(f"Here are some suggestions:\n\n```json\n{_ARRAY}\n```")

    def test_array_embedded_in_prose_no_fence(self):
        self._assert_parses_to_one(f"Sure! {_ARRAY} Hope this helps.")

    def test_leading_and_trailing_whitespace(self):
        self._assert_parses_to_one(f"\n\n  {_ARRAY}  \n")

    def test_empty_string_degrades_to_empty_array(self):
        self.assertEqual(extract_json_array_from_text(""), "[]")
        self.assertEqual(json.loads(extract_json_array_from_text("")), [])

    def test_whitespace_only_degrades_to_empty_array(self):
        self.assertEqual(json.loads(extract_json_array_from_text("   \n  ")), [])

    def test_pure_prose_without_array_degrades_to_empty_array(self):
        self.assertEqual(json.loads(extract_json_array_from_text("I can't help with that.")), [])

    def test_none_input_degrades_to_empty_array(self):
        self.assertEqual(extract_json_array_from_text(None), "[]")


class ParseProjectAiSuggestionsTestCase(unittest.TestCase):
    def test_prose_wrapped_suggestions_parse(self):
        raw = (
            "好的，以下是建议：\n```json\n"
            '[{"name": "数字化转型路线图", "description": "范围说明。"}]\n```'
        )
        result = parse_project_ai_suggestions(raw)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "数字化转型路线图")
        self.assertEqual(result[0]["description"], "范围说明。")

    def test_caps_at_three_suggestions(self):
        items = ",".join(
            f'{{"name": "P{i}", "description": "d{i}"}}' for i in range(5)
        )
        result = parse_project_ai_suggestions(f"[{items}]")
        self.assertEqual(len(result), 3)

    def test_empty_output_returns_empty_list(self):
        self.assertEqual(parse_project_ai_suggestions(""), [])


if __name__ == "__main__":
    unittest.main()
