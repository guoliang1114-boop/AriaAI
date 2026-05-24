"""Tests for openai_compat pure functions — model detection, parameter normalization."""
import unittest

from app.services.openai_compat import (
    _is_kimi_k2_model,
    _apply_moonshot_fixed_params,
    _is_mimo_model,
    _normalize_mimo_model,
    _mimo_base_url_for_key,
    build_system_prompt,
    _ensure_deepseek_reasoning_content,
)


class IsKimiK2ModelTestCase(unittest.TestCase):
    def test_kimi_k2_model(self):
        self.assertTrue(_is_kimi_k2_model("kimi-k2.5"))
        self.assertTrue(_is_kimi_k2_model("kimi-k2.6"))

    def test_non_k2_model(self):
        self.assertFalse(_is_kimi_k2_model("moonshot-v1-8k"))
        self.assertFalse(_is_kimi_k2_model("claude-sonnet-4-6"))
        self.assertFalse(_is_kimi_k2_model(""))


class ApplyMoonshotFixedParamsTestCase(unittest.TestCase):
    def test_k2_model(self):
        temp, top_p = _apply_moonshot_fixed_params("kimi-k2.5", 0.7)
        self.assertEqual(temp, 1.0)
        self.assertEqual(top_p, 0.95)

    def test_moonshot_model(self):
        temp, top_p = _apply_moonshot_fixed_params("moonshot-v1-8k", 0.7)
        self.assertAlmostEqual(temp, 0.6)
        self.assertAlmostEqual(top_p, 0.95)

    def test_non_moonshot_model(self):
        temp, top_p = _apply_moonshot_fixed_params("claude-sonnet-4-6", 0.7)
        self.assertAlmostEqual(temp, 0.7)
        self.assertIsNone(top_p)


class IsMimoModelTestCase(unittest.TestCase):
    def test_mimo_prefix(self):
        self.assertTrue(_is_mimo_model("mimo-v2.5-flash"))

    def test_xiaomi_prefix(self):
        self.assertTrue(_is_mimo_model("xiaomi/mimo-v2.5-flash"))

    def test_non_mimo(self):
        self.assertFalse(_is_mimo_model("claude-sonnet-4-6"))
        self.assertFalse(_is_mimo_model(""))


class NormalizeMimoModelTestCase(unittest.TestCase):
    def test_strips_xiaomi_prefix(self):
        result = _normalize_mimo_model("xiaomi/mimo-v2.5-flash")
        self.assertEqual(result, "mimo-v2.5-flash")

    def test_maps_v2_flash_alias(self):
        result = _normalize_mimo_model("mimo-v2-flash")
        self.assertEqual(result, "mimo-v2.5-flash")

    def test_maps_v2_plus_alias(self):
        result = _normalize_mimo_model("mimo-v2-plus")
        self.assertEqual(result, "mimo-v2-plus")  # No alias for v2-plus

    def test_passthrough_unknown(self):
        result = _normalize_mimo_model("mimo-v2.5-pro")
        self.assertEqual(result, "mimo-v2.5-pro")


class MimoBaseUrlForKeyTestCase(unittest.TestCase):
    def test_token_plan_key(self):
        url = _mimo_base_url_for_key("tp-abc123")
        self.assertIn("token-plan", url.lower())

    def test_regular_key(self):
        url = _mimo_base_url_for_key("sk-abc123")
        self.assertNotIn("token-plan", url.lower())


class BuildSystemPromptTestCase(unittest.TestCase):
    def test_empty_context(self):
        result = build_system_prompt("", "", "")
        self.assertIsInstance(result, str)
        self.assertGreater(len(result), 100)
        self.assertIn("consultant", result.lower())

    def test_with_skill_prompt(self):
        result = build_system_prompt("You are a strategy expert", "", "")
        self.assertIn("strategy expert", result)

    def test_with_rag_context(self):
        result = build_system_prompt("", "Some RAG context", "")
        self.assertIn("RAG context", result)

    def test_with_project_context(self):
        result = build_system_prompt("", "", "# Project Context\nProject details here")
        self.assertIn("Project details", result)

    def test_workspace_inventory_context(self):
        result = build_system_prompt("", "", "# Workspace Project Inventory Context\nAll projects")
        self.assertIsInstance(result, str)

    def test_client_portfolio_context(self):
        result = build_system_prompt("", "", "# Client Project Portfolio Context\nClient data")
        self.assertIsInstance(result, str)


class EnsureDeepseekReasoningContentTestCase(unittest.TestCase):
    def test_adds_reasoning_to_assistant_messages(self):
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi", "reasoning_content": "thinking..."},
            {"role": "user", "content": "more"},
            {"role": "assistant", "content": "response"},
        ]
        result = _ensure_deepseek_reasoning_content(messages)
        # The second assistant message should get empty reasoning_content
        self.assertIn("reasoning_content", result[3])
        self.assertEqual(result[3]["reasoning_content"], "")

    def test_preserves_existing_reasoning(self):
        messages = [
            {"role": "assistant", "content": "hi", "reasoning_content": "original"},
        ]
        result = _ensure_deepseek_reasoning_content(messages)
        self.assertEqual(result[0]["reasoning_content"], "original")

    def test_no_assistant_messages(self):
        messages = [{"role": "user", "content": "hello"}]
        result = _ensure_deepseek_reasoning_content(messages)
        self.assertEqual(len(result), 1)

    def test_empty_messages(self):
        result = _ensure_deepseek_reasoning_content([])
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
