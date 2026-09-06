"""Contract tests for the V1.53 aggregate business-slot retirement migration."""
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
    / "053_v1_53_retire_aggregate_memory_business_slots.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_053", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 053")
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


def _canonical_json(value) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha(value) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _create_tables(connection) -> None:
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
            "CREATE TABLE projectmemoryslot ("
            "id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, "
            "slot_key TEXT NOT NULL, value_json TEXT NOT NULL, "
            "value_sha256 TEXT NOT NULL)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE clientmemoryslot ("
            "id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL, "
            "slot_key TEXT NOT NULL, value_json TEXT NOT NULL, "
            "value_sha256 TEXT NOT NULL)"
        )
    )


def test_revision_053_retires_only_digest_verified_matching_copies() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_tables(connection)
            connection.execute(
                text("INSERT INTO project VALUES (1, :value), (2, :value), (3, 'bad-json')"),
                {
                    "value": json.dumps(
                        {
                            "project_brief": "Verified brief",
                            "key_risks": {"ai": ["Risk"], "pinned": []},
                            "key_risks_detail": {"ai": ["Risk"], "pinned": []},
                            "open_questions_detail": {"ai": ["Question"], "pinned": []},
                            "stakeholder_notes_detail": {
                                "ai": ["Keep divergent"],
                                "pinned": [],
                            },
                            "_accepted_memory_candidates": {"key_risks": ["Risk"]},
                        }
                    )
                },
            )
            connection.execute(
                text("INSERT INTO clientrecord VALUES (1, :value), (2, :value)"),
                {
                    "value": json.dumps(
                        {
                            "client_profile": "Verified client",
                            "relationship_signals": ["Trusted"],
                            "_accepted_memory_candidates": {},
                        }
                    )
                },
            )
            project_values = [
                (1, 1, "project_brief", "Verified brief", _sha("Verified brief")),
                (2, 1, "key_risks", {"ai": ["Risk"], "pinned": []}, "invalid"),
                (3, 2, "project_brief", "Divergent", _sha("Divergent")),
                (
                    4,
                    1,
                    "open_questions",
                    {"ai": ["Question"], "pinned": []},
                    _sha({"ai": ["Question"], "pinned": []}),
                ),
                (
                    5,
                    1,
                    "stakeholder_notes",
                    {"ai": ["Other"], "pinned": []},
                    _sha({"ai": ["Other"], "pinned": []}),
                ),
            ]
            for row_id, owner_id, slot_key, value, digest in project_values:
                connection.execute(
                    text(
                        "INSERT INTO projectmemoryslot VALUES "
                        "(:id, :owner_id, :slot_key, :value_json, :digest)"
                    ),
                    {
                        "id": row_id,
                        "owner_id": owner_id,
                        "slot_key": slot_key,
                        "value_json": _canonical_json(value),
                        "digest": digest,
                    },
                )
            client_values = [
                (1, 1, "client_profile", "Verified client", _sha("Verified client")),
                (2, 1, "relationship_signals", ["Trusted"], _sha(["Trusted"])),
                (3, 2, "client_profile", "Other client", _sha("Other client")),
            ]
            for row_id, owner_id, slot_key, value, digest in client_values:
                connection.execute(
                    text(
                        "INSERT INTO clientmemoryslot VALUES "
                        "(:id, :owner_id, :slot_key, :value_json, :digest)"
                    ),
                    {
                        "id": row_id,
                        "owner_id": owner_id,
                        "slot_key": slot_key,
                        "value_json": _canonical_json(value),
                        "digest": digest,
                    },
                )

            _run(migration, connection, "upgrade")
            _run(migration, connection, "upgrade")

            project_one = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )
            project_two = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 2")
                ).scalar_one()
            )
            client_one = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )
            client_two = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 2")
                ).scalar_one()
            )
            assert "project_brief" not in project_one
            assert "key_risks" in project_one
            assert "key_risks_detail" in project_one
            assert "open_questions_detail" not in project_one
            assert project_one["stakeholder_notes_detail"] == {
                "ai": ["Keep divergent"],
                "pinned": [],
            }
            assert project_one["_accepted_memory_candidates"] == {"key_risks": ["Risk"]}
            assert project_two["project_brief"] == "Verified brief"
            assert client_one == {"_accepted_memory_candidates": {}}
            assert client_two["client_profile"] == "Verified client"
            assert connection.execute(
                text("SELECT context_memory_json FROM project WHERE id = 3")
            ).scalar_one() == "bad-json"
    finally:
        engine.dispose()


def test_revision_053_downgrade_restores_valid_missing_values_without_overwrite() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_tables(connection)
            connection.execute(text("INSERT INTO project VALUES (1, '{}')"))
            connection.execute(
                text("INSERT INTO clientrecord VALUES (1, :value)"),
                {"value": json.dumps({"client_profile": "Keep current"})},
            )
            connection.execute(
                text("INSERT INTO projectmemoryslot VALUES (1, 1, 'project_brief', :value, :digest)"),
                {"value": _canonical_json("Restored brief"), "digest": _sha("Restored brief")},
            )
            connection.execute(
                text("INSERT INTO clientmemoryslot VALUES (1, 1, 'client_profile', :value, :digest)"),
                {"value": _canonical_json("Ledger client"), "digest": _sha("Ledger client")},
            )

            _run(migration, connection, "downgrade")

            assert json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )["project_brief"] == "Restored brief"
            assert json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )["client_profile"] == "Keep current"
    finally:
        engine.dispose()


def test_revision_053_is_a_noop_without_memory_tables() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run(migration, connection, "upgrade")
            _run(migration, connection, "downgrade")
    finally:
        engine.dispose()


def test_revision_053_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["053_v1_53"]
    latest = script.get_revision("053_v1_53")
    assert latest is not None
    assert latest.down_revision == "052_v1_52"
