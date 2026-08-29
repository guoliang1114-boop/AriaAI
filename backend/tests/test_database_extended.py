"""Extended tests for database module — get_database_migration_governance."""
from datetime import datetime
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from app.database import _normalize_alembic_revision, get_database_migration_governance


def _load_memory_fact_migration():
    backend_dir = Path(__file__).resolve().parents[1]
    migration_path = backend_dir / "alembic" / "versions" / "034_v1_34_memory_fact_ledger.py"
    spec = importlib.util.spec_from_file_location("aria_migration_034", migration_path)
    if spec is None or spec.loader is None:
        raise AssertionError("unable to load memory fact migration")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NormalizeAlembicRevisionExtendedTestCase(unittest.TestCase):
    def test_multiple_prefix_matches_returns_input(self):
        local = ["001_v1_1", "001_v1_2"]
        result = _normalize_alembic_revision("001", local)
        # Multiple matches → ambiguous → returns input as-is
        self.assertEqual(result, "001")

    def test_single_prefix_match(self):
        local = ["005_v1_5_todo_due_date", "006_v1_6"]
        result = _normalize_alembic_revision("005", local)
        self.assertEqual(result, "005_v1_5_todo_due_date")

    def test_empty_string_revision(self):
        result = _normalize_alembic_revision("", ["001_v1_1"])
        self.assertIsNone(result)

    def test_full_revision_passthrough(self):
        local = ["001_v1_1", "002_v1_2"]
        result = _normalize_alembic_revision("002_v1_2", local)
        self.assertEqual(result, "002_v1_2")


class GetDatabaseMigrationGovernanceTestCase(unittest.TestCase):
    def test_returns_valid_structure(self):
        result = get_database_migration_governance()
        self.assertIn("mode", result)
        self.assertIn("current_revision", result)
        self.assertIn("latest_revision", result)
        self.assertIn("known_revisions", result)
        self.assertIn("pending_revisions", result)
        self.assertIn("pending_count", result)
        self.assertIn("up_to_date", result)
        self.assertIn("idempotent_bootstrap", result)
        self.assertIn("notes", result)

    def test_mode_is_valid(self):
        result = get_database_migration_governance()
        self.assertIn(result["mode"], ["alembic", "lightweight", "bootstrap"])

    def test_known_revisions_is_list(self):
        result = get_database_migration_governance()
        self.assertIsInstance(result["known_revisions"], list)

    def test_pending_revisions_is_list(self):
        result = get_database_migration_governance()
        self.assertIsInstance(result["pending_revisions"], list)

    def test_pending_count_is_int(self):
        result = get_database_migration_governance()
        self.assertIsInstance(result["pending_count"], int)
        self.assertGreaterEqual(result["pending_count"], 0)

    def test_idempotent_bootstrap_is_true(self):
        result = get_database_migration_governance()
        self.assertTrue(result["idempotent_bootstrap"])

    def test_hitas_schema_guard_revision_is_known(self):
        result = get_database_migration_governance()
        self.assertIn("016_v1_16", result["known_revisions"])

    def test_hitas_schema_guard_covers_required_columns(self):
        backend_dir = Path(__file__).resolve().parents[1]
        migration_path = backend_dir / "alembic" / "versions" / "016_v1_16_hitas_schema_guard.py"
        migration_source = migration_path.read_text(encoding="utf-8")
        for expected in [
            "risk_level",
            "policy_at_creation",
            "tool_input_hash",
            "approval_batch_id",
            "sequence_index",
            "owner_user_id",
        ]:
            self.assertIn(expected, migration_source)


class DatabaseHealthTestCase(unittest.TestCase):
    def test_get_database_health(self):
        from app.database import get_database_health
        result = get_database_health()
        self.assertIn("status", result)
        self.assertIn("table_count", result)
        self.assertIn("tables", result)
        self.assertIsInstance(result["tables"], list)
        self.assertGreater(result["table_count"], 0)


class MemoryFactMigrationTestCase(unittest.TestCase):
    def test_sqlite_text_timestamps_are_normalized_before_backfill(self):
        migration = _load_memory_fact_migration()

        self.assertEqual(
            migration._parse_datetime("2026-08-28 03:05:19.123456"),
            datetime(2026, 8, 28, 3, 5, 19, 123456),
        )
        self.assertEqual(
            migration._parse_datetime("2026-08-28T03:05:19Z"),
            datetime(2026, 8, 28, 3, 5, 19),
        )
        fallback = datetime(2026, 1, 1)
        self.assertEqual(migration._parse_datetime("not-a-time", fallback), fallback)

    def test_fact_backfill_identity_and_flattening_match_runtime_contract(self):
        migration = _load_memory_fact_migration()
        from app.services.memory_facts import _fact_key as runtime_fact_key

        value = {"pinned": ["Vendor delay"], "ai": ["Budget risk"]}

        facts = migration._flatten(value, "key_risks", project_scope=True)

        self.assertEqual(facts, [("pinned", "Vendor delay"), ("ai", "Budget risk")])
        self.assertEqual(
            migration._fact_key("project", "key_risks", "pinned", "Vendor delay"),
            "pmf_01194eaa6b1f0d85a9bf2fd8",
        )
        self.assertEqual(
            migration._fact_key("project", "key_risks", "pinned", "Vendor delay"),
            runtime_fact_key("project", "key_risks", "pinned", "Vendor delay"),
        )


class AlembicMigrationGraphTestCase(unittest.TestCase):
    """Guards against the dual-head class of bug.

    On 2026-06-16 migration 019_v1_19 was authored with down_revision=018_v1_18
    while the live chain had already advanced 018 -> 020 -> 021 -> 022. That
    forked the graph into two heads (019 + 022), which makes
    ``alembic upgrade head`` ambiguous; the deploy aborted at the migration
    step (before the backend restart) and *silently* failed every push for six
    days — the site stayed up on the old build, so nothing surfaced. These
    tests fail fast in CI instead of in production.
    """

    def _script_directory(self):
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        backend_dir = Path(__file__).resolve().parent.parent
        config = Config(str(backend_dir / "alembic.ini"))
        config.set_main_option("script_location", str(backend_dir / "alembic"))
        return ScriptDirectory.from_config(config)

    def test_exactly_one_head(self):
        heads = self._script_directory().get_heads()
        self.assertEqual(
            len(heads),
            1,
            f"Alembic has {len(heads)} heads ({sorted(heads)}); "
            "`alembic upgrade head` will be ambiguous and the deploy will abort. "
            "Point the new migration's down_revision at the current single tip, "
            "or add a no-op merge revision (down_revision=(headA, headB)).",
        )

    def test_no_duplicate_revision_ids(self):
        revisions = [r.revision for r in self._script_directory().walk_revisions()]
        duplicates = sorted({r for r in revisions if revisions.count(r) > 1})
        self.assertEqual(duplicates, [], f"Duplicate Alembic revision ids: {duplicates}")

    def test_head_is_resolvable(self):
        # ScriptDirectory.get_revision("head") raises when there are multiple
        # heads — the same failure mode the deploy hits. Asserting it resolves
        # is a second, behaviour-level guard alongside the count check.
        script = self._script_directory()
        head = script.get_revision("head")
        self.assertIsNotNone(head)


class TestDatabaseUtilityIsolationTestCase(unittest.TestCase):
    def test_drop_all_tables_supports_sqlite(self):
        from sqlalchemy import inspect, text
        from sqlmodel import create_engine

        from tests import test_database as test_database_module

        engine = create_engine("sqlite://")
        try:
            with engine.begin() as connection:
                connection.execute(text("CREATE TABLE sample (id INTEGER PRIMARY KEY)"))
            test_database_module.drop_all_tables(engine)
            self.assertEqual(inspect(engine).get_table_names(), [])
        finally:
            engine.dispose()

    def test_safe_schema_pattern_rejects_public(self):
        from tests import test_database as test_database_module

        pattern = test_database_module._SAFE_TEST_SCHEMA_PATTERN
        self.assertIsNotNone(pattern.fullmatch("ariaai_test_prod_123_1"))
        self.assertIsNone(pattern.fullmatch("public"))
        self.assertIsNone(pattern.fullmatch("ariaai_test_safe,public"))
        self.assertIsNone(pattern.fullmatch('ariaai_test_safe"; DROP SCHEMA public'))

    def test_xdist_worker_uses_dedicated_postgres_schema(self):
        from tests import test_database as test_database_module

        with patch.dict("os.environ", {"PYTEST_XDIST_WORKER": "gw0"}, clear=False), patch.object(
            test_database_module, "TEST_DATABASE_URL", "postgresql://postgres:password@localhost/test"
        ):
            self.assertEqual(test_database_module._xdist_schema_name(), "ariaai_test_gw0")

    def test_xdist_schema_is_disabled_for_non_postgres_urls(self):
        from tests import test_database as test_database_module

        with patch.dict("os.environ", {"PYTEST_XDIST_WORKER": "gw0"}, clear=False), patch.object(
            test_database_module, "TEST_DATABASE_URL", "sqlite:///tmp/test.db"
        ):
            self.assertIsNone(test_database_module._xdist_schema_name())


if __name__ == "__main__":
    unittest.main()
