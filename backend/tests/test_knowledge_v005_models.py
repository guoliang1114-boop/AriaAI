from __future__ import annotations

import json
import unittest

from sqlmodel import SQLModel, Session, select

from app.models.db import User
from app.models.knowledge import (
    KnowledgeChunk,
    KnowledgeDocumentEvent,
    KnowledgeJob,
    KnowledgeSource,
    KnowledgeTemplate,
    KnowledgeTemplateExtraction,
    KnowledgeV1Document,
)
from app.services.knowledge_ingestion import chunk_markdown_or_text, deterministic_embedding, sha256_bytes
from app.services.knowledge_templates import seed_builtin_templates
from tests.test_database import create_test_engine, drop_all_tables


class KnowledgeV005ModelTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_create_source_document_chunk_and_template_models(self):
        with Session(self.engine) as session:
            user = User(email="owner@example.com", password_hash="x", is_active=True)
            session.add(user)
            session.commit()
            session.refresh(user)

            source = KnowledgeSource(
                name="咨询案例库",
                source_type="manual_upload",
                scope_type="user",
                owner_user_id=user.id,
            )
            session.add(source)
            session.commit()
            session.refresh(source)

            document = KnowledgeV1Document(
                source_id=source.id,
                title="会员体系案例",
                file_name="case.md",
                file_type="md",
                path="knowledge/case.md",
                content_hash=sha256_bytes(b"case"),
                metadata_json=json.dumps({"template_key": "consulting_case"}),
                scope_type="user",
            )
            session.add(document)
            session.commit()
            session.refresh(document)

            vector = deterministic_embedding("会员体系案例")
            self.assertEqual(len(vector), 1536)
            chunk = KnowledgeChunk(
                document_id=document.id,
                chunk_index=0,
                heading_path=json.dumps(["案例"]),
                content="会员体系案例内容",
                token_count=10,
                embedding_model="test",
                embedding=json.dumps(vector),
            )
            extraction = KnowledgeTemplateExtraction(
                document_id=document.id,
                template_key="consulting_case",
                status="completed",
                extracted_json=json.dumps({"case_title": "会员体系案例"}),
                confidence=0.8,
            )
            session.add(chunk)
            session.add(extraction)
            session.add(
                KnowledgeDocumentEvent(
                    document_id=document.id,
                    event_type="index_completed",
                    status="indexed",
                    message="Indexed",
                )
            )
            session.add(
                KnowledgeJob(
                    job_type="index_document",
                    status="queued",
                    document_id=document.id,
                    source_id=source.id,
                    requested_by_user_id=user.id,
                )
            )
            session.commit()

            self.assertIsNotNone(chunk.id)
            self.assertEqual(document.status, "uploaded")
            self.assertEqual(extraction.template_key, "consulting_case")
            self.assertEqual(session.exec(select(KnowledgeDocumentEvent)).first().event_type, "index_completed")
            self.assertEqual(session.exec(select(KnowledgeJob)).first().job_type, "index_document")

    def test_builtin_template_seed_is_idempotent(self):
        with Session(self.engine) as session:
            first = seed_builtin_templates(session)
            second = seed_builtin_templates(session)
            count = session.exec(select(KnowledgeTemplate)).all()

        self.assertEqual(len(first), len(second))
        self.assertEqual(len(count), len(first))
        self.assertIn("consulting_case", {item.key for item in count})

    def test_markdown_chunking_uses_heading_boundaries(self):
        chunks = chunk_markdown_or_text("# 案例\n内容一\n\n## 风险\n内容二")

        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0][0], ["案例"])
        self.assertEqual(chunks[1][0], ["案例", "风险"])


if __name__ == "__main__":
    unittest.main()
