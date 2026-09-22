from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, Session, create_engine, select

from app import config
from app.models.db import User
from app.models.knowledge import KnowledgeChunk, KnowledgeV1Document
from app.routers import knowledge
from app.services import knowledge_ingestion
from tests.knowledge_document_fixtures import document_bytes


@pytest.fixture
def library(tmp_path, monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(config, "KNOWLEDGE_EMBEDDING_PROVIDER", "hash")
    monkeypatch.setattr(knowledge, "UPLOADS_DIR", tmp_path)
    monkeypatch.setattr(knowledge_ingestion, "UPLOADS_DIR", tmp_path)
    with Session(engine) as session:
        owner = User(email="owner@example.invalid", password_hash="x", is_active=True)
        outsider = User(email="outsider@example.invalid", password_hash="x", is_active=True)
        session.add_all([owner, outsider])
        session.commit()
        owner_id, outsider_id = owner.id, outsider.id
    actor = {"id": owner_id}
    app = FastAPI()
    app.include_router(knowledge.router)
    def session_override():
        with Session(engine) as session:
            yield session
    def user_override():
        with Session(engine) as session:
            return session.get(User, actor["id"])
    app.dependency_overrides[knowledge.get_session] = session_override
    app.dependency_overrides[knowledge.get_current_user] = user_override
    with TestClient(app) as client:
        response = client.post("/knowledge/sources", json={"name": "Private extraction acceptance", "scope_type": "user"})
        assert response.status_code == 201, response.text
        yield client, engine, actor, outsider_id, response.json()["id"]
    engine.dispose()


@pytest.mark.parametrize("kind", ["pdf", "docx", "pptx", "xlsx"])
def test_real_document_bytes_reach_native_search_and_content_with_acl(library, kind):
    client, engine, actor, outsider_id, source_id = library
    content, markers = document_bytes(kind)
    response = client.post(f"/knowledge/sources/{source_id}/documents", files={"file": (f"source.{kind}", content)})
    assert response.status_code == 201, response.text
    document_id, job_id = response.json()["id"], response.json()["job_id"]
    job = client.get(f"/knowledge/jobs/{job_id}").json()
    assert job["status"] == "completed", job
    with Session(engine) as session:
        doc = session.get(KnowledgeV1Document, document_id)
        assert doc.status == "indexed"
        if kind == "pdf": assert doc.page_count == 16
        if kind == "pptx": assert doc.slide_count == 2
        chunks = session.exec(select(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)).all()
        assert all(c.embedding_model == "aria-hash-v1:1536" for c in chunks)
        body = "\n".join(c.content for c in chunks)
        assert all(marker in body for marker in markers)
        before_chunks = [(c.chunk_index, c.content) for c in chunks]
    for marker in markers:
        result = client.post("/knowledge/search", json={"query": marker, "scope_types": ["user"], "top_k": 1}).json()
        assert result["chunks"][0]["document_id"] == document_id
        assert result["chunks"][0]["source_id"] == source_id
        assert marker in result["chunks"][0]["content"]
    original = client.get(f"/knowledge/documents/{document_id}/original")
    assert original.status_code == 200 and original.content == content
    page = client.get(f"/knowledge/documents/{document_id}/content?limit=10").json()
    assert page["namespace"] == "source_scoped" and page["source_id"] == source_id
    duplicate = client.post(f"/knowledge/sources/{source_id}/documents", files={"file": (f"source.{kind}", content)})
    assert duplicate.json()["id"] == document_id
    retry = client.post(f"/knowledge/sources/{source_id}/documents/{document_id}/reindex")
    assert retry.status_code == 202
    assert client.get(f"/knowledge/jobs/{retry.json()['job_id']}").json()["status"] == "completed"
    with Session(engine) as session:
        after_chunks = session.exec(select(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)).all()
        assert [(c.chunk_index, c.content) for c in after_chunks] == before_chunks
    actor["id"] = outsider_id
    assert client.get(f"/knowledge/documents/{document_id}/content").status_code == 404
    assert client.get(f"/knowledge/documents/{document_id}/original").status_code == 404
    assert client.post("/knowledge/search", json={"query": markers[0]}).json()["chunks"] == []


@pytest.mark.parametrize("kind,content", [("pptx", b"private corrupt payload"), ("txt", b"x" * 200_001)])
def test_invalid_or_oversized_text_never_becomes_a_successful_index(library, kind, content):
    client, engine, _, _, source_id = library
    response = client.post(f"/knowledge/sources/{source_id}/documents", files={"file": (f"source.{kind}", content)})
    assert response.status_code == 201
    job = client.get(f"/knowledge/jobs/{response.json()['job_id']}").json()
    assert job["status"] == "failed" and job["retryable"] is False
    assert "private corrupt payload" not in json.dumps(job)
    with Session(engine) as session:
        assert session.get(KnowledgeV1Document, response.json()["id"]).status != "indexed"
        assert session.exec(select(KnowledgeChunk)).all() == []
