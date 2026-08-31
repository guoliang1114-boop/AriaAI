from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    Project,
    ProjectCommunicationRequest,
    ProjectMember,
    ProjectQuestionRemediationPromotion,
    ProjectQuestionRemediationPromotionEvent,
    ProjectTodo,
    User,
)
from app.routers.projects_questions import (
    PrepareProjectQuestionRemediationPromotionRequest,
    prepare_project_question_remediation,
)
from app.services.project_question_remediation_promotions import (
    build_remediation_promotion_contract,
    confirm_project_question_remediation_promotion,
    list_project_question_remediation_promotions,
    prepare_project_question_remediation_promotion,
    reject_project_question_remediation_promotion,
)
from app.services.project_question_resolutions import project_question_sha256
from app.services.time_utils import utc_now_naive


QUESTION = "客户是否确认了最终验收范围？"
BASIS = "b" * 64
SOURCE_ACTION_ID = "remediation_01"


def _session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed() -> tuple[Session, User, User, User, Project]:
    session = _session()
    owner = User(email="promotion-owner@example.com", password_hash="x")
    assignee = User(email="promotion-assignee@example.com", password_hash="x")
    outsider = User(email="promotion-outsider@example.com", password_hash="x")
    project = Project(name="Promotion", client="Acme")
    session.add(owner)
    session.add(assignee)
    session.add(outsider)
    session.add(project)
    session.flush()
    session.add(
        ProjectMember(project_id=int(project.id), user_id=int(owner.id), role="owner")
    )
    session.add(
        ProjectMember(project_id=int(project.id), user_id=int(assignee.id), role="editor")
    )
    session.commit()
    for row in (owner, assignee, outsider, project):
        session.refresh(row)
    return session, owner, assignee, outsider, project


def _plan(basis: str = BASIS, *, action_kind: str = "evidence_request") -> dict:
    return {
        "basis": {"fingerprint": basis},
        "actions": [
            {
                "action_id": SOURCE_ACTION_ID,
                "kind": action_kind,
            }
        ],
    }


def _prepare(
    session: Session,
    owner: User,
    project: Project,
    *,
    key: str = "promotion-key-0001",
    target_kind: str = "project_todo",
    title: str = "收集书面验收证据",
    draft: str = "请收集客户签字文件。",
    owner_user_id: int | None = None,
    recipient_label: str = "客户项目负责人",
) -> dict:
    return prepare_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        actor_user_id=int(owner.id),
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
        evidence_basis_fingerprint=BASIS,
        idempotency_key=key,
        target_kind=target_kind,
        action_kind="evidence_request",
        source_action_id=SOURCE_ACTION_ID,
        title=title,
        draft=draft,
        owner_user_id=owner_user_id,
        due_date="2026-09-15",
        recipient_label=recipient_label,
    )


@pytest.fixture(autouse=True)
def _stable_plan(monkeypatch):
    monkeypatch.setattr(
        "app.services.project_question_remediation_promotions.build_project_question_remediation_plan",
        lambda *_args, **_kwargs: _plan(),
    )


def test_prepare_persists_only_frozen_preview_and_audit() -> None:
    session, owner, assignee, _, project = _seed()

    payload = _prepare(
        session,
        owner,
        project,
        owner_user_id=int(assignee.id),
    )

    assert payload["status"] == "pending"
    assert payload["revision"] == 1
    assert payload["target"] is None
    assert payload["preview"]["owner_user_id"] == assignee.id
    assert payload["contract"] == build_remediation_promotion_contract("project_todo")
    assert session.exec(select(ProjectTodo)).all() == []
    assert session.exec(select(ProjectCommunicationRequest)).all() == []
    events = session.exec(select(ProjectQuestionRemediationPromotionEvent)).all()
    assert [(event.action, event.status, event.revision) for event in events] == [
        ("prepared", "pending", 1)
    ]
    row = session.exec(select(ProjectQuestionRemediationPromotion)).one()
    assert row.idempotency_key_sha256 != "promotion-key-0001"
    assert len(row.idempotency_key_sha256) == 64


def test_confirm_creates_one_native_todo_and_retry_is_idempotent() -> None:
    session, owner, assignee, _, project = _seed()
    prepared = _prepare(
        session,
        owner,
        project,
        owner_user_id=int(assignee.id),
    )

    confirmed = confirm_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=prepared["id"],
        actor_user_id=int(owner.id),
        snapshot_sha256=prepared["snapshot_sha256"],
        expected_revision=prepared["revision"],
    )
    retried = confirm_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=prepared["id"],
        actor_user_id=int(owner.id),
        snapshot_sha256=prepared["snapshot_sha256"],
        expected_revision=prepared["revision"],
    )

    todos = session.exec(select(ProjectTodo)).all()
    assert len(todos) == 1
    assert todos[0].assigned_to_user_id == assignee.id
    assert todos[0].due_date == "2026-09-15"
    assert confirmed["status"] == "confirmed"
    assert confirmed["revision"] == 2
    assert confirmed["target"]["kind"] == "project_todo"
    assert retried["target"]["id"] == confirmed["target"]["id"]
    assert project.id is not None
    session.refresh(project)
    assert project.memory_stale is True


def test_confirm_communication_request_never_delivers_or_executes() -> None:
    session, owner, assignee, _, project = _seed()
    prepared = _prepare(
        session,
        owner,
        project,
        target_kind="communication_request",
        owner_user_id=int(assignee.id),
    )

    confirmed = confirm_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=prepared["id"],
        actor_user_id=int(owner.id),
        snapshot_sha256=prepared["snapshot_sha256"],
        expected_revision=1,
    )

    requests = session.exec(select(ProjectCommunicationRequest)).all()
    assert len(requests) == 1
    assert requests[0].status == "ready_for_manual_send"
    assert requests[0].delivery_mode == "manual_only"
    assert confirmed["target"]["delivered"] is False
    assert confirmed["contract"]["sends_messages"] is False
    assert confirmed["contract"]["executes_tools"] is False
    assert confirmed["contract"]["outbound_delivery"] is False
    assert session.exec(select(ProjectTodo)).all() == []


def test_exact_effect_is_deduplicated_across_confirmed_previews() -> None:
    session, owner, _, _, project = _seed()
    first = _prepare(session, owner, project, key="promotion-key-0001")
    second = _prepare(session, owner, project, key="promotion-key-0002")

    first_result = confirm_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=first["id"],
        actor_user_id=int(owner.id),
        snapshot_sha256=first["snapshot_sha256"],
        expected_revision=1,
    )
    second_result = confirm_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=second["id"],
        actor_user_id=int(owner.id),
        snapshot_sha256=second["snapshot_sha256"],
        expected_revision=1,
    )

    assert len(session.exec(select(ProjectTodo)).all()) == 1
    assert second_result["target"]["id"] == first_result["target"]["id"]
    second_row = session.get(ProjectQuestionRemediationPromotion, second["id"])
    assert second_row is not None
    assert second_row.decision_reason == "deduplicated_exact_effect"


def test_idempotency_key_reuse_with_different_preview_is_rejected() -> None:
    session, owner, _, _, project = _seed()
    first = _prepare(session, owner, project)
    retried = _prepare(session, owner, project)
    assert retried["id"] == first["id"]

    with pytest.raises(HTTPException) as error:
        _prepare(session, owner, project, title="不同的动作")
    assert error.value.status_code == 409
    assert len(session.exec(select(ProjectQuestionRemediationPromotion)).all()) == 1


def test_current_evidence_change_fails_closed_without_target(monkeypatch) -> None:
    session, owner, _, _, project = _seed()
    prepared = _prepare(session, owner, project)
    monkeypatch.setattr(
        "app.services.project_question_remediation_promotions.build_project_question_remediation_plan",
        lambda *_args, **_kwargs: _plan("c" * 64),
    )

    with pytest.raises(HTTPException) as error:
        confirm_project_question_remediation_promotion(
            session,
            project_id=int(project.id),
            question_sha256=project_question_sha256(QUESTION),
            promotion_id=prepared["id"],
            actor_user_id=int(owner.id),
            snapshot_sha256=prepared["snapshot_sha256"],
            expected_revision=1,
        )

    assert error.value.status_code == 409
    row = session.get(ProjectQuestionRemediationPromotion, prepared["id"])
    assert row is not None
    assert row.status == "failed"
    assert row.failure_code == "evidence_basis_changed"
    assert session.exec(select(ProjectTodo)).all() == []
    assert session.exec(select(ProjectCommunicationRequest)).all() == []


def test_revoked_actor_and_invalid_owner_cannot_create_target() -> None:
    session, owner, assignee, outsider, project = _seed()
    with pytest.raises(HTTPException) as owner_error:
        _prepare(
            session,
            owner,
            project,
            owner_user_id=int(outsider.id),
        )
    assert owner_error.value.status_code == 409

    prepared = _prepare(
        session,
        owner,
        project,
        owner_user_id=int(assignee.id),
        key="promotion-key-0002",
    )
    membership = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == owner.id,
        )
    ).one()
    session.delete(membership)
    session.commit()

    with pytest.raises(HTTPException) as authorization_error:
        confirm_project_question_remediation_promotion(
            session,
            project_id=int(project.id),
            question_sha256=project_question_sha256(QUESTION),
            promotion_id=prepared["id"],
            actor_user_id=int(owner.id),
            snapshot_sha256=prepared["snapshot_sha256"],
            expected_revision=1,
        )
    assert authorization_error.value.status_code == 403
    assert session.exec(select(ProjectTodo)).all() == []


def test_reject_and_history_have_no_consequential_effect() -> None:
    session, owner, _, _, project = _seed()
    prepared = _prepare(session, owner, project)

    rejected = reject_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=prepared["id"],
        actor_user_id=int(owner.id),
        snapshot_sha256=prepared["snapshot_sha256"],
        expected_revision=1,
        reason="当前不需要创建",
    )
    history = list_project_question_remediation_promotions(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        actor_user_id=int(owner.id),
    )

    assert rejected["status"] == "rejected"
    assert rejected["target"] is None
    assert history["count"] == 1
    assert history["items"][0]["status"] == "rejected"
    assert history["outbound_delivery"] is False
    assert session.exec(select(ProjectTodo)).all() == []
    assert session.exec(select(ProjectCommunicationRequest)).all() == []


def test_custom_internal_action_uses_the_same_prepare_and_confirm_boundary() -> None:
    session, owner, _, _, project = _seed()
    prepared = prepare_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        actor_user_id=int(owner.id),
        question=QUESTION,
        question_sha256=project_question_sha256(QUESTION),
        evidence_basis_fingerprint=BASIS,
        idempotency_key="custom-promotion-key-0001",
        target_kind="project_todo",
        action_kind="internal_check",
        source_action_id="custom_1_bbbbbb",
        title="自定义内部核验",
        draft="复核原始验收记录。",
    )

    confirmed = confirm_project_question_remediation_promotion(
        session,
        project_id=int(project.id),
        question_sha256=project_question_sha256(QUESTION),
        promotion_id=prepared["id"],
        actor_user_id=int(owner.id),
        snapshot_sha256=prepared["snapshot_sha256"],
        expected_revision=1,
    )

    assert confirmed["status"] == "confirmed"
    assert confirmed["target"]["kind"] == "project_todo"
    assert len(session.exec(select(ProjectTodo)).all()) == 1


def test_expired_or_tampered_preview_fails_closed_without_target(monkeypatch) -> None:
    session, owner, _, _, project = _seed()
    expired = _prepare(session, owner, project, key="promotion-key-expired")
    expired_row = session.get(ProjectQuestionRemediationPromotion, expired["id"])
    assert expired_row is not None
    after_expiry = expired_row.expires_at + timedelta(seconds=1)
    monkeypatch.setattr(
        "app.services.project_question_remediation_promotions.utc_now_naive",
        lambda: after_expiry,
    )

    with pytest.raises(HTTPException) as expiry_error:
        confirm_project_question_remediation_promotion(
            session,
            project_id=int(project.id),
            question_sha256=project_question_sha256(QUESTION),
            promotion_id=expired["id"],
            actor_user_id=int(owner.id),
            snapshot_sha256=expired["snapshot_sha256"],
            expected_revision=1,
        )
    assert expiry_error.value.status_code == 409
    session.expire_all()
    assert session.get(ProjectQuestionRemediationPromotion, expired["id"]).status == "expired"

    monkeypatch.setattr(
        "app.services.project_question_remediation_promotions.utc_now_naive",
        utc_now_naive,
    )
    tampered = _prepare(session, owner, project, key="promotion-key-tampered")
    tampered_row = session.get(ProjectQuestionRemediationPromotion, tampered["id"])
    assert tampered_row is not None
    tampered_row.title = "被替换的目标"
    session.add(tampered_row)
    session.commit()
    with pytest.raises(HTTPException) as integrity_error:
        confirm_project_question_remediation_promotion(
            session,
            project_id=int(project.id),
            question_sha256=project_question_sha256(QUESTION),
            promotion_id=tampered["id"],
            actor_user_id=int(owner.id),
            snapshot_sha256=tampered["snapshot_sha256"],
            expected_revision=1,
        )
    assert integrity_error.value.status_code == 409
    session.expire_all()
    failed = session.get(ProjectQuestionRemediationPromotion, tampered["id"])
    assert failed is not None
    assert failed.status == "failed"
    assert failed.failure_code == "snapshot_integrity_invalid"
    assert session.exec(select(ProjectTodo)).all() == []


def test_prepare_route_denies_viewer_before_domain_service(monkeypatch) -> None:
    session, _, assignee, _, project = _seed()
    membership = session.exec(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == assignee.id,
        )
    ).one()
    membership.role = "viewer"
    session.add(membership)
    session.commit()
    called = False

    def should_not_run(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("domain service must not run")

    monkeypatch.setattr(
        "app.routers.projects_questions.prepare_project_question_remediation_promotion",
        should_not_run,
    )
    body = PrepareProjectQuestionRemediationPromotionRequest(
        question=QUESTION,
        evidence_basis_fingerprint=BASIS,
        idempotency_key="promotion-key-0001",
        target_kind="project_todo",
        action_kind="evidence_request",
        source_action_id=SOURCE_ACTION_ID,
        title="收集证据",
    )

    with pytest.raises(HTTPException) as error:
        prepare_project_question_remediation(
            project_id=int(project.id),
            question_sha256=project_question_sha256(QUESTION),
            body=body,
            session=session,
            current_user=assignee,
        )
    assert error.value.status_code == 403
    assert called is False
