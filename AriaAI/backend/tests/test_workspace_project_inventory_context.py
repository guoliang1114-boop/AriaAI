from __future__ import annotations

import os
import json
import tempfile
import unittest
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Project, ProjectFile
from app.services.context_builder import (
    build_chat_context,
    build_project_context,
    is_client_project_portfolio_query,
    is_workspace_project_inventory_query,
)


class WorkspaceProjectInventoryContextTestCase(unittest.TestCase):
    def setUp(self):
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
        Path(self.db_path).unlink(missing_ok=True)

    def test_chinese_all_projects_query_uses_full_workspace_inventory(self):
        with Session(self.engine) as session:
            for index in range(1, 8):
                session.add(
                    Project(
                        name=f"Project {index}",
                        client="Client",
                        status="active",
                        description=f"Description {index}",
                    )
                )
            session.commit()

            content = "\u603b\u7ed3\u5168\u90e8\u9879\u76ee\u60c5\u51b5\u53ca\u98ce\u9669"
            chat_context = build_chat_context(session, content=content)

        self.assertTrue(is_workspace_project_inventory_query(content))
        self.assertTrue(is_client_project_portfolio_query(content))
        self.assertIn("# Workspace Project Inventory Context", chat_context.project_context)
        self.assertIn("Total projects listed below: 7", chat_context.project_context)
        self.assertIn("## 1. Project", chat_context.project_context)
        self.assertIn("## 7. Project", chat_context.project_context)
        self.assertNotIn("## Recent project snapshot", chat_context.project_context)

    def test_standalone_workspace_brief_lists_all_projects_from_memory(self):
        with Session(self.engine) as session:
            for index in range(1, 8):
                session.add(
                    Project(
                        name=f"Project {index}",
                        client="Client",
                        status="active",
                        memory_version=1,
                        context_memory_json=json.dumps(
                            {
                                "project_brief": f"Memory brief {index}",
                                "key_risks": [f"Risk {index}"],
                            }
                        ),
                    )
                )
            session.commit()

            chat_context = build_chat_context(session, content="今天项目总体怎么样")

        self.assertIn("# Workspace Brief", chat_context.project_context)
        self.assertIn("Total tracked projects: 7", chat_context.project_context)
        self.assertIn("1. - Project", chat_context.project_context)
        self.assertIn("7. - Project", chat_context.project_context)
        self.assertIn("Memory brief 7", chat_context.project_context)
        self.assertNotIn("Recent project snapshot", chat_context.project_context)

    def test_client_name_project_review_uses_client_portfolio_context(self):
        with Session(self.engine) as session:
            for index in range(1, 4):
                session.add(
                    Project(
                        name=f"Jinke Project {index}",
                        client="\u91d1\u79d1\u667a\u6167\u670d\u52a1\u96c6\u56e2\u80a1\u4efd\u6709\u9650\u516c\u53f8",
                        status="active",
                    )
                )
            session.commit()

            chat_context = build_chat_context(
                session,
                content="\u91d1\u79d1\u667a\u6167\u670d\u52a1\u96c6\u56e2\u80a1\u4efd\u6709\u9650\u516c\u53f8\u9879\u76ee\u60c5\u51b5\u548c\u98ce\u9669",
            )

        self.assertIn("# Client Project Portfolio Context", chat_context.project_context)
        self.assertIn("Matched projects: 3", chat_context.project_context)

    def test_project_context_uses_file_list_without_reading_file_text_by_default(self):
        with Session(self.engine) as session:
            project = Project(name="File Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            session.add(
                ProjectFile(
                    project_id=project.id,
                    name="source.txt",
                    file_type="txt",
                    path="missing/source.txt",
                    summary="Useful source summary",
                )
            )
            session.commit()

            context = build_project_context(session, project.id, content="项目现在怎么样")

        self.assertIn("source.txt", context)
        self.assertIn("Useful source summary", context)
        self.assertNotIn("## Project File Contents", context)


if __name__ == "__main__":
    unittest.main()
