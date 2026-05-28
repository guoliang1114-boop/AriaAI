"""User-memory → system-prompt injection (V0.0.4 track B).

Given the current user's ``UserMemory`` row, build a compact prompt fragment the
model can use to personalise its reply (语言、汇报风格、工作偏好…) without
re-asking every turn.

Kept deliberately small:
* Loads only the row for ``user_id``; returns the parsed JSON dict (or ``None``).
* Renders a flat, bulletised section capped at ``_MAX_PROMPT_CHARS`` so a
  poorly-shaped preference blob can never blow up the system prompt.
* Skips wholly empty / boolean-False values so the section only surfaces signals
  the user actually wrote down.
"""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session, select

from app.models.db import UserMemory


_MAX_PROMPT_CHARS = 1200  # safety cap for the entire injected section
_MAX_BULLET_CHARS = 160   # one bullet's printed length cap
_MAX_BULLETS = 16         # never inject more than this many bullets


def load_user_memory_preferences(session: Session, user_id: int | None) -> dict[str, Any] | None:
    """Return the user's preferences dict, or ``None`` if there's no row /
    no usable JSON / no user_id."""
    if not user_id:
        return None
    row = session.exec(select(UserMemory).where(UserMemory.user_id == user_id)).first()
    if row is None:
        return None
    try:
        prefs = json.loads(row.preferences_json or "{}")
    except json.JSONDecodeError:
        return None
    if not isinstance(prefs, dict) or not prefs:
        return None
    return prefs


def _is_meaningful(value: Any) -> bool:
    """Drop empty strings / empty lists / dicts / ``None`` / ``False``."""
    if value is None or value is False:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return True


def _format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (list, tuple, set)):
        items = [str(v).strip() for v in value if _is_meaningful(v)]
        return "、".join(items)
    if isinstance(value, dict):
        # Render at most a couple of top-level entries inline.
        parts = []
        for k, v in value.items():
            if not _is_meaningful(v):
                continue
            parts.append(f"{k}={_format_value(v)}")
        return "; ".join(parts)
    return str(value).strip()


def _flatten_bullets(preferences: dict[str, Any]) -> list[str]:
    """Walk one level of nesting and produce ``key: value`` bullets."""
    bullets: list[str] = []
    for top_key, top_val in preferences.items():
        if not _is_meaningful(top_val):
            continue
        if isinstance(top_val, dict):
            for sub_key, sub_val in top_val.items():
                if not _is_meaningful(sub_val):
                    continue
                line = f"{top_key}.{sub_key}: {_format_value(sub_val)}"
                if len(line) > _MAX_BULLET_CHARS:
                    line = line[: _MAX_BULLET_CHARS - 1] + "…"
                bullets.append(line)
                if len(bullets) >= _MAX_BULLETS:
                    return bullets
        else:
            line = f"{top_key}: {_format_value(top_val)}"
            if len(line) > _MAX_BULLET_CHARS:
                line = line[: _MAX_BULLET_CHARS - 1] + "…"
            bullets.append(line)
            if len(bullets) >= _MAX_BULLETS:
                return bullets
    return bullets


def format_user_memory_for_prompt(preferences: dict[str, Any] | None) -> str:
    """Render a compact prompt section from a preferences dict, or empty string."""
    if not isinstance(preferences, dict) or not preferences:
        return ""
    bullets = _flatten_bullets(preferences)
    if not bullets:
        return ""
    body = "\n".join(f"- {b}" for b in bullets)
    section = (
        "## 当前用户偏好（User Memory）\n"
        "用户已显式声明的工作方式与回复偏好。除非用户在本轮明确说明相反，"
        "请在不影响项目事实与客户事实的前提下尽量遵循。\n"
        f"{body}"
    )
    if len(section) > _MAX_PROMPT_CHARS:
        section = section[: _MAX_PROMPT_CHARS - 1] + "…"
    return section
