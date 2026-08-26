"""Regression coverage for project chat feature wiring."""
from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.routers.chat import router as chat_router
from app.routers.chat_async import (
    ChatTaskStatusResponse,
    _execute_chat_in_background,
    _latest_background_chat_run,
    _mark_background_chat_run,
)
from app.routers.chat_schemas import MentionContext, SendMessageRequest
from app.models.db import Conversation, TaskRun
from app.services.chat.sse import sse_event
from sqlmodel import Session, SQLModel
from tests.test_database import create_test_engine, drop_all_tables


class ChatRouterWiringTestCase(unittest.TestCase):
    def test_project_chat_feature_routes_are_mounted(self):
        paths = {route.path for route in chat_router.routes}
        self.assertIn("/chat/send-async", paths)
        self.assertIn("/chat/tasks/{conversation_id}", paths)
        self.assertIn("/chat/mentionables", paths)
        self.assertIn("/chat/models", paths)
        self.assertIn("/chat/plan", paths)
        self.assertIn("/chat/messages/{message_id}/feedback", paths)
        self.assertIn("/chat/projects/{project_id}/interaction-metrics", paths)
        self.assertIn("/chat/conversations/{conversation_id}/recovery-preview", paths)


class ChatSchemaTestCase(unittest.TestCase):
    def test_mention_context_uses_independent_defaults(self):
        first = MentionContext()
        second = MentionContext()

        first.file_ids.append(1)

        self.assertEqual(first.file_ids, [1])
        self.assertEqual(second.file_ids, [])

    def test_send_message_accepts_model_and_mentions(self):
        req = SendMessageRequest(
            content="请基于 @f:7:brief.md 总结",
            project_id=27,
            model="deepseek-v4-pro",
            mention_context={"file_ids": [7], "stakeholder_ids": [3], "milestone_ids": [2]},
        )

        self.assertEqual(req.model, "deepseek-v4-pro")
        self.assertEqual(req.mention_context.file_ids, [7])
        self.assertEqual(req.mention_context.stakeholder_ids, [3])
        self.assertEqual(req.mention_context.milestone_ids, [2])

    def test_send_message_accepts_bounded_turn_revision_trace(self):
        req = SendMessageRequest(
            content="修订后重试",
            project_id=27,
            turn_revision={
                "source_message_id": 91,
                "source_fingerprint": "turn-1a2b3c4d",
                "source_role": "assistant",
                "changed_fields": ["goal", "constraints", "skill"],
            },
        )

        self.assertEqual(req.turn_revision.source_message_id, 91)
        self.assertEqual(req.turn_revision.changed_fields, ["goal", "constraints", "skill"])

    def test_send_message_accepts_turn_setup_and_recovery_contracts(self):
        req = SendMessageRequest(
            content="继续未完成部分",
            project_id=27,
            turn_setup_trace={"outcome": "applied", "template_id": "risk_review"},
            turn_recovery={
                "source_run_id": "run_abc123",
                "source_message_id": 91,
                "strategy": "continue_as_new_turn",
                "completed_steps": [1],
                "side_effects_possible": True,
            },
        )

        self.assertEqual(req.turn_setup_trace.outcome, "applied")
        self.assertEqual(req.turn_recovery.source_run_id, "run_abc123")
        self.assertTrue(req.turn_recovery.side_effects_possible)


class BackgroundChatStatusSchemaTestCase(unittest.TestCase):
    def test_status_response_exposes_error_and_timestamp(self):
        status = ChatTaskStatusResponse(
            conversation_id=157,
            task_run_id=9,
            status="failed",
            message_count=3,
            error="boom",
            updated_at="2026-05-19T00:00:00+00:00",
        )

        self.assertEqual(status.task_run_id, 9)
        self.assertEqual(status.status, "failed")
        self.assertEqual(status.error, "boom")
        self.assertEqual(status.updated_at, "2026-05-19T00:00:00+00:00")


class BackgroundChatTaskRunPersistenceTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_latest_background_chat_run_and_status_updates_are_persisted(self):
        with Session(self.engine) as session:
            conv = Conversation(title="Background chat")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            conv_id = conv.id

            task = TaskRun(
                project_id=None,
                conversation_id=conv_id,
                task_type="background_chat",
                goal="生成材料",
                status="pending",
            )
            session.add(task)
            session.commit()
            session.refresh(task)

            task_id = task.id

        _mark_background_chat_run(self.engine, task_id, "running", "开始执行")
        _mark_background_chat_run(self.engine, task_id, "failed", "执行失败", "boom")

        with Session(self.engine) as session:
            latest = _latest_background_chat_run(session, conv_id)

            self.assertIsNotNone(latest)
            self.assertEqual(latest.id, task_id)
            self.assertEqual(latest.status, "failed")
            self.assertEqual(latest.error_message, "boom")
            self.assertIsNotNone(latest.started_at)
            self.assertIsNotNone(latest.completed_at)


class BackgroundChatExecutionTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    async def asyncTearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    async def test_background_chat_marks_phase_error_done_as_failed(self):
        with Session(self.engine) as session:
            conv = Conversation(title="Background chat")
            session.add(conv)
            session.commit()
            session.refresh(conv)
            task = TaskRun(
                project_id=None,
                conversation_id=conv.id,
                task_type="background_chat",
                goal="生成材料",
                status="pending",
            )
            session.add(task)
            session.commit()
            session.refresh(task)
            conv_id = conv.id
            task_id = task.id

        runtime = SimpleNamespace(conv_id=conv_id)
        req = SendMessageRequest(content="生成材料", conversation_id=conv_id)

        async def fake_stream(*_args, **_kwargs):
            yield sse_event({"type": "text", "content": "失败说明"})
            yield sse_event(
                {
                    "type": "done",
                    "metadata": {
                        "phase_error": {
                            "phase": "P0 durable task",
                            "friendly_message": "任务失败",
                        }
                    },
                }
            )

        with patch("app.routers.chat_async.stream_chat_events", fake_stream):
            await _execute_chat_in_background(runtime, req, self.engine, task_id)

        with Session(self.engine) as session:
            task = session.get(TaskRun, task_id)
            self.assertEqual(task.status, "failed")
            self.assertEqual(task.error_message, "任务失败")


if __name__ == "__main__":
    unittest.main()
