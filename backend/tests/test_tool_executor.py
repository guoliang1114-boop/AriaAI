"""Tests for tool_executor pure functions."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.tool_executor import (
    extract_tool_calls,
    create_tool_message,
    should_continue_with_tools,
    format_tools_for_claude,
    handle_tool_use,
    execute_tool_sequence,
    stream_with_tools,
)


class ExtractToolCallsTestCase(unittest.TestCase):
    def test_extracts_tool_use_blocks(self):
        content = [
            {"type": "text", "text": "hello"},
            {"type": "tool_use", "id": "1", "name": "search", "input": {"q": "test"}},
            {"type": "text", "text": "world"},
            {"type": "tool_use", "id": "2", "name": "calc", "input": {"expr": "1+1"}},
        ]
        result = extract_tool_calls(content)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "search")
        self.assertEqual(result[1]["name"], "calc")

    def test_empty_content(self):
        self.assertEqual(extract_tool_calls([]), [])

    def test_no_tool_use_blocks(self):
        content = [
            {"type": "text", "text": "hello"},
            {"type": "text", "text": "world"},
        ]
        self.assertEqual(extract_tool_calls(content), [])

    def test_only_tool_use_blocks(self):
        content = [
            {"type": "tool_use", "id": "1", "name": "a", "input": {}},
            {"type": "tool_use", "id": "2", "name": "b", "input": {}},
        ]
        result = extract_tool_calls(content)
        self.assertEqual(len(result), 2)


class CreateToolMessageTestCase(unittest.TestCase):
    def test_creates_message(self):
        results = [
            {"type": "tool_result", "tool_use_id": "1", "content": "{}"},
        ]
        msg = create_tool_message(results)
        self.assertEqual(msg["role"], "user")
        self.assertEqual(msg["content"], results)

    def test_empty_results(self):
        msg = create_tool_message([])
        self.assertEqual(msg["role"], "user")
        self.assertEqual(msg["content"], [])


class ShouldContinueWithToolsTestCase(unittest.TestCase):
    def test_true_when_tool_use_stop_and_has_tool_blocks(self):
        response = {
            "stop_reason": "tool_use",
            "content": [{"type": "tool_use", "id": "1", "name": "search", "input": {}}],
        }
        self.assertTrue(should_continue_with_tools(response))

    def test_false_when_end_turn(self):
        response = {
            "stop_reason": "end_turn",
            "content": [{"type": "tool_use", "id": "1", "name": "search", "input": {}}],
        }
        self.assertFalse(should_continue_with_tools(response))

    def test_false_when_no_tool_blocks(self):
        response = {
            "stop_reason": "tool_use",
            "content": [{"type": "text", "text": "done"}],
        }
        self.assertFalse(should_continue_with_tools(response))

    def test_false_when_empty_content(self):
        response = {
            "stop_reason": "tool_use",
            "content": [],
        }
        self.assertFalse(should_continue_with_tools(response))


class FormatToolsForClaudeTestCase(unittest.TestCase):
    def test_dict_tools_pass_through(self):
        tools = [
            {"name": "search", "description": "Search", "input_schema": {"type": "object"}},
        ]
        result = format_tools_for_claude(tools)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["name"], "search")

    def test_string_tool_looks_up_registry(self):
        mock_tool = MagicMock()
        mock_tool.to_anthropic_schema.return_value = {
            "name": "test_tool",
            "description": "A test tool",
            "input_schema": {"type": "object"},
        }
        with patch("app.services.tool_executor.registry") as mock_registry:
            mock_registry.get.return_value = mock_tool
            result = format_tools_for_claude(["test_tool"])
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["name"], "test_tool")
            mock_registry.get.assert_called_once_with("test_tool")

    def test_string_tool_not_in_registry(self):
        with patch("app.services.tool_executor.registry") as mock_registry:
            mock_registry.get.return_value = None
            result = format_tools_for_claude(["nonexistent"])
            self.assertEqual(result, [])

    def test_mixed_tools(self):
        mock_tool = MagicMock()
        mock_tool.to_anthropic_schema.return_value = {"name": "reg_tool", "description": "d", "input_schema": {}}
        with patch("app.services.tool_executor.registry") as mock_registry:
            mock_registry.get.return_value = mock_tool
            tools = [
                "reg_tool",
                {"name": "direct_tool", "description": "d", "input_schema": {}},
            ]
            result = format_tools_for_claude(tools)
            self.assertEqual(len(result), 2)

    def test_empty_list(self):
        result = format_tools_for_claude([])
        self.assertEqual(result, [])


class HandleToolUseTestCase(unittest.TestCase):
    def test_handle_tool_use(self):
        mock_result = {"type": "tool_result", "tool_name": "search", "status": "success", "output": {"items": []}}
        with patch("app.services.tool_executor.registry") as mock_registry:
            mock_registry.execute = AsyncMock(return_value=mock_result)
            block = {"name": "search", "input": {"q": "test"}, "id": "tool_1"}
            result = asyncio.run(handle_tool_use(block))
            self.assertEqual(result["type"], "tool_result")
            self.assertEqual(result["tool_use_id"], "tool_1")
            mock_registry.execute.assert_called_once_with("search", {"q": "test"})


class ExecuteToolSequenceTestCase(unittest.TestCase):
    def test_execute_multiple_tools(self):
        mock_result = {"type": "tool_result", "tool_name": "t", "status": "success", "output": {}}
        with patch("app.services.tool_executor.registry") as mock_registry:
            mock_registry.execute = AsyncMock(return_value=mock_result)
            content = [
                {"type": "text", "text": "thinking"},
                {"type": "tool_use", "id": "1", "name": "tool_a", "input": {"x": 1}},
                {"type": "tool_use", "id": "2", "name": "tool_b", "input": {"y": 2}},
            ]
            results = asyncio.run(execute_tool_sequence(content))
            self.assertEqual(len(results), 2)
            self.assertEqual(mock_registry.execute.call_count, 2)

    def test_execute_no_tools(self):
        content = [{"type": "text", "text": "no tools here"}]
        results = asyncio.run(execute_tool_sequence(content))
        self.assertEqual(results, [])


class StreamWithToolsTestCase(unittest.TestCase):
    def test_stream_with_tools_handles_split_json_and_spacing(self):
        async def source():
            yield "先读取 "
            yield '{\n  "type"'
            yield ': "tool_use", "id": "tool_1", "name": "search", "input": {"q": "abc"}}'
            yield " 完成"

        mock_result = {"type": "tool_result", "tool_name": "search", "status": "success", "output": {"items": []}}
        callback = AsyncMock()
        with patch("app.services.tool_executor.registry") as mock_registry:
            mock_registry.execute = AsyncMock(return_value=mock_result)

            async def collect():
                return [chunk async for chunk in stream_with_tools(source(), callback)]

            chunks = asyncio.run(collect())

        joined = "".join(chunks)
        self.assertIn("先读取 ", joined)
        self.assertIn("[TOOL_RESULT:", joined)
        self.assertIn(" 完成", joined)
        mock_registry.execute.assert_awaited_once_with("search", {"q": "abc"})
        callback.assert_awaited_once()

    def test_stream_with_tools_does_not_cut_large_incomplete_json(self):
        large_value = "x" * 1500

        async def source():
            yield '{"type":"tool_use","id":"tool_1","name":"search","input":{"q":"'
            yield large_value
            yield '"}}'

        mock_result = {"type": "tool_result", "tool_name": "search", "status": "success", "output": {}}
        with patch("app.services.tool_executor.registry") as mock_registry:
            mock_registry.execute = AsyncMock(return_value=mock_result)

            async def collect():
                return [chunk async for chunk in stream_with_tools(source())]

            chunks = asyncio.run(collect())

        self.assertEqual(len(chunks), 1)
        self.assertIn("[TOOL_RESULT:", chunks[0])
        mock_registry.execute.assert_awaited_once_with("search", {"q": large_value})
