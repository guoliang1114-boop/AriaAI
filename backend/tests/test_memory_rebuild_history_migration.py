"""Contract tests for the V1.50 native rebuild-history cutover."""
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
    / "050_v1_50_native_memory_rebuild_history.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_050", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 050")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(migration, connection, operation: str) -> None:
    original_op = migration.op
    migration.op = Operations(MigrationContext.configure(connection))
    try:
        getattr(migration, operation)()
    finally:
        migration.op = original_op


def _create_owner_tables(connection) -> None:
    connection.execute(
        text(
            "CREATE TABLE project (id INTEGER PRIMARY KEY, "
            "context_memory_json TEXT NOT NULL, memory_version INTEGER NOT NULL, "
            "memory_updated_at DATETIME, memory_stale BOOLEAN NOT NULL)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE clientrecord (id INTEGER PRIMARY KEY, "
            "client_memory_json TEXT NOT NULL, "
            "client_memory_version INTEGER NOT NULL, "
            "client_memory_updated_at DATETIME, client_memory_stale BOOLEAN NOT NULL)"
        )
    )


def test_revision_050_backfills_history_and_removes_only_native_envelope() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_owner_tables(connection)
            project_log = [{"version": 7, "private": "project"}]
            client_log = [{"version": 9, "private": "client"}]
            connection.execute(
                text(
                    "INSERT INTO project VALUES "
                    "(1, :memory, 7, '2026-09-05 10:00:00', 0), "
                    "(2, 'not-json', 0, NULL, 1)"
                ),
                {
                    "memory": json.dumps(
                        {
                            "project_brief": "keep",
                            "memory_version": 6,
                            "last_updated_at": "legacy-time",
                            "stale": True,
                            "rebuild_log": project_log,
                            "_coverage": {"keep": True},
                        }
                    )
                },
            )
            connection.execute(
                text(
                    "INSERT INTO clientrecord VALUES "
                    "(1, :memory, 9, '2026-09-05 11:00:00', 0)"
                ),
                {
                    "memory": json.dumps(
                        {
                            "client_profile": "keep",
                            "memory_version": 8,
                            "last_updated_at": "legacy-time",
                            "stale": True,
                            "rebuild_log": client_log,
                            "source_project_ids": [3],
                        }
                    )
                },
            )

            _run(migration, connection, "upgrade")
            _run(migration, connection, "upgrade")

            project = connection.execute(
                text(
                    "SELECT context_memory_json, memory_rebuild_log_json "
                    "FROM project WHERE id = 1"
                )
            ).one()
            client = connection.execute(
                text(
                    "SELECT client_memory_json, client_memory_rebuild_log_json "
                    "FROM clientrecord WHERE id = 1"
                )
            ).one()
            assert json.loads(project[0]) == {
                "project_brief": "keep",
                "_coverage": {"keep": True},
            }
            assert json.loads(project[1]) == project_log
            assert json.loads(client[0]) == {
                "client_profile": "keep",
                "source_project_ids": [3],
            }
            assert json.loads(client[1]) == client_log
            assert connection.execute(
                text("SELECT context_memory_json FROM project WHERE id = 2")
            ).scalar_one() == "not-json"
    finally:
        engine.dispose()


def test_revision_050_keeps_divergent_legacy_history_and_downgrade_new_values() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_owner_tables(connection)
            connection.execute(
                text(
                    "INSERT INTO project VALUES "
                    "(1, :memory, 4, '2026-09-05 12:00:00', 0)"
                ),
                {
                    "memory": json.dumps(
                        {
                            "project_brief": "keep",
                            "rebuild_log": [{"version": 4}],
                        }
                    )
                },
            )
            _run(migration, connection, "upgrade")
            active = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )
            active.update(
                {
                    "memory_version": 99,
                    "last_updated_at": "new-time",
                    "stale": True,
                    "rebuild_log": [{"version": 99}],
                }
            )
            connection.execute(
                text("UPDATE project SET context_memory_json = :memory WHERE id = 1"),
                {"memory": json.dumps(active)},
            )

            _run(migration, connection, "upgrade")
            rerun = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )
            assert rerun["rebuild_log"] == [{"version": 99}]
            assert "memory_version" not in rerun

            rerun["memory_version"] = 100
            connection.execute(
                text("UPDATE project SET context_memory_json = :memory WHERE id = 1"),
                {"memory": json.dumps(rerun)},
            )
            _run(migration, connection, "downgrade")
            restored = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )
            assert restored["memory_version"] == 100
            assert restored["rebuild_log"] == [{"version": 99}]
            assert "memory_rebuild_log_json" not in {
                column["name"]
                for column in inspect(connection).get_columns("project")
            }
    finally:
        engine.dispose()


def test_revision_050_is_a_noop_when_owner_tables_are_absent() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run(migration, connection, "upgrade")
            _run(migration, connection, "downgrade")
    finally:
        engine.dispose()


def test_revision_050_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["051_v1_51"]
    latest = script.get_revision("050_v1_50")
    assert latest is not None
    assert latest.down_revision == "049_v1_49"
