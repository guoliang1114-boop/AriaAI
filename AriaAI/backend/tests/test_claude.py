"""Tests for claude.py configuration and utility functions."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.services import claude as claude_module


class GetCustomBaseUrlTests(unittest.TestCase):
    """Tests for _get_custom_base_url."""

    def setUp(self):
        claude_module._settings_cache.clear()

    def tearDown(self):
        claude_module._settings_cache.clear()

    @patch.object(claude_module, "_get_setting", return_value="")
    def test_returns_none_when_no_env_or_setting(self, _mock_setting):
        with patch.dict(os.environ, {}, clear=True):
            result = claude_module._get_custom_base_url()
            self.assertIsNone(result)

    @patch.object(claude_module, "_get_setting", return_value="")
    def test_returns_custom_url_when_env_set(self, _mock_setting):
        with patch.dict(os.environ, {"ANTHROPIC_BASE_URL": "https://custom.anthropic.com"}):
            result = claude_module._get_custom_base_url()
            self.assertEqual(result, "https://custom.anthropic.com")

    @patch.object(claude_module, "_get_setting", return_value="")
    def test_returns_none_for_localhost(self, _mock_setting):
        with patch.dict(os.environ, {"ANTHROPIC_BASE_URL": "http://localhost:8080"}):
            result = claude_module._get_custom_base_url()
            self.assertIsNone(result)

    @patch.object(claude_module, "_get_setting", return_value="")
    def test_returns_none_for_127_0_0_1(self, _mock_setting):
        with patch.dict(os.environ, {"ANTHROPIC_BASE_URL": "http://127.0.0.1:8000"}):
            result = claude_module._get_custom_base_url()
            self.assertIsNone(result)

    @patch.object(claude_module, "_get_setting", return_value="")
    def test_returns_none_when_url_equals_official(self, _mock_setting):
        with patch.dict(os.environ, {"ANTHROPIC_BASE_URL": "https://api.anthropic.com"}):
            result = claude_module._get_custom_base_url()
            self.assertIsNone(result)

    @patch.object(claude_module, "_get_setting", return_value="https://db.setting.com")
    def test_database_setting_takes_priority_over_env(self, _mock_setting):
        with patch.dict(os.environ, {"ANTHROPIC_BASE_URL": "https://env.setting.com"}):
            result = claude_module._get_custom_base_url()
            self.assertEqual(result, "https://db.setting.com")

    @patch.object(claude_module, "_get_setting", return_value="not-a-url")
    def test_returns_none_for_non_http_url(self, _mock_setting):
        result = claude_module._get_custom_base_url()
        self.assertIsNone(result)


class ShouldUseHttpModeTests(unittest.TestCase):
    """Tests for _should_use_http_mode."""

    def setUp(self):
        claude_module._settings_cache.clear()

    def tearDown(self):
        claude_module._settings_cache.clear()

    @patch.object(claude_module, "_get_setting", return_value="http")
    def test_force_http_returns_true(self, _mock_setting):
        result = claude_module._should_use_http_mode()
        self.assertTrue(result)

    @patch.object(claude_module, "_get_setting", return_value="sdk")
    def test_force_sdk_returns_false(self, _mock_setting):
        result = claude_module._should_use_http_mode()
        self.assertFalse(result)

    @patch.object(claude_module, "_get_setting", return_value="auto")
    @patch.object(claude_module, "_get_custom_base_url", return_value="https://custom.com")
    def test_auto_with_custom_url_returns_true(self, _mock_custom, _mock_setting):
        result = claude_module._should_use_http_mode()
        self.assertTrue(result)

    @patch.object(claude_module, "_get_setting", return_value="auto")
    @patch.object(claude_module, "_get_custom_base_url", return_value=None)
    def test_auto_without_custom_url_returns_false(self, _mock_custom, _mock_setting):
        result = claude_module._should_use_http_mode()
        self.assertFalse(result)


class GetBaseUrlTests(unittest.TestCase):
    """Tests for _get_base_url."""

    @patch.object(claude_module, "_get_custom_base_url", return_value=None)
    def test_returns_official_when_no_custom(self, mock_custom):
        result = claude_module._get_base_url()
        self.assertEqual(result, claude_module._OFFICIAL_BASE_URL)
        mock_custom.assert_called_once()

    @patch.object(claude_module, "_get_custom_base_url", return_value="https://custom.com")
    def test_returns_custom_when_set(self, mock_custom):
        result = claude_module._get_base_url()
        self.assertEqual(result, "https://custom.com")
        mock_custom.assert_called_once()


class GetAuthHeadersTests(unittest.TestCase):
    """Tests for _get_auth_headers."""

    @patch.object(claude_module, "get_api_key", return_value="test-api-key")
    def test_contains_expected_headers(self, mock_get_api_key):
        result = claude_module._get_auth_headers()
        self.assertEqual(result["x-api-key"], "test-api-key")
        self.assertEqual(result["anthropic-version"], "2023-06-01")
        self.assertEqual(result["content-type"], "application/json")
        mock_get_api_key.assert_called_once()

    @patch.object(claude_module, "get_api_key", return_value="test-api-key")
    def test_uses_provided_api_key_over_get_api_key(self, mock_get_api_key):
        result = claude_module._get_auth_headers(api_key="provided-key")
        self.assertEqual(result["x-api-key"], "provided-key")
        mock_get_api_key.assert_not_called()


class BuildSystemPromptTests(unittest.TestCase):
    """Tests for build_system_prompt."""

    def test_combines_skill_prompt_and_project_context(self):
        skill = "You are a coding assistant."
        project = "Project: TestApp"
        result = claude_module.build_system_prompt(skill_prompt=skill, project_context=project)
        self.assertIn("## Skill Context", result)
        self.assertIn(skill, result)
        self.assertIn("## Project Context", result)
        self.assertIn(project, result)

    def test_omits_empty_sections(self):
        result = claude_module.build_system_prompt(skill_prompt="", project_context="")
        self.assertNotIn("## Skill Context", result)
        self.assertNotIn("## Project Context", result)

    def test_includes_identity_rules_by_default(self):
        result = claude_module.build_system_prompt()
        self.assertIn("Identity Guidelines", result)

    def test_omits_identity_for_client_portfolio_context(self):
        project = "# Client Project Portfolio Context\nSome data"
        result = claude_module.build_system_prompt(project_context=project)
        self.assertIn("Client Project Portfolio Context", result)
        self.assertNotIn("Identity Guidelines", result)

    def test_omits_identity_for_workspace_inventory_context(self):
        project = "# Workspace Project Inventory Context\nSome data"
        result = claude_module.build_system_prompt(project_context=project)
        self.assertIn("Workspace Project Inventory Context", result)
        self.assertNotIn("Identity Guidelines", result)


if __name__ == "__main__":
    unittest.main()
