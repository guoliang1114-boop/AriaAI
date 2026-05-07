from __future__ import annotations

from datetime import datetime, timezone


def utc_now_naive() -> datetime:
    """Return a naive UTC timestamp for existing database datetime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
