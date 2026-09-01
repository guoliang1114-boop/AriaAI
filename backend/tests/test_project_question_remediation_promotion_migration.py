from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    BACKEND_DIR
    / "alembic"
    / "versions"
    / "040_v1_40_project_question_remediation_promotions.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_040", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_parent_tables(connection) -> None:
    connection.execute(text("CREATE TABLE project (id INTEGER PRIMARY KEY)"))
    connection.execute(text("CREATE TABLE user (id INTEGER PRIMARY KEY)"))
    connection.execute(text("CREATE TABLE projecttodo (id INTEGER PRIMARY KEY)"))


def test_revision_040_creates_idempotent_governed_promotion_contract() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_parent_tables(connection)
            original_op = migration.op
            migration.op = Operations(MigrationContext.configure(connection))
            try:
                migration.upgrade()
                migration.upgrade()
            finally:
                migration.op = original_op

            inspector = inspect(connection)
            tables = set(inspector.get_table_names())
            assert {
                "projectquestionremediationpromotion",
                "projectcommunicationrequest",
                "projectquestionremediationpromotionevent",
            } <= tables

            promotion_columns = {
                item["name"]: item
                for item in inspector.get_columns(
                    "projectquestionremediationpromotion"
                )
            }
            assert promotion_columns["snapshot_sha256"]["nullable"] is False
            assert promotion_columns["source_action_id"]["nullable"] is False
            assert promotion_columns["target_todo_id"]["nullable"] is True
            promotion_indexes = {
                item["name"]
                for item in inspector.get_indexes(
                    "projectquestionremediationpromotion"
                )
            }
            assert {
                "ix_projectquestionremediationpromotion_project_id",
                "ix_projectquestionremediationpromotion_action_sha256",
                "ix_projectquestionremediationpromotion_status",
            } <= promotion_indexes
            promotion_checks = {
                item["name"]
                for item in inspector.get_check_constraints(
                    "projectquestionremediationpromotion"
                )
            }
            assert {
                "ck_pq_remediation_promotion_target",
                "ck_pq_remediation_promotion_action",
                "ck_pq_remediation_promotion_status",
                "ck_pq_remediation_promotion_hashes",
            } <= promotion_checks
            promotion_foreign_keys = {
                tuple(item["constrained_columns"]): item
                for item in inspector.get_foreign_keys(
                    "projectquestionremediationpromotion"
                )
            }
            assert promotion_foreign_keys[("project_id",)]["options"].get("ondelete") == "CASCADE"
            assert promotion_foreign_keys[("target_todo_id",)]["options"].get("ondelete") == "SET NULL"

            communication_checks = {
                item["name"]
                for item in inspector.get_check_constraints(
                    "projectcommunicationrequest"
                )
            }
            assert {
                "ck_projectcommunicationrequest_status",
                "ck_projectcommunicationrequest_delivery",
            } <= communication_checks
            event_indexes = {
                item["name"]
                for item in inspector.get_indexes(
                    "projectquestionremediationpromotionevent"
                )
            }
            assert "ix_pq_remediation_event_communication_id" in event_indexes
    finally:
        engine.dispose()


def test_revision_040_is_the_single_alembic_head() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["042_v1_42"]
    revision = script.get_revision("040_v1_40")
    assert revision is not None
    assert revision.down_revision == "039_v1_39"
