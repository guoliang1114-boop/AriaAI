"""Database contract for conversation continuity projections.

The production-database E2E workflow runs this file inside its disposable
``ariaai_test_*`` PostgreSQL schema after a verified production backup.  It
never reads or mutates ``public`` application tables.
"""
from __future__ import annotations

import json
import unittest
from types import SimpleNamespace

from sqlmodel import Session, SQLModel

from app.models.db import Conversation, Message, Project
from app.services.agent_harness.conversation_capsule import (
    build_conversation_capsule,
)
from app.services.chat.conversation_continuity import (
    build_conversation_continuity_snapshot,
)
from tests.test_database import create_test_engine, drop_all_tables


class ConversationContinuityDatabaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_test_engine()

    @classmethod
    def tearDownClass(cls) -> None:
        drop_all_tables(cls.engine)
        cls.engine.dispose()

    def setUp(self) -> None:
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def test_validated_capsule_and_project_questions_round_trip(self) -> None:
        with Session(self.engine) as session:
            project = Project(
                name="Continuity PostgreSQL",
                client="Test",
                memory_version=2,
                memory_stale=False,
                context_memory_json=json.dumps(
                    {"open_questions": {"ai": ["是否已确认验收范围？"], "pinned": []}},
                    ensure_ascii=False,
                ),
            )
            session.add(project)
            session.flush()
            conversation = Conversation(
                title="Continuity PostgreSQL",
                project_id=int(project.id or 0),
            )
            session.add(conversation)
            session.flush()
            source = Message(
                conversation_id=int(conversation.id or 0),
                role="user",
                content="继续交付计划",
            )
            session.add(source)
            session.flush()
            capsule = build_conversation_capsule(
                conversation_id=int(conversation.id or 0),
                project_id=int(project.id or 0),
                history=[source],
                current_content="继续交付计划",
                working_memory=SimpleNamespace(
                    current_artifact=None,
                    current_task=None,
                    last_user_request="继续交付计划",
                    last_assistant_summary="",
                    user_constraints=[],
                    decisions=[],
                ),
                turn_contract={
                    "mode": "plan_then_execute",
                    "user_goal": "继续交付计划",
                },
            )
            assistant = Message(
                conversation_id=int(conversation.id or 0),
                role="assistant",
                content="已形成交付计划。",
            )
            assistant.set_metadata({"conversation_capsule": capsule})
            session.add(assistant)
            session.commit()
            session.refresh(conversation)
            session.refresh(source)

            snapshot = build_conversation_continuity_snapshot(
                session,
                conversation=conversation,
            )

        self.assertEqual(snapshot["status"], "ready")
        self.assertEqual(snapshot["state"]["active_goal"], "继续交付计划")
        self.assertEqual(snapshot["state"]["source_message_ids"], [source.id])
        self.assertEqual(
            snapshot["project_questions"]["items"],
            ["是否已确认验收范围？"],
        )
        self.assertFalse(snapshot["privacy"]["includes_prompt_content"])
        self.assertFalse(snapshot["privacy"]["includes_tool_inputs"])
