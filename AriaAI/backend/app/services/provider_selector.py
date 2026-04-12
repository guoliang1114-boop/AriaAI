"""Provider selector — unified LLM provider and model selection."""
from __future__ import annotations

from typing import Optional
from sqlmodel import Session

from app.config import MODEL_ALIASES, DEFAULT_MODELS
from app.models.db import Setting as _Setting

# Provider module registry
_provider_modules = {}


def _load_provider_module(provider: str):
    """Lazy load provider modules to avoid circular imports."""
    global _provider_modules
    if provider not in _provider_modules:
        if provider == "claude":
            from app.services import claude
            _provider_modules[provider] = claude
        elif provider in ("kimi", "bigmodel"):
            from app.services import openai_compat
            _provider_modules[provider] = openai_compat
        else:
            raise ValueError(f"Unknown provider: {provider}")
    return _provider_modules[provider]


def get_provider_module(session: Session):
    """
    Return the active LLM service module based on the llm_provider setting.
    
    Returns:
        Module with stream_response(), complete(), build_system_prompt() functions
    """
    setting = session.get(_Setting, "llm_provider")
    provider = (setting.value if setting and setting.value else "claude").lower().strip()
    
    # Normalize provider names
    if provider == "anthropic":
        provider = "claude"
    elif provider == "moonshot":
        provider = "kimi"
    
    return _load_provider_module(provider)


def get_provider_name(session: Session) -> str:
    """Get the current provider name (claude | kimi | bigmodel)."""
    setting = session.get(_Setting, "llm_provider")
    provider = (setting.value if setting and setting.value else "claude").lower().strip()
    
    # Normalize
    if provider == "anthropic":
        return "claude"
    if provider == "moonshot":
        return "kimi"
    if provider in ("claude", "kimi", "bigmodel"):
        return provider
    
    return "claude"  # Default fallback


def get_selected_model(session: Session, provider: Optional[str] = None) -> str:
    """
    Get the selected model for the given or current provider.
    
    Args:
        session: Database session
        provider: Provider name (claude | kimi | bigmodel). If None, uses current.
    
    Returns:
        Model ID string
    """
    if provider is None:
        provider = get_provider_name(session)
    
    setting = session.get(_Setting, "selected_model")
    if setting and setting.value:
        model = setting.value.strip()
        return MODEL_ALIASES.get(model, model)
    
    # Return default model based on provider
    return DEFAULT_MODELS.get(provider, DEFAULT_MODELS["claude"])


def resolve_provider_from_model(model: str) -> str:
    """
    Determine provider from model ID.
    
    Args:
        model: Model ID (e.g., 'claude-sonnet-4-6', 'moonshot-v1-32k', 'glm-5.1')
    
    Returns:
        Provider name: 'claude' | 'kimi' | 'bigmodel'
    """
    model_lower = model.lower()
    
    if model_lower.startswith(("moonshot-", "kimi-")):
        return "kimi"
    elif model_lower.startswith("claude-"):
        return "claude"
    elif model_lower.startswith(("glm-", "GLM-")):
        return "bigmodel"
    else:
        # Default fallback
        return "claude"


def get_model_for_provider(provider: str, session: Session) -> str:
    """
    Get the best available model for a provider.
    Checks settings first, then falls back to default.
    """
    current_model = get_selected_model(session)
    current_provider = resolve_provider_from_model(current_model)
    
    # If current model matches requested provider, use it
    if current_provider == provider:
        return current_model
    
    # Otherwise return default for requested provider
    return DEFAULT_MODELS.get(provider, DEFAULT_MODELS["claude"])
