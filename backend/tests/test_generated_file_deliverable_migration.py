from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "alembic" / "versions" / "045_v1_45_generated_file_deliverables.py"


def _load():
    spec = importlib.util.spec_from_file_location("aria_migration_045", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_045_adds_release_bound_deliverable_fields_idempotently() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("generatedfile", metadata, sa.Column("id", sa.Integer, primary_key=True))
    metadata.create_all(engine)
    migration = _load()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        inspector = sa.inspect(connection)
        columns = {item["name"] for item in inspector.get_columns("generatedfile")}
        assert set(migration.COLUMNS) <= columns
        indexes = {item["name"] for item in inspector.get_indexes("generatedfile")}
        assert set(migration.INDEXES) <= indexes

    engine.dispose()


def test_revision_045_precedes_the_single_alembic_head() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)

    heads = script.get_heads()
    assert len(heads) == 1
    assert "045_v1_45" in {
        item.revision for item in script.walk_revisions(base="base", head=heads[0])
    }
    latest = script.get_revision("045_v1_45")
    assert latest is not None
    assert latest.down_revision == "044_v1_44"
