"""Semantic Skill routing for project chat.

This module is intentionally deterministic for now: it gives the chat runtime a
stable, inspectable first pass for selecting an AriaAI Skill before the model is
called.  The important product behavior is that Skills are no longer only a UI
toggle; high-confidence user intent can arm a matching Skill automatically,
while questions and low-confidence matches stay in normal chat.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlmodel import Session, select

from app.models.db import Skill
from app.routers.chat_schemas import SendMessageRequest

_SELECTED_SKILL_WORKFLOW_TERMS = (
    "生成", "制作", "创建", "输出", "整理", "撰写", "起草", "准备", "设计",
    "分析", "诊断", "评估", "拆解", "提炼", "总结", "复盘", "规划",
    "generate", "create", "draft", "prepare", "analyze", "assess", "summarize",
)

_SELECTED_SKILL_DELIVERABLE_TERMS = (
    "报告", "方案", "建议书", "提案", "ppt", "pptx", "deck", "文档", "材料",
    "纪要", "行动项", "路线图", "roadmap", "计划", "清单", "表格", "excel",
    "brief", "简报", "会议准备", "会前", "客户会议",
)


@dataclass(frozen=True)
class SkillActivationDecision:
    """Structured decision for applying a selected or inferred Skill."""

    apply: bool
    reason: str
    confidence: float = 0.0
    source: str = "explicit"
    candidate_skill_id: int | None = None
    candidate_skill_name: str = ""
    top_candidates: tuple[dict, ...] = field(default_factory=tuple)


def decide_skill_activation(content: str, skill: Skill | None, *, force_skill: bool = False) -> SkillActivationDecision:
    """Decide whether an explicitly selected Skill should run for this message."""
    if not skill:
        return SkillActivationDecision(False, "no_skill", 0.0)
    skill_id = getattr(skill, "id", None)
    skill_name = getattr(skill, "name", "") or ""
    if force_skill:
        return SkillActivationDecision(True, "forced_by_user", 1.0, candidate_skill_id=skill_id, candidate_skill_name=skill_name)
    text = (content or "").strip().lower()
    if not text:
        return SkillActivationDecision(False, "empty_message", 0.0, candidate_skill_id=skill_id, candidate_skill_name=skill_name)

    explicit_skill = any(
        token in text
        for token in (
            "@skill", "@ skills", "使用skill", "调用skill", "运行skill", "执行skill",
            "用这个能力", "用该能力",
        )
    )
    if explicit_skill:
        return SkillActivationDecision(
            True,
            "explicit_skill_invocation",
            0.96,
            candidate_skill_id=skill_id,
            candidate_skill_name=skill_name,
        )

    workflow_request = any(token in text for token in _SELECTED_SKILL_WORKFLOW_TERMS)
    deliverable_request = any(token in text for token in _SELECTED_SKILL_DELIVERABLE_TERMS)
    question_only = text.endswith(("?", "？")) and not deliverable_request
    if workflow_request and deliverable_request and not question_only:
        return SkillActivationDecision(
            True,
            "selected_skill_workflow_request",
            0.88,
            candidate_skill_id=skill_id,
            candidate_skill_name=skill_name,
        )

    return SkillActivationDecision(
        False,
        "selected_skill_not_armed",
        0.8,
        candidate_skill_id=skill_id,
        candidate_skill_name=skill_name,
    )


def _normalize_for_skill_match(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip().lower())


def _tokenize_skill_text(value: str) -> set[str]:
    tokens = set(re.findall(r"[a-zA-Z0-9]{2,}|[\u4e00-\u9fff]{2,}", (value or "").lower()))
    return {token for token in tokens if len(token) >= 2}


_SKILL_ALIAS_TERMS: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("会议纪要", "meeting"), ("会议纪要", "会议记录", "纪要", "meeting notes", "minutes", "客户会议", "会后行动项")),
    (("meeting-intelligence", "meeting intelligence"), ("会议纪要", "会议记录", "转写", "行动项", "决策", "meeting notes", "minutes")),
    (("目标定义", "goal"), ("目标定义", "目标拆解", "okr", "smart", "目标设定")),
    (("pdf",), ("pdf", "合并pdf", "拆分pdf", "提取页面", "水印")),
    (("office", "文档编辑"), ("office", "word", "excel", "ppt", "pptx", "docx", "xlsx", "编辑文档", "修改ppt", "更新word")),
    (("顾问式ppt", "presentation"), ("ppt", "pptx", "演示文稿", "幻灯片", "deck", "汇报材料", "路演", "客户介绍")),
    (("presentation-builder", "presentation builder"), ("ppt", "pptx", "deck", "演示文稿", "汇报材料", "项目汇报", "客户简报")),
    (("咨询提案", "proposal"), ("提案", "建议书", "proposal", "sow", "商业案例", "报价方案", "客户方案")),
    (("consulting-proposal-advisor", "proposal advisor"), ("提案", "建议书", "proposal", "sow", "商业案例", "报价", "客户方案")),
    (("数字化战略", "digital"), ("数字化战略", "数字化转型", "转型战略", "digital strategy")),
    (("digital-strategy", "digital strategy"), ("数字化战略", "数字化转型", "转型路线图", "数字化蓝图", "top-level design")),
    (("ai-strategy", "ai strategy"), ("ai战略", "ai 战略", "人工智能战略", "ai roadmap", "ai转型")),
    (("根因", "root"), ("根因", "根因分析", "root cause")),
    (("复盘", "retro"), ("复盘", "经验教训", "lessons learned")),
    (("访谈", "interview"), ("访谈", "访谈提纲", "访谈问题", "interview guide")),
    (("会前", "brief", "meeting"), ("会前", "见客户", "客户会议准备", "客户简报", "pre-meeting", "meeting prep")),
)


def skill_auto_match_score(content: str, skill: Skill) -> tuple[int, str]:
    """Return a 0-100 deterministic score and a short reason."""
    text = _normalize_for_skill_match(content)
    if not text:
        return 0, "empty"
    name = _normalize_for_skill_match(skill.name)
    if name and name in text:
        return 100, "skill_name_exact"

    haystack = _normalize_for_skill_match(
        "\n".join([skill.name or "", skill.description or "", skill.category or ""])
    )
    best_score = 0
    best_reason = "no_match"

    for skill_markers, request_terms in _SKILL_ALIAS_TERMS:
        if any(_normalize_for_skill_match(marker) in haystack for marker in skill_markers):
            matched_terms = [
                term for term in request_terms
                if _normalize_for_skill_match(term) and _normalize_for_skill_match(term) in text
            ]
            if matched_terms:
                score = 90 if len(matched_terms) >= 2 else 82
                if score > best_score:
                    best_score = score
                    best_reason = f"alias:{matched_terms[0]}"

    skill_tokens = _tokenize_skill_text(f"{skill.name}\n{skill.description}")
    content_tokens = _tokenize_skill_text(content)
    overlap = skill_tokens & content_tokens
    generic = {"项目", "分析", "报告", "方案", "客户", "文档", "材料", "生成", "整理"}
    strong_overlap = {token for token in overlap if token not in generic and len(token) >= 2}
    if len(strong_overlap) >= 2:
        score = min(86, 70 + len(strong_overlap) * 5)
        if score > best_score:
            best_score = score
            best_reason = "token_overlap"

    return best_score, best_reason


def auto_select_skill(session: Session, req: SendMessageRequest) -> tuple[Skill | None, SkillActivationDecision]:
    """Infer a Skill for project chat when the request is a high-confidence workflow."""
    if req.skill_id or req.force_skill or not req.project_id:
        return None, SkillActivationDecision(False, "no_auto_skill_scope", 0.0, source="auto")
    text = (req.content or "").strip()
    if not text:
        return None, SkillActivationDecision(False, "empty_message", 0.0, source="auto")

    candidates = session.exec(select(Skill)).all()
    normalized_text = _normalize_for_skill_match(text)
    looks_like_question = normalized_text.endswith(("?", "？")) or normalized_text.startswith(
        ("为什么", "如何", "怎么", "是否", "是不是", "能不能", "可不可以", "what", "why", "how")
    )
    exact_name_match = any(_normalize_for_skill_match(skill.name) in normalized_text for skill in candidates if skill.name)
    if looks_like_question and not exact_name_match:
        return None, SkillActivationDecision(False, "auto_skill_skipped_question", 0.0, source="auto")

    scored: list[tuple[int, str, Skill]] = []
    for skill in candidates:
        score, reason = skill_auto_match_score(text, skill)
        if score > 0:
            scored.append((score, reason, skill))
    scored.sort(key=lambda item: item[0], reverse=True)
    top_candidates = tuple(
        {
            "skill_id": skill.id,
            "skill_name": skill.name,
            "score": score,
            "reason": reason,
        }
        for score, reason, skill in scored[:3]
    )

    if scored:
        best_score, best_reason, best_skill = scored[0]
        if best_score >= 82:
            return best_skill, SkillActivationDecision(
                True,
                f"auto_skill_match:{best_skill.name}:{best_reason}",
                best_score / 100,
                source="auto",
                candidate_skill_id=best_skill.id,
                candidate_skill_name=best_skill.name,
                top_candidates=top_candidates,
            )
        return None, SkillActivationDecision(
            False,
            "auto_skill_no_confident_match",
            best_score / 100,
            source="auto",
            candidate_skill_id=best_skill.id,
            candidate_skill_name=best_skill.name,
            top_candidates=top_candidates,
        )

    return None, SkillActivationDecision(False, "auto_skill_no_match", 0.0, source="auto")
