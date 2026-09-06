from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.models.db import (
    ClientRecord,
    ClientStakeholder,
    Milestone,
    Project,
    ProjectFile,
    ProjectPayment,
    ProjectProgressUpdate,
    ProjectTodo,
    User,
)
from app.services.project_contexts import build_project_memory_data
from app.services.memory_slots import (
    build_client_slot_evidence_refs,
    build_project_slot_evidence_refs,
    sync_project_memory_slots,
)
from app.services.stakeholder_contexts import list_client_stakeholder_dicts


def _engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


def _ref(
    evidence: dict[str, list[dict[str, str]]],
    slot_key: str,
    source_type: str,
    source_id: int,
) -> dict[str, str]:
    return next(
        item
        for item in evidence[slot_key]
        if item["source_type"] == source_type
        and item["source_id"] == str(source_id)
    )


def _slots_with_source(
    evidence: dict[str, list[dict[str, str]]],
    source_type: str,
    source_id: int,
) -> set[str]:
    return {
        slot_key
        for slot_key, refs in evidence.items()
        if any(
            ref["source_type"] == source_type
            and ref["source_id"] == str(source_id)
            for ref in refs
        )
    }


def test_project_base_source_pool_and_digest_follow_visible_business_state():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(
                name="Pilot",
                client="Acme",
                description="ERP pilot",
                status="delivering",
                contract_amount=120000,
                notes="Procurement review is open",
                md_notes="## Delivery\nRehearsal next week",
            )
            session.add(project)
            session.commit()
            session.refresh(project)

            evidence = build_project_slot_evidence_refs(session, project)
            first = _ref(evidence, "project_brief", "project", int(project.id or 0))

            assert _slots_with_source(
                evidence,
                "project",
                int(project.id or 0),
            ) == {
                "project_brief",
                "current_stage",
                "current_objective",
                "key_risks",
                "open_questions",
                "financial_status",
                "delivery_signals",
            }
            assert len(first["source_sha256"]) == 64
            assert first["captured_at"] == project.created_at.isoformat()

            # Aggregate-memory persistence advances these operational fields,
            # but it does not change the project record shown to the provider.
            project.updated_at = project.updated_at + timedelta(minutes=5)
            project.memory_updated_at = datetime(2026, 8, 28, 12, 0, 0)
            project.memory_version = 7
            project.context_memory_json = json.dumps(
                {
                    "project_brief": "Generated summary",
                    "memory_version": 7,
                    "last_updated_at": "2026-08-28T12:00:00",
                    "rebuild_log": [{"version": 7}],
                }
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            unchanged = _ref(
                build_project_slot_evidence_refs(session, project),
                "project_brief",
                "project",
                int(project.id or 0),
            )
            assert unchanged["source_sha256"] == first["source_sha256"]
            assert unchanged["captured_at"] == first["captured_at"]

            project.notes = "Procurement review has closed"
            session.add(project)
            session.commit()
            session.refresh(project)
            changed = _ref(
                build_project_slot_evidence_refs(session, project),
                "project_brief",
                "project",
                int(project.id or 0),
            )
            assert changed["source_sha256"] != first["source_sha256"]
    finally:
        engine.dispose()


def test_project_child_source_digests_cover_prompt_visible_business_fields():
    engine = _engine()
    try:
        with Session(engine) as session:
            project = Project(name="Pilot", client="Acme")
            session.add(project)
            session.commit()
            session.refresh(project)
            progress = ProjectProgressUpdate(
                project_id=int(project.id or 0),
                content="Discovery complete",
                next_step="Run design review",
                risk="Data quality",
            )
            milestone = Milestone(
                project_id=int(project.id or 0),
                title="Design sign-off",
                priority="high",
                due_date="2026-09-01",
            )
            todo = ProjectTodo(
                project_id=int(project.id or 0),
                content="Prepare steering deck",
                due_date="2026-09-02",
            )
            project_file = ProjectFile(
                project_id=int(project.id or 0),
                name="proposal.pdf",
                file_type="pdf",
                path="proposal.pdf",
                summary="Defines the delivery scope",
            )
            payment = ProjectPayment(
                project_id=int(project.id or 0),
                amount=1000,
                payment_date="2026-08-28",
                payment_type="received",
                note="Deposit",
            )
            session.add(progress)
            session.add(milestone)
            session.add(todo)
            session.add(project_file)
            session.add(payment)
            session.commit()
            for item in (progress, milestone, todo, project_file, payment):
                session.refresh(item)

            before = build_project_slot_evidence_refs(session, project)
            source_refs = {
                "progress": _ref(
                    before,
                    "recent_progress",
                    "project_progress",
                    int(progress.id or 0),
                ),
                "milestone": _ref(
                    before,
                    "current_stage",
                    "milestone",
                    int(milestone.id or 0),
                ),
                "todo": _ref(
                    before,
                    "next_actions",
                    "project_todo",
                    int(todo.id or 0),
                ),
                "file": _ref(
                    before,
                    "important_documents",
                    "project_file",
                    int(project_file.id or 0),
                ),
                "payment": _ref(
                    before,
                    "financial_status",
                    "project_payment",
                    int(payment.id or 0),
                ),
            }

            progress.risk = "Data migration quality"
            milestone.due_date = "2026-09-08"
            todo.is_done = True
            project_file.summary = "Defines the revised delivery scope"
            payment.note = "Deposit corrected"
            for item in (progress, milestone, todo, project_file, payment):
                session.add(item)
            session.commit()
            after = build_project_slot_evidence_refs(session, project)

            assert _ref(
                after,
                "recent_progress",
                "project_progress",
                int(progress.id or 0),
            )["source_sha256"] != source_refs["progress"]["source_sha256"]
            assert _ref(
                after,
                "current_stage",
                "milestone",
                int(milestone.id or 0),
            )["source_sha256"] != source_refs["milestone"]["source_sha256"]
            assert _ref(
                after,
                "next_actions",
                "project_todo",
                int(todo.id or 0),
            )["source_sha256"] != source_refs["todo"]["source_sha256"]
            assert _ref(
                after,
                "important_documents",
                "project_file",
                int(project_file.id or 0),
            )["source_sha256"] != source_refs["file"]["source_sha256"]
            assert _ref(
                after,
                "financial_status",
                "project_payment",
                int(payment.id or 0),
            )["source_sha256"] != source_refs["payment"]["source_sha256"]
    finally:
        engine.dispose()


def test_progress_prompt_and_evidence_ignore_mutable_author_display_name():
    engine = _engine()
    try:
        with Session(engine) as session:
            author = User(
                email="progress-author@example.com",
                password_hash="x",
                display_name="Original Name",
            )
            project = Project(name="Pilot", client="Acme")
            session.add_all([author, project])
            session.flush()
            progress = ProjectProgressUpdate(
                project_id=int(project.id or 0),
                content="Discovery complete",
                created_by_user_id=int(author.id or 0),
            )
            session.add(progress)
            session.commit()
            session.refresh(project)
            session.refresh(progress)
            author_id = int(author.id or 0)
            project_id = int(project.id or 0)
            progress_id = int(progress.id or 0)

            before_evidence = build_project_slot_evidence_refs(session, project)
            before_ref = _ref(
                before_evidence,
                "recent_progress",
                "project_progress",
                progress_id,
            )
            _, before_prompt, _ = build_project_memory_data(
                session,
                project_id,
                ("recent_progress",),
            )

            author.display_name = "Renamed Concurrently"
            session.add(author)
            session.commit()
            session.expire_all()
            project = session.get(Project, project_id)
            assert project is not None

            after_ref = _ref(
                build_project_slot_evidence_refs(session, project),
                "recent_progress",
                "project_progress",
                progress_id,
            )
            _, after_prompt, _ = build_project_memory_data(
                session,
                project_id,
                ("recent_progress",),
            )

            assert after_ref["source_sha256"] == before_ref["source_sha256"]
            assert after_prompt == before_prompt
            assert "Original Name" not in before_prompt
            assert "Renamed Concurrently" not in after_prompt
            assert f"user #{author_id}" in after_prompt
    finally:
        engine.dispose()


def test_client_sources_hash_prompt_projection_and_ignore_memory_envelope_churn():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(
                name="Acme",
                industry="Manufacturing",
                contact="Alice Chen",
                notes="CFO prefers quantified options",
            )
            project = Project(
                name="Pilot",
                client="Acme",
                status="delivering",
                contract_amount=120000,
                context_summary="ERP discovery is complete",
                context_memory_json=json.dumps(
                    {
                        "project_brief": "Pilot ERP in two plants",
                        "key_risks": ["Procurement delay"],
                        "next_actions": ["Run steering review"],
                        "memory_version": 1,
                        "last_updated_at": "2026-08-28T09:00:00",
                        "rebuild_log": [{"version": 1}],
                    }
                ),
            )
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            sync_project_memory_slots(
                session,
                project,
                {
                    "project_brief": "Pilot ERP in two plants",
                    "key_risks": ["Procurement delay"],
                    "next_actions": ["Run steering review"],
                },
                slot_keys=("project_brief", "key_risks", "next_actions"),
            )
            stakeholder = ClientStakeholder(
                client_id=int(client.id or 0),
                name="Alice Chen",
                role="CFO",
                decision_style="Requires quantified options",
                contact="alice@example.com",
            )
            session.add(stakeholder)
            session.commit()
            session.refresh(stakeholder)

            evidence = build_client_slot_evidence_refs(
                session,
                client,
                {"source_project_ids": [project.id]},
            )
            client_ref = _ref(
                evidence,
                "client_profile",
                "client",
                int(client.id or 0),
            )
            project_ref = _ref(
                evidence,
                "project_history",
                "project",
                int(project.id or 0),
            )
            project_memory_ref = _ref(
                evidence,
                "project_history",
                "project_memory",
                int(project.id or 0),
            )
            stakeholder_ref = _ref(
                evidence,
                "decision_patterns",
                "client_stakeholder",
                int(stakeholder.id or 0),
            )

            assert _slots_with_source(
                evidence,
                "client",
                int(client.id or 0),
            ) == {
                "client_profile",
                "decision_patterns",
                "key_contacts",
                "lessons_learned",
                "relationship_signals",
                "sensitive_topics",
            }
            assert stakeholder_ref["source_sha256"]

            # Private memory envelopes and save timestamps are not business
            # evidence, while every persisted stakeholder field is.
            client.client_memory_updated_at = datetime(2026, 8, 28, 13, 0, 0)
            client.client_memory_version = 9
            client.client_memory_json = json.dumps(
                {"memory_version": 9, "rebuild_log": [{"version": 9}]}
            )
            project.updated_at = project.updated_at + timedelta(minutes=10)
            project.context_memory_json = json.dumps(
                {
                    "project_brief": "Pilot ERP in two plants",
                    "key_risks": ["Procurement delay"],
                    "next_actions": ["Run steering review"],
                    "memory_version": 8,
                    "last_updated_at": "2026-08-28T13:00:00",
                    "rebuild_log": [{"version": 8}],
                }
            )
            stakeholder.contact = "finance@example.com"
            stakeholder.updated_at = stakeholder.updated_at + timedelta(minutes=10)
            session.add(client)
            session.add(project)
            session.add(stakeholder)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            session.refresh(stakeholder)
            operational_update = build_client_slot_evidence_refs(
                session,
                client,
                {"source_project_ids": [project.id]},
            )
            assert _ref(
                operational_update,
                "client_profile",
                "client",
                int(client.id or 0),
            )["source_sha256"] == client_ref["source_sha256"]
            assert _ref(
                operational_update,
                "project_history",
                "project",
                int(project.id or 0),
            )["source_sha256"] == project_ref["source_sha256"]
            assert _ref(
                operational_update,
                "project_history",
                "project_memory",
                int(project.id or 0),
            )["source_sha256"] == project_memory_ref["source_sha256"]
            assert _ref(
                operational_update,
                "decision_patterns",
                "client_stakeholder",
                int(stakeholder.id or 0),
            )["source_sha256"] != stakeholder_ref["source_sha256"]

            client.notes = "CFO now prefers a single recommendation"
            sync_project_memory_slots(
                session,
                project,
                {
                    "project_brief": "Pilot ERP across three plants",
                    "key_risks": ["Procurement delay"],
                    "next_actions": ["Run steering review"],
                },
                slot_keys=("project_brief", "key_risks", "next_actions"),
            )
            stakeholder.decision_style = "Requires a single recommendation"
            session.add(client)
            session.add(project)
            session.add(stakeholder)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            session.refresh(stakeholder)
            business_update = build_client_slot_evidence_refs(
                session,
                client,
                {"source_project_ids": [project.id]},
            )
            assert _ref(
                business_update,
                "client_profile",
                "client",
                int(client.id or 0),
            )["source_sha256"] != client_ref["source_sha256"]
            assert _ref(
                business_update,
                "project_history",
                "project",
                int(project.id or 0),
            )["source_sha256"] != project_ref["source_sha256"]
            assert _ref(
                business_update,
                "project_history",
                "project_memory",
                int(project.id or 0),
            )["source_sha256"] != project_memory_ref["source_sha256"]
            assert _ref(
                business_update,
                "decision_patterns",
                "client_stakeholder",
                int(stakeholder.id or 0),
            )["source_sha256"] != stakeholder_ref["source_sha256"]
    finally:
        engine.dispose()


def test_promotion_source_digest_covers_full_business_memory_projection():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            project = Project(
                name="Pilot",
                client="Acme",
                context_memory_json=json.dumps(
                    {
                        "project_brief": "ERP pilot",
                        "financial_status": "Deposit pending",
                    }
                ),
            )
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            sync_project_memory_slots(
                session,
                project,
                {
                    "project_brief": "ERP pilot",
                    "financial_status": "Deposit pending",
                },
                slot_keys=("project_brief", "financial_status"),
            )
            session.commit()

            before = build_client_slot_evidence_refs(
                session,
                client,
                {"source_project_ids": [project.id]},
            )
            regular_before = _ref(
                before,
                "project_history",
                "project",
                int(project.id or 0),
            )["source_sha256"]
            promotion_before = _ref(
                before,
                "project_history",
                "project_memory",
                int(project.id or 0),
            )["source_sha256"]

            sync_project_memory_slots(
                session,
                project,
                {
                    "project_brief": "ERP pilot",
                    "financial_status": "Deposit received",
                },
                slot_keys=("financial_status",),
            )
            session.add(project)
            session.commit()
            session.refresh(project)
            after = build_client_slot_evidence_refs(
                session,
                client,
                {"source_project_ids": [project.id]},
            )

            assert _ref(
                after,
                "project_history",
                "project",
                int(project.id or 0),
            )["source_sha256"] == regular_before
            assert _ref(
                after,
                "project_history",
                "project_memory",
                int(project.id or 0),
            )["source_sha256"] != promotion_before
    finally:
        engine.dispose()


def test_client_project_source_digests_bind_project_client_ownership():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            project = Project(
                name="Pilot",
                client="Acme",
                context_memory_json=json.dumps({"project_brief": "ERP pilot"}),
            )
            session.add(client)
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)

            before = build_client_slot_evidence_refs(
                session,
                client,
                {"source_project_ids": [project.id]},
            )
            project_sha = _ref(
                before,
                "project_history",
                "project",
                int(project.id or 0),
            )["source_sha256"]
            promotion_sha = _ref(
                before,
                "project_history",
                "project_memory",
                int(project.id or 0),
            )["source_sha256"]

            project.client = "Other client"
            session.add(project)
            session.commit()
            session.refresh(project)
            after = build_client_slot_evidence_refs(
                session,
                client,
                {"source_project_ids": [project.id]},
            )

            assert _ref(
                after,
                "project_history",
                "project",
                int(project.id or 0),
            )["source_sha256"] != project_sha
            assert _ref(
                after,
                "project_history",
                "project_memory",
                int(project.id or 0),
            )["source_sha256"] != promotion_sha
    finally:
        engine.dispose()


def test_stakeholder_evidence_pool_matches_prompt_limit_and_order():
    engine = _engine()
    try:
        with Session(engine) as session:
            client = ClientRecord(name="Acme")
            session.add(client)
            session.flush()
            project = Project(
                name="Pilot",
                client="Acme",
                client_id=int(client.id),
            )
            session.add(project)
            session.commit()
            session.refresh(client)
            session.refresh(project)
            start = datetime(2026, 8, 28, 8, 0, 0)
            for index in range(9):
                session.add(
                    ClientStakeholder(
                        client_id=int(client.id or 0),
                        name=f"Stakeholder {index}",
                        role="Sponsor",
                        updated_at=start + timedelta(minutes=index),
                    )
                )
            session.commit()

            visible = list_client_stakeholder_dicts(
                session,
                int(client.id or 0),
                include_source_id=True,
            )
            client_refs = [
                ref
                for ref in build_client_slot_evidence_refs(
                    session,
                    client,
                    {},
                )["structured_stakeholders"]
                if ref["source_type"] == "client_stakeholder"
            ]
            project_refs = [
                ref
                for ref in build_project_slot_evidence_refs(
                    session,
                    project,
                )["client_stakeholders"]
                if ref["source_type"] == "client_stakeholder"
            ]

            visible_ids = [str(item["_source_id"]) for item in visible]
            assert len(visible_ids) == 8
            assert [ref["source_id"] for ref in client_refs] == visible_ids
            assert [ref["source_id"] for ref in project_refs] == visible_ids
    finally:
        engine.dispose()
