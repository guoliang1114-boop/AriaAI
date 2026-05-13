"""Tests for tool_executor pure functions."""
import unittest

from app.services.tool_executor import (
    extract_tool_calls,
    create_tool_message,
    should_continue_with_tools,
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
