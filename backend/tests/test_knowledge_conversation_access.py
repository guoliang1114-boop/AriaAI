from __future__ import annotations

import hashlib
import json
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, Session

from app.models.db import Conversation, Message, Project, ProjectMember, User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.routers import knowledge, chat_conversations
from app.services.chat.knowledge_context import contextual_knowledge_query
from tests.test_database import create_test_engine, drop_all_tables


@pytest.fixture
def library(tmp_path):
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="reader@test.local", password_hash="x", is_active=True)
        outsider = User(email="outsider@test.local", password_hash="x", is_active=True)
        session.add(user)
        session.add(outsider)
        session.flush()
        source = KnowledgeSource(name="Private", source_type="manual_upload", scope_type="user", owner_user_id=user.id)
        conversation = Conversation(title="Grounded", owner_user_id=user.id)
        session.add(source)
        session.add(conversation)
        session.flush()
        content = "# 市场洞察\n不要编造市场份额。".encode()
        digest = hashlib.sha256(content).hexdigest()
        key = f"knowledge/originals/source-{source.id}/{digest}.md"
        path = tmp_path / key
        path.parent.mkdir(parents=True)
        path.write_bytes(content)
        doc = KnowledgeV1Document(source_id=source.id, title="市场洞察", file_name="中文资料.md", file_type="md",
                                  path="untrusted/display/path", original_storage_key=key, content_hash=digest,
                                  scope_type="user", status="indexed")
        session.add(doc)
        session.flush()
        for index in range(4):
            session.add(KnowledgeChunk(document_id=doc.id, chunk_index=index, content=content.decode() + str(index), embedding_model="test"))
        session.commit()
        ids = (user.id, outsider.id, source.id, conversation.id, doc.id)
    app = FastAPI()
    app.include_router(knowledge.router)
    app.include_router(chat_conversations.router, prefix="/chat")
    actor = {"id": ids[0]}
    def session_override():
        with Session(engine) as session:
            yield session
    def user_override():
        with Session(engine) as session:
            return session.get(User, actor["id"])
    app.dependency_overrides[knowledge.get_session] = session_override
    app.dependency_overrides[knowledge.get_current_user] = user_override
    with patch.object(knowledge, "UPLOADS_DIR", tmp_path):
        yield TestClient(app), engine, actor, ids, tmp_path, content
    drop_all_tables(engine)
    engine.dispose()


def test_original_and_paginated_text_keep_source_namespace(library):
    client, _, _, ids, _, content = library
    response = client.get(f"/knowledge/documents/{ids[4]}/original")
    assert response.status_code == 200
    assert response.content == content
    assert response.headers["cache-control"] == "no-store"
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["x-content-type-options"] == "nosniff"
    first = client.get(f"/knowledge/documents/{ids[4]}/content?offset=0&limit=3").json()
    second = client.get(f"/knowledge/documents/{ids[4]}/content?offset=3&limit=3").json()
    assert first["namespace"] == "source_scoped"
    assert first["total"] == 4
    assert [chunk["chunk_index"] for chunk in first["chunks"]] == [0, 1, 2]
    assert [chunk["chunk_index"] for chunk in second["chunks"]] == [3]
    assert "storage_key" not in json.dumps(first) and "untrusted/display" not in json.dumps(first)
    assert client.get(f"/knowledge/documents/{ids[4]}/content?limit=100").status_code == 422


@pytest.mark.parametrize("case", ["outsider", "inactive", "deleted", "source_inactive", "scope_drift"])
def test_original_and_content_reauthorize_every_read(library, case):
    client, engine, actor, ids, _, _ = library
    with Session(engine) as session:
        doc = session.get(KnowledgeV1Document, ids[4])
        source = session.get(KnowledgeSource, ids[2])
        user = session.get(User, ids[0])
        if case == "outsider": actor["id"] = ids[1]
        if case == "inactive": user.is_active = False
        if case == "deleted": doc.status = "deleted"
        if case == "source_inactive": source.status = "disabled"
        if case == "scope_drift": doc.scope_type = "workspace"
        session.add_all([doc, source, user])
        session.commit()
    for endpoint in ("original", "content"):
        assert client.get(f"/knowledge/documents/{ids[4]}/{endpoint}").status_code == 404


@pytest.mark.parametrize("case", ["traversal", "wrong_source", "absolute", "symlink", "tampered", "missing"])
def test_original_never_opens_unowned_or_changed_bytes(library, case):
    client, engine, _, ids, root, content = library
    with Session(engine) as session:
        doc = session.get(KnowledgeV1Document, ids[4])
        path = root / doc.original_storage_key
        if case == "traversal": doc.original_storage_key = "../secret.md"
        if case == "wrong_source": doc.original_storage_key = doc.original_storage_key.replace(f"source-{ids[2]}", "source-999")
        if case == "absolute": doc.original_storage_key = str(path)
        if case == "tampered": path.write_bytes(b"changed")
        if case == "missing": path.unlink()
        if case == "symlink":
            other = root / "unowned.md"
            other.write_bytes(content)
            path.unlink()
            path.symlink_to(other)
        session.add(doc)
        session.commit()
    assert client.get(f"/knowledge/documents/{ids[4]}/original").status_code == (409 if case == "tampered" else 404)


def test_context_restores_latest_turn_only_and_rechecks_permissions(library):
    client, engine, actor, ids, _, _ = library
    endpoint = f"/chat/conversations/{ids[3]}/knowledge-context"
    with Session(engine) as session:
        session.add(Message(conversation_id=ids[3], role="user", content="市场洞察", metadata_json=json.dumps({"knowledge_document_ids": [ids[4]]})))
        session.commit()
    assert client.get(endpoint).json()["documents"] == [{"id": ids[4], "title": "市场洞察"}]
    actor["id"] = ids[1]
    assert client.get(endpoint).status_code in (403, 404)
    actor["id"] = ids[0]
    with Session(engine) as session:
        source = session.get(KnowledgeSource, ids[2])
        source.status = "disabled"
        session.add(source)
        session.commit()
    assert client.get(endpoint).json() == {"namespace": "source_scoped", "documents": [], "unavailable_count": 1}
    with Session(engine) as session:
        session.add(Message(conversation_id=ids[3], role="user", content="不再用资料", metadata_json="{}"))
        session.commit()
    assert client.get(endpoint).json()["unavailable_count"] == 0


@pytest.fixture
def picker_library(library):
    client, engine, actor, ids, _, _ = library
    with Session(engine) as session:
        project = Project(name="Picker project", client="Fixture")
        other = Project(name="Other project", client="Fixture")
        session.add_all([project, other])
        session.flush()
        session.add(ProjectMember(project_id=project.id, user_id=ids[0], role="viewer"))
        documents = {}
        for name, scope, scope_id, owner in [
            ("project", "project", project.id, ids[0]),
            ("other", "project", other.id, ids[0]),
            ("shared", "workspace", None, ids[1]),
            ("global", "global", None, ids[1]),
            ("private", "user", None, ids[1]),
        ]:
            source = KnowledgeSource(name=name, source_type="manual_upload", scope_type=scope, scope_id=scope_id, owner_user_id=owner)
            session.add(source)
            session.flush()
            doc = KnowledgeV1Document(source_id=source.id, title=name, file_name=f"{name}.md", file_type="md",
                                      path="private/path", content_hash=hashlib.sha256(name.encode()).hexdigest(),
                                      scope_type=scope, scope_id=scope_id, status="indexed")
            session.add(doc)
            session.flush()
            documents[name] = doc.id
        session.commit()
        project_id = project.id
    return client, engine, actor, ids, project_id, documents


def test_chat_picker_requires_explicit_scope_and_returns_only_lightweight_documents(picker_library):
    client, engine, _, ids, project_id, documents = picker_library
    endpoint = f"/knowledge/chat-documents?project_id={project_id}"
    response = client.get(endpoint)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["namespace"] == "source_scoped"
    assert [item["id"] for item in response.json()["items"]] == [documents["project"]]
    assert set(response.json()["items"][0]) == {"id", "title", "file_name", "file_type", "source_id", "source_name"}
    assert {item["id"] for item in client.get(endpoint + "&scope=workspace").json()["items"]} == {documents["shared"], documents["global"]}
    assert [item["id"] for item in client.get(endpoint + "&scope=user").json()["items"]] == [ids[4]]
    # Even admin's "my documents" is not an all-users private library.
    with Session(engine) as session:
        user = session.get(User, ids[0])
        user.is_admin = True
        session.add(user)
        session.commit()
    assert [item["id"] for item in client.get(endpoint + "&scope=user").json()["items"]] == [ids[4]]


@pytest.mark.parametrize("case", ["outsider", "inactive", "source_disabled", "unindexed", "scope_type_drift", "scope_id_drift"])
def test_chat_picker_rechecks_acl_and_source_document_pair(picker_library, case):
    client, engine, actor, ids, project_id, documents = picker_library
    with Session(engine) as session:
        doc = session.get(KnowledgeV1Document, documents["project"])
        source = session.get(KnowledgeSource, doc.source_id)
        user = session.get(User, ids[0])
        if case == "outsider": actor["id"] = ids[1]
        if case == "inactive": user.is_active = False
        if case == "source_disabled": source.status = "disabled"
        if case == "unindexed": doc.status = "pending"
        if case == "scope_type_drift": doc.scope_type = "workspace"
        if case == "scope_id_drift": doc.scope_id = None
        session.add_all([user, source, doc])
        session.commit()
    response = client.get(f"/knowledge/chat-documents?project_id={project_id}")
    if case in {"outsider", "inactive"}:
        assert response.status_code == 403
    else:
        assert response.status_code == 200
        assert response.json()["items"] == [] and response.json()["total"] == 0


def test_chat_picker_pagination_search_and_input_bounds(picker_library):
    client, engine, _, _, project_id, documents = picker_library
    endpoint = f"/knowledge/chat-documents?project_id={project_id}&scope=workspace"
    first = client.get(endpoint + "&limit=1").json()
    second = client.get(endpoint + "&limit=1&offset=1").json()
    assert first["total"] == second["total"] == 2
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert client.get(endpoint + "&limit=1").json() == first
    with Session(engine) as session:
        doc = session.get(KnowledgeV1Document, documents["shared"])
        doc.title = "Revenue 10%_target"
        session.add(doc)
        session.commit()
    params = {"project_id": project_id, "scope": "workspace"}
    assert client.get("/knowledge/chat-documents", params={**params, "query": "%_"}).json()["total"] == 1
    assert client.get("/knowledge/chat-documents", params={**params, "query": "SHARED.md"}).json()["total"] == 1
    assert client.get("/knowledge/chat-documents", params={**params, "query": "no match"}).json()["total"] == 0
    for params in ({"scope": "all"}, {"limit": 51}, {"offset": -1}, {"offset": 10001}, {"query": "x" * 121}):
        assert client.get("/knowledge/chat-documents", params={"project_id": project_id, **params}).status_code == 422


def message(identity, content, ids=(7,), **metadata):
    return Message(id=identity, conversation_id=1, role="user", content=content,
                   metadata_json=json.dumps({"knowledge_document_ids": list(ids), **metadata}))


@pytest.mark.parametrize("content", ["精简成两条", "请继续", "展开说明", "改成表格", "总结一下"])
def test_short_followup_reuses_only_prior_same_scope_user_topic(content):
    history = [message(1, "战略规划应该如何分析市场洞察？"), message(2, "继续"), message(3, content)]
    query, source_id = contextual_knowledge_query(content=content, document_ids=[7], history=history, current_message_id=3, conversation_id=1)
    assert "市场洞察" in query and query.endswith(content)
    assert source_id == 1


@pytest.mark.parametrize("case", ["new_topic", "cleared", "different_scope", "other_conversation", "malformed", "no_selection"])
def test_followup_never_crosses_scope_or_turn_boundary(case):
    content = "预算是多少？" if case == "new_topic" else "继续"
    history = [message(1, "市场洞察分析")]
    ids = [7]
    if case == "cleared": history.append(message(2, "继续", ids=()))
    if case == "different_scope": history.append(message(2, "继续", ids=(8,)))
    if case == "other_conversation": history[0].conversation_id = 2
    if case == "malformed": history[0].metadata_json = "[]"
    if case == "no_selection": ids = None
    assert contextual_knowledge_query(content=content, document_ids=ids, history=history, current_message_id=3, conversation_id=1) == (content, None)
