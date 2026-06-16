from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session

from app.models.db import User
from app.routers import knowledge as knowledge_module
from app.routers.knowledge import router
from tests.test_database import create_test_engine, drop_all_tables


class KnowledgeV005ApiTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        self.temp_dir = tempfile.TemporaryDirectory()
        self.uploads_dir = Path(self.temp_dir.name) / "uploads"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

        with Session(self.engine) as session:
            self.user = User(
                email="admin@example.com",
                password_hash="x",
                is_admin=True,
                is_active=True,
            )
            session.add(self.user)
            session.commit()
            session.refresh(self.user)
            self.user_id = self.user.id

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        def override_user():
            with Session(self.engine) as session:
                return session.get(User, self.user_id)

        app.dependency_overrides[knowledge_module.get_session] = override_session
        app.dependency_overrides[knowledge_module.get_current_user] = override_user
        app.dependency_overrides[knowledge_module.require_admin] = override_user
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_source_upload_search_and_template_result_flow(self):
        with patch.object(knowledge_module, "UPLOADS_DIR", self.uploads_dir), patch.object(
            knowledge_module, "KB_UPLOADS", self.uploads_dir / "knowledge"
        ), patch("app.services.knowledge_ingestion.UPLOADS_DIR", self.uploads_dir):
            source_resp = self.client.post(
                "/knowledge/sources",
                json={
                    "name": "咨询案例库",
                    "source_type": "manual_upload",
                    "scope_type": "workspace",
                    "tags": "case,consulting",
                },
            )
            self.assertEqual(source_resp.status_code, 201, source_resp.text)
            source_id = source_resp.json()["id"]

            upload_resp = self.client.post(
                f"/knowledge/sources/{source_id}/documents?template_key=consulting_case",
                files={
                    "file": (
                        "case.md",
                        io.BytesIO("案例：会员体系项目\n业务问题：会员数据分散\n解决方案：数据中台".encode()),
                        "text/markdown",
                    )
                },
            )
            self.assertEqual(upload_resp.status_code, 201, upload_resp.text)
            document_id = upload_resp.json()["id"]
            self.assertEqual(upload_resp.json()["status"], "queued")
            job_id = upload_resp.json()["job_id"]

            job_resp = self.client.get(f"/knowledge/jobs/{job_id}")
            self.assertEqual(job_resp.status_code, 200, job_resp.text)
            self.assertEqual(job_resp.json()["status"], "completed")

            docs_resp = self.client.get(f"/knowledge/sources/{source_id}/documents")
            self.assertEqual(docs_resp.status_code, 200, docs_resp.text)
            self.assertEqual(docs_resp.json()[0]["status"], "indexed")

            search_resp = self.client.post(
                "/knowledge/search",
                json={"query": "会员 数据中台", "scope_types": ["workspace"], "top_k": 5},
            )
            self.assertEqual(search_resp.status_code, 200, search_resp.text)
            data = search_resp.json()
            self.assertGreaterEqual(data["total_found"], 1)
            self.assertEqual(data["chunks"][0]["document_id"], document_id)

            template_resp = self.client.get(f"/knowledge/documents/{document_id}/template-result")
            self.assertEqual(template_resp.status_code, 200, template_resp.text)
            self.assertEqual(template_resp.json()["template_key"], "consulting_case")

            events_resp = self.client.get(f"/knowledge/documents/{document_id}/events")
            self.assertEqual(events_resp.status_code, 200, events_resp.text)
            event_types = {item["event_type"] for item in events_resp.json()}
            self.assertIn("document_uploaded", event_types)
            self.assertIn("index_completed", event_types)

    def test_markdown_folder_sync_scans_and_indexes_files(self):
        vault_dir = Path(self.temp_dir.name) / "vault"
        vault_dir.mkdir(parents=True, exist_ok=True)
        (vault_dir / "playbook.md").write_text(
            "---\ntags: [methodology, digital]\n---\n# 方法论\n会员生命周期运营模型",
            encoding="utf-8",
        )
        with patch.object(knowledge_module, "UPLOADS_DIR", self.uploads_dir), patch.object(
            knowledge_module, "KB_UPLOADS", self.uploads_dir / "knowledge"
        ), patch("app.services.knowledge_ingestion.UPLOADS_DIR", self.uploads_dir):
            source_resp = self.client.post(
                "/knowledge/sources",
                json={
                    "name": "Obsidian Vault",
                    "source_type": "obsidian_vault",
                    "scope_type": "workspace",
                    "root_path": str(vault_dir),
                    "include_patterns": "**/*.md",
                    "exclude_patterns": ".obsidian/**",
                },
            )
            self.assertEqual(source_resp.status_code, 201, source_resp.text)
            source_id = source_resp.json()["id"]

            sync_resp = self.client.post(f"/knowledge/sources/{source_id}/sync")
            self.assertEqual(sync_resp.status_code, 202, sync_resp.text)
            job_resp = self.client.get(f"/knowledge/jobs/{sync_resp.json()['job_id']}")
            self.assertEqual(job_resp.json()["status"], "completed")

            docs_resp = self.client.get(f"/knowledge/sources/{source_id}/documents")
            self.assertEqual(len(docs_resp.json()), 1)
            self.assertEqual(docs_resp.json()[0]["status"], "indexed")

    def test_templates_endpoint_seeds_builtin_templates(self):
        resp = self.client.get("/knowledge/templates")
        self.assertEqual(resp.status_code, 200)
        keys = {item["key"] for item in resp.json()["templates"]}
        self.assertIn("consulting_case", keys)
        self.assertIn("methodology", keys)


if __name__ == "__main__":
    unittest.main()
