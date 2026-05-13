"""Tests for settings_helper — typed DB setting accessors."""
import unittest

from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import Setting
from app.services.settings_helper import (
    get_setting_value,
    get_float_setting,
    get_int_setting,
    get_bool_setting,
    LLMSettings,
)

from tests.test_database import create_test_engine, drop_all_tables


class GetSettingValueTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(Setting(key="max_tokens", value="4096"))
            session.add(Setting(key="temperature", value="0.7"))
            session.add(Setting(key="enabled", value="true"))
            session.add(Setting(key="disabled", value="false"))
            session.add(Setting(key="empty_val", value=""))
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_returns_existing_value(self):
        with Session(self.engine) as session:
            self.assertEqual(get_setting_value(session, "max_tokens"), "4096")

    def test_returns_empty_string_for_missing_key(self):
        with Session(self.engine) as session:
            val = get_setting_value(session, "nonexistent")
            self.assertEqual(val, "")

    def test_returns_default_for_missing_key(self):
        with Session(self.engine) as session:
            val = get_setting_value(session, "nonexistent", default="fallback")
            self.assertEqual(val, "fallback")

    def test_returns_empty_string_value(self):
        with Session(self.engine) as session:
            val = get_setting_value(session, "empty_val")
            self.assertEqual(val, "")


class GetFloatSettingTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(Setting(key="temperature", value="0.7"))
            session.add(Setting(key="bad_float", value="not_a_number"))
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_parses_float(self):
        with Session(self.engine) as session:
            self.assertAlmostEqual(get_float_setting(session, "temperature", 1.0), 0.7)

    def test_returns_default_for_missing(self):
        with Session(self.engine) as session:
            self.assertEqual(get_float_setting(session, "missing", 1.5), 1.5)

    def test_returns_default_for_invalid(self):
        with Session(self.engine) as session:
            self.assertEqual(get_float_setting(session, "bad_float", 2.0), 2.0)


class GetIntSettingTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(Setting(key="max_tokens", value="4096"))
            session.add(Setting(key="bad_int", value="abc"))
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_parses_int(self):
        with Session(self.engine) as session:
            self.assertEqual(get_int_setting(session, "max_tokens", 2048), 4096)

    def test_returns_default_for_missing(self):
        with Session(self.engine) as session:
            self.assertEqual(get_int_setting(session, "missing", 100), 100)

    def test_returns_default_for_invalid(self):
        with Session(self.engine) as session:
            self.assertEqual(get_int_setting(session, "bad_int", 50), 50)


class GetBoolSettingTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(Setting(key="flag_true", value="true"))
            session.add(Setting(key="flag_false", value="false"))
            session.add(Setting(key="flag_1", value="1"))
            session.add(Setting(key="flag_yes", value="yes"))
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_true_value(self):
        with Session(self.engine) as session:
            self.assertTrue(get_bool_setting(session, "flag_true", False))

    def test_false_value(self):
        with Session(self.engine) as session:
            self.assertFalse(get_bool_setting(session, "flag_false", True))

    def test_numeric_one(self):
        with Session(self.engine) as session:
            self.assertTrue(get_bool_setting(session, "flag_1", False))

    def test_yes_value(self):
        with Session(self.engine) as session:
            self.assertTrue(get_bool_setting(session, "flag_yes", False))

    def test_default_for_missing(self):
        with Session(self.engine) as session:
            self.assertTrue(get_bool_setting(session, "missing", True))


class LLMSettingsTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            session.add(Setting(key="max_tokens", value="4096"))
            session.add(Setting(key="temperature", value="0.7"))
            session.add(Setting(key="top_p", value="0.9"))
            session.add(Setting(key="presence_penalty", value="0.1"))
            session.add(Setting(key="frequency_penalty", value="0.2"))
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_max_tokens(self):
        with Session(self.engine) as session:
            self.assertEqual(LLMSettings(session).max_tokens, 4096)

    def test_temperature(self):
        with Session(self.engine) as session:
            self.assertAlmostEqual(LLMSettings(session).temperature, 0.7)

    def test_top_p(self):
        with Session(self.engine) as session:
            self.assertAlmostEqual(LLMSettings(session).top_p, 0.9)

    def test_presence_penalty(self):
        with Session(self.engine) as session:
            self.assertAlmostEqual(LLMSettings(session).presence_penalty, 0.1)

    def test_frequency_penalty(self):
        with Session(self.engine) as session:
            self.assertAlmostEqual(LLMSettings(session).frequency_penalty, 0.2)

    def test_defaults_when_empty_db(self):
        engine2 = create_test_engine()
        SQLModel.metadata.create_all(engine2)
        with Session(engine2) as session:
            s = LLMSettings(session)
            self.assertEqual(s.max_tokens, 8192)
            self.assertAlmostEqual(s.temperature, 0.7)
            self.assertAlmostEqual(s.top_p, 1.0)
            self.assertAlmostEqual(s.presence_penalty, 0.0)
            self.assertAlmostEqual(s.frequency_penalty, 0.0)
        SQLModel.metadata.drop_all(engine2)
        engine2.dispose()


if __name__ == "__main__":
    unittest.main()
