"""PostgreSQL contract test for verified outputs and reviewed memory.

This file intentionally uses ``tests.test_database.create_test_engine``. It is
run by the production-database E2E workflow inside its disposable
``ariaai_test_*`` schema, never against ``public`` application tables.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlmodel import Session, SQLModel, select

from app.models.db import Conversation, GeneratedFile, MemoryCandidate, Project, User
from app.services.agent_harness.run_output_record import build_artifact_output_record
from app.services.chat_store import persist_run_artifacts
from app.services.memory_candidates import accept_memory_candidate, create_memory_candidate
from tests.test_database import create_test_engine, drop_all_tables


class RunOutputsPostgresContractTests(unittest.TestCase):
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

    def test_verified_artifact_and_reviewed_memory_round_trip(self) -> None:
        with Session(self.engine) as session:
            user = User(email="postgres-output@example.com", password_hash="x")
            project = Project(name="Output Contract", client="Acme")
            session.add(user)
            session.add(project)
            session.commit()
            session.refresh(user)
            session.refresh(project)
            conversation = Conversation(
                title="PostgreSQL output contract",
                project_id=project.id,
                owner_user_id=user.id,
            )
            session.add(conversation)
            session.commit()
            session.refresh(conversation)
            user_id = int(user.id)
            project_id = int(project.id)
            conversation_id = int(conversation.id)

            candidate, created = create_memory_candidate(
                session,
                owner_user_id=user_id,
                scope="project",
                candidate_type="project_next_action",
                content="安排项目启动会并确认责任人。",
                source_type="manual",
                project_id=project_id,
            )
            self.assertTrue(created)
            session.commit()
            session.refresh(candidate)
            accept_memory_candidate(session, candidate, user_id=user_id)

        with tempfile.TemporaryDirectory() as temp_dir:
            uploads = Path(temp_dir)
            output_path = uploads / "generated" / "verified.md"
            output_path.parent.mkdir(parents=True)
            output_path.write_text("# Verified output\n", encoding="utf-8")
            artifact = {
                "name": "verified.md",
                "file_type": "md",
                "path": "generated/verified.md",
                "source_tool": "write_project_markdown_document",
                "tool_use_id": "postgres-call-1",
            }
            record = build_artifact_output_record(
                artifact,
                run_id="run_postgres_output_contract",
                source_tool=artifact["source_tool"],
                tool_use_id=artifact["tool_use_id"],
            )
            artifact["output_id"] = record["output_id"]
            with patch("app.services.chat_store.UPLOADS_DIR", uploads):
                batch = persist_run_artifacts(
                    self.engine,
                    conversation_id,
                    [artifact],
                    project_id,
                    run_id="run_postgres_output_contract",
                    run_outputs=[record],
                )

        self.assertEqual(batch.failures, [])
        self.assertEqual(batch.run_outputs[0]["status"], "persisted")
        with Session(self.engine) as session:
            candidate = session.exec(select(MemoryCandidate)).one()
            self.assertEqual(candidate.status, "accepted")
            project = session.get(Project, project_id)
            memory = json.loads(project.context_memory_json)
            self.assertIn("安排项目启动会并确认责任人。", memory["next_actions"])
            generated = session.exec(select(GeneratedFile)).one()
            self.assertEqual(generated.run_id, "run_postgres_output_contract")
            self.assertEqual(generated.output_id, record["output_id"])
            self.assertEqual(len(generated.content_sha256), 64)


if __name__ == "__main__":
    unittest.main()
