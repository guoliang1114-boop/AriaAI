"""Utilities for comparing saved memory snapshots with current memory."""

from __future__ import annotations

import json
from typing import Any


def parse_snapshot_memory(memory_json: str | None) -> dict[str, Any]:
    try:
        parsed = json.loads(memory_json or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("Memory snapshot is corrupted") from exc
    return parsed if isinstance(parsed, dict) else {}


def build_memory_snapshot_diff(
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    ignored_fields: set[str] | None = None,
) -> dict[str, Any]:
    ignored = ignored_fields or set()
    fields: list[dict[str, Any]] = []

    for field in sorted((set(before.keys()) | set(after.keys())) - ignored):
        before_value = before.get(field)
        after_value = after.get(field)
        if _stable_json(before_value) == _stable_json(after_value):
            continue

        field_diff: dict[str, Any] = {
            "field": field,
            "label": field,
            "kind": _value_kind(before_value, after_value),
        }
        if isinstance(before_value, list) and isinstance(after_value, list):
            field_diff["added"] = _list_delta(after_value, before_value)
            field_diff["removed"] = _list_delta(before_value, after_value)
        else:
            field_diff["before"] = before_value
            field_diff["after"] = after_value
        fields.append(field_diff)

    return {
        "summary": {
            "changed": len(fields),
            "added": sum(1 for item in fields if item.get("before") in (None, "", [], {})),
            "removed": sum(1 for item in fields if item.get("after") in (None, "", [], {})),
            "unchanged": len((set(before.keys()) | set(after.keys())) - ignored) - len(fields),
        },
        "fields": fields,
    }


def _value_kind(before: Any, after: Any) -> str:
    sample = after if after not in (None, "", [], {}) else before
    if isinstance(sample, list):
        return "list"
    if isinstance(sample, dict):
        return "object"
    return "value"


def _list_delta(source: list[Any], target: list[Any]) -> list[Any]:
    target_values = {_stable_json(item) for item in target}
    return [item for item in source if _stable_json(item) not in target_values]


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
