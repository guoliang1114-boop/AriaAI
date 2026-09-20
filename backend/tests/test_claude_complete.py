from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from anthropic.types import Message

from app.services import claude as claude_module
from app.services.model_completion import ModelCompletionError


def _response(content, stop_reason="end_turn"):
    return Message.model_validate({
        "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-test",
        "usage": {"input_tokens": 10, "output_tokens": 20}, "stop_reason": stop_reason,
        "content": content,
    })


class ClaudeCompleteSdkTestCase(unittest.TestCase):
    def test_complete_sdk_returns_validated_pure_tool_use(self):
        mock_response = _response([
            {"type": "tool_use", "id": "call_1", "name": "search", "input": {"query": "test"}},
        ], "tool_use")

        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)

        with patch.object(claude_module, "_async_client_sdk", return_value=mock_client):
            result = asyncio.run(
                claude_module._complete_sdk(
                    messages=[{"role": "user", "content": "test"}],
                    system="sys",
                    model="claude-sonnet-4-6",
                )
            )
            self.assertEqual(json.loads(result), {
                "type": "tool_use", "id": "call_1", "name": "search", "input": {"query": "test"},
            })

    def test_complete_sdk_returns_text_for_normal_response(self):
        mock_response = _response([{"type": "text", "text": "Hello"}])

        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)

        with patch.object(claude_module, "_async_client_sdk", return_value=mock_client):
            result = asyncio.run(
                claude_module._complete_sdk(
                    messages=[{"role": "user", "content": "test"}],
                    system="sys",
                    model="claude-sonnet-4-6",
                )
            )
            self.assertEqual(result, "Hello")

    def test_complete_sdk_rejects_empty_content(self):
        mock_response = _response([])

        mock_client = MagicMock()
        mock_client.messages.create = AsyncMock(return_value=mock_response)

        with patch.object(claude_module, "_async_client_sdk", return_value=mock_client):
            with self.assertRaisesRegex(ModelCompletionError, "model_completion_no_final_content"):
                asyncio.run(
                    claude_module._complete_sdk(
                        messages=[{"role": "user", "content": "test"}],
                        system="sys",
                        model="claude-sonnet-4-6",
                    )
                )


if __name__ == "__main__":
    unittest.main()
