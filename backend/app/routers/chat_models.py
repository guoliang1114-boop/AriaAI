"""Chat models router — list available LLM models for user selection."""
from __future__ import annotations

import os
from typing import List

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session

from app.config import DEFAULT_MODELS, KEYCHAIN_KEY_BIGMODEL, KEYCHAIN_KEY_CLAUDE, KEYCHAIN_KEY_DEEPSEEK, KEYCHAIN_KEY_KIMI, KEYCHAIN_KEY_MIMO
from app.database import get_session
from app.models.db import Setting as _Setting, User
from app.routers.auth import get_current_user

router = APIRouter()


class ChatModelOut(BaseModel):
    id: str
    name: str
    provider: str
    available: bool


# Friendly display names for known models
_MODEL_DISPLAY_NAMES = {
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-opus-4-6": "Claude Opus 4.6",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    "kimi-k2.6": "Kimi K2.6",
    "moonshot-v1-8k": "Moonshot 8K",
    "deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek-v4-flash": "DeepSeek V4 Flash",
    "glm-5.1": "GLM 5.1",
    "mimo-v2.5-flash": "Mimo V2.5 Flash",
    "mimo-v2.5-pro": "Mimo V2.5 Pro",
    "mimo-v2.5-omni": "Mimo V2.5 Omni",
}

_PROVIDER_KEY_MAP = {
    "claude": KEYCHAIN_KEY_CLAUDE,
    "kimi": KEYCHAIN_KEY_KIMI,
    "deepseek": KEYCHAIN_KEY_DEEPSEEK,
    "bigmodel": KEYCHAIN_KEY_BIGMODEL,
    "mimo": KEYCHAIN_KEY_MIMO,
}


def _has_provider_key(session: Session, provider: str) -> bool:
    """Check if API key for a provider is configured."""
    env_map = {
        "claude": ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
        "kimi": ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
        "deepseek": ["DEEPSEEK_API_KEY"],
        "bigmodel": ["BIGMODEL_API_KEY", "ZHIPU_API_KEY"],
        "mimo": ["MIMO_API_KEY", "XIAOMI_API_KEY"],
    }
    # Check database setting first
    setting = session.get(_Setting, f"{provider}_api_key")
    if setting and setting.value.strip():
        return True
    # Check environment variables
    for env_var in env_map.get(provider, []):
        if os.environ.get(env_var, "").strip():
            return True
    return False


@router.get("/models", response_model=List[ChatModelOut])
def list_chat_models(
    session: Session = Depends(get_session),
    _current_user: User = Depends(get_current_user),
):
    """Return available LLM models for chat, with availability status."""
    results: list[ChatModelOut] = []
    for provider, default_model in DEFAULT_MODELS.items():
        available = _has_provider_key(session, provider)
        display_name = _MODEL_DISPLAY_NAMES.get(default_model, default_model)
        results.append(
            ChatModelOut(
                id=default_model,
                name=display_name,
                provider=provider,
                available=available,
            )
        )
    return results
