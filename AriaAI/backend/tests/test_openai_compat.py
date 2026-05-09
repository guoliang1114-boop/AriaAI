"""Tests for openai_compat.py message conversion and DeepSeek reasoning_content handling."""

from __future__ import annotations

import json
import unittest

from app.services.openai_compat import (
    _ensure_deepseek_reasoning_content,
    _to_openai_messages,
)


class ToOpenAIMessagesTests(unittest.TestCase):
    """Tests for _to_openai_messages conversion logic."""

    def test_plain_string_preserved(self):
        messages = [{"role": "user", "content": "Hello"}]
        result = _to_openai_messages(messages)
        self.assertEqual(result, [{"role": "user", "content": "Hello"}])

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
        result = _to_openai_messages(messages)
        self.assertEqual(result[0]["role"], "assistant")
        self.assertEqual(result[0]["content"], "Let me check.")
        self.assertIn("tool_calls", result[0])
        self.assertEqual(result[0]["reasoning_content"], "I need to search.")

    def test_assistant_without_tool_use_preserves_reasoning(self):
        messages = [
            {
                "role": "assistant",
                "content": [{"type": "text", "text": "Hello."}],
                "reasoning_content": "Thinking...",
            }
        ]
        result = _to_openai_messages(messages)
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
        result = _to_openai_messages(messages)
        self.assertIsNone(result[0]["content"])
        self.assertIn("tool_calls", result[0])

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
        result = _to_openai_messages(messages)
        self.assertEqual(result[0]["role"], "tool")
        self.assertEqual(result[0]["tool_call_id"], "call_1")
        self.assertEqual(result[0]["content"], "done")
        self.assertEqual(result[1]["role"], "user")
        self.assertEqual(result[1]["content"], "Thanks.")


class DeepSeekReasoningContentTests(unittest.TestCase):
    """Tests for _ensure_deepseek_reasoning_content."""

    def test_no_op_when_no_reasoning_present(self):
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello."},
        ]
        result = _ensure_deepseek_reasoning_content(messages)
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
        result = _ensure_deepseek_reasoning_content(messages)
        self.assertEqual(result[1]["reasoning_content"], "")
        self.assertEqual(result[3]["reasoning_content"], "I will act.")

    def test_adds_empty_reasoning_to_all_assistants_when_one_has_it(self):
        messages = [
            {"role": "assistant", "content": "First reply."},
            {"role": "assistant", "content": "Second reply.", "reasoning_content": "Think."},
            {"role": "assistant", "content": "Third reply."},
        ]
        result = _ensure_deepseek_reasoning_content(messages)
        self.assertEqual(result[0]["reasoning_content"], "")
        self.assertEqual(result[1]["reasoning_content"], "Think.")
        self.assertEqual(result[2]["reasoning_content"], "")

    def test_leaves_non_assistant_messages_untouched(self):
        messages = [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello.", "reasoning_content": "Greet."},
            {"role": "tool", "tool_call_id": "x", "content": "y"},
        ]
        result = _ensure_deepseek_reasoning_content(messages)
        self.assertNotIn("reasoning_content", result[0])
        self.assertNotIn("reasoning_content", result[2])

    def test_full_pipeline_with_tool_calls(self):
        """End-to-end: _to_openai_messages + _ensure_deepseek_reasoning_content."""
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
        openai_msgs = _to_openai_messages(raw_messages)
        final_msgs = _ensure_deepseek_reasoning_content(openai_msgs)

        assistant_msgs = [m for m in final_msgs if m["role"] == "assistant"]
        self.assertEqual(len(assistant_msgs), 2)
        self.assertEqual(assistant_msgs[0]["reasoning_content"], "")
        self.assertEqual(assistant_msgs[1]["reasoning_content"], "I will read.")
        self.assertIsNone(assistant_msgs[1]["content"])
        self.assertIn("tool_calls", assistant_msgs[1])


if __name__ == "__main__":
    unittest.main()
