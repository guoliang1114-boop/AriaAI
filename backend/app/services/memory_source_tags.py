"""Sanitize model-visible source markers from persisted memory values.

Stable ``[source_type:id]`` markers are prompt metadata. They may be used only
inside the private source-attribution envelope and must never become project or
client business memory.
"""
from __future__ import annotations

import re
from typing import Any


_VISIBLE_SOURCE_TAG_PATTERN = re.compile(
    r"\[(?:"
    r"project|project_memory|project_progress|milestone|project_todo|project_file|"
    r"project_payment|client|client_stakeholder"
    r"):[^\]\s:]{1,80}\]"
)


def strip_memory_source_tags(value: Any) -> Any:
    """Recursively remove Aria's prompt-only source markers.

    Only the finite source families rendered by memory rebuild prompts are
    removed, so ordinary bracketed customer content remains untouched.
    """

    if isinstance(value, str):
        cleaned = _VISIBLE_SOURCE_TAG_PATTERN.sub("", value)
        if cleaned == value:
            return value
        return cleaned.strip()
    if isinstance(value, list):
        return [strip_memory_source_tags(item) for item in value]
    if isinstance(value, dict):
        cleaned: dict[Any, Any] = {}
        for key, item in value.items():
            cleaned_key = strip_memory_source_tags(key) if isinstance(key, str) else key
            if isinstance(cleaned_key, str) and not cleaned_key:
                continue
            cleaned[cleaned_key] = strip_memory_source_tags(item)
        return cleaned
    return value
