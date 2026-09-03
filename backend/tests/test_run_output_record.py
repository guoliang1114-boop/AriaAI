from __future__ import annotations

from pathlib import Path

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ArtifactVerification,
    Conversation,
    GeneratedFile,
    Project,
    ProjectFile,
    User,
)
from app.services.agent_harness.run_output_record import (
    RunOutputStatus,
    build_artifact_output_record,
    validate_run_output_record,
)
from app.services.chat_store import persist_run_artifacts


def _sqlite_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _seed_conversation(engine) -> int:
    with Session(engine) as session:
        user = User(email="output@example.com", password_hash="x", display_name="Output")
        session.add(user)
        session.commit()
        session.refresh(user)
        conversation = Conversation(owner_user_id=user.id, title="output test")
        session.add(conversation)
        session.commit()
        session.refresh(conversation)
        return int(conversation.id)


def test_artifact_output_record_is_stable_and_excludes_raw_path() -> None:
    artifact = {
        "name": "deck.pptx",
        "file_type": "pptx",
        "path": "projects/7/secret/deck.pptx",
        "description": "raw business detail",
    }
    first = build_artifact_output_record(
        artifact,
        run_id="run_output_1",
        source_tool="generate_ppt_from_skill",
        tool_use_id="call-1",
    )
    second = build_artifact_output_record(
        artifact,
        run_id="run_output_1",
        source_tool="generate_ppt_from_skill",
        tool_use_id="call-1",
    )

    assert first == second
    assert first["status"] == "produced"
    assert "secret/deck" not in str(first)
    assert "raw business detail" not in str(first)
    assert validate_run_output_record(first) == (True, "")


def test_invalid_artifact_shape_is_preserved_as_valid_failed_record() -> None:
    record = build_artifact_output_record(
        {"name": "", "file_type": "pdf", "path": "generated/missing.pdf"},
        run_id="run_output_invalid",
    )

    assert record["status"] == "failed"
    assert record["failure"]["code"] == "ARTIFACT_SCHEMA_INVALID"
    assert validate_run_output_record(record) == (True, "")


def test_persist_run_artifacts_requires_real_file_and_records_digest(tmp_path, monkeypatch) -> None:
    engine = _sqlite_engine()
    conversation_id = _seed_conversation(engine)
    uploads = tmp_path / "uploads"
    artifact_path = uploads / "generated" / "deck.pptx"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_bytes(b"real ppt bytes")
    monkeypatch.setattr("app.services.chat_store.UPLOADS_DIR", uploads)

    artifact = {
        "name": "deck.pptx",
        "file_type": "pptx",
        "path": "generated/deck.pptx",
        "source_tool": "generate_ppt_from_skill",
        "tool_use_id": "call-1",
    }
    record = build_artifact_output_record(
        artifact,
        run_id="run_output_2",
        source_tool=artifact["source_tool"],
        tool_use_id=artifact["tool_use_id"],
    )
    artifact["output_id"] = record["output_id"]
    batch = persist_run_artifacts(
        engine,
        conversation_id,
        [artifact],
        run_id="run_output_2",
        run_outputs=[record],
    )

    assert batch.failures == []
    assert batch.artifacts[0]["path"] == "generated/deck.pptx"
    assert batch.artifacts[0]["persistence_status"] == "persisted"
    assert len(batch.artifacts[0]["content_sha256"]) == 64
    assert batch.artifacts[0]["verification"]["status"] == "failed"
    assert batch.run_outputs[0]["status"] == RunOutputStatus.PERSISTED.value
    with Session(engine) as session:
        saved = session.exec(select(GeneratedFile)).one()
        assert saved.run_id == "run_output_2"
        assert saved.output_id == record["output_id"]
        assert saved.source_tool == "generate_ppt_from_skill"
        assert saved.size_bytes == len(b"real ppt bytes")
        assert saved.content_sha256 == batch.artifacts[0]["content_sha256"]
        verification = session.exec(select(ArtifactVerification)).one()
        assert verification.generated_file_id == saved.id
        assert verification.status == "failed"
    engine.dispose()


def test_persist_run_artifacts_fails_closed_for_missing_or_escaped_file(tmp_path, monkeypatch) -> None:
    engine = _sqlite_engine()
    conversation_id = _seed_conversation(engine)
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"outside")
    monkeypatch.setattr("app.services.chat_store.UPLOADS_DIR", uploads)

    missing = {"name": "missing.pdf", "file_type": "pdf", "path": "generated/missing.pdf"}
    escaped = {"name": "outside.pdf", "file_type": "pdf", "path": str(outside)}
    batch = persist_run_artifacts(
        engine,
        conversation_id,
        [missing, escaped],
        run_id="run_output_3",
    )

    assert batch.artifacts == []
    assert {item["failure"]["code"] for item in batch.failures} == {
        "ARTIFACT_FILE_MISSING",
        "ARTIFACT_PATH_UNSAFE",
    }
    assert all(item["status"] == "failed" for item in batch.run_outputs)
    with Session(engine) as session:
        assert session.exec(select(GeneratedFile)).all() == []
    engine.dispose()


def test_persist_run_artifacts_rejects_mismatched_project_file_evidence(tmp_path, monkeypatch) -> None:
    engine = _sqlite_engine()
    conversation_id = _seed_conversation(engine)
    uploads = tmp_path / "uploads"
    artifact_path = uploads / "projects" / "1" / "evidence.pdf"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_bytes(b"evidence")
    monkeypatch.setattr("app.services.chat_store.UPLOADS_DIR", uploads)

    with Session(engine) as session:
        source_project = Project(name="Source", client="Acme")
        other_project = Project(name="Other", client="Acme")
        session.add(source_project)
        session.add(other_project)
        session.commit()
        session.refresh(source_project)
        session.refresh(other_project)
        project_file = ProjectFile(
            project_id=source_project.id,
            name="evidence.pdf",
            file_type="pdf",
            path="projects/1/evidence.pdf",
        )
        session.add(project_file)
        session.commit()
        session.refresh(project_file)
        other_project_id = int(other_project.id)
        project_file_id = int(project_file.id)

    batch = persist_run_artifacts(
        engine,
        conversation_id,
        [
            {
                "name": "evidence.pdf",
                "file_type": "pdf",
                "path": "projects/1/evidence.pdf",
                "project_file_id": project_file_id,
            }
        ],
        project_id=other_project_id,
        run_id="run_output_evidence",
    )

    assert batch.artifacts == []
    assert batch.failures[0]["failure"]["code"] == "PROJECT_FILE_EVIDENCE_MISMATCH"
    with Session(engine) as session:
        assert session.exec(select(GeneratedFile)).all() == []
    engine.dispose()


def test_persist_run_artifacts_rejects_file_type_mismatch(tmp_path, monkeypatch) -> None:
    engine = _sqlite_engine()
    conversation_id = _seed_conversation(engine)
    uploads = tmp_path / "uploads"
    path = uploads / "generated" / "report.txt"
    path.parent.mkdir(parents=True)
    path.write_text("not a pdf", encoding="utf-8")
    monkeypatch.setattr("app.services.chat_store.UPLOADS_DIR", uploads)

    batch = persist_run_artifacts(
        engine,
        conversation_id,
        [{"name": "report.pdf", "file_type": "pdf", "path": "generated/report.txt"}],
        run_id="run_output_type_mismatch",
    )

    assert batch.artifacts == []
    assert batch.failures[0]["failure"]["code"] == "ARTIFACT_TYPE_MISMATCH"
    engine.dispose()


def test_persist_run_artifacts_binds_exact_skill_deliverable(tmp_path, monkeypatch) -> None:
    engine = _sqlite_engine()
    conversation_id = _seed_conversation(engine)
    uploads = tmp_path / "uploads"
    path = uploads / "generated" / "findings.md"
    path.parent.mkdir(parents=True)
    path.write_text("# Findings\n\nEvidence-bound output.", encoding="utf-8")
    monkeypatch.setattr("app.services.chat_store.UPLOADS_DIR", uploads)
    deliverable = {
        "schema_version": 1,
        "deliverable_id": "findings-memo-1234567890",
        "name": "Findings memo",
        "formats": ["md"],
        "default_format": "md",
        "stage": "diagnosis_and_analysis",
        "save_targets": ["project_documents", "knowledge_base"],
        "requires_review": True,
        "contract_sha256": "a" * 64,
        "catalog_sha256": "b" * 64,
        "skill_release_sha256": "c" * 64,
    }

    batch = persist_run_artifacts(
        engine,
        conversation_id,
        [{"name": "findings.md", "file_type": "md", "path": "generated/findings.md"}],
        run_id="run_deliverable",
        skill_runtime_contract={"deliverable": deliverable},
    )

    assert batch.failures == []
    assert batch.artifacts[0]["deliverable"] == deliverable
    with Session(engine) as session:
        saved = session.exec(select(GeneratedFile)).one()
        assert saved.deliverable_id == deliverable["deliverable_id"]
        assert saved.deliverable_name == "Findings memo"
        assert saved.deliverable_contract_sha256 == "a" * 64
        assert saved.deliverable_catalog_sha256 == "b" * 64
        assert saved.deliverable_skill_release_sha256 == "c" * 64
    engine.dispose()
