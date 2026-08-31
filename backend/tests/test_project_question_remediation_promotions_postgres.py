"""Database contracts for governed remediation promotions.

Production E2E runs this suite only in its backed-up disposable PostgreSQL
schema.  The same test can run against the configured test database locally.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from sqlmodel import Session, SQLModel, select

from app.models.db import (
    Project,
    ProjectCommunicationRequest,
    ProjectMember,
    ProjectQuestionRemediationPromotionEvent,
    ProjectTodo,
    User,
)
from app.services.project_question_remediation_promotions import (
    confirm_project_question_remediation_promotion,
    prepare_project_question_remediation_promotion,
)
from app.services.project_question_resolutions import project_question_sha256
from tests.test_database import create_test_engine, drop_all_tables


QUESTION = "客户是否确认了最终验收范围？"
BASIS = "b" * 64


class ProjectQuestionRemediationPromotionDatabaseContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.engine = create_test_engine()

    @classmethod
    def tearDownClass(cls) -> None:
        drop_all_tables(cls.engine)
        cls.engine.dispose()

    def setUp(self) -> None:
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

    @staticmethod
    def _plan():
        return {
            "basis": {"fingerprint": BASIS},
            "actions": [
                {"action_id": "remediation_01", "kind": "evidence_request"}
            ],
        }

    @staticmethod
    def _seed(session: Session) -> tuple[User, Project]:
        owner = User(email="promotion-db@example.com", password_hash="x")
        project = Project(name="Promotion DB", client="Test")
        session.add(owner)
        session.add(project)
        session.flush()
        session.add(
            ProjectMember(
                project_id=int(project.id or 0),
                user_id=int(owner.id or 0),
                role="owner",
            )
        )
        session.commit()
        session.refresh(owner)
        session.refresh(project)
        return owner, project

    def test_manual_communication_round_trip_keeps_delivery_disabled(self) -> None:
        with Session(self.engine) as session, patch(
            "app.services.project_question_remediation_promotions.build_project_question_remediation_plan",
            return_value=self._plan(),
        ):
            owner, project = self._seed(session)
            prepared = prepare_project_question_remediation_promotion(
                session,
                project_id=int(project.id or 0),
                actor_user_id=int(owner.id or 0),
                question=QUESTION,
                question_sha256=project_question_sha256(QUESTION),
                evidence_basis_fingerprint=BASIS,
                idempotency_key="postgres-promotion-key-0001",
                target_kind="communication_request",
                action_kind="evidence_request",
                source_action_id="remediation_01",
                title="请求书面确认",
                draft="请提供签字确认记录。",
                recipient_label="客户项目经理",
            )
            self.assertEqual(session.exec(select(ProjectCommunicationRequest)).all(), [])

            confirmed = confirm_project_question_remediation_promotion(
                session,
                project_id=int(project.id or 0),
                question_sha256=project_question_sha256(QUESTION),
                promotion_id=int(prepared["id"]),
                actor_user_id=int(owner.id or 0),
                snapshot_sha256=str(prepared["snapshot_sha256"]),
                expected_revision=1,
            )

            request = session.exec(select(ProjectCommunicationRequest)).one()
            self.assertEqual(request.delivery_mode, "manual_only")
            self.assertEqual(request.status, "ready_for_manual_send")
            self.assertFalse(confirmed["target"]["delivered"])
            events = session.exec(
                select(ProjectQuestionRemediationPromotionEvent).order_by(
                    ProjectQuestionRemediationPromotionEvent.revision
                )
            ).all()
            self.assertEqual(
                [(event.action, event.revision) for event in events],
                [("prepared", 1), ("confirmed", 2)],
            )

    def test_project_lock_serializes_exact_effect_deduplication(self) -> None:
        with Session(self.engine) as session, patch(
            "app.services.project_question_remediation_promotions.build_project_question_remediation_plan",
            return_value=self._plan(),
        ):
            owner, project = self._seed(session)
            prepared = []
            for sequence in (1, 2):
                prepared.append(
                    prepare_project_question_remediation_promotion(
                        session,
                        project_id=int(project.id or 0),
                        actor_user_id=int(owner.id or 0),
                        question=QUESTION,
                        question_sha256=project_question_sha256(QUESTION),
                        evidence_basis_fingerprint=BASIS,
                        idempotency_key=f"postgres-promotion-key-000{sequence}",
                        target_kind="project_todo",
                        action_kind="evidence_request",
                        source_action_id="remediation_01",
                        title="收集书面确认",
                        draft="归档客户签字记录。",
                    )
                )
            targets = []
            for preview in prepared:
                result = confirm_project_question_remediation_promotion(
                    session,
                    project_id=int(project.id or 0),
                    question_sha256=project_question_sha256(QUESTION),
                    promotion_id=int(preview["id"]),
                    actor_user_id=int(owner.id or 0),
                    snapshot_sha256=str(preview["snapshot_sha256"]),
                    expected_revision=1,
                )
                targets.append(result["target"]["id"])

            self.assertEqual(len(session.exec(select(ProjectTodo)).all()), 1)
            self.assertEqual(targets[0], targets[1])
