from __future__ import annotations

import json
import unittest

from sqlmodel import SQLModel, Session

from app.models.db import Project, ProjectMember, User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_ingestion import deterministic_embedding, sha256_bytes
from app.services.knowledge_retrieval import search_knowledge
from tests.test_database import create_test_engine, drop_all_tables


class KnowledgeV005PermissionTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def _user(self, session: Session, email: str, *, admin: bool = False) -> User:
        user = User(email=email, password_hash="x", is_admin=admin, is_active=True)
        session.add(user)
        session.commit()
        session.refresh(user)
        return user

    def _indexed_doc(self, session: Session, source: KnowledgeSource, title: str, content: str) -> KnowledgeV1Document:
        doc = KnowledgeV1Document(
            source_id=source.id,
            title=title,
            file_name=f"{title}.md",
            file_type="md",
            path=f"knowledge/{title}.md",
            content_hash=sha256_bytes(content.encode()),
            metadata_json=json.dumps({"template_key": "consulting_case"}),
            scope_type=source.scope_type,
            scope_id=source.scope_id,
            status="indexed",
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)
        session.add(
            KnowledgeChunk(
                document_id=doc.id,
                chunk_index=0,
                heading_path="[]",
                content=content,
                token_count=10,
                embedding_model="test",
                embedding=json.dumps(deterministic_embedding(content)),
            )
        )
        session.commit()
        return doc

    def test_user_scope_does_not_leak_to_other_user(self):
        with Session(self.engine) as session:
            owner = self._user(session, "owner@example.com")
            other = self._user(session, "other@example.com")
            source = KnowledgeSource(
                name="Owner private",
                source_type="manual_upload",
                scope_type="user",
                owner_user_id=owner.id,
            )
            session.add(source)
            session.commit()
            session.refresh(source)
            self._indexed_doc(session, source, "private", "AI strategy private knowledge")

            owner_result = search_knowledge(session=session, user=owner, query="AI strategy", top_k=5)
            other_result = search_knowledge(session=session, user=other, query="AI strategy", top_k=5)

        self.assertEqual(owner_result["total_found"], 1)
        self.assertEqual(other_result["total_found"], 0)

    def test_project_scope_requires_membership(self):
        with Session(self.engine) as session:
            member = self._user(session, "member@example.com")
            outsider = self._user(session, "outsider@example.com")
            project = Project(name="Knowledge Project", client="Client A")
            session.add(project)
            session.commit()
            session.refresh(project)
            session.add(ProjectMember(project_id=project.id, user_id=member.id, role="editor"))
            session.commit()

            source = KnowledgeSource(
                name="Project source",
                source_type="manual_upload",
                scope_type="project",
                scope_id=project.id,
                owner_user_id=member.id,
            )
            session.add(source)
            session.commit()
            session.refresh(source)
            self._indexed_doc(session, source, "project", "member only project playbook")

            member_result = search_knowledge(session=session, user=member, query="project playbook", top_k=5)
            outsider_result = search_knowledge(session=session, user=outsider, query="project playbook", top_k=5)

        self.assertEqual(member_result["total_found"], 1)
        self.assertEqual(outsider_result["total_found"], 0)


if __name__ == "__main__":
    unittest.main()

