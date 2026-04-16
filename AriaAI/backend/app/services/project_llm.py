from __future__ import annotations

from collections.abc import AsyncIterator

from app.database import engine
from app.services.provider_selector import (
    _load_provider_module,
    get_selected_model,
    resolve_provider_from_model,
)
from sqlmodel import Session


async def complete_with_selected_model(messages: list[dict], *, max_tokens: int = 4000) -> str:
    with Session(engine) as session:
        model = get_selected_model(session)
        provider = resolve_provider_from_model(model)
    llm = _load_provider_module(provider)
    return await llm.complete(messages, model=model, max_tokens=max_tokens)


async def stream_with_selected_model(
    messages: list[dict],
    *,
    max_tokens: int = 4000,
) -> AsyncIterator[str]:
    with Session(engine) as session:
        model = get_selected_model(session)
        provider = resolve_provider_from_model(model)
    llm = _load_provider_module(provider)
    async for chunk in llm.stream_response(messages, model=model, max_tokens=max_tokens):
        yield chunk
