"""Contract tests for the V1.54 native accepted-candidate anchor migration."""
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
    / "054_v1_54_native_memory_candidate_anchors.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("aria_migration_054", MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 054")
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


def _create_tables(connection) -> None:
    connection.execute(text("CREATE TABLE user (id INTEGER PRIMARY KEY)"))
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
            "CREATE TABLE memorycandidate ("
            "id INTEGER PRIMARY KEY, scope TEXT NOT NULL, candidate_type TEXT NOT NULL, "
            "content TEXT NOT NULL, status TEXT NOT NULL, target_slot TEXT NOT NULL, "
            "project_id INTEGER, client_id INTEGER, resolved_by_user_id INTEGER, "
            "resolved_at DATETIME, created_at DATETIME NOT NULL)"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE projectquestionresolution ("
            "id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, "
            "question_sha256 TEXT NOT NULL, status TEXT NOT NULL)"
        )
    )


def test_revision_054_backfills_candidates_and_legacy_anchors_idempotently() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_tables(connection)
            question = "客户是否已经确认验收范围？"
            question_sha256 = migration._question_sha256(question)
            connection.execute(text("INSERT INTO user VALUES (1)"))
            connection.execute(
                text("INSERT INTO project VALUES (1, :memory), (2, :malformed)"),
                {
                    "memory": json.dumps(
                        {
                            "_accepted_memory_candidates": {
                                "recent_progress": ["Legacy progress"],
                                "open_questions": [question],
                            }
                        },
                        ensure_ascii=False,
                    ),
                    "malformed": json.dumps(
                        {"_accepted_memory_candidates": {"unknown_slot": ["Keep"]}}
                    ),
                },
            )
            connection.execute(
                text("INSERT INTO clientrecord VALUES (1, :memory)"),
                {
                    "memory": json.dumps(
                        {
                            "_accepted_memory_candidates": {
                                "lessons_learned": ["Legacy lesson"]
                            }
                        }
                    )
                },
            )
            connection.execute(
                text(
                    "INSERT INTO memorycandidate VALUES "
                    "(1, 'project', 'project_risk', 'Accepted risk', 'accepted', "
                    "'key_risks', 1, NULL, 1, '2026-09-01', '2026-08-31'), "
                    "(2, 'client', 'client_relationship_signal', 'Trusted sponsor', "
                    "'accepted', 'relationship_signals', NULL, 1, 1, "
                    "'2026-09-02', '2026-09-01'), "
                    "(3, 'project', 'project_fact', 'Pending fact', 'pending', "
                    "'recent_progress', 1, NULL, NULL, NULL, '2026-09-01')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO projectquestionresolution VALUES "
                    "(1, 1, :question_sha256, 'resolved')"
                ),
                {"question_sha256": question_sha256},
            )

            _run(migration, connection, "upgrade")
            _run(migration, connection, "upgrade")

            rows = connection.execute(
                text(
                    "SELECT scope, project_id, client_id, slot_key, content, status, "
                    "source_candidate_id FROM memorycandidateanchor ORDER BY anchor_key"
                )
            ).mappings().all()
            assert len(rows) == 5
            by_content = {row["content"]: row for row in rows}
            assert by_content["Accepted risk"]["source_candidate_id"] == 1
            assert by_content["Trusted sponsor"]["source_candidate_id"] == 2
            assert by_content["Legacy progress"]["status"] == "active"
            assert by_content["Legacy lesson"]["status"] == "active"
            assert by_content[question]["status"] == "retired"
            assert all("Pending fact" != row["content"] for row in rows)

            project_memory = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )
            client_memory = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )
            malformed = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 2")
                ).scalar_one()
            )
            assert "_accepted_memory_candidates" not in project_memory
            assert "_accepted_memory_candidates" not in client_memory
            assert "_accepted_memory_candidates" in malformed
    finally:
        engine.dispose()


def test_revision_054_downgrade_restores_only_active_anchors_without_overwrite() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_tables(connection)
            connection.execute(text("INSERT INTO user VALUES (1)"))
            connection.execute(
                text("INSERT INTO project VALUES (1, :memory)"),
                {
                    "memory": json.dumps(
                        {
                            "_accepted_memory_candidates": {
                                "recent_progress": ["Existing value"]
                            }
                        }
                    )
                },
            )
            connection.execute(text("INSERT INTO clientrecord VALUES (1, '{}')"))
            connection.execute(
                text(
                    "INSERT INTO memorycandidate VALUES "
                    "(1, 'client', 'consulting_lesson', 'Restored lesson', 'accepted', "
                    "'lessons_learned', NULL, 1, 1, '2026-09-02', '2026-09-01')"
                )
            )
            _run(migration, connection, "upgrade")
            _run(migration, connection, "downgrade")

            assert "memorycandidateanchor" not in inspect(connection).get_table_names()
            project_memory = json.loads(
                connection.execute(
                    text("SELECT context_memory_json FROM project WHERE id = 1")
                ).scalar_one()
            )
            client_memory = json.loads(
                connection.execute(
                    text("SELECT client_memory_json FROM clientrecord WHERE id = 1")
                ).scalar_one()
            )
            assert project_memory["_accepted_memory_candidates"] == {
                "recent_progress": ["Existing value"]
            }
            assert client_memory["_accepted_memory_candidates"] == {
                "lessons_learned": ["Restored lesson"]
            }
    finally:
        engine.dispose()


def test_revision_054_is_a_noop_without_parent_tables() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _run(migration, connection, "upgrade")
            _run(migration, connection, "downgrade")
    finally:
        engine.dispose()


def test_revision_054_is_the_single_alembic_head() -> None:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["054_v1_54"]
    latest = script.get_revision("054_v1_54")
    assert latest is not None
    assert latest.down_revision == "053_v1_53"
