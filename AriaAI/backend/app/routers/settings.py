"""Settings router — API key, model config, app preferences."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from app.core.security import (
    get_api_key, set_api_key, delete_api_key,
    get_kimi_api_key, set_kimi_api_key, delete_kimi_api_key,
    get_openai_api_key, set_openai_api_key, delete_openai_api_key,
    get_deepseek_api_key, set_deepseek_api_key, delete_deepseek_api_key,
    get_bigmodel_api_key, set_bigmodel_api_key, delete_bigmodel_api_key,
)
from app.database import get_session
from app.models.db import Setting
from app.services.cache import TTLCache
from app.config import SETTINGS_CACHE_TTL

_settings_cache = TTLCache()
_SETTINGS_TTL = SETTINGS_CACHE_TTL  # Use unified config

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


# ---------------------------------------------------------------------------
# OpenAI API key endpoints
# ---------------------------------------------------------------------------

@router.get("/openai-api-key-status")
def openai_api_key_status():
    key = get_openai_api_key()
    if key:
        masked = key[:8] + "••••••••" + key[-4:]
        return {"configured": True, "masked": masked}
    return {"configured": False}


@router.post("/openai-api-key")
def save_openai_api_key(req: ApiKeyRequest):
    if not req.api_key.strip():
        raise HTTPException(400, "API key cannot be empty")
    set_openai_api_key(req.api_key.strip())
    return {"ok": True}


@router.delete("/openai-api-key")
def remove_openai_api_key():
    delete_openai_api_key()
    return {"ok": True}


# ---------------------------------------------------------------------------
# DeepSeek API key endpoints
# ---------------------------------------------------------------------------

@router.get("/deepseek-api-key-status")
def deepseek_api_key_status():
    key = get_deepseek_api_key()
    if key:
        masked = key[:8] + "••••••••" + key[-4:]
        return {"configured": True, "masked": masked}
    return {"configured": False}


@router.post("/deepseek-api-key")
def save_deepseek_api_key(req: ApiKeyRequest):
    if not req.api_key.strip():
        raise HTTPException(400, "API key cannot be empty")
    set_deepseek_api_key(req.api_key.strip())
    return {"ok": True}


@router.delete("/deepseek-api-key")
def remove_deepseek_api_key():
    delete_deepseek_api_key()
    return {"ok": True}


# ---------------------------------------------------------------------------
# BigModel API key endpoints
# ---------------------------------------------------------------------------

@router.get("/bigmodel-api-key-status")
def bigmodel_api_key_status():
    key = get_bigmodel_api_key()
    if key:
        masked = key[:8] + "••••••••" + key[-4:]
        return {"configured": True, "masked": masked}
    return {"configured": False}


@router.post("/bigmodel-api-key")
def save_bigmodel_api_key(req: ApiKeyRequest):
    if not req.api_key.strip():
        raise HTTPException(400, "API key cannot be empty")
    set_bigmodel_api_key(req.api_key.strip())
    return {"ok": True}


@router.delete("/bigmodel-api-key")
def remove_bigmodel_api_key():
    delete_bigmodel_api_key()
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


# Setting metadata for frontend (read-only, shows setting hierarchy)
_SETTING_METADATA = {
    # LLM Settings (Layer 3: Runtime user settings)
    "selected_model": {"layer": 3, "category": "llm", "editable": True, "type": "string"},
    "llm_provider": {"layer": 3, "category": "llm", "editable": True, "type": "string"},
    "temperature": {"layer": 3, "category": "llm", "editable": True, "type": "float", "min": 0, "max": 2},
    "max_tokens": {"layer": 3, "category": "llm", "editable": True, "type": "int", "min": 256, "max": 32768},
    "top_p": {"layer": 3, "category": "llm", "editable": True, "type": "float", "min": 0, "max": 1},
    "presence_penalty": {"layer": 3, "category": "llm", "editable": True, "type": "float", "min": -2, "max": 2},
    "frequency_penalty": {"layer": 3, "category": "llm", "editable": True, "type": "float", "min": -2, "max": 2},
    # App Settings (Layer 3)
    "theme": {"layer": 3, "category": "ui", "editable": True, "type": "string"},
    "language": {"layer": 3, "category": "ui", "editable": True, "type": "string"},
    "timezone": {"layer": 3, "category": "ui", "editable": True, "type": "string"},
}


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


@router.get("/metadata")
def get_settings_metadata():
    """Get setting metadata (layer, category, editable)."""
    return _SETTING_METADATA


@router.get("/hierarchy")
def get_settings_hierarchy():
    """
    Explain the three-layer configuration hierarchy.
    
    Layer 1: Environment variables (deployment config)
    Layer 2: Code defaults (app/config.py)
    Layer 3: Runtime user settings (database)
    """
    return {
        "layers": {
            "1": {"name": "Deployment", "source": "Environment variables / .env", "restart_required": True},
            "2": {"name": "Defaults", "source": "app/config.py", "restart_required": False},
            "3": {"name": "Runtime", "source": "Database (Setting table)", "restart_required": False},
        },
        "resolution_order": "3 → 1 → 2 (first available wins)",
        "current_settings": _SETTING_METADATA,
    }


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
