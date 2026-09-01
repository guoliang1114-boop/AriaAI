from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import (
    Conversation,
    Project,
    ProjectFile,
    ProjectMember,
    ProjectQuestionRemediationEvidenceAttachment,
    ProjectQuestionRemediationEvidenceReview,
    ProjectQuestionRemediationExecution,
    User,
)
from app.routers.projects_questions import (
    PrepareProjectQuestionReanswerRequest,
    prepare_project_question_evidence_reanswer,
)
from app.routers.chat_schemas import SendMessageRequest
from app.services.chat.runtime import prepare_chat_runtime
from app.services.context_builder import ChatContext
from app.services.project_contexts import save_project_memory
from app.services.project_question_evidence import (
    _current_attached_question_evidence,
    assess_project_question_answer,
)
from app.services.project_question_reanswer import (
    _project_file_source,
    prepare_project_question_reanswer,
    resolve_project_question_reanswer_citations,
    resolve_project_question_reanswer_input,
    validate_project_question_reanswer_manifest,
)
from app.services.project_question_resolutions import project_question_sha256


QUESTION = "客户是否确认了最终验收范围？"


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed() -> tuple[Session, User, User, Project, ProjectQuestionRemediationEvidenceAttachment]:
    session = _session()
    owner = User(email="reanswer-owner@example.com", password_hash="x")
    viewer = User(email="reanswer-viewer@example.com", password_hash="x")
    project = Project(name="Re-answer", client="Acme")
    session.add(owner)
    session.add(viewer)
    session.add(project)
    session.flush()
    session.add(ProjectMember(project_id=int(project.id), user_id=int(owner.id), role="owner"))
    session.add(ProjectMember(project_id=int(project.id), user_id=int(viewer.id), role="viewer"))
    question_identity = project_question_sha256(QUESTION)
    execution = ProjectQuestionRemediationExecution(
        project_id=int(project.id),
        source_promotion_id=9001,
        question_text=QUESTION,
        question_sha256=question_identity,
        target_kind="project_todo",
        target_todo_id=9001,
        status="completed",
        revision=2,
        evidence_count=1,
    )
    session.add(execution)
    session.flush()
    attachment = ProjectQuestionRemediationEvidenceAttachment(
        execution_id=int(execution.id),
        project_id=int(project.id),
        question_sha256=question_identity,
        execution_revision=2,
        idempotency_key_sha256="1" * 64,
        evidence_sha256="2" * 64,
        evidence_kind="manual_note",
        support_level="review_required",
        title="客户回复人工核对记录",
        note="负责人核对了客户的书面回复；仍须区分原始材料与人工判断。",
        attached_by_user_id=int(owner.id),
    )
    session.add(attachment)
    session.flush()
    session.add(
        ProjectQuestionRemediationEvidenceReview(
            attachment_id=int(attachment.id),
            execution_id=int(execution.id),
            project_id=int(project.id),
            question_sha256=question_identity,
            evidence_sha256=attachment.evidence_sha256,
            status="accepted",
            revision=1,
            reason="可用于重新回答，但不代表事实裁决。",
            reviewed_by_user_id=int(owner.id),
        )
    )
    session.commit()
    save_project_memory(
        session,
        int(project.id),
        {"open_questions": {"ai": [QUESTION], "pinned": []}, "_coverage": {}},
        trigger="project_question_reanswer_test",
    )
    for row in (owner, viewer, project, attachment):
        session.refresh(row)
    return session, owner, viewer, project, attachment


def test_prepare_resolve_and_cite_current_accepted_evidence() -> None:
    session, _, _, project, attachment = _seed()
    prepared = prepare_project_question_reanswer(
        session,
        project=project,
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
        attachment_ids=[int(attachment.id)],
    )

    assert prepared["privacy"]["includes_source_content"] is False
    assert prepared["sources"][0]["citation_key"] == "A1"
    assert "负责人核对" not in json.dumps(prepared, ensure_ascii=False)
    bundle = resolve_project_question_reanswer_input(
        session,
        project_id=int(project.id),
        **prepared["input"],
    )
    assert "负责人核对" in bundle.prompt
    assert "Human acceptance permits review use but is not a truth verdict" in bundle.prompt
    assert bundle.project_file_ids == ()
    assert bundle.knowledge_document_ids == ()

    resolved, references = resolve_project_question_reanswer_citations(
        bundle.manifest,
        "客户提供了书面回复，但这里仍包含人工判断。[A1] 不存在的引用不算。[A9]",
    )
    valid, reason = validate_project_question_reanswer_manifest(resolved)
    assert (valid, reason) == (True, "")
    assert resolved["status"] == "partial"
    assert resolved["cited_evidence_ids"] == [f"remediation_attachment_{'2' * 64}"]
    assert resolved["invalid_citation_keys"] == ["A9"]
    assert references == [
        {
            "schema_version": 1,
            "type": "question_evidence",
            "id": int(attachment.id),
            "title": "客户回复人工核对记录",
            "evidence_id": f"remediation_attachment_{'2' * 64}",
            "citation_key": "A1",
            "content_sha256": resolved["entries"][0]["source_content_sha256"],
        }
    ]

    with pytest.raises(HTTPException) as duplicate:
        prepare_project_question_reanswer(
            session,
            project=project,
            question=QUESTION,
            question_sha256=project_question_sha256(QUESTION),
            attachment_ids=[int(attachment.id), int(attachment.id)],
        )
    assert duplicate.value.status_code == 400


def test_review_drift_rejects_old_contract_and_old_answer_alignment() -> None:
    session, _, _, project, attachment = _seed()
    prepared = prepare_project_question_reanswer(
        session,
        project=project,
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
        attachment_ids=[int(attachment.id)],
    )
    bundle = resolve_project_question_reanswer_input(
        session,
        project_id=int(project.id),
        **prepared["input"],
    )
    cited, _ = resolve_project_question_reanswer_citations(
        bundle.manifest,
        "客户确认了验收范围，但该结论仍需人工确认。[A1]",
    )
    _, current_map = _current_attached_question_evidence(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
    )
    current = assess_project_question_answer(
        question=QUESTION,
        answer="客户确认了最终验收范围。[A1]",
        metadata={
            "project_question_reanswer_evidence": cited,
            "run_evaluation": {
                "schema_version": 1,
                "verdict": "completed",
                "score": 100,
            },
        },
        project_id=int(project.id),
        question_source_map=current_map,
    )
    assert current["readiness_band"] == "strong"
    assert current["evidence"]["remediation_cited_count"] == 1
    assert current["evidence"]["remediation_aligned_count"] == 1
    assert current["is_correctness_verdict"] is False

    review = session.get(ProjectQuestionRemediationEvidenceReview, 1)
    assert review is not None
    review.status = "rejected"
    review.revision = 2
    review.reason = "复核后发现记录不足。"
    session.add(review)
    session.commit()
    with pytest.raises(HTTPException) as drift:
        resolve_project_question_reanswer_input(
            session,
            project_id=int(project.id),
            **prepared["input"],
        )
    assert drift.value.status_code == 409

    _, changed_map = _current_attached_question_evidence(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
    )
    changed = assess_project_question_answer(
        question=QUESTION,
        answer="客户确认了最终验收范围。[A1]",
        metadata={"project_question_reanswer_evidence": cited},
        project_id=int(project.id),
        question_source_map=changed_map,
    )
    assert changed["readiness_band"] != "strong"
    assert changed["evidence"]["remediation_aligned_count"] == 0
    assert "REANSWER_EVIDENCE_CHANGED" in changed["warnings"]


def test_prepare_route_requires_project_write_access() -> None:
    session, _, viewer, project, attachment = _seed()
    with pytest.raises(HTTPException) as denied:
        prepare_project_question_evidence_reanswer(
            project_id=int(project.id),
            question_sha256=project_question_sha256(QUESTION),
            body=PrepareProjectQuestionReanswerRequest(
                question=QUESTION,
                attachment_ids=[int(attachment.id)],
            ),
            session=session,
            current_user=viewer,
        )
    assert denied.value.status_code == 403


def test_missing_project_file_is_reported_as_evidence_drift() -> None:
    session, _, _, project, _ = _seed()
    project_file = ProjectFile(
        project_id=int(project.id),
        name="missing.txt",
        file_type="txt",
        path="missing.txt",
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)

    with pytest.raises(HTTPException) as drift:
        _project_file_source(
            session,
            project_id=int(project.id),
            project_file_id=int(project_file.id),
            note="",
        )
    assert drift.value.status_code == 409
    assert "changed or is unavailable" in str(drift.value.detail)


def test_chat_runtime_forces_answer_only_and_injects_no_tool_evidence() -> None:
    session, owner, _, project, attachment = _seed()
    conversation = Conversation(
        title="证据回答",
        project_id=int(project.id),
        owner_user_id=int(owner.id),
    )
    session.add(conversation)
    session.commit()
    session.refresh(conversation)
    prepared = prepare_project_question_reanswer(
        session,
        project=project,
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
        attachment_ids=[int(attachment.id)],
    )
    request = SendMessageRequest(
        conversation_id=int(conversation.id),
        project_id=int(project.id),
        content=prepared["suggested_prompt"],
        skill_id=999,
        force_skill=True,
        project_question_reanswer=prepared["input"],
    )

    with patch(
        "app.services.chat.runtime.build_chat_context",
        return_value=ChatContext(
            tools=[{"name": "create_project_todo"}],
            max_tokens=4096,
            context_receipt={
                "scope": "project",
                "memory": {},
                "evidence": {},
            },
        ),
    ), patch(
        "app.services.chat.runtime._load_provider_module",
        return_value=SimpleNamespace(
            build_system_prompt=lambda *_args, **_kwargs: "system"
        ),
    ), patch(
        "app.services.chat.runtime.get_selected_model",
        return_value="kimi-k2.6",
    ):
        runtime = prepare_chat_runtime(
            session,
            request,
            owner_user_id=int(owner.id),
        )

    assert request.disable_skill is True
    assert request.skill_id is None
    assert runtime.skill_id is None
    assert runtime.tools == []
    turn_contract = runtime.prepare_metrics["turn_contract"]
    assert turn_contract["mode"] == "answer_only"
    assert turn_contract["needs_tools"] is False
    assert turn_contract["needs_artifact"] is False
    assert turn_contract["target_scope"] == "project"
    assert turn_contract["execution_scope"] == "chat_only"
    assert turn_contract["expected_response"] == "grounded_answer"
    assert turn_contract["requires_confirmation"] is False
    assert turn_contract["write_allowed"] is False
    assert turn_contract["source"] == "project_question_reanswer_contract"
    assert "Project Question Re-answer Evidence v1" in runtime.system
    assert "[A1]" in runtime.system
    assert runtime.project_question_reanswer_evidence_manifest[
        "contract_sha256"
    ] == prepared["input"]["contract_sha256"]
    source_ids = {
        item["source_id"] for item in runtime.context_manifest["sources"]
    }
    assert "project_question_reanswer_evidence" in source_ids
