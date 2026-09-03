from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ArtifactAcceptanceReview,
    ArtifactAcceptanceReviewEvent,
    Conversation,
    GeneratedFile,
    User,
)
from app.services.agent_harness.artifact_acceptance import (
    artifact_acceptance_projection,
    build_artifact_acceptance_contract,
    default_deliverable_business_verifiers,
    registered_artifact_business_verifiers,
    review_artifact_acceptance,
    run_registered_artifact_business_verifiers,
)
from app.services.agent_harness.artifact_verification import (
    persist_artifact_verification,
)


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _artifact(
    session: Session,
    path: Path,
    *,
    runtime: dict | None = None,
) -> tuple[GeneratedFile, int]:
    user = User(
        email=f"review-{path.name}@example.com",
        password_hash="x",
        display_name="Reviewer",
    )
    session.add(user)
    session.flush()
    conversation = Conversation(owner_user_id=user.id, title="acceptance")
    session.add(conversation)
    session.flush()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    artifact = GeneratedFile(
        conversation_id=int(conversation.id),
        name=path.name,
        file_type=path.suffix.lstrip("."),
        path=f"generated/{path.name}",
        size_bytes=path.stat().st_size,
        run_id="run_acceptance",
        output_id="out_acceptance",
        content_sha256=digest,
    )
    session.add(artifact)
    session.flush()
    persist_artifact_verification(
        session,
        artifact,
        path,
        skill_runtime_contract=runtime,
    )
    session.commit()
    session.refresh(artifact)
    return artifact, int(user.id)


def test_business_verifier_registry_is_declarative_and_fail_closed() -> None:
    registry = registered_artifact_business_verifiers()
    manifest = {item["verifier_id"]: item for item in registry["items"]}

    assert registry["execution_boundary"] == "aria_owned_declarative_rules_only"
    assert registry["skill_package_code_executable"] is False
    assert manifest["min_slide_count"]["metric"] == "slide_count"

    result = run_registered_artifact_business_verifiers(
        {"metrics": {"slide_count": 12}},
        [
            {"verifier_id": "min_slide_count", "expected_min": 10},
            {"verifier_id": "run_skill_script", "expected_min": 1},
        ],
    )
    assert result["status"] == "partial"
    assert result["passed_count"] == 1
    assert result["skipped_count"] == 1
    assert result["checks"][1]["code"] == "verifier_not_registered"

    requirements = default_deliverable_business_verifiers(["pptx", "pdf"])
    format_specific = run_registered_artifact_business_verifiers(
        {"metrics": {"slide_count": 6}},
        requirements,
        file_type="pptx",
    )
    assert format_specific["status"] == "passed"
    assert format_specific["check_count"] == 1
    assert format_specific["not_applicable_count"] == 1


def test_acceptance_contract_keeps_human_signoff_bounded() -> None:
    contract = build_artifact_acceptance_contract()

    assert contract["failed_or_partial_evidence_can_be_accepted"] is False
    assert contract["human_judgment_only"] is True
    assert contract["acceptance_is_truth_verdict"] is False
    assert contract["executes_skill_package_code"] is False
    assert contract["events_are_append_only"] is True


def test_manual_acceptance_uses_cas_and_append_only_history(tmp_path: Path) -> None:
    engine = _engine()
    path = tmp_path / "delivery.txt"
    path.write_text("client-ready delivery", encoding="utf-8")
    runtime = {
        "verification_status": "available",
        "verification_context_complete": True,
        "verification_step_count": 3,
        "verification_plan_sha256": "a" * 64,
        "release_sha256": "b" * 64,
    }

    with Session(engine) as session:
        artifact, user_id = _artifact(session, path, runtime=runtime)
        pending = artifact_acceptance_projection(session, artifact)

        assert pending["review_status"] == "pending"
        assert pending["delivery_status"] == "review_required"
        assert pending["final_delivery_allowed"] is False
        assert pending["revision"] == 0

        accepted = review_artifact_acceptance(
            session,
            artifact=artifact,
            actor_user_id=user_id,
            decision="accepted",
            expected_revision=0,
            reason="已逐项核对客户口径、金额和结论。",
        )
        assert accepted["review_status"] == "accepted"
        assert accepted["delivery_status"] == "ready"
        assert accepted["final_delivery_allowed"] is True
        assert accepted["revision"] == 1

        idempotent = review_artifact_acceptance(
            session,
            artifact=artifact,
            actor_user_id=user_id,
            decision="accepted",
            expected_revision=0,
            reason="已逐项核对客户口径、金额和结论。",
        )
        assert idempotent["revision"] == 1

        rejected = review_artifact_acceptance(
            session,
            artifact=artifact,
            actor_user_id=user_id,
            decision="rejected",
            expected_revision=1,
            reason="客户名称仍需修订。",
        )
        assert rejected["review_status"] == "rejected"
        assert rejected["delivery_status"] == "changes_required"
        assert rejected["final_delivery_allowed"] is False
        assert rejected["revision"] == 2
        assert [item["revision"] for item in rejected["history"]] == [2, 1]

        assert len(session.exec(select(ArtifactAcceptanceReview)).all()) == 1
        assert len(session.exec(select(ArtifactAcceptanceReviewEvent)).all()) == 2
        with pytest.raises(HTTPException) as conflict:
            review_artifact_acceptance(
                session,
                artifact=artifact,
                actor_user_id=user_id,
                decision="accepted",
                expected_revision=1,
                reason="使用过期 revision 重试。",
            )
        assert conflict.value.status_code == 409
    engine.dispose()


def test_failed_or_partial_verification_cannot_be_human_overridden(
    tmp_path: Path,
) -> None:
    engine = _engine()
    path = tmp_path / "broken.json"
    path.write_text('{"unfinished":', encoding="utf-8")

    with Session(engine) as session:
        artifact, user_id = _artifact(session, path)
        projection = artifact_acceptance_projection(session, artifact)
        assert projection["delivery_status"] == "blocked"
        assert projection["allowed_decisions"] == []
        with pytest.raises(HTTPException) as blocked:
            review_artifact_acceptance(
                session,
                artifact=artifact,
                actor_user_id=user_id,
                decision="accepted",
                expected_revision=0,
                reason="人工不能覆盖技术失败。",
            )
        assert blocked.value.status_code == 409
    engine.dispose()


def test_technical_pass_without_skill_checklist_is_ready_without_review(
    tmp_path: Path,
) -> None:
    engine = _engine()
    path = tmp_path / "plain.txt"
    path.write_text("ready", encoding="utf-8")

    with Session(engine) as session:
        artifact, user_id = _artifact(session, path)
        projection = artifact_acceptance_projection(session, artifact)
        assert projection["review_status"] == "not_required"
        assert projection["delivery_status"] == "ready"
        with pytest.raises(HTTPException) as unnecessary:
            review_artifact_acceptance(
                session,
                artifact=artifact,
                actor_user_id=user_id,
                decision="accepted",
                expected_revision=0,
                reason="无需人工验收。",
            )
        assert unnecessary.value.status_code == 409
    engine.dispose()


def test_structural_business_rules_gate_the_exact_generated_file(
    tmp_path: Path,
) -> None:
    engine = _engine()
    path = tmp_path / "structured.md"
    path.write_text("# Finding\n\nEvidence line\n", encoding="utf-8")

    with Session(engine) as session:
        artifact, _ = _artifact(session, path)
        artifact.deliverable_business_verifiers_json = (
            '[{"expected_min":3,"verifier_id":"min_line_count"}]'
        )
        session.add(artifact)
        session.commit()
        passed = artifact_acceptance_projection(session, artifact)
        assert passed["business_automation"]["status"] == "passed"
        assert passed["final_delivery_allowed"] is True

        artifact.deliverable_business_verifiers_json = (
            '[{"expected_min":4,"verifier_id":"min_line_count"}]'
        )
        session.add(artifact)
        session.commit()
        blocked = artifact_acceptance_projection(session, artifact)
        assert blocked["business_automation"]["status"] == "failed"
        assert blocked["delivery_status"] == "blocked"
        assert blocked["final_delivery_allowed"] is False
    engine.dispose()
