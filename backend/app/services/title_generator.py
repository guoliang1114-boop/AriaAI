"""Title generator — background conversation title generation."""
from __future__ import annotations

import asyncio
from typing import Callable, Awaitable, Optional
from sqlmodel import Session

from app.models.db import Conversation
from app.services.cache import conversations_cache


TitleCompleteFn = Callable[[list[dict], int], Awaitable[str]]


def _language_instruction(language: str | None, user_content: str) -> tuple[str, int]:
    normalized = (language or "").strip().lower()
    if normalized.startswith("en"):
        return (
            "Write the title in English only. Target 3-6 words. "
            "Do not use Chinese unless it is a proper noun from the user's message.",
            40,
        )
    if normalized.startswith("zh"):
        return (
            "使用简体中文生成标题。目标 5-10 个中文字符。"
            "除非用户原文包含专有名词，否则不要使用英文单词。",
            20,
        )
    # Fallback for older clients that did not send a UI language.
    if any("\u4e00" <= char <= "\u9fff" for char in user_content):
        return (
            "使用简体中文生成标题。目标 5-10 个中文字符。"
            "除非用户原文包含专有名词，否则不要使用英文单词。",
            20,
        )
    return (
        "Write the title in English only. Target 3-6 words. "
        "Do not use Chinese unless it is a proper noun from the user's message.",
        40,
    )


async def generate_conversation_title(
    conv_id: int,
    user_content: str,
    session_factory,
    complete_fn: TitleCompleteFn,
    max_tokens: int = 20,
    language: str | None = None,
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
        language_rule, char_limit = _language_instruction(language, user_content)
        raw = await complete_fn(
            messages=[{"role": "user", "content": (
                f"Write a very short title for this conversation. "
                f"{language_rule} "
                f"No quotes, no punctuation, no trailing ellipsis. "
                f"Capture the user's actual ask, not the meta of asking.\n"
                f"User said: {user_content[:200]}\n"
                f"Return ONLY the title."
            )}],
            max_tokens=max_tokens,
        )
        # Hard cap to keep the rail clean even if the
        # model ignores the upper-bound instruction.
        title = raw.strip().strip('"').strip("'")[:char_limit] or user_content[:40]
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
    language: str | None = None,
) -> None:
    """
    Schedule title generation as a background task.
    
    Usage:
        schedule_title_generation(conv_id, user_content, session.get_bind(), llm.complete)
    """
    from sqlmodel import Session as _Session
    
    async def _task():
        # Delay before calling the LLM so we don't race with the next user message.
        # The main stream just completed; the user may immediately start a new one.
        # Waiting 5 s gives Moonshot's burst window time to reset before we fire
        # the title-generation complete() call.
        await asyncio.sleep(5)
        await generate_conversation_title(
            conv_id=conv_id,
            user_content=user_content,
            session_factory=lambda: _Session(bind),
            complete_fn=complete_fn,
            language=language,
        )

    # Schedule without awaiting
    asyncio.ensure_future(_task())
