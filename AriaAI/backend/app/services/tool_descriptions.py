"""Tool description and policy-spec loader.

Tool prompts and side-effect policy are product contracts, not implementation
comments.  Keeping them in YAML makes the registry reviewable and testable
without chasing scattered inline strings.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


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
    spec = load_tool_spec(tool_name)
    policies = spec.get("required_policy") if spec else None
    if not isinstance(policies, dict):
        return None
    key = (operation or "default").strip().lower()
    value = policies.get(key) or policies.get("default")
    return str(value).strip() if value else None
