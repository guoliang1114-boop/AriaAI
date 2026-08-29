from __future__ import annotations

import json
from datetime import timedelta

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import (
    ClientMemoryFact,
    ClientRecord,
    ClientStakeholder,
    Project,
    ProjectFile,
    ProjectMemoryFact,
    ProjectMemorySlot,
    ProjectPayment,
    ProjectTodo,
)
from app.services.client_contexts import build_client_memory_data, save_client_memory
from app.services.memory_facts import (
    bind_model_source_attributions,
    capture_client_memory_source_snapshots,
    capture_project_memory_source_snapshots,
    get_client_memory_fact_states,
    get_project_memory_fact_states,
    normalize_model_source_attributions,
    sync_client_memory_facts,
    sync_project_memory_facts,
)
from app.services.memory_slots import (
    get_client_memory_slot_states,
    get_project_memory_slot_states,
    sync_client_memory_slots,
    sync_project_memory_slots,
)
from app.services.time_utils import utc_now_naive


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _bound_attributions(
    slot_key: str,
    facts: dict[int, tuple[str, object]],
    source_ids: dict[int, list[str]],
):
    return bind_model_source_attributions(
        [
            {
                "slot_key": slot_key,
                "fact_index": raw_index,
                "source_ids": ids,
            }
            for raw_index, ids in source_ids.items()
        ],
        (slot_key,),
        {slot_key: facts},
    )


def test_canonical_binding_survives_filtered_indices_and_normalization():
    raw = [
        {
            "slot_key": "next_actions",
            "fact_index": 1,
            "source_ids": ["project_todo:7"],
        }
    ]
    normalized = normalize_model_source_attributions(raw, ("next_actions",))
    assert normalized == raw

    bound = bind_model_source_attributions(
        normalized,
        ("next_actions",),
        {"next_actions": {1: ("item", "Call the client")}},
    )
    assert bound[0]["fact_index"] == 1
    assert bound[0]["source_kind"] == "item"
    assert len(bound[0]["fact_value_sha256"]) == 64
    assert bind_model_source_attributions(
        normalized,
        ("next_actions",),
        {"next_actions": {}},
    ) == []


def test_source_hash_stays_private_while_slot_ledger_keeps_it_for_validation():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)

            sync_project_memory_slots(
                session,
                project,
                {"project_brief": "Pilot"},
                slot_keys=("project_brief",),
            )
            session.commit()

            public_ref = get_project_memory_slot_states(
                session,
                int(project.id or 0),
            )[0]["evidence_refs"][0]
            stored_row = session.exec(select(ProjectMemorySlot)).first()
            stored_ref = json.loads(stored_row.evidence_refs_json)[0]
            assert "source_sha256" not in public_ref
            assert len(stored_ref["source_sha256"]) == 64
    finally:
        engine.dispose()


def test_direct_requires_bound_fact_and_unchanged_prompt_source_snapshot():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            payment = ProjectPayment(
                project_id=int(project.id or 0),
                amount=1000,
                payment_date="2026-08-28",
                payment_type="received",
                note="Deposit received",
            )
            session.add(payment)
            session.commit()
            session.refresh(payment)

            handle = f"project_payment:{payment.id}"
            snapshots = capture_project_memory_source_snapshots(
                session,
                project,
                [handle],
            )
            assert len(snapshots[handle]) == 64

            memory = {"financial_status": "Deposit received"}
            raw_attributions = [
                {
                    "slot_key": "financial_status",
                    "fact_index": 0,
                    "source_ids": [handle],
                }
            ]
            # A shape-valid but server-unbound provider index cannot establish
            # direct provenance.
            sync_project_memory_facts(
                session,
                project,
                memory,
                slot_keys=("financial_status",),
                source_attributions=raw_attributions,
                source_snapshots=snapshots,
            )
            session.commit()
            fact = get_project_memory_fact_states(session, int(project.id or 0))[0]
            assert fact["provenance_status"] != "direct"

            bound = _bound_attributions(
                "financial_status",
                {0: ("value", "Deposit received")},
                {0: [handle]},
            )
            sync_project_memory_facts(
                session,
                project,
                memory,
                slot_keys=("financial_status",),
                source_attributions=bound,
                source_snapshots=snapshots,
            )
            session.commit()
            fact = get_project_memory_fact_states(session, int(project.id or 0))[0]
            assert fact["provenance_status"] == "direct"
            assert "source_sha256" not in fact["evidence_refs"][0]
            fact_row = session.exec(select(ProjectMemoryFact)).first()
            stored_refs = json.loads(fact_row.evidence_refs_json)
            assert stored_refs[0]["source_sha256"] == snapshots[handle]

            # The source changed after the prompt snapshot. Neither the old
            # snapshot nor the previously direct row may validate it now.
            payment = session.get(ProjectPayment, payment.id)
            payment.note = "Deposit record corrected"
            session.add(payment)
            session.commit()
            sync_project_memory_facts(
                session,
                project,
                memory,
                slot_keys=("financial_status",),
                source_attributions=bound,
                source_snapshots=snapshots,
            )
            session.commit()
            fact = get_project_memory_fact_states(session, int(project.id or 0))[0]
            assert fact["provenance_status"] != "direct"
            assert all(
                ref["relation"] != "direct_source_id"
                for ref in fact["evidence_refs"]
            )
    finally:
        engine.dispose()


def test_fallback_provenance_excludes_sources_created_after_prompt_snapshot():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            prompt_file = ProjectFile(
                project_id=int(project.id or 0),
                name="before.pdf",
                file_type="pdf",
                path="before.pdf",
            )
            session.add(prompt_file)
            session.commit()
            session.refresh(prompt_file)

            prompt_handle = f"project_file:{prompt_file.id}"
            snapshots = capture_project_memory_source_snapshots(
                session,
                project,
                [prompt_handle],
            )
            assert prompt_handle in snapshots

            late_file = ProjectFile(
                project_id=int(project.id or 0),
                name="late.pdf",
                file_type="pdf",
                path="late.pdf",
            )
            session.add(late_file)
            session.commit()
            session.refresh(late_file)

            sync_project_memory_facts(
                session,
                project,
                {
                    "important_documents": [
                        {"name": "late.pdf", "reason": "Defines scope"}
                    ]
                },
                slot_keys=("important_documents",),
                source_snapshots=snapshots,
            )
            session.commit()

            fact = get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]
            assert fact["provenance_status"] == "scoped"
            assert fact["evidence_refs"] == [
                {
                    "source_type": "project_file",
                    "source_id": str(prompt_file.id),
                    "source_label": "before.pdf",
                    "captured_at": prompt_file.uploaded_at.isoformat(),
                    "relation": "slot_scope",
                }
            ]
            assert all(
                ref["source_id"] != str(late_file.id)
                for ref in fact["evidence_refs"]
            )
    finally:
        engine.dispose()


def test_empty_prompt_snapshot_cannot_adopt_a_late_source():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)

            # The important-documents prompt had no document source at capture
            # time. A file created while the provider is running is therefore
            # ineligible for both MATCHED and SCOPED fallback lineage.
            prompt_snapshots: dict[str, str] = {}
            late_file = ProjectFile(
                project_id=int(project.id or 0),
                name="late.pdf",
                file_type="pdf",
                path="late.pdf",
            )
            session.add(late_file)
            session.commit()

            sync_project_memory_facts(
                session,
                project,
                {
                    "important_documents": [
                        {"name": "late.pdf", "reason": "Defines scope"}
                    ]
                },
                slot_keys=("important_documents",),
                source_snapshots=prompt_snapshots,
            )
            session.commit()
            fact = get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]
            assert fact["provenance_status"] == "unresolved"
            assert fact["evidence_refs"] == []
    finally:
        engine.dispose()


def test_client_provider_snapshot_does_not_adopt_a_late_stakeholder_for_other_slots():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)

            (
                client,
                _,
                source_project_ids,
                prompt_snapshots,
            ) = build_client_memory_data(
                session,
                int(client.id or 0),
                ("decision_patterns", "structured_stakeholders"),
            )
            late_stakeholder = ClientStakeholder(
                client_id=int(client.id or 0),
                name="Alice",
                role="CFO",
            )
            session.add(late_stakeholder)
            session.commit()
            session.refresh(late_stakeholder)

            save_client_memory(
                session,
                int(client.id or 0),
                {
                    "decision_patterns": ["Alice CFO approves quantified plans"],
                    "structured_stakeholders": [],
                },
                trigger="provider_rebuild",
                source_project_ids=source_project_ids,
                source_snapshots=prompt_snapshots,
                rebuilt_slots=("decision_patterns", "structured_stakeholders"),
                rebuild_mode="partial",
            )

            fact = next(
                item
                for item in get_client_memory_fact_states(
                    session,
                    int(client.id or 0),
                )
                if item["slot_key"] == "decision_patterns"
            )
            assert all(
                not (
                    ref["source_type"] == "client_stakeholder"
                    and ref["source_id"] == str(late_stakeholder.id)
                )
                for ref in fact["evidence_refs"]
            )
    finally:
        engine.dispose()


def test_preserved_direct_uses_business_hash_not_owner_memory_timestamp():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(
                name="Pilot",
                client="Acme",
                description="Validate demand",
            )
            client = ClientRecord(name="Acme", notes="Enterprise account")
            session.add(project)
            session.add(client)
            session.commit()
            session.refresh(project)
            session.refresh(client)

            project_handle = f"project:{project.id}"
            project_snapshots = capture_project_memory_source_snapshots(
                session,
                project,
                [project_handle],
            )
            project_memory = {"project_brief": "Validate demand"}
            project_attributions = _bound_attributions(
                "project_brief",
                {0: ("value", "Validate demand")},
                {0: [project_handle]},
            )
            sync_project_memory_facts(
                session,
                project,
                project_memory,
                slot_keys=("project_brief",),
                source_attributions=project_attributions,
                source_snapshots=project_snapshots,
            )
            session.commit()
            project = session.get(Project, project.id)
            project.updated_at = utc_now_naive()
            session.add(project)
            sync_project_memory_facts(
                session,
                project,
                project_memory,
                slot_keys=("project_brief",),
            )
            session.commit()
            assert get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]["provenance_status"] == "direct"

            client_handle = f"client:{client.id}"
            client_memory = {
                "client_profile": "Enterprise account",
                "source_project_ids": [],
            }
            client_snapshots = capture_client_memory_source_snapshots(
                session,
                client,
                client_memory,
                [client_handle],
            )
            client_attributions = _bound_attributions(
                "client_profile",
                {0: ("value", "Enterprise account")},
                {0: [client_handle]},
            )
            sync_client_memory_facts(
                session,
                client,
                client_memory,
                slot_keys=("client_profile",),
                source_attributions=client_attributions,
                source_snapshots=client_snapshots,
            )
            session.commit()
            client = session.get(ClientRecord, client.id)
            client.client_memory_updated_at = utc_now_naive()
            session.add(client)
            sync_client_memory_facts(
                session,
                client,
                client_memory,
                slot_keys=("client_profile",),
            )
            session.commit()
            assert get_client_memory_fact_states(
                session,
                int(client.id or 0),
            )[0]["provenance_status"] == "direct"
    finally:
        engine.dispose()


def test_preserved_direct_ignores_capture_timestamp_when_source_state_is_same():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            todo = ProjectTodo(
                project_id=int(project.id or 0),
                content="Call the client",
            )
            session.add(todo)
            session.commit()
            session.refresh(todo)

            handle = f"project_todo:{todo.id}"
            snapshots = capture_project_memory_source_snapshots(
                session,
                project,
                [handle],
            )
            memory = {"next_actions": ["Call the client"]}
            sync_project_memory_facts(
                session,
                project,
                memory,
                slot_keys=("next_actions",),
                source_attributions=_bound_attributions(
                    "next_actions",
                    {0: ("item", "Call the client")},
                    {0: [handle]},
                ),
                source_snapshots=snapshots,
            )
            session.commit()
            before = get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]

            todo = session.get(ProjectTodo, todo.id)
            todo.updated_at = todo.updated_at + timedelta(seconds=1)
            session.add(todo)
            sync_project_memory_facts(
                session,
                project,
                memory,
                slot_keys=("next_actions",),
            )
            session.commit()
            after = get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]
            assert after["provenance_status"] == "direct"
            assert after["evidence_refs"][0]["captured_at"] != (
                before["evidence_refs"][0]["captured_at"]
            )
    finally:
        engine.dispose()


def test_project_promotion_protects_existing_fact_lineage_but_links_new_fact():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            first_project = Project(name="First", client="Acme")
            promoted_project = Project(name="Second", client="Acme")
            session.add(client)
            session.add(first_project)
            session.add(promoted_project)
            session.commit()
            session.refresh(client)
            session.refresh(first_project)
            session.refresh(promoted_project)

            first_handle = f"project:{first_project.id}"
            initial_memory = {
                "lessons_learned": ["Pilot before scale"],
                "source_project_ids": [first_project.id],
            }
            first_snapshots = capture_client_memory_source_snapshots(
                session,
                client,
                initial_memory,
                [first_handle],
            )
            sync_client_memory_facts(
                session,
                client,
                initial_memory,
                slot_keys=("lessons_learned",),
                source_attributions=_bound_attributions(
                    "lessons_learned",
                    {0: ("item", "Pilot before scale")},
                    {0: [first_handle]},
                ),
                source_snapshots=first_snapshots,
            )
            session.commit()

            promoted_handle = f"project_memory:{promoted_project.id}"
            promoted_memory = {
                "lessons_learned": [
                    "Pilot before scale",
                    "Use weekly sponsor reviews",
                ],
                "source_project_ids": [first_project.id, promoted_project.id],
            }
            promoted_snapshots = capture_client_memory_source_snapshots(
                session,
                client,
                promoted_memory,
                [promoted_handle],
            )
            sync_client_memory_facts(
                session,
                client,
                promoted_memory,
                slot_keys=("lessons_learned",),
                source_attributions=_bound_attributions(
                    "lessons_learned",
                    {
                        0: ("item", "Pilot before scale"),
                        1: ("item", "Use weekly sponsor reviews"),
                    },
                    {0: [promoted_handle], 1: [promoted_handle]},
                ),
                source_snapshots=promoted_snapshots,
                protect_existing_fact_provenance=True,
            )
            session.commit()

            facts = {
                fact["value_preview"]: fact
                for fact in get_client_memory_fact_states(
                    session,
                    int(client.id or 0),
                )
            }
            existing = facts["Pilot before scale"]
            added = facts["Use weekly sponsor reviews"]
            assert existing["provenance_status"] == "direct"
            assert existing["evidence_refs"][0]["source_id"] == str(
                first_project.id
            )
            assert added["provenance_status"] == "direct"
            assert added["evidence_refs"][0]["source_id"] == str(
                promoted_project.id
            )
            assert added["evidence_refs"][0]["source_type"] == "project_memory"

            rows = session.exec(select(ClientMemoryFact)).all()
            assert len(rows) == 2
    finally:
        engine.dispose()


def test_project_memory_source_drift_downgrades_dependent_client_state():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            project = Project(
                name="Pilot",
                client="Acme",
                context_memory_json=json.dumps(
                    {"financial_status": "Deposit pending"}
                ),
            )
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)

            handle = f"project_memory:{project.id}"
            memory = {
                "lessons_learned": ["Confirm payment gates early"],
                "source_project_ids": [project.id],
            }
            snapshots = capture_client_memory_source_snapshots(
                session,
                client,
                memory,
                [handle],
            )
            sync_client_memory_slots(
                session,
                client,
                memory,
                slot_keys=("lessons_learned",),
                source_snapshots=snapshots,
            )
            sync_client_memory_facts(
                session,
                client,
                memory,
                slot_keys=("lessons_learned",),
                source_attributions=_bound_attributions(
                    "lessons_learned",
                    {0: ("item", "Confirm payment gates early")},
                    {0: [handle]},
                ),
                source_snapshots=snapshots,
            )
            session.commit()
            assert get_client_memory_fact_states(
                session,
                int(client.id or 0),
            )[0]["provenance_status"] == "direct"

            project = session.get(Project, project.id)
            project.context_memory_json = json.dumps(
                {"financial_status": "Deposit received"}
            )
            session.add(project)
            session.commit()

            fact = get_client_memory_fact_states(
                session,
                int(client.id or 0),
            )[0]
            slot = get_client_memory_slot_states(
                session,
                int(client.id or 0),
            )[0]
            assert fact["status"] == "stale"
            assert fact["stale_reason"] == "source_changed"
            assert fact["provenance_status"] == "unresolved"
            assert fact["evidence_count"] == 0
            assert slot["status"] == "stale"
            assert slot["stale_reason"] == "source_changed"
    finally:
        engine.dispose()


def test_stakeholder_source_drift_downgrades_dependent_project_state():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            project = Project(name="Pilot", client="Acme")
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            stakeholder = ClientStakeholder(
                client_id=int(client.id or 0),
                name="Alice",
                role="CFO",
                decision_style="Needs quantified options",
            )
            session.add(stakeholder)
            session.commit()
            session.refresh(stakeholder)

            handle = f"client_stakeholder:{stakeholder.id}"
            memory = {
                "stakeholder_notes": {
                    "ai": ["Alice needs quantified options"],
                    "pinned": [],
                }
            }
            snapshots = capture_project_memory_source_snapshots(
                session,
                project,
                [handle],
            )
            sync_project_memory_slots(
                session,
                project,
                memory,
                slot_keys=("stakeholder_notes",),
                source_snapshots=snapshots,
            )
            sync_project_memory_facts(
                session,
                project,
                memory,
                slot_keys=("stakeholder_notes",),
                source_attributions=_bound_attributions(
                    "stakeholder_notes",
                    {0: ("ai", "Alice needs quantified options")},
                    {0: [handle]},
                ),
                source_snapshots=snapshots,
            )
            session.commit()

            stakeholder = session.get(ClientStakeholder, stakeholder.id)
            stakeholder.decision_style = "Needs one decisive recommendation"
            session.add(stakeholder)
            session.commit()

            fact = get_project_memory_fact_states(
                session,
                int(project.id or 0),
            )[0]
            slot = get_project_memory_slot_states(
                session,
                int(project.id or 0),
            )[0]
            assert fact["status"] == "stale"
            assert fact["provenance_status"] == "unresolved"
            assert slot["status"] == "stale"
    finally:
        engine.dispose()
