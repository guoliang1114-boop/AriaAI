"""Contract tests for the V1.51 legacy operation-state retirement."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlmodel import create_engine


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    BACKEND_DIR
    / "alembic"
    / "versions"
    / "051_v1_51_retire_legacy_memory_operation_state.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_051", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 051")
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
            "context_memory_json TEXT NOT NULL, "
            "memory_last_failure_json TEXT NOT NULL, "
            "client_memory_promotion_json TEXT NOT NULL)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE clientrecord (id INTEGER PRIMARY KEY, "
            "client_memory_json TEXT NOT NULL, "
            "client_memory_last_failure_json TEXT NOT NULL, "
            "client_memory_rebuild_generation VARCHAR(64) NOT NULL)"
        )
    )


def test_revision_051_backfills_and_retires_only_verifiable_legacy_copies() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_owner_tables(connection)
            failure = {"stage": "rebuild", "private": "failure"}
            promotion = {"status": "completed", "private": "promotion"}
            connection.execute(
                text(
                    "INSERT INTO project VALUES "
                    "(1, :valid, '', ''), "
                    "(2, :mixed, :matching_failure, :divergent_promotion), "
                    "(3, 'not-json', '', ''), "
                    "(4, :invalid_types, '', ''), "
                    "(5, :invalid_native_source, 'not-json', '')"
                ),
                {
                    "valid": json.dumps(
                        {
                            "project_brief": "keep",
                            "_last_failure": failure,
                            "_client_promotion": promotion,
                        }
                    ),
                    "mixed": json.dumps(
                        {
                            "_last_failure": failure,
                            "_client_promotion": promotion,
                        }
                    ),
                    "matching_failure": json.dumps(failure),
                    "divergent_promotion": json.dumps({"status": "failed"}),
                    "invalid_types": json.dumps(
                        {
                            "_last_failure": "not-an-object",
                            "_client_promotion": [],
                        }
                    ),
                    "invalid_native_source": json.dumps(
                        {"_last_failure": failure}
                    ),
                },
            )
            connection.execute(
                text(
                    "INSERT INTO clientrecord VALUES "
                    "(1, :valid, '', ''), "
                    "(2, :divergent, :native_failure, 'native-generation'), "
                    "(3, :long_generation, '', ''), "
                    "(4, '[]', '', ''), "
                    "(5, :invalid_types, '', '')"
                ),
                {
                    "valid": json.dumps(
                        {
                            "client_profile": "keep",
                            "_last_failure": failure,
                            "_rebuild_generation": "epoch-1",
                        }
                    ),
                    "divergent": json.dumps(
                        {
                            "_last_failure": failure,
                            "_rebuild_generation": "legacy-generation",
                        }
                    ),
                    "native_failure": json.dumps({"stage": "native"}),
                    "long_generation": json.dumps(
                        {"_rebuild_generation": "x" * 65}
                    ),
                    "invalid_types": json.dumps(
                        {
                            "_last_failure": ["not-an-object"],
                            "_rebuild_generation": 42,
                        }
                    ),
                },
            )

            _run(migration, connection, "upgrade")
            _run(migration, connection, "upgrade")

            migrated_project = connection.execute(
                text(
                    "SELECT context_memory_json, memory_last_failure_json, "
                    "client_memory_promotion_json FROM project WHERE id = 1"
                )
            ).one()
            assert json.loads(migrated_project[0]) == {"project_brief": "keep"}
            assert json.loads(migrated_project[1]) == failure
            assert json.loads(migrated_project[2]) == promotion

            mixed_project = connection.execute(
                text(
                    "SELECT context_memory_json FROM project WHERE id = 2"
                )
            ).scalar_one()
            assert json.loads(mixed_project) == {"_client_promotion": promotion}
            assert connection.execute(
                text("SELECT context_memory_json FROM project WHERE id = 3")
            ).scalar_one() == "not-json"
            assert set(
                json.loads(
                    connection.execute(
                        text("SELECT context_memory_json FROM project WHERE id = 4")
                    ).scalar_one()
                )
            ) == {"_last_failure", "_client_promotion"}
            assert "_last_failure" in json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 5")
                ).scalar_one()
            )

            migrated_client = connection.execute(
                text(
                    "SELECT client_memory_json, client_memory_last_failure_json, "
                    "client_memory_rebuild_generation FROM clientrecord WHERE id = 1"
                )
            ).one()
            assert json.loads(migrated_client[0]) == {"client_profile": "keep"}
            assert json.loads(migrated_client[1]) == failure
            assert migrated_client[2] == "epoch-1"
            divergent_client = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 2")
                ).scalar_one()
            )
            assert set(divergent_client) == {
                "_last_failure",
                "_rebuild_generation",
            }
            assert "_rebuild_generation" in json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 3")
                ).scalar_one()
            )
            assert set(
                json.loads(
                    connection.execute(
                        text("SELECT client_memory_json FROM clientrecord WHERE id = 5")
                    ).scalar_one()
                )
            ) == {"_last_failure", "_rebuild_generation"}
    finally:
        engine.dispose()


def test_revision_051_downgrade_restores_missing_keys_without_overwrite() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_owner_tables(connection)
            connection.execute(
                text("INSERT INTO project VALUES (1, :memory, '', '')"),
                {
                    "memory": json.dumps(
                        {
                            "_last_failure": {"stage": "legacy"},
                            "_client_promotion": {"status": "completed"},
                        }
                    )
                },
            )
            connection.execute(
                text("INSERT INTO clientrecord VALUES (1, :memory, '', '')"),
                {
                    "memory": json.dumps(
                        {
                            "_last_failure": {"stage": "legacy"},
                            "_rebuild_generation": "epoch-1",
                        }
                    )
                },
            )
            _run(migration, connection, "upgrade")

            connection.execute(
                text(
                    "UPDATE project SET context_memory_json = :memory WHERE id = 1"
                ),
                {"memory": json.dumps({"_last_failure": {"stage": "new"}})},
            )
            connection.execute(
                text(
                    "UPDATE clientrecord SET client_memory_json = :memory WHERE id = 1"
                ),
                {"memory": json.dumps({"_rebuild_generation": "epoch-2"})},
            )
            _run(migration, connection, "downgrade")

            project = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )
            client = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )
            assert project["_last_failure"] == {"stage": "new"}
            assert project["_client_promotion"] == {"status": "completed"}
            assert client["_rebuild_generation"] == "epoch-2"
            assert client["_last_failure"] == {"stage": "legacy"}
    finally:
        engine.dispose()


def test_revision_051_is_a_noop_when_owner_tables_are_absent() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run(migration, connection, "upgrade")
            _run(migration, connection, "downgrade")
    finally:
        engine.dispose()


def test_revision_051_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["053_v1_53"]
    latest = script.get_revision("051_v1_51")
    assert latest is not None
    assert latest.down_revision == "050_v1_50"
