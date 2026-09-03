from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "alembic" / "versions" / "044_v1_44_artifact_acceptance_reviews.py"


def _load():
    spec = importlib.util.spec_from_file_location("aria_migration_044", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_044_creates_acceptance_ledgers_idempotently() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("generatedfile", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table("artifactverification", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table("user", metadata, sa.Column("id", sa.Integer, primary_key=True))
    metadata.create_all(engine)
    migration = _load()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        inspector = sa.inspect(connection)
        tables = set(inspector.get_table_names())
        assert "artifactacceptancereview" in tables
        assert "artifactacceptancereviewevent" in tables
        review_columns = {
            item["name"]
            for item in inspector.get_columns("artifactacceptancereview")
        }
        assert {
            "verification_id",
            "content_sha256",
            "evidence_sha256",
            "verification_plan_sha256",
            "status",
            "revision",
            "reason",
        } <= review_columns
        event_indexes = {
            item["name"]
            for item in inspector.get_indexes("artifactacceptancereviewevent")
        }
        assert "ix_artifactacceptancereviewevent_review_id" in event_indexes
        assert "ix_artifactacceptancereviewevent_created_at" in event_indexes
    engine.dispose()


def test_revision_044_precedes_the_single_alembic_head() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["046_v1_46"]
    revision = script.get_revision("044_v1_44")
    assert revision is not None
    assert revision.down_revision == "043_v1_43"
