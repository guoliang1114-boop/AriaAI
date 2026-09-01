from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = BACKEND_DIR / "alembic" / "versions" / "038_v1_38_project_question_resolutions.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_038", MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_parent_tables(connection) -> None:
    connection.execute(text("CREATE TABLE project (id INTEGER PRIMARY KEY)"))
    connection.execute(text("CREATE TABLE user (id INTEGER PRIMARY KEY)"))
    connection.execute(
        text(
            "CREATE TABLE conversation ("
            "id INTEGER PRIMARY KEY, project_id INTEGER, "
            "FOREIGN KEY(project_id) REFERENCES project(id))"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE message ("
            "id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, "
            "FOREIGN KEY(conversation_id) REFERENCES conversation(id))"
        )
    )


def test_revision_038_creates_idempotent_resolution_contract() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_parent_tables(connection)
            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()
            migration.upgrade()

            inspector = inspect(connection)
            assert "projectquestionresolution" in inspector.get_table_names()
            assert "projectquestionresolutionevent" in inspector.get_table_names()
            columns = {item["name"]: item for item in inspector.get_columns("projectquestionresolution")}
            assert columns["question_text"]["nullable"] is False
            assert columns["answer_message_id"]["nullable"] is True
            assert columns["resolution_revision"]["nullable"] is False
            indexes = {item["name"] for item in inspector.get_indexes("projectquestionresolution")}
            assert "ix_projectquestionresolution_project_id" in indexes
            assert "ix_projectquestionresolution_status" in indexes
            assert "ix_projectquestionresolution_answer_message_id" in indexes
            foreign_keys = {
                tuple(item["constrained_columns"]): item
                for item in inspector.get_foreign_keys("projectquestionresolution")
            }
            assert foreign_keys[("project_id",)]["options"].get("ondelete") == "CASCADE"
            assert foreign_keys[("answer_message_id",)]["options"].get("ondelete") == "SET NULL"
            checks = {item["name"] for item in inspector.get_check_constraints("projectquestionresolution")}
            assert "ck_projectquestionresolution_status" in checks
            assert "ck_projectquestionresolution_revision" in checks
            event_indexes = {
                item["name"]
                for item in inspector.get_indexes("projectquestionresolutionevent")
            }
            assert "ix_projectquestionresolutionevent_resolution_id" in event_indexes
            assert "ix_projectquestionresolutionevent_action" in event_indexes
            event_checks = {
                item["name"]
                for item in inspector.get_check_constraints("projectquestionresolutionevent")
            }
            assert "ck_projectquestionresolutionevent_action" in event_checks
    finally:
        engine.dispose()


def test_revision_038_precedes_the_current_alembic_head() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["042_v1_42"]
    revision = script.get_revision("038_v1_38")
    assert revision is not None
    assert revision.down_revision == "037_v1_37"
    current = script.get_revision("040_v1_40")
    assert current is not None
    assert current.down_revision == "039_v1_39"
