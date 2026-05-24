from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import claude as claude_module


class ClaudeCompleteSdkTestCase(unittest.TestCase):
    def test_complete_sdk_returns_empty_string_for_pure_tool_use(self):
        """If response only contains a tool_use block (no text), return empty string instead of crashing."""
        mock_block = MagicMock()
        mock_block.type = "tool_use"
        mock_response = MagicMock()
        mock_response.content = [mock_block]

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
            self.assertEqual(result, "")

    def test_complete_sdk_returns_text_for_normal_response(self):
        mock_block = MagicMock()
        mock_block.type = "text"
        mock_block.text = "Hello"
        mock_response = MagicMock()
        mock_response.content = [mock_block]

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

    def test_complete_sdk_returns_empty_string_for_empty_content(self):
        mock_response = MagicMock()
        mock_response.content = []

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
            self.assertEqual(result, "")


if __name__ == "__main__":
    unittest.main()
