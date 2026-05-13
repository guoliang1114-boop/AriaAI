"""Tests for project_markdown pure functions."""
import unittest

from app.tools.project_markdown import (
    _first_non_empty_string,
    _normalize_markdown_update_input,
)


class FirstNonEmptyStringTestCase(unittest.TestCase):
    def test_returns_first_non_empty(self):
        self.assertEqual(_first_non_empty_string("", "hello", "world"), "hello")

    def test_skips_none(self):
        self.assertEqual(_first_non_empty_string(None, None, "found"), "found")

    def test_skips_empty_string(self):
        self.assertEqual(_first_non_empty_string("", "", "ok"), "ok")

    def test_all_empty_returns_empty(self):
        self.assertEqual(_first_non_empty_string("", None, ""), "")

    def test_no_args_returns_empty(self):
        self.assertEqual(_first_non_empty_string(), "")

    def test_single_non_empty(self):
        self.assertEqual(_first_non_empty_string("only"), "only")


class NormalizeMarkdownUpdateInputTestCase(unittest.TestCase):
    def test_mode_replace_aliases(self):
        for mode in ["write", "update", "edit", "replace"]:
            result_mode, _ = _normalize_markdown_update_input(mode=mode, content="c", extra={})
            self.assertEqual(result_mode, "replace", f"Failed for mode={mode}")

    def test_mode_append_aliases(self):
        for mode in ["add", "insert"]:
            result_mode, _ = _normalize_markdown_update_input(mode=mode, content="c", extra={})
            self.assertEqual(result_mode, "append", f"Failed for mode={mode}")

    def test_mode_create_alias(self):
        result_mode, _ = _normalize_markdown_update_input(mode="new", content="c", extra={})
        self.assertEqual(result_mode, "create")

    def test_mode_none_returns_empty(self):
        result_mode, _ = _normalize_markdown_update_input(mode=None, content="c", extra={})
        self.assertEqual(result_mode, "")

    def test_unknown_mode_passthrough(self):
        result_mode, _ = _normalize_markdown_update_input(mode="custom_mode", content="c", extra={})
        self.assertEqual(result_mode, "custom_mode")

    def test_content_from_body_alias(self):
        _, result_content = _normalize_markdown_update_input(mode="write", content=None, extra={"body": "from body"})
        self.assertEqual(result_content, "from body")

    def test_content_from_new_content_alias(self):
        _, result_content = _normalize_markdown_update_input(mode="write", content=None, extra={"new_content": "from new"})
        self.assertEqual(result_content, "from new")

    def test_content_from_text_alias(self):
        _, result_content = _normalize_markdown_update_input(mode="write", content=None, extra={"text": "from text"})
        self.assertEqual(result_content, "from text")

    def test_content_from_markdown_alias(self):
        _, result_content = _normalize_markdown_update_input(mode="write", content=None, extra={"markdown": "from md"})
        self.assertEqual(result_content, "from md")

    def test_content_direct_takes_precedence(self):
        _, result_content = _normalize_markdown_update_input(mode="write", content="direct", extra={"body": "alias"})
        self.assertEqual(result_content, "direct")

    def test_no_content_returns_empty(self):
        _, result_content = _normalize_markdown_update_input(mode="write", content=None, extra={})
        self.assertEqual(result_content, "")

    def test_extra_mode_aliases(self):
        for mode in ["rewrite", "correct", "modify", "save", "overwrite"]:
            result_mode, _ = _normalize_markdown_update_input(mode=mode, content="c", extra={})
            self.assertEqual(result_mode, "replace", f"Failed for mode={mode}")

    def test_mode_from_extra_action(self):
        result_mode, _ = _normalize_markdown_update_input(mode=None, content="c", extra={"action": "update"})
        self.assertEqual(result_mode, "replace")

    def test_content_from_updated_content_alias(self):
        _, result_content = _normalize_markdown_update_input(mode="write", content=None, extra={"updated_content": "updated"})
        self.assertEqual(result_content, "updated")


if __name__ == "__main__":
    unittest.main()
