"""Extended tests for database module — get_database_migration_governance."""
import unittest

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


class DatabaseHealthTestCase(unittest.TestCase):
    def test_get_database_health(self):
        from app.database import get_database_health
        result = get_database_health()
        self.assertIn("status", result)
        self.assertIn("table_count", result)
        self.assertIn("tables", result)
        self.assertIsInstance(result["tables"], list)
        self.assertGreater(result["table_count"], 0)


if __name__ == "__main__":
    unittest.main()
