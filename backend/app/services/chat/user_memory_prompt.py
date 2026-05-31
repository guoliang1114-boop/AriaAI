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

_PROACTIVE_CARE_PROMPTS = {
    "off": (
        "主动关怀=关闭。只在用户明确提出需要时回应，不主动提醒作息、情绪或节奏。"
    ),
    "work_partner": (
        "主动关怀=工作型。仅在长时间工作、深夜收尾、任务过载或用户表达压力时，"
        "轻量提醒节奏，并优先把事情整理成下一步行动。"
    ),
    "gentle": (
        "主动关怀=温和型。当用户显得焦虑、疲惫或混乱时，先用一句克制的支持性回应，"
        "再把问题拆成可执行步骤。"
    ),
    "active": (
        "主动关怀=积极型。可以更主动地提醒工作节奏、风险、休息和下一步，"
        "但仍保持专业边界，不做心理诊断或过度陪伴。"
    ),
}


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


def _format_preference_bullet(top_key: str, sub_key: str | None, value: Any) -> str:
    if top_key == "collaboration_style" and sub_key == "proactive_care":
        mapped = _PROACTIVE_CARE_PROMPTS.get(str(value).strip())
        if mapped:
            return mapped
    dotted_key = f"{top_key}.{sub_key}" if sub_key else top_key
    return f"{dotted_key}: {_format_value(value)}"


def _extract_preferred_name(preferences: dict[str, Any]) -> str:
    """Return the user's preferred form of address (称呼) or empty string.

    Pulled out of the generic bullet flow so it can be promoted to a dedicated
    lead line — "address the user as X" is a different kind of signal from
    "user prefers conclusion-first replies" and deserves emphasis.
    """
    info = preferences.get("personal_info")
    if not isinstance(info, dict):
        return ""
    name = info.get("preferred_name")
    if not isinstance(name, str):
        return ""
    return name.strip()[: _MAX_BULLET_CHARS]


def _flatten_bullets(preferences: dict[str, Any]) -> list[str]:
    """Walk one level of nesting and produce ``key: value`` bullets.

    ``personal_info.preferred_name`` is intentionally excluded — it's rendered
    separately as a lead line in :func:`format_user_memory_for_prompt`.
    """
    bullets: list[str] = []
    for top_key, top_val in preferences.items():
        if not _is_meaningful(top_val):
            continue
        if isinstance(top_val, dict):
            for sub_key, sub_val in top_val.items():
                if not _is_meaningful(sub_val):
                    continue
                if top_key == "personal_info" and sub_key == "preferred_name":
                    continue  # promoted to lead line
                if top_key == "personal_info" and sub_key == "onboarding_seen":
                    continue  # housekeeping flag, not a preference
                line = _format_preference_bullet(top_key, sub_key, sub_val)
                if len(line) > _MAX_BULLET_CHARS:
                    line = line[: _MAX_BULLET_CHARS - 1] + "…"
                bullets.append(line)
                if len(bullets) >= _MAX_BULLETS:
                    return bullets
        else:
            line = _format_preference_bullet(top_key, None, top_val)
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
    preferred_name = _extract_preferred_name(preferences)
    bullets = _flatten_bullets(preferences)
    if not preferred_name and not bullets:
        return ""
    parts: list[str] = [
        "## 当前用户偏好（User Memory）",
        "用户已显式声明的工作方式与回复偏好。除非用户在本轮明确说明相反，"
        "请在不影响项目事实与客户事实的前提下尽量遵循。",
    ]
    if preferred_name:
        parts.append(f"用户希望被称呼为：{preferred_name}。请在回复中自然使用这一称呼。")
    if bullets:
        parts.append("\n".join(f"- {b}" for b in bullets))
    section = "\n".join(parts)
    if len(section) > _MAX_PROMPT_CHARS:
        section = section[: _MAX_PROMPT_CHARS - 1] + "…"
    return section
