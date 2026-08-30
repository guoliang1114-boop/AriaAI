from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import patch

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import create_engine


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    BACKEND_DIR / "alembic" / "versions" / "036_v1_36_durable_run_recovery.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "aria_migration_036_sqlite",
        MIGRATION_PATH,
    )
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load migration 036")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_revision_036_adds_content_free_mailbox_idempotently() -> None:
    migration = _load_migration()
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.execute(
                text(
                    "CREATE TABLE conversation (id INTEGER PRIMARY KEY);"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE message (id INTEGER PRIMARY KEY, "
                    "conversation_id INTEGER NOT NULL, role VARCHAR NOT NULL, "
                    "content VARCHAR NOT NULL)"
                )
            )
            connection.execute(
                text(
                    "CREATE TABLE chatrun (id INTEGER PRIMARY KEY, "
                    "run_id VARCHAR NOT NULL UNIQUE)"
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
            assert "chatruninput" in db_inspector.get_table_names()
            chatrun_columns = {
                item["name"] for item in db_inspector.get_columns("chatrun")
            }
            assert {"parent_run_id", "recovery_snapshot_sha256"}.issubset(
                chatrun_columns
            )
            input_columns = {
                item["name"] for item in db_inspector.get_columns("chatruninput")
            }
            assert input_columns == {
                "id",
                "run_id",
                "chat_run_id",
                "conversation_id",
                "message_id",
                "kind",
                "sequence",
                "content_sha256",
                "status",
                "accepted_at",
                "applied_at",
            }
            assert "content" not in input_columns
            chatrun_unique = {
                item["name"]: item
                for item in db_inspector.get_unique_constraints("chatrun")
            }
            assert chatrun_unique[
                "uq_chatrun_parent_recovery_snapshot"
            ]["column_names"] == ["parent_run_id", "recovery_snapshot_sha256"]
            assert {
                item["name"] for item in db_inspector.get_check_constraints("chatrun")
            } == {"ck_chatrun_recovery_identity"}
            parent_foreign_key = next(
                item
                for item in db_inspector.get_foreign_keys("chatrun")
                if item["constrained_columns"] == ["parent_run_id"]
            )
            assert parent_foreign_key["referred_table"] == "chatrun"
            assert parent_foreign_key["referred_columns"] == ["run_id"]
            assert parent_foreign_key["options"]["ondelete"] == "SET NULL"

            assert {
                item["name"]
                for item in db_inspector.get_check_constraints("chatruninput")
            } == {
                "ck_chatruninput_kind",
                "ck_chatruninput_status",
                "ck_chatruninput_sequence",
                "ck_chatruninput_content_sha256",
            }
            assert {
                item["name"]
                for item in db_inspector.get_unique_constraints("chatruninput")
            } == {"uq_chatruninput_chat_run_sequence"}
            input_foreign_keys = {
                tuple(item["constrained_columns"]): item
                for item in db_inspector.get_foreign_keys("chatruninput")
            }
            assert (
                input_foreign_keys[("chat_run_id",)]["options"]["ondelete"]
                == "CASCADE"
            )
            assert (
                input_foreign_keys[("conversation_id",)]["options"]["ondelete"]
                == "CASCADE"
            )
            assert (
                input_foreign_keys[("message_id",)]["options"]["ondelete"]
                == "SET NULL"
            )

            connection.execute(text("INSERT INTO conversation (id) VALUES (1)"))
            connection.execute(
                text(
                    "INSERT INTO message (id, conversation_id, role, content) "
                    "VALUES (1, 1, 'user', 'steer')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO chatrun "
                    "(id, run_id, parent_run_id, recovery_snapshot_sha256) "
                    "VALUES (1, 'run_parent', NULL, '')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO chatrun "
                    "(id, run_id, parent_run_id, recovery_snapshot_sha256) "
                    "VALUES (2, 'run_child', 'run_parent', :snapshot)"
                ),
                {"snapshot": "a" * 64},
            )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO chatrun "
                        "(id, run_id, parent_run_id, recovery_snapshot_sha256) "
                        "VALUES (3, 'run_bad_digest', 'run_parent', 'short')"
                    )
                )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO chatrun "
                        "(id, run_id, parent_run_id, recovery_snapshot_sha256) "
                        "VALUES (3, 'run_bad_parent', 'run_missing', :snapshot)"
                    ),
                    {"snapshot": "b" * 64},
                )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO chatrun "
                        "(id, run_id, parent_run_id, recovery_snapshot_sha256) "
                        "VALUES (3, 'run_duplicate_child', 'run_parent', :snapshot)"
                    ),
                    {"snapshot": "a" * 64},
                )

            connection.execute(
                text(
                    "INSERT INTO chatruninput "
                    "(id, run_id, chat_run_id, conversation_id, message_id, "
                    "kind, sequence, content_sha256, status, accepted_at) "
                    "VALUES (1, 'run_child', 2, 1, 1, 'steering', 1, "
                    ":digest, 'accepted', CURRENT_TIMESTAMP)"
                ),
                {"digest": "c" * 64},
            )
            invalid_mailbox_rows = (
                {
                    "kind": "unknown",
                    "sequence": 2,
                    "digest": "d" * 64,
                    "status": "accepted",
                },
                {
                    "kind": "steering",
                    "sequence": 0,
                    "digest": "d" * 64,
                    "status": "accepted",
                },
                {
                    "kind": "steering",
                    "sequence": 2,
                    "digest": "short",
                    "status": "accepted",
                },
                {
                    "kind": "steering",
                    "sequence": 2,
                    "digest": "d" * 64,
                    "status": "unknown",
                },
            )
            for invalid_row in invalid_mailbox_rows:
                with pytest.raises(IntegrityError), connection.begin_nested():
                    connection.execute(
                        text(
                            "INSERT INTO chatruninput "
                            "(id, run_id, chat_run_id, conversation_id, message_id, "
                            "kind, sequence, content_sha256, status, accepted_at) "
                            "VALUES (2, 'run_child', 2, 1, 1, :kind, :sequence, "
                            ":digest, :status, CURRENT_TIMESTAMP)"
                        ),
                        invalid_row,
                    )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO chatruninput "
                        "(id, run_id, chat_run_id, conversation_id, message_id, "
                        "kind, sequence, content_sha256, status, accepted_at) "
                        "VALUES (2, 'run_child', 2, 1, 1, 'steering', 1, "
                        ":digest, 'accepted', CURRENT_TIMESTAMP)"
                    ),
                    {"digest": "d" * 64},
                )
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text(
                        "INSERT INTO chatruninput "
                        "(id, run_id, chat_run_id, conversation_id, message_id, "
                        "kind, sequence, content_sha256, status, accepted_at) "
                        "VALUES (2, 'run_missing', 999, 1, 1, 'steering', 1, "
                        ":digest, 'accepted', CURRENT_TIMESTAMP)"
                    ),
                    {"digest": "d" * 64},
                )

            connection.execute(text("DELETE FROM chatrun WHERE id = 1"))
            assert connection.execute(
                text("SELECT parent_run_id FROM chatrun WHERE id = 2")
            ).scalar_one() is None
    finally:
        engine.dispose()


def test_revision_036_declares_postgres_constraints_and_is_idempotent() -> None:
    migration = _load_migration()

    class _Dialect:
        name = "postgresql"

    class _Bind:
        dialect = _Dialect()

    class RecordingOp:
        def __init__(self) -> None:
            self.columns: list[tuple[str, str]] = []
            self.indexes: list[tuple[str, str, tuple[str, ...], bool]] = []
            self.foreign_keys: list[tuple] = []
            self.unique_constraints: list[tuple] = []
            self.check_constraints: list[tuple] = []
            self.tables: list[tuple] = []

        @staticmethod
        def get_bind():
            return _Bind()

        def add_column(self, table_name, column):
            self.columns.append((table_name, column.name))

        def create_index(self, name, table_name, columns, unique=False):
            self.indexes.append((name, table_name, tuple(columns), bool(unique)))

        def create_foreign_key(self, *args, **kwargs):
            self.foreign_keys.append((*args, kwargs))

        def create_unique_constraint(self, *args, **kwargs):
            self.unique_constraints.append((*args, kwargs))

        def create_check_constraint(self, *args, **kwargs):
            self.check_constraints.append((*args, kwargs))

        def create_table(self, *args, **kwargs):
            self.tables.append((*args, kwargs))

    recording_op = RecordingOp()
    with (
        patch.object(migration, "op", recording_op),
        patch.object(migration, "_tables", return_value={"chatrun"}),
        patch.object(migration, "_columns", return_value={"id", "run_id"}),
        patch.object(migration, "_indexes", return_value=set()),
        patch.object(migration, "_foreign_key_columns", return_value=set()),
        patch.object(migration, "_unique_constraints", return_value=set()),
        patch.object(migration, "_check_constraints", return_value=set()),
    ):
        migration.upgrade()

    assert recording_op.columns == [
        ("chatrun", "parent_run_id"),
        ("chatrun", "recovery_snapshot_sha256"),
    ]
    assert recording_op.foreign_keys == [
        (
            "fk_chatrun_parent_run_id_chatrun",
            "chatrun",
            "chatrun",
            ["parent_run_id"],
            ["run_id"],
            {"ondelete": "SET NULL"},
        )
    ]
    assert recording_op.unique_constraints == [
        (
            "uq_chatrun_parent_recovery_snapshot",
            "chatrun",
            ["parent_run_id", "recovery_snapshot_sha256"],
            {},
        )
    ]
    assert recording_op.check_constraints == [
        (
            "ck_chatrun_recovery_identity",
            "chatrun",
            "parent_run_id IS NULL OR length(recovery_snapshot_sha256) = 64",
            {},
        )
    ]
    assert recording_op.tables[0][0] == "chatruninput"

    rerun_op = RecordingOp()
    existing_indexes = {
        "ix_chatrun_parent_run_id",
        "ix_chatrun_recovery_snapshot_sha256",
        "ix_chatruninput_run_id",
        "ix_chatruninput_chat_run_id",
        "ix_chatruninput_conversation_id",
        "ix_chatruninput_message_id",
        "ix_chatruninput_kind",
        "ix_chatruninput_content_sha256",
        "ix_chatruninput_status",
        "ix_chatruninput_accepted_at",
        "ix_chatruninput_applied_at",
    }
    with (
        patch.object(migration, "op", rerun_op),
        patch.object(
            migration,
            "_tables",
            return_value={"chatrun", "chatruninput"},
        ),
        patch.object(
            migration,
            "_columns",
            return_value={
                "id",
                "run_id",
                "parent_run_id",
                "recovery_snapshot_sha256",
            },
        ),
        patch.object(migration, "_indexes", return_value=existing_indexes),
        patch.object(
            migration,
            "_foreign_key_columns",
            return_value={("parent_run_id",)},
        ),
        patch.object(
            migration,
            "_unique_constraints",
            return_value={"uq_chatrun_parent_recovery_snapshot"},
        ),
        patch.object(
            migration,
            "_check_constraints",
            return_value={"ck_chatrun_recovery_identity"},
        ),
    ):
        migration.upgrade()

    assert rerun_op.columns == []
    assert rerun_op.indexes == []
    assert rerun_op.foreign_keys == []
    assert rerun_op.unique_constraints == []
    assert rerun_op.check_constraints == []
    assert rerun_op.tables == []
