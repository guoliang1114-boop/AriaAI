"""Extended tests for database module — get_database_migration_governance."""
from pathlib import Path
import unittest
from unittest.mock import patch

from app.database import _normalize_alembic_revision, get_database_migration_governance


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


class TestDatabaseUtilityIsolationTestCase(unittest.TestCase):
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
