"""V1.41 - Governed remediation execution lifecycle and evidence.

Revision ID: 041_v1_41
Revises: 040_v1_40
Create Date: 2026-09-01
"""
from __future__ import annotations

from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "041_v1_41"
down_revision = "040_v1_40"
branch_labels = None
depends_on = None


PROMOTION_TABLE = "projectquestionremediationpromotion"
PROMOTION_EVENT_TABLE = "projectquestionremediationpromotionevent"
COMMUNICATION_TABLE = "projectcommunicationrequest"
EXECUTION_TABLE = "projectquestionremediationexecution"
EVIDENCE_TABLE = "projectquestionremediationevidenceattachment"
EXECUTION_EVENT_TABLE = "projectquestionremediationexecutionevent"

COMMUNICATION_STATUS_CHECK = (
    "status IN ('ready_for_manual_send', 'sent_manually', 'completed', 'cancelled')"
)


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


def _communication_check_is_extended() -> bool:
    if COMMUNICATION_TABLE not in _tables():
        return False
    for item in inspect(op.get_bind()).get_check_constraints(COMMUNICATION_TABLE):
        if item.get("name") != "ck_projectcommunicationrequest_status":
            continue
        sqltext = str(item.get("sqltext") or "")
        return "sent_manually" in sqltext and "completed" in sqltext
    return False


def _replace_communication_status_check(*, extended: bool) -> None:
    if COMMUNICATION_TABLE not in _tables():
        return
    bind = op.get_bind()
    checks = {
        str(item.get("name"))
        for item in inspect(bind).get_check_constraints(COMMUNICATION_TABLE)
        if item.get("name")
    }
    constraint_name = "ck_projectcommunicationrequest_status"
    expression = (
        COMMUNICATION_STATUS_CHECK
        if extended
        else "status IN ('ready_for_manual_send', 'cancelled')"
    )
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table(COMMUNICATION_TABLE, recreate="always") as batch_op:
            if constraint_name in checks:
                batch_op.drop_constraint(constraint_name, type_="check")
            batch_op.create_check_constraint(constraint_name, expression)
        return
    if constraint_name in checks:
        op.drop_constraint(constraint_name, COMMUNICATION_TABLE, type_="check")
    op.create_check_constraint(constraint_name, COMMUNICATION_TABLE, expression)


def _create_execution_table() -> None:
    op.create_table(
        EXECUTION_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("source_promotion_id", sa.Integer(), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("question_sha256", sa.String(), nullable=False),
        sa.Column("target_kind", sa.String(), nullable=False),
        sa.Column("target_todo_id", sa.Integer(), nullable=True),
        sa.Column("communication_request_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("evidence_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_transition_note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("last_transition_by_user_id", sa.Integer(), nullable=True),
        sa.Column("last_transition_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "target_kind IN ('project_todo', 'communication_request')",
            name="ck_pq_rexec_target_kind",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'ready_for_manual_send', 'sent_manually', "
            "'completed', 'cancelled')",
            name="ck_pq_rexec_status",
        ),
        sa.CheckConstraint(
            "revision >= 1 AND evidence_count >= 0 "
            "AND length(question_sha256) = 64",
            name="ck_pq_rexec_revision_identity",
        ),
        sa.CheckConstraint(
            "(target_kind = 'project_todo' AND target_todo_id IS NOT NULL "
            "AND communication_request_id IS NULL) OR "
            "(target_kind = 'communication_request' AND target_todo_id IS NULL "
            "AND communication_request_id IS NOT NULL)",
            name="ck_pq_rexec_target_reference",
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["source_promotion_id"],
            [f"{PROMOTION_TABLE}.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_todo_id"], ["projecttodo.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["communication_request_id"],
            [f"{COMMUNICATION_TABLE}.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["last_transition_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_promotion_id", name="uq_pq_rexec_source_promotion"
        ),
        sa.UniqueConstraint("target_todo_id", name="uq_pq_rexec_target_todo"),
        sa.UniqueConstraint(
            "communication_request_id", name="uq_pq_rexec_communication"
        ),
    )


def _ensure_execution_indexes() -> None:
    _ensure_indexes(
        EXECUTION_TABLE,
        {
            "ix_pq_rexec_project": ["project_id"],
            "ix_pq_rexec_question": ["question_sha256"],
            "ix_pq_rexec_status": ["status"],
            "ix_pq_rexec_todo": ["target_todo_id"],
            "ix_pq_rexec_communication": ["communication_request_id"],
            "ix_pq_rexec_updated": ["updated_at"],
        },
    )


def _create_evidence_table() -> None:
    op.create_table(
        EVIDENCE_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("execution_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("question_sha256", sa.String(), nullable=False),
        sa.Column("execution_revision", sa.Integer(), nullable=False),
        sa.Column("idempotency_key_sha256", sa.String(), nullable=False),
        sa.Column("evidence_sha256", sa.String(), nullable=False),
        sa.Column("evidence_kind", sa.String(), nullable=False),
        sa.Column("support_level", sa.String(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("reference_locator", sa.Text(), nullable=False, server_default=""),
        sa.Column("project_file_id", sa.Integer(), nullable=True),
        sa.Column("knowledge_document_id", sa.Integer(), nullable=True),
        sa.Column("message_id", sa.Integer(), nullable=True),
        sa.Column("attached_by_user_id", sa.Integer(), nullable=True),
        sa.Column("attached_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "evidence_kind IN ('project_file', 'knowledge_document', 'message', "
            "'external_reference', 'manual_note')",
            name="ck_pq_revidence_kind",
        ),
        sa.CheckConstraint(
            "support_level IN ('direct', 'review_required')",
            name="ck_pq_revidence_support",
        ),
        sa.CheckConstraint(
            "execution_revision >= 2 AND length(question_sha256) = 64 "
            "AND length(idempotency_key_sha256) = 64 "
            "AND length(evidence_sha256) = 64",
            name="ck_pq_revidence_hashes",
        ),
        sa.CheckConstraint(
            "(evidence_kind = 'project_file' AND project_file_id IS NOT NULL "
            "AND knowledge_document_id IS NULL AND message_id IS NULL "
            "AND reference_locator = '') OR "
            "(evidence_kind = 'knowledge_document' AND project_file_id IS NULL "
            "AND knowledge_document_id IS NOT NULL AND message_id IS NULL "
            "AND reference_locator = '') OR "
            "(evidence_kind = 'message' AND project_file_id IS NULL "
            "AND knowledge_document_id IS NULL AND message_id IS NOT NULL "
            "AND reference_locator = '') OR "
            "(evidence_kind = 'external_reference' AND project_file_id IS NULL "
            "AND knowledge_document_id IS NULL AND message_id IS NULL "
            "AND length(reference_locator) > 0) OR "
            "(evidence_kind = 'manual_note' AND project_file_id IS NULL "
            "AND knowledge_document_id IS NULL AND message_id IS NULL "
            "AND reference_locator = '' AND length(note) > 0)",
            name="ck_pq_revidence_reference",
        ),
        sa.ForeignKeyConstraint(
            ["execution_id"], [f"{EXECUTION_TABLE}.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["project_file_id"], ["projectfile.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["knowledge_document_id"],
            ["knowledgedocument.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["message_id"], ["message.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["attached_by_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "execution_id",
            "idempotency_key_sha256",
            name="uq_pq_revidence_idempotency",
        ),
        sa.UniqueConstraint(
            "execution_id",
            "evidence_sha256",
            name="uq_pq_revidence_identity",
        ),
    )


def _ensure_evidence_indexes() -> None:
    _ensure_indexes(
        EVIDENCE_TABLE,
        {
            "ix_pq_revidence_execution": ["execution_id"],
            "ix_pq_revidence_project": ["project_id"],
            "ix_pq_revidence_question": ["question_sha256"],
            "ix_pq_revidence_kind": ["evidence_kind"],
            "ix_pq_revidence_attached": ["attached_at"],
        },
    )


def _create_execution_event_table() -> None:
    op.create_table(
        EXECUTION_EVENT_TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("execution_id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("actor_user_id", sa.Integer(), nullable=True),
        sa.Column("evidence_attachment_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "action IN ('created', 'marked_sent', 'completed', 'cancelled', "
            "'evidence_attached')",
            name="ck_pq_rexec_event_action",
        ),
        sa.CheckConstraint(
            "status IN ('active', 'ready_for_manual_send', 'sent_manually', "
            "'completed', 'cancelled')",
            name="ck_pq_rexec_event_status",
        ),
        sa.CheckConstraint("revision >= 1", name="ck_pq_rexec_event_revision"),
        sa.ForeignKeyConstraint(
            ["execution_id"], [f"{EXECUTION_TABLE}.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["project.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["actor_user_id"], ["user.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["evidence_attachment_id"], [f"{EVIDENCE_TABLE}.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "execution_id", "revision", name="uq_pq_rexec_event_revision"
        ),
    )


def _ensure_execution_event_indexes() -> None:
    _ensure_indexes(
        EXECUTION_EVENT_TABLE,
        {
            "ix_pq_rexec_event_execution": ["execution_id"],
            "ix_pq_rexec_event_project": ["project_id"],
            "ix_pq_rexec_event_action": ["action"],
            "ix_pq_rexec_event_status": ["status"],
            "ix_pq_rexec_event_actor": ["actor_user_id"],
            "ix_pq_rexec_event_evidence": ["evidence_attachment_id"],
            "ix_pq_rexec_event_created": ["created_at"],
        },
    )


def _backfill_confirmed_targets() -> None:
    required = {
        PROMOTION_TABLE,
        PROMOTION_EVENT_TABLE,
        COMMUNICATION_TABLE,
        EXECUTION_TABLE,
        EXECUTION_EVENT_TABLE,
        "projecttodo",
    }
    if not required <= _tables():
        return
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            f"""
            SELECT event.promotion_id,
                   event.project_id,
                   event.target_todo_id,
                   event.communication_request_id,
                   event.actor_user_id,
                   event.created_at,
                   promotion.question_text,
                   promotion.question_sha256,
                   todo.is_done AS todo_is_done,
                   communication.status AS communication_status
              FROM {PROMOTION_EVENT_TABLE} AS event
              JOIN {PROMOTION_TABLE} AS promotion
                ON promotion.id = event.promotion_id
         LEFT JOIN projecttodo AS todo
                ON todo.id = event.target_todo_id
         LEFT JOIN {COMMUNICATION_TABLE} AS communication
                ON communication.id = event.communication_request_id
             WHERE event.action = 'confirmed'
               AND (event.target_todo_id IS NOT NULL
                    OR event.communication_request_id IS NOT NULL)
          ORDER BY event.created_at, event.id
            """
        )
    ).mappings().all()
    metadata = sa.MetaData()
    execution_table = sa.Table(EXECUTION_TABLE, metadata, autoload_with=bind)
    event_table = sa.Table(EXECUTION_EVENT_TABLE, metadata, autoload_with=bind)
    for row in rows:
        if row["target_todo_id"] is not None:
            existing = bind.execute(
                sa.select(execution_table.c.id).where(
                    execution_table.c.target_todo_id == row["target_todo_id"]
                )
            ).scalar_one_or_none()
            target_kind = "project_todo"
            status = "completed" if bool(row["todo_is_done"]) else "active"
        else:
            existing = bind.execute(
                sa.select(execution_table.c.id).where(
                    execution_table.c.communication_request_id
                    == row["communication_request_id"]
                )
            ).scalar_one_or_none()
            target_kind = "communication_request"
            status = str(row["communication_status"] or "ready_for_manual_send")
        timestamp = row["created_at"]
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp)
        if existing is None:
            bind.execute(
                execution_table.insert().values(
                    project_id=row["project_id"],
                    source_promotion_id=row["promotion_id"],
                    question_text=row["question_text"],
                    question_sha256=row["question_sha256"],
                    target_kind=target_kind,
                    target_todo_id=row["target_todo_id"],
                    communication_request_id=row["communication_request_id"],
                    status=status,
                    revision=1,
                    evidence_count=0,
                    last_transition_note="backfilled_from_confirmed_promotion",
                    created_by_user_id=row["actor_user_id"],
                    last_transition_by_user_id=row["actor_user_id"],
                    last_transition_at=timestamp,
                    created_at=timestamp,
                    updated_at=timestamp,
                )
            )
            execution_id = bind.execute(
                sa.select(execution_table.c.id).where(
                    execution_table.c.source_promotion_id == row["promotion_id"]
                )
            ).scalar_one()
        else:
            execution_id = int(existing)
        event_exists = bind.execute(
            sa.select(event_table.c.id).where(
                event_table.c.execution_id == execution_id,
                event_table.c.revision == 1,
            )
        ).scalar_one_or_none()
        if event_exists is not None:
            continue
        existing_status = bind.execute(
            sa.select(execution_table.c.status).where(
                execution_table.c.id == execution_id
            )
        ).scalar_one()
        bind.execute(
            event_table.insert().values(
                execution_id=execution_id,
                project_id=row["project_id"],
                revision=1,
                action="created",
                status=existing_status,
                actor_user_id=row["actor_user_id"],
                evidence_attachment_id=None,
                note="backfilled_from_confirmed_promotion",
                created_at=timestamp,
            )
        )


def upgrade() -> None:
    if not _communication_check_is_extended():
        _replace_communication_status_check(extended=True)
    if EXECUTION_TABLE not in _tables():
        _create_execution_table()
    _ensure_execution_indexes()
    if EVIDENCE_TABLE not in _tables():
        _create_evidence_table()
    _ensure_evidence_indexes()
    if EXECUTION_EVENT_TABLE not in _tables():
        _create_execution_event_table()
    _ensure_execution_event_indexes()
    _backfill_confirmed_targets()


def downgrade() -> None:
    if EXECUTION_EVENT_TABLE in _tables():
        op.drop_table(EXECUTION_EVENT_TABLE)
    if EVIDENCE_TABLE in _tables():
        op.drop_table(EVIDENCE_TABLE)
    if EXECUTION_TABLE in _tables():
        op.drop_table(EXECUTION_TABLE)
    if COMMUNICATION_TABLE in _tables():
        op.execute(
            sa.text(
                f"UPDATE {COMMUNICATION_TABLE} "
                "SET status = 'ready_for_manual_send' "
                "WHERE status IN ('sent_manually', 'completed')"
            )
        )
        _replace_communication_status_check(extended=False)
