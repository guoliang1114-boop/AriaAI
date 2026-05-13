"""Tests for database module — Alembic revision normalization."""
import unittest


class NormalizeAlembicRevisionTestCase(unittest.TestCase):
    def test_normalizes_short_alias(self):
        from app.database import _normalize_alembic_revision
        local = ["001_v1_1", "002_v1_2", "003_v1_3"]
        result = _normalize_alembic_revision("001", local)
        self.assertEqual(result, "001_v1_1")

    def test_normalizes_exact_match(self):
        from app.database import _normalize_alembic_revision
        local = ["001_v1_1", "002_v1_2"]
        result = _normalize_alembic_revision("001_v1_1", local)
        self.assertEqual(result, "001_v1_1")

    def test_returns_input_for_unknown(self):
        from app.database import _normalize_alembic_revision
        local = ["001_v1_1", "002_v1_2"]
        result = _normalize_alembic_revision("999", local)
        self.assertEqual(result, "999")

    def test_returns_none_for_none_revision(self):
        from app.database import _normalize_alembic_revision
        local = ["001_v1_1"]
        result = _normalize_alembic_revision(None, local)
        self.assertIsNone(result)

    def test_normalizes_prefix_match(self):
        from app.database import _normalize_alembic_revision
        local = ["005_v1_5_todo_due_date", "006_v1_6_client_stakeholders"]
        result = _normalize_alembic_revision("005", local)
        self.assertEqual(result, "005_v1_5_todo_due_date")


class DatabaseEngineTestCase(unittest.TestCase):
    def test_engine_is_created(self):
        from app.database import engine
        self.assertIsNotNone(engine)

    def test_get_session_yields_session(self):
        from app.database import get_session
        gen = get_session()
        session = next(gen)
        self.assertIsNotNone(session)
        try:
            next(gen)
        except StopIteration:
            pass


if __name__ == "__main__":
    unittest.main()
