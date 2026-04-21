from __future__ import annotations

from datetime import UTC, datetime


def utc_now_naive() -> datetime:
    """Return a naive UTC timestamp for existing database datetime columns."""
    return datetime.now(UTC).replace(tzinfo=None)
