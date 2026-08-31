"""V1.40 - Governed project-question remediation promotions.

Revision ID: 040_v1_40
Revises: 039_v1_39
Create Date: 2026-08-31
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "040_v1_40"
down_revision = "039_v1_39"
branch_labels = None
depends_on = None


PROMOTION_TABLE = "projectquestionremediationpromotion"
COMMUNICATION_TABLE = "projectcommunicationrequest"
EVENT_TABLE = "projectquestionremediationpromotionevent"


def _tables() -> set[str]:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table_name: str) -> set[str]:
    if table_name not in _tables():
        return set()
    return {
        str(item["name"])
        for item in inspect(op.get_bind()).get_indexes(table_name)
    }


def _ensure_indexes(table_name: str, definitions: dict[str, list[str]]) -> None:
    existing = _indexes(table_name)
    for name, columns in definitions.items():
        if name not in existing:
            op.create_index(name, table_name, columns, unique=False)


def _create_promotion_table() -> None:
    op.create_table(
        PROMOTION_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_sha256", sa.String(), nullable=False),
        sa.Column("idempotency_key_sha256", sa.String(), nullable=False),
        sa.Column("action_sha256", sa.String(), nullable=False),
        sa.Column("snapshot_sha256", sa.String(), nullable=False),
        sa.Column("evidence_basis_sha256", sa.String(), nullable=False),
        sa.Column("target_kind", sa.String(), nullable=False),
        sa.Column("action_kind", sa.String(), nullable=False),
        sa.Column("source_action_id", sa.String(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("draft", sa.Text(), nullable=False, server_default=""),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("due_date", sa.String(), nullable=False, server_default=""),
        sa.Column("recipient_label", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("target_todo_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("failure_code", sa.String(), nullable=False, server_default=""),
        sa.Column("decision_reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "target_kind IN ('project_todo', 'communication_request')",
            name="ck_pq_remediation_promotion_target",
        ),
        sa.CheckConstraint(
            "action_kind IN ('clarification_question', 'evidence_request', "
            "'internal_check', 'candidate_review', 'human_verification')",
            name="ck_pq_remediation_promotion_action",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'rejected', 'failed', 'expired')",
            name="ck_pq_remediation_promotion_status",
        ),
        sa.CheckConstraint(
            "revision >= 1",
            name="ck_pq_remediation_promotion_revision",
        ),
        sa.CheckConstraint(
            "length(idempotency_key_sha256) = 64 AND length(action_sha256) = 64 "
            "AND length(snapshot_sha256) = 64 "
            "AND length(evidence_basis_sha256) = 64",
            name="ck_pq_remediation_promotion_hashes",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_todo_id"], ["projecttodo.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "project_id",
            "idempotency_key_sha256",
            name="uq_pq_remediation_promotion_idempotency",
        ),
    )


def _ensure_promotion_indexes() -> None:
    _ensure_indexes(
        PROMOTION_TABLE,
        {
            "ix_projectquestionremediationpromotion_project_id": ["project_id"],
            "ix_projectquestionremediationpromotion_question_sha256": ["question_sha256"],
            "ix_projectquestionremediationpromotion_idempotency_key_sha256": ["idempotency_key_sha256"],
            "ix_projectquestionremediationpromotion_action_sha256": ["action_sha256"],
            "ix_projectquestionremediationpromotion_snapshot_sha256": ["snapshot_sha256"],
            "ix_projectquestionremediationpromotion_evidence_basis_sha256": ["evidence_basis_sha256"],
            "ix_projectquestionremediationpromotion_target_kind": ["target_kind"],
            "ix_projectquestionremediationpromotion_action_kind": ["action_kind"],
            "ix_projectquestionremediationpromotion_owner_user_id": ["owner_user_id"],
            "ix_projectquestionremediationpromotion_due_date": ["due_date"],
            "ix_projectquestionremediationpromotion_status": ["status"],
            "ix_projectquestionremediationpromotion_target_todo_id": ["target_todo_id"],
            "ix_projectquestionremediationpromotion_created_by_user_id": ["created_by_user_id"],
            "ix_projectquestionremediationpromotion_decided_by_user_id": ["decided_by_user_id"],
            "ix_projectquestionremediationpromotion_failure_code": ["failure_code"],
            "ix_projectquestionremediationpromotion_expires_at": ["expires_at"],
            "ix_projectquestionremediationpromotion_decided_at": ["decided_at"],
            "ix_projectquestionremediationpromotion_created_at": ["created_at"],
            "ix_projectquestionremediationpromotion_updated_at": ["updated_at"],
        },
    )


def _create_communication_table() -> None:
    op.create_table(
        COMMUNICATION_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("source_promotion_id", sa.Integer(), nullable=False),
        sa.Column("question_sha256", sa.String(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("recipient_label", sa.String(), nullable=False),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("due_date", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="ready_for_manual_send"),
        sa.Column("delivery_mode", sa.String(), nullable=False, server_default="manual_only"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('ready_for_manual_send', 'cancelled')",
            name="ck_projectcommunicationrequest_status",
        ),
        sa.CheckConstraint(
            "delivery_mode = 'manual_only'",
            name="ck_projectcommunicationrequest_delivery",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_promotion_id"], [f"{PROMOTION_TABLE}.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_promotion_id",
            name="uq_projectcommunicationrequest_source_promotion",
        ),
    )


def _ensure_communication_indexes() -> None:
    _ensure_indexes(
        COMMUNICATION_TABLE,
        {
            "ix_projectcommunicationrequest_project_id": ["project_id"],
            "ix_projectcommunicationrequest_source_promotion_id": ["source_promotion_id"],
            "ix_projectcommunicationrequest_question_sha256": ["question_sha256"],
            "ix_projectcommunicationrequest_recipient_label": ["recipient_label"],
            "ix_projectcommunicationrequest_owner_user_id": ["owner_user_id"],
            "ix_projectcommunicationrequest_due_date": ["due_date"],
            "ix_projectcommunicationrequest_status": ["status"],
            "ix_projectcommunicationrequest_delivery_mode": ["delivery_mode"],
            "ix_projectcommunicationrequest_created_by_user_id": ["created_by_user_id"],
            "ix_projectcommunicationrequest_created_at": ["created_at"],
            "ix_projectcommunicationrequest_updated_at": ["updated_at"],
        },
    )


def _create_event_table() -> None:
    op.create_table(
        EVENT_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("promotion_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("snapshot_sha256", sa.String(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("target_todo_id", sa.Integer(), nullable=True),
        sa.Column("communication_request_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "action IN ('prepared', 'confirmed', 'rejected', 'failed', 'expired')",
            name="ck_pq_remediation_promotion_event_action",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'rejected', 'failed', 'expired')",
            name="ck_pq_remediation_promotion_event_status",
        ),
        sa.CheckConstraint(
            "revision >= 1 AND length(snapshot_sha256) = 64",
            name="ck_pq_remediation_promotion_event_identity",
        ),
        sa.ForeignKeyConstraint(["promotion_id"], [f"{PROMOTION_TABLE}.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["target_todo_id"], ["projecttodo.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["communication_request_id"], [f"{COMMUNICATION_TABLE}.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "promotion_id",
            "revision",
            name="uq_pq_remediation_promotion_event_revision",
        ),
    )


def _ensure_event_indexes() -> None:
    _ensure_indexes(
        EVENT_TABLE,
        {
            "ix_projectquestionremediationpromotionevent_promotion_id": ["promotion_id"],
            "ix_projectquestionremediationpromotionevent_project_id": ["project_id"],
            "ix_projectquestionremediationpromotionevent_revision": ["revision"],
            "ix_projectquestionremediationpromotionevent_action": ["action"],
            "ix_projectquestionremediationpromotionevent_status": ["status"],
            "ix_projectquestionremediationpromotionevent_snapshot_sha256": ["snapshot_sha256"],
            "ix_projectquestionremediationpromotionevent_actor_user_id": ["actor_user_id"],
            "ix_projectquestionremediationpromotionevent_target_todo_id": ["target_todo_id"],
            "ix_pq_remediation_event_communication_id": ["communication_request_id"],
            "ix_projectquestionremediationpromotionevent_created_at": ["created_at"],
        },
    )


def upgrade() -> None:
    if PROMOTION_TABLE not in _tables():
        _create_promotion_table()
    _ensure_promotion_indexes()
    if COMMUNICATION_TABLE not in _tables():
        _create_communication_table()
    _ensure_communication_indexes()
    if EVENT_TABLE not in _tables():
        _create_event_table()
    _ensure_event_indexes()


def downgrade() -> None:
    if EVENT_TABLE in _tables():
        op.drop_table(EVENT_TABLE)
    if COMMUNICATION_TABLE in _tables():
        op.drop_table(COMMUNICATION_TABLE)
    if PROMOTION_TABLE in _tables():
        op.drop_table(PROMOTION_TABLE)
