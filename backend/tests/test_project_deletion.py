"""Regression tests for delete_project_cascade.

The cascade is a hand-rolled, ordered delete across every table that carries a
FK to a project (or its conversations / messages / files). When a new such
table is added but not wired into the cascade, deleting a project that has rows
in it raises a Postgres IntegrityError — surfaced to the client as a 500.

This guards the three tables that were originally missed: ChatTrace,
ConversationState, and ProjectFileVersion.
"""
from __future__ import annotations

import unittest

from sqlmodel import Session, SQLModel, select

from app.models.db import (
    ChatTrace,
    Conversation,
    ConversationState,
    Message,
    Project,
    ProjectFile,
    ProjectFileVersion,
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

    def test_deletes_project_with_trace_state_and_file_versions(self):
        """A project carrying ChatTrace / ConversationState / ProjectFileVersion
        rows must delete cleanly (these used to violate FKs → 500)."""
        with Session(self.engine) as session:
            project = Project(name="GTM Project", client="Client")
            session.add(project)
            session.commit()
            session.refresh(project)
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
            session.commit()

        # Should not raise (previously raised IntegrityError → 500).
        with Session(self.engine) as session:
            delete_project_cascade(session, project_id)

        with Session(self.engine) as session:
            self.assertIsNone(session.get(Project, project_id))
            self.assertEqual(
                session.exec(select(ChatTrace).where(ChatTrace.project_id == project_id)).all(),
                [],
            )
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


if __name__ == "__main__":
    unittest.main()
