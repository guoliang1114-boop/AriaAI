from __future__ import annotations

import asyncio
import hashlib
import json
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientMemoryFact,
    ClientMemorySlot,
    ClientRecord,
    ClientStakeholder,
    Project,
    ProjectFile,
    ProjectMemoryFact,
    ProjectMemorySlot,
    ProjectPayment,
    ProjectTodo,
)
from app.services.agent_harness.project_memory_evidence import build_project_memory_evidence
from app.services.client_contexts import (
    get_client_memory_payload,
    mark_client_memory_stale,
    save_client_memory,
)
from app.services.context_builder.chat_context import build_chat_context
from app.services.context_builder.memory_formatters import build_client_memory_prompt_bundle
from app.services.memory_slots import (
    CLIENT_MEMORY_SLOT_KEYS,
    PROJECT_MEMORY_SLOT_KEYS,
    get_client_memory_read_authority_report,
    get_client_memory_slot_states,
    get_project_memory_read_authority_report,
    get_project_memory_slot_states,
    load_client_memory_slot_values,
    load_client_memory_slot_view,
    load_project_memory_slot_value_views,
    load_project_memory_slot_values,
    load_project_memory_slot_view,
    project_memory_slots_for_trigger,
    summarize_memory_read_authority,
)
from app.services.memory_rebuilds import (
    MemoryPatchValidationError,
    MemoryRebuildConflict,
    begin_memory_prompt_snapshot,
    plan_client_memory_rebuild,
    plan_project_memory_rebuild,
)
from app.services.memory_facts import (
    fact_states_by_slot,
    get_client_memory_fact_states,
    get_project_memory_fact_states,
)
from app.services.project_contexts import (
    get_project_memory_payload,
    mark_project_memories_stale_by_client_id,
    mark_project_memory_stale,
    save_project_memory,
)


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_postgres_prompt_snapshot_starts_repeatable_read_transaction():
    calls: list[object] = []

    class _Dialect:
        name = "postgresql"

    class _Bind:
        dialect = _Dialect()

    class _Session:
        def rollback(self):
            calls.append("rollback")

        def expire_all(self):
            calls.append("expire_all")

        def get_bind(self):
            calls.append("get_bind")
            return _Bind()

        def connection(self, *, execution_options):
            calls.append(execution_options)

    begin_memory_prompt_snapshot(_Session())

    assert calls == [
        "rollback",
        "expire_all",
        "get_bind",
        {"isolation_level": "REPEATABLE READ"},
    ]


def _project_memory(**overrides):
    payload = {
        "project_brief": "Current project brief",
        "current_stage": "delivering",
        "current_objective": "Ship the pilot",
        "recent_progress": ["Discovery complete"],
        "key_risks": {"ai": ["Budget risk"], "pinned": []},
        "open_questions": {"ai": ["Who approves?"], "pinned": []},
        "next_actions": ["Prepare steering deck"],
        "important_documents": [{"name": "proposal.pdf", "reason": "Scope"}],
        "financial_status": "First invoice pending",
        "delivery_signals": ["Pilot on track"],
        "stakeholder_notes": {"ai": [], "pinned": []},
        "client_stakeholders": [],
    }
    payload.update(overrides)
    return payload


def _client_memory(**overrides):
    payload = {
        "client_profile": "Enterprise account",
        "decision_patterns": ["CFO approves budget"],
        "key_contacts": [],
        "structured_stakeholders": [],
        "lessons_learned": ["Pilot before scale"],
        "relationship_signals": ["Trust improving"],
        "project_history": [],
        "sensitive_topics": ["Avoid surprise scope"],
    }
    payload.update(overrides)
    return payload


def _fact_value_sha256(value):
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def test_project_memory_dual_write_versions_only_changed_slot_and_records_sources():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme", description="Pilot project")
            session.add(project)
            session.commit()
            session.refresh(project)
            session.add(
                ProjectFile(
                    project_id=project.id,
                    name="proposal.pdf",
                    file_type="pdf",
                    path="proposal.pdf",
                )
            )
            session.add(
                ProjectTodo(project_id=project.id, content="Prepare steering deck")
            )
            session.add(
                ProjectPayment(
                    project_id=project.id,
                    amount=1000,
                    payment_date="2026-08-28",
                )
            )
            session.commit()

            save_project_memory(session, project.id, _project_memory(), trigger="test")
            states = get_project_memory_slot_states(session, project.id)

            assert len(states) == len(PROJECT_MEMORY_SLOT_KEYS)
            by_key = {item["slot_key"]: item for item in states}
            assert by_key["important_documents"]["evidence_count"] == 1
            assert by_key["important_documents"]["evidence_refs"][0]["source_type"] == "project_file"
            assert by_key["financial_status"]["evidence_count"] >= 2
            assert by_key["financial_status"]["slot_version"] == 1

            save_project_memory(
                session,
                project.id,
                _project_memory(financial_status="First invoice received"),
                trigger="test_changed_financial",
            )
            rows = session.exec(
                select(ProjectMemorySlot).where(ProjectMemorySlot.project_id == project.id)
            ).all()
            versions = {row.slot_key: row.slot_version for row in rows}
            assert versions["financial_status"] == 2
            assert versions["project_brief"] == 1
            assert {row.aggregate_memory_version for row in rows} == {2}
    finally:
        engine.dispose()


def test_project_payment_change_marks_only_financial_and_risk_slots_stale():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            mark_project_memory_stale(session, project.id, trigger="payment_created")
            states = get_project_memory_slot_states(session, project.id)
            stale = {item["slot_key"] for item in states if item["status"] == "stale"}

            assert stale == {"financial_status", "key_risks"}
            financial_status = next(
                item for item in states if item["slot_key"] == "financial_status"
            )
            assert financial_status["stale_reason"] == "payment_created"
            assert financial_status["evidence_count"] == 0
            assert financial_status["evidence_refs"] == []
            assert session.get(Project, project.id).memory_stale is True
    finally:
        engine.dispose()


def test_project_combined_change_marks_union_of_affected_slots_stale():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            mark_project_memory_stale(
                session,
                project.id,
                trigger="project_status_project_financial_project_profile_changed",
            )
            states = get_project_memory_slot_states(session, project.id)
            stale = {item["slot_key"] for item in states if item["status"] == "stale"}

            assert stale == {
                "project_brief",
                "current_stage",
                "current_objective",
                "recent_progress",
                "key_risks",
                "financial_status",
                "delivery_signals",
            }
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    ("trigger", "expected_slots"),
    (
        (
            "todo_created",
            {
                "current_objective",
                "recent_progress",
                "open_questions",
                "next_actions",
                "delivery_signals",
            },
        ),
        (
            "milestone_created",
            {
                "current_stage",
                "recent_progress",
                "key_risks",
                "open_questions",
                "next_actions",
                "delivery_signals",
            },
        ),
        (
            "progress_created",
            {
                "current_objective",
                "recent_progress",
                "key_risks",
                "open_questions",
                "next_actions",
                "delivery_signals",
            },
        ),
    ),
)
def test_additive_project_sources_stale_every_dependent_slot(
    trigger: str,
    expected_slots: set[str],
):
    assert set(project_memory_slots_for_trigger(trigger)) == expected_slots


def test_project_reassignment_forces_every_memory_slot_stale():
    assert (
        project_memory_slots_for_trigger(
            "project_profile_project_reassigned_changed"
        )
        == PROJECT_MEMORY_SLOT_KEYS
    )


def test_legacy_slot_evidence_without_source_hash_remains_compatible():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Legacy pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            slot = session.exec(
                select(ProjectMemorySlot).where(
                    ProjectMemorySlot.project_id == project.id,
                    ProjectMemorySlot.slot_key == "project_brief",
                )
            ).one()
            legacy_refs = json.loads(slot.evidence_refs_json)
            for ref in legacy_refs:
                ref.pop("source_sha256", None)
            slot.evidence_refs_json = json.dumps(legacy_refs)
            session.add(slot)
            session.commit()

            state = next(
                item
                for item in get_project_memory_slot_states(session, int(project.id))
                if item["slot_key"] == "project_brief"
            )
            assert state["status"] == "ready"
            assert state["stale_reason"] == ""
            assert state["evidence_count"] == len(legacy_refs)
    finally:
        engine.dispose()


def test_slot_view_prefers_verified_slot_value_over_aggregate_json():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            project = session.get(Project, project.id)
            aggregate = get_project_memory_payload(project)
            aggregate["project_brief"] = "Tampered aggregate view"
            view, states = load_project_memory_slot_view(session, project, aggregate)

            assert view["project_brief"] == "Current project brief"
            assert states["project_brief"]["status"] == "ready"
    finally:
        engine.dispose()


def test_read_only_value_views_use_verified_slots_and_safe_fallbacks():
    engine = _engine()
    try:
        with Session(engine) as session:
            first = Project(name="First", client="Acme")
            second = Project(
                name="Second",
                client="Acme",
                context_memory_json=json.dumps(
                    {
                        "project_brief": "Aggregate-only second brief",
                        "key_risks": ["Aggregate-only second risk"],
                    }
                ),
            )
            client = ClientRecord(name="Acme")
            session.add(first)
            session.add(second)
            session.add(client)
            session.commit()
            session.refresh(first)
            session.refresh(second)
            session.refresh(client)

            save_project_memory(session, first.id, _project_memory(), trigger="test")
            save_client_memory(session, client.id, _client_memory(), trigger="test")

            first = session.get(Project, first.id)
            first_payload = get_project_memory_payload(first)
            first_payload["project_brief"] = "Divergent aggregate brief"
            first_payload["financial_status"] = "Aggregate fallback financial"
            second_payload = get_project_memory_payload(second)
            client = session.get(ClientRecord, client.id)
            client_payload = get_client_memory_payload(client)
            client_payload["client_profile"] = "Divergent aggregate profile"

            corrupt = session.exec(
                select(ProjectMemorySlot).where(
                    ProjectMemorySlot.project_id == first.id,
                    ProjectMemorySlot.slot_key == "financial_status",
                )
            ).one()
            corrupt.value_json = '"corrupt without digest update"'
            session.add(corrupt)
            session.commit()

            single = load_project_memory_slot_values(session, first, first_payload)
            statements: list[str] = []

            @event.listens_for(engine, "before_cursor_execute")
            def capture_statement(
                _connection,
                _cursor,
                statement,
                _parameters,
                _context,
                _executemany,
            ):
                statements.append(str(statement))

            batched = load_project_memory_slot_value_views(
                session,
                {
                    int(first.id): first_payload,
                    int(second.id): second_payload,
                },
            )
            client_view = load_client_memory_slot_values(
                session,
                client,
                client_payload,
            )

            assert single["project_brief"] == "Current project brief"
            assert single["financial_status"] == "Aggregate fallback financial"
            assert batched[int(first.id)] == single
            assert (
                batched[int(second.id)]["project_brief"]
                == "Aggregate-only second brief"
            )
            assert client_view["client_profile"] == "Enterprise account"
            assert sum(
                "projectmemoryslot" in statement.lower()
                for statement in statements
            ) == 1
    finally:
        engine.dispose()


def test_memory_read_authority_report_exposes_fallback_without_content():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            project = session.get(Project, project.id)
            aggregate = get_project_memory_payload(project)
            healthy = get_project_memory_read_authority_report(
                session,
                project,
                aggregate,
                slot_states=get_project_memory_slot_states(session, project.id),
            )
            assert healthy["read_mode"] == "slot_ledger"
            assert healthy["ledger_value_count"] == len(PROJECT_MEMORY_SLOT_KEYS)
            assert healthy["aggregate_fallback_slot_count"] == 0
            assert healthy["stale_slots"] == []
            assert healthy["business_slot_cutover_ready"] is True
            assert healthy["dual_write_consistent"] is True
            assert healthy["aggregate_container_retirement_ready"] is False
            assert "rebuild_log" in healthy["aggregate_only_keys"]

            operational_metadata = get_project_memory_read_authority_report(
                session,
                project,
                {
                    **aggregate,
                    "_client_promotion": {"PRIVATE": "VALUE"},
                    "_last_failure": {"PRIVATE": "VALUE"},
                },
            )
            assert operational_metadata["aggregate_only_unknown_key_count"] == 0
            assert set(operational_metadata["aggregate_only_keys"]) >= {
                "_client_promotion",
                "_last_failure",
            }
            assert "PRIVATE" not in json.dumps(operational_metadata)

            aggregate["project_brief"] = "PRIVATE TAMPERED CONTENT"
            aggregate["PRIVATE PERSON NAME"] = "PRIVATE VALUE"
            divergent = get_project_memory_read_authority_report(
                session,
                project,
                aggregate,
            )
            assert divergent["divergent_slots"] == ["project_brief"]
            assert divergent["divergent_slot_details"] == [
                {
                    "slot_key": "project_brief",
                    "ledger_value_type": "string",
                    "aggregate_value_type": "string",
                    "aggregate_version_relation": "equal",
                }
            ]
            assert divergent["dual_write_consistent"] is False
            assert divergent["aggregate_only_unknown_key_count"] == 1
            unknown_fingerprint = hashlib.sha256(
                b"aria.memory.aggregate-key.v1\0PRIVATE PERSON NAME"
            ).hexdigest()
            assert divergent["unknown_aggregate_key_profiles"] == [
                {
                    "key_sha256": unknown_fingerprint,
                    "key_length": 19,
                    "value_type": "string",
                }
            ]
            assert divergent["unknown_aggregate_key_profiles_truncated"] is False
            assert "PRIVATE" not in json.dumps(divergent)

            missing_row = session.exec(
                select(ProjectMemorySlot).where(
                    ProjectMemorySlot.project_id == project.id,
                    ProjectMemorySlot.slot_key == "key_risks",
                )
            ).one()
            session.delete(missing_row)
            corrupt_row = session.exec(
                select(ProjectMemorySlot).where(
                    ProjectMemorySlot.project_id == project.id,
                    ProjectMemorySlot.slot_key == "financial_status",
                )
            ).one()
            corrupt_row.value_json = '"tampered"'
            session.add(corrupt_row)
            session.commit()

            degraded = get_project_memory_read_authority_report(
                session,
                project,
                get_project_memory_payload(project),
            )
            assert degraded["read_mode"] == "hybrid_aggregate_fallback"
            assert degraded["missing_slots"] == ["key_risks"]
            assert degraded["corrupt_slots"] == ["financial_status"]
            assert degraded["aggregate_fallback_slots"] == [
                "key_risks",
                "financial_status",
            ]
            assert degraded["business_slot_cutover_ready"] is False

            fleet = summarize_memory_read_authority([healthy, degraded])
            assert fleet["entity_count"] == 2
            assert fleet["slot_ledger_entity_count"] == 1
            assert fleet["hybrid_fallback_entity_count"] == 1
            assert fleet["business_slot_cutover_ready_rate"] == 0.5
            assert fleet["aggregate_fallback_slot_count"] == 2
            assert fleet["aggregate_fallback_slots_by_key"] == {
                "financial_status": 1,
                "key_risks": 1,
            }
            assert fleet["missing_slot_count"] == 1
            assert fleet["missing_slots_by_key"] == {"key_risks": 1}
            assert fleet["corrupt_slot_count"] == 1
            assert fleet["corrupt_slots_by_key"] == {"financial_status": 1}
            assert fleet["safe_aggregate_only_keys_by_key"]["rebuild_log"] == 2
            stale_fleet = summarize_memory_read_authority(
                [
                    {
                        **healthy,
                        "stale_slot_count": 1,
                        "stale_slots": ["next_actions"],
                    }
                ]
            )
            assert stale_fleet["stale_slot_count"] == 1
            assert stale_fleet["stale_slots_by_key"] == {"next_actions": 1}
            divergent_fleet = summarize_memory_read_authority([divergent])
            assert divergent_fleet["divergent_slots_by_key"] == {
                "project_brief": 1
            }
            assert divergent_fleet["divergence_profiles"] == [
                {
                    "slot_key": "project_brief",
                    "ledger_value_type": "string",
                    "aggregate_value_type": "string",
                    "aggregate_version_relation": "equal",
                    "count": 1,
                }
            ]
            assert divergent_fleet["unknown_aggregate_key_profiles"] == [
                {
                    "key_sha256": unknown_fingerprint,
                    "key_length": 19,
                    "value_type": "string",
                    "count": 1,
                }
            ]
            assert (
                divergent_fleet["unknown_aggregate_key_profiles_truncated"] is False
            )
    finally:
        engine.dispose()


def test_unknown_aggregate_key_profiles_are_bounded_and_content_free():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            project = session.get(Project, project.id)
            aggregate = {
                **get_project_memory_payload(project),
                **{f"PRIVATE KEY {index}": index for index in range(70)},
            }
            report = get_project_memory_read_authority_report(
                session,
                project,
                aggregate,
            )
            fleet = summarize_memory_read_authority([report])

            assert report["aggregate_only_unknown_key_count"] == 70
            assert len(report["unknown_aggregate_key_profiles"]) == 64
            assert report["unknown_aggregate_key_profiles_truncated"] is True
            assert len(fleet["unknown_aggregate_key_profiles"]) == 64
            assert fleet["unknown_aggregate_key_profiles_truncated"] is True
            assert "PRIVATE" not in json.dumps(report)
            assert "PRIVATE" not in json.dumps(fleet)

            profiles = [
                {
                    "key_sha256": hashlib.sha256(
                        f"aria.memory.aggregate-key.v1\0fleet-key-{index}".encode()
                    ).hexdigest(),
                    "key_length": len(f"fleet-key-{index}"),
                    "value_type": "number",
                }
                for index in range(192)
            ]
            wide_fleet = summarize_memory_read_authority(
                [
                    {
                        "aggregate_only_unknown_key_count": len(chunk),
                        "unknown_aggregate_key_profiles": chunk,
                    }
                    for chunk in (
                        profiles[:64],
                        profiles[64:128],
                        profiles[128:],
                    )
                ]
            )
            assert len(wide_fleet["unknown_aggregate_key_profiles"]) == 128
            assert wide_fleet["unknown_aggregate_key_profiles_truncated"] is True
    finally:
        engine.dispose()


def test_client_read_authority_classifies_only_client_scoped_metadata():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            save_client_memory(session, client.id, _client_memory(), trigger="test")

            client = session.get(ClientRecord, client.id)
            aggregate = {
                **get_client_memory_payload(client),
                "_last_failure": {"PRIVATE": "VALUE"},
                "_client_promotion": {"PRIVATE": "VALUE"},
            }
            report = get_client_memory_read_authority_report(
                session,
                client,
                aggregate,
            )

            assert "_last_failure" in report["aggregate_only_keys"]
            assert "_client_promotion" not in report["aggregate_only_keys"]
            assert report["aggregate_only_unknown_key_count"] == 1
            assert report["unknown_aggregate_key_profiles"] == [
                {
                    "key_sha256": hashlib.sha256(
                        b"aria.memory.aggregate-key.v1\0_client_promotion"
                    ).hexdigest(),
                    "key_length": 17,
                    "value_type": "object",
                }
            ]
            assert report["unknown_aggregate_key_profiles_truncated"] is False
            assert "PRIVATE" not in json.dumps(report)
    finally:
        engine.dispose()


def test_client_memory_read_authority_report_uses_all_expected_slots():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            save_client_memory(session, client.id, _client_memory(), trigger="test")

            client = session.get(ClientRecord, client.id)
            report = get_client_memory_read_authority_report(
                session,
                client,
                get_client_memory_payload(client),
                slot_states=get_client_memory_slot_states(session, client.id),
            )

            assert report["read_mode"] == "slot_ledger"
            assert report["expected_slot_count"] == len(CLIENT_MEMORY_SLOT_KEYS)
            assert report["ledger_value_count"] == len(CLIENT_MEMORY_SLOT_KEYS)
            assert report["dual_write_consistent"] is True
            assert report["aggregate_container_retirement_ready"] is False
    finally:
        engine.dispose()


def test_corrupt_or_missing_slot_is_not_silently_treated_as_fresh():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            financial_row = session.exec(
                select(ProjectMemorySlot).where(
                    ProjectMemorySlot.project_id == project.id,
                    ProjectMemorySlot.slot_key == "financial_status",
                )
            ).one()
            financial_row.value_json = '"tampered without matching digest"'
            session.add(financial_row)
            missing_row = session.exec(
                select(ProjectMemorySlot).where(
                    ProjectMemorySlot.project_id == project.id,
                    ProjectMemorySlot.slot_key == "key_risks",
                )
            ).one()
            session.delete(missing_row)
            session.commit()

            project = session.get(Project, project.id)
            memory, states = load_project_memory_slot_view(
                session,
                project,
                get_project_memory_payload(project),
            )
            bundle = build_project_memory_evidence(
                project,
                "What are the payment and budget risks?",
                memory_payload=memory,
                slot_states=states,
            )

            assert states["financial_status"]["status"] == "corrupt"
            assert set(bundle["selection"]["stale_slots"]) == {
                "financial_status",
                "key_risks",
            }
            assert bundle["manifest"]["memory_stale"] is True
    finally:
        engine.dispose()


def test_client_memory_dual_write_has_independent_slots_and_project_provenance():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            project = Project(name="Earlier pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)

            save_client_memory(
                session,
                client.id,
                _client_memory(),
                trigger="test",
                source_project_ids=[project.id],
            )
            states = get_client_memory_slot_states(session, client.id)

            assert len(states) == len(CLIENT_MEMORY_SLOT_KEYS)
            by_key = {item["slot_key"]: item for item in states}
            assert by_key["decision_patterns"]["status"] == "ready"
            assert {
                ref["source_type"]
                for ref in by_key["decision_patterns"]["evidence_refs"]
            } >= {"client", "project"}
            assert session.exec(
                select(ClientMemorySlot).where(ClientMemorySlot.client_id == client.id)
            ).all()
    finally:
        engine.dispose()


def test_retrieval_degrades_only_when_selected_project_slots_are_stale():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")
            mark_project_memory_stale(session, project.id, trigger="payment_created")

            project = session.get(Project, project.id)
            memory, states = load_project_memory_slot_view(
                session,
                project,
                get_project_memory_payload(project),
            )
            financial = build_project_memory_evidence(
                project,
                "项目回款风险是什么？",
                memory_payload=memory,
                slot_states=states,
            )
            documents = build_project_memory_evidence(
                project,
                "应该查看哪些项目文件？",
                memory_payload=memory,
                slot_states=states,
            )

            assert set(financial["selection"]["stale_slots"]) == {
                "financial_status",
                "key_risks",
            }
            assert financial["manifest"]["memory_stale"] is True
            assert documents["selection"]["stale_slots"] == []
            assert documents["manifest"]["memory_stale"] is False
    finally:
        engine.dispose()


def test_client_retrieval_uses_fresh_selected_slots_when_other_slots_are_stale():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            save_client_memory(session, client.id, _client_memory(), trigger="test")
            mark_client_memory_stale(session, client.id, trigger="stakeholder_updated")

            client = session.get(ClientRecord, client.id)
            memory, states = load_client_memory_slot_view(
                session,
                client,
                get_client_memory_payload(client),
            )
            lessons = build_client_memory_prompt_bundle(
                client,
                "What lessons did we learn from this client?",
                memory_payload=memory,
                slot_states=states,
            )
            relationship = build_client_memory_prompt_bundle(
                client,
                "Summarize current relationship",
                memory_payload=memory,
                slot_states=states,
            )

            assert lessons["selection"]["status"] == "ready"
            assert lessons["selection"]["stale_slots"] == []
            assert relationship["selection"]["status"] == "stale"
            assert "relationship_signals" in relationship["selection"]["stale_slots"]
    finally:
        engine.dispose()


def test_chat_context_receipt_uses_selected_slot_freshness_not_parent_flag():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")
            mark_project_memory_stale(session, project.id, trigger="payment_created")

            document_context = build_chat_context(
                session,
                project_id=project.id,
                knowledge_scope="project",
                content="应该查看哪些项目文件？",
            )
            financial_context = build_chat_context(
                session,
                project_id=project.id,
                knowledge_scope="project",
                content="项目回款风险是什么？",
            )

            assert document_context.context_receipt["memory"]["status"] == "ready"
            assert document_context.context_receipt["memory"]["stale_slots"] == []
            assert financial_context.context_receipt["memory"]["status"] == "stale"
            assert set(financial_context.context_receipt["memory"]["stale_slots"]) == {
                "financial_status",
                "key_risks",
            }
    finally:
        engine.dispose()


def test_project_memory_facts_keep_stable_identity_and_retire_removed_value():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            session.add(
                ProjectFile(
                    project_id=project.id,
                    name="proposal.pdf",
                    file_type="pdf",
                    path="proposal.pdf",
                )
            )
            session.commit()

            save_project_memory(session, project.id, _project_memory(), trigger="test")
            first = get_project_memory_fact_states(session, project.id)
            proposal = next(
                fact
                for fact in first
                if fact["slot_key"] == "important_documents"
            )
            assert proposal["provenance_status"] == "matched"
            assert proposal["evidence_refs"][0]["relation"] == "label_match"
            assert proposal["first_seen_memory_version"] == 1
            assert proposal["last_seen_memory_version"] == 1

            save_project_memory(
                session,
                project.id,
                _project_memory(next_actions=["Send final steering deck"]),
                trigger="test_changed_action",
            )
            active = get_project_memory_fact_states(session, project.id)
            proposal_again = next(
                fact
                for fact in active
                if fact["slot_key"] == "important_documents"
            )
            all_facts = get_project_memory_fact_states(
                session,
                project.id,
                include_retired=True,
            )

            assert proposal_again["fact_key"] == proposal["fact_key"]
            assert proposal_again["first_seen_memory_version"] == 1
            assert proposal_again["last_seen_memory_version"] == 2
            assert any(
                fact["slot_key"] == "next_actions"
                and fact["status"] == "retired"
                and fact["value_preview"] == "Prepare steering deck"
                for fact in all_facts
            )
            assert len(session.exec(select(ProjectMemoryFact)).all()) > len(active)
    finally:
        engine.dispose()


def test_fact_staleness_and_integrity_are_independent_per_project_slot():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            mark_project_memory_stale(session, project.id, trigger="payment_created")
            states = get_project_memory_fact_states(session, project.id)
            stale_slots = {fact["slot_key"] for fact in states if fact["status"] == "stale"}
            assert stale_slots == {"financial_status", "key_risks"}

            row = session.exec(
                select(ProjectMemoryFact).where(
                    ProjectMemoryFact.project_id == project.id,
                    ProjectMemoryFact.slot_key == "important_documents",
                )
            ).one()
            row.value_json = '"tampered without matching digest"'
            session.add(row)
            session.commit()

            corrupted = get_project_memory_fact_states(session, project.id)
            document = next(
                fact for fact in corrupted if fact["slot_key"] == "important_documents"
            )
            assert document["status"] == "corrupt"
            assert document["value_preview"] == ""
    finally:
        engine.dispose()


def test_client_fact_provenance_matches_structured_stakeholder_source():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            session.add(
                ClientStakeholder(
                    client_id=client.id,
                    name="Alice Chen",
                    role="CFO",
                )
            )
            session.commit()
            memory = _client_memory(
                structured_stakeholders=[
                    {"name": "Alice Chen", "role": "CFO", "concerns": "ROI"}
                ]
            )

            save_client_memory(session, client.id, memory, trigger="test")
            facts = get_client_memory_fact_states(session, client.id)
            stakeholder = next(
                fact
                for fact in facts
                if fact["slot_key"] == "structured_stakeholders"
            )
            assert stakeholder["provenance_status"] == "direct"
            assert stakeholder["evidence_refs"][0]["source_type"] == "client_stakeholder"
            assert stakeholder["evidence_refs"][0]["relation"] == "direct_source_id"
            assert session.exec(select(ClientMemoryFact)).all()
    finally:
        engine.dispose()


def test_question_context_exposes_fact_identity_and_honest_provenance_counts():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            session.add(
                ProjectFile(
                    project_id=project.id,
                    name="proposal.pdf",
                    file_type="pdf",
                    path="proposal.pdf",
                )
            )
            session.commit()
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            context = build_chat_context(
                session,
                project_id=project.id,
                knowledge_scope="project",
                content="应该查看哪些项目文件？",
            )
            memory = context.context_receipt["memory"]
            manifest = context.project_memory_evidence_manifest
            entry = next(
                item
                for item in manifest["entries"]
                if item["slot"] == "important_documents"
            )

            assert entry["memory_fact_key"].startswith("pmf_")
            assert entry["provenance_status"] == "matched"
            assert entry["fact_status"] == "ready"
            assert entry["fact_evidence_count"] == 1
            assert memory["matched_fact_count"] >= 1
            assert "[PROVENANCE:MATCHED]" in context.project_context
    finally:
        engine.dispose()


def test_project_memory_evidence_preserves_direct_source_id_provenance():
    project = Project(
        id=42,
        name="Pilot",
        client="Acme",
        memory_version=3,
        memory_stale=False,
    )
    bundle = build_project_memory_evidence(
        project,
        "Which project files should I review?",
        memory_payload=_project_memory(),
        fact_states={
            "important_documents": {
                0: {
                    "fact_key": "pmf_0123456789abcdef01234567",
                    "status": "ready",
                    "provenance_status": "direct",
                    "evidence_count": 1,
                }
            }
        },
    )

    document = next(
        entry
        for entry in bundle["manifest"]["entries"]
        if entry["slot"] == "important_documents"
    )
    assert document["provenance_status"] == "direct"
    assert bundle["selection"]["direct_fact_count"] == 1
    assert bundle["selection"]["matched_fact_count"] == 0
    assert "DIRECT means the fact is bound to a verified stable source ID" in bundle["prompt"]
    assert "[PROVENANCE:DIRECT]" in bundle["prompt"]


def test_project_memory_evidence_matches_fact_identity_after_filtered_items_and_hides_stale_direct():
    project = Project(
        id=42,
        name="Pilot",
        client="Acme",
        memory_version=3,
        memory_stale=False,
    )
    hidden = {"name": "", "reason": "", "metadata": "retained fact"}
    ready = {"name": "ready.pdf", "reason": "Current scope"}
    stale = {"name": "stale.pdf", "reason": "Superseded scope"}
    bundle = build_project_memory_evidence(
        project,
        "Which project files should I review?",
        memory_payload=_project_memory(
            important_documents=[hidden, ready, stale],
        ),
        fact_states={
            "important_documents": {
                0: {
                    "fact_key": "pmf_0123456789abcdef01234567",
                    "source_kind": "item",
                    "value_sha256": _fact_value_sha256(hidden),
                    "status": "ready",
                    "provenance_status": "matched",
                    "evidence_count": 1,
                },
                1: {
                    "fact_key": "pmf_1123456789abcdef01234567",
                    "source_kind": "item",
                    "value_sha256": _fact_value_sha256(ready),
                    "status": "ready",
                    "provenance_status": "direct",
                    "evidence_count": 1,
                },
                2: {
                    "fact_key": "pmf_2123456789abcdef01234567",
                    "source_kind": "item",
                    "value_sha256": _fact_value_sha256(stale),
                    "status": "stale",
                    "provenance_status": "direct",
                    "evidence_count": 1,
                },
            }
        },
    )

    documents = [
        entry
        for entry in bundle["manifest"]["entries"]
        if entry["slot"] == "important_documents"
    ]
    assert [entry["provenance_status"] for entry in documents] == [
        "direct",
        "unresolved",
    ]
    assert documents[1]["fact_status"] == "stale"
    assert documents[1]["fact_evidence_count"] == 0
    assert bundle["selection"]["direct_fact_count"] == 1
    assert "[PROVENANCE:DIRECT] [" in bundle["prompt"]
    assert "[PROVENANCE:UNRESOLVED]" in bundle["prompt"]


def test_client_prompt_bundle_reports_fact_level_provenance():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            session.add(ClientStakeholder(client_id=client.id, name="Alice Chen", role="CFO"))
            session.commit()
            save_client_memory(
                session,
                client.id,
                _client_memory(
                    structured_stakeholders=[{"name": "Alice Chen", "role": "CFO"}]
                ),
                trigger="test",
            )
            client = session.get(ClientRecord, client.id)
            memory, slots = load_client_memory_slot_view(
                session,
                client,
                get_client_memory_payload(client),
            )
            bundle = build_client_memory_prompt_bundle(
                client,
                "Who are the client stakeholders?",
                force=True,
                memory_payload=memory,
                slot_states=slots,
                fact_states=fact_states_by_slot(
                    get_client_memory_fact_states(session, client.id)
                ),
            )

            assert bundle["selection"]["direct_fact_count"] >= 1
            assert bundle["selection"]["evidence_ref_count"] >= 1
            assert "[PROVENANCE:DIRECT]" in bundle["prompt"]
    finally:
        engine.dispose()


def test_client_prompt_bundle_preserves_direct_source_id_provenance():
    client = ClientRecord(
        id=43,
        name="Acme",
        client_memory_version=2,
        client_memory_stale=False,
    )
    bundle = build_client_memory_prompt_bundle(
        client,
        "Who are the client stakeholders?",
        force=True,
        memory_payload=_client_memory(
            structured_stakeholders=[{"name": "Alice Chen", "role": "CFO"}]
        ),
        fact_states={
            "structured_stakeholders": {
                0: {
                    "status": "ready",
                    "provenance_status": "direct",
                    "evidence_count": 1,
                }
            }
        },
    )

    assert bundle["selection"]["direct_fact_count"] == 1
    assert bundle["selection"]["matched_fact_count"] == 0
    assert "DIRECT is a verified stable source-ID link" in bundle["prompt"]
    assert "[PROVENANCE:DIRECT]" in bundle["prompt"]


def test_client_prompt_bundle_matches_duplicate_facts_by_value_not_display_ordinal():
    client = ClientRecord(
        id=43,
        name="Acme",
        client_memory_version=2,
        client_memory_stale=False,
    )
    bundle = build_client_memory_prompt_bundle(
        client,
        "How does the client make decisions?",
        force=True,
        memory_payload=_client_memory(decision_patterns=["Alpha", "Alpha", "Beta"]),
        fact_states={
            "decision_patterns": {
                0: {
                    "source_kind": "item",
                    "value_sha256": _fact_value_sha256("Alpha"),
                    "status": "ready",
                    "provenance_status": "unresolved",
                    "evidence_count": 0,
                },
                1: {
                    "source_kind": "item",
                    "value_sha256": _fact_value_sha256("Beta"),
                    "status": "ready",
                    "provenance_status": "direct",
                    "evidence_count": 1,
                },
            }
        },
    )

    assert "[PROVENANCE:DIRECT]: Beta" in bundle["prompt"]
    assert "[PROVENANCE:DIRECT]: Alpha" not in bundle["prompt"]
    assert bundle["selection"]["direct_fact_count"] == 1
    assert bundle["selection"]["unresolved_fact_count"] >= 2


def test_memory_rebuild_planner_selects_stale_subset_and_preserves_canonical_order():
    project_states = [
        {
            "slot_key": key,
            "slot_version": 1,
            "status": "stale" if key in {"key_risks", "financial_status"} else "ready",
            "value_sha256": key,
            "stale_at": "2026-08-28" if key in {"key_risks", "financial_status"} else None,
            "updated_at": "2026-08-27",
        }
        for key in PROJECT_MEMORY_SLOT_KEYS
    ]
    plan = plan_project_memory_rebuild(
        memory_version=3,
        parent_stale=True,
        trigger="payment_created",
        slot_states=project_states,
    )
    manual = plan_project_memory_rebuild(
        memory_version=3,
        parent_stale=True,
        trigger="manual",
        slot_states=project_states,
    )

    assert plan.mode == "partial"
    assert plan.slot_keys == ("key_risks", "financial_status")
    assert manual.mode == "full"
    assert manual.slot_keys == PROJECT_MEMORY_SLOT_KEYS


def test_client_rebuild_planner_selects_stakeholder_slots():
    stale = {
        "decision_patterns",
        "key_contacts",
        "structured_stakeholders",
        "relationship_signals",
        "sensitive_topics",
    }
    states = [
        {
            "slot_key": key,
            "slot_version": 1,
            "status": "stale" if key in stale else "ready",
            "value_sha256": key,
            "stale_at": "2026-08-28" if key in stale else None,
            "updated_at": "2026-08-27",
        }
        for key in CLIENT_MEMORY_SLOT_KEYS
    ]

    plan = plan_client_memory_rebuild(
        memory_version=2,
        parent_stale=True,
        trigger="stakeholder_updated",
        slot_states=states,
    )

    assert plan.mode == "partial"
    assert set(plan.slot_keys) == stale


def test_stakeholder_change_stales_only_stably_linked_project_scope():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.flush()
            matching = [
                Project(name="Pilot", client="Acme", client_id=client.id),
                Project(name="Rollout", client="  ACME  ", client_id=client.id),
            ]
            unrelated = Project(name="Other", client="Globex")
            same_name_unlinked = Project(name="Unlinked", client="Acme")
            session.add_all([*matching, unrelated, same_name_unlinked])
            session.commit()
            for project in [*matching, unrelated, same_name_unlinked]:
                session.refresh(project)
                save_project_memory(
                    session,
                    int(project.id or 0),
                    _project_memory(),
                    trigger="test",
                )

            mark_project_memories_stale_by_client_id(
                session,
                int(client.id),
                trigger="stakeholder_updated",
            )

            for project in matching:
                refreshed = session.get(Project, project.id)
                assert refreshed.memory_stale is True
                states = {
                    state["slot_key"]: state["status"]
                    for state in get_project_memory_slot_states(session, project.id)
                }
                assert states["stakeholder_notes"] == "stale"
                assert states["client_stakeholders"] == "stale"
                assert states["project_brief"] == "ready"
            assert session.get(Project, unrelated.id).memory_stale is False
            assert session.get(Project, same_name_unlinked.id).memory_stale is False
    finally:
        engine.dispose()


def test_project_partial_rebuild_updates_only_selected_slots_and_facts():
    from app.routers import projects_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")
            original_states = {
                state["slot_key"]: state
                for state in get_project_memory_slot_states(session, project.id)
            }
            original_document_fact = next(
                fact
                for fact in get_project_memory_fact_states(session, project.id)
                if fact["slot_key"] == "important_documents"
            )
            mark_project_memory_stale(session, project.id, trigger="payment_created")

            response = json.dumps(
                {
                    "key_risks": ["Invoice overdue"],
                    "financial_status": "Invoice overdue by 7 days",
                }
            )
            mocked = AsyncMock(return_value=response)
            with patch.object(projects_deps, "complete_with_selected_model", mocked):
                memory = asyncio.run(
                    projects_deps._rebuild_project_memory(
                        session,
                        project.id,
                        trigger="payment_created",
                        trusted_system=True,
                    )
                )

            states = {
                state["slot_key"]: state
                for state in get_project_memory_slot_states(session, project.id)
            }
            document_fact = next(
                fact
                for fact in get_project_memory_fact_states(session, project.id)
                if fact["slot_key"] == "important_documents"
            )
            prompt = mocked.await_args.kwargs["messages"][0]["content"]

            assert mocked.await_count == 1
            assert "financial_status" in prompt
            assert "important_documents" not in prompt.split("Project data:", 1)[0]
            assert "Uploaded files" not in prompt
            assert states["financial_status"]["aggregate_memory_version"] == 2
            assert states["important_documents"]["aggregate_memory_version"] == 1
            assert states["important_documents"]["slot_version"] == original_states["important_documents"]["slot_version"]
            assert document_fact["fact_key"] == original_document_fact["fact_key"]
            assert document_fact["last_seen_memory_version"] == 1
            assert memory["rebuild_log"][-1]["mode"] == "partial"
            assert memory["rebuild_log"][-1]["rebuilt_slots"] == [
                "key_risks",
                "financial_status",
            ]
            assert session.get(Project, project.id).memory_stale is False
    finally:
        engine.dispose()


def test_project_partial_rebuild_uses_full_fallback_for_invalid_patch():
    from app.routers import projects_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")
            mark_project_memory_stale(session, project.id, trigger="payment_created")
            full_payload = _project_memory(financial_status="Paid")
            mocked = AsyncMock(
                side_effect=[
                    '{"financial_status":"Paid"}',
                    json.dumps(full_payload),
                ]
            )

            with patch.object(projects_deps, "complete_with_selected_model", mocked):
                memory = asyncio.run(
                    projects_deps._rebuild_project_memory(
                        session,
                        project.id,
                        trigger="payment_created",
                        trusted_system=True,
                    )
                )

            assert mocked.await_count == 2
            assert memory["rebuild_log"][-1]["mode"] == "full_fallback"
            assert memory["rebuild_log"][-1]["fallback_reason"] == "invalid_partial_payload"
            assert memory["rebuild_log"][-1]["rebuilt_slots"] == list(PROJECT_MEMORY_SLOT_KEYS)
    finally:
        engine.dispose()


def test_project_partial_rebuild_rejects_changed_slot_baseline():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")
            mark_project_memory_stale(session, project.id, trigger="payment_created")
            project = session.get(Project, project.id)
            plan = plan_project_memory_rebuild(
                memory_version=project.memory_version,
                parent_stale=project.memory_stale,
                trigger="payment_created",
                slot_states=get_project_memory_slot_states(session, project.id),
            )
            mark_project_memory_stale(session, project.id, trigger="payment_updated")

            with pytest.raises(MemoryRebuildConflict):
                save_project_memory(
                    session,
                    project.id,
                    _project_memory(financial_status="Paid"),
                    trigger="payment_created",
                    rebuilt_slots=plan.slot_keys,
                    rebuild_mode="partial",
                    rebuild_plan=plan,
                )

            session.rollback()
            assert session.get(Project, project.id).memory_version == 1
    finally:
        engine.dispose()


def test_client_full_promotion_plan_rejects_concurrent_memory_version_change():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            client_id = int(client.id or 0)
            save_client_memory(session, client_id, _client_memory(), trigger="test")
            client = session.get(ClientRecord, client_id)
            plan = plan_client_memory_rebuild(
                memory_version=int(client.client_memory_version or 0),
                parent_stale=bool(client.client_memory_stale),
                trigger="manual",
                slot_states=get_client_memory_slot_states(session, client_id),
            )
            session.rollback()

            with Session(engine) as concurrent_session:
                save_client_memory(
                    concurrent_session,
                    client_id,
                    _client_memory(client_profile="Concurrent client memory"),
                    trigger="concurrent",
                )

            with pytest.raises(MemoryRebuildConflict):
                save_client_memory(
                    session,
                    client_id,
                    _client_memory(client_profile="Stale promotion output"),
                    trigger="project_promoted",
                    rebuilt_slots=CLIENT_MEMORY_SLOT_KEYS,
                    rebuild_mode="full",
                    rebuild_plan=plan,
                )

            session.rollback()
            refreshed = session.get(ClientRecord, client_id)
            assert refreshed.client_memory_version == 2
            assert "Concurrent client memory" in refreshed.client_memory_json
    finally:
        engine.dispose()


def test_client_partial_rebuild_updates_only_stale_stakeholder_slots():
    from app.routers import clients_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            save_client_memory(session, client.id, _client_memory(), trigger="test")
            mark_client_memory_stale(session, client.id, trigger="stakeholder_updated")
            response = json.dumps(
                {
                    "decision_patterns": ["CFO decides"],
                    "key_contacts": [],
                    "structured_stakeholders": [],
                    "relationship_signals": ["Sponsor engaged"],
                    "sensitive_topics": ["Budget timing"],
                }
            )
            mocked = AsyncMock(return_value=response)

            with patch.object(
                clients_deps,
                "_current_complete_with_selected_model",
                return_value=mocked,
            ):
                memory = asyncio.run(
                    clients_deps._rebuild_client_memory(
                        session,
                        client.id,
                        trigger="stakeholder_updated",
                        trusted_system=True,
                    )
                )

            states = {
                state["slot_key"]: state
                for state in get_client_memory_slot_states(session, client.id)
            }
            assert mocked.await_count == 1
            assert states["relationship_signals"]["aggregate_memory_version"] == 2
            assert states["lessons_learned"]["aggregate_memory_version"] == 1
            assert memory["lessons_learned"] == ["Pilot before scale"]
            assert memory["rebuild_log"][-1]["mode"] == "partial"
            assert session.get(ClientRecord, client.id).client_memory_stale is False
    finally:
        engine.dispose()


def test_project_full_rebuild_rejects_truncated_json_without_overwriting_memory():
    from app.routers import projects_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")
            mocked = AsyncMock(return_value='{"project_brief":"truncated"')

            with patch.object(projects_deps, "complete_with_selected_model", mocked):
                with pytest.raises(MemoryPatchValidationError):
                    asyncio.run(
                        projects_deps._rebuild_project_memory(
                            session,
                            project.id,
                            trigger="manual",
                            trusted_system=True,
                        )
                    )

            refreshed = session.get(Project, project.id)
            persisted = get_project_memory_payload(refreshed)
            prompt = mocked.await_args.kwargs["messages"][0]["content"]
            assert refreshed.memory_version == 1
            assert persisted["project_brief"] == "Current project brief"
            assert mocked.await_args.kwargs["max_tokens"] == 3200
            assert "Return at most 48 _source_attributions entries" in prompt
            assert "never copy a source tag into any business field value" in prompt
    finally:
        engine.dispose()


def test_project_rebuild_rejects_prompt_source_change_during_provider():
    from app.routers import projects_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(
                name="Pilot",
                client="Acme",
                description="Original provider input",
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")

            async def mutate_prompt_source(**_kwargs):
                current = session.get(Project, project.id)
                current.description = "Changed while the provider was running"
                session.add(current)
                session.commit()
                return json.dumps(_project_memory())

            with patch.object(
                projects_deps,
                "complete_with_selected_model",
                new=mutate_prompt_source,
            ):
                with pytest.raises(
                    MemoryRebuildConflict,
                    match="project prompt sources changed",
                ):
                    asyncio.run(
                        projects_deps._rebuild_project_memory(
                            session,
                            project.id,
                            trigger="manual",
                            trusted_system=True,
                        )
                    )

            refreshed = session.get(Project, project.id)
            assert refreshed.memory_version == 1
            assert refreshed.description == "Changed while the provider was running"
    finally:
        engine.dispose()


def test_project_full_fallback_rejects_truncated_json_without_overwriting_memory():
    from app.routers import projects_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            save_project_memory(session, project.id, _project_memory(), trigger="test")
            mark_project_memory_stale(session, project.id, trigger="payment_created")
            mocked = AsyncMock(
                side_effect=[
                    '{"financial_status":"Paid"}',
                    '{"project_brief":"truncated"',
                ]
            )

            with patch.object(projects_deps, "complete_with_selected_model", mocked):
                with pytest.raises(MemoryPatchValidationError):
                    asyncio.run(
                        projects_deps._rebuild_project_memory(
                            session,
                            project.id,
                            trigger="payment_created",
                            trusted_system=True,
                        )
                    )

            refreshed = session.get(Project, project.id)
            persisted = get_project_memory_payload(refreshed)
            assert mocked.await_count == 2
            assert all(
                call.kwargs["max_tokens"] == 3200
                for call in mocked.await_args_list
            )
            assert refreshed.memory_version == 1
            assert persisted["financial_status"] == "First invoice pending"
    finally:
        engine.dispose()


def test_client_full_rebuild_rejects_truncated_json_without_overwriting_memory():
    from app.routers import clients_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            save_client_memory(session, client.id, _client_memory(), trigger="test")
            mocked = AsyncMock(return_value='{"client_profile":"truncated"')

            with patch.object(
                clients_deps,
                "_current_complete_with_selected_model",
                return_value=mocked,
            ):
                with pytest.raises(MemoryPatchValidationError):
                    asyncio.run(
                        clients_deps._rebuild_client_memory(
                            session,
                            client.id,
                            trigger="manual",
                            trusted_system=True,
                        )
                    )

            refreshed = session.get(ClientRecord, client.id)
            persisted = get_client_memory_payload(refreshed)
            prompt = mocked.await_args.kwargs["messages"][0]["content"]
            assert refreshed.client_memory_version == 1
            assert persisted["client_profile"] == "Enterprise account"
            assert mocked.await_args.kwargs["max_tokens"] == 3200
            assert "Return at most 48 _source_attributions entries" in prompt
            assert "never copy a source tag into any business field value" in prompt
    finally:
        engine.dispose()


def test_client_rebuild_rejects_prompt_source_change_during_provider():
    from app.routers import clients_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme", notes="Original provider input")
            session.add(client)
            session.commit()
            session.refresh(client)
            save_client_memory(session, client.id, _client_memory(), trigger="test")

            async def mutate_prompt_source(**_kwargs):
                current = session.get(ClientRecord, client.id)
                current.notes = "Changed while the provider was running"
                session.add(current)
                session.commit()
                return json.dumps(_client_memory())

            with patch.object(
                clients_deps,
                "_current_complete_with_selected_model",
                return_value=mutate_prompt_source,
            ):
                with pytest.raises(
                    MemoryRebuildConflict,
                    match="client prompt sources changed",
                ):
                    asyncio.run(
                        clients_deps._rebuild_client_memory(
                            session,
                            client.id,
                            trigger="manual",
                            trusted_system=True,
                        )
                    )

            refreshed = session.get(ClientRecord, client.id)
            assert refreshed.client_memory_version == 1
            assert refreshed.notes == "Changed while the provider was running"
    finally:
        engine.dispose()


def test_client_full_fallback_rejects_truncated_json_without_overwriting_memory():
    from app.routers import clients_deps

    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            save_client_memory(session, client.id, _client_memory(), trigger="test")
            mark_client_memory_stale(session, client.id, trigger="stakeholder_updated")
            mocked = AsyncMock(
                side_effect=[
                    '{"key_contacts":[]}',
                    '{"client_profile":"truncated"',
                ]
            )

            with patch.object(
                clients_deps,
                "_current_complete_with_selected_model",
                return_value=mocked,
            ):
                with pytest.raises(MemoryPatchValidationError):
                    asyncio.run(
                        clients_deps._rebuild_client_memory(
                            session,
                            client.id,
                            trigger="stakeholder_updated",
                            trusted_system=True,
                        )
                    )

            refreshed = session.get(ClientRecord, client.id)
            persisted = get_client_memory_payload(refreshed)
            assert mocked.await_count == 2
            assert all(
                call.kwargs["max_tokens"] == 3200
                for call in mocked.await_args_list
            )
            assert refreshed.client_memory_version == 1
            assert persisted["relationship_signals"] == ["Trust improving"]
    finally:
        engine.dispose()
