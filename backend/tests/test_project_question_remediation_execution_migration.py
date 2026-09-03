from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_040 = (
    BACKEND_DIR
    / "alembic"
    / "versions"
    / "040_v1_40_project_question_remediation_promotions.py"
)
MIGRATION_041 = (
    BACKEND_DIR
    / "alembic"
    / "versions"
    / "041_v1_41_project_question_remediation_executions.py"
)
MIGRATION_042 = (
    BACKEND_DIR
    / "alembic"
    / "versions"
    / "042_v1_42_project_question_remediation_evidence_reviews.py"
)


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_parent_tables(connection) -> None:
    connection.execute(text("CREATE TABLE project (id INTEGER PRIMARY KEY)"))
    connection.execute(text("CREATE TABLE user (id INTEGER PRIMARY KEY)"))
    connection.execute(
        text(
            "CREATE TABLE projecttodo ("
            "id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, is_done BOOLEAN NOT NULL)"
        )
    )
    connection.execute(text("CREATE TABLE projectfile (id INTEGER PRIMARY KEY)"))
    connection.execute(text("CREATE TABLE knowledgedocument (id INTEGER PRIMARY KEY)"))
    connection.execute(text("CREATE TABLE message (id INTEGER PRIMARY KEY)"))


def _run(module, connection) -> None:
    original_op = module.op
    module.op = Operations(MigrationContext.configure(connection))
    try:
        module.upgrade()
    finally:
        module.op = original_op


def test_revision_041_creates_execution_evidence_and_backfills_idempotently() -> None:
    migration_040 = _load(MIGRATION_040, "aria_migration_040_for_041")
    migration_041 = _load(MIGRATION_041, "aria_migration_041")
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_parent_tables(connection)
            _run(migration_040, connection)
            connection.execute(text("INSERT INTO project (id) VALUES (1)"))
            connection.execute(text("INSERT INTO user (id) VALUES (2)"))
            connection.execute(
                text(
                    "INSERT INTO projecttodo (id, project_id, is_done) "
                    "VALUES (3, 1, 0)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO projectquestionremediationpromotion ("
                    "id, project_id, question_text, question_sha256, "
                    "idempotency_key_sha256, action_sha256, snapshot_sha256, "
                    "evidence_basis_sha256, target_kind, action_kind, "
                    "source_action_id, title, draft, due_date, recipient_label, "
                    "status, revision, target_todo_id, failure_code, decision_reason, "
                    "expires_at, created_at, updated_at"
                    ") VALUES ("
                    "10, 1, 'Question?', :question_sha, :key_sha, :action_sha, "
                    ":snapshot_sha, :basis_sha, 'project_todo', 'evidence_request', "
                    "'remediation_01', 'Collect evidence', '', '', '', 'confirmed', "
                    "2, 3, '', 'confirmed_by_user', :timestamp, :timestamp, :timestamp"
                    ")"
                ),
                {
                    "question_sha": "a" * 64,
                    "key_sha": "b" * 64,
                    "action_sha": "c" * 64,
                    "snapshot_sha": "d" * 64,
                    "basis_sha": "e" * 64,
                    "timestamp": "2026-09-01 00:00:00",
                },
            )
            connection.execute(
                text(
                    "INSERT INTO projectquestionremediationpromotionevent ("
                    "id, promotion_id, project_id, revision, action, status, "
                    "snapshot_sha256, actor_user_id, target_todo_id, note, created_at"
                    ") VALUES (20, 10, 1, 2, 'confirmed', 'confirmed', :snapshot, "
                    "2, 3, 'confirmed_by_user', :timestamp)"
                ),
                {"snapshot": "d" * 64, "timestamp": "2026-09-01 00:00:00"},
            )

            _run(migration_041, connection)
            connection.execute(
                text("DELETE FROM projectquestionremediationexecutionevent")
            )
            _run(migration_041, connection)

            inspector = inspect(connection)
            assert {
                "projectquestionremediationexecution",
                "projectquestionremediationevidenceattachment",
                "projectquestionremediationexecutionevent",
            } <= set(inspector.get_table_names())
            execution_checks = {
                item["name"]
                for item in inspector.get_check_constraints(
                    "projectquestionremediationexecution"
                )
            }
            assert {
                "ck_pq_rexec_target_kind",
                "ck_pq_rexec_status",
                "ck_pq_rexec_revision_identity",
                "ck_pq_rexec_target_reference",
            } <= execution_checks
            evidence_checks = {
                item["name"]
                for item in inspector.get_check_constraints(
                    "projectquestionremediationevidenceattachment"
                )
            }
            assert {
                "ck_pq_revidence_kind",
                "ck_pq_revidence_support",
                "ck_pq_revidence_hashes",
                "ck_pq_revidence_reference",
            } <= evidence_checks
            event_indexes = {
                item["name"]
                for item in inspector.get_indexes(
                    "projectquestionremediationexecutionevent"
                )
            }
            assert {
                "ix_pq_rexec_event_execution",
                "ix_pq_rexec_event_evidence",
            } <= event_indexes
            communication_check = next(
                item
                for item in inspector.get_check_constraints(
                    "projectcommunicationrequest"
                )
                if item["name"] == "ck_projectcommunicationrequest_status"
            )
            assert "sent_manually" in str(communication_check["sqltext"])
            assert "completed" in str(communication_check["sqltext"])

            executions = connection.execute(
                text(
                    "SELECT source_promotion_id, target_todo_id, status, revision "
                    "FROM projectquestionremediationexecution"
                )
            ).all()
            assert executions == [(10, 3, "active", 1)]
            events = connection.execute(
                text(
                    "SELECT action, status, revision, note "
                    "FROM projectquestionremediationexecutionevent"
                )
            ).all()
            assert events == [
                ("created", "active", 1, "backfilled_from_confirmed_promotion")
            ]
    finally:
        engine.dispose()


def test_revision_042_creates_review_ledgers_idempotently() -> None:
    migration_040 = _load(MIGRATION_040, "aria_migration_040_for_042")
    migration_041 = _load(MIGRATION_041, "aria_migration_041_for_042")
    migration_042 = _load(MIGRATION_042, "aria_migration_042")
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_parent_tables(connection)
            _run(migration_040, connection)
            _run(migration_041, connection)
            _run(migration_042, connection)
            _run(migration_042, connection)

            inspector = inspect(connection)
            assert {
                "projectquestionremediationevidencereview",
                "projectquestionremediationevidencereviewevent",
            } <= set(inspector.get_table_names())
            review_checks = {
                item["name"]
                for item in inspector.get_check_constraints(
                    "projectquestionremediationevidencereview"
                )
            }
            assert {
                "ck_pq_rereview_status",
                "ck_pq_rereview_revision_identity",
            } <= review_checks
            review_uniques = {
                item["name"]
                for item in inspector.get_unique_constraints(
                    "projectquestionremediationevidencereview"
                )
            }
            assert "uq_pq_rereview_attachment" in review_uniques
            event_indexes = {
                item["name"]
                for item in inspector.get_indexes(
                    "projectquestionremediationevidencereviewevent"
                )
            }
            assert {
                "ix_pq_rerevent_review",
                "ix_pq_rerevent_attachment",
                "ix_pq_rerevent_project",
            } <= event_indexes
            event_uniques = {
                item["name"]
                for item in inspector.get_unique_constraints(
                    "projectquestionremediationevidencereviewevent"
                )
            }
            assert "uq_pq_rerevent_revision" in event_uniques
    finally:
        engine.dispose()


def test_revision_042_is_the_single_alembic_head() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["043_v1_43"]
    revision = script.get_revision("041_v1_41")
    assert revision is not None
    assert revision.down_revision == "040_v1_40"
    latest = script.get_revision("042_v1_42")
    assert latest is not None
    assert latest.down_revision == "041_v1_41"
