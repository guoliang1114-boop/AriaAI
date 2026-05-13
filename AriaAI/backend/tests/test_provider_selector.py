"""Tests for provider_selector pure functions and tool_executor pure functions."""
import unittest

from app.services.provider_selector import resolve_provider_from_model


class ResolveProviderFromModelTestCase(unittest.TestCase):
    def test_kimi_models(self):
        self.assertEqual(resolve_provider_from_model("moonshot-v1-8k"), "kimi")
        self.assertEqual(resolve_provider_from_model("moonshot-v1-32k"), "kimi")
        self.assertEqual(resolve_provider_from_model("kimi-k2.5"), "kimi")
        self.assertEqual(resolve_provider_from_model("kimi-k2.6"), "kimi")

    def test_claude_models(self):
        self.assertEqual(resolve_provider_from_model("claude-sonnet-4-6"), "claude")
        self.assertEqual(resolve_provider_from_model("claude-3-opus"), "claude")

    def test_deepseek_models(self):
        self.assertEqual(resolve_provider_from_model("deepseek-v4-pro"), "deepseek")
        self.assertEqual(resolve_provider_from_model("deepseek-chat"), "deepseek")

    def test_bigmodel_models(self):
        self.assertEqual(resolve_provider_from_model("glm-4"), "bigmodel")
        self.assertEqual(resolve_provider_from_model("GLM-5.1"), "bigmodel")

    def test_mimo_models(self):
        self.assertEqual(resolve_provider_from_model("mimo-v2.5-flash"), "mimo")
        self.assertEqual(resolve_provider_from_model("xiaomi/mimo-v2.5-pro"), "mimo")

    def test_unknown_defaults_to_claude(self):
        self.assertEqual(resolve_provider_from_model("unknown-model"), "claude")
        self.assertEqual(resolve_provider_from_model(""), "claude")
