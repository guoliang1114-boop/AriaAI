from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Project
from app.services.context_builder import (
    build_chat_context,
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


if __name__ == "__main__":
    unittest.main()
