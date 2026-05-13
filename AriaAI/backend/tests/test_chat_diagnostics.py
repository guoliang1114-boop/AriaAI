"""Tests for chat diagnostics — provider validation, missing key handling, HTTP paths."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import chat_diagnostics as cd


class TestProviderConnectionTestCase(unittest.TestCase):
    def _call(self, provider, model=None):
        import asyncio
        return asyncio.run(cd.test_provider_connection(provider, model))

    def test_unsupported_provider(self):
        result = self._call("unknown")
        self.assertFalse(result["success"])
        self.assertIn("not supported", result["message"].lower())

    @patch("app.core.security.get_api_key", return_value="")
    def test_anthropic_missing_key(self, mock_get_key):
        result = self._call("anthropic")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_kimi_api_key", return_value="")
    def test_moonshot_missing_key(self, mock_get_key):
        result = self._call("moonshot")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_deepseek_api_key", return_value="")
    def test_deepseek_missing_key(self, mock_get_key):
        result = self._call("deepseek")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_bigmodel_api_key", return_value="")
    def test_bigmodel_missing_key(self, mock_get_key):
        result = self._call("bigmodel")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_mimo_api_key", return_value="")
    def test_mimo_missing_key(self, mock_get_key):
        result = self._call("mimo")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_api_key", return_value="sk-test")
    def test_anthropic_http_success(self, mock_get_key):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp):
            result = self._call("anthropic")
        self.assertTrue(result["success"])

    @patch("app.core.security.get_api_key", return_value="sk-test")
    def test_anthropic_http_error(self, mock_get_key):
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp):
            result = self._call("anthropic")
        self.assertFalse(result["success"])
        self.assertIn("401", result["message"])


class ResolveProviderForModelTestCase(unittest.TestCase):
    def test_moonshot_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("moonshot-v1"), "moonshot")

    def test_kimi_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("kimi-k2.6"), "moonshot")

    def test_claude_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("claude-3-opus"), "anthropic")

    def test_deepseek_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("deepseek-chat"), "deepseek")

    def test_bigmodel_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("glm-4-plus"), "bigmodel")

    def test_mimo_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("mimo-v2.5"), "mimo")

    def test_unsupported_returns_none(self):
        self.assertIsNone(cd.resolve_provider_for_model("unknown"))


class RunModelTestTestCase(unittest.TestCase):
    def _call(self, message, model):
        import asyncio
        return asyncio.run(cd.run_model_test(message, model))

    def test_unsupported_model(self):
        result = self._call("hi", "unsupported-model")
        self.assertFalse(result["success"])
        self.assertIn("not supported", result["message"].lower())

    @patch("app.services.claude.complete", new_callable=AsyncMock, return_value="Hello back")
    def test_claude_success(self, mock_complete):
        result = self._call("hi", "claude-3-opus")
        self.assertTrue(result["success"])
        self.assertIn("Hello back", result["response"])

    @patch("app.services.openai_compat.complete", new_callable=AsyncMock, return_value="OK")
    def test_openai_compat_success(self, mock_complete):
        result = self._call("hi", "deepseek-chat")
        self.assertTrue(result["success"])
        self.assertIn("OK", result["response"])

    @patch("app.services.claude.complete", new_callable=AsyncMock, side_effect=Exception("fail"))
    def test_failure_returns_error(self, mock_complete):
        result = self._call("hi", "claude-3-opus")
        self.assertFalse(result["success"])
        self.assertIn("failed", result["message"].lower())
