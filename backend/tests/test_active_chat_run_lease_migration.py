from __future__ import annotations

import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlmodel import create_engine


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    BACKEND_DIR / "alembic" / "versions" / "037_v1_37_active_chat_run_leases.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "aria_migration_037_sqlite",
        MIGRATION_PATH,
    )
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 037")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_037_adds_active_run_lease_idempotently_on_sqlite() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "CREATE TABLE chatrun ("
                    "id INTEGER PRIMARY KEY, run_id VARCHAR NOT NULL UNIQUE)"
                )
            )
            operations = Operations(MigrationContext.configure(connection))
            original_op = migration.op
            migration.op = operations
            try:
                migration.upgrade()
                migration.upgrade()
            finally:
                migration.op = original_op

            db_inspector = inspect(connection)
            columns = {
                item["name"] for item in db_inspector.get_columns("chatrun")
            }
            assert {
                "lease_owner",
                "lease_token",
                "lease_generation",
                "lease_expires_at",
                "last_heartbeat_at",
            }.issubset(columns)
            checks = {
                item["name"]
                for item in db_inspector.get_check_constraints("chatrun")
            }
            assert {
                "ck_chatrun_lease_generation",
                "ck_chatrun_active_lease_identity",
            }.issubset(checks)
            indexes = {
                item["name"] for item in db_inspector.get_indexes("chatrun")
            }
            assert {
                "ix_chatrun_lease_owner",
                "ix_chatrun_lease_expires_at",
                "ix_chatrun_last_heartbeat_at",
            }.issubset(indexes)
            connection.execute(
                text(
                    "INSERT INTO chatrun "
                    "(id, run_id, lease_owner, lease_token, lease_generation) "
                    "VALUES (1, 'run_default_lease', '', '', 0)"
                )
            )
    finally:
        engine.dispose()


def test_current_revision_is_the_single_alembic_head() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["040_v1_40"]
    revision = script.get_revision("040_v1_40")
    assert revision is not None
    assert revision.down_revision == "039_v1_39"
