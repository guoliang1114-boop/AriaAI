"""PostgreSQL contracts for project question resolution and accountability.

The production-database E2E workflow runs this file only inside its disposable
``ariaai_test_*`` schema after a verified backup. It never touches ``public``.
"""
from __future__ import annotations

import unittest

from sqlmodel import Session, SQLModel, select

from app.models.db import (
    Conversation,
    Message,
    Project,
    ProjectMember,
    ProjectQuestionProfile,
    ProjectQuestionProfileEvent,
    ProjectQuestionResolution,
    ProjectQuestionResolutionEvent,
    User,
)
from app.services.chat.conversation_continuity import (
    build_conversation_continuity_snapshot,
)
from app.services.chat_store import delete_conversation_with_messages
from app.services.project_contexts import save_project_memory
from app.services.project_question_answer_adoption import (
    parse_project_question_resolution_event_note,
)
from app.services.project_question_resolutions import (
    project_question_sha256,
    reopen_project_question,
    resolve_project_question,
)
from app.services.project_question_workbench import update_project_question_profile
from tests.test_database import create_test_engine, drop_all_tables


class ProjectQuestionResolutionDatabaseContractTests(unittest.TestCase):
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

    def test_resolve_and_reopen_round_trip_with_foreign_keys(self) -> None:
        with Session(self.engine) as session:
            owner = User(email="question-db@example.com", password_hash="x")
            project = Project(name="Question DB", client="Test")
            session.add(owner)
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id or 0),
                    user_id=int(owner.id or 0),
                    role="owner",
                )
            )
            conversation = Conversation(
                title="Question DB",
                project_id=int(project.id or 0),
                owner_user_id=int(owner.id or 0),
            )
            session.add(conversation)
            session.flush()
            answer = Message(
                conversation_id=int(conversation.id or 0),
                role="assistant",
                content="验收范围已经书面确认。",
            )
            session.add(answer)
            session.commit()
            save_project_memory(
                session,
                int(project.id or 0),
                {"open_questions": {"ai": ["验收范围确认了吗？"], "pinned": []}},
                trigger="postgres_question_seed",
            )
            session.refresh(project)
            session.refresh(conversation)
            session.refresh(owner)
            session.refresh(answer)
            before = build_conversation_continuity_snapshot(
                session,
                conversation=conversation,
            )["project_questions"]

            row = resolve_project_question(
                session,
                conversation=conversation,
                actor_user_id=int(owner.id or 0),
                question="验收范围确认了吗？",
                answer_message_id=int(answer.id or 0),
                resolution_summary="书面确认已归档。",
                expected_memory_version=before["memory_version"],
                expected_slot_version=before["slot_version"],
            )
            self.assertEqual(row.status, "resolved")
            self.assertEqual(row.answer_message_id, answer.id)
            resolved = build_conversation_continuity_snapshot(
                session,
                conversation=conversation,
            )["project_questions"]
            self.assertEqual(resolved["items"], [])
            self.assertEqual(resolved["resolved"][0]["status"], "resolved")

            session.delete(answer)
            session.commit()
            session.expire_all()
            detached = build_conversation_continuity_snapshot(
                session,
                conversation=session.get(Conversation, int(conversation.id or 0)),
            )["project_questions"]
            self.assertFalse(detached["resolved"][0]["answer_available"])
            self.assertIsNone(detached["resolved"][0]["answer_message_id"])
            if self.engine.dialect.name == "postgresql":
                self.assertIsNone(
                    session.get(ProjectQuestionResolution, int(row.id or 0)).answer_message_id
                )

            reopened = reopen_project_question(
                session,
                conversation=session.get(Conversation, int(conversation.id or 0)),
                resolution_id=int(row.id or 0),
                actor_user_id=int(owner.id or 0),
                reason="验收范围发生变更。",
                expected_resolution_revision=int(row.resolution_revision),
                expected_memory_version=resolved["memory_version"],
                expected_slot_version=resolved["slot_version"],
            )
            self.assertEqual(reopened.status, "open")
            self.assertEqual(reopened.resolution_revision, 2)
            events = session.exec(
                select(ProjectQuestionResolutionEvent).order_by(
                    ProjectQuestionResolutionEvent.resolution_revision
                )
            ).all()
            self.assertEqual([item.action for item in events], ["resolved", "reopened"])
            audit = parse_project_question_resolution_event_note(events[0].note)
            self.assertEqual(audit["resolution_summary"], "书面确认已归档。")
            self.assertEqual(
                audit["answer_adoption"]["answer_message_id"],
                int(answer.id or 0),
            )
            final = build_conversation_continuity_snapshot(
                session,
                conversation=conversation,
            )["project_questions"]
            self.assertEqual(final["items"], ["验收范围确认了吗？"])
            self.assertEqual(final["resolved"], [])
            self.assertEqual(
                session.exec(select(ProjectQuestionResolution)).one().status,
                "open",
            )
            delete_conversation_with_messages(
                session,
                int(conversation.id or 0),
                clear_cache=False,
            )
            preserved = session.exec(select(ProjectQuestionResolution)).one()
            self.assertEqual(preserved.status, "open")
            if self.engine.dialect.name == "postgresql":
                self.assertIsNone(preserved.answer_conversation_id)
                self.assertTrue(
                    all(
                        event.answer_conversation_id is None
                        for event in session.exec(
                            select(ProjectQuestionResolutionEvent)
                        ).all()
                    )
                )

    def test_question_profile_revision_and_foreign_key_cleanup(self) -> None:
        with Session(self.engine) as session:
            owner = User(email="question-profile-owner@example.com", password_hash="x")
            assignee = User(email="question-profile-assignee@example.com", password_hash="x")
            project = Project(name="Question profile DB", client="Test")
            session.add(owner)
            session.add(assignee)
            session.add(project)
            session.flush()
            owner_member = ProjectMember(
                project_id=int(project.id or 0),
                user_id=int(owner.id or 0),
                role="owner",
            )
            assignee_member = ProjectMember(
                project_id=int(project.id or 0),
                user_id=int(assignee.id or 0),
                role="viewer",
            )
            session.add(owner_member)
            session.add(assignee_member)
            session.commit()
            question = "客户验收代表是谁？"
            save_project_memory(
                session,
                int(project.id or 0),
                {"open_questions": {"ai": [question], "pinned": []}},
                trigger="postgres_question_profile_seed",
            )
            first = update_project_question_profile(
                session,
                project_id=int(project.id or 0),
                actor_user_id=int(owner.id or 0),
                question=question,
                question_sha256=project_question_sha256(question),
                owner_user_id=int(assignee.id or 0),
                priority="high",
                due_date="2026-09-20",
                expected_revision=0,
            )
            second = update_project_question_profile(
                session,
                project_id=int(project.id or 0),
                actor_user_id=int(owner.id or 0),
                question=question,
                question_sha256=project_question_sha256(question),
                owner_user_id=int(owner.id or 0),
                priority="critical",
                due_date="",
                expected_revision=1,
            )
            self.assertEqual(first.id, second.id)
            self.assertEqual(second.revision, 2)
            self.assertEqual(
                [
                    event.revision
                    for event in session.exec(
                        select(ProjectQuestionProfileEvent).order_by(
                            ProjectQuestionProfileEvent.revision
                        )
                    ).all()
                ],
                [1, 2],
            )

            session.delete(assignee_member)
            session.delete(assignee)
            session.commit()
            session.expire_all()
            events = session.exec(
                select(ProjectQuestionProfileEvent).order_by(
                    ProjectQuestionProfileEvent.revision
                )
            ).all()
            if self.engine.dialect.name == "postgresql":
                self.assertIsNone(events[0].owner_user_id)
                self.assertIsNone(events[1].previous_owner_user_id)

            session.delete(session.exec(select(ProjectQuestionProfile)).one())
            session.commit()
            if self.engine.dialect.name == "postgresql":
                self.assertEqual(session.exec(select(ProjectQuestionProfile)).all(), [])
                self.assertEqual(
                    session.exec(select(ProjectQuestionProfileEvent)).all(),
                    [],
                )
