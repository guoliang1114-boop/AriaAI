"""Tool description loader and capability-manifest compatibility helpers.

Tool prompt copy remains in reviewable YAML. Execution policy, scheduling, and
result semantics come from the versioned capability manifest so every runtime
consumer reads one source of truth.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.tools.capabilities import resolve_tool_manifest


_TOOLS_DIR = Path(__file__).resolve().parents[1] / "prompts" / "tools"


@lru_cache(maxsize=128)
def load_tool_spec(tool_name: str) -> dict[str, Any]:
    path = _TOOLS_DIR / f"{tool_name}.yaml"
    if not path.exists():
        return {}
    value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return value if isinstance(value, dict) else {}


def tool_description(tool_name: str, fallback: str) -> str:
    spec = load_tool_spec(tool_name)
    if not spec:
        return fallback
    parts = [
        str(spec.get("purpose") or "").strip(),
        str(spec.get("when_to_use") or "").strip(),
        str(spec.get("when_not_to_use") or "").strip(),
        str(spec.get("ui_effect") or "").strip(),
    ]
    description = " ".join(part for part in parts if part)
    return description or fallback


def tool_required_policy(tool_name: str, operation: str = "default") -> str | None:
    key = (operation or "default").strip().lower()
    manifest = resolve_tool_manifest(tool_name)
    capability = manifest.operations.get(key, manifest.default)
    return capability.required_policy


def tool_supports_parallel(tool_name: str, operation: str = "default") -> bool:
    """Return an explicit parallel-safety declaration for one operation.

    Missing or malformed metadata is deliberately serial. A mapping allows a
    mixed read/write tool to opt in only its read-only operations.
    """

    key = (operation or "default").strip().lower()
    manifest = resolve_tool_manifest(tool_name)
    return manifest.operations.get(key, manifest.default).parallel_safe
