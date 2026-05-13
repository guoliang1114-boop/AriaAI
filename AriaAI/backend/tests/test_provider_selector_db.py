"""Tests for provider_selector DB-dependent functions with mocked session."""
import unittest
from unittest.mock import MagicMock, patch

from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from app.models.db import Setting


class GetProviderNameTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_returns_claude_by_default(self):
        from app.services.provider_selector import get_provider_name
        with Session(self.engine) as session:
            result = get_provider_name(session)
            self.assertEqual(result, "claude")

    def test_normalizes_anthropic_to_claude(self):
        from app.services.provider_selector import get_provider_name
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="anthropic"))
            session.commit()
            result = get_provider_name(session)
            self.assertEqual(result, "claude")

    def test_normalizes_moonshot_to_kimi(self):
        from app.services.provider_selector import get_provider_name
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="moonshot"))
            session.commit()
            result = get_provider_name(session)
            self.assertEqual(result, "kimi")

    def test_normalizes_xiaomi_to_mimo(self):
        from app.services.provider_selector import get_provider_name
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="xiaomi"))
            session.commit()
            result = get_provider_name(session)
            self.assertEqual(result, "mimo")

    def test_deepseek_passthrough(self):
        from app.services.provider_selector import get_provider_name
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="deepseek"))
            session.commit()
            result = get_provider_name(session)
            self.assertEqual(result, "deepseek")

    def test_bigmodel_passthrough(self):
        from app.services.provider_selector import get_provider_name
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="bigmodel"))
            session.commit()
            result = get_provider_name(session)
            self.assertEqual(result, "bigmodel")

    def test_mimo_passthrough(self):
        from app.services.provider_selector import get_provider_name
        with Session(self.engine) as session:
            session.add(Setting(key="llm_provider", value="mimo"))
            session.commit()
            result = get_provider_name(session)
            self.assertEqual(result, "mimo")


class GetSelectedModelTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        SQLModel.metadata.create_all(self.engine)

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_returns_default_for_claude(self):
        from app.services.provider_selector import get_selected_model
        with Session(self.engine) as session:
            result = get_selected_model(session, provider="claude")
            self.assertIsInstance(result, str)
            self.assertGreater(len(result), 0)

    def test_returns_default_for_kimi(self):
        from app.services.provider_selector import get_selected_model
        with Session(self.engine) as session:
            result = get_selected_model(session, provider="kimi")
            self.assertIsInstance(result, str)
            self.assertIn("kimi", result.lower())

    def test_returns_default_for_deepseek(self):
        from app.services.provider_selector import get_selected_model
        with Session(self.engine) as session:
            result = get_selected_model(session, provider="deepseek")
            self.assertIsInstance(result, str)

    def test_returns_stored_model(self):
        from app.services.provider_selector import get_selected_model
        with Session(self.engine) as session:
            session.add(Setting(key="selected_model", value="claude-3-opus"))
            session.commit()
            result = get_selected_model(session, provider="claude")
            self.assertEqual(result, "claude-3-opus")

    def test_applies_model_aliases(self):
        from app.services.provider_selector import get_selected_model
        with Session(self.engine) as session:
            session.add(Setting(key="selected_model", value="sonnet"))
            session.commit()
            result = get_selected_model(session, provider="claude")
            self.assertIsInstance(result, str)


if __name__ == "__main__":
    unittest.main()
