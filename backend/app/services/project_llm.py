from __future__ import annotations

from collections.abc import AsyncIterator

from app.database import engine
from app.services.provider_selector import (
    _load_provider_module,
    get_selected_model,
    resolve_provider_from_model,
)
from sqlmodel import Session


def _cap_max_tokens_for_model(model: str, max_tokens: int) -> int:
    normalized = (model or "").lower()
    if normalized.startswith(("kimi-k2.6", "kimi-k2.5")):
        return min(max_tokens, 32768)
    if normalized.startswith(("xiaomi/mimo-v2.5-pro", "xiaomi/mimo-v2.5-omni", "mimo-v2.5-pro", "mimo-v2.5-omni")):
        return min(max_tokens, 32000)
    if normalized.startswith(("xiaomi/mimo-v2.5-flash", "mimo-v2.5-flash")):
        return min(max_tokens, 8192)
    if normalized.startswith("claude-"):
        return min(max_tokens, 8192)
    return min(max_tokens, 8192)


async def complete_with_selected_model(messages: list[dict], *, max_tokens: int = 4000) -> str:
    with Session(engine) as session:
        model = get_selected_model(session)
        provider = resolve_provider_from_model(model)
    llm = _load_provider_module(provider)
    return await llm.complete(messages, model=model, max_tokens=_cap_max_tokens_for_model(model, max_tokens))


async def stream_with_selected_model(
    messages: list[dict],
    *,
    max_tokens: int = 4000,
) -> AsyncIterator[str]:
    with Session(engine) as session:
        model = get_selected_model(session)
        provider = resolve_provider_from_model(model)
    llm = _load_provider_module(provider)
    async for chunk in llm.stream_response(messages, model=model, max_tokens=_cap_max_tokens_for_model(model, max_tokens)):
        yield chunk
