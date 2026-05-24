"""Standalone stakeholder detection service.

Extracts person names + roles from Chinese/English text for automatic
stakeholder suggestion in project conversations.  Designed for high
precision (few false positives) over high recall.
"""
from __future__ import annotations

import re


_ROLE_SUFFIXES = ("总监", "经理", "负责人", "主管", "主任", "老板", "总")
_TITLE_KEYWORDS = (
    "CEO", "CFO", "CTO", "CIO", "CDO", "VP"
)
_NAME_STOPWORDS = frozenset(
    {
        "提醒", "表示", "认为", "需要", "关注", "等待", "确认", "补充",
        "客户", "业务", "项目", "希望", "提到", "建议", "已经", "可以",
        "应该", "比较", "目前", "之前", "现在", "之后", "最后",
        "数据", "安全", "系统", "方案", "报价", "合同", "需求", "交付",
        "品牌", "渠道", "战略", "高管", "管理", "产品", "技术", "财务",
        "采购", "法务", "商务", "运维", "市场", "销售", "部门",
    }
)
_NON_PERSON_NAME_PARTS = (
    "数据", "安全", "系统", "方案", "报价", "合同", "需求", "交付", "品牌",
    "渠道", "战略", "高管", "管理", "产品", "技术", "财务", "采购", "法务",
    "商务", "运维", "市场", "销售", "部门", "业务", "项目", "客户", "公司",
)
_ROLE_ONLY_KEYWORDS = frozenset(
    {
        "采购负责人", "财务负责人", "法务负责人", "安全负责人", "业务负责人",
        "技术负责人", "项目负责人", "产品经理", "品牌负责人", "渠道负责人",
        "战略部", "高管层", "管理层",
    }
)
_ENGLISH_LEADING_WORDS = frozenset({"with", "by", "to", "from", "for", "and", "or"})

_ROLE_SUFFIX_PATTERN = re.compile(
    r"(?P<name>[\u4e00-\u9fa5]{1,4})(?P<role>" + "|".join(_ROLE_SUFFIXES) + r")"
)
_TITLE_PATTERN = re.compile(
    r"(?P<title>" + "|".join(re.escape(t) for t in _TITLE_KEYWORDS) + r")",
    re.IGNORECASE,
)
_ENGLISH_PERSON_WITH_TITLE_PATTERN = re.compile(
    r"\b(?P<name>[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*(?:\(|,|-|/)?\s*(?P<title>CEO|CFO|CTO|CIO|CDO|VP)\b",
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
        if not _looks_like_chinese_person_name(raw_name, role):
            continue
        name = f"{raw_name}{role}" if len(raw_name) == 1 or role == "总" else raw_name
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

    # ── Pass 2: English person + title (e.g. Alice Wang, CFO) ──────────
    for match in _ENGLISH_PERSON_WITH_TITLE_PATTERN.finditer(compact):
        name_parts = match.group("name").strip().split()
        while len(name_parts) > 1 and name_parts[0].lower() in _ENGLISH_LEADING_WORDS:
            name_parts.pop(0)
        name = " ".join(name_parts)
        title = match.group("title").strip()
        if title.upper() in {"CEO", "CFO", "CTO", "CIO", "CDO", "VP"} and name.upper() == title.upper():
            continue
        key = f"{name}:{title}".lower()
        if key in seen:
            continue
        seen.add(key)
        candidates.append(
            {
                "name": name,
                "role": title,
                "influence_type": title,
                "relationship_status": "unknown",
                "note": _excerpt(compact, limit=180),
            }
        )
        if len(candidates) >= limit:
            return candidates

    return candidates


def _looks_like_chinese_person_name(raw_name: str, role: str) -> bool:
    if not raw_name or len(raw_name) > 3:
        return False
    candidate = f"{raw_name}{role}"
    if candidate in _ROLE_ONLY_KEYWORDS or raw_name in _NAME_STOPWORDS:
        return False
    if any(part in raw_name for part in _NON_PERSON_NAME_PARTS):
        return False
    if len(raw_name) > 1 and (raw_name[:2] in _NAME_STOPWORDS or raw_name[-2:] in _NAME_STOPWORDS):
        return False
    if role == "负责人" and len(raw_name) < 2:
        return False
    return True


def _excerpt(text: str, *, limit: int = 180) -> str:
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    if "，" in truncated:
        return truncated.rsplit("，", 1)[0] + "…"
    return truncated + "…"
