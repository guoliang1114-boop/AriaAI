from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Project
from app.services.context_builder import build_chat_context
from app.tools import registry
from app.tools import project_markdown as project_markdown_tool
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME


class ProjectMarkdownToolTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.uploads_dir = Path(self.temp_dir.name) / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        fd, db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        self.db_path = db_path
        self.engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()
        try:
            os.remove(self.db_path)
        except FileNotFoundError:
            pass
        self.temp_dir.cleanup()

    def _create_project(self) -> int:
        with Session(self.engine) as session:
            project = Project(name="Alpha", client="Client A")
            session.add(project)
            session.commit()
            session.refresh(project)
            return project.id

    def test_project_chat_exposes_markdown_tool(self):
        project_id = self._create_project()
        with Session(self.engine) as session:
            context = build_chat_context(session=session, project_id=project_id, content="update md")

        self.assertTrue(context.tools)
        self.assertIn(PROJECT_MARKDOWN_TOOL_NAME, {tool["name"] for tool in context.tools})
        self.assertIn("Project Markdown editing", context.skill_prompt)

    def test_tool_creates_and_appends_markdown_document(self):
        project_id = self._create_project()

        with patch.object(project_markdown_tool, "engine", self.engine), patch.object(
            project_markdown_tool,
            "UPLOADS_DIR",
            self.uploads_dir,
        ):
            created = asyncio.run(
                registry.execute(
                    PROJECT_MARKDOWN_TOOL_NAME,
                    {
                        "project_id": project_id,
                        "mode": "create",
                        "file_name": "status.md",
                        "content": "# Status\n\nInitial",
                    },
                )
            )
            output = created["output"]
            self.assertEqual(created["status"], "success")
            self.assertEqual(output["action"], "created")

            appended = asyncio.run(
                registry.execute(
                    PROJECT_MARKDOWN_TOOL_NAME,
                    {
                        "project_id": project_id,
                        "mode": "append",
                        "file_id": output["id"],
                        "content": "Next update",
                    },
                )
            )

        self.assertEqual(appended["status"], "success")
        with Session(self.engine) as session:
            project_file = project_markdown_tool.get_project_document_file_or_404(
                session,
                project_id,
                output["id"],
            )
            content = project_markdown_tool.read_project_document_content(
                project_file,
                uploads_dir=self.uploads_dir,
            )
            project = session.get(Project, project_id)

        self.assertIn("Initial", content)
        self.assertIn("Next update", content)
        self.assertTrue(project.memory_stale)


if __name__ == "__main__":
    unittest.main()
