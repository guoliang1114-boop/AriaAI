from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import Project, ProjectFolder
from app.services.context_builder import build_chat_context, _safe_project_file_path
from app.tools import registry
from app.tools import project_markdown as project_markdown_tool
from app.tools.project_markdown import PROJECT_MARKDOWN_TOOL_NAME, READ_MARKDOWN_TOOL_NAME
from tests.test_database import create_test_engine, drop_all_tables


class ProjectMarkdownToolTestCase(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.uploads_dir = Path(self.temp_dir.name) / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()
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
        update_tool = next(tool for tool in context.tools if tool["name"] == PROJECT_MARKDOWN_TOOL_NAME)
        self.assertIn("analysis-only", update_tool["description"])

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
            self.assertEqual(output["file_type"], "md")
            self.assertEqual(output["project_file_id"], output["id"])
            self.assertTrue(output["path"].endswith("status.md"))

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
        appended_output = appended["output"]
        self.assertEqual(appended_output["action"], "appended")
        self.assertEqual(appended_output["file_type"], "md")
        self.assertEqual(appended_output["project_file_id"], output["id"])
        self.assertEqual(appended_output["path"], output["path"])
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

    def test_tool_auto_assigns_created_markdown_to_matching_project_folder(self):
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
                        "file_name": "初次沟通PPT目录方案建议.md",
                        "content": "# PPT 目录方案建议\n\n## 报价和合作方案\n\n生成一版客户沟通材料。",
                    },
                )
            )

        self.assertEqual(created["status"], "success")
        with Session(self.engine) as session:
            folder = session.get(ProjectFolder, created["output"]["folder_id"])
            folders = session.exec(select(ProjectFolder).where(ProjectFolder.project_id == project_id)).all()

        self.assertEqual(folder.name, "方案和报价")
        self.assertEqual(len(folders), 4)

    def test_tool_accepts_common_llm_argument_aliases(self):
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
                        "operation": "new",
                        "file_name": "aliased.md",
                        "markdown_content": "# Aliased\n\nCreated via alias fields.",
                    },
                )
            )
            self.assertEqual(created["status"], "success")
            file_id = created["output"]["id"]

            updated = asyncio.run(
                registry.execute(
                    PROJECT_MARKDOWN_TOOL_NAME,
                    {
                        "project_id": project_id,
                        "action": "update",
                        "file_id": file_id,
                        "new_content": "# Aliased\n\nUpdated via alias fields.",
                    },
                )
            )

        self.assertEqual(updated["status"], "success")
        with Session(self.engine) as session:
            project_file = project_markdown_tool.get_project_document_file_or_404(
                session,
                project_id,
                file_id,
            )
            content = project_markdown_tool.read_project_document_content(
                project_file,
                uploads_dir=self.uploads_dir,
            )

        self.assertIn("Updated via alias fields", content)

    def test_tool_returns_clear_error_when_content_is_missing(self):
        project_id = self._create_project()

        with patch.object(project_markdown_tool, "engine", self.engine), patch.object(
            project_markdown_tool,
            "UPLOADS_DIR",
            self.uploads_dir,
        ):
            result = asyncio.run(
                registry.execute(
                    PROJECT_MARKDOWN_TOOL_NAME,
                    {
                        "project_id": project_id,
                        "mode": "create",
                        "file_name": "missing-content.md",
                    },
                )
            )

        self.assertEqual(result["status"], "error")
        self.assertIn("Markdown content is required", result["error"])
        self.assertNotIn("missing 2 required keyword-only arguments", result["error"])

    def test_read_tool_defaults_missing_action_to_safe_mode(self):
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
                        "file_name": "read-default.md",
                        "content": "# Read default\n\nContent",
                    },
                )
            )
            file_id = created["output"]["id"]
            listed = asyncio.run(registry.execute(READ_MARKDOWN_TOOL_NAME, {"project_id": project_id}))
            read = asyncio.run(registry.execute(READ_MARKDOWN_TOOL_NAME, {"project_id": project_id, "file_id": file_id}))

        self.assertEqual(listed["status"], "success")
        self.assertEqual(listed["output"]["count"], 1)
        self.assertEqual(read["status"], "success")
        self.assertEqual(read["output"]["id"], file_id)
        self.assertIn("Content", read["output"]["content"])


class SafeProjectFilePathTestCase(unittest.TestCase):
    def test_valid_path_resolves_correctly(self):
        uploads = Path("/tmp/uploads")
        result = _safe_project_file_path(uploads, "project/note.md")
        self.assertEqual(result, (uploads / "project" / "note.md").resolve())

    def test_directory_traversal_blocked(self):
        uploads = Path("/tmp/uploads")
        self.assertIsNone(_safe_project_file_path(uploads, "../../etc/passwd"))

    def test_traversal_with_valid_prefix_blocked(self):
        uploads = Path("/tmp/uploads")
        self.assertIsNone(_safe_project_file_path(uploads, "project/../../../etc/passwd"))

    def test_none_path_returns_none(self):
        self.assertIsNone(_safe_project_file_path(Path("/tmp"), None))

    def test_empty_path_returns_none(self):
        self.assertIsNone(_safe_project_file_path(Path("/tmp"), ""))


if __name__ == "__main__":
    unittest.main()
