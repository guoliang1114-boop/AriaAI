"""Tests for chat diagnostics — provider validation, missing key handling, HTTP paths."""
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session

from app.models.db import ChatTrace, Conversation, Message, User
from app.routers import chat as chat_router_module
from app.routers import chat_diagnostics as chat_diagnostics_router_module
from app.services import chat_diagnostics as cd
from app.services.context_builder.assembly import assemble_context
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

    @staticmethod
    def _context_manifest(*, messages: int, compacted: bool = False) -> dict:
        history = [
            {
                "role": "user" if index % 2 == 0 else "assistant",
                "content": ("private-history " * 500) if compacted else f"turn-{index}",
            }
            for index in range(messages)
        ]
        return assemble_context(
            system=("private-system " * 900) if compacted else "system",
            messages=history,
            tools=None,
            sources=[],
            context_window_tokens=4_096,
            max_output_tokens=512,
            history_summary_tokens=256,
        ).manifest

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
        self.assertEqual(payload["routing"]["chat_mode"], "project_deep_dive")
        self.assertEqual(payload["routing"]["action_policy"], "read_only_tool")
        self.assertEqual(payload["execution"]["tool_status_counts"]["blocked"], 1)
        self.assertFalse(payload["privacy"]["includes_tool_inputs"])

    def test_trace_diagnostics_list_and_compare_are_content_free(self):
        base_manifest = self._context_manifest(messages=2)
        target_manifest = self._context_manifest(messages=12, compacted=True)
        with Session(self.engine) as session:
            conv = Conversation(title="Trace comparison", owner_user_id=self.admin_id)
            session.add(conv)
            session.flush()
            base_message = Message(conversation_id=conv.id, role="assistant", content="base secret")
            target_message = Message(conversation_id=conv.id, role="assistant", content="target secret")
            session.add(base_message)
            session.add(target_message)
            session.flush()
            session.add(
                ChatTrace(
                    trace_id="trace-base",
                    conversation_id=conv.id,
                    message_id=base_message.id,
                    project_id=91,
                    chat_mode="standalone_qa",
                    action_policy="direct_answer",
                    intent_method="rule",
                    intent_reason="question",
                    model_used="glm-base",
                    metadata_json=json.dumps({
                        "context_manifest": base_manifest,
                        "prepare_metrics": {"turn_contract": {"user_goal": "must-not-leak"}},
                    }),
                    tool_decisions_json=json.dumps([{
                        "status": "success",
                        "input": {"secret": "must-not-leak"},
                    }]),
                    artifacts_json=json.dumps([{"path": "/must/not/leak.docx"}]),
                    fallback_events_json="[]",
                    stage_timings_json=json.dumps({"total_stream_ms": 100, "private": "hidden"}),
                    created_at=utc_now_naive(),
                )
            )
            session.add(
                ChatTrace(
                    trace_id="trace-target",
                    conversation_id=conv.id,
                    message_id=target_message.id,
                    project_id=91,
                    chat_mode="project_deep_dive",
                    action_policy="read_only_tool",
                    intent_method="policy_guard",
                    intent_reason="user repeated target-secret in routing prose",
                    model_used="glm-target",
                    metadata_json=json.dumps({"context_manifest": target_manifest}),
                    tool_decisions_json=json.dumps([
                        {"status": "blocked", "input": {"secret": "target-secret"}},
                        {"status": "success"},
                    ]),
                    fallback_events_json=json.dumps([
                        {"type": "tool_blocked", "reason": "secret fallback detail"},
                    ]),
                    created_at=utc_now_naive(),
                )
            )
            session.commit()
            conversation_id = int(conv.id or 0)
            target_message_id = int(target_message.id or 0)

        diagnostic_response = self.client.get(
            f"/chat/messages/{target_message_id}/trace"
        )
        self.assertEqual(diagnostic_response.status_code, 200)
        diagnostic = diagnostic_response.json()
        self.assertEqual(diagnostic["routing"]["chat_mode"], "project_deep_dive")
        self.assertEqual(
            diagnostic["routing"]["intent_reason"],
            "router_explanation_withheld",
        )
        self.assertTrue(diagnostic["context"]["manifest_valid"])
        self.assertTrue(diagnostic["context"]["history_compacted"])
        self.assertEqual(diagnostic["execution"]["tool_status_counts"]["blocked"], 1)
        self.assertFalse(diagnostic["privacy"]["includes_prompt_content"])
        rendered = json.dumps(diagnostic)
        self.assertNotIn("private-history", rendered)
        self.assertNotIn("target-secret", rendered)
        self.assertNotIn("secret fallback detail", rendered)

        list_response = self.client.get(
            f"/chat/conversations/{conversation_id}/traces",
            params={"limit": 1},
        )
        self.assertEqual(list_response.status_code, 200)
        trace_page = list_response.json()
        self.assertEqual([item["trace_id"] for item in trace_page["items"]], ["trace-target"])
        self.assertTrue(trace_page["has_more"])
        self.assertIsInstance(trace_page["next_before_id"], int)

        compare_response = self.client.get(
            f"/chat/conversations/{conversation_id}/trace-compare",
            params={"base_trace_id": "trace-base", "target_trace_id": "trace-target"},
        )
        self.assertEqual(compare_response.status_code, 200)
        comparison = compare_response.json()
        self.assertIn("route_changed", comparison["warnings"])
        self.assertIn("model_changed", comparison["warnings"])
        self.assertIn("target_history_compacted", comparison["warnings"])
        self.assertIn(
            {"field": "chat_mode", "before": "standalone_qa", "after": "project_deep_dive"},
            comparison["changes"],
        )
        self.assertNotIn("must-not-leak", json.dumps(comparison))

    def test_trace_compare_cannot_cross_conversation_scope(self):
        with Session(self.engine) as session:
            first = Conversation(title="First", owner_user_id=self.admin_id)
            second = Conversation(title="Second", owner_user_id=self.admin_id)
            session.add(first)
            session.add(second)
            session.flush()
            session.add(ChatTrace(trace_id="trace-first", conversation_id=first.id))
            session.add(ChatTrace(trace_id="trace-second", conversation_id=second.id))
            session.commit()
            first_id = int(first.id or 0)

        response = self.client.get(
            f"/chat/conversations/{first_id}/trace-compare",
            params={"base_trace_id": "trace-first", "target_trace_id": "trace-second"},
        )
        self.assertEqual(response.status_code, 404)

    def test_trace_diagnostic_query_bounds_fail_before_database_lookup(self):
        invalid_limit = self.client.get("/chat/conversations/1/traces", params={"limit": 51})
        invalid_trace_id = self.client.get(
            "/chat/conversations/1/trace-compare",
            params={"base_trace_id": "not valid", "target_trace_id": "trace-valid"},
        )

        self.assertEqual(invalid_limit.status_code, 422)
        self.assertEqual(invalid_trace_id.status_code, 422)
