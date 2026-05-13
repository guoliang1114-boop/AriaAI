"""Tests for title generator — background conversation title generation."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services import title_generator as tg


class GenerateConversationTitleTestCase(unittest.TestCase):
    def _call(self, **kwargs):
        import asyncio
        return asyncio.run(tg.generate_conversation_title(**kwargs))

    def test_successful_generation(self):
        mock_complete = AsyncMock(return_value="Project Kickoff")
        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_conv = MagicMock()
        mock_session.get.return_value = mock_conv
        mock_session_factory = MagicMock(return_value=mock_session)

        result = self._call(
            conv_id=1,
            user_content="Let's start the project",
            session_factory=mock_session_factory,
            complete_fn=mock_complete,
        )
        self.assertEqual(result, "Project Kickoff")
        self.assertEqual(mock_conv.title, "Project Kickoff")
        mock_session.commit.assert_called_once()

    def test_complete_fn_failure_returns_none(self):
        mock_complete = AsyncMock(side_effect=Exception("LLM error"))
        result = self._call(
            conv_id=1,
            user_content="Hello",
            session_factory=MagicMock(),
            complete_fn=mock_complete,
        )
        self.assertIsNone(result)

    def test_db_failure_returns_none(self):
        mock_complete = AsyncMock(return_value="Title")
        mock_session_factory = MagicMock(side_effect=Exception("DB error"))
        result = self._call(
            conv_id=1,
            user_content="Hello",
            session_factory=mock_session_factory,
            complete_fn=mock_complete,
        )
        self.assertIsNone(result)

    def test_fallback_to_user_content_when_title_empty(self):
        mock_complete = AsyncMock(return_value='   ')
        mock_session = MagicMock()
        mock_session.__enter__.return_value = mock_session
        mock_conv = MagicMock()
        mock_session.get.return_value = mock_conv
        mock_session_factory = MagicMock(return_value=mock_session)

        result = self._call(
            conv_id=2,
            user_content="Urgent request from client",
            session_factory=mock_session_factory,
            complete_fn=mock_complete,
        )
        self.assertEqual(result, "Urgent request from client")


class ScheduleTitleGenerationTestCase(unittest.TestCase):
    def test_schedules_without_blocking(self):
        """schedule_title_generation should not raise when event loop exists."""
        import asyncio
        mock_bind = MagicMock()
        mock_complete = MagicMock()
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            tg.schedule_title_generation(1, "Hello", mock_bind, mock_complete)
        finally:
            loop.close()
            asyncio.set_event_loop(None)
