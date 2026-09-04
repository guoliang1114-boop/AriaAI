"""Contract tests for the V1.49 client-memory legacy quarantine."""
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
    / "049_v1_49_client_memory_legacy_quarantine.py"
)
KEYS = (
    "name",
    "role",
    "note",
    "concerns",
    "influence_type",
    "relationship_status",
    "communication_preference",
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_049", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 049")
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


def _confirmed_payload(prefix: str = "private") -> dict[str, str]:
    return {key: f"{prefix}-{index}" for index, key in enumerate(KEYS)}


def test_revision_049_quarantines_only_the_confirmed_shape_idempotently() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE clientrecord (id INTEGER PRIMARY KEY, "
                    "client_memory_json TEXT NOT NULL)"
                )
            )
            confirmed = {"client_profile": "keep", **_confirmed_payload()}
            partial = {"client_profile": "keep", **_confirmed_payload()}
            partial.pop("note")
            wrong_type = {"client_profile": "keep", **_confirmed_payload()}
            wrong_type["role"] = ["not", "a", "string"]
            connection.execute(
                text(
                    "INSERT INTO clientrecord (id, client_memory_json) VALUES "
                    "(1, :confirmed), (2, :partial), (3, :wrong_type), "
                    "(4, 'not-json')"
                ),
                {
                    "confirmed": json.dumps(confirmed),
                    "partial": json.dumps(partial),
                    "wrong_type": json.dumps(wrong_type),
                },
            )

            _run(migration, connection, "upgrade")
            _run(migration, connection, "upgrade")

            rows = connection.execute(
                text(
                    "SELECT id, client_memory_json, "
                    "client_memory_legacy_quarantine_json "
                    "FROM clientrecord ORDER BY id"
                )
            ).all()
            active = json.loads(rows[0][1])
            quarantine = json.loads(rows[0][2])
            assert active == {"client_profile": "keep"}
            assert quarantine == {
                "schema_version": 1,
                "entries": [
                    {
                        "kind": "flattened_structured_stakeholder_v1",
                        "payload": _confirmed_payload(),
                    }
                ],
            }
            assert json.loads(rows[1][1]) == partial
            assert json.loads(rows[2][1]) == wrong_type
            assert rows[3][1] == "not-json"
            assert all(json.loads(row[2]) == {} for row in rows[1:])
            assert "client_memory_legacy_quarantine_json" in {
                column["name"]
                for column in inspect(connection).get_columns("clientrecord")
            }
    finally:
        engine.dispose()


def test_revision_049_preserves_existing_quarantine_and_downgrade_new_values() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE clientrecord (id INTEGER PRIMARY KEY, "
                    "client_memory_json TEXT NOT NULL, "
                    "client_memory_legacy_quarantine_json TEXT NOT NULL)"
                )
            )
            original_payload = _confirmed_payload("legacy")
            existing_entry = {"kind": "future_kind", "payload": {"opaque": True}}
            connection.execute(
                text(
                    "INSERT INTO clientrecord "
                    "(id, client_memory_json, client_memory_legacy_quarantine_json) "
                    "VALUES (1, :memory, :quarantine)"
                ),
                {
                    "memory": json.dumps(
                        {"client_profile": "keep", **original_payload}
                    ),
                    "quarantine": json.dumps(
                        {"schema_version": 1, "entries": [existing_entry]}
                    ),
                },
            )

            _run(migration, connection, "upgrade")
            quarantine = json.loads(
                connection.execute(
                    text(
                        "SELECT client_memory_legacy_quarantine_json "
                        "FROM clientrecord WHERE id = 1"
                    )
                ).scalar_one()
            )
            assert quarantine["entries"][0] == existing_entry
            assert quarantine["entries"][1]["payload"] == original_payload

            active = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )
            active["name"] = "new-authoritative-name"
            connection.execute(
                text(
                    "UPDATE clientrecord SET client_memory_json = :memory WHERE id = 1"
                ),
                {"memory": json.dumps(active)},
            )
            _run(migration, connection, "downgrade")

            restored = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )
            assert restored["name"] == "new-authoritative-name"
            assert all(restored[key] == original_payload[key] for key in KEYS[1:])
            assert "client_memory_legacy_quarantine_json" not in {
                column["name"]
                for column in inspect(connection).get_columns("clientrecord")
            }
    finally:
        engine.dispose()


def test_revision_049_does_not_remove_active_data_when_quarantine_is_invalid() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE clientrecord (id INTEGER PRIMARY KEY, "
                    "client_memory_json TEXT NOT NULL, "
                    "client_memory_legacy_quarantine_json TEXT NOT NULL)"
                )
            )
            memory = {"client_profile": "keep", **_confirmed_payload()}
            connection.execute(
                text(
                    "INSERT INTO clientrecord "
                    "(id, client_memory_json, client_memory_legacy_quarantine_json) "
                    "VALUES (1, :memory, 'not-json')"
                ),
                {"memory": json.dumps(memory)},
            )

            _run(migration, connection, "upgrade")

            row = connection.execute(
                text(
                    "SELECT client_memory_json, "
                    "client_memory_legacy_quarantine_json "
                    "FROM clientrecord WHERE id = 1"
                )
            ).one()
            assert json.loads(row[0]) == memory
            assert row[1] == "not-json"
    finally:
        engine.dispose()


def test_revision_049_is_a_noop_when_client_table_is_absent() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run(migration, connection, "upgrade")
            _run(migration, connection, "downgrade")
    finally:
        engine.dispose()


def test_revision_049_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["050_v1_50"]
    latest = script.get_revision("049_v1_49")
    assert latest is not None
    assert latest.down_revision == "048_v1_48"
