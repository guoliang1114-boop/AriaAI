from __future__ import annotations

import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlmodel import Session, SQLModel, create_engine

from app.models.db import DocumentChunk, GeneratedFile, KnowledgeDocument, Project, ProjectFile, ProjectTodo
from app.services import context_builder as context_builder_module
from app.services.context_builder import (
    build_chat_context,
    build_project_context,
    is_client_project_portfolio_query,
    is_workspace_project_inventory_query,
)

from tests.test_database import create_test_engine, drop_all_tables


class FakeRetrievalContext:
    def __init__(self, text: str = "retrieved project knowledge"):
        self._text = text
        self.results = []
        self.query = "fake query"

    def to_text(self) -> str:
        return self._text


class WorkspaceProjectInventoryContextTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        self.engine.dispose()

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

    def test_project_context_includes_notes_todos_and_recent_artifacts(self):
        with Session(self.engine) as session:
            project = Project(
                name="Context Rich Project",
                client="Client",
                status="delivering",
                md_notes="客户希望先完成沟通材料，再进入方案阶段。",
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            session.add(ProjectTodo(project_id=project.id, content="整理客户沟通 PPT", due_date="2026-05-20"))
            session.add(
                GeneratedFile(
                    conversation_id=1,
                    project_id=project.id,
                    name="沟通材料.md",
                    file_type="md",
                    path="generated/brief.md",
                    description="初版客户沟通材料",
                )
            )
            session.commit()

            context = build_project_context(session, project.id, content="给我一个沟通PPT目录")

        self.assertIn("**Project Markdown Notes:**", context)
        self.assertIn("客户希望先完成沟通材料", context)
        self.assertIn("**Current Todos:**", context)
        self.assertIn("整理客户沟通 PPT", context)
        self.assertIn("**Recent Generated Artifacts:**", context)
        self.assertIn("沟通材料.md", context)

    def test_project_scope_chat_auto_retrieves_synced_project_knowledge(self):
        with Session(self.engine) as session:
            project = Project(name="Knowledge Project", client="Client", status="active")
            session.add(project)
            session.commit()
            session.refresh(project)
            doc = KnowledgeDocument(
                name="客户访谈纪要.md",
                file_type="md",
                path="knowledge/interview.md",
                project_id=project.id,
                vector_status="synced",
            )
            session.add(doc)
            session.commit()
            session.refresh(doc)
            session.add(
                DocumentChunk(
                    document_id=doc.id,
                    chunk_index=0,
                    content="客户关注上线节奏和预算边界。",
                    embedding_json="[0.1, 0.2]",
                )
            )
            session.commit()

            with patch.object(
                context_builder_module,
                "retrieve_structured",
                return_value=FakeRetrievalContext("客户关注上线节奏和预算边界。"),
            ) as mocked_retrieve:
                chat_context = build_chat_context(
                    session,
                    project_id=project.id,
                    knowledge_scope="project",
                    content="给我一个沟通PPT目录",
                )

        self.assertIn("客户关注上线节奏", chat_context.rag_context)
        mocked_retrieve.assert_called_once()
        self.assertEqual(mocked_retrieve.call_args.kwargs["project_id"], project.id)


if __name__ == "__main__":
    unittest.main()
