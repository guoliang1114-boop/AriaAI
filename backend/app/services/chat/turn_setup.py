"""Deterministic, user-visible setup advice for one project-chat turn.

The advisor never changes execution policy by itself.  It only recommends one
of the frontend's bounded Brief templates; Skill selection remains governed by
the existing skill router and requires an explicit UI action before send.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TurnBriefTemplateAdvice:
    template_id: str
    label: str
    reason: str


_TEMPLATE_RULES: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    (
        "plan_only",
        "仅做计划",
        "问题要求先形成步骤、路线图或实施计划。",
        ("只做计划", "仅做计划", "不要执行", "先别执行", "路线图", "实施计划", "执行计划", "roadmap", "plan only"),
    ),
    (
        "evidence_first",
        "证据优先",
        "问题强调依据、核验、来源或信息缺口。",
        ("证据", "依据", "来源", "引用", "核验", "验证", "事实", "信息缺口", "访谈", "数据", "evidence", "source", "verify"),
    ),
    (
        "executive_answer",
        "管理层结论",
        "问题面向管理层汇报、决策或优先级判断。",
        ("管理层", "董事会", "高管", "汇报", "决策", "优先级", "结论先行", "executive", "board", "management"),
    ),
    (
        "read_only_analysis",
        "只读分析",
        "问题要求评估、比较、复盘或识别风险。",
        ("分析", "评估", "比较", "复盘", "诊断", "识别", "风险", "审查", "检查", "analyze", "assess", "review", "compare", "risk"),
    ),
)


def _contains_term(text: str, term: str) -> bool:
    normalized = term.casefold()
    if not normalized.isascii():
        return normalized in text
    return re.search(
        rf"(?<![a-z0-9]){re.escape(normalized)}(?![a-z0-9])",
        text,
    ) is not None


def recommend_turn_brief_template(content: str) -> TurnBriefTemplateAdvice | None:
    """Return the first high-signal Brief template, or no recommendation."""

    text = re.sub(r"\s+", " ", str(content or "")).strip().casefold()
    if not text:
        return None
    for template_id, label, reason, terms in _TEMPLATE_RULES:
        if any(_contains_term(text, term) for term in terms):
            return TurnBriefTemplateAdvice(template_id, label, reason)
    return None
