from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "alembic" / "versions" / "046_v1_46_artifact_knowledge_archives.py"


def _load():
    spec = importlib.util.spec_from_file_location("aria_migration_046", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_046_adds_archive_audit_and_business_rules_idempotently() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("user", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table(
        "generatedfile",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
    )
    sa.Table(
        "knowledge_source",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
    )
    sa.Table(
        "knowledge_document",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
    )
    metadata.create_all(engine)
    migration = _load()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        inspector = sa.inspect(connection)
        columns = {
            item["name"]
            for item in inspector.get_columns(migration.GENERATED_FILE_TABLE)
        }
        assert migration.VERIFIER_COLUMN in columns
        assert migration.ARCHIVE_TABLE in inspector.get_table_names()
        indexes = {
            item["name"]
            for item in inspector.get_indexes(migration.ARCHIVE_TABLE)
        }
        assert set(migration.ARCHIVE_INDEXES) <= indexes

    engine.dispose()


def test_revision_046_precedes_the_single_alembic_head() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["047_v1_47"]
    revision = script.get_revision("046_v1_46")
    assert revision is not None
    assert revision.down_revision == "045_v1_45"
