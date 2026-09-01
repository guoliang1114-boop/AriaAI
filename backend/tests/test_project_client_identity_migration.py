"""Contract tests for the V1.35 stable project/client database identity.

These tests deliberately exercise both schema paths used during deployment:

* Alembic revision 035 for governed databases; and
* ``scripts/ensure_db.py`` for additive/bootstrap repair.

The compatibility backfill must never guess between duplicate client names.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlmodel import create_engine


BACKEND_DIR = Path(__file__).resolve().parents[1]
MIGRATION_PATH = (
    BACKEND_DIR / "alembic" / "versions" / "035_v1_35_project_client_identity.py"
)
ENSURE_DB_PATH = BACKEND_DIR / "scripts" / "ensure_db.py"


def _load_module(module_name: str, path: Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"unable to load module from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_legacy_schema(connection) -> None:
    connection.execute(
        text(
            'CREATE TABLE "user" ('
            "id INTEGER PRIMARY KEY, "
            "email VARCHAR NOT NULL"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE clientrecord ("
            "id INTEGER PRIMARY KEY, "
            "name VARCHAR NOT NULL"
            ")"
        )
    )
    connection.execute(
        text(
            "CREATE TABLE project ("
            "id INTEGER PRIMARY KEY, "
            "name VARCHAR NOT NULL, "
            "client VARCHAR NOT NULL"
            ")"
        )
    )


def _seed_identity_cases(connection) -> None:
    connection.execute(
        text(
            "INSERT INTO clientrecord (id, name) VALUES "
            "(1, :unique_name), "
            "(2, 'Duplicate'), "
            "(3, :duplicate_name), "
            "(4, :blank_name)"
        ),
        {
            "unique_name": "\u00a0Acme\u3000",
            "duplicate_name": "\tduplicate\u00a0",
            "blank_name": "\u3000\t",
        },
    )
    connection.execute(
        text(
            "INSERT INTO project (id, name, client) VALUES "
            "(101, 'Unique match', :unique_project), "
            "(102, 'Ambiguous match', :duplicate_project), "
            "(103, 'Blank identity', :blank_project), "
            "(104, 'No match', 'Missing Client')"
        ),
        {
            "unique_project": "  ACME\u3000",
            "duplicate_project": "\u00a0DUPLICATE ",
            "blank_project": " \u3000\t",
        },
    )


def _project_links(connection) -> dict[int, int | None]:
    return {
        int(project_id): int(client_id) if client_id is not None else None
        for project_id, client_id in connection.execute(
            text("SELECT id, client_id FROM project ORDER BY id")
        ).all()
    }


def test_current_revision_is_the_single_alembic_head() -> None:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["042_v1_42"]
    revision = script.get_revision("040_v1_40")
    assert revision is not None
    assert revision.down_revision == "039_v1_39"


def test_revision_035_backfills_only_unique_normalized_names_and_is_idempotent() -> None:
    migration = _load_module("aria_migration_035_sqlite", MIGRATION_PATH)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_legacy_schema(connection)
            _seed_identity_cases(connection)
            operations = Operations(MigrationContext.configure(connection))
            original_op = migration.op
            migration.op = operations
            try:
                migration.upgrade()
                first_links = _project_links(connection)
                # Re-entering an idempotent migration must not turn a later
                # business-row insert into an implicit relationship repair.
                # Backfill belongs only to the invocation that adds client_id.
                connection.execute(
                    text(
                        "INSERT INTO clientrecord (id, name, created_by_user_id) "
                        "VALUES (5, 'Missing Client', NULL)"
                    )
                )
                migration.upgrade()
                second_links = _project_links(connection)
            finally:
                migration.op = original_op

            assert first_links == {
                101: 1,
                102: None,
                103: None,
                104: None,
            }
            assert second_links == first_links

            db_inspector = inspect(connection)
            assert "client_id" in {
                column["name"] for column in db_inspector.get_columns("project")
            }
            assert "created_by_user_id" in {
                column["name"]
                for column in db_inspector.get_columns("clientrecord")
            }
            assert "ix_project_client_id" in {
                index["name"] for index in db_inspector.get_indexes("project")
            }
            assert "ix_clientrecord_created_by_user_id" in {
                index["name"]
                for index in db_inspector.get_indexes("clientrecord")
            }
    finally:
        engine.dispose()


def test_revision_035_sqlite_downgrade_removes_both_additive_columns() -> None:
    migration = _load_module("aria_migration_035_sqlite_downgrade", MIGRATION_PATH)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_legacy_schema(connection)
            operations = Operations(MigrationContext.configure(connection))
            original_op = migration.op
            migration.op = operations
            try:
                migration.upgrade()
                migration.downgrade()
                # A second downgrade is a no-op for a normally migrated schema.
                migration.downgrade()
            finally:
                migration.op = original_op

            db_inspector = inspect(connection)
            assert "client_id" not in {
                column["name"] for column in db_inspector.get_columns("project")
            }
            assert "created_by_user_id" not in {
                column["name"]
                for column in db_inspector.get_columns("clientrecord")
            }
            assert "ix_project_client_id" not in {
                index["name"] for index in db_inspector.get_indexes("project")
            }
            assert "ix_clientrecord_created_by_user_id" not in {
                index["name"]
                for index in db_inspector.get_indexes("clientrecord")
            }
    finally:
        engine.dispose()


def test_revision_035_declares_both_postgres_set_null_foreign_keys() -> None:
    migration = _load_module("aria_migration_035_postgres_contract", MIGRATION_PATH)

    class RecordingOp:
        def __init__(self) -> None:
            self.foreign_keys: list[dict] = []
            self.dropped_foreign_keys: list[tuple[str, str]] = []

        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def create_foreign_key(
            self,
            name,
            source,
            referent,
            local_columns,
            remote_columns,
            **options,
        ) -> None:
            self.foreign_keys.append(
                {
                    "name": name,
                    "source": source,
                    "referent": referent,
                    "local_columns": list(local_columns),
                    "remote_columns": list(remote_columns),
                    **options,
                }
            )

        def drop_constraint(self, name, table_name, **_options) -> None:
            self.dropped_foreign_keys.append((table_name, name))

    recording_op = RecordingOp()
    with (
        patch.object(migration, "op", recording_op),
        patch.object(migration, "_tables", return_value={"project", "clientrecord", "user"}),
        patch.object(
            migration,
            "_columns",
            side_effect=lambda table: {
                "project": {"id", "client", "client_id"},
                "clientrecord": {"id", "name", "created_by_user_id"},
            }.get(table, set()),
        ),
        patch.object(
            migration,
            "_indexes",
            side_effect=lambda table: {
                "project": {migration.INDEX_NAME},
                "clientrecord": {migration.CLIENT_CREATOR_INDEX_NAME},
            }.get(table, set()),
        ),
        patch.object(migration, "_backfill_unique_client_links"),
        patch.object(migration, "_foreign_keys", return_value=[]),
    ):
        migration.upgrade()

    assert recording_op.foreign_keys == [
        {
            "name": migration.CLIENT_CREATOR_FK_NAME,
            "source": "clientrecord",
            "referent": "user",
            "local_columns": ["created_by_user_id"],
            "remote_columns": ["id"],
            "ondelete": "SET NULL",
        },
        {
            "name": migration.FK_NAME,
            "source": "project",
            "referent": "clientrecord",
            "local_columns": ["client_id"],
            "remote_columns": ["id"],
            "ondelete": "SET NULL",
        },
    ]
    assert recording_op.dropped_foreign_keys == []


def test_revision_035_replaces_noncanonical_partial_foreign_keys() -> None:
    migration = _load_module("aria_migration_035_fk_repair", MIGRATION_PATH)

    class RecordingOp:
        def __init__(self) -> None:
            self.operations: list[tuple] = []

        def drop_constraint(self, name, table_name, **_options) -> None:
            self.operations.append(("drop", table_name, name))

        def create_foreign_key(
            self,
            name,
            source,
            referent,
            local_columns,
            remote_columns,
            **options,
        ) -> None:
            self.operations.append(
                (
                    "create",
                    source,
                    name,
                    referent,
                    tuple(local_columns),
                    tuple(remote_columns),
                    options.get("ondelete"),
                )
            )

    project_wrong = {
        "name": migration.FK_NAME,
        "constrained_columns": ["client_id"],
        "referred_table": "clientrecord",
        "referred_columns": ["id"],
        "options": {},
    }
    creator_wrong = {
        "name": "legacy_creator_fk",
        "constrained_columns": ["created_by_user_id"],
        "referred_table": "user",
        "referred_columns": ["id"],
        "options": {"ondelete": "NO ACTION"},
    }
    recording_op = RecordingOp()
    with (
        patch.object(migration, "op", recording_op),
        patch.object(
            migration,
            "_foreign_keys",
            side_effect=lambda table_name: {
                "project": [project_wrong],
                "clientrecord": [creator_wrong],
            }[table_name],
        ),
    ):
        migration._repair_set_null_foreign_key(
            table_name="project",
            column_name="client_id",
            referred_table="clientrecord",
            constraint_name=migration.FK_NAME,
        )
        migration._repair_set_null_foreign_key(
            table_name="clientrecord",
            column_name="created_by_user_id",
            referred_table="user",
            constraint_name=migration.CLIENT_CREATOR_FK_NAME,
        )

    assert recording_op.operations == [
        ("drop", "project", migration.FK_NAME),
        (
            "create",
            "project",
            migration.FK_NAME,
            "clientrecord",
            ("client_id",),
            ("id",),
            "SET NULL",
        ),
        ("drop", "clientrecord", "legacy_creator_fk"),
        (
            "create",
            "clientrecord",
            migration.CLIENT_CREATOR_FK_NAME,
            "user",
            ("created_by_user_id",),
            ("id",),
            "SET NULL",
        ),
    ]


def test_sqlmodel_metadata_keeps_both_set_null_foreign_keys_and_indexes() -> None:
    from app.models.db import ClientRecord, Project

    project_column = Project.__table__.c.client_id
    project_foreign_key = next(iter(project_column.foreign_keys))
    assert project_foreign_key.target_fullname == "clientrecord.id"
    assert project_foreign_key.ondelete == "SET NULL"
    assert project_column.index is True

    creator_column = ClientRecord.__table__.c.created_by_user_id
    creator_foreign_key = next(iter(creator_column.foreign_keys))
    assert creator_foreign_key.target_fullname == "user.id"
    assert creator_foreign_key.ondelete == "SET NULL"
    assert creator_column.index is True


def test_ensure_db_backfill_is_unique_one_time_and_idempotent() -> None:
    ensure_db = _load_module("aria_ensure_db_identity", ENSURE_DB_PATH)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_legacy_schema(connection)
            _seed_identity_cases(connection)

            db_inspector = inspect(connection)
            ensure_db._ensure_project_client_identity(
                connection,
                db_inspector,
                report_only=False,
            )
            ensure_db._ensure_client_creator_identity(
                connection,
                db_inspector,
                report_only=False,
            )

            assert _project_links(connection) == {
                101: 1,
                102: None,
                103: None,
                104: None,
            }

            # The compatibility backfill is deliberately one-time. Creating a
            # future client with the same display name must not silently bind a
            # previously unlinked project when ensure_db is rerun.
            connection.execute(
                text(
                    "INSERT INTO clientrecord (id, name, created_by_user_id) "
                    "VALUES (5, 'Missing Client', NULL)"
                )
            )
            fresh_inspector = inspect(connection)
            ensure_db._ensure_project_client_identity(
                connection,
                fresh_inspector,
                report_only=False,
            )
            ensure_db._ensure_client_creator_identity(
                connection,
                fresh_inspector,
                report_only=False,
            )

            assert _project_links(connection)[104] is None
            db_inspector = inspect(connection)
            assert "ix_project_client_id" in {
                index["name"] for index in db_inspector.get_indexes("project")
            }
            assert "ix_clientrecord_created_by_user_id" in {
                index["name"]
                for index in db_inspector.get_indexes("clientrecord")
            }
    finally:
        engine.dispose()


def test_ensure_db_report_only_does_not_mutate_legacy_schema() -> None:
    ensure_db = _load_module("aria_ensure_db_identity_report", ENSURE_DB_PATH)
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            _create_legacy_schema(connection)
            _seed_identity_cases(connection)
            db_inspector = inspect(connection)

            ensure_db._ensure_project_client_identity(
                connection,
                db_inspector,
                report_only=True,
            )
            ensure_db._ensure_client_creator_identity(
                connection,
                db_inspector,
                report_only=True,
            )

            db_inspector = inspect(connection)
            assert "client_id" not in {
                column["name"] for column in db_inspector.get_columns("project")
            }
            assert "created_by_user_id" not in {
                column["name"]
                for column in db_inspector.get_columns("clientrecord")
            }
    finally:
        engine.dispose()


def test_ensure_db_declares_missing_postgres_set_null_foreign_keys() -> None:
    ensure_db = _load_module("aria_ensure_db_identity_postgres", ENSURE_DB_PATH)

    class ContractInspector:
        def get_table_names(self):
            return ["project", "clientrecord", "user"]

        def get_columns(self, table_name):
            return {
                "project": [{"name": "id"}, {"name": "client"}, {"name": "client_id"}],
                "clientrecord": [
                    {"name": "id"},
                    {"name": "name"},
                    {"name": "created_by_user_id"},
                ],
            }.get(table_name, [{"name": "id"}])

        def get_indexes(self, table_name):
            return {
                "project": [{"name": "ix_project_client_id"}],
                "clientrecord": [{"name": "ix_clientrecord_created_by_user_id"}],
            }.get(table_name, [])

        def get_foreign_keys(self, _table_name):
            return []

    class RecordingConnection:
        dialect = SimpleNamespace(name="postgresql")

        def __init__(self) -> None:
            self.statements: list[str] = []

        def execute(self, statement, _parameters=None):
            self.statements.append(str(statement))
            return SimpleNamespace(rowcount=0)

    inspector = ContractInspector()
    connection = RecordingConnection()
    with patch.object(ensure_db, "inspect", return_value=inspector):
        ensure_db._ensure_project_client_identity(
            connection,
            inspector,
            report_only=False,
        )
        ensure_db._ensure_client_creator_identity(
            connection,
            inspector,
            report_only=False,
        )

    ddl = "\n".join(connection.statements)
    assert "fk_project_client_id_clientrecord" in ddl
    assert "client_id" in ddl and "clientrecord" in ddl
    assert "fk_clientrecord_created_by_user_id_user" in ddl
    assert "created_by_user_id" in ddl and '"user"' in ddl
    assert ddl.count("ON DELETE SET NULL") == 2


def test_ensure_db_replaces_noncanonical_postgres_foreign_keys() -> None:
    ensure_db = _load_module("aria_ensure_db_identity_fk_repair", ENSURE_DB_PATH)

    class ContractInspector:
        def get_foreign_keys(self, table_name):
            return {
                "project": [
                    {
                        "name": "fk_project_client_id_clientrecord",
                        "constrained_columns": ["client_id"],
                        "referred_table": "clientrecord",
                        "referred_columns": ["id"],
                        "options": {},
                    }
                ],
                "clientrecord": [
                    {
                        "name": "legacy_creator_fk",
                        "constrained_columns": ["created_by_user_id"],
                        "referred_table": "user",
                        "referred_columns": ["id"],
                        "options": {"ondelete": "NO ACTION"},
                    }
                ],
            }[table_name]

    class RecordingConnection:
        dialect = SimpleNamespace(name="postgresql")

        def __init__(self) -> None:
            self.statements: list[str] = []

        def execute(self, statement, _parameters=None):
            self.statements.append(str(statement))
            return SimpleNamespace(rowcount=0)

    connection = RecordingConnection()
    inspector = ContractInspector()
    ensure_db._repair_postgres_set_null_foreign_key(
        connection,
        inspector,
        table_name="project",
        column_name="client_id",
        referred_table="clientrecord",
        constraint_name="fk_project_client_id_clientrecord",
        report_only=False,
    )
    ensure_db._repair_postgres_set_null_foreign_key(
        connection,
        inspector,
        table_name="clientrecord",
        column_name="created_by_user_id",
        referred_table="user",
        constraint_name="fk_clientrecord_created_by_user_id_user",
        report_only=False,
    )

    ddl = connection.statements
    assert len(ddl) == 4
    assert "DROP CONSTRAINT" in ddl[0]
    assert "fk_project_client_id_clientrecord" in ddl[0]
    assert "ADD CONSTRAINT" in ddl[1] and "ON DELETE SET NULL" in ddl[1]
    assert "DROP CONSTRAINT" in ddl[2] and "legacy_creator_fk" in ddl[2]
    assert "ADD CONSTRAINT" in ddl[3] and "ON DELETE SET NULL" in ddl[3]
