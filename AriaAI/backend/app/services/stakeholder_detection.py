"""Standalone stakeholder detection service.

Extracts person names + roles from Chinese/English text for automatic
stakeholder suggestion in project conversations.  Designed for high
precision (few false positives) over high recall.
"""
from __future__ import annotations

import re


_ROLE_SUFFIXES = ("总监", "经理", "负责人", "主管", "主任", "老板")
_ROLE_STANDALONE = (
    "采购", "财务", "法务", "安全", "运维", "商务", "产品", "技术", "业务方", "使用方",
)
_TITLE_KEYWORDS = (
    "CEO", "CFO", "CTO", "CIO", "CDO", "VP",
    "采购负责人", "财务负责人", "法务负责人", "安全负责人",
    "业务负责人", "技术负责人", "项目负责人", "产品经理",
)
_NAME_STOPWORDS = frozenset(
    {
        "提醒", "表示", "认为", "需要", "关注", "等待", "确认", "补充",
        "客户", "业务", "项目", "希望", "提到", "建议", "已经", "可以",
        "应该", "比较", "目前", "之前", "现在", "之后", "最后",
    }
)

_ROLE_SUFFIX_PATTERN = re.compile(
    r"(?P<name>[\u4e00-\u9fa5]{1,4})(?P<role>" + "|".join(_ROLE_SUFFIXES + _ROLE_STANDALONE) + r")"
)
_TITLE_PATTERN = re.compile(
    r"(?P<title>" + "|".join(re.escape(t) for t in _TITLE_KEYWORDS) + r")",
    re.IGNORECASE,
)


def detect_stakeholders_from_text(text: str, *, limit: int = 8) -> list[dict[str, str]]:
    """Extract potential stakeholder mentions from *text*.

    Returns a list of dicts with keys:
      name, role, influence_type, relationship_status, note

    Only the first *limit* candidates are returned.
    """
    compact = " ".join((text or "").replace("\r", " ").replace("\n", " ").split())
    if not compact:
        return []

    candidates: list[dict[str, str]] = []
    seen: set[str] = set()

    # ── Pass 1: Chinese name + role suffix (e.g. 张总监, 李经理) ─────────
    for match in _ROLE_SUFFIX_PATTERN.finditer(compact):
        raw_name = match.group("name").strip()
        role = match.group("role").strip()
        if len(raw_name) > 4 or raw_name in _NAME_STOPWORDS:
            continue
        if len(raw_name) > 2 and raw_name[:2] in _NAME_STOPWORDS:
            continue
        name = f"{raw_name}{role}" if len(raw_name) == 1 else raw_name
        key = f"{name}:{role}".lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "name": name,
                "role": role,
                "influence_type": role if role in {"采购", "财务", "法务", "安全", "商务"} else "",
                "relationship_status": "unknown",
                "note": _excerpt(compact, limit=180),
            }
        )
        if len(candidates) >= limit:
            return candidates

    # ── Pass 2: standalone title keywords (CEO, CFO, 采购负责人 …) ──────
    for match in _TITLE_PATTERN.finditer(compact):
        title = match.group("title").strip()
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "name": title,
                "role": title,
                "influence_type": title,
                "relationship_status": "unknown",
                "note": _excerpt(compact, limit=180),
            }
        )
        if len(candidates) >= limit:
            return candidates

    return candidates


def _excerpt(text: str, *, limit: int = 180) -> str:
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    if "，" in truncated:
        return truncated.rsplit("，", 1)[0] + "…"
    return truncated + "…"
