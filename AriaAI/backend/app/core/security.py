"""API key storage — uses macOS Keychain when available, falls back to database then env var."""
import os
from typing import Optional
import keyring
from app.config import (
    KEYCHAIN_SERVICE,
    KEYCHAIN_KEY_CLAUDE,
    KEYCHAIN_KEY_KIMI,
    KEYCHAIN_KEY_OPENAI,
    KEYCHAIN_KEY_DEEPSEEK,
    KEYCHAIN_KEY_BIGMODEL,
    KEYCHAIN_KEY_MIMO,
)


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
    """Retrieve Claude API key: Keychain → Database → env var."""
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


# ---------------------------------------------------------------------------
# Kimi API key
# ---------------------------------------------------------------------------

def get_kimi_api_key() -> Optional[str]:
    """Retrieve Kimi API key: Keychain → Database → env var."""
    try:
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_KIMI)
        if key:
            return key
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            setting = session.get(Setting, "kimi_api_key")
            if setting and setting.value:
                return setting.value
    except Exception:
        pass
    return os.environ.get("MOONSHOT_API_KEY")


def set_kimi_api_key(api_key: str) -> None:
    try:
        keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_KIMI, api_key)
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "kimi_api_key")
            if existing:
                existing.value = api_key
                session.add(existing)
            else:
                session.add(Setting(key="kimi_api_key", value=api_key))
            session.commit()
    except Exception:
        pass


def delete_kimi_api_key() -> None:
    try:
        keyring.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_KIMI)
    except keyring.errors.PasswordDeleteError:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "kimi_api_key")
            if existing:
                session.delete(existing)
                session.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# OpenAI API key
# ---------------------------------------------------------------------------

def get_openai_api_key() -> Optional[str]:
    """Retrieve OpenAI API key: Keychain → Database → env var."""
    try:
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_OPENAI)
        if key:
            return key
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            setting = session.get(Setting, "openai_api_key")
            if setting and setting.value:
                return setting.value
    except Exception:
        pass
    return os.environ.get("OPENAI_API_KEY")


def set_openai_api_key(api_key: str) -> None:
    try:
        keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_OPENAI, api_key)
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "openai_api_key")
            if existing:
                existing.value = api_key
                session.add(existing)
            else:
                session.add(Setting(key="openai_api_key", value=api_key))
            session.commit()
    except Exception:
        pass


def delete_openai_api_key() -> None:
    try:
        keyring.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_OPENAI)
    except keyring.errors.PasswordDeleteError:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "openai_api_key")
            if existing:
                session.delete(existing)
                session.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# DeepSeek API key
# ---------------------------------------------------------------------------

def get_deepseek_api_key() -> Optional[str]:
    """Retrieve DeepSeek API key: Keychain → Database → env var."""
    try:
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_DEEPSEEK)
        if key:
            return key
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            setting = session.get(Setting, "deepseek_api_key")
            if setting and setting.value:
                return setting.value
    except Exception:
        pass
    return os.environ.get("DEEPSEEK_API_KEY")


def set_deepseek_api_key(api_key: str) -> None:
    try:
        keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_DEEPSEEK, api_key)
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "deepseek_api_key")
            if existing:
                existing.value = api_key
                session.add(existing)
            else:
                session.add(Setting(key="deepseek_api_key", value=api_key))
            session.commit()
    except Exception:
        pass


def delete_deepseek_api_key() -> None:
    try:
        keyring.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_DEEPSEEK)
    except keyring.errors.PasswordDeleteError:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "deepseek_api_key")
            if existing:
                session.delete(existing)
                session.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# BigModel (Zhipu AI) API key
# ---------------------------------------------------------------------------

def get_bigmodel_api_key() -> Optional[str]:
    """Retrieve BigModel API key: Keychain → Database → env var."""
    try:
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_BIGMODEL)
        if key:
            return key
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            setting = session.get(Setting, "bigmodel_api_key")
            if setting and setting.value:
                return setting.value
    except Exception:
        pass
    return os.environ.get("BIGMODEL_API_KEY")


def set_bigmodel_api_key(api_key: str) -> None:
    try:
        keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_BIGMODEL, api_key)
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "bigmodel_api_key")
            if existing:
                existing.value = api_key
                session.add(existing)
            else:
                session.add(Setting(key="bigmodel_api_key", value=api_key))
            session.commit()
    except Exception:
        pass


def delete_bigmodel_api_key() -> None:
    try:
        keyring.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_BIGMODEL)
    except keyring.errors.PasswordDeleteError:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "bigmodel_api_key")
            if existing:
                session.delete(existing)
                session.commit()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Xiaomi MiMo API key
# ---------------------------------------------------------------------------

def get_mimo_api_key() -> Optional[str]:
    """Retrieve Xiaomi MiMo API key: Keychain -> Database -> env var."""
    try:
        key = keyring.get_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_MIMO)
        if key:
            return key
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            setting = session.get(Setting, "mimo_api_key")
            if setting and setting.value:
                return setting.value
    except Exception:
        pass
    return os.environ.get("MIMO_API_KEY") or os.environ.get("XIAOMI_API_KEY")


def set_mimo_api_key(api_key: str) -> None:
    try:
        keyring.set_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_MIMO, api_key)
    except Exception:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "mimo_api_key")
            if existing:
                existing.value = api_key
                session.add(existing)
            else:
                session.add(Setting(key="mimo_api_key", value=api_key))
            session.commit()
    except Exception:
        pass


def delete_mimo_api_key() -> None:
    try:
        keyring.delete_password(KEYCHAIN_SERVICE, KEYCHAIN_KEY_MIMO)
    except keyring.errors.PasswordDeleteError:
        pass
    try:
        from sqlmodel import Session
        from app.database import engine
        from app.models.db import Setting
        with Session(engine) as session:
            existing = session.get(Setting, "mimo_api_key")
            if existing:
                session.delete(existing)
                session.commit()
    except Exception:
        pass
