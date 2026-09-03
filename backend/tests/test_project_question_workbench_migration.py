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
    / "039_v1_39_project_question_workbench.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_039", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_parent_tables(connection) -> None:
    connection.execute(text("CREATE TABLE project (id INTEGER PRIMARY KEY)"))
    connection.execute(text("CREATE TABLE user (id INTEGER PRIMARY KEY)"))


def test_revision_039_creates_idempotent_question_profile_contract() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_parent_tables(connection)
            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()
            migration.upgrade()

            inspector = inspect(connection)
            assert "projectquestionprofile" in inspector.get_table_names()
            assert "projectquestionprofileevent" in inspector.get_table_names()
            columns = {
                item["name"]: item
                for item in inspector.get_columns("projectquestionprofile")
            }
            assert columns["question_text"]["nullable"] is False
            assert columns["owner_user_id"]["nullable"] is True
            assert columns["revision"]["nullable"] is False
            indexes = {
                item["name"]
                for item in inspector.get_indexes("projectquestionprofile")
            }
            assert "ix_projectquestionprofile_project_id" in indexes
            assert "ix_projectquestionprofile_owner_user_id" in indexes
            assert "ix_projectquestionprofile_due_date" in indexes
            foreign_keys = {
                tuple(item["constrained_columns"]): item
                for item in inspector.get_foreign_keys("projectquestionprofile")
            }
            assert foreign_keys[("project_id",)]["options"].get("ondelete") == "CASCADE"
            assert foreign_keys[("owner_user_id",)]["options"].get("ondelete") == "SET NULL"
            checks = {
                item["name"]
                for item in inspector.get_check_constraints("projectquestionprofile")
            }
            assert "ck_projectquestionprofile_priority" in checks
            assert "ck_projectquestionprofile_revision" in checks

            event_indexes = {
                item["name"]
                for item in inspector.get_indexes("projectquestionprofileevent")
            }
            assert "ix_projectquestionprofileevent_profile_id" in event_indexes
            assert "ix_projectquestionprofileevent_actor_user_id" in event_indexes
            event_checks = {
                item["name"]
                for item in inspector.get_check_constraints(
                    "projectquestionprofileevent"
                )
            }
            assert "ck_projectquestionprofileevent_revision" in event_checks
            assert "ck_projectquestionprofileevent_priorities" in event_checks
    finally:
        engine.dispose()


def test_revision_039_precedes_the_single_alembic_head() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["043_v1_43"]
    revision = script.get_revision("039_v1_39")
    assert revision is not None
    assert revision.down_revision == "038_v1_38"
    current = script.get_revision("040_v1_40")
    assert current is not None
    assert current.down_revision == "039_v1_39"
