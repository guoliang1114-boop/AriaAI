from __future__ import annotations

import json

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import ClientRecord, MemoryCandidate, MemoryCandidateAnchor, Project, User
from app.services.memory_candidate_anchors import (
    activate_memory_candidate_anchor,
    apply_memory_candidate_anchors,
    build_memory_candidate_anchor_authority_report,
    load_active_memory_candidate_anchors,
    reactivate_project_memory_candidate_anchors,
    retire_project_memory_candidate_anchors,
    strip_retired_memory_candidate_metadata,
)


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_native_candidate_anchor_lifecycle_preserves_only_active_values() -> None:
    engine = _engine()
    try:
        with Session(engine) as session:
            user = User(email="anchor-owner@example.com", password_hash="x")
            project = Project(name="Anchor project", client="Acme")
            session.add(user)
            session.add(project)
            session.flush()
            candidate = MemoryCandidate(
                owner_user_id=int(user.id or 0),
                scope="project",
                candidate_type="project_risk",
                content="  Confirmed   delivery risk ",
                content_sha256="candidate-digest",
                project_id=int(project.id or 0),
                status="accepted",
                target_slot="key_risks",
            )
            session.add(candidate)
            session.flush()

            anchor = activate_memory_candidate_anchor(
                session,
                candidate,
                actor_user_id=int(user.id or 0),
            )
            assert anchor is not None
            assert anchor.content == "Confirmed delivery risk"
            assert anchor.status == "active"
            active = load_active_memory_candidate_anchors(
                session,
                scope="project",
                entity_id=int(project.id or 0),
            )
            applied = apply_memory_candidate_anchors(
                {"key_risks": {"ai": [], "pinned": []}},
                active,
                editable_slots={"key_risks"},
            )
            assert applied["key_risks"]["pinned"] == ["Confirmed delivery risk"]

            assert retire_project_memory_candidate_anchors(
                session,
                project_id=int(project.id or 0),
                slot_key="key_risks",
                contents=("Confirmed delivery risk",),
                actor_user_id=int(user.id or 0),
                reason="confirmed_closed",
            ) == 1
            assert load_active_memory_candidate_anchors(
                session,
                scope="project",
                entity_id=int(project.id or 0),
            ) == {}
            assert reactivate_project_memory_candidate_anchors(
                session,
                project_id=int(project.id or 0),
                slot_key="key_risks",
                contents=("Confirmed delivery risk",),
                actor_user_id=int(user.id or 0),
            ) == 1
            refreshed = session.exec(select(MemoryCandidateAnchor)).one()
            assert refreshed.status == "active"
            assert refreshed.revision == 3
    finally:
        engine.dispose()


def test_anchor_authority_report_is_content_free_and_detects_residue() -> None:
    engine = _engine()
    try:
        with Session(engine) as session:
            private_content = "PRIVATE ACCEPTED MEMORY"
            user = User(email="report-owner@example.com", password_hash="x")
            project = Project(
                name="Report project",
                client="Acme",
                context_memory_json=json.dumps(
                    {
                        "_accepted_memory_candidates": {
                            "recent_progress": [private_content]
                        }
                    }
                ),
            )
            client = ClientRecord(name="Acme")
            session.add(user)
            session.add(project)
            session.add(client)
            session.flush()
            candidate = MemoryCandidate(
                owner_user_id=int(user.id or 0),
                scope="project",
                candidate_type="project_fact",
                content=private_content,
                content_sha256="candidate-digest",
                project_id=int(project.id or 0),
                status="accepted",
                target_slot="recent_progress",
            )
            session.add(candidate)
            session.flush()
            activate_memory_candidate_anchor(
                session,
                candidate,
                actor_user_id=int(user.id or 0),
            )

            report = build_memory_candidate_anchor_authority_report(
                session,
                [project],
                [client],
            )
            serialized = json.dumps(report)
            assert report["runtime_read_mode"] == "native_only"
            assert report["legacy_runtime_fallback_enabled"] is False
            assert report["anchor_count"] == 1
            assert report["missing_candidate_anchor_count"] == 0
            assert report["legacy_aggregate_entity_count"] == 1
            assert report["native_authority_ready"] is False
            assert private_content not in serialized

            project.context_memory_json = "{}"
            session.add(project)
            session.flush()
            ready = build_memory_candidate_anchor_authority_report(
                session,
                [project],
                [client],
            )
            assert ready["native_authority_ready"] is True

            session.add(
                MemoryCandidate(
                    owner_user_id=int(user.id or 0),
                    scope="project",
                    candidate_type="project_fact",
                    content="Unsupported accepted candidate",
                    content_sha256="unsupported-candidate-digest",
                    project_id=int(project.id or 0),
                    status="accepted",
                    target_slot="unknown_slot",
                )
            )
            session.flush()
            unsupported = build_memory_candidate_anchor_authority_report(
                session,
                [project],
                [client],
            )
            assert unsupported["unsupported_accepted_candidate_count"] == 1
            assert unsupported["native_authority_ready"] is False
    finally:
        engine.dispose()


def test_retired_metadata_filter_drops_valid_envelopes_but_preserves_anomalies() -> None:
    assert strip_retired_memory_candidate_metadata(
        {
            "_accepted_memory_candidates": {"recent_progress": ["Accepted"]},
            "_source_attributions": [{"source_id": "private"}],
        },
        scope="project",
    ) == {}
    malformed = {"_accepted_memory_candidates": {"unknown_slot": ["Keep"]}}
    assert strip_retired_memory_candidate_metadata(
        malformed,
        scope="project",
    ) == malformed
