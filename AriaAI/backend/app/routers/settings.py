"""Settings router — API key, model config, app preferences."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.core.security import (
    get_api_key, set_api_key, delete_api_key,
    get_kimi_api_key, set_kimi_api_key, delete_kimi_api_key,
)
from app.database import get_session
from app.models.db import Setting
from app.services.cache import TTLCache

_settings_cache = TTLCache()
_SETTINGS_TTL = 300.0  # 5 min — settings change only when the user explicitly edits them

_ALL_KEY = "__all__"


def _bust_settings(key: str | None = None) -> None:
    _settings_cache.delete(_ALL_KEY)
    if key:
        _settings_cache.delete(key)
    # Also bust claude.py's internal settings cache so model/url changes take effect immediately
    try:
        from app.services import claude as _claude
        _claude._settings_cache.clear()
    except Exception:
        pass

router = APIRouter(prefix="/settings", tags=["settings"])


class ApiKeyRequest(BaseModel):
    api_key: str


class SettingUpdate(BaseModel):
    value: str


@router.get("/api-key-status")
def api_key_status():
    key = get_api_key()
    if key:
        masked = key[:8] + "••••••••" + key[-4:]
        return {"configured": True, "masked": masked}
    return {"configured": False}


# ---------------------------------------------------------------------------
# Kimi API key endpoints  ← 必须在 /{key} 通配符之前
# ---------------------------------------------------------------------------

@router.get("/kimi-api-key-status")
def kimi_api_key_status():
    key = get_kimi_api_key()
    if key:
        masked = key[:8] + "••••••••" + key[-4:]
        return {"configured": True, "masked": masked}
    return {"configured": False}


@router.post("/kimi-api-key")
def save_kimi_api_key(req: ApiKeyRequest):
    if not req.api_key.strip():
        raise HTTPException(400, "API key cannot be empty")
    set_kimi_api_key(req.api_key.strip())
    return {"ok": True}


@router.delete("/kimi-api-key")
def remove_kimi_api_key():
    delete_kimi_api_key()
    return {"ok": True}


@router.post("/api-key")
def save_api_key(req: ApiKeyRequest):
    if not req.api_key.strip():
        raise HTTPException(400, "API key cannot be empty")
    set_api_key(req.api_key.strip())
    return {"ok": True}


@router.delete("/api-key")
def remove_api_key():
    delete_api_key()
    return {"ok": True}


@router.get("/")
def get_all_settings(session: Session = Depends(get_session)):
    cached = _settings_cache.get(_ALL_KEY)
    if cached is not None:
        return cached
    settings = session.exec(
        __import__("sqlmodel").select(Setting)
    ).all()
    result = {s.key: s.value for s in settings}
    _settings_cache.set(_ALL_KEY, result, _SETTINGS_TTL)
    return result


@router.put("/{key}")
def upsert_setting(key: str, data: SettingUpdate, session: Session = Depends(get_session)):
    existing = session.get(Setting, key)
    if existing:
        existing.value = data.value
        session.add(existing)
    else:
        session.add(Setting(key=key, value=data.value))
    session.commit()
    _bust_settings(key)
    return {"key": key, "value": data.value}


@router.get("/{key}")
def get_setting(key: str, session: Session = Depends(get_session)):
    cached = _settings_cache.get(key)
    if cached is not None:
        return cached
    setting = session.get(Setting, key)
    if not setting:
        raise HTTPException(404, f"Setting '{key}' not found")
    result = {"key": setting.key, "value": setting.value}
    _settings_cache.set(key, result, _SETTINGS_TTL)
    return result
