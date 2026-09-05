"""Contract tests for the V1.48 native memory operation-state cutover."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlmodel import create_engine


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    BACKEND_DIR
    / "alembic"
    / "versions"
    / "048_v1_48_native_memory_operation_state.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_048", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 048")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_upgrade(migration, connection) -> None:
    original_op = migration.op
    migration.op = Operations(MigrationContext.configure(connection))
    try:
        migration.upgrade()
    finally:
        migration.op = original_op


def test_revision_048_adds_and_backfills_native_operation_columns_idempotently() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE project (id INTEGER PRIMARY KEY, "
                    "context_memory_json TEXT NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE clientrecord (id INTEGER PRIMARY KEY, "
                    "client_memory_json TEXT NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO project (id, context_memory_json) VALUES "
                    "(1, :valid), (2, 'not-json')"
                ),
                {
                    "valid": json.dumps(
                        {
                            "_last_failure": {"stage": "summary"},
                            "_client_promotion": {
                                "status": "completed",
                                "client_id": 8,
                            },
                        }
                    )
                },
            )
            connection.execute(
                text(
                    "INSERT INTO clientrecord (id, client_memory_json) VALUES "
                    "(1, :valid), (2, '[]')"
                ),
                {
                    "valid": json.dumps(
                        {
                            "_last_failure": {"stage": "rebuild"},
                            "_rebuild_generation": "epoch-1",
                        }
                    )
                },
            )

            _run_upgrade(migration, connection)
            connection.execute(
                text(
                    "UPDATE project SET memory_last_failure_json = :native "
                    "WHERE id = 1"
                ),
                {"native": json.dumps({"stage": "native"})},
            )
            _run_upgrade(migration, connection)

            project = connection.execute(
                text(
                    "SELECT memory_last_failure_json, client_memory_promotion_json "
                    "FROM project WHERE id = 1"
                )
            ).one()
            malformed_project = connection.execute(
                text(
                    "SELECT memory_last_failure_json, client_memory_promotion_json "
                    "FROM project WHERE id = 2"
                )
            ).one()
            client = connection.execute(
                text(
                    "SELECT client_memory_last_failure_json, "
                    "client_memory_rebuild_generation FROM clientrecord WHERE id = 1"
                )
            ).one()

            assert json.loads(project[0]) == {"stage": "native"}
            assert json.loads(project[1]) == {"status": "completed", "client_id": 8}
            assert malformed_project == ("", "")
            assert json.loads(client[0]) == {"stage": "rebuild"}
            assert client[1] == "epoch-1"

            project_columns = {
                item["name"] for item in inspect(connection).get_columns("project")
            }
            client_columns = {
                item["name"]
                for item in inspect(connection).get_columns("clientrecord")
            }
            assert {
                "memory_last_failure_json",
                "client_memory_promotion_json",
            } <= project_columns
            assert {
                "client_memory_last_failure_json",
                "client_memory_rebuild_generation",
            } <= client_columns
    finally:
        engine.dispose()


def test_revision_048_is_a_noop_when_owner_tables_are_absent() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run_upgrade(migration, connection)
            _run_upgrade(migration, connection)
    finally:
        engine.dispose()


def test_revision_048_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["052_v1_52"]
    latest = script.get_revision("048_v1_48")
    assert latest is not None
    assert latest.down_revision == "047_v1_47"
