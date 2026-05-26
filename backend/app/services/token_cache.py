from __future__ import annotations

import time
from typing import Optional


_TOKEN_CACHE: dict[str, tuple[int, float]] = {}


def get_cached_user_id(token: str) -> Optional[int]:
    entry = _TOKEN_CACHE.get(token)
    if entry and time.time() < entry[1]:
        return entry[0]
    if entry:
        _TOKEN_CACHE.pop(token, None)
    return None


def cache_token(token: str, user_id: int, ttl_seconds: int) -> None:
    _TOKEN_CACHE[token] = (user_id, time.time() + ttl_seconds)


def invalidate_token_cache(token: str) -> None:
    _TOKEN_CACHE.pop(token, None)


def clear_token_cache() -> None:
    _TOKEN_CACHE.clear()
