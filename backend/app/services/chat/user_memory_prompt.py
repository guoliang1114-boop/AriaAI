"""User-memory → conflict-aware system-prompt injection.

Given the current user's ``UserMemory`` row, build a compact prompt fragment the
model can use to personalise its reply (语言、汇报风格、工作偏好…) without
re-asking every turn.

Kept deliberately small:
* Loads only the row for ``user_id``; returns the parsed JSON dict (or ``None``).
* Renders a flat, bulletised section capped at ``_MAX_PROMPT_CHARS`` so a
  poorly-shaped preference blob can never blow up the system prompt.
* Skips wholly empty / boolean-False values so the section only surfaces signals
  the user actually wrote down.

The explicit precedence and content-free selection receipt are an Aria-native
adaptation of OpenAI Codex ``codex-rs/codex-home/src/instructions/mod.rs`` and
``codex-rs/core/src/context/world_state/mod.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9`` (Apache License 2.0). Aria owns
the preferences and never communicates with a Codex runtime.
"""
from __future__ import annotations

import json
import re
from typing import Any

from sqlmodel import Session, select

from app.models.db import UserMemory


_MAX_PROMPT_CHARS = 1200  # safety cap for the entire injected section
_MAX_BULLET_CHARS = 160   # one bullet's printed length cap
_MAX_BULLETS = 16         # never inject more than this many bullets

_PUBLIC_USER_MEMORY_SLOTS = {
    "personal_info.preferred_name",
    "response_preferences.language",
    "response_preferences.tone",
    "response_preferences.format",
    "work_style.ask_before_destructive",
    "work_style.confirmation_policy",
    "collaboration_style.proactive_care",
}

_OVERRIDE_DIMENSIONS = ("language", "tone", "format", "verbosity")
_OVERRIDE_PATTERNS = {
    "language": (
        re.compile(
            r"(?:(?:请|改成|切换到|使用|用|以)\s*(?:中文|英文|英语|汉语)(?:回答|回复|输出|撰写|写)?|"
            r"(?:中文|英文|英语|汉语)(?:回答|回复|输出|撰写|写))",
            re.I,
        ),
        re.compile(r"(?:不要|不用|别用)\s*(?:中文|英文|英语|汉语)", re.I),
        re.compile(r"\b(?:reply|respond|write|answer)\s+in\s+(?:chinese|english)\b", re.I),
        re.compile(r"\b(?:language|语言)\s*[:：=]", re.I),
    ),
    "tone": (
        re.compile(r"(?:正式|口语|直接|委婉|友好|克制|专业)(?:一点|些)?(?:语气|口吻|风格)", re.I),
        re.compile(r"(?:改成|使用|用|说得|写得)\s*(?:更|比较)?\s*(?:简洁|简短|精简)?\s*(?:正式|口语|直接|委婉|友好|克制|专业)(?:一点|些)?", re.I),
        re.compile(r"(?:不要|不用|别用)\s*(?:太)?\s*(?:正式|口语|直接|委婉|友好|克制|专业)", re.I),
        re.compile(r"(?:正式|口语|直接|委婉|友好|克制|专业)(?:一点|一些|些)", re.I),
        re.compile(r"(?:语气|口吻|tone)\s*[:：=]", re.I),
        re.compile(r"\b(?:formal|informal|friendly|direct)\s+tone\b", re.I),
    ),
    "format": (
        re.compile(r"(?:输出|整理|改成|使用|用|以)(?:为|成)?\s*(?:markdown|表格|列表|要点|json|大纲|邮件|报告|ppt|纯文本)", re.I),
        re.compile(r"(?:不要|不用|别用|无需)\s*(?:markdown|表格|列表|要点|json|大纲|邮件|报告|ppt)", re.I),
        re.compile(r"(?:格式|结构|format)\s*[:：=]", re.I),
        re.compile(r"\b(?:as|in)\s+(?:markdown|json|a table|bullet points?)\b", re.I),
    ),
    "verbosity": (
        re.compile(r"(?:更|尽量|请|改成|写得|回答得)\s*(?:简短|简洁|精简|详细|展开|深入)", re.I),
        re.compile(r"(?:不要|不用|无需)\s*(?:太)?\s*(?:简短|简洁|精简|详细|展开|深入)", re.I),
        re.compile(r"(?:简短|简洁|精简|详细|深入)(?:回答|回复|说明|分析|展开|一点|一些|些)", re.I),
        re.compile(r"(?:一句话|只说结论)", re.I),
        re.compile(r"(?:字数|篇幅|长度|页数|条数|verbosity)\s*[:：=为不超控制在]", re.I),
        re.compile(r"\b(?:concise|brief|detailed|in-depth|one sentence)\b", re.I),
    ),
}

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


def load_user_memory_record(session: Session, user_id: int | None) -> dict[str, Any] | None:
    """Return parsed preferences with their Aria-owned version."""

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
    return {"preferences": prefs, "version": max(0, int(row.version or 0))}


def load_user_memory_preferences(session: Session, user_id: int | None) -> dict[str, Any] | None:
    """Return the user's preferences dict, or ``None`` if there's no row /
    no usable JSON / no user_id."""
    record = load_user_memory_record(session, user_id)
    return dict(record["preferences"]) if record else None


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


def _preference_dimension(top_key: str, sub_key: str | None) -> str:
    path = f"{top_key}.{sub_key}" if sub_key else top_key
    normalized = path.lower().replace("-", "_")
    if any(term in normalized for term in ("language", "locale", "语言")):
        return "language"
    if any(term in normalized for term in ("tone", "voice", "语气", "口吻")):
        return "tone"
    if any(term in normalized for term in ("format", "structure", "output_shape", "presentation")):
        return "format"
    if any(term in normalized for term in ("verbosity", "length", "detail", "concise", "篇幅", "字数")):
        return "verbosity"
    return ""


def _public_preference_slot(path: str) -> str:
    """Map arbitrary JSON keys onto a fixed, content-safe receipt vocabulary."""

    if path in _PUBLIC_USER_MEMORY_SLOTS:
        return path
    if path == "appearance" or path.startswith("appearance."):
        return "appearance"
    return "other_preference"


def classify_user_preference_overrides(
    query: str,
    user_constraints: list[str] | tuple[str, ...] = (),
) -> tuple[str, ...]:
    """Detect only explicit per-turn preference overrides in stable dimensions."""

    text = " ".join(
        part.strip()
        for part in (str(query or ""), *(str(item or "") for item in user_constraints))
        if part.strip()
    )
    return tuple(
        dimension
        for dimension in _OVERRIDE_DIMENSIONS
        if any(pattern.search(text) for pattern in _OVERRIDE_PATTERNS[dimension])
    )


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


def _flatten_preference_entries(
    preferences: dict[str, Any],
    *,
    excluded_dimensions: tuple[str, ...] = (),
) -> list[tuple[str, str]]:
    """Walk one level of nesting and produce ``key: value`` bullets.

    ``personal_info.preferred_name`` is intentionally excluded — it's rendered
    separately as a lead line in :func:`format_user_memory_for_prompt`.
    """
    entries: list[tuple[str, str]] = []
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
                if _preference_dimension(top_key, sub_key) in excluded_dimensions:
                    continue
                line = _format_preference_bullet(top_key, sub_key, sub_val)
                if len(line) > _MAX_BULLET_CHARS:
                    line = line[: _MAX_BULLET_CHARS - 1] + "…"
                entries.append((f"{top_key}.{sub_key}", line))
        else:
            if _preference_dimension(top_key, None) in excluded_dimensions:
                continue
            line = _format_preference_bullet(top_key, None, top_val)
            if len(line) > _MAX_BULLET_CHARS:
                line = line[: _MAX_BULLET_CHARS - 1] + "…"
            entries.append((top_key, line))
    return entries


def build_user_memory_prompt_bundle(
    preferences: dict[str, Any] | None,
    query: str = "",
    *,
    user_constraints: list[str] | tuple[str, ...] = (),
    version: int = 0,
) -> dict[str, Any]:
    """Render non-conflicting preferences and a privacy-safe user layer."""

    detected_overrides = classify_user_preference_overrides(query, user_constraints)
    valid_preferences = preferences if isinstance(preferences, dict) else {}
    all_entries = _flatten_preference_entries(valid_preferences)
    stored_dimensions = {
        _preference_dimension(
            path.split(".", 1)[0],
            path.split(".", 1)[1] if "." in path else None,
        )
        for path, _ in all_entries
    }
    overrides = tuple(
        dimension for dimension in detected_overrides if dimension in stored_dimensions
    )
    selected_entries = _flatten_preference_entries(
        valid_preferences,
        excluded_dimensions=overrides,
    )
    preferred_name = _extract_preferred_name(valid_preferences)
    selected_paths = (["personal_info.preferred_name"] if preferred_name else []) + [
        path for path, _ in selected_entries[:_MAX_BULLETS]
    ]
    public_selected_slots = list(dict.fromkeys(
        _public_preference_slot(path) for path in selected_paths
    ))
    available_count = len(all_entries) + int(bool(preferred_name))
    selection: dict[str, Any] = {
        "scope": "user",
        "status": "ready" if available_count else "missing",
        "version": max(0, int(version or 0)),
        "retrieval_mode": "focused" if overrides else ("overview" if available_count else "none"),
        "query_facets": [],
        "selected_slots": public_selected_slots,
        "selected_slot_count": len(public_selected_slots),
        "available_slot_count": available_count,
        "omitted_slot_count": max(0, available_count - len(selected_paths)),
        "selected_item_count": len(selected_paths),
        "truncated": len(selected_entries) > _MAX_BULLETS,
        "overridden_dimensions": list(overrides),
    }
    if not available_count:
        return {"prompt": "", "selection": selection}

    parts: list[str] = [
        "## 当前用户偏好（User Memory）",
        "用户已显式声明的工作方式与回复偏好。本轮明确要求优先于已保存偏好；"
        "其余偏好仅在不影响项目事实与客户事实时遵循。",
    ]
    if overrides:
        parts.append(
            "本轮已覆盖的历史偏好维度：" + "、".join(overrides) + "。不要同时执行被覆盖的旧偏好。"
        )
    if preferred_name:
        parts.append(f"用户希望被称呼为：{preferred_name}。请在回复中自然使用这一称呼。")
    if selected_entries:
        parts.append("\n".join(f"- {line}" for _, line in selected_entries[:_MAX_BULLETS]))
    section = "\n".join(parts)
    if len(section) > _MAX_PROMPT_CHARS:
        section = section[: _MAX_PROMPT_CHARS - 1] + "…"
        selection["truncated"] = True
    return {"prompt": section, "selection": selection}


def format_user_memory_for_prompt(preferences: dict[str, Any] | None) -> str:
    """Render a compact prompt section from a preferences dict, or empty string."""
    return str(build_user_memory_prompt_bundle(preferences).get("prompt") or "")
