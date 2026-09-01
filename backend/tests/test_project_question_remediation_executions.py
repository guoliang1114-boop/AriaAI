from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    Project,
    ProjectCommunicationRequest,
    ProjectFile,
    ProjectMember,
    ProjectQuestionRemediationEvidenceAttachment,
    ProjectQuestionRemediationEvidenceReview,
    ProjectQuestionRemediationEvidenceReviewEvent,
    ProjectQuestionRemediationExecution,
    ProjectQuestionRemediationExecutionEvent,
    ProjectQuestionResolution,
    ProjectTodo,
    User,
)
from app.routers.projects_questions import (
    ReviewProjectQuestionRemediationEvidenceRequest,
    get_project_question_remediation_executions,
    review_project_question_remediation_execution_evidence,
)
from app.services.project_question_evidence import _current_attached_question_evidence
from app.services.project_question_remediation_executions import (
    attach_project_question_remediation_evidence,
    build_remediation_execution_contract,
    list_project_question_remediation_executions,
    transition_project_question_remediation_execution,
)
from app.services.project_question_remediation_evidence_reviews import (
    build_remediation_evidence_review_contract,
    review_project_question_remediation_evidence,
)
from app.services.project_question_remediation_promotions import (
    confirm_project_question_remediation_promotion,
    prepare_project_question_remediation_promotion,
)
from app.services.project_question_resolutions import project_question_sha256
from app.services.project_todos import delete_project_todo, update_project_todo


QUESTION = "客户是否确认了最终验收范围？"
BASIS = "b" * 64


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed() -> tuple[Session, User, User, Project, Project]:
    session = _session()
    owner = User(email="execution-owner@example.com", password_hash="x")
    viewer = User(email="execution-viewer@example.com", password_hash="x")
    project = Project(name="Execution", client="Acme")
    other_project = Project(name="Other", client="Other")
    session.add(owner)
    session.add(viewer)
    session.add(project)
    session.add(other_project)
    session.flush()
    session.add(
        ProjectMember(project_id=int(project.id), user_id=int(owner.id), role="owner")
    )
    session.add(
        ProjectMember(project_id=int(project.id), user_id=int(viewer.id), role="viewer")
    )
    session.commit()
    for row in (owner, viewer, project, other_project):
        session.refresh(row)
    return session, owner, viewer, project, other_project


@pytest.fixture(autouse=True)
def _stable_plan(monkeypatch):
    monkeypatch.setattr(
        "app.services.project_question_remediation_promotions.build_project_question_remediation_plan",
        lambda *_args, **_kwargs: {
            "basis": {"fingerprint": BASIS},
            "actions": [
                {"action_id": "remediation_01", "kind": "evidence_request"}
            ],
        },
    )


def _confirm(
    session: Session,
    owner: User,
    project: Project,
    *,
    target_kind: str,
    key: str,
) -> dict:
    prepared = prepare_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        actor_user_id=int(owner.id),
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
        evidence_basis_fingerprint=BASIS,
        idempotency_key=key,
        target_kind=target_kind,
        action_kind="evidence_request",
        source_action_id="remediation_01",
        title="收集书面确认",
        draft="请归档客户书面确认。",
        recipient_label=("客户项目经理" if target_kind == "communication_request" else ""),
    )
    return confirm_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=int(prepared["id"]),
        actor_user_id=int(owner.id),
        snapshot_sha256=str(prepared["snapshot_sha256"]),
        expected_revision=1,
    )


def _execution(session: Session) -> ProjectQuestionRemediationExecution:
    return session.exec(select(ProjectQuestionRemediationExecution)).one()


def test_confirm_creates_project_wide_execution_center_without_delivery() -> None:
    session, owner, _, project, _ = _seed()

    confirmed = _confirm(
        session,
        owner,
        project,
        target_kind="communication_request",
        key="execution-confirm-key-0001",
    )
    center = list_project_question_remediation_executions(
        session,
        project_id=int(project.id),
        actor_user_id=int(owner.id),
    )

    execution = _execution(session)
    assert execution.status == "ready_for_manual_send"
    assert execution.revision == 1
    assert confirmed["target"]["execution"]["id"] == execution.id
    assert center["count"] == 1
    assert center["counts"]["ready_for_manual_send"] == 1
    assert center["items"][0]["allowed_actions"] == [
        "attach_evidence",
        "mark_sent",
        "cancel",
    ]
    assert center["items"][0]["target"]["delivered_by_aria"] is False
    assert center["contract"] == build_remediation_execution_contract()
    assert session.exec(select(ProjectQuestionRemediationExecutionEvent)).one().action == "created"


def test_manual_communication_requires_attestation_then_evidence_before_completion() -> None:
    session, owner, _, project, _ = _seed()
    _confirm(
        session,
        owner,
        project,
        target_kind="communication_request",
        key="execution-communication-key-0001",
    )
    execution = _execution(session)

    sent = transition_project_question_remediation_execution(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        action="mark_sent",
        expected_revision=1,
        note="用户确认已通过企业邮箱人工发送。",
    )
    assert sent["status"] == "sent_manually"
    assert sent["target"]["manual_delivery_attested"] is True
    assert sent["target"]["delivered_by_aria"] is False
    request = session.exec(select(ProjectCommunicationRequest)).one()
    assert request.status == "sent_manually"

    with pytest.raises(HTTPException) as missing_evidence:
        transition_project_question_remediation_execution(
            session,
            project_id=int(project.id),
            execution_id=int(execution.id),
            actor_user_id=int(owner.id),
            action="complete",
            expected_revision=2,
            note="对方已回复。",
        )
    assert missing_evidence.value.status_code == 409

    attached = attach_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        expected_revision=2,
        idempotency_key="communication-evidence-key-0001",
        evidence_kind="manual_note",
        title="客户回复记录",
        note="项目负责人核对了客户回复，原始邮件仍需人工复核。",
    )
    retried = attach_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        expected_revision=2,
        idempotency_key="communication-evidence-key-0001",
        evidence_kind="manual_note",
        title="客户回复记录",
        note="项目负责人核对了客户回复，原始邮件仍需人工复核。",
    )
    assert attached["revision"] == 3
    assert retried["revision"] == 3
    assert len(session.exec(select(ProjectQuestionRemediationEvidenceAttachment)).all()) == 1

    completed = transition_project_question_remediation_execution(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        action="complete",
        expected_revision=3,
        note="人工确认此沟通跟进已完成。",
    )
    assert completed["status"] == "completed"
    assert completed["question_resolution_status"] == "open"
    assert session.exec(select(ProjectQuestionResolution)).all() == []
    session.refresh(request)
    assert request.status == "completed"
    events = session.exec(
        select(ProjectQuestionRemediationExecutionEvent).order_by(
            ProjectQuestionRemediationExecutionEvent.revision
        )
    ).all()
    assert [(item.action, item.revision) for item in events] == [
        ("created", 1),
        ("marked_sent", 2),
        ("evidence_attached", 3),
        ("completed", 4),
    ]


def test_todo_completion_is_evidence_governed_and_generic_bypass_is_rejected() -> None:
    session, owner, _, project, _ = _seed()
    _confirm(
        session,
        owner,
        project,
        target_kind="project_todo",
        key="execution-todo-key-0001",
    )
    execution = _execution(session)
    todo = session.exec(select(ProjectTodo)).one()

    with pytest.raises(HTTPException) as update_error:
        update_project_todo(
            session,
            int(project.id),
            int(todo.id),
            {"is_done": True},
        )
    assert update_error.value.status_code == 409
    with pytest.raises(HTTPException) as delete_error:
        delete_project_todo(session, int(project.id), int(todo.id))
    assert delete_error.value.status_code == 409

    project_file = ProjectFile(
        project_id=int(project.id),
        name="客户签字确认.pdf",
        file_type="pdf",
        path="project/confirmation.pdf",
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    attached = attach_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        expected_revision=1,
        idempotency_key="todo-evidence-key-0001",
        evidence_kind="project_file",
        project_file_id=int(project_file.id),
        note="项目成员核对了签字页。",
    )
    assert attached["evidence"][0]["support_level"] == "direct"

    completed = transition_project_question_remediation_execution(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        action="complete",
        expected_revision=2,
        note="签字文件已归档并完成人工核验。",
    )
    assert completed["status"] == "completed"
    session.refresh(todo)
    session.refresh(project)
    assert todo.is_done is True
    assert project.memory_stale is True
    assert session.exec(select(ProjectQuestionResolution)).all() == []


def test_communication_cancellation_is_retained_and_accepts_no_new_evidence() -> None:
    session, owner, _, project, _ = _seed()
    _confirm(
        session,
        owner,
        project,
        target_kind="communication_request",
        key="execution-cancel-key-0001",
    )
    execution = _execution(session)

    cancelled = transition_project_question_remediation_execution(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        action="cancel",
        expected_revision=1,
        note="客户已通过其他正式流程确认，不再发送此草稿。",
    )
    retried = transition_project_question_remediation_execution(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        action="cancel",
        expected_revision=1,
        note="重试取消。",
    )
    assert cancelled["status"] == retried["status"] == "cancelled"
    assert cancelled["allowed_actions"] == []
    request = session.exec(select(ProjectCommunicationRequest)).one()
    assert request.status == "cancelled"
    with pytest.raises(HTTPException) as evidence_error:
        attach_project_question_remediation_evidence(
            session,
            project_id=int(project.id),
            execution_id=int(execution.id),
            actor_user_id=int(owner.id),
            expected_revision=2,
            idempotency_key="cancelled-evidence-key-0001",
            evidence_kind="manual_note",
            note="不应写入。",
        )
    assert evidence_error.value.status_code == 409


def test_evidence_references_are_project_scoped_and_feed_the_question_chain() -> None:
    session, owner, _, project, other_project = _seed()
    _confirm(
        session,
        owner,
        project,
        target_kind="project_todo",
        key="execution-scope-key-0001",
    )
    execution = _execution(session)
    foreign_file = ProjectFile(
        project_id=int(other_project.id),
        name="其他项目.pdf",
        file_type="pdf",
        path="other/file.pdf",
    )
    own_file = ProjectFile(
        project_id=int(project.id),
        name="本项目证据.pdf",
        file_type="pdf",
        path="project/evidence.pdf",
    )
    session.add(foreign_file)
    session.add(own_file)
    session.commit()
    session.refresh(foreign_file)
    session.refresh(own_file)

    with pytest.raises(HTTPException) as scope_error:
        attach_project_question_remediation_evidence(
            session,
            project_id=int(project.id),
            execution_id=int(execution.id),
            actor_user_id=int(owner.id),
            expected_revision=1,
            idempotency_key="foreign-evidence-key-0001",
            evidence_kind="project_file",
            project_file_id=int(foreign_file.id),
        )
    assert scope_error.value.status_code == 409

    attach_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        expected_revision=1,
        idempotency_key="scoped-evidence-key-0001",
        evidence_kind="project_file",
        project_file_id=int(own_file.id),
        note="限定在当前项目。",
    )
    bundle, source_map = _current_attached_question_evidence(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
    )
    assert bundle["source_count"] == 1
    assert bundle["supporting_source_count"] == 1
    assert bundle["sources"][0]["project_file_id"] == own_file.id
    assert next(iter(source_map))[0] == "remediation_attachment"


def test_execution_center_route_denies_viewers_before_domain_service(monkeypatch) -> None:
    session, _, viewer, project, _ = _seed()
    called = False

    def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("domain service must not run")

    monkeypatch.setattr(
        "app.routers.projects_questions.list_project_question_remediation_executions",
        should_not_run,
    )
    with pytest.raises(HTTPException) as error:
        get_project_question_remediation_executions(
            project_id=int(project.id),
            status="",
            limit=100,
            session=session,
            current_user=viewer,
        )
    assert error.value.status_code == 403
    assert called is False


def test_review_required_evidence_is_adjudicated_without_becoming_truth_or_memory() -> None:
    session, owner, _, project, _ = _seed()
    _confirm(
        session,
        owner,
        project,
        target_kind="project_todo",
        key="execution-review-key-0001",
    )
    execution = _execution(session)
    memory_stale_before = project.memory_stale
    attached = attach_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        expected_revision=1,
        idempotency_key="review-required-key-0001",
        evidence_kind="manual_note",
        title="负责人核验记录",
        note="已对照客户邮件，仍需项目成员裁决。",
    )
    attachment = session.exec(select(ProjectQuestionRemediationEvidenceAttachment)).one()
    assert attached["evidence"][0]["review"]["status"] == "pending"
    assert attached["evidence"][0]["review"]["revision"] == 0
    assert attached["evidence_review_contract"] == (
        build_remediation_evidence_review_contract()
    )

    accepted = review_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        attachment_id=int(attachment.id),
        actor_user_id=int(owner.id),
        decision="accepted",
        expected_revision=0,
        reason="已人工核对原始邮件与当前项目范围。",
    )
    retried = review_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        attachment_id=int(attachment.id),
        actor_user_id=int(owner.id),
        decision="accepted",
        expected_revision=0,
        reason="已人工核对原始邮件与当前项目范围。",
    )
    assert accepted["status"] == retried["status"] == "accepted"
    assert accepted["revision"] == retried["revision"] == 1
    assert accepted["human_judgment_only"] is True
    assert accepted["acceptance_is_truth_verdict"] is False
    assert len(session.exec(select(ProjectQuestionRemediationEvidenceReview)).all()) == 1
    assert len(session.exec(select(ProjectQuestionRemediationEvidenceReviewEvent)).all()) == 1

    bundle, _ = _current_attached_question_evidence(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
    )
    assert bundle["supporting_source_count"] == 1
    assert bundle["sources"][0]["review_status"] == "accepted"
    assert bundle["sources"][0]["acceptance_is_truth_verdict"] is False
    session.refresh(project)
    session.refresh(execution)
    assert project.memory_stale is memory_stale_before
    assert execution.revision == 2
    assert session.exec(select(ProjectQuestionResolution)).all() == []

    with pytest.raises(HTTPException) as stale:
        review_project_question_remediation_evidence(
            session,
            project_id=int(project.id),
            execution_id=int(execution.id),
            attachment_id=int(attachment.id),
            actor_user_id=int(owner.id),
            decision="rejected",
            expected_revision=0,
            reason="裁决已被其他成员更新。",
        )
    assert stale.value.status_code == 409
    rejected = review_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        attachment_id=int(attachment.id),
        actor_user_id=int(owner.id),
        decision="rejected",
        expected_revision=1,
        reason="附件缺少可追溯的发送时间。",
    )
    assert rejected["status"] == "rejected"
    assert rejected["revision"] == 2
    assert [item["status"] for item in rejected["history"]] == [
        "rejected",
        "accepted",
    ]
    bundle, _ = _current_attached_question_evidence(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
    )
    assert bundle["supporting_source_count"] == 0
    assert bundle["sources"][0]["review_reason"] == "附件缺少可追溯的发送时间。"


def test_direct_evidence_cannot_be_reviewed_and_review_route_denies_viewer(
    monkeypatch,
) -> None:
    session, owner, viewer, project, _ = _seed()
    _confirm(
        session,
        owner,
        project,
        target_kind="project_todo",
        key="execution-direct-review-key-0001",
    )
    execution = _execution(session)
    project_file = ProjectFile(
        project_id=int(project.id),
        name="权威项目文件.pdf",
        file_type="pdf",
        path="project/authoritative.pdf",
    )
    session.add(project_file)
    session.commit()
    session.refresh(project_file)
    attached = attach_project_question_remediation_evidence(
        session,
        project_id=int(project.id),
        execution_id=int(execution.id),
        actor_user_id=int(owner.id),
        expected_revision=1,
        idempotency_key="direct-review-key-0001",
        evidence_kind="project_file",
        project_file_id=int(project_file.id),
    )
    attachment = session.exec(select(ProjectQuestionRemediationEvidenceAttachment)).one()
    assert attached["evidence"][0]["review"]["status"] == "not_required"
    with pytest.raises(HTTPException) as not_required:
        review_project_question_remediation_evidence(
            session,
            project_id=int(project.id),
            execution_id=int(execution.id),
            attachment_id=int(attachment.id),
            actor_user_id=int(owner.id),
            decision="accepted",
            expected_revision=0,
            reason="不应对直接项目来源创建裁决。",
        )
    assert not_required.value.status_code == 409

    called = False

    def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("domain service must not run")

    monkeypatch.setattr(
        "app.routers.projects_questions.review_project_question_remediation_evidence",
        should_not_run,
    )
    with pytest.raises(HTTPException) as denied:
        review_project_question_remediation_execution_evidence(
            project_id=int(project.id),
            execution_id=int(execution.id),
            attachment_id=int(attachment.id),
            body=ReviewProjectQuestionRemediationEvidenceRequest(
                decision="accepted",
                expected_revision=0,
                reason="viewer must not adjudicate",
            ),
            session=session,
            current_user=viewer,
        )
    assert denied.value.status_code == 403
    assert called is False
