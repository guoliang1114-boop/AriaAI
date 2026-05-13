"""Tests for claude.py build_system_prompt — pure function."""
import unittest

from app.services.claude import build_system_prompt


class BuildSystemPromptTestCase(unittest.TestCase):
    def test_empty_context(self):
        result = build_system_prompt("", "", "")
        self.assertIsInstance(result, str)
        self.assertGreater(len(result), 100)
        self.assertIn("consultant", result.lower())

    def test_with_skill_prompt(self):
        result = build_system_prompt("Custom skill instructions", "", "")
        self.assertIn("Custom skill instructions", result)

    def test_with_rag_context(self):
        result = build_system_prompt("", "Knowledge base content", "")
        self.assertIn("Knowledge base content", result)

    def test_with_project_context(self):
        result = build_system_prompt("", "", "# Project Context\nDetails here")
        self.assertIn("Details here", result)

    def test_workspace_inventory(self):
        result = build_system_prompt("", "", "# Workspace Project Inventory Context\nAll projects")
        self.assertIsInstance(result, str)
        self.assertGreater(len(result), 50)

    def test_client_portfolio(self):
        result = build_system_prompt("", "", "# Client Project Portfolio Context\nClient data")
        self.assertIsInstance(result, str)

    def test_chinese_workspace(self):
        result = build_system_prompt("", "", "# 工作台全局数据\n所有项目")
        self.assertIsInstance(result, str)
        self.assertGreater(len(result), 50)

    def test_project_context_with_identity_rules(self):
        result = build_system_prompt("", "", "# Project: Test Project\nDetails")
        self.assertIsInstance(result, str)
        self.assertGreater(len(result), 100)


if __name__ == "__main__":
    unittest.main()
