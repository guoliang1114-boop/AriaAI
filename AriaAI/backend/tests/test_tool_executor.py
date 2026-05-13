"""Tests for tool executor — tool invocation, result formatting, content extraction."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import tool_executor as te


class HandleToolUseTestCase(unittest.TestCase):
    async def _call(self, block):
        return await te.handle_tool_use(block)

    def test_executes_tool_and_formats_result(self):
        import asyncio
        with patch("app.services.tool_executor.registry.execute", new_callable=AsyncMock, return_value={"ok": True}):
            result = asyncio.run(self._call({"name": "test_tool", "input": {"x": 1}, "id": "tu_123"}))
        self.assertEqual(result["type"], "tool_result")
        self.assertEqual(result["tool_use_id"], "tu_123")
        self.assertIn('"ok": true', result["content"])


class FormatToolsForClaudeTestCase(unittest.TestCase):
    def test_string_tool_looked_up_in_registry(self):
        mock_def = MagicMock()
        mock_def.to_anthropic_schema.return_value = {"name": "my_tool"}
        with patch("app.services.tool_executor.registry.get", return_value=mock_def):
            result = te.format_tools_for_claude(["my_tool"])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "my_tool")

    def test_dict_tool_passed_through(self):
        result = te.format_tools_for_claude([{"name": "direct_tool"}])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "direct_tool")

    def test_missing_string_tool_skipped(self):
        with patch("app.services.tool_executor.registry.get", return_value=None):
            result = te.format_tools_for_claude(["missing"])
        self.assertEqual(len(result), 0)


class ExtractToolCallsTestCase(unittest.TestCase):
    def test_extracts_tool_use_blocks(self):
        content = [
            {"type": "text", "text": "hello"},
            {"type": "tool_use", "name": "tool1"},
            {"type": "tool_use", "name": "tool2"},
        ]
        result = te.extract_tool_calls(content)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "tool1")

    def test_empty_content(self):
        self.assertEqual(te.extract_tool_calls([]), [])


class ExecuteToolSequenceTestCase(unittest.TestCase):
    def test_executes_all_tools(self):
        import asyncio
        with patch("app.services.tool_executor.registry.execute", new_callable=AsyncMock, return_value={"r": 1}):
            results = asyncio.run(te.execute_tool_sequence([
                {"type": "tool_use", "name": "a", "input": {}, "id": "1"},
                {"type": "tool_use", "name": "b", "input": {}, "id": "2"},
            ]))
        self.assertEqual(len(results), 2)


class CreateToolMessageTestCase(unittest.TestCase):
    def test_creates_user_message(self):
        msg = te.create_tool_message([{"type": "tool_result", "tool_use_id": "x"}])
        self.assertEqual(msg["role"], "user")
        self.assertEqual(len(msg["content"]), 1)


class ShouldContinueWithToolsTestCase(unittest.TestCase):
    def test_true_when_stop_reason_is_tool_use(self):
        resp = {
            "stop_reason": "tool_use",
            "content": [{"type": "tool_use", "name": "t"}],
        }
        self.assertTrue(te.should_continue_with_tools(resp))

    def test_false_when_stop_reason_is_end_turn(self):
        resp = {
            "stop_reason": "end_turn",
            "content": [{"type": "tool_use", "name": "t"}],
        }
        self.assertFalse(te.should_continue_with_tools(resp))

    def test_false_when_no_tool_use_blocks(self):
        resp = {
            "stop_reason": "tool_use",
            "content": [{"type": "text", "text": "hi"}],
        }
        self.assertFalse(te.should_continue_with_tools(resp))
