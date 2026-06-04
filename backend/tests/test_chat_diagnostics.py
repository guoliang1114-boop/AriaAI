"""Tests for chat diagnostics — provider validation, missing key handling, HTTP paths."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session

from app.models.db import ChatTrace, Conversation, Message, User
from app.routers import chat as chat_router_module
from app.routers import chat_diagnostics as chat_diagnostics_router_module
from app.services import chat_diagnostics as cd
from app.services.time_utils import utc_now_naive
from tests.test_database import create_test_engine, drop_all_tables


class TestProviderConnectionTestCase(unittest.TestCase):
    def _call(self, provider, model=None):
        import asyncio
        return asyncio.run(cd.test_provider_connection(provider, model))

    def test_unsupported_provider(self):
        result = self._call("unknown")
        self.assertFalse(result["success"])
        self.assertIn("not supported", result["message"].lower())

    @patch("app.core.security.get_api_key", return_value="")
    def test_anthropic_missing_key(self, mock_get_key):
        result = self._call("anthropic")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_kimi_api_key", return_value="")
    def test_moonshot_missing_key(self, mock_get_key):
        result = self._call("moonshot")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_deepseek_api_key", return_value="")
    def test_deepseek_missing_key(self, mock_get_key):
        result = self._call("deepseek")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_bigmodel_api_key", return_value="")
    def test_bigmodel_missing_key(self, mock_get_key):
        result = self._call("bigmodel")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_mimo_api_key", return_value="")
    def test_mimo_missing_key(self, mock_get_key):
        result = self._call("mimo")
        self.assertFalse(result["success"])
        self.assertIn("no api key", result["message"].lower())

    @patch("app.core.security.get_api_key", return_value="sk-test")
    def test_anthropic_http_success(self, mock_get_key):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp):
            result = self._call("anthropic")
        self.assertTrue(result["success"])

    @patch("app.core.security.get_api_key", return_value="sk-test")
    def test_anthropic_http_error(self, mock_get_key):
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_resp):
            result = self._call("anthropic")
        self.assertFalse(result["success"])
        self.assertIn("401", result["message"])


class ResolveProviderForModelTestCase(unittest.TestCase):
    def test_moonshot_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("moonshot-v1"), "moonshot")

    def test_kimi_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("kimi-k2.6"), "moonshot")

    def test_claude_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("claude-3-opus"), "anthropic")

    def test_deepseek_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("deepseek-chat"), "deepseek")

    def test_bigmodel_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("glm-4-plus"), "bigmodel")

    def test_mimo_prefix(self):
        self.assertEqual(cd.resolve_provider_for_model("mimo-v2.5"), "mimo")

    def test_unsupported_returns_none(self):
        self.assertIsNone(cd.resolve_provider_for_model("unknown"))


class RunModelTestTestCase(unittest.TestCase):
    def _call(self, message, model):
        import asyncio
        return asyncio.run(cd.run_model_test(message, model))

    def test_unsupported_model(self):
        result = self._call("hi", "unsupported-model")
        self.assertFalse(result["success"])
        self.assertIn("not supported", result["message"].lower())

    @patch("app.services.claude.complete", new_callable=AsyncMock, return_value="Hello back")
    def test_claude_success(self, mock_complete):
        result = self._call("hi", "claude-3-opus")
        self.assertTrue(result["success"])
        self.assertIn("Hello back", result["response"])

    @patch("app.services.openai_compat.complete", new_callable=AsyncMock, return_value="OK")
    def test_openai_compat_success(self, mock_complete):
        result = self._call("hi", "deepseek-chat")
        self.assertTrue(result["success"])
        self.assertIn("OK", result["response"])

    @patch("app.services.claude.complete", new_callable=AsyncMock, side_effect=Exception("fail"))
    def test_failure_returns_error(self, mock_complete):
        result = self._call("hi", "claude-3-opus")
        self.assertFalse(result["success"])
        self.assertIn("failed", result["message"].lower())


class ChatTraceDiagnosticsRouteTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        # Persist the acting user so conversations can be owned by it (Postgres
        # enforces the owner_user_id FK, and conversation access is per-user).
        with Session(self.engine) as session:
            admin = User(
                email="admin@example.com",
                password_hash="x",
                is_admin=True,
                is_active=True,
            )
            session.add(admin)
            session.commit()
            session.refresh(admin)
            self.admin_id = admin.id

        def override_session():
            with Session(self.engine) as session:
                yield session

        app = FastAPI()
        app.include_router(chat_router_module.router)
        app.dependency_overrides[chat_diagnostics_router_module.get_session] = override_session
        app.dependency_overrides[chat_diagnostics_router_module.get_current_user] = lambda: User(
            id=self.admin_id,
            email="admin@example.com",
            password_hash="x",
            is_admin=True,
            is_active=True,
        )
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_get_message_trace_returns_exact_message_trace(self):
        with Session(self.engine) as session:
            # Owned by the acting user; conversations are isolated per-user even
            # for admins, so the trace endpoint requires real ownership.
            conv = Conversation(title="Trace test", owner_user_id=self.admin_id)
            session.add(conv)
            session.flush()
            msg = Message(conversation_id=conv.id, role="assistant", content="done")
            session.add(msg)
            session.flush()
            trace = ChatTrace(
                trace_id="trace-one",
                conversation_id=conv.id,
                message_id=msg.id,
                chat_mode="project_deep_dive",
                action_policy="read_only_tool",
                intent_method="policy_guard",
                intent_reason="test_reason",
                model_used="glm-5.1",
                prompt_layers_json='[{"name":"system","chars":12}]',
                tool_decisions_json='[{"tool_name":"update_project_markdown_document","status":"blocked"}]',
                stage_timings_json='{"total_stream_ms":42}',
                created_at=utc_now_naive(),
            )
            session.add(trace)
            session.commit()
            message_id = msg.id

        response = self.client.get(f"/chat/messages/{message_id}/trace")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["trace_id"], "trace-one")
        self.assertEqual(payload["message_id"], message_id)
        self.assertEqual(payload["chat_mode"], "project_deep_dive")
        self.assertEqual(payload["action_policy"], "read_only_tool")
        self.assertEqual(payload["tool_decisions"][0]["status"], "blocked")
