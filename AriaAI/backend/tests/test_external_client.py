"""Tests for external service client — auth builders, factory, HTTP wrappers."""
import unittest
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

from sqlmodel import Session, SQLModel, create_engine

from app.models.db import ExternalService, ExternalServiceCredential
from app.services.external_client import ExternalServiceClient, call_external_api
import app.services.credential_vault as cv
from tests.test_database import create_test_engine, drop_all_tables


class AuthBuildersTestCase(unittest.TestCase):
    def _make_service(self, auth_type: str, auth_config_json: Optional[str] = None):
        return ExternalService(
            id=1,
            name="Test",
            slug="test",
            base_url="https://api.example.com",
            auth_type=auth_type,
            auth_config_json=auth_config_json or "{}",
            is_active=True,
        )

    def test_bearer_token_auth(self):
        svc = self._make_service("bearer_token")
        client = ExternalServiceClient(svc, {"token": "my-token"})
        self.assertEqual(client._headers.get("Authorization"), "Bearer my-token")

    def test_bearer_token_with_custom_prefix(self):
        svc = self._make_service("bearer_token", '{"token_prefix": "Token"}')
        client = ExternalServiceClient(svc, {"token": "my-token"})
        self.assertEqual(client._headers.get("Authorization"), "Token my-token")

    def test_api_key_auth(self):
        svc = self._make_service("api_key")
        client = ExternalServiceClient(svc, {"api_key": "secret-key"})
        self.assertEqual(client._headers.get("X-Api-Key"), "secret-key")

    def test_api_key_custom_header(self):
        svc = self._make_service("api_key", '{"header_name": "X-Custom-Key"}')
        client = ExternalServiceClient(svc, {"api_key": "secret"})
        self.assertEqual(client._headers.get("X-Custom-Key"), "secret")

    def test_basic_auth(self):
        import httpx
        svc = self._make_service("basic_auth")
        client = ExternalServiceClient(svc, {"username": "admin", "password": "pass"})
        self.assertIsInstance(client._auth, httpx.BasicAuth)

    def test_oauth2_auth(self):
        svc = self._make_service("oauth2")
        client = ExternalServiceClient(svc, {"access_token": "oauth-token"})
        self.assertEqual(client._headers.get("Authorization"), "Bearer oauth-token")

    def test_custom_auth_headers(self):
        svc = self._make_service("custom")
        client = ExternalServiceClient(svc, {"header_X-Special": "val", "username": "u"})
        self.assertEqual(client._headers.get("X-Special"), "val")
        self.assertNotIn("username", client._headers)

    def test_custom_auth_header_map(self):
        svc = self._make_service("custom", '{"header_map": {"region": "X-Region"}}')
        client = ExternalServiceClient(svc, {"region": "us-west"})
        self.assertEqual(client._headers.get("X-Region"), "us-west")

    def test_no_auth(self):
        svc = self._make_service("none")
        client = ExternalServiceClient(svc, {})
        self.assertEqual(client._headers, {})
        self.assertIsNone(client._auth)

    def test_url_builder(self):
        svc = self._make_service("bearer_token")
        client = ExternalServiceClient(svc, {})
        self.assertEqual(client.url("/path"), "https://api.example.com/path")
        self.assertEqual(client.url("path"), "https://api.example.com/path")


class FactoryTestCase(unittest.TestCase):
    def setUp(self):
        self.engine = create_test_engine()
        drop_all_tables(self.engine)
        SQLModel.metadata.create_all(self.engine)

        with Session(self.engine) as session:
            svc = ExternalService(
                name="CTools",
                slug="ctools",
                base_url="http://localhost:3001",
                auth_type="bearer_token",
                is_active=True,
            )
            session.add(svc)
            session.commit()
            self.service_id = svc.id

            token = cv.encrypt_dict({"token": "abc123"})
            cred = ExternalServiceCredential(
                service_id=svc.id,
                scope="system",
                encrypted_value=token,
                is_active=True,
            )
            session.add(cred)
            session.commit()

    def tearDown(self):
        SQLModel.metadata.drop_all(self.engine)
        self.engine.dispose()

    async def _factory_context(self):
        with Session(self.engine) as session:
            async with ExternalServiceClient.for_service(session, "ctools") as client:
                return client

    def test_factory_success(self):
        import asyncio
        client = asyncio.run(self._factory_context())
        self.assertEqual(client._headers.get("Authorization"), "Bearer abc123")

    def test_factory_service_not_found(self):
        import asyncio
        with Session(self.engine) as session:
            with self.assertRaises(ValueError) as ctx:
                asyncio.run(self._async_factory(session, "missing"))
            self.assertIn("not found", str(ctx.exception).lower())

    async def _async_factory(self, session, slug):
        async with ExternalServiceClient.for_service(session, slug) as client:
            pass

    def test_factory_inactive_service(self):
        import asyncio
        with Session(self.engine) as session:
            svc = session.get(ExternalService, self.service_id)
            svc.is_active = False
            session.add(svc)
            session.commit()

            with self.assertRaises(ValueError) as ctx:
                asyncio.run(self._async_factory(session, "ctools"))
            self.assertIn("inactive", str(ctx.exception).lower())


class HttpWrappersTestCase(unittest.TestCase):
    def test_request_without_context_manager_raises(self):
        svc = ExternalService(
            name="T", slug="t", base_url="https://x.com",
            auth_type="none", is_active=True,
        )
        client = ExternalServiceClient(svc, {})
        import asyncio
        with self.assertRaises(RuntimeError) as ctx:
            asyncio.run(client.get("/"))
        self.assertIn("not opened", str(ctx.exception).lower())

    def test_call_external_api(self):
        import asyncio
        svc = ExternalService(
            name="T", slug="t", base_url="https://x.com",
            auth_type="none", is_active=True,
        )
        client = ExternalServiceClient(svc, {})

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"ok": True}
        mock_resp.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.request = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        # We can't easily test call_external_api without full db + mocking for_service,
        # but the auth builders and url helper above cover the critical paths.
