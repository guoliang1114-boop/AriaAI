"""Title generator — background conversation title generation."""
from __future__ import annotations

import asyncio
from typing import Callable, Awaitable
from sqlmodel import Session

from app.models.db import Conversation
from app.services.cache import conversations_cache


TitleCompleteFn = Callable[[list[dict], int], Awaitable[str]]


async def generate_conversation_title(
    conv_id: int,
    user_content: str,
    session_factory,
    complete_fn: TitleCompleteFn,
    max_tokens: int = 20,
) -> Optional[str]:
    """
    Generate a conversation title in the background.
    
    This is designed to be called after the SSE stream has completed,
    so it doesn't block the user response.
    
    Args:
        conv_id: Conversation ID
        user_content: User's first message (used as title fallback and context)
        session_factory: Callable that returns a new Session (to avoid async boundary issues)
        complete_fn: Async function to call LLM (takes messages and max_tokens)
        max_tokens: Max tokens for title generation
    
    Returns:
        Generated title or None if generation failed
    """
    try:
        raw = await complete_fn(
            messages=[{"role": "user", "content": (
                f"Write a short title for this conversation (max 12 Chinese characters "
                f"or 6 English words, no quotes, no punctuation at end).\n"
                f"User said: {user_content[:200]}\n"
                f"Return ONLY the title."
            )}],
            max_tokens=max_tokens,
        )
        title = raw.strip().strip('"').strip("'")[:60] or user_content[:40]
    except Exception:
        return None
    
    # Persist to database
    try:
        with session_factory() as session:
            conv = session.get(Conversation, conv_id)
            if conv:
                conv.title = title
                session.add(conv)
                session.commit()
                # Invalidate conversation list cache
                conversations_cache.delete_prefix("list:")
        return title
    except Exception:
        return None


def schedule_title_generation(
    conv_id: int,
    user_content: str,
    bind,
    complete_fn: TitleCompleteFn,
) -> None:
    """
    Schedule title generation as a background task.
    
    Usage:
        schedule_title_generation(conv_id, user_content, session.get_bind(), llm.complete)
    """
    from sqlmodel import Session as _Session
    
    async def _task():
        await generate_conversation_title(
            conv_id=conv_id,
            user_content=user_content,
            session_factory=lambda: _Session(bind),
            complete_fn=complete_fn,
        )
    
    # Schedule without awaiting
    asyncio.ensure_future(_task())
