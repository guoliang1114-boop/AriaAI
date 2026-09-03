from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ArtifactVerification, Conversation, GeneratedFile, User
from app.services.agent_harness.artifact_verification import (
    artifact_verification_evidence_payload,
    build_artifact_verification_evidence,
    persist_artifact_verification,
)
from app.services.artifact_intent import ArtifactContract
from app.services.chat.persist import _delivery_satisfied
from app.services.chat.state import ChatSessionState
from app.services.chat_store import persist_run_artifacts


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_text_artifact_passes_bounded_technical_verification(tmp_path: Path) -> None:
    path = tmp_path / "report.md"
    path.write_text("# Verified report\n\nA deterministic artifact.\n", encoding="utf-8")

    evidence = build_artifact_verification_evidence(
        path,
        file_type="md",
        expected_content_sha256=_sha256(path),
    )

    assert evidence["status"] == "passed"
    assert evidence["technical_status"] == "passed"
    assert evidence["skill_status"] == "not_declared"
    assert evidence["automated_failed_count"] == 0
    assert evidence["metrics"]["line_count"] == 3
    assert len(evidence["evidence_sha256"]) == 64
    assert str(path) not in json.dumps(evidence)
    assert "Verified report" not in json.dumps(evidence)


def test_invalid_json_fails_format_integrity(tmp_path: Path) -> None:
    path = tmp_path / "report.json"
    path.write_text('{"unfinished":', encoding="utf-8")

    evidence = build_artifact_verification_evidence(
        path,
        file_type="json",
        expected_content_sha256=_sha256(path),
    )

    assert evidence["status"] == "failed"
    assert evidence["technical_status"] == "failed"
    assert any(
        check.get("code") == "invalid_json" for check in evidence["checks"]
    )


def test_openxml_verification_parses_each_declared_slide(tmp_path: Path) -> None:
    valid_path = tmp_path / "valid.pptx"
    with zipfile.ZipFile(valid_path, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("ppt/presentation.xml", "<presentation />")
        archive.writestr("ppt/slides/slide1.xml", "<slide />")
    valid = build_artifact_verification_evidence(
        valid_path,
        file_type="pptx",
        expected_content_sha256=_sha256(valid_path),
    )

    broken_path = tmp_path / "broken.pptx"
    with zipfile.ZipFile(broken_path, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("ppt/presentation.xml", "<presentation />")
        archive.writestr("ppt/slides/slide1.xml", "<broken")
    broken = build_artifact_verification_evidence(
        broken_path,
        file_type="pptx",
        expected_content_sha256=_sha256(broken_path),
    )

    assert valid["status"] == "passed"
    assert valid["metrics"] == {"slide_count": 1}
    assert broken["status"] == "failed"
    assert any(
        check.get("code") == "invalid_openxml_package"
        for check in broken["checks"]
    )


def test_skill_checklist_is_bound_but_never_claimed_as_automated(tmp_path: Path) -> None:
    path = tmp_path / "delivery.txt"
    path.write_text("ready", encoding="utf-8")
    plan_sha = "a" * 64

    evidence = build_artifact_verification_evidence(
        path,
        file_type="txt",
        expected_content_sha256=_sha256(path),
        skill_runtime_contract={
            "verification_status": "available",
            "verification_context_complete": True,
            "verification_step_count": 4,
            "verification_plan_sha256": plan_sha,
            "release_sha256": "b" * 64,
        },
    )

    assert evidence["technical_status"] == "passed"
    assert evidence["status"] == "manual_required"
    assert evidence["skill_status"] == "manual_required"
    assert evidence["skill_check_count"] == 4
    assert evidence["verification_plan_sha256"] == plan_sha
    assert evidence["skill_release_sha256"] == "b" * 64
    assert evidence["automated_check_count"] == 5


def test_compacted_skill_checklist_yields_partial_verification(tmp_path: Path) -> None:
    path = tmp_path / "delivery.txt"
    path.write_text("ready", encoding="utf-8")

    evidence = build_artifact_verification_evidence(
        path,
        file_type="txt",
        expected_content_sha256=_sha256(path),
        skill_runtime_contract={
            "verification_status": "available",
            "verification_context_complete": False,
            "verification_step_count": 2,
        },
    )

    assert evidence["technical_status"] == "passed"
    assert evidence["status"] == "partial"
    assert evidence["skill_status"] == "context_incomplete"


def test_failed_verification_cannot_satisfy_delivery_contract() -> None:
    state = ChatSessionState(
        artifacts=[
            {
                "name": "broken.pdf",
                "file_type": "pdf",
                "persistence_status": "persisted",
                "verification": {"status": "failed"},
            }
        ],
        tool_call_events=[
            {
                "status": "completed",
                "artifact": {"name": "broken.pdf", "file_type": "pdf"},
            }
        ],
    )
    contract = ArtifactContract(delivery_required=True, output_kind="pdf")

    assert _delivery_satisfied(state, contract) is False


def test_persistence_is_idempotent_and_exposes_content_free_evidence(tmp_path: Path) -> None:
    engine = _engine()
    path = tmp_path / "delivery.txt"
    path.write_text("persisted bytes", encoding="utf-8")
    digest = _sha256(path)

    with Session(engine) as session:
        user = User(email="verify@example.com", password_hash="x", display_name="Verify")
        session.add(user)
        session.flush()
        conversation = Conversation(owner_user_id=user.id, title="verification")
        session.add(conversation)
        session.flush()
        artifact = GeneratedFile(
            conversation_id=int(conversation.id),
            name="delivery.txt",
            file_type="txt",
            path="generated/delivery.txt",
            size_bytes=path.stat().st_size,
            run_id="run_verify",
            output_id="out_verify",
            content_sha256=digest,
        )
        session.add(artifact)
        session.flush()

        first = persist_artifact_verification(session, artifact, path)
        second = persist_artifact_verification(session, artifact, path)
        session.commit()

        records = session.exec(select(ArtifactVerification)).all()
        assert len(records) == 1
        assert first == second
        payload = artifact_verification_evidence_payload(records[0])
        assert payload["verification_id"] == records[0].id
        assert payload["status"] == "passed"
        assert payload["checks"]
        serialized = json.dumps(payload)
        assert str(path) not in serialized
        assert "persisted bytes" not in serialized
        records[0].evidence_json = "{}"
        session.add(records[0])
        session.commit()
        assert artifact_verification_evidence_payload(records[0]) == {}
    engine.dispose()


def test_chat_artifact_persistence_binds_skill_release_and_plan(
    tmp_path: Path,
    monkeypatch,
) -> None:
    engine = _engine()
    uploads = tmp_path / "uploads"
    path = uploads / "generated" / "delivery.txt"
    path.parent.mkdir(parents=True)
    path.write_text("complete delivery", encoding="utf-8")
    monkeypatch.setattr("app.services.chat_store.UPLOADS_DIR", uploads)

    with Session(engine) as session:
        user = User(
            email="chat-verify@example.com",
            password_hash="x",
            display_name="Verify",
        )
        session.add(user)
        session.flush()
        conversation = Conversation(owner_user_id=user.id, title="verification")
        session.add(conversation)
        session.commit()
        conversation_id = int(conversation.id)

    batch = persist_run_artifacts(
        engine,
        conversation_id,
        [
            {
                "name": "delivery.txt",
                "file_type": "txt",
                "path": "generated/delivery.txt",
            }
        ],
        run_id="run_skill_delivery",
        skill_runtime_contract={
            "release_sha256": "c" * 64,
            "verification_status": "available",
            "verification_context_complete": True,
            "verification_step_count": 2,
            "verification_plan_sha256": "d" * 64,
        },
    )

    verification = batch.artifacts[0]["verification"]
    assert verification["status"] == "manual_required"
    assert verification["skill_release_sha256"] == "c" * 64
    assert verification["verification_plan_sha256"] == "d" * 64
    with Session(engine) as session:
        saved = session.exec(select(ArtifactVerification)).one()
        assert saved.skill_release_sha256 == "c" * 64
        assert saved.skill_check_count == 2
    engine.dispose()
