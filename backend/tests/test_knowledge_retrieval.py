from __future__ import annotations

import itertools
import json
from unittest.mock import patch

import pytest
from sqlmodel import SQLModel, Session

from app.models.db import User
from app.models.knowledge import KnowledgeChunk, KnowledgeSource, KnowledgeV1Document
from app.services.knowledge_ingestion import deterministic_embedding, parse_embedding
from app.services.knowledge_retrieval import cosine_similarity, search_knowledge
from tests.test_database import create_test_engine, drop_all_tables


@pytest.fixture
def knowledge():
    engine = create_test_engine()
    drop_all_tables(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        user = User(email="retrieval@example.com", password_hash="x", is_admin=True, is_active=True)
        session.add(user)
        session.flush()
        counter = itertools.count(1)

        def add(content, *, scope_type="workspace", scope_id=None, status="active", title="资料",
                embedding=None, document_scope=None, metadata=None, source=None):
            index = next(counter)
            if source is None:
                source = KnowledgeSource(name=f"source-{index}", source_type="manual_upload",
                                         scope_type=scope_type, scope_id=scope_id,
                                         owner_user_id=user.id, status=status)
                session.add(source)
                session.flush()
            doc = KnowledgeV1Document(
                source_id=source.id, title=title, file_name=f"{index}.md", file_type="md",
                path=f"{index}.md", content_hash=f"{index:064x}", status="indexed",
                scope_type=(document_scope or (source.scope_type, source.scope_id))[0],
                scope_id=(document_scope or (source.scope_type, source.scope_id))[1],
                metadata_json=json.dumps(metadata or {}),
            )
            session.add(doc)
            session.flush()
            chunk = KnowledgeChunk(document_id=doc.id, chunk_index=0, content=content,
                                   embedding_model="test", embedding=embedding if embedding is not None
                                   else json.dumps(deterministic_embedding(content)))
            session.add(chunk)
            session.flush()
            return doc, chunk, source

        yield session, user, add
    drop_all_tables(engine)
    engine.dispose()


def test_chinese_question_recalls_relevant_evidence_without_exact_sentence(knowledge):
    session, user, add = knowledge
    doc, _, _ = add("客户验收前必须完成数据权限审批，审批责任人为客户数据负责人。")
    add("办公用品每月统一采购，与交付安排无关。")
    result = search_knowledge(session=session, user=user, query="请问数据权限由谁审批？", top_k=1)
    assert [item["document_id"] for item in result["chunks"]] == [doc.id]
    assert result["low_confidence"] is False


@pytest.mark.parametrize("embedding", ['["broken"]', '[1, 2]', '[NaN]', 'not json', '[null]'])
def test_bad_embedding_keeps_lexical_evidence_and_does_not_break_search(knowledge, embedding):
    session, user, add = knowledge
    doc, _, _ = add("数据权限审批由数据负责人负责。", embedding=embedding)
    result = search_knowledge(session=session, user=user, query="数据权限审批", top_k=1)
    assert result["chunks"][0]["document_id"] == doc.id
    assert result["chunks"][0]["relevance"] > 0.6


def test_hash_collision_without_lexical_evidence_is_not_a_match(knowledge):
    session, user, add = knowledge
    add("办公用品采购", embedding=json.dumps(deterministic_embedding("预算审批")))
    assert search_knowledge(session=session, user=user, query="预算审批")["chunks"] == []


@pytest.mark.parametrize("status", ["paused", "disabled", "deleted"])
def test_inactive_source_never_enters_context_even_for_admin(knowledge, status):
    session, user, add = knowledge
    add("budget approval", status=status)
    assert search_knowledge(session=session, user=user, query="budget approval")["chunks"] == []


def test_scope_and_document_filters_are_hard_boundaries(knowledge):
    session, user, add = knowledge
    add("budget approval", scope_type="client", scope_id=2)
    add("budget approval", scope_type="project", scope_id=3)
    add("budget approval")
    for filters in (
        {"scope_types": ["project"], "scope_ids": [2]},
        {"scope_types": ["client"], "scope_ids": [9]},
        {"scope_pairs": [("project", 2)]},
        {"scope_pairs": []}, {"document_ids": []}, {"document_ids": [-1, True]},
        {"scope_types": []}, {"scope_ids": []},
    ):
        assert search_knowledge(session=session, user=user, query="budget approval", **filters)["chunks"] == []


def test_exact_scope_receipt_is_not_overwritten_after_a_match(knowledge):
    session, user, add = knowledge
    doc, _, _ = add("budget approval", scope_type="project", scope_id=2)
    result = search_knowledge(session=session, user=user, query="budget approval", scope_pairs=[("project", 2)])
    assert result["chunks"][0]["document_id"] == doc.id
    assert result["scope_used"] == {"scope_pairs": [{"scope_type": "project", "scope_id": 2}]}


def test_private_user_scope_matches_source_owner_not_nullable_scope_id(knowledge):
    session, user, add = knowledge
    user.is_admin = False
    doc, _, _ = add("budget approval", scope_type="user")
    result = search_knowledge(session=session, user=user, query="budget approval", scope_pairs=[("user", user.id)])
    assert result["chunks"][0]["document_id"] == doc.id
    outsider = User(email="outsider@example.com", password_hash="x", is_active=True)
    session.add(outsider)
    session.flush()
    assert search_knowledge(session=session, user=outsider, query="budget approval")["chunks"] == []


def test_mismatched_document_and_source_scope_is_not_retrieved(knowledge):
    session, user, add = knowledge
    add("budget approval", document_scope=("project", 2))
    assert search_knowledge(session=session, user=user, query="budget approval")["chunks"] == []


def test_duplicate_content_does_not_consume_result_slots(knowledge):
    session, user, add = knowledge
    first, _, _ = add("Budget approval requires a signed request.")
    add("  Budget  approval requires a signed request.  ")
    other, _, _ = add("Budget approval also requires a finance review.")
    result = search_knowledge(session=session, user=user, query="budget approval", top_k=2)
    assert {item["document_id"] for item in result["chunks"]} == {first.id, other.id}


def test_english_token_boundaries_do_not_match_substrings(knowledge):
    session, user, add = knowledge
    add("Training records", title="資料")
    assert search_knowledge(session=session, user=user, query="AI")["chunks"] == []


def test_source_acl_checked_once_before_scoring_multiple_documents(knowledge):
    session, user, add = knowledge
    _, _, source = add("budget approval one")
    add("budget approval two", source=source)
    with patch("app.services.knowledge_retrieval.can_access_source", return_value=True) as access:
        result = search_knowledge(session=session, user=user, query="budget approval")
    assert len(result["chunks"]) == 2
    assert access.call_count == 1


@pytest.mark.parametrize("policy", [[], {}, "do_not_generate", "unknown"])
def test_malformed_or_forbidden_reuse_policy_does_not_enter_generation(knowledge, policy):
    session, user, add = knowledge
    add("预算审批", metadata={"reuse_policy": policy})
    allowed, _, _ = add("预算审批由财务负责", metadata={"reuse_policy": "can_generate"})
    result = search_knowledge(session=session, user=user, query="预算审批", can_generate=True)
    assert [item["document_id"] for item in result["chunks"]] == [allowed.id]


def test_combined_scope_filters_intersect_and_receipt_preserves_bounds(knowledge):
    session, user, add = knowledge
    wanted, _, _ = add("预算审批由项目负责人负责", scope_type="project", scope_id=2)
    add("预算审批由客户负责人负责", scope_type="client", scope_id=2)
    result = search_knowledge(
        session=session, user=user, query="预算审批", scope_types=["project"], scope_ids=[2],
        scope_pairs=[("project", 2), ("client", 2)],
    )
    assert [item["document_id"] for item in result["chunks"]] == [wanted.id]
    assert result["scope_used"] == {
        "scope_pairs": [{"scope_type": "project", "scope_id": 2}, {"scope_type": "client", "scope_id": 2}],
        "scope_types": ["project"], "scope_ids": [2],
    }


def test_blank_body_is_not_evidence_even_with_matching_title(knowledge):
    session, user, add = knowledge
    add(" \n ", title="预算审批")
    assert search_knowledge(session=session, user=user, query="预算审批")["chunks"] == []


@pytest.mark.parametrize("field", ["confidential_level", "reuse_policy"])
def test_malformed_policy_fails_closed_even_without_generation_filter(knowledge, field):
    session, user, add = knowledge
    add("预算审批", metadata={field: ["do_not_generate"]})
    assert search_knowledge(session=session, user=user, query="预算审批")["chunks"] == []


def test_title_and_heading_support_recall_but_not_high_confidence(knowledge):
    session, user, add = knowledge
    doc, chunk, _ = add("由财务负责人复核并签字。", title="Budget approval")
    chunk.heading_path = json.dumps(["预算审批", 2, None])
    result = search_knowledge(session=session, user=user, query="预算审批", top_k=1)
    assert result["chunks"][0]["document_id"] == doc.id
    assert result["chunks"][0]["heading_path"] == ["预算审批"]
    assert result["low_confidence"] is True


def test_unauthorized_chunks_are_not_scored(knowledge):
    session, user, add = knowledge
    add("预算审批")
    with patch("app.services.knowledge_retrieval.can_access_source", return_value=False), patch(
        "app.services.knowledge_retrieval.lexical_score"
    ) as score:
        assert search_knowledge(session=session, user=user, query="预算审批")["chunks"] == []
    score.assert_not_called()


@pytest.mark.parametrize("value", [None, '["broken"]', '[NaN]', '[Infinity]', 'null', '{"bad": 1}', [None]])
def test_embedding_parser_fails_soft_for_invalid_vectors(value):
    assert parse_embedding(value) == []


@pytest.mark.parametrize("vector", [[1], [float("nan"), 0], [float("inf"), 0], ["bad", 0], [[1], [2]]])
def test_cosine_similarity_fails_soft_for_incompatible_vectors(vector):
    assert cosine_similarity([1, 0], vector) == 0
