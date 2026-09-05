"""Contract tests for the V1.52 native projection-state migration."""
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
    / "052_v1_52_native_memory_projection_metadata.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_052", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 052")
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


def _create_owner_tables(connection, *, with_native: bool = False) -> None:
    project_native = (
        ", memory_coverage_json TEXT NOT NULL DEFAULT '{}'" if with_native else ""
    )
    client_native = (
        ", client_memory_source_project_ids_json TEXT NOT NULL DEFAULT '[]'"
        if with_native
        else ""
    )
    connection.execute(
        text(
            "CREATE TABLE project (id INTEGER PRIMARY KEY, "
            f"context_memory_json TEXT NOT NULL{project_native})"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE clientrecord (id INTEGER PRIMARY KEY, "
            f"client_memory_json TEXT NOT NULL{client_native})"
        )
    )


def test_revision_052_backfills_and_retires_only_valid_projection_metadata() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_owner_tables(connection)
            connection.execute(
                text(
                    "INSERT INTO project VALUES "
                    "(1, :valid), (2, :invalid), (3, 'not-json')"
                ),
                {
                    "valid": json.dumps(
                        {"project_brief": "keep", "_coverage": {"files": 2}}
                    ),
                    "invalid": json.dumps(
                        {"project_brief": "keep", "_coverage": ["wrong"]}
                    ),
                },
            )
            connection.execute(
                text(
                    "INSERT INTO clientrecord VALUES "
                    "(1, :valid), (2, :invalid), (3, 'not-json')"
                ),
                {
                    "valid": json.dumps(
                        {"client_profile": "keep", "source_project_ids": ["3", 3, 8]}
                    ),
                    "invalid": json.dumps(
                        {"client_profile": "keep", "source_project_ids": ["bad"]}
                    ),
                },
            )

            _run(migration, connection, "upgrade")
            _run(migration, connection, "upgrade")

            project = connection.execute(
                text(
                    "SELECT context_memory_json, memory_coverage_json "
                    "FROM project WHERE id = 1"
                )
            ).one()
            client = connection.execute(
                text(
                    "SELECT client_memory_json, "
                    "client_memory_source_project_ids_json "
                    "FROM clientrecord WHERE id = 1"
                )
            ).one()
            assert json.loads(project[0]) == {"project_brief": "keep"}
            assert json.loads(project[1]) == {"files": 2}
            assert json.loads(client[0]) == {"client_profile": "keep"}
            assert json.loads(client[1]) == [3, 8]
            assert "_coverage" in json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 2")
                ).scalar_one()
            )
            assert "source_project_ids" in json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 2")
                ).scalar_one()
            )
            assert connection.execute(
                text("SELECT context_memory_json FROM project WHERE id = 3")
            ).scalar_one() == "not-json"
    finally:
        engine.dispose()


def test_revision_052_preserves_divergence_and_downgrade_never_overwrites() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_owner_tables(connection, with_native=True)
            connection.execute(
                text(
                    "INSERT INTO project VALUES (1, :memory, :native)"
                ),
                {
                    "memory": json.dumps({"_coverage": {"version": "newer"}}),
                    "native": json.dumps({"version": "native"}),
                },
            )
            connection.execute(
                text(
                    "INSERT INTO clientrecord VALUES (1, :memory, :native)"
                ),
                {
                    "memory": json.dumps({"source_project_ids": [9]}),
                    "native": json.dumps([7]),
                },
            )

            _run(migration, connection, "upgrade")
            assert json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )["_coverage"] == {"version": "newer"}
            assert json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )["source_project_ids"] == [9]

            _run(migration, connection, "downgrade")
            assert json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )["_coverage"] == {"version": "newer"}
            assert json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )["source_project_ids"] == [9]
            assert "memory_coverage_json" not in {
                column["name"] for column in inspect(connection).get_columns("project")
            }
    finally:
        engine.dispose()


def test_revision_052_downgrade_restores_native_values() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_owner_tables(connection)
            connection.execute(text("INSERT INTO project VALUES (1, '{}')"))
            connection.execute(text("INSERT INTO clientrecord VALUES (1, '{}')"))
            _run(migration, connection, "upgrade")
            connection.execute(
                text("UPDATE project SET memory_coverage_json = :value WHERE id = 1"),
                {"value": json.dumps({"files": 4})},
            )
            connection.execute(
                text(
                    "UPDATE clientrecord SET "
                    "client_memory_source_project_ids_json = :value WHERE id = 1"
                ),
                {"value": json.dumps([2, 6])},
            )

            _run(migration, connection, "downgrade")

            assert json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )["_coverage"] == {"files": 4}
            assert json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )["source_project_ids"] == [2, 6]
    finally:
        engine.dispose()


def test_revision_052_is_a_noop_when_owner_tables_are_absent() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run(migration, connection, "upgrade")
            _run(migration, connection, "downgrade")
    finally:
        engine.dispose()


def test_revision_052_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["052_v1_52"]
    latest = script.get_revision("052_v1_52")
    assert latest is not None
    assert latest.down_revision == "051_v1_51"
