"""Credential Vault — encrypted storage for external service credentials.

Uses Fernet (symmetric encryption) from the cryptography library.
Master key is derived from VAULT_MASTER_KEY env var (must be 32-byte base64).
If not provided, falls back to JWT_SECRET (with warning) for local dev only.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

# ── Master key derivation ────────────────────────────────────────────────────


def _derive_fernet_key(source: str) -> bytes:
    """Derive a 32-byte URL-safe base64 Fernet key from any string."""
    digest = hashlib.sha256(source.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _get_master_key() -> bytes:
    """Get the Fernet master key from env or fallback."""
    raw = os.getenv("VAULT_MASTER_KEY", "")
    if raw:
        # User provided key — must be 32 bytes base64-ish; normalize via SHA256
        return _derive_fernet_key(raw)

    # Fallback: derive from JWT_SECRET (INSECURE for production — warns loudly)
    jwt_secret = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
    if os.getenv("ALLOW_INSECURE_JWT_SECRET", "false").lower() != "true":
        logger.warning(
            "VAULT_MASTER_KEY not set. Using JWT_SECRET fallback. "
            "Set VAULT_MASTER_KEY in production to isolate credential encryption."
        )
    return _derive_fernet_key(jwt_secret)


_MASTER_KEY = _get_master_key()
_fernet = Fernet(_MASTER_KEY)


# ── Public API ───────────────────────────────────────────────────────────────


def encrypt(plaintext: str) -> str:
    """Encrypt a plaintext string. Returns URL-safe base64 token."""
    return _fernet.encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Decrypt a token. Raises ValueError on invalid / tampered token."""
    try:
        return _fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Invalid or corrupted credential token") from exc


def encrypt_dict(data: dict[str, Any]) -> str:
    """Encrypt a dict as JSON."""
    return encrypt(json.dumps(data, ensure_ascii=False))


def decrypt_dict(token: str) -> dict[str, Any]:
    """Decrypt a token back to dict."""
    return json.loads(decrypt(token))


# ── Database-backed credential helpers ───────────────────────────────────────

from sqlmodel import Session, select
from app.models.db import ExternalServiceCredential


def get_system_credential(session: Session, service_id: int) -> Optional[ExternalServiceCredential]:
    """Get the active system-level credential for a service."""
    stmt = (
        select(ExternalServiceCredential)
        .where(
            ExternalServiceCredential.service_id == service_id,
            ExternalServiceCredential.scope == "system",
            ExternalServiceCredential.is_active == True,
        )
        .order_by(ExternalServiceCredential.created_at.desc())
    )
    return session.exec(stmt).first()


def get_user_credential(
    session: Session, service_id: int, user_id: int
) -> Optional[ExternalServiceCredential]:
    """Get the active user-level credential for a service."""
    stmt = (
        select(ExternalServiceCredential)
        .where(
            ExternalServiceCredential.service_id == service_id,
            ExternalServiceCredential.scope == "user",
            ExternalServiceCredential.user_id == user_id,
            ExternalServiceCredential.is_active == True,
        )
        .order_by(ExternalServiceCredential.created_at.desc())
    )
    return session.exec(stmt).first()


def resolve_credential(
    session: Session, service_id: int, user_id: Optional[int] = None
) -> Optional[ExternalServiceCredential]:
    """Resolve best available credential: user-level preferred, then system-level."""
    if user_id is not None:
        cred = get_user_credential(session, service_id, user_id)
        if cred:
            return cred
    return get_system_credential(session, service_id)


def decrypt_credential_value(cred: ExternalServiceCredential) -> dict[str, Any]:
    """Decrypt a credential's encrypted_value into a dict."""
    return decrypt_dict(cred.encrypted_value)


# ── Convenience: raw value accessors ─────────────────────────────────────────


def get_bearer_token(session: Session, service_id: int, user_id: Optional[int] = None) -> Optional[str]:
    """Quick helper: get bearer token for a service (user-level first)."""
    cred = resolve_credential(session, service_id, user_id)
    if not cred:
        return None
    try:
        payload = decrypt_credential_value(cred)
        return payload.get("token") or payload.get("api_key") or payload.get("password")
    except Exception:
        logger.exception("Failed to decrypt credential for service_id=%s", service_id)
        return None
