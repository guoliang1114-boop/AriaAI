from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import Project, ProjectMember, User
from app.routers.projects_questions import (
    AnalyzeProjectQuestionEvidenceRequest,
    plan_project_question_remediation,
)
from app.services.project_question_remediation import (
    build_project_question_remediation_plan,
    build_question_evidence_remediation_plan,
)


QUESTION = "客户是否确认了最终验收范围？"
IDENTITY = "a" * 64


def _review(
    *,
    evidence_status: str = "context_only",
    source_count: int = 1,
    supporting_source_count: int = 0,
    memory_stale: bool = False,
    evaluated_count: int = 0,
    strong_count: int = 0,
    warnings: list[str] | None = None,
) -> dict:
    candidates = []
    if evaluated_count:
        candidates.append(
            {
                "message_id": 42,
                "preview": "PRIVATE ANSWER PREVIEW",
                "assessment": {
                    "warnings": warnings or [],
                    "readiness_band": "strong" if strong_count else "review",
                },
            }
        )
    return {
        "schema_version": 1,
        "project_id": 9,
        "question": QUESTION,
        "question_sha256": IDENTITY,
        "question_evidence": {
            "status": evidence_status,
            "source_count": source_count,
            "supporting_source_count": supporting_source_count,
            "memory": {
                "memory_version": 5,
                "memory_stale": memory_stale,
                "sources": [
                    {
                        "source_type": "project_memory",
                        "evidence_id": "project-memory:9:scope:v5",
                        "title": "PRIVATE SOURCE TITLE",
                    }
                ],
            },
            "knowledge": {"sources": []},
        },
        "summary": {
            "evaluated_candidate_count": evaluated_count,
            "recommended_message_id": 42 if evaluated_count else None,
            "bands": {
                "strong": strong_count,
                "review": max(0, evaluated_count - strong_count),
                "weak": 0,
                "unrated": 0,
            },
        },
        "candidates": candidates,
    }


def _session_with_members() -> tuple[Session, User, User, Project]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    session = Session(engine)
    owner = User(email="remediation-owner@example.com", password_hash="x")
    viewer = User(email="remediation-viewer@example.com", password_hash="x")
    project = Project(name="Remediation", client="Acme")
    session.add(owner)
    session.add(viewer)
    session.add(project)
    session.flush()
    session.add(ProjectMember(project_id=int(project.id), user_id=int(owner.id), role="owner"))
    session.add(ProjectMember(project_id=int(project.id), user_id=int(viewer.id), role="viewer"))
    session.commit()
    for row in (owner, viewer, project):
        session.refresh(row)
    return session, owner, viewer, project


def test_context_only_evidence_becomes_manual_editable_remediation() -> None:
    payload = build_question_evidence_remediation_plan(_review())

    assert payload["schema_version"] == 1
    assert payload["status"] == "evidence_collection_required"
    assert payload["question_archetype"] == "confirmation"
    assert payload["evidence_target"] == "written_confirmation"
    assert {gap["code"] for gap in payload["gaps"]} >= {
        "CONTEXT_ONLY_EVIDENCE",
        "NO_PROJECT_ANSWER_CANDIDATE",
    }
    assert {action["kind"] for action in payload["actions"]} >= {
        "evidence_request",
        "clarification_question",
        "candidate_review",
        "human_verification",
    }
    assert all(action["execution_mode"] == "manual_only" for action in payload["actions"])
    assert all(action["suggested_channel"] == "manual" for action in payload["actions"])
    assert all(
        action["editable_fields"] == ["title", "draft", "owner_user_id"]
        for action in payload["actions"]
    )
    assert payload["plan_contract"] == {
        "name": "deterministic_evidence_gap_remediation",
        "generation_method": "rules_only",
        "persists_changes": False,
        "sends_messages": False,
        "executes_tools": False,
        "requires_human_confirmation": True,
    }
    assert len(payload["basis"]["fingerprint"]) == 64
    assert len(payload["basis"]["evidence_identity_fingerprint"]) == 64
    serialized = json.dumps(payload, ensure_ascii=False)
    assert "PRIVATE ANSWER PREVIEW" not in serialized
    assert "PRIVATE SOURCE TITLE" not in serialized
    assert "project-memory:9:scope:v5" not in serialized


def test_strong_current_answer_only_requires_final_human_verification() -> None:
    payload = build_question_evidence_remediation_plan(
        _review(
            evidence_status="available",
            source_count=2,
            supporting_source_count=2,
            evaluated_count=1,
            strong_count=1,
        )
    )

    assert payload["status"] == "verification_ready"
    assert payload["gaps"] == []
    assert [action["kind"] for action in payload["actions"]] == ["human_verification"]
    assert payload["actions"][0]["blocking"] is False
    assert payload["privacy"]["includes_answer_previews"] is False
    assert payload["privacy"]["includes_source_titles"] is False
    assert payload["privacy"]["includes_retrieved_chunk_content"] is False


def test_remediation_basis_changes_when_current_evidence_identity_changes() -> None:
    first_review = _review()
    second_review = _review()
    second_review["question_evidence"]["memory"]["sources"][0][
        "evidence_id"
    ] = "project-memory:9:scope:v6"

    first = build_question_evidence_remediation_plan(first_review)
    second = build_question_evidence_remediation_plan(second_review)

    assert first["basis"]["evidence_identity_fingerprint"] != second["basis"][
        "evidence_identity_fingerprint"
    ]
    assert first["basis"]["fingerprint"] != second["basis"]["fingerprint"]


def test_invalid_or_stale_evidence_fails_closed_to_internal_checks() -> None:
    payload = build_question_evidence_remediation_plan(
        _review(
            evidence_status="available",
            source_count=2,
            supporting_source_count=1,
            memory_stale=True,
            evaluated_count=1,
            warnings=["INVALID_CITATIONS", "ANSWER_MARKED_UNHELPFUL"],
        )
    )

    gap_codes = {gap["code"] for gap in payload["gaps"]}
    assert {"STALE_PROJECT_MEMORY", "INVALID_CITATIONS", "ANSWER_MARKED_UNHELPFUL"} <= gap_codes
    internal_actions = [
        action for action in payload["actions"] if action["kind"] == "internal_check"
    ]
    assert len(internal_actions) == 2
    assert all(action["blocking"] is True for action in internal_actions)
    assert payload["status"] == "evidence_collection_required"


def test_remediation_wrapper_is_deterministic_and_does_not_persist(monkeypatch) -> None:
    session, _, _, project = _session_with_members()
    review = _review()
    calls = 0

    def current_review(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        return review

    monkeypatch.setattr(
        "app.services.project_question_remediation.build_project_question_evidence_review",
        current_review,
    )
    before = (len(session.new), len(session.dirty), len(session.deleted))
    first = build_project_question_remediation_plan(
        session,
        project=project,
        question=QUESTION,
        question_sha256=IDENTITY,
    )
    second = build_project_question_remediation_plan(
        session,
        project=project,
        question=QUESTION,
        question_sha256=IDENTITY,
    )

    assert calls == 2
    assert first == second
    assert (len(session.new), len(session.dirty), len(session.deleted)) == before


def test_remediation_endpoint_authorizes_before_retrieval(monkeypatch) -> None:
    session, _, viewer, project = _session_with_members()
    called = False

    def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("remediation retrieval ran before authorization")

    monkeypatch.setattr(
        "app.routers.projects_questions.build_project_question_remediation_plan",
        should_not_run,
    )
    with pytest.raises(HTTPException) as exc:
        plan_project_question_remediation(
            project_id=int(project.id),
            question_sha256=IDENTITY,
            body=AnalyzeProjectQuestionEvidenceRequest(question=QUESTION),
            session=session,
            current_user=viewer,
        )

    assert exc.value.status_code == 403
    assert called is False


def test_remediation_endpoint_delegates_for_project_owner(monkeypatch) -> None:
    session, owner, _, project = _session_with_members()
    expected = {"status": "verification_ready"}
    captured: dict = {}

    def build_plan(
        received_session,
        *,
        project: Project,
        question: str,
        question_sha256: str,
    ) -> dict:
        captured.update(
            session=received_session,
            project_id=project.id,
            question=question,
            question_sha256=question_sha256,
        )
        return expected

    monkeypatch.setattr(
        "app.routers.projects_questions.build_project_question_remediation_plan",
        build_plan,
    )
    result = plan_project_question_remediation(
        project_id=int(project.id),
        question_sha256=IDENTITY,
        body=AnalyzeProjectQuestionEvidenceRequest(question=QUESTION),
        session=session,
        current_user=owner,
    )

    assert result == expected
    assert captured == {
        "session": session,
        "project_id": project.id,
        "question": QUESTION,
        "question_sha256": IDENTITY,
    }
