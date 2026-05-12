"""Tests for settings router — API key status, settings CRUD."""
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine, select
from sqlmodel.pool import StaticPool

from app.models.db import User, Setting
from app.routers import settings as settings_module
from app.routers.settings import router
from app.services.cache import TTLCache


class SettingsRouterTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
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

    def test_list_settings_empty_db(self):
        SQLModel.metadata.drop_all(self.engine)
        SQLModel.metadata.create_all(self.engine)
        settings_module._settings_cache.clear()
        resp = self.client.get("/settings/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), {})

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

    def test_api_key_status_no_key(self):
        resp = self.client.get("/settings/api-key-status")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("configured", data)
        self.assertFalse(data["configured"])

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


if __name__ == "__main__":
    unittest.main()
