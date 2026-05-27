"""Tests for settings router — API key status, settings CRUD."""
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select

from app.models.db import User, Setting
from app.routers import settings as settings_module
from app.routers.settings import router
from app.services.cache import TTLCache
from tests.test_database import create_test_engine, drop_all_tables


class SettingsRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            session.add(Setting(key="theme", value="dark"))
            session.add(Setting(key="timezone", value="Asia/Shanghai"))
            session.commit()

        app = FastAPI()
        app.include_router(router)

        def override_session():
            with Session(self.engine) as session:
                yield session

        app.dependency_overrides[settings_module.get_session] = override_session
        self.client = TestClient(app, raise_server_exceptions=False)

        settings_module._settings_cache.clear()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_list_settings(self):
        resp = self.client.get("/settings/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("theme", data)
        self.assertEqual(data["theme"], "dark")
        self.assertEqual(data["timezone"], "Asia/Shanghai")

    def test_secret_keys_are_never_exposed(self):
        with Session(self.engine) as session:
            session.add(Setting(key="api_key", value="sk-super-secret"))
            session.add(Setting(key="kimi_api_key", value="kimi-secret"))
            session.commit()
        settings_module._settings_cache.clear()

        # Bulk read must not include any secret key.
        bulk = self.client.get("/settings/").json()
        self.assertNotIn("api_key", bulk)
        self.assertNotIn("kimi_api_key", bulk)
        self.assertIn("theme", bulk)

        # Single-key read of a secret must 404 (do not confirm existence/value).
        self.assertEqual(self.client.get("/settings/api_key").status_code, 404)

        # Generic PUT must refuse to write a secret key.
        self.assertEqual(
            self.client.put("/settings/api_key", json={"value": "x"}).status_code, 403
        )

    def test_list_settings_empty_db(self):
        SQLModel.metadata.drop_all(self.engine)
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        settings_module._settings_cache.clear()
        resp = self.client.get("/settings/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {"timezone": "Asia/Shanghai"})

    def test_get_default_timezone_when_missing(self):
        SQLModel.metadata.drop_all(self.engine)
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)
        settings_module._settings_cache.clear()
        resp = self.client.get("/settings/timezone")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["value"], "Asia/Shanghai")

    def test_metadata_endpoint(self):
        resp = self.client.get("/settings/metadata")
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.json(), dict)

    def test_hierarchy_endpoint(self):
        resp = self.client.get("/settings/hierarchy")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("layers", data)
        self.assertIn("resolution_order", data)

    def test_api_key_status_returns_configured_field(self):
        resp = self.client.get("/settings/api-key-status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("configured", data)
        self.assertIsInstance(data["configured"], bool)

    def test_kimi_api_key_status_no_key(self):
        resp = self.client.get("/settings/kimi-api-key-status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("configured", data)

    def test_openai_api_key_status_no_key(self):
        resp = self.client.get("/settings/openai-api-key-status")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("configured", resp.json())

    def test_deepseek_api_key_status_no_key(self):
        resp = self.client.get("/settings/deepseek-api-key-status")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("configured", resp.json())

    def test_bigmodel_api_key_status_no_key(self):
        resp = self.client.get("/settings/bigmodel-api-key-status")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("configured", resp.json())

    def test_mimo_api_key_status_no_key(self):
        resp = self.client.get("/settings/mimo-api-key-status")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("configured", resp.json())

    def test_update_setting(self):
        resp = self.client.put("/settings/theme", json={"value": "light"})
        self.assertIn(resp.status_code, [200, 204])
        settings_module._settings_cache.clear()
        resp2 = self.client.get("/settings/")
        self.assertEqual(resp2.json()["theme"], "light")

    def test_create_new_setting(self):
        resp = self.client.put("/settings/new_key", json={"value": "new_value"})
        self.assertIn(resp.status_code, [200, 201, 204])
        settings_module._settings_cache.clear()
        resp2 = self.client.get("/settings/")
        self.assertEqual(resp2.json().get("new_key"), "new_value")

    def test_get_setting_by_key(self):
        resp = self.client.get("/settings/theme")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["value"], "dark")

    def test_get_setting_by_key_404(self):
        resp = self.client.get("/settings/nonexistent_key")
        self.assertEqual(resp.status_code, 404)

    def test_get_setting_by_key_cache_hit(self):
        # Prime cache
        self.client.get("/settings/theme")
        # Second hit should be cached
        resp = self.client.get("/settings/theme")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["value"], "dark")

    def test_save_api_key(self):
        with patch("app.routers.settings.set_api_key") as mock_set:
            resp = self.client.post("/settings/api-key", json={"api_key": "sk-test123"})
            self.assertEqual(resp.status_code, 200)
            mock_set.assert_called_once_with("sk-test123")

    def test_save_api_key_empty(self):
        resp = self.client.post("/settings/api-key", json={"api_key": "   "})
        self.assertEqual(resp.status_code, 400)

    def test_remove_api_key(self):
        with patch("app.routers.settings.delete_api_key") as mock_del:
            resp = self.client.delete("/settings/api-key")
            self.assertEqual(resp.status_code, 200)
            mock_del.assert_called_once()

    def test_save_kimi_api_key(self):
        with patch("app.routers.settings.set_kimi_api_key") as mock_set:
            resp = self.client.post("/settings/kimi-api-key", json={"api_key": "kimi-key"})
            self.assertEqual(resp.status_code, 200)
            mock_set.assert_called_once_with("kimi-key")

    def test_remove_kimi_api_key(self):
        with patch("app.routers.settings.delete_kimi_api_key") as mock_del:
            resp = self.client.delete("/settings/kimi-api-key")
            self.assertEqual(resp.status_code, 200)
            mock_del.assert_called_once()

    def test_save_openai_api_key(self):
        with patch("app.routers.settings.set_openai_api_key") as mock_set:
            resp = self.client.post("/settings/openai-api-key", json={"api_key": "openai-key"})
            self.assertEqual(resp.status_code, 200)
            mock_set.assert_called_once_with("openai-key")

    def test_remove_openai_api_key(self):
        with patch("app.routers.settings.delete_openai_api_key") as mock_del:
            resp = self.client.delete("/settings/openai-api-key")
            self.assertEqual(resp.status_code, 200)
            mock_del.assert_called_once()

    def test_save_deepseek_api_key(self):
        with patch("app.routers.settings.set_deepseek_api_key") as mock_set:
            resp = self.client.post("/settings/deepseek-api-key", json={"api_key": "deepseek-key"})
            self.assertEqual(resp.status_code, 200)
            mock_set.assert_called_once_with("deepseek-key")

    def test_remove_deepseek_api_key(self):
        with patch("app.routers.settings.delete_deepseek_api_key") as mock_del:
            resp = self.client.delete("/settings/deepseek-api-key")
            self.assertEqual(resp.status_code, 200)
            mock_del.assert_called_once()

    def test_save_bigmodel_api_key(self):
        with patch("app.routers.settings.set_bigmodel_api_key") as mock_set:
            resp = self.client.post("/settings/bigmodel-api-key", json={"api_key": "bigmodel-key"})
            self.assertEqual(resp.status_code, 200)
            mock_set.assert_called_once_with("bigmodel-key")

    def test_remove_bigmodel_api_key(self):
        with patch("app.routers.settings.delete_bigmodel_api_key") as mock_del:
            resp = self.client.delete("/settings/bigmodel-api-key")
            self.assertEqual(resp.status_code, 200)
            mock_del.assert_called_once()

    def test_save_mimo_api_key(self):
        with patch("app.routers.settings.set_mimo_api_key") as mock_set:
            resp = self.client.post("/settings/mimo-api-key", json={"api_key": "mimo-key"})
            self.assertEqual(resp.status_code, 200)
            mock_set.assert_called_once_with("mimo-key")

    def test_remove_mimo_api_key(self):
        with patch("app.routers.settings.delete_mimo_api_key") as mock_del:
            resp = self.client.delete("/settings/mimo-api-key")
            self.assertEqual(resp.status_code, 200)
            mock_del.assert_called_once()


if __name__ == "__main__":
    unittest.main()
