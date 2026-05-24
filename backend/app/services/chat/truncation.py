"""Output-truncation detection and continuation helpers."""
from __future__ import annotations

OUTPUT_TRUNCATED_MARKER = "[OUTPUT_TRUNCATED]"


def strip_truncation_marker(chunk: str) -> tuple[str, bool]:
    """Remove ``[OUTPUT_TRUNCATED]`` from *chunk* and return whether it was found."""
    if OUTPUT_TRUNCATED_MARKER not in chunk:
        return chunk, False
    return chunk.replace(OUTPUT_TRUNCATED_MARKER, "").strip(), True
