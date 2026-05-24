"""Tests for chat_exports service — pure functions."""
import unittest
from datetime import datetime

from app.services.chat_exports import safe_export_filename, build_markdown_export_content
from app.services.time_utils import utc_now_naive


class SafeExportFilenameTestCase(unittest.TestCase):
    def test_basic_title(self):
        result = safe_export_filename("My Chat", datetime(2024, 1, 15), "md")
        self.assertIn("My Chat", result)
        self.assertIn("20240115", result)
        self.assertTrue(result.endswith(".md"))

    def test_special_characters_stripped(self):
        result = safe_export_filename("Chat: Test (2024)!", datetime(2024, 6, 1), "pdf")
        self.assertNotIn(":", result)
        self.assertNotIn("(", result)
        self.assertNotIn("!", result)
        self.assertTrue(result.endswith(".pdf"))

    def test_preserves_chinese(self):
        result = safe_export_filename("项目讨论", datetime(2024, 3, 20), "md")
        self.assertIn("项目讨论", result)
        self.assertTrue(result.endswith(".md"))

    def test_empty_title(self):
        result = safe_export_filename("", datetime(2024, 1, 1), "md")
        self.assertIn("20240101", result)
        self.assertTrue(result.endswith(".md"))

    def test_preserves_underscores_and_dashes(self):
        result = safe_export_filename("my-chat_v2", datetime(2024, 1, 1), "md")
        self.assertIn("my-chat_v2", result)


class BuildMarkdownExportContentTestCase(unittest.TestCase):
    def test_basic_export(self):
        class MockConv:
            title = "Test Conversation"
            created_at = datetime(2024, 1, 10, 12, 0, 0)

        class MockMsg:
            def __init__(self, role, content, created_at):
                self.role = role
                self.content = content
                self.created_at = created_at

        messages = [
            MockMsg("user", "Hello", datetime(2024, 1, 10, 12, 1, 0)),
            MockMsg("assistant", "Hi there!", datetime(2024, 1, 10, 12, 1, 30)),
        ]

        result = build_markdown_export_content(MockConv(), messages)
        self.assertIn("Test Conversation", result)
        self.assertIn("Hello", result)
        self.assertIn("Hi there!", result)
        self.assertIn("user", result.lower())

    def test_empty_messages(self):
        class MockConv:
            title = "Empty Chat"
            created_at = datetime(2024, 1, 1)

        result = build_markdown_export_content(MockConv(), [])
        self.assertIn("Empty Chat", result)

    def test_markdown_formatting(self):
        class MockConv:
            title = "Chat"
            created_at = datetime(2024, 1, 1)

        class MockMsg:
            def __init__(self, role, content, created_at):
                self.role = role
                self.content = content
                self.created_at = created_at

        messages = [MockMsg("user", "test", datetime(2024, 1, 1))]
        result = build_markdown_export_content(MockConv(), messages)
        self.assertIn("---", result)


if __name__ == "__main__":
    unittest.main()
