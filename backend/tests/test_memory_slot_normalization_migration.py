"""Contract tests for the V1.47 legacy empty-slot normalization."""
from __future__ import annotations

import hashlib
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
    / "047_v1_47_normalize_legacy_empty_memory_slots.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_047", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 047")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sha256_json(value) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _create_schema(connection) -> None:
    connection.execute(
        text(
            "CREATE TABLE project ("
            "id INTEGER PRIMARY KEY, memory_version INTEGER NOT NULL, "
            "context_memory_json TEXT NOT NULL)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE projectmemoryslot ("
            "id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, "
            "slot_key VARCHAR NOT NULL, slot_version INTEGER NOT NULL, "
            "aggregate_memory_version INTEGER NOT NULL, value_json TEXT NOT NULL, "
            "value_sha256 VARCHAR NOT NULL, updated_at DATETIME NOT NULL)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE clientrecord ("
            "id INTEGER PRIMARY KEY, client_memory_version INTEGER NOT NULL, "
            "client_memory_json TEXT NOT NULL)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE clientmemoryslot ("
            "id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL, "
            "slot_key VARCHAR NOT NULL, slot_version INTEGER NOT NULL, "
            "aggregate_memory_version INTEGER NOT NULL, value_json TEXT NOT NULL, "
            "value_sha256 VARCHAR NOT NULL, updated_at DATETIME NOT NULL)"
        )
    )


def _run_upgrade(migration, connection) -> None:
    original_op = migration.op
    migration.op = Operations(MigrationContext.configure(connection))
    try:
        migration.upgrade()
    finally:
        migration.op = original_op


def test_revision_047_repairs_only_exact_missing_array_placeholders() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    null_hash = _sha256_json(None)
    try:
        with engine.begin() as connection:
            _create_schema(connection)
            connection.execute(
                text(
                    "INSERT INTO project (id, memory_version, context_memory_json) VALUES "
                    "(1, 4, :missing), (2, 4, :explicit_null), "
                    "(3, 4, :missing), (4, 4, :missing), (5, 4, :malformed)"
                ),
                {
                    "missing": json.dumps({"project_brief": "Preserved"}),
                    "explicit_null": json.dumps({"client_stakeholders": None}),
                    "malformed": "not-json",
                },
            )
            connection.execute(
                text(
                    "INSERT INTO projectmemoryslot "
                    "(id, project_id, slot_key, slot_version, aggregate_memory_version, "
                    "value_json, value_sha256, updated_at) VALUES "
                    "(11, 1, 'client_stakeholders', 1, 4, 'null', :null_hash, CURRENT_TIMESTAMP), "
                    "(12, 2, 'client_stakeholders', 1, 4, 'null', :null_hash, CURRENT_TIMESTAMP), "
                    "(13, 3, 'client_stakeholders', 1, 3, 'null', :null_hash, CURRENT_TIMESTAMP), "
                    "(14, 4, 'client_stakeholders', 1, 4, 'null', 'bad-digest', CURRENT_TIMESTAMP), "
                    "(15, 5, 'client_stakeholders', 1, 4, 'null', :null_hash, CURRENT_TIMESTAMP)"
                ),
                {"null_hash": null_hash},
            )
            connection.execute(
                text(
                    "INSERT INTO clientrecord "
                    "(id, client_memory_version, client_memory_json) "
                    "VALUES (21, 7, :memory)"
                ),
                {"memory": json.dumps({"client_profile": "Preserved"})},
            )
            connection.execute(
                text(
                    "INSERT INTO clientmemoryslot "
                    "(id, client_id, slot_key, slot_version, aggregate_memory_version, "
                    "value_json, value_sha256, updated_at) VALUES "
                    "(31, 21, 'relationship_signals', 2, 7, 'null', :null_hash, CURRENT_TIMESTAMP)"
                ),
                {"null_hash": null_hash},
            )

            _run_upgrade(migration, connection)
            _run_upgrade(migration, connection)

            project_memory_json = {
                row.id: row.context_memory_json
                for row in connection.execute(
                    text("SELECT id, context_memory_json FROM project ORDER BY id")
                ).mappings()
            }
            project_memories = {
                project_id: json.loads(memory_json)
                for project_id, memory_json in project_memory_json.items()
                if project_id != 5
            }
            project_slots = {
                row.id: (row.value_json, row.value_sha256, row.slot_version)
                for row in connection.execute(
                    text(
                        "SELECT id, value_json, value_sha256, slot_version "
                        "FROM projectmemoryslot ORDER BY id"
                    )
                ).mappings()
            }
            client_memory = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 21")
                ).scalar_one()
            )
            client_slot = connection.execute(
                text(
                    "SELECT value_json, value_sha256, slot_version "
                    "FROM clientmemoryslot WHERE id = 31"
                )
            ).one()

            assert project_memories[1] == {
                "project_brief": "Preserved",
                "client_stakeholders": [],
            }
            assert project_slots[11] == ("[]", _sha256_json([]), 2)
            assert project_memories[2]["client_stakeholders"] is None
            assert project_slots[12] == ("null", null_hash, 1)
            assert "client_stakeholders" not in project_memories[3]
            assert project_slots[13] == ("null", null_hash, 1)
            assert "client_stakeholders" not in project_memories[4]
            assert project_slots[14] == ("null", "bad-digest", 1)
            assert project_memory_json[5] == "not-json"
            assert project_slots[15] == ("null", null_hash, 1)
            assert client_memory == {
                "client_profile": "Preserved",
                "relationship_signals": [],
            }
            assert client_slot == ("[]", _sha256_json([]), 3)
    finally:
        engine.dispose()


def test_revision_047_is_a_noop_when_legacy_tables_are_absent() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run_upgrade(migration, connection)
    finally:
        engine.dispose()


def test_revision_047_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["047_v1_47"]
    latest = script.get_revision("047_v1_47")
    assert latest is not None
    assert latest.down_revision == "046_v1_46"
