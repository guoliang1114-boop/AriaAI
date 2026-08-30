"""Regression tests for delete_project_cascade.

The cascade is a hand-rolled, ordered delete across every table that carries a
FK to a project (or its conversations / messages / files). When a new such
table is added but not wired into the cascade, deleting a project that has rows
in it raises a Postgres IntegrityError — surfaced to the client as a 500.

This guards the lifecycle tables that were previously missed: ChatRun,
ChatTrace, ConversationState, and ProjectFileVersion.
"""
from __future__ import annotations

import unittest

from fastapi import HTTPException
from sqlmodel import Session, SQLModel, select

from app.models.db import (
    ChatRun,
    ChatTrace,
    Conversation,
    ConversationState,
    Message,
    Project,
    ProjectFile,
    ProjectFileVersion,
    ProjectMember,
    ProjectTodo,
    TaskRun,
    User,
    WeeklyFocusItem,
)
from app.services.project_deletion import delete_project_cascade
from tests.test_database import create_test_engine, drop_all_tables


class DeleteProjectCascadeTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

    def test_deletes_project_with_run_trace_state_and_file_versions(self):
        """A project carrying lifecycle rows must delete without FK failures."""
        with Session(self.engine) as session:
            actor = User(
                email="delete-lifecycle-admin@example.com",
                password_hash="x",
                is_admin=True,
            )
            project = Project(name="GTM Project", client="Client")
            session.add(actor)
            session.add(project)
            session.commit()
            session.refresh(actor)
            session.refresh(project)
            actor_id = int(actor.id)
            project_id = project.id

            conversation = Conversation(title="Chat", project_id=project_id)
            session.add(conversation)
            session.commit()
            session.refresh(conversation)

            message = Message(conversation_id=conversation.id, role="user", content="hi")
            session.add(message)
            session.commit()
            session.refresh(message)

            project_file = ProjectFile(
                project_id=project_id,
                name="plan.md",
                file_type="md",
                path="plan.md",
            )
            session.add(project_file)
            session.commit()
            session.refresh(project_file)

            # The exact rows that triggered the original 500.
            session.add(
                ProjectFileVersion(
                    project_file_id=project_file.id,
                    project_id=project_id,
                    version_number=1,
                    name="plan.md",
                    message_id=message.id,
                )
            )
            session.add(
                ConversationState(conversation_id=conversation.id, project_id=project_id)
            )
            session.add(
                ChatTrace(
                    trace_id="trace-1",
                    conversation_id=conversation.id,
                    message_id=message.id,
                    project_id=project_id,
                )
            )
            # Chat rollout tasks intentionally stay out of project task lists,
            # so project_id is null and the conversation is their ownership link.
            task_run = TaskRun(
                project_id=None,
                conversation_id=conversation.id,
                task_type="chat_rollout",
                status="completed",
            )
            session.add(task_run)
            session.flush()
            session.add(
                ChatRun(
                    run_id="run-project-delete",
                    task_run_id=task_run.id,
                    conversation_id=conversation.id,
                    project_id=project_id,
                    source_message_id=message.id,
                    status="completed",
                )
            )
            session.commit()
            task_run_id = int(task_run.id)

        # Should not raise (previously raised IntegrityError → 500).
        with Session(self.engine) as session:
            delete_project_cascade(
                session,
                project_id,
                actor_user_id=actor_id,
            )

        with Session(self.engine) as session:
            self.assertIsNone(session.get(Project, project_id))
            self.assertEqual(
                session.exec(select(ChatTrace).where(ChatTrace.project_id == project_id)).all(),
                [],
            )
            self.assertEqual(
                session.exec(select(ChatRun).where(ChatRun.project_id == project_id)).all(),
                [],
            )
            self.assertIsNone(session.get(TaskRun, task_run_id))
            self.assertEqual(
                session.exec(
                    select(ConversationState).where(ConversationState.project_id == project_id)
                ).all(),
                [],
            )
            self.assertEqual(
                session.exec(
                    select(ProjectFileVersion).where(ProjectFileVersion.project_id == project_id)
                ).all(),
                [],
            )

    def test_preserves_weekly_focus_item_and_detaches_deleted_project_todo(self):
        with Session(self.engine) as session:
            owner = User(
                email="weekly-focus-owner@example.com",
                password_hash="x",
                display_name="Weekly owner",
            )
            project = Project(name="Weekly source", client="Focus client")
            session.add(owner)
            session.add(project)
            session.flush()
            session.add(
                ProjectMember(
                    project_id=int(project.id),
                    user_id=int(owner.id),
                    role="owner",
                )
            )
            session.commit()
            session.refresh(owner)
            session.refresh(project)
            todo = ProjectTodo(project_id=int(project.id), content="Prepare review")
            session.add(todo)
            session.commit()
            session.refresh(todo)
            focus = WeeklyFocusItem(
                week_start="2026-08-24",
                owner_user_id=int(owner.id),
                created_by_user_id=int(owner.id),
                content=todo.content,
                project_id=int(project.id),
                source_todo_id=int(todo.id),
            )
            session.add(focus)
            session.commit()
            session.refresh(focus)
            project_id = int(project.id)
            owner_id = int(owner.id)
            todo_id = int(todo.id)
            focus_id = int(focus.id)

        with Session(self.engine) as session:
            _client_id, client_name = delete_project_cascade(
                session,
                project_id,
                actor_user_id=owner_id,
            )

        self.assertEqual(client_name, "Focus client")
        with Session(self.engine) as session:
            self.assertIsNone(session.get(Project, project_id))
            self.assertIsNone(session.get(ProjectTodo, todo_id))
            saved_focus = session.get(WeeklyFocusItem, focus_id)
            self.assertIsNotNone(saved_focus)
            self.assertIsNone(saved_focus.project_id)
            self.assertIsNone(saved_focus.source_todo_id)

    def test_returns_fresh_client_name_when_cached_project_was_reassigned(self):
        with Session(self.engine) as setup:
            actor = User(
                email="delete-reassigned-admin@example.com",
                password_hash="x",
                is_admin=True,
            )
            project = Project(name="Reassigned deletion", client="Old client")
            setup.add(actor)
            setup.add(project)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(project)
            actor_id = int(actor.id)
            project_id = int(project.id)

        with Session(self.engine) as deletion_session:
            cached = deletion_session.get(Project, project_id)
            self.assertEqual(cached.client, "Old client")
            with Session(self.engine) as concurrent:
                current = concurrent.get(Project, project_id)
                current.client = "New client"
                concurrent.add(current)
                concurrent.commit()

            _client_id, client_name = delete_project_cascade(
                deletion_session,
                project_id,
                actor_user_id=actor_id,
            )

        self.assertEqual(client_name, "New client")
        with Session(self.engine) as verify:
            self.assertIsNone(verify.get(Project, project_id))

    def test_rechecks_active_write_membership_before_deleting(self):
        with Session(self.engine) as setup:
            actor = User(
                email="delete-final-auth@example.com",
                password_hash="x",
            )
            project = Project(name="Final delete auth", client="Guarded client")
            setup.add(actor)
            setup.add(project)
            setup.flush()
            membership = ProjectMember(
                project_id=int(project.id),
                user_id=int(actor.id),
                role="viewer",
            )
            setup.add(membership)
            setup.commit()
            setup.refresh(actor)
            setup.refresh(project)
            setup.refresh(membership)
            actor_id = int(actor.id)
            project_id = int(project.id)
            membership_id = int(membership.id)

        with Session(self.engine) as denied:
            with self.assertRaises(HTTPException) as raised:
                delete_project_cascade(
                    denied,
                    project_id,
                    actor_user_id=actor_id,
                )
            self.assertEqual(raised.exception.status_code, 403)
            denied.rollback()

        with Session(self.engine) as deactivate:
            actor = deactivate.get(User, actor_id)
            membership = deactivate.get(ProjectMember, membership_id)
            actor.is_active = False
            membership.role = "editor"
            deactivate.add(actor)
            deactivate.add(membership)
            deactivate.commit()

        with Session(self.engine) as inactive:
            with self.assertRaises(HTTPException) as raised:
                delete_project_cascade(
                    inactive,
                    project_id,
                    actor_user_id=actor_id,
                )
            self.assertEqual(raised.exception.status_code, 403)
            self.assertIn("inactive", str(raised.exception.detail).lower())
            inactive.rollback()

        with Session(self.engine) as activate:
            actor = activate.get(User, actor_id)
            actor.is_active = True
            activate.add(actor)
            activate.commit()

        with Session(self.engine) as allowed:
            delete_project_cascade(
                allowed,
                project_id,
                actor_user_id=actor_id,
            )

        with Session(self.engine) as verify:
            self.assertIsNone(verify.get(Project, project_id))


if __name__ == "__main__":
    unittest.main()
