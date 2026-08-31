from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Conversation, Message, Project, ProjectMember, User
from app.routers.projects_questions import (
    AnalyzeProjectQuestionEvidenceRequest,
    analyze_project_question_evidence,
)
from app.services.agent_harness.knowledge_evidence import (
    build_knowledge_evidence_manifest,
    resolve_knowledge_citations,
)
from app.services.agent_harness.project_memory_evidence import (
    build_project_memory_evidence,
    resolve_project_memory_citations,
)
from app.services.project_contexts import save_project_memory
from app.services.project_question_evidence import (
    assess_project_question_answer,
    build_project_question_evidence_review,
)
from app.services.project_question_resolutions import project_question_sha256


QUESTION = "客户是否确认了最终验收范围？"


def _knowledge_manifest():
    return build_knowledge_evidence_manifest(
        [
            SimpleNamespace(
                content="客户于周五书面确认最终验收范围。",
                document_name="验收确认函.pdf",
                document_id=31,
                chunk_index=2,
                score=0.91,
            )
        ],
        knowledge_scope="project",
        project_id=1,
    )


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed():
    session = _session()
    owner = User(email="evidence-owner@example.com", password_hash="x", display_name="Owner")
    viewer = User(email="evidence-viewer@example.com", password_hash="x", display_name="Viewer")
    project = Project(name="Evidence review", client="Acme")
    session.add(owner)
    session.add(viewer)
    session.add(project)
    session.flush()
    session.add(ProjectMember(project_id=int(project.id), user_id=int(owner.id), role="owner"))
    session.add(ProjectMember(project_id=int(project.id), user_id=int(viewer.id), role="viewer"))
    conversation = Conversation(
        title="验收讨论",
        project_id=int(project.id),
        owner_user_id=int(owner.id),
    )
    session.add(conversation)
    session.flush()
    current_manifest = build_knowledge_evidence_manifest(
        [
            SimpleNamespace(
                content="客户于周五书面确认最终验收范围。",
                document_name="验收确认函.pdf",
                document_id=31,
                chunk_index=2,
                score=0.91,
            )
        ],
        knowledge_scope="project",
        project_id=int(project.id),
    )
    cited_manifest, _ = resolve_knowledge_citations(current_manifest, "已确认。[K1]")
    strong = Message(
        conversation_id=int(conversation.id),
        role="assistant",
        content="客户已经书面确认最终验收范围。[K1]",
        metadata_json=json.dumps(
            {
                "knowledge_evidence": cited_manifest,
                "run_evaluation": {
                    "schema_version": 1,
                    "verdict": "completed",
                    "score": 100,
                },
                "interaction_feedback": {
                    "schema_version": 1,
                    "rating": "helpful",
                    "reasons": [],
                },
            },
            ensure_ascii=False,
        ),
    )
    weak = Message(
        conversation_id=int(conversation.id),
        role="assistant",
        content="今天讨论了团队团建安排。",
        metadata_json="{}",
    )
    session.add(strong)
    session.add(weak)
    session.commit()
    save_project_memory(
        session,
        int(project.id),
        {"open_questions": {"ai": [QUESTION], "pinned": []}, "_coverage": {}},
        trigger="question_evidence_seed",
    )
    for row in (owner, viewer, project, conversation, strong, weak):
        session.refresh(row)
    return session, owner, viewer, project, strong, weak, current_manifest


def test_answer_readiness_is_deterministic_and_not_a_correctness_verdict() -> None:
    manifest = _knowledge_manifest()
    cited, _ = resolve_knowledge_citations(manifest, "已确认。[K1]")
    evidence_id = manifest["entries"][0]["evidence_id"]
    source_map = {
        ("knowledge", evidence_id): {
            "source_type": "knowledge_document",
            "evidence_id": evidence_id,
            "title": "验收确认函.pdf",
        }
    }
    assessment = assess_project_question_answer(
        question=QUESTION,
        answer="客户已经书面确认最终验收范围。[K1]",
        metadata={
            "knowledge_evidence": cited,
            "run_evaluation": {"schema_version": 1, "verdict": "completed", "score": 100},
        },
        project_id=1,
        question_source_map=source_map,
    )

    assert assessment["readiness_score"] >= 75
    assert assessment["readiness_band"] == "strong"
    assert assessment["evidence"]["question_aligned_count"] == 1
    assert assessment["evidence"]["verified_aligned_count"] == 1
    assert assessment["evidence"]["support_rate"] == 1.0
    assert assessment["evidence"]["sources"][0]["title"] == "验收确认函.pdf"
    assert assessment["requires_human_confirmation"] is True
    assert assessment["is_correctness_verdict"] is False

    no_current_pool = assess_project_question_answer(
        question=QUESTION,
        answer="客户已经书面确认最终验收范围。[K1]",
        metadata={
            "knowledge_evidence": cited,
            "run_evaluation": {"schema_version": 1, "verdict": "completed", "score": 100},
        },
        project_id=1,
        question_source_map={},
    )
    assert no_current_pool["readiness_band"] != "strong"
    assert "CURRENT_QUESTION_EVIDENCE_UNAVAILABLE" in no_current_pool["warnings"]

    invalid = assess_project_question_answer(
        question=QUESTION,
        answer="客户已经书面确认最终验收范围。",
        metadata={"knowledge_evidence": {"schema_version": 1, "entries": []}},
        project_id=1,
        question_source_map=source_map,
    )
    assert invalid["evidence"]["status"] == "invalid"
    assert "INVALID_CITATIONS" in invalid["warnings"]

    unresolved_project = Project(
        id=1,
        name="Unresolved provenance",
        client="Acme",
        memory_version=1,
        memory_stale=False,
        context_memory_json=json.dumps(
            {"project_brief": "客户已经书面确认最终验收范围。"},
            ensure_ascii=False,
        ),
    )
    memory_manifest = build_project_memory_evidence(
        unresolved_project,
        QUESTION,
    )["manifest"]
    resolved_memory, _ = resolve_project_memory_citations(memory_manifest, "已确认。[M1]")
    memory_entry = memory_manifest["entries"][0]
    unresolved = assess_project_question_answer(
        question=QUESTION,
        answer="客户已经书面确认最终验收范围。[M1]",
        metadata={
            "project_memory_evidence": resolved_memory,
            "run_evaluation": {"schema_version": 1, "verdict": "completed", "score": 100},
        },
        project_id=1,
        question_source_map={
            (
                "memory",
                memory_entry["slot"],
                memory_entry["content_sha256"],
            ): {
                "source_type": "project_memory",
                "provenance_status": "unresolved",
                "title": "项目记忆",
            }
        },
    )
    assert unresolved["readiness_band"] != "strong"
    assert unresolved["evidence"]["verified_aligned_count"] == 0
    assert "WEAK_CURRENT_PROVENANCE" in unresolved["warnings"]


def test_question_review_recalls_current_sources_and_ranks_project_answers(monkeypatch) -> None:
    session, _, _, project, strong, weak, current_manifest = _seed()
    monkeypatch.setattr(
        "app.services.project_question_evidence.build_rag_context",
        lambda *_args, **_kwargs: {
            "text": "PRIVATE RETRIEVED CHUNK",
            "sources": [],
            "evidence_manifest": current_manifest,
        },
    )

    payload = build_project_question_evidence_review(
        session,
        project=project,
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
    )

    assert payload["schema_version"] == 1
    assert payload["question_evidence"]["knowledge"]["source_count"] == 1
    assert payload["question_evidence"]["memory"]["source_count"] >= 1
    assert payload["candidates"][0]["message_id"] == strong.id
    assert payload["candidates"][0]["assessment"]["readiness_band"] == "strong"
    assert payload["candidates"][-1]["message_id"] == weak.id
    assert payload["summary"]["recommended_message_id"] == strong.id
    assert payload["assessment_contract"]["is_correctness_verdict"] is False
    assert payload["privacy"]["includes_full_answer_content"] is False
    assert payload["privacy"]["includes_retrieved_chunk_content"] is False
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "PRIVATE RETRIEVED CHUNK" not in serialized
    assert "content_sha256" not in serialized


def test_question_review_degrades_when_knowledge_retrieval_is_unavailable(monkeypatch) -> None:
    session, _, _, project, _, _, _ = _seed()

    def fail(*_args, **_kwargs):
        raise RuntimeError("embedding service unavailable")

    monkeypatch.setattr("app.services.project_question_evidence.build_rag_context", fail)
    payload = build_project_question_evidence_review(
        session,
        project=project,
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
    )

    assert payload["question_evidence"]["knowledge"]["status"] == "unavailable"
    assert payload["question_evidence"]["memory"]["source_count"] >= 1
    assert payload["question_evidence"]["supporting_source_count"] == 0
    assert payload["question_evidence"]["status"] == "context_only"
    assert len(payload["candidates"]) == 2


def test_question_evidence_endpoint_requires_project_write_access(monkeypatch) -> None:
    session, _, viewer, project, _, _, _ = _seed()
    called = False

    def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("retrieval ran before authorization")

    monkeypatch.setattr(
        "app.routers.projects_questions.build_project_question_evidence_review",
        should_not_run,
    )
    with pytest.raises(HTTPException) as exc:
        analyze_project_question_evidence(
            project_id=int(project.id),
            question_sha256=project_question_sha256(QUESTION),
            body=AnalyzeProjectQuestionEvidenceRequest(question=QUESTION),
            session=session,
            current_user=viewer,
        )
    assert exc.value.status_code == 403
    assert called is False


def test_question_review_rejects_tampered_or_unknown_question_identity(monkeypatch) -> None:
    session, _, _, project, _, _, current_manifest = _seed()
    monkeypatch.setattr(
        "app.services.project_question_evidence.build_rag_context",
        lambda *_args, **_kwargs: {"evidence_manifest": current_manifest},
    )
    with pytest.raises(HTTPException) as mismatch:
        build_project_question_evidence_review(
            session,
            project=project,
            question=QUESTION,
            question_sha256="0" * 64,
        )
    assert mismatch.value.status_code == 400

    unknown = "项目是否已经完成税务备案？"
    with pytest.raises(HTTPException) as missing:
        build_project_question_evidence_review(
            session,
            project=project,
            question=unknown,
            question_sha256=project_question_sha256(unknown),
        )
    assert missing.value.status_code == 404
