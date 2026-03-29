"""Simple in-process TTL cache.

Used to avoid repeated round trips to Supabase (AWS Mumbai, ~170ms per query).
Each cache instance is module-level so it persists across requests within one
worker process — no Redis or external dependency required.
"""
from __future__ import annotations

import time
from typing import Any


class TTLCache:
    """Thread-safe TTL dict cache (single-process only)."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expires_at = entry
        if time.time() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any, ttl: float = 60.0) -> None:
        self._store[key] = (value, time.time() + ttl)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        keys = [k for k in self._store if k.startswith(prefix)]
        for k in keys:
            del self._store[k]

    def clear(self) -> None:
        self._store.clear()


# ── Module-level singletons ───────────────────────────────────────────────────
# One cache per resource type.  TTLs chosen based on how often data changes:
#   • clients / projects: change rarely → 120 s
#   • conversations: new ones created during chat → 20 s

clients_cache = TTLCache()
projects_cache = TTLCache()
conversations_cache = TTLCache()
