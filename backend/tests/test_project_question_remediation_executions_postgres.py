"""Database contracts for governed remediation execution ledgers.

Production E2E runs this suite only in its backed-up disposable PostgreSQL
schema. The same contract can run against the configured test database locally.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, select

from app.models.db import (
    Project,
    ProjectCommunicationRequest,
    ProjectMember,
    ProjectQuestionRemediationEvidenceAttachment,
    ProjectQuestionRemediationExecution,
    ProjectQuestionRemediationExecutionEvent,
    ProjectQuestionResolution,
    User,
)
from app.services.project_question_remediation_executions import (
    attach_project_question_remediation_evidence,
    transition_project_question_remediation_execution,
)
from app.services.project_question_remediation_promotions import (
    confirm_project_question_remediation_promotion,
    prepare_project_question_remediation_promotion,
)
from app.services.project_question_resolutions import project_question_sha256
from tests.test_database import create_test_engine, drop_all_tables


QUESTION = "客户是否确认了最终验收范围？"
BASIS = "b" * 64


class ProjectQuestionRemediationExecutionDatabaseContractTests(unittest.TestCase):
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
    def _plan() -> dict:
        return {
            "basis": {"fingerprint": BASIS},
            "actions": [
                {"action_id": "remediation_01", "kind": "evidence_request"}
            ],
        }

    @staticmethod
    def _seed(session: Session) -> tuple[User, Project]:
        owner = User(email="execution-db@example.com", password_hash="x")
        project = Project(name="Execution DB", client="Test")
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

    def _confirm_communication(
        self,
        session: Session,
        *,
        owner: User,
        project: Project,
    ) -> ProjectQuestionRemediationExecution:
        prepared = prepare_project_question_remediation_promotion(
            session,
            project_id=int(project.id or 0),
            actor_user_id=int(owner.id or 0),
            question=QUESTION,
            question_sha256=project_question_sha256(QUESTION),
            evidence_basis_fingerprint=BASIS,
            idempotency_key="postgres-execution-key-0001",
            target_kind="communication_request",
            action_kind="evidence_request",
            source_action_id="remediation_01",
            title="请求书面确认",
            draft="请提供签字确认记录。",
            recipient_label="客户项目经理",
        )
        confirm_project_question_remediation_promotion(
            session,
            project_id=int(project.id or 0),
            question_sha256=project_question_sha256(QUESTION),
            promotion_id=int(prepared["id"]),
            actor_user_id=int(owner.id or 0),
            snapshot_sha256=str(prepared["snapshot_sha256"]),
            expected_revision=1,
        )
        return session.exec(select(ProjectQuestionRemediationExecution)).one()

    def test_manual_execution_round_trip_is_evidence_gated_and_non_resolving(self) -> None:
        with Session(self.engine) as session, patch(
            "app.services.project_question_remediation_promotions.build_project_question_remediation_plan",
            return_value=self._plan(),
        ):
            owner, project = self._seed(session)
            execution = self._confirm_communication(
                session,
                owner=owner,
                project=project,
            )

            sent = transition_project_question_remediation_execution(
                session,
                project_id=int(project.id or 0),
                execution_id=int(execution.id or 0),
                actor_user_id=int(owner.id or 0),
                action="mark_sent",
                expected_revision=1,
                note="用户证明已在 Aria 外部人工发送。",
            )
            attached = attach_project_question_remediation_evidence(
                session,
                project_id=int(project.id or 0),
                execution_id=int(execution.id or 0),
                actor_user_id=int(owner.id or 0),
                expected_revision=2,
                idempotency_key="postgres-evidence-key-0001",
                evidence_kind="external_reference",
                title="客户确认记录",
                note="外部记录仍需项目成员复核。",
                reference_locator="https://evidence.example.test/confirmations/1#private",
            )
            completed = transition_project_question_remediation_execution(
                session,
                project_id=int(project.id or 0),
                execution_id=int(execution.id or 0),
                actor_user_id=int(owner.id or 0),
                action="complete",
                expected_revision=3,
                note="项目负责人已核对外部记录。",
            )

            self.assertEqual(sent["status"], "sent_manually")
            self.assertEqual(attached["evidence_count"], 1)
            self.assertEqual(
                attached["evidence"][0]["reference_locator"],
                "https://evidence.example.test/confirmations/1",
            )
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(completed["question_resolution_status"], "open")
            self.assertFalse(completed["target"]["delivered_by_aria"])
            self.assertEqual(session.exec(select(ProjectQuestionResolution)).all(), [])
            request = session.exec(select(ProjectCommunicationRequest)).one()
            self.assertEqual(request.status, "completed")
            events = session.exec(
                select(ProjectQuestionRemediationExecutionEvent).order_by(
                    ProjectQuestionRemediationExecutionEvent.revision
                )
            ).all()
            self.assertEqual(
                [(event.action, event.status, event.revision) for event in events],
                [
                    ("created", "ready_for_manual_send", 1),
                    ("marked_sent", "sent_manually", 2),
                    ("evidence_attached", "sent_manually", 3),
                    ("completed", "completed", 4),
                ],
            )

    def test_database_rejects_duplicate_evidence_identity(self) -> None:
        with Session(self.engine) as session, patch(
            "app.services.project_question_remediation_promotions.build_project_question_remediation_plan",
            return_value=self._plan(),
        ):
            owner, project = self._seed(session)
            execution = self._confirm_communication(
                session,
                owner=owner,
                project=project,
            )
            attach_project_question_remediation_evidence(
                session,
                project_id=int(project.id or 0),
                execution_id=int(execution.id or 0),
                actor_user_id=int(owner.id or 0),
                expected_revision=1,
                idempotency_key="postgres-evidence-key-0002",
                evidence_kind="manual_note",
                title="人工证据记录",
                note="由项目负责人线下核验。",
            )
            original = session.exec(
                select(ProjectQuestionRemediationEvidenceAttachment)
            ).one()
            duplicate = ProjectQuestionRemediationEvidenceAttachment(
                execution_id=original.execution_id,
                project_id=original.project_id,
                question_sha256=original.question_sha256,
                execution_revision=3,
                idempotency_key_sha256="f" * 64,
                evidence_sha256=original.evidence_sha256,
                evidence_kind="manual_note",
                support_level="review_required",
                title="重复证据",
                note="不得重复写入。",
                attached_by_user_id=int(owner.id or 0),
            )
            session.add(duplicate)
            with self.assertRaises(IntegrityError):
                session.commit()
            session.rollback()
            self.assertEqual(
                len(session.exec(select(ProjectQuestionRemediationEvidenceAttachment)).all()),
                1,
            )
