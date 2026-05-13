"""Tests for openai_compat.py pure functions and API key getters."""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

from app.services import openai_compat as oai_module


class IsKimiK2ModelTests(unittest.TestCase):
    """Tests for _is_kimi_k2_model."""

    def test_true_for_kimi_k2_models(self):
        self.assertTrue(oai_module._is_kimi_k2_model("kimi-k2.6"))
        self.assertTrue(oai_module._is_kimi_k2_model("kimi-k2.0"))

    def test_false_for_other_models(self):
        self.assertFalse(oai_module._is_kimi_k2_model("kimi-k1"))
        self.assertFalse(oai_module._is_kimi_k2_model("moonshot-v1"))
        self.assertFalse(oai_module._is_kimi_k2_model("gpt-4"))


class ApplyMoonshotFixedParamsTests(unittest.TestCase):
    """Tests for _apply_moonshot_fixed_params."""

    def test_kimi_k2_returns_fixed_params(self):
        temp, top_p = oai_module._apply_moonshot_fixed_params("kimi-k2.6", 0.5)
        self.assertEqual(temp, 1.0)
        self.assertEqual(top_p, 0.95)

    def test_moonshot_returns_fixed_params(self):
        temp, top_p = oai_module._apply_moonshot_fixed_params("moonshot-v1", 0.5)
        self.assertEqual(temp, 0.6)
        self.assertEqual(top_p, 0.95)

    def test_other_models_returns_original_temperature(self):
        temp, top_p = oai_module._apply_moonshot_fixed_params("gpt-4", 0.5)
        self.assertEqual(temp, 0.5)
        self.assertIsNone(top_p)


class IsMimoModelTests(unittest.TestCase):
    """Tests for _is_mimo_model."""

    def test_true_for_mimo_prefix(self):
        self.assertTrue(oai_module._is_mimo_model("mimo-v2"))
        self.assertTrue(oai_module._is_mimo_model("xiaomi/mimo-v2"))

    def test_false_for_other_models(self):
        self.assertFalse(oai_module._is_mimo_model("gpt-4"))
        self.assertFalse(oai_module._is_mimo_model("kimi-k2"))
        self.assertFalse(oai_module._is_mimo_model(""))


class NormalizeMimoModelTests(unittest.TestCase):
    """Tests for _normalize_mimo_model."""

    def test_strips_xiaomi_prefix(self):
        self.assertEqual(oai_module._normalize_mimo_model("xiaomi/mimo-v2"), "mimo-v2")

    def test_resolves_legacy_aliases(self):
        self.assertEqual(oai_module._normalize_mimo_model("mimo-v2-flash"), "mimo-v2.5-flash")
        self.assertEqual(oai_module._normalize_mimo_model("mimo-v2-pro"), "mimo-v2.5-pro")
        self.assertEqual(oai_module._normalize_mimo_model("mimo-v2-omni"), "mimo-v2.5-omni")

    def test_returns_default_for_empty_or_none(self):
        self.assertEqual(oai_module._normalize_mimo_model(""), oai_module.DEFAULT_MIMO_MODEL)
        self.assertEqual(oai_module._normalize_mimo_model(None), oai_module.DEFAULT_MIMO_MODEL)

    def test_returns_unaliased_model(self):
        self.assertEqual(oai_module._normalize_mimo_model("mimo-v3"), "mimo-v3")


class MimoBaseUrlForKeyTests(unittest.TestCase):
    """Tests for _mimo_base_url_for_key."""

    def test_token_plan_url_for_tp_keys(self):
        result = oai_module._mimo_base_url_for_key("tp-abc123")
        self.assertEqual(result, oai_module.MIMO_TOKEN_PLAN_BASE_URL)

    def test_normal_url_for_non_tp_keys(self):
        result = oai_module._mimo_base_url_for_key("sk-abc123")
        self.assertEqual(result, oai_module.MIMO_BASE_URL)

    def test_normal_url_for_empty_key(self):
        result = oai_module._mimo_base_url_for_key("")
        self.assertEqual(result, oai_module.MIMO_BASE_URL)


class ToOpenAIMessagesTests(unittest.TestCase):
    """Tests for _to_openai_messages conversion logic."""

    def test_plain_string_preserved(self):
        messages = [{"role": "user", "content": "Hello"}]
        result = oai_module._to_openai_messages(messages)
        self.assertEqual(result, [{"role": "user", "content": "Hello"}])

    def test_system_prepended(self):
        messages = [{"role": "user", "content": "Hello"}]
        result = oai_module._to_openai_messages(messages, system="You are helpful.")
        self.assertEqual(result[0], {"role": "system", "content": "You are helpful."})
        self.assertEqual(result[1], {"role": "user", "content": "Hello"})

    def test_user_with_tool_results_converted_to_tool_role(self):
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "call_1", "content": "done"},
                    {"type": "text", "text": "Thanks."},
                ],
            }
        ]
        result = oai_module._to_openai_messages(messages)
        self.assertEqual(result[0]["role"], "tool")
        self.assertEqual(result[0]["tool_call_id"], "call_1")
        self.assertEqual(result[0]["content"], "done")
        self.assertEqual(result[1]["role"], "user")
        self.assertEqual(result[1]["content"], "Thanks.")

    def test_assistant_with_tool_use_and_reasoning(self):
        messages = [
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": "Let me check."},
                    {"type": "tool_use", "id": "call_1", "name": "search", "input": {"q": "x"}},
                ],
                "reasoning_content": "I need to search.",
            }
        ]
        result = oai_module._to_openai_messages(messages)
        self.assertEqual(result[0]["role"], "assistant")
        self.assertEqual(result[0]["content"], "Let me check.")
        self.assertIn("tool_calls", result[0])
        self.assertEqual(result[0]["tool_calls"][0]["id"], "call_1")
        self.assertEqual(result[0]["tool_calls"][0]["function"]["name"], "search")
        self.assertEqual(result[0]["reasoning_content"], "I need to search.")

    def test_assistant_without_tool_use_preserves_reasoning(self):
        messages = [
            {
                "role": "assistant",
                "content": [{"type": "text", "text": "Hello."}],
                "reasoning_content": "Thinking...",
            }
        ]
        result = oai_module._to_openai_messages(messages)
        self.assertEqual(result[0]["role"], "assistant")
        self.assertEqual(result[0]["content"], "Hello.")
        self.assertEqual(result[0]["reasoning_content"], "Thinking...")

    def test_tool_use_with_null_content_when_no_text(self):
        messages = [
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "call_1", "name": "search", "input": {}},
                ],
            }
        ]
        result = oai_module._to_openai_messages(messages)
        self.assertIsNone(result[0]["content"])
        self.assertIn("tool_calls", result[0])

    def test_none_content_handled(self):
        messages = [{"role": "user", "content": None}]
        result = oai_module._to_openai_messages(messages)
        self.assertEqual(result, [{"role": "user", "content": ""}])


class ToOpenAIToolsTests(unittest.TestCase):
    """Tests for _to_openai_tools."""

    def test_converts_claude_tools(self):
        tools = [
            {
                "name": "search",
                "description": "Search the web",
                "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
            }
        ]
        result = oai_module._to_openai_tools(tools)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["type"], "function")
        self.assertEqual(result[0]["function"]["name"], "search")
        self.assertEqual(result[0]["function"]["description"], "Search the web")
        self.assertEqual(
            result[0]["function"]["parameters"],
            {"type": "object", "properties": {"q": {"type": "string"}}},
        )

    def test_empty_tools(self):
        self.assertEqual(oai_module._to_openai_tools([]), [])


class ApiKeyGetterTests(unittest.TestCase):
    """Tests for get_kimi_api_key, get_bigmodel_api_key, get_deepseek_api_key, get_mimo_api_key."""

    @staticmethod
    def _mock_keyring(password):
        mock = MagicMock()
        mock.get_password.return_value = password
        return mock

    def _run_key_test(self, func_name, env_var):
        func = getattr(oai_module, func_name)

        # Keychain priority
        mock_keyring = self._mock_keyring("keychain-key")
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value=""):
                with patch.dict(os.environ, {}, clear=True):
                    result = func()
                    self.assertEqual(result, "keychain-key")

        # Database fallback
        mock_keyring = self._mock_keyring(None)
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value="db-key"):
                with patch.dict(os.environ, {}, clear=True):
                    result = func()
                    self.assertEqual(result, "db-key")

        # Env var fallback
        mock_keyring = self._mock_keyring(None)
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value=""):
                with patch.dict(os.environ, {env_var: "env-key"}):
                    result = func()
                    self.assertEqual(result, "env-key")

        # All empty returns None
        mock_keyring = self._mock_keyring(None)
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value=""):
                with patch.dict(os.environ, {}, clear=True):
                    result = func()
                    self.assertIsNone(result)

    def test_get_kimi_api_key(self):
        self._run_key_test("get_kimi_api_key", "MOONSHOT_API_KEY")

    def test_get_bigmodel_api_key(self):
        self._run_key_test("get_bigmodel_api_key", "BIGMODEL_API_KEY")

    def test_get_deepseek_api_key(self):
        self._run_key_test("get_deepseek_api_key", "DEEPSEEK_API_KEY")

    def test_get_mimo_api_key(self):
        # Keychain priority
        mock_keyring = self._mock_keyring("keychain-key")
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value=""):
                with patch.dict(os.environ, {}, clear=True):
                    result = oai_module.get_mimo_api_key()
                    self.assertEqual(result, "keychain-key")

        # MIMO_API_KEY env var
        mock_keyring = self._mock_keyring(None)
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value=""):
                with patch.dict(os.environ, {"MIMO_API_KEY": "env-mimo"}):
                    result = oai_module.get_mimo_api_key()
                    self.assertEqual(result, "env-mimo")

        # XIAOMI_API_KEY fallback
        mock_keyring = self._mock_keyring(None)
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value=""):
                with patch.dict(os.environ, {"XIAOMI_API_KEY": "env-xiaomi"}):
                    result = oai_module.get_mimo_api_key()
                    self.assertEqual(result, "env-xiaomi")

        # All empty returns None
        mock_keyring = self._mock_keyring(None)
        with patch.dict(sys.modules, {"keyring": mock_keyring}):
            with patch.object(oai_module, "_get_setting", return_value=""):
                with patch.dict(os.environ, {}, clear=True):
                    result = oai_module.get_mimo_api_key()
                    self.assertIsNone(result)


class DeepSeekReasoningContentTests(unittest.TestCase):
    """Tests for _ensure_deepseek_reasoning_content."""

    def test_no_op_when_no_reasoning_present(self):
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello."},
        ]
        result = oai_module._ensure_deepseek_reasoning_content(messages)
        self.assertEqual(result, messages)

    def test_adds_empty_reasoning_to_historical_assistant(self):
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello."},
            {"role": "user", "content": "Do this"},
            {
                "role": "assistant",
                "content": "OK.",
                "reasoning_content": "I will act.",
            },
        ]
        result = oai_module._ensure_deepseek_reasoning_content(messages)
        self.assertEqual(result[1]["reasoning_content"], "")
        self.assertEqual(result[3]["reasoning_content"], "I will act.")

    def test_adds_empty_reasoning_to_all_assistants_when_one_has_it(self):
        messages = [
            {"role": "assistant", "content": "First reply."},
            {"role": "assistant", "content": "Second reply.", "reasoning_content": "Think."},
            {"role": "assistant", "content": "Third reply."},
        ]
        result = oai_module._ensure_deepseek_reasoning_content(messages)
        self.assertEqual(result[0]["reasoning_content"], "")
        self.assertEqual(result[1]["reasoning_content"], "Think.")
        self.assertEqual(result[2]["reasoning_content"], "")

    def test_leaves_non_assistant_messages_untouched(self):
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello.", "reasoning_content": "Greet."},
            {"role": "tool", "tool_call_id": "x", "content": "y"},
        ]
        result = oai_module._ensure_deepseek_reasoning_content(messages)
        self.assertNotIn("reasoning_content", result[0])
        self.assertNotIn("reasoning_content", result[2])

    def test_full_pipeline_with_tool_calls(self):
        raw_messages = [
            {"role": "user", "content": "Analyze project."},
            {"role": "assistant", "content": "Sure."},
            {"role": "user", "content": "Read files."},
            {
                "role": "assistant",
                "content": [
                    {"type": "text", "text": ""},
                    {"type": "tool_use", "id": "call_1", "name": "read", "input": {}},
                ],
                "reasoning_content": "I will read.",
            },
            {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "call_1", "content": "done"}],
            },
        ]
        openai_msgs = oai_module._to_openai_messages(raw_messages)
        final_msgs = oai_module._ensure_deepseek_reasoning_content(openai_msgs)

        assistant_msgs = [m for m in final_msgs if m["role"] == "assistant"]
        self.assertEqual(len(assistant_msgs), 2)
        self.assertEqual(assistant_msgs[0]["reasoning_content"], "")
        self.assertEqual(assistant_msgs[1]["reasoning_content"], "I will read.")
        self.assertIsNone(assistant_msgs[1]["content"])
        self.assertIn("tool_calls", assistant_msgs[1])


if __name__ == "__main__":
    unittest.main()
