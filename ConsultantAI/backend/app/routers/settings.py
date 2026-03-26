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
    settings = session.exec(
        __import__("sqlmodel").select(Setting)
    ).all()
    return {s.key: s.value for s in settings}


@router.put("/{key}")
def upsert_setting(key: str, data: SettingUpdate, session: Session = Depends(get_session)):
    existing = session.get(Setting, key)
    if existing:
        existing.value = data.value
        session.add(existing)
    else:
        session.add(Setting(key=key, value=data.value))
    session.commit()
    return {"key": key, "value": data.value}


@router.get("/{key}")
def get_setting(key: str, session: Session = Depends(get_session)):
    setting = session.get(Setting, key)
    if not setting:
        raise HTTPException(404, f"Setting '{key}' not found")
    return {"key": setting.key, "value": setting.value}


# ---------------------------------------------------------------------------
# Kimi API key endpoints
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
