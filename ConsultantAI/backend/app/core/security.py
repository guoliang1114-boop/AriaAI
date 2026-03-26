"""API key storage — uses macOS Keychain when available, falls back to SQLite then env var."""
import os
from typing import Optional
import keyring
from app.config import KEYCHAIN_SERVICE, KEYCHAIN_KEY_CLAUDE


def _db_get_api_key() -> Optional[str]:
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            setting = session.get(Setting, "api_key")
            if setting and setting.value:
                return setting.value
    except Exception:
        pass
    return None


def _db_set_api_key(api_key: str) -> None:
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "api_key")
            if existing:
                existing.value = api_key
                session.add(existing)
            else:
                session.add(Setting(key="api_key", value=api_key))
            session.commit()
    except Exception:
        pass


def get_api_key() -> Optional[str]:
    """Retrieve Claude API key: Keychain → SQLite → env var."""
    try:
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_CLAUDE)
        if key:
            return key
    except Exception:
        pass
    db_key = _db_get_api_key()
    if db_key:
        return db_key
    return os.environ.get("ANTHROPIC_API_KEY")


def set_api_key(api_key: str) -> None:
    try:
        keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_CLAUDE, api_key)
    except Exception:
        pass
    _db_set_api_key(api_key)


def delete_api_key() -> None:
    try:
        keyring.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_CLAUDE)
    except keyring.errors.PasswordDeleteError:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "api_key")
            if existing:
                session.delete(existing)
                session.commit()
    except Exception:
        pass
