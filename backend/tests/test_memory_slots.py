from __future__ import annotations

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientMemorySlot,
    ClientRecord,
    Project,
    ProjectFile,
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
    get_client_memory_slot_states,
    get_project_memory_slot_states,
    load_client_memory_slot_view,
    load_project_memory_slot_view,
)
from app.services.project_contexts import (
    get_project_memory_payload,
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
            assert next(
                item for item in states if item["slot_key"] == "financial_status"
            )["stale_reason"] == "payment_created"
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
            assert by_key["decision_patterns"]["evidence_refs"][0]["source_type"] == "project"
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
