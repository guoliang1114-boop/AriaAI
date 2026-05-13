"""Tests for provider selector — module loading, model resolution, provider name."""
import unittest
from unittest.mock import MagicMock

from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.models.db import Setting
from app.services import provider_selector as ps


class ProviderSelectorTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_get_provider_name_default(self):
        with Session(self.engine) as session:
            self.assertEqual(ps.get_provider_name(session), "claude")

    def test_get_provider_name_from_setting(self):
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="deepseek"))
            session.commit()
            self.assertEqual(ps.get_provider_name(session), "deepseek")

    def test_get_provider_name_normalizes_anthropic(self):
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="anthropic"))
            session.commit()
            self.assertEqual(ps.get_provider_name(session), "claude")

    def test_get_provider_name_normalizes_moonshot(self):
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="moonshot"))
            session.commit()
            self.assertEqual(ps.get_provider_name(session), "kimi")

    def test_get_provider_name_normalizes_xiaomi(self):
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="xiaomi"))
            session.commit()
            self.assertEqual(ps.get_provider_name(session), "mimo")

    def test_get_provider_name_unknown_fallback(self):
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="unknown"))
            session.commit()
            self.assertEqual(ps.get_provider_name(session), "claude")

    def test_get_selected_model_default(self):
        with Session(self.engine) as session:
            model = ps.get_selected_model(session)
            self.assertIsInstance(model, str)
            self.assertGreater(len(model), 0)

    def test_get_selected_model_from_setting(self):
        with Session(self.engine) as session:
            session.add(Setting(key="selected_model", value="deepseek-chat"))
            session.commit()
            model = ps.get_selected_model(session)
            self.assertEqual(model, "deepseek-chat")

    def test_resolve_provider_from_model(self):
        self.assertEqual(ps.resolve_provider_from_model("claude-3-opus"), "claude")
        self.assertEqual(ps.resolve_provider_from_model("moonshot-v1-32k"), "kimi")
        self.assertEqual(ps.resolve_provider_from_model("kimi-k2.6"), "kimi")
        self.assertEqual(ps.resolve_provider_from_model("deepseek-chat"), "deepseek")
        self.assertEqual(ps.resolve_provider_from_model("glm-4-plus"), "bigmodel")
        self.assertEqual(ps.resolve_provider_from_model("mimo-v2.5-flash"), "mimo")
        self.assertEqual(ps.resolve_provider_from_model("unknown"), "claude")

    def test_get_model_for_provider_matches_current(self):
        with Session(self.engine) as session:
            session.add(Setting(key="selected_model", value="claude-3-opus"))
            session.commit()
            model = ps.get_model_for_provider("claude", session)
            self.assertEqual(model, "claude-3-opus")

    def test_get_model_for_provider_fallback(self):
        with Session(self.engine) as session:
            session.add(Setting(key="selected_model", value="claude-3-opus"))
            session.commit()
            model = ps.get_model_for_provider("deepseek", session)
            self.assertIn("deepseek", model.lower())

    def test_load_provider_module_claude(self):
        mod = ps._load_provider_module("claude")
        self.assertIsNotNone(mod)

    def test_load_provider_module_kimi(self):
        mod = ps._load_provider_module("kimi")
        self.assertIsNotNone(mod)

    def test_load_provider_module_unknown_raises(self):
        with self.assertRaises(ValueError) as ctx:
            ps._load_provider_module("unknown")
        self.assertIn("Unknown provider", str(ctx.exception))
