from __future__ import annotations

import json

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import (
    ClientRecord,
    ClientStakeholder,
    Project,
    ProjectFile,
    ProjectPayment,
    ProjectTodo,
)
from app.services.client_contexts import (
    build_client_memory_data,
    build_client_memory_promote_prompt,
    build_client_memory_prompt,
    parse_client_memory,
    parse_client_memory_patch,
    save_client_memory,
)
from app.services.memory_facts import (
    MODEL_SOURCE_ATTRIBUTIONS_KEY,
    capture_client_memory_source_snapshots,
    get_client_memory_fact_states,
    get_project_memory_fact_states,
    normalize_model_source_attributions,
)
from app.services.memory_source_tags import strip_memory_source_tags
from app.services.project_contexts import (
    build_project_memory_data,
    build_project_memory_prompt,
    get_project_memory_payload,
    parse_project_memory_patch,
    save_project_memory,
)
from app.services.memory_slots import load_project_memory_slot_values


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def test_model_source_attribution_envelope_is_bounded_and_shape_checked():
    normalized = normalize_model_source_attributions(
        [
            {
                "slot_key": "financial_status",
                "fact_index": 0,
                "source_ids": ["project_payment:7", "project_payment:7"],
            },
            {
                "slot_key": "not_selected",
                "fact_index": 0,
                "source_ids": ["project:1"],
            },
            {
                "slot_key": "financial_status",
                "fact_index": True,
                "source_ids": ["project:1"],
            },
            {
                "slot_key": "financial_status",
                "fact_index": 1,
                "source_ids": ["bad handle", "project:2:extra"],
            },
        ],
        ("financial_status",),
    )

    assert normalized == [
        {
            "slot_key": "financial_status",
            "fact_index": 0,
            "source_ids": ["project_payment:7"],
        }
    ]


def test_source_tag_sanitizer_preserves_unmarked_business_formatting():
    assert strip_memory_source_tags("Line one\n  Line two") == "Line one\n  Line two"
    assert (
        strip_memory_source_tags("[project:7] Line one\n  Line two")
        == "Line one\n  Line two"
    )
    assert strip_memory_source_tags(
        {
            "[project:7]": "prompt metadata",
            "note [client:2]": "Keep [project:7] business text",
        }
    ) == {"note": "Keep  business text"}


def test_project_rebuild_verifies_direct_source_ids_and_keeps_private_envelope_out_of_memory():
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
            project_file = ProjectFile(
                project_id=int(project.id or 0),
                name="proposal.pdf",
                file_type="pdf",
                path="proposal.pdf",
            )
            session.add(payment)
            session.add(project_file)
            session.commit()
            session.refresh(payment)
            session.refresh(project_file)

            project, project_data, coverage = build_project_memory_data(
                session,
                int(project.id or 0),
                ("important_documents", "financial_status"),
            )
            prompt = build_project_memory_prompt(
                project_data,
                ("important_documents", "financial_status"),
            )
            assert f"[project_payment:{payment.id}]" in project_data
            assert f"[project_file:{project_file.id}]" in project_data
            assert MODEL_SOURCE_ATTRIBUTIONS_KEY in prompt

            raw = json.dumps(
                {
                    "important_documents": [
                        {"name": "proposal.pdf", "reason": "Defines scope"}
                    ],
                    "financial_status": "Deposit received",
                    MODEL_SOURCE_ATTRIBUTIONS_KEY: [
                        {
                            "slot_key": "financial_status",
                            "fact_index": 0,
                            "source_ids": [f"project_payment:{payment.id}"],
                        },
                        {
                            "slot_key": "important_documents",
                            "fact_index": 0,
                            # A real source ID is still rejected when it is not
                            # in this slot's source whitelist.
                            "source_ids": [f"project_payment:{payment.id}"],
                        },
                    ],
                },
                ensure_ascii=False,
            )
            parsed = parse_project_memory_patch(
                raw,
                project,
                ("important_documents", "financial_status"),
            )
            save_project_memory(
                session,
                int(project.id or 0),
                parsed,
                trigger="test_direct_sources",
                coverage=coverage,
                rebuilt_slots=("important_documents", "financial_status"),
                rebuild_mode="partial",
            )

            facts = get_project_memory_fact_states(session, int(project.id or 0))
            financial = next(
                fact for fact in facts if fact["slot_key"] == "financial_status"
            )
            document = next(
                fact for fact in facts if fact["slot_key"] == "important_documents"
            )
            assert financial["provenance_status"] == "direct"
            assert financial["evidence_refs"] == [
                {
                    "source_type": "project_payment",
                    "source_id": str(payment.id),
                    "source_label": "received · 2026-08-28 · 1000.0 · Deposit received",
                    "captured_at": "",
                    "relation": "direct_source_id",
                }
            ]
            assert document["provenance_status"] == "matched"
            assert document["evidence_refs"][0]["source_type"] == "project_file"
            assert MODEL_SOURCE_ATTRIBUTIONS_KEY not in (
                session.get(Project, project.id).context_memory_json
            )

            # An unchanged fact keeps its already-verified direct link even if
            # an older provider or a user edit path omits the private envelope.
            current_project = session.get(Project, project.id)
            memory = load_project_memory_slot_values(
                session,
                current_project,
                get_project_memory_payload(current_project),
            )
            save_project_memory(
                session,
                int(project.id or 0),
                memory,
                trigger="test_legacy_provider",
                coverage=memory.get("_coverage"),
                rebuilt_slots=("financial_status",),
                rebuild_mode="partial",
            )
            financial = next(
                fact
                for fact in get_project_memory_fact_states(
                    session,
                    int(project.id or 0),
                )
                if fact["slot_key"] == "financial_status"
            )
            assert financial["provenance_status"] == "direct"

            payment.note = "Deposit record corrected"
            session.add(payment)
            session.commit()
            current_project = session.get(Project, project.id)
            memory = load_project_memory_slot_values(
                session,
                current_project,
                get_project_memory_payload(current_project),
            )
            save_project_memory(
                session,
                int(project.id or 0),
                memory,
                trigger="test_changed_source",
                coverage=memory.get("_coverage"),
                rebuilt_slots=("financial_status",),
                rebuild_mode="partial",
            )
            financial = next(
                fact
                for fact in get_project_memory_fact_states(
                    session,
                    int(project.id or 0),
                )
                if fact["slot_key"] == "financial_status"
            )
            assert financial["provenance_status"] in {"matched", "scoped"}
            assert all(
                ref["relation"] != "direct_source_id"
                for ref in financial["evidence_refs"]
            )
    finally:
        engine.dispose()


def test_project_parser_binds_raw_index_after_filtering_and_strips_source_tag():
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

            project, _, coverage = build_project_memory_data(
                session,
                int(project.id or 0),
                ("next_actions",),
            )
            parsed = parse_project_memory_patch(
                json.dumps(
                    {
                        "next_actions": [
                            "",
                            f"[project_todo:{todo.id}] Call the client",
                            "Prepare the deck",
                        ],
                        MODEL_SOURCE_ATTRIBUTIONS_KEY: [
                            {
                                "slot_key": "next_actions",
                                "fact_index": 1,
                                "source_ids": [f"project_todo:{todo.id}"],
                            }
                        ],
                    }
                ),
                project,
                ("next_actions",),
            )
            assert parsed["next_actions"] == ["Call the client", "Prepare the deck"]

            save_project_memory(
                session,
                int(project.id or 0),
                parsed,
                trigger="test_filtered_source_index",
                coverage=coverage,
                rebuilt_slots=("next_actions",),
                rebuild_mode="partial",
            )
            facts = {
                fact["value_preview"]: fact
                for fact in get_project_memory_fact_states(
                    session,
                    int(project.id or 0),
                )
            }
            assert facts["Call the client"]["provenance_status"] == "direct"
            assert facts["Prepare the deck"]["provenance_status"] != "direct"
            persisted = session.get(Project, project.id).context_memory_json
            assert f"[project_todo:{todo.id}]" not in persisted
    finally:
        engine.dispose()


def test_client_decision_pattern_can_cite_prompt_visible_stakeholder():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            stakeholder = ClientStakeholder(
                client_id=int(client.id or 0),
                name="Alice Chen",
                role="CFO",
                decision_style="Requires quantified options",
            )
            session.add(stakeholder)
            session.commit()
            session.refresh(stakeholder)

            (
                client,
                _,
                source_project_ids,
                source_snapshots,
            ) = build_client_memory_data(
                session,
                int(client.id or 0),
                ("decision_patterns",),
            )
            parsed = parse_client_memory_patch(
                json.dumps(
                    {
                        "decision_patterns": ["Requires quantified options"],
                        MODEL_SOURCE_ATTRIBUTIONS_KEY: [
                            {
                                "slot_key": "decision_patterns",
                                "fact_index": 0,
                                "source_ids": [
                                    f"client_stakeholder:{stakeholder.id}"
                                ],
                            }
                        ],
                    }
                ),
                client,
                ("decision_patterns",),
            )
            save_client_memory(
                session,
                int(client.id or 0),
                parsed,
                trigger="test_direct_decision_pattern",
                source_project_ids=source_project_ids,
                source_snapshots=source_snapshots,
                rebuilt_slots=("decision_patterns",),
                rebuild_mode="partial",
            )
            fact = next(
                fact
                for fact in get_client_memory_fact_states(
                    session,
                    int(client.id or 0),
                )
                if fact["slot_key"] == "decision_patterns"
            )
            assert fact["provenance_status"] == "direct"
            assert fact["evidence_refs"][0]["source_id"] == str(stakeholder.id)
    finally:
        engine.dispose()


def test_client_authoritative_stakeholder_rows_get_direct_source_links():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.commit()
            session.refresh(client)
            stakeholder = ClientStakeholder(
                client_id=int(client.id or 0),
                name="Alice Chen",
                role="CFO",
                concerns="ROI",
            )
            session.add(stakeholder)
            session.commit()
            session.refresh(stakeholder)

            (
                client,
                client_data,
                source_project_ids,
                source_snapshots,
            ) = build_client_memory_data(
                session,
                int(client.id or 0),
                ("structured_stakeholders",),
            )
            prompt = build_client_memory_prompt(
                client_data,
                ("structured_stakeholders",),
            )
            assert f"[client_stakeholder:{stakeholder.id}]" in client_data
            assert MODEL_SOURCE_ATTRIBUTIONS_KEY in prompt
            parsed = parse_client_memory_patch(
                json.dumps(
                    {
                        "structured_stakeholders": [
                            {"name": "Alice Chen", "role": "CFO", "concerns": "ROI"}
                        ],
                        MODEL_SOURCE_ATTRIBUTIONS_KEY: [],
                    }
                ),
                client,
                ("structured_stakeholders",),
            )
            save_client_memory(
                session,
                int(client.id or 0),
                parsed,
                trigger="test_direct_stakeholder",
                source_project_ids=source_project_ids,
                source_snapshots=source_snapshots,
                rebuilt_slots=("structured_stakeholders",),
                rebuild_mode="partial",
            )

            fact = next(
                fact
                for fact in get_client_memory_fact_states(
                    session,
                    int(client.id or 0),
                )
                if fact["slot_key"] == "structured_stakeholders"
            )
            assert fact["provenance_status"] == "direct"
            assert fact["evidence_refs"][0]["source_id"] == str(stakeholder.id)
            assert fact["evidence_refs"][0]["relation"] == "direct_source_id"
            persisted = session.get(ClientRecord, client.id).client_memory_json
            assert MODEL_SOURCE_ATTRIBUTIONS_KEY not in persisted
            assert "_source_id" not in persisted
    finally:
        engine.dispose()


def test_project_to_client_promotion_can_bind_reusable_fact_to_project_memory_id():
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
            prompt = build_client_memory_promote_prompt(
                {},
                project.name,
                {"lessons_learned": ["Pilot before scale"]},
                project.id,
            )
            assert f"[project_memory:{project.id}]" in prompt
            assert MODEL_SOURCE_ATTRIBUTIONS_KEY in prompt

            parsed = json.dumps(
                {
                    "client_profile": "Enterprise account",
                    "decision_patterns": [],
                    "key_contacts": [],
                    "structured_stakeholders": [],
                    "lessons_learned": ["Pilot before scale"],
                    "relationship_signals": [],
                    "project_history": [],
                    "sensitive_topics": [],
                    MODEL_SOURCE_ATTRIBUTIONS_KEY: [
                        {
                            "slot_key": "lessons_learned",
                            "fact_index": 0,
                            "source_ids": [f"project_memory:{project.id}"],
                        }
                    ],
                }
            )
            promotion_handles = [f"project_memory:{project.id}"]
            promotion_snapshots = capture_client_memory_source_snapshots(
                session,
                client,
                {"source_project_ids": [int(project.id or 0)]},
                promotion_handles,
            )
            save_client_memory(
                session,
                int(client.id or 0),
                parse_client_memory(parsed, client),
                trigger="project_promoted",
                source_project_ids=[int(project.id or 0)],
                source_snapshots=promotion_snapshots,
            )
            lesson = next(
                fact
                for fact in get_client_memory_fact_states(
                    session,
                    int(client.id or 0),
                )
                if fact["slot_key"] == "lessons_learned"
            )
            assert lesson["provenance_status"] == "direct"
            assert lesson["evidence_refs"][0]["source_type"] == "project_memory"
            assert lesson["evidence_refs"][0]["source_id"] == str(project.id)
    finally:
        engine.dispose()
