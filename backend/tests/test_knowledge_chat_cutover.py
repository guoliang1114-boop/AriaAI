from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from sqlmodel import SQLModel, Session

from app.models.db import ClientRecord, DocumentChunk, KnowledgeDocument, Project, ProjectMember, User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.services import context_builder as context_builder_module
from app.services import rag as legacy_rag
from app.services.knowledge_ingestion import deterministic_embedding, sha256_bytes
from tests.test_database import create_test_engine, drop_all_tables
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat_store import build_message_metadata


def _seed_user_project(session: Session, *, suffix: str = "") -> tuple[User, Project]:
    user = User(
        email=f"member{suffix}@example.com",
        password_hash="x",
        is_active=True,
    )
    client = ClientRecord(name=f"Client {suffix or 'A'}")
    session.add(user)
    session.add(client)
    session.flush()
    project = Project(
        name=f"Project {suffix or 'A'}",
        client=client.name,
        client_id=client.id,
    )
    session.add(project)
    session.flush()
    session.add(ProjectMember(project_id=project.id, user_id=user.id, role="editor"))
    session.commit()
    session.refresh(user)
    session.refresh(project)
    return user, project


@pytest.mark.parametrize("ids", [[], [True], ["1"], [0], [-1], [1.5], list(range(1, 22))])
def test_explicit_knowledge_selection_rejects_invalid_ids(ids):
    with pytest.raises(ValidationError):
        SendMessageRequest(content="问题", knowledge_document_ids=ids)


def test_explicit_knowledge_selection_keeps_legacy_namespace_separate():
    with pytest.raises(ValidationError):
        SendMessageRequest(content="问题", knowledge_document_ids=[1], rag_doc_ids=[1])
    request = SendMessageRequest(content="问题", knowledge_document_ids=[1, 1, 2])
    assert request.model_dump()["knowledge_document_ids"] == [1, 1, 2]
    assert build_message_metadata(knowledge_document_ids=request.knowledge_document_ids) == {
        "knowledge_document_ids": [1, 2],
    }
    assert "knowledge_document_ids" not in build_message_metadata()


@pytest.mark.parametrize("case", ["selected", "empty", "missing", "unauthorized", "no_actor", "inactive", "no_match", "failure"])
def test_standalone_explicit_knowledge_selection_is_acl_bound_and_never_falls_back(case):
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            user, project = _seed_user_project(session)
            selected = _seed_source_scoped_document(
                session, user=user, project=project, title="选中文档",
                content="数据权限审批责任人为客户数据负责人。", chunk_index=4,
            )
            _seed_source_scoped_document(
                session, user=user, project=project, title="未选中文档",
                content="数据权限审批不应串入的其他资料。",
            )
            outsider, private_project = _seed_user_project(session, suffix="private")
            private_doc = _seed_source_scoped_document(
                session, user=outsider, project=private_project, title="私密文档",
                content="数据权限审批私密资料。",
            )
            ids = [] if case == "empty" else [private_doc.id] if case == "unauthorized" else [999999] if case == "missing" else [selected.id]
            if case == "inactive":
                user.is_active = False
                session.add(user)
                session.commit()
            from app.services.context_builder import rag_context as rag_context_module
            original_search = rag_context_module.search_knowledge
            with patch.object(context_builder_module, "retrieve_structured", side_effect=AssertionError("No legacy fallback")), patch.object(
                rag_context_module, "search_knowledge",
                side_effect=RuntimeError("unavailable") if case == "failure" else original_search,
            ):
                context = context_builder_module.build_chat_context(
                    session=session, knowledge_document_ids=ids,
                    content="独角兽宇宙" if case == "no_match" else "数据权限如何审批？",
                    requesting_user_id=None if case == "no_actor" else user.id,
                    accessible_project_ids=[project.id], accessible_client_ids=[],
                )
            assert "不应串入" not in context.rag_context
            assert "私密资料" not in context.rag_context
            assert context.context_receipt["evidence"]["knowledge_legacy_fallback"] is False
            if case == "selected":
                assert "数据权限审批责任人为客户数据负责人" in context.rag_context
                assert {source["id"] for source in context.rag_sources} == {selected.id}
                assert context.rag_sources[0]["document_namespace"] == "source_scoped"
                assert context.rag_sources[0]["chunk_index"] == 4
            else:
                assert context.rag_sources == []
                assert "未检索到相关证据时请说明资料不足" in context.rag_context
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def _seed_source_scoped_document(
    session: Session,
    *,
    user: User,
    project: Project,
    title: str,
    content: str,
    chunk_index: int = 0,
) -> KnowledgeV1Document:
    source = KnowledgeSource(
        name=f"{title} source",
        source_type="manual_upload",
        scope_type="project",
        scope_id=project.id,
        owner_user_id=user.id,
    )
    session.add(source)
    session.flush()
    document = KnowledgeV1Document(
        source_id=source.id,
        title=title,
        file_name=f"{title}.md",
        file_type="md",
        path=f"knowledge/{title}.md",
        content_hash=sha256_bytes(content.encode("utf-8")),
        scope_type="project",
        scope_id=project.id,
        status="indexed",
    )
    session.add(document)
    session.flush()
    session.add(
        KnowledgeChunk(
            document_id=document.id,
            chunk_index=chunk_index,
            heading_path="[]",
            content=content,
            token_count=10,
            embedding_model="test",
            embedding=json.dumps(deterministic_embedding(content)),
        )
    )
    session.commit()
    session.refresh(document)
    return document


@pytest.mark.parametrize("query,content", [
    ("weekly risk review", "The delivery playbook requires a weekly risk review."),
    ("请问数据权限由谁审批？", "客户验收前必须完成数据权限审批，审批责任人为客户数据负责人。"),
])
def test_project_chat_prefers_source_scoped_knowledge_and_preserves_chunk_identity(query, content) -> None:
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            user, project = _seed_user_project(session)
            document = _seed_source_scoped_document(
                session,
                user=user,
                project=project,
                title="Delivery playbook",
                content=content,
                chunk_index=4,
            )

            with patch.object(
                context_builder_module,
                "retrieve_structured",
                side_effect=AssertionError("legacy retrieval must not run"),
            ):
                context = context_builder_module.build_chat_context(
                    session=session,
                    project_id=project.id,
                    knowledge_scope="project",
                    content=query,
                    requesting_user_id=user.id,
                    accessible_project_ids=[project.id],
                    accessible_client_ids=[],
                )

        assert content in context.rag_context
        assert context.rag_sources[0]["id"] == document.id
        assert context.rag_sources[0]["document_namespace"] == "source_scoped"
        assert context.rag_sources[0]["knowledge_source_id"] == document.source_id
        assert context.rag_sources[0]["chunk_index"] == 4
        assert context.context_receipt["evidence"]["knowledge_retrieval_mode"] == "source_scoped"
        assert context.context_receipt["evidence"]["knowledge_legacy_fallback"] is False
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_project_chat_uses_bounded_legacy_fallback_when_source_scoped_is_empty() -> None:
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            user, project = _seed_user_project(session)
            legacy_document = KnowledgeDocument(
                name="Legacy brief",
                file_type="md",
                path="legacy.md",
                project_id=project.id,
                vector_status="synced",
            )
            session.add(legacy_document)
            session.flush()
            session.add(
                DocumentChunk(
                    document_id=legacy_document.id,
                    chunk_index=0,
                    content="Legacy scoped evidence",
                    embedding_json="[1.0, 0.0]",
                )
            )
            session.commit()
            fallback = legacy_rag.RetrievalContext(
                [
                    legacy_rag.RetrievalResult(
                        content="Legacy scoped evidence",
                        document_name="Legacy brief",
                        document_id=int(legacy_document.id),
                        chunk_index=0,
                        score=0.9,
                    )
                ],
                "legacy evidence",
            )
            with patch.object(
                context_builder_module,
                "retrieve_structured",
                return_value=fallback,
            ) as legacy_retrieve:
                context = context_builder_module.build_chat_context(
                    session=session,
                    project_id=project.id,
                    knowledge_scope="project",
                    content="legacy evidence",
                    requesting_user_id=user.id,
                    accessible_project_ids=[project.id],
                    accessible_client_ids=[],
                )

        legacy_retrieve.assert_called_once()
        assert "Legacy scoped evidence" in context.rag_context
        assert context.context_receipt["evidence"]["knowledge_retrieval_mode"] == "legacy_fallback"
        assert context.context_receipt["evidence"]["knowledge_legacy_fallback"] is True
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_source_scoped_project_chat_never_widens_to_another_accessible_project() -> None:
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            user, project = _seed_user_project(session)
            other = Project(name="Other project", client="Other")
            session.add(other)
            session.flush()
            session.add(ProjectMember(project_id=other.id, user_id=user.id, role="editor"))
            _seed_source_scoped_document(
                session,
                user=user,
                project=project,
                title="Current source",
                content="current project control evidence",
            )
            _seed_source_scoped_document(
                session,
                user=user,
                project=other,
                title="Other source",
                content="other project control evidence",
            )

            context = context_builder_module.build_chat_context(
                session=session,
                project_id=project.id,
                knowledge_scope="project",
                content="control evidence",
                requesting_user_id=user.id,
                accessible_project_ids=[project.id, other.id],
                accessible_client_ids=[],
            )

        titles = {source["title"] for source in context.rag_sources}
        assert titles == {"Current source"}
        assert "other project control evidence" not in context.rag_context
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def test_source_scoped_failure_is_visible_and_uses_bounded_legacy_fallback() -> None:
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            user, project = _seed_user_project(session, suffix="failure")
            session.add(
                KnowledgeDocument(
                    name="Legacy fallback",
                    file_type="md",
                    path="legacy-fallback.md",
                    project_id=project.id,
                    vector_status="synced",
                )
            )
            session.commit()
            fallback = legacy_rag.RetrievalContext(
                [
                    legacy_rag.RetrievalResult(
                        content="Bounded legacy evidence",
                        document_name="Legacy fallback",
                        document_id=51,
                        chunk_index=0,
                        score=0.8,
                    )
                ],
                "fallback query",
            )
            with patch(
                "app.services.context_builder.rag_context.search_knowledge",
                side_effect=RuntimeError("private provider failure"),
            ):
                with patch.object(
                    context_builder_module,
                    "retrieve_structured",
                    return_value=fallback,
                ) as legacy_retrieve:
                    context = context_builder_module.build_chat_context(
                        session=session,
                        project_id=project.id,
                        knowledge_scope="project",
                        content="fallback query",
                        requesting_user_id=user.id,
                        accessible_project_ids=[project.id],
                        accessible_client_ids=[],
                    )

        legacy_retrieve.assert_called_once()
        evidence = context.context_receipt["evidence"]
        assert evidence["knowledge_retrieval_mode"] == "legacy_fallback"
        assert evidence["knowledge_legacy_fallback"] is True
        assert evidence["knowledge_source_scoped_unavailable"] is True
        assert "private provider failure" not in json.dumps(
            context.context_receipt,
            ensure_ascii=False,
        )
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()
