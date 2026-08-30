from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import ClientRecord, DocumentChunk, KnowledgeDocument, Project
from app.services import rag as rag_module
from app.services.agent_harness.knowledge_evidence import (
    build_knowledge_evidence_manifest,
    build_knowledge_evidence_prompt,
    knowledge_evidence_reference,
    normalize_legacy_references,
    resolve_knowledge_citations,
    validate_knowledge_evidence_manifest,
)
from app.services.chat.state import ChatSessionState


def _results():
    return [
        SimpleNamespace(
            content="The client approved a phased rollout.",
            document_name="Steering notes.md",
            document_id=7,
            chunk_index=2,
            score=0.94,
        ),
        SimpleNamespace(
            content="Budget is capped at two million.",
            document_name="Commercial proposal.pdf",
            document_id=9,
            chunk_index=0,
            score=0.88,
        ),
    ]


def test_manifest_is_stable_bounded_and_never_persists_retrieved_text() -> None:
    results = _results()
    first = build_knowledge_evidence_manifest(
        results,
        knowledge_scope="project",
        project_id=12,
    )
    second = build_knowledge_evidence_manifest(
        results,
        knowledge_scope="project",
        project_id=12,
    )

    assert first == second
    assert [entry["citation_key"] for entry in first["entries"]] == ["K1", "K2"]
    assert first["entries"][0]["evidence_id"].startswith("evidence_")
    assert first["entries"][0]["content_sha256"]
    serialized = json.dumps(first, ensure_ascii=False)
    assert "phased rollout" not in serialized
    assert "two million" not in serialized
    assert validate_knowledge_evidence_manifest(first) == (True, "")


def test_prompt_contains_exact_evidence_keys_and_untrusted_data_boundary() -> None:
    results = _results()
    manifest = build_knowledge_evidence_manifest(results)

    prompt = build_knowledge_evidence_prompt(results, manifest)

    assert "[K1] Source: Steering notes.md" in prompt
    assert "[K2] Source: Commercial proposal.pdf" in prompt
    assert "The client approved a phased rollout." in prompt
    assert "untrusted source data" in prompt


def test_citation_resolution_keeps_only_valid_cited_sources() -> None:
    manifest = build_knowledge_evidence_manifest(_results())

    resolved, references = resolve_knowledge_citations(
        manifest,
        "The rollout is phased [K1], but [K99] is unsupported.",
    )

    assert resolved["status"] == "partial"
    assert resolved["invalid_citation_keys"] == ["K99"]
    assert resolved["cited_evidence_ids"] == [manifest["entries"][0]["evidence_id"]]
    assert references == [
        {
            "schema_version": 1,
            "type": "doc",
            "id": 7,
            "title": "Steering notes.md",
            "evidence_id": manifest["entries"][0]["evidence_id"],
            "citation_key": "K1",
            "chunk_index": 2,
            "score": 0.94,
            "content_sha256": manifest["entries"][0]["content_sha256"],
        }
    ]
    assert knowledge_evidence_reference(resolved)["cited_count"] == 1


def test_uncited_evidence_is_explicit_and_tampering_fails_validation() -> None:
    manifest = build_knowledge_evidence_manifest(_results())
    resolved, references = resolve_knowledge_citations(manifest, "No citation here.")
    assert resolved["status"] == "uncited"
    assert references == []

    manifest["entries"][0]["title"] = "Tampered title"
    valid, reason = validate_knowledge_evidence_manifest(manifest)
    assert valid is False
    assert "digest mismatch" in reason


def test_legacy_reference_normalization_drops_content_and_invalid_items() -> None:
    references = normalize_legacy_references(
        [
            {
                "document_id": 3,
                "document_name": "Legacy.pdf",
                "content": "private retrieved text",
                "score": 0.9,
            },
            {"type": "file", "id": "bad", "title": "ignored"},
        ]
    )

    assert references == [{"type": "doc", "id": 3, "title": "Legacy.pdf"}]
    assert "private retrieved text" not in json.dumps(references)


def test_artifact_output_keeps_a_safe_evidence_manifest_reference() -> None:
    manifest = build_knowledge_evidence_manifest(_results())
    state = ChatSessionState(
        run_id="run_evidence_artifact",
        knowledge_evidence=manifest,
    )

    state.record_artifact_output(
        {"name": "grounded.md", "file_type": "md", "path": "generated/grounded.md"},
        source_tool="write_project_markdown_document",
        tool_use_id="call-grounded",
    )

    evidence_ref = state.run_outputs[0]["knowledge_evidence"]
    assert evidence_ref["manifest_id"] == manifest["manifest_id"]
    assert evidence_ref["evidence_count"] == 2
    assert "phased rollout" not in json.dumps(state.run_outputs)


def test_explicit_document_ids_are_filtered_by_accessible_projects() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        allowed_client = ClientRecord(name="Acme")
        denied_client = ClientRecord(name="Other")
        session.add(allowed_client)
        session.add(denied_client)
        session.flush()
        allowed_project = Project(
            name="Allowed",
            client="Acme",
            client_id=allowed_client.id,
        )
        denied_project = Project(
            name="Denied",
            client="Other",
            client_id=denied_client.id,
        )
        session.add(allowed_project)
        session.add(denied_project)
        session.commit()
        session.refresh(allowed_project)
        session.refresh(denied_project)
        session.refresh(allowed_client)
        session.refresh(denied_client)
        documents = [
            KnowledgeDocument(
                name="allowed-project.md",
                file_type="md",
                path="allowed-project.md",
                project_id=allowed_project.id,
            ),
            KnowledgeDocument(
                name="denied-project.md",
                file_type="md",
                path="denied-project.md",
                project_id=denied_project.id,
            ),
            KnowledgeDocument(
                name="allowed-client.md",
                file_type="md",
                path="allowed-client.md",
                client_id=allowed_client.id,
            ),
            KnowledgeDocument(
                name="denied-client.md",
                file_type="md",
                path="denied-client.md",
                client_id=denied_client.id,
            ),
        ]
        session.add_all(documents)
        session.commit()
        for document in documents:
            session.refresh(document)
            session.add(
                DocumentChunk(
                    document_id=document.id,
                    chunk_index=0,
                    content=document.name,
                    embedding_json="[1.0, 0.0]",
                )
            )
        session.commit()

        with patch.object(rag_module, "embed_texts", return_value=[[1.0, 0.0]]):
            result = rag_module.retrieve_structured(
                "project",
                session,
                doc_ids=[document.id for document in documents],
                accessible_project_ids=[allowed_project.id],
            )

    assert {item.document_name for item in result.results} == {
        "allowed-project.md",
        "allowed-client.md",
    }
    engine.dispose()
