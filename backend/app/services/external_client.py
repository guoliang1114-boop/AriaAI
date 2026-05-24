"""External Service Client — unified HTTP client with automatic credential injection.

Usage:
    from app.services.external_client import ExternalServiceClient

    async with ExternalServiceClient.for_service(session, "ctools", user_id=7) as client:
        resp = await client.post("/api/translations", json={...})
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator, Optional

import httpx
from sqlmodel import Session

from app.models.db import ExternalService
from app.services.credential_vault import resolve_credential, decrypt_credential_value

logger = logging.getLogger(__name__)

# Default HTTP timeout config
DEFAULT_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
DEFAULT_RETRIES = 2


class ExternalServiceClient:
    """HTTP client wrapper that auto-injects auth credentials from the vault.

    Supports auth types:
        - bearer_token  → Authorization: Bearer <token>
        - api_key       → X-Api-Key: <key>  (header name configurable)
        - basic_auth    → HTTP Basic auth
        - oauth2        → Authorization: Bearer <access_token>
        - custom        → Arbitrary headers from credential payload
    """

    def __init__(
        self,
        service: ExternalService,
        credential_payload: dict[str, Any] | None = None,
        timeout: httpx.Timeout | None = None,
    ):
        self.service = service
        self.credential = credential_payload or {}
        self.timeout = timeout or DEFAULT_TIMEOUT

        self._client: httpx.AsyncClient | None = None
        self._headers: dict[str, str] = {}
        self._auth: httpx.Auth | None = None
        self._base_url = service.base_url.rstrip("/")

        self._build_auth()

    # ── Factory methods ──────────────────────────────────────────────────────

    @classmethod
    @asynccontextmanager
    async def for_service(
        cls,
        session: Session,
        slug: str,
        user_id: Optional[int] = None,
        timeout: httpx.Timeout | None = None,
    ) -> AsyncGenerator[ExternalServiceClient, None]:
        """Create a client for an external service by slug (async context manager)."""
        from sqlmodel import select

        service = session.exec(select(ExternalService).where(ExternalService.slug == slug)).first()
        if not service:
            raise ValueError(f"External service '{slug}' not found")
        if not service.is_active:
            raise ValueError(f"External service '{slug}' is inactive")

        cred = resolve_credential(session, service.id, user_id)
        payload = None
        if cred:
            try:
                payload = decrypt_credential_value(cred)
            except Exception as exc:
                logger.error("Failed to decrypt credential for %s: %s", slug, exc)
                raise RuntimeError(f"Credential decryption failed for '{slug}'") from exc
        else:
            logger.warning("No credential found for service '%s' (user_id=%s)", slug, user_id)

        client = cls(service, payload, timeout=timeout)
        async with client:
            yield client

    # ── Auth builders ────────────────────────────────────────────────────────

    def _build_auth(self) -> None:
        auth_type = self.service.auth_type
        config = json.loads(self.service.auth_config_json or "{}")
        cred = self.credential

        if auth_type == "bearer_token":
            token = cred.get("token") or cred.get("api_key")
            if token:
                prefix = config.get("token_prefix", "Bearer")
                self._headers["Authorization"] = f"{prefix} {token}"

        elif auth_type == "api_key":
            key = cred.get("api_key") or cred.get("token")
            if key:
                header_name = config.get("header_name", "X-Api-Key")
                self._headers[header_name] = key

        elif auth_type == "basic_auth":
            username = cred.get("username")
            password = cred.get("password")
            if username and password:
                self._auth = httpx.BasicAuth(username, password)

        elif auth_type == "oauth2":
            token = cred.get("access_token") or cred.get("token")
            if token:
                prefix = config.get("token_prefix", "Bearer")
                self._headers["Authorization"] = f"{prefix} {token}"

        elif auth_type == "custom":
            # Inject arbitrary headers from credential payload
            for header_name, header_value in cred.items():
                if header_name.startswith("header_"):
                    real_name = header_name[len("header_"):]
                    self._headers[real_name] = str(header_value)
                elif header_name not in ("username", "password", "token", "api_key", "access_token"):
                    # Also allow top-level keys as headers if explicitly mapped in config
                    header_map = config.get("header_map", {})
                    if header_name in header_map:
                        self._headers[header_map[header_name]] = str(header_value)

        else:
            logger.debug("No auth builder for type '%s' on service '%s'", auth_type, self.service.slug)

    # ── Context manager ──────────────────────────────────────────────────────

    async def __aenter__(self) -> ExternalServiceClient:
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            auth=self._auth,
            timeout=self.timeout,
            follow_redirects=True,
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None

    # ── HTTP wrappers ────────────────────────────────────────────────────────

    async def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        if not self._client:
            raise RuntimeError("Client not opened. Use 'async with' context manager.")
        url = path if path.startswith("http") else path
        return await self._client.request(method, url, **kwargs)

    async def get(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("GET", path, **kwargs)

    async def post(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("POST", path, **kwargs)

    async def put(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("PUT", path, **kwargs)

    async def patch(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("PATCH", path, **kwargs)

    async def delete(self, path: str, **kwargs) -> httpx.Response:
        return await self.request("DELETE", path, **kwargs)

    # ── Convenience ──────────────────────────────────────────────────────────

    def url(self, path: str) -> str:
        """Build absolute URL from relative path."""
        path = path.lstrip("/")
        return f"{self._base_url}/{path}"


# ── Low-level helper for tools that already have a session ───────────────────


async def call_external_api(
    session: Session,
    service_slug: str,
    method: str,
    path: str,
    user_id: Optional[int] = None,
    **httpx_kwargs,
) -> dict[str, Any]:
    """One-shot helper: call an external API and return JSON dict.

    Raises RuntimeError on HTTP 4xx/5xx or connection issues.
    """
    async with ExternalServiceClient.for_service(session, service_slug, user_id=user_id) as client:
        resp = await client.request(method, path, **httpx_kwargs)
        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"{service_slug} API error: {resp.status_code} — {resp.text[:500]}"
            ) from exc
        return resp.json()
