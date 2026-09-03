from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from alembic.script import ScriptDirectory


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "alembic" / "versions" / "043_v1_43_artifact_verifications.py"


def _load():
    spec = importlib.util.spec_from_file_location("aria_migration_043", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_043_creates_artifact_verification_idempotently() -> None:
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    sa.Table("generatedfile", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table("skill", metadata, sa.Column("id", sa.Integer, primary_key=True))
    sa.Table("skillrelease", metadata, sa.Column("id", sa.Integer, primary_key=True))
    metadata.create_all(engine)
    migration = _load()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.upgrade()
        inspector = sa.inspect(connection)
        assert "artifactverification" in inspector.get_table_names()
        columns = {item["name"] for item in inspector.get_columns("artifactverification")}
        assert {
            "generated_file_id",
            "content_sha256",
            "evidence_sha256",
            "status",
            "technical_status",
            "skill_status",
            "evidence_json",
        } <= columns
        indexes = {item["name"] for item in inspector.get_indexes("artifactverification")}
        assert "ix_artifactverification_generated_file_id" in indexes
        assert "ix_artifactverification_evidence_sha256" in indexes
    engine.dispose()


def test_revision_043_remains_in_the_linear_alembic_chain() -> None:
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)

    revision = script.get_revision("043_v1_43")
    assert revision is not None
    assert revision.down_revision == "042_v1_42"
