"""Semantic Skill routing for project chat.

This module is intentionally deterministic for now: it gives the chat runtime a
stable, inspectable first pass for selecting an AriaAI Skill before the model is
called.  The important product behavior is that Skills are no longer only a UI
toggle; high-confidence user intent can arm a matching Skill automatically,
while questions and low-confidence matches stay in normal chat.

The conversation-Skill lifecycle is an Aria Python adaptation of the per-turn
selection boundary in OpenAI Codex ``codex-rs/skills/src/mentions.rs``,
``codex-rs/skills/src/selection.rs``, and
``codex-rs/core/src/session/turn.rs`` at upstream commit
``83d1fe0e67b1323f71febc2925817732b449f1d9``. It has been modified for Aria's
database-published Skill catalog and does not import or communicate with Codex.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field

from sqlmodel import Session, select

from app.models.db import Skill
from app.routers.chat_schemas import SendMessageRequest

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
    catalog_fingerprint: str = ""
    candidate_count: int = 0
    clear_conversation_skill: bool = False


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

    normalized_text = _normalize_for_skill_match(text)
    question_like = normalized_text.endswith(("?", "？")) or normalized_text.startswith(
        ("为什么", "如何", "怎么", "是否", "是不是", "能不能", "可不可以", "what", "why", "how")
    )
    workflow_verbs = (
        "生成", "准备", "制作", "输出", "导出", "起草", "撰写", "编写", "整理", "形成", "创建",
        "写一份", "写一个", "做一份", "做一个", "prepare", "create", "generate", "make", "draft", "write",
    )
    deliverable_terms = (
        "ppt", "pptx", "deck", "战略", "提案", "建议书", "客户方案", "商业案例",
        "路线图", "roadmap", "proposal", "brief", "digital strategy", "business case",
    )
    if not question_like and any(term in text for term in workflow_verbs) and any(term in text for term in deliverable_terms):
        return SkillActivationDecision(
            True,
            "selected_skill_workflow_request",
            0.9,
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


_CONVERSATION_SKILL_RELEASE_TERMS = (
    "不用这个skill",
    "不要用这个skill",
    "不用该skill",
    "不要用该skill",
    "不用这个技能",
    "不要用这个技能",
    "退出skill",
    "退出技能",
    "关闭skill",
    "关闭技能",
    "普通对话",
    "withouttheskill",
    "stopusingtheskill",
    "disabletheskill",
)

_CONVERSATION_SKILL_NEW_TOPIC_TERMS = (
    "换个话题",
    "换一个话题",
    "另一个问题",
    "另外一个问题",
    "顺便问一下",
    "无关的问题",
    "newtopic",
    "anotherquestion",
    "unrelatedquestion",
)

_CONVERSATION_SKILL_CONTINUATION_TERMS = (
    "继续",
    "接着",
    "沿用",
    "按刚才",
    "按照刚才",
    "基于刚才",
    "在刚才基础上",
    "补充",
    "完善",
    "再加",
    "再补",
    "继续处理",
    "continue",
    "keepgoing",
    "sameformat",
    "followup",
    "reviseit",
    "updateit",
)


def decide_conversation_skill_activation(content: str, skill: Skill | None) -> SkillActivationDecision:
    """Decide whether a conversation-associated Skill belongs on this turn.

    A persisted ``Conversation.skill_id`` is continuity metadata, not permanent
    authorization to inject that Skill into every later prompt.  The Skill is
    reused only for an explicit/current mention, a clearly relevant workflow,
    or continuation language.  Topic changes and unrelated turns release it so
    later messages cannot silently inherit stale instructions.

    Adapted from the per-turn selection boundary in OpenAI Codex
    ``codex-rs/skills/src/selection.rs`` and
    ``codex-rs/core/src/session/turn.rs`` (pinned upstream commit documented in
    ``THIRD_PARTY_NOTICES.md``).  Aria keeps its own database-backed catalog and
    deterministic router; no Codex runtime or protocol is used.
    """
    if not skill:
        return SkillActivationDecision(False, "no_conversation_skill", 0.0, source="conversation")

    skill_id = getattr(skill, "id", None)
    skill_name = getattr(skill, "name", "") or ""
    normalized_text = _normalize_for_skill_match(content)
    base = {
        "source": "conversation",
        "candidate_skill_id": skill_id,
        "candidate_skill_name": skill_name,
    }
    if not normalized_text:
        return SkillActivationDecision(
            False,
            "conversation_skill_empty_turn",
            0.0,
            clear_conversation_skill=True,
            **base,
        )

    if any(term in normalized_text for term in _CONVERSATION_SKILL_RELEASE_TERMS):
        return SkillActivationDecision(
            False,
            "conversation_skill_released_by_user",
            1.0,
            clear_conversation_skill=True,
            **base,
        )

    if any(term in normalized_text for term in _CONVERSATION_SKILL_NEW_TOPIC_TERMS):
        return SkillActivationDecision(
            False,
            "conversation_skill_new_topic",
            0.98,
            clear_conversation_skill=True,
            **base,
        )

    normalized_name = _normalize_for_skill_match(skill_name)
    if normalized_name and normalized_name in normalized_text:
        return SkillActivationDecision(
            True,
            "conversation_skill_explicit_mention",
            0.98,
            **base,
        )

    if any(term in normalized_text for term in _CONVERSATION_SKILL_CONTINUATION_TERMS):
        return SkillActivationDecision(
            True,
            "conversation_skill_continuation",
            0.9,
            **base,
        )

    score, reason = skill_auto_match_score(content, skill)
    if score >= 82:
        return SkillActivationDecision(
            True,
            f"conversation_skill_relevant:{reason}",
            score / 100,
            **base,
        )

    return SkillActivationDecision(
        False,
        "conversation_skill_not_relevant",
        0.9,
        clear_conversation_skill=True,
        **base,
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
    (("咨询提案", "proposal"), ("提案", "建议书", "proposal", "sow", "商业案例", "报价方案", "客户方案", "方案沟通", "客户沟通", "沟通材料")),
    (("consulting-proposal-advisor", "proposal advisor"), ("提案", "建议书", "proposal", "sow", "商业案例", "报价", "客户方案", "方案沟通", "客户沟通", "沟通材料")),
    (("数字化战略", "digital"), ("数字化战略", "数字化转型", "转型战略", "digital strategy")),
    (("digital-strategy", "digital strategy"), ("数字化战略", "数字化转型", "转型路线图", "数字化蓝图", "top-level design")),
    (("ai-strategy", "ai strategy"), ("ai战略", "ai 战略", "人工智能战略", "ai roadmap", "ai转型")),
    (("根因", "root"), ("根因", "根因分析", "root cause")),
    (("复盘", "retro"), ("复盘", "经验教训", "lessons learned")),
    (("访谈", "interview"), ("访谈", "访谈提纲", "访谈问题", "interview guide")),
    (("会前", "brief", "meeting"), ("会前", "见客户", "客户会议准备", "客户简报", "pre-meeting", "meeting prep")),
)

# High-signal professional vocabulary used to select a Skill in advisory mode
# for question-shaped turns. The generic alias table above is intentionally
# broad because it primarily routes explicit workflow requests. Questions need
# a stricter vocabulary: matching just "风险", "报告", or "PPT" must not
# silently turn a normal project question into a Skill run, while terms such as
# "重大错报风险", "GloBE", or "舞弊红旗" identify one professional method
# strongly enough to enrich a read-only answer.
_SKILL_ADVISORY_ALIAS_TERMS: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("根因分析", "root cause"), ("根因分析", "根本原因", "issue tree", "假设树")),
    (("项目启动", "project kickoff"), ("项目启动会", "项目章程", "kickoff")),
    (("项目复盘", "retrospective"), ("项目复盘", "经验教训", "lessons learned")),
    (("交付审查", "delivery review"), ("交付审查", "交付物质检", "质量审查")),
    (("财务健康", "financial health"), ("财务健康", "现金流诊断", "偿债能力")),
    (("商业案例", "roi"), ("商业案例", "roi", "投资回报", "价值测算")),
    (("ai 用例", "ai use case"), ("ai用例", "ai场景", "人工智能用例")),
    (("数字化成熟度", "digital maturity"), ("数字化成熟度", "数字成熟度")),
    (("数字化战略", "digital-strategy"), ("数字化战略", "数字化蓝图", "转型路线图")),
    (("企业架构", "archimate"), ("企业架构", "archimate", "togaf")),
    (("数据治理",), ("数据治理", "数据标准", "主数据", "数据质量")),
    (("流程数字化", "bpmn"), ("流程数字化", "bpmn", "流程建模", "泳道图")),
    (("技术路线图", "architecture"), ("技术路线图", "系统架构", "技术架构")),
    (("组织变革", "change management"), ("组织变革", "变革管理", "利益相关方阻力")),
    (("风险评估矩阵",), ("风险矩阵", "风险热力图", "可能性影响度")),
    (("合规差距",), ("合规差距", "差距分析", "合规缺口")),
    (("okr", "目标定义", "goal-definition"), ("okr", "目标拆解", "smart目标", "成功标准")),
    (("客户细分",), ("客户细分", "客户画像", "客群画像")),
    (("gtm", "上市策略"), ("gtm", "上市策略", "市场进入策略")),
    (("会议纪要", "meeting-intelligence"), ("会议纪要", "会议行动项", "会议决策", "访谈纪要")),
    (("审计计划", "audit-risk-assessment"), ("重大错报风险", "审计风险评估", "isa315", "审计计划")),
    (("实质性程序", "audit-substantive-procedures"), ("实质性程序", "细节测试", "函证程序", "审计抽样")),
    (("审计报告", "audit-report-draft"), ("审计意见", "关键审计事项", "强调事项段", "isa700")),
    (("集团审计", "group-audit"), ("集团审计", "组成部分审计", "isa600")),
    (("年度审计计划", "internal-audit-annual-plan"), ("审计宇宙", "年度内审计划", "内审资源分配")),
    (("内审项目执行", "internal-audit-execution"), ("内审工作底稿", "内部审计程序", "审计发现评级")),
    (("sox",), ("sox404", "sox 404", "萨班斯", "pcaob")),
    (("穿行测试", "control testing"), ("穿行测试", "控制测试", "设计有效性", "运行有效性")),
    (("it 一般控制", "itgc"), ("itgc", "it一般控制", "访问控制测试", "变更管理测试")),
    (("异常检测", "anomaly"), ("本福特定律", "异常交易", "重复付款", "关联方筛查")),
    (("esg", "assurance"), ("esg鉴证", "可持续性鉴证", "ifrs s1", "ifrs s2", "esrs")),
    (("增值税", "vat"), ("增值税", "进项税", "销项税", "留抵退税")),
    (("税收优惠", "tax incentive"), ("税收优惠", "高新技术企业", "研发费用加计扣除")),
    (("税务争议", "tax dispute"), ("税务争议", "税务稽查", "纳税评估", "反避税调查")),
    (("税务合规日历",), ("税务合规日历", "申报截止日", "汇算清缴")),
    (("并购税务尽调", "ma-tax"), ("并购税务尽调", "税务尽职调查", "税务风险敞口")),
    (("交易结构税务", "deal-structure"), ("交易结构税务", "股权收购还是资产收购", "特殊性税务处理")),
    (("并购后税务", "post-merger-tax"), ("并购后税务整合", "税务协同效应", "亏损结转利用")),
    (("转让定价", "tp-documentation"), ("转让定价", "主体文档", "本地文档", "国别报告")),
    (("预约定价", "apa"), ("预约定价安排", "apa申请", "双边apa")),
    (("跨境投资", "cross-border"), ("跨境投资税务", "控股架构税务", "cfc规则", "间接转让")),
    (("支柱二", "pillar two"), ("支柱二", "globe", "iir", "utpr", "qdmtt")),
    (("高管薪酬",), ("高管薪酬税务", "递延薪酬", "高管个税")),
    (("外派人员", "expatriate"), ("外派人员税务", "外籍人员税务", "税收居民身份", "税收抵免")),
    (("股权激励税务",), ("股权激励税务", "股票期权税务", "限制性股票税务", "rsu税务")),
    (("关税", "customs"), ("海关估价", "hs归类", "原产地规则", "关税合规")),
    (("消费税", "间接税"), ("消费税", "印花税", "房产税", "城建税")),
    (("税务数字化",), ("税务数字化", "金税四期", "税务系统选型", "自动化申报")),
    (("税务风险管理",), ("税务风险管理", "税务风险框架", "税务风险监控")),
    (("商业尽职调查", "commercial due diligence"), ("商业尽职调查", "商业尽调", "市场吸引力", "客户质量")),
    (("并购整合", "pmi"), ("并购后整合", "pmi", "day1", "百日计划")),
    (("估值", "valuation"), ("dcf", "可比公司估值", "可比交易估值", "wacc", "football field")),
    (("债务重组",), ("债务重组", "债权人谈判", "债务瀑布")),
    (("舞弊风险", "fraud"), ("舞弊风险", "舞弊红旗", "舞弊三角", "acfe")),
    (("合规调查", "investigation"), ("合规调查", "证据保全", "调查访谈", "fcpa")),
)


def is_proposal_presentation_request(content: str) -> bool:
    """Return true for proposal/client-communication requests that need a deck."""
    text = _normalize_for_skill_match(content)
    if not text:
        return False
    presentation_terms = ("ppt", "pptx", "powerpoint", "deck", "演示文稿", "幻灯片")
    proposal_terms = (
        "方案沟通",
        "客户沟通",
        "沟通方案",
        "沟通材料",
        "客户方案",
        "方案建议",
        "提案",
        "建议书",
        "售前方案",
        "汇报方案",
        "项目方案",
    )
    return any(term in text for term in presentation_terms) and any(term in text for term in proposal_terms)


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
    if is_proposal_presentation_request(content) and any(
        marker in haystack
        for marker in ("consulting-proposal-advisor", "proposaladvisor", "咨询提案", "提案", "建议书")
    ):
        return 94, "proposal_presentation_intent"

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

    for skill_markers, request_terms in _SKILL_ADVISORY_ALIAS_TERMS:
        if any(_normalize_for_skill_match(marker) in haystack for marker in skill_markers):
            matched_terms = [
                term for term in request_terms
                if _normalize_for_skill_match(term)
                and _normalize_for_skill_match(term) in text
            ]
            if matched_terms:
                score = 94 if len(matched_terms) >= 2 else 90
                if score > best_score:
                    best_score = score
                    best_reason = f"professional_alias:{matched_terms[0]}"

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


def published_skill_catalog_fingerprint(skills: list[Skill]) -> str:
    """Fingerprint only DB-published selection metadata, never local root state."""
    payload = [
        {
            "id": skill.id,
            "name": skill.name or "",
            "description": skill.description or "",
            "category": skill.category or "",
            "builtin_key": skill.builtin_key or "",
            "builtin_hash": skill.builtin_hash or "",
            "package_version": skill.package_version or "",
            "package_status": skill.package_status or "",
            "package_sha256": skill.package_sha256 or "",
        }
        for skill in sorted(
            skills,
            key=lambda item: (
                _normalize_for_skill_match(item.name),
                int(item.id or 0),
            ),
        )
    ]
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def rank_published_skill_candidates(
    content: str,
    skills: list[Skill],
    *,
    limit: int = 3,
) -> tuple[tuple[dict, ...], str]:
    """Rank intent candidates deterministically from Aria's published DB rows."""
    scored: list[tuple[int, str, Skill]] = []
    for skill in skills:
        score, reason = skill_auto_match_score(content, skill)
        if score > 0:
            scored.append((score, reason, skill))
    scored.sort(
        key=lambda item: (
            -item[0],
            _normalize_for_skill_match(item[2].name),
            int(item[2].id or 0),
        )
    )
    rankings = tuple(
        {
            "skill_id": skill.id,
            "skill_name": skill.name,
            "score": score,
            "reason": reason,
        }
        for score, reason, skill in scored[: max(1, limit)]
    )
    return rankings, published_skill_catalog_fingerprint(skills)


def auto_select_skill(session: Session, req: SendMessageRequest) -> tuple[Skill | None, SkillActivationDecision]:
    """Infer a Skill for project chat when the request is a high-confidence workflow."""
    if req.skill_id or req.force_skill or not req.project_id:
        return None, SkillActivationDecision(False, "no_auto_skill_scope", 0.0, source="auto")
    text = (req.content or "").strip()
    if not text:
        return None, SkillActivationDecision(False, "empty_message", 0.0, source="auto")

    candidates = list(
        session.exec(select(Skill).where(Skill.package_status != "deprecated")).all()
    )
    catalog_fingerprint = published_skill_catalog_fingerprint(candidates)
    normalized_text = _normalize_for_skill_match(text)
    looks_like_question = normalized_text.endswith(("?", "？")) or normalized_text.startswith(
        ("为什么", "如何", "怎么", "是否", "是不是", "能不能", "可不可以", "what", "why", "how")
    )
    top_candidates, catalog_fingerprint = rank_published_skill_candidates(
        text,
        candidates,
        limit=3,
    )
    candidate_by_id = {skill.id: skill for skill in candidates}

    if top_candidates:
        best = top_candidates[0]
        best_score = int(best["score"])
        best_reason = str(best["reason"])
        best_skill = candidate_by_id.get(best["skill_id"])
        if best_skill is None:
            return None, SkillActivationDecision(
                False,
                "auto_skill_candidate_disappeared",
                0.0,
                source="auto",
                top_candidates=top_candidates,
                catalog_fingerprint=catalog_fingerprint,
                candidate_count=len(candidates),
            )
        tied_top = [candidate for candidate in top_candidates if candidate["score"] == best_score]
        if looks_like_question:
            second_score = int(top_candidates[1]["score"]) if len(top_candidates) > 1 else 0
            advisory_ambiguous = len(tied_top) > 1 or (
                second_score >= 88 and best_score - second_score < 4
            )
            if best_score >= 88 and advisory_ambiguous:
                return None, SkillActivationDecision(
                    False,
                    "auto_skill_ambiguous_advisory_match",
                    best_score / 100,
                    source="auto",
                    candidate_skill_id=best_skill.id,
                    candidate_skill_name=best_skill.name,
                    top_candidates=top_candidates,
                    catalog_fingerprint=catalog_fingerprint,
                    candidate_count=len(candidates),
                )
            if best_score >= 88:
                return best_skill, SkillActivationDecision(
                    True,
                    f"auto_skill_advisory_match:{best_skill.name}:{best_reason}",
                    best_score / 100,
                    source="auto",
                    candidate_skill_id=best_skill.id,
                    candidate_skill_name=best_skill.name,
                    top_candidates=top_candidates,
                    catalog_fingerprint=catalog_fingerprint,
                    candidate_count=len(candidates),
                )
            return None, SkillActivationDecision(
                False,
                "auto_skill_skipped_question",
                best_score / 100,
                source="auto",
                candidate_skill_id=best_skill.id,
                candidate_skill_name=best_skill.name,
                top_candidates=top_candidates,
                catalog_fingerprint=catalog_fingerprint,
                candidate_count=len(candidates),
            )
        if best_score >= 82 and len(tied_top) > 1:
            return None, SkillActivationDecision(
                False,
                "auto_skill_ambiguous_match",
                best_score / 100,
                source="auto",
                candidate_skill_id=best_skill.id,
                candidate_skill_name=best_skill.name,
                top_candidates=top_candidates,
                catalog_fingerprint=catalog_fingerprint,
                candidate_count=len(candidates),
            )
        if best_score >= 82:
            return best_skill, SkillActivationDecision(
                True,
                f"auto_skill_match:{best_skill.name}:{best_reason}",
                best_score / 100,
                source="auto",
                candidate_skill_id=best_skill.id,
                candidate_skill_name=best_skill.name,
                top_candidates=top_candidates,
                catalog_fingerprint=catalog_fingerprint,
                candidate_count=len(candidates),
            )
        return None, SkillActivationDecision(
            False,
            "auto_skill_no_confident_match",
            best_score / 100,
            source="auto",
            candidate_skill_id=best_skill.id,
            candidate_skill_name=best_skill.name,
            top_candidates=top_candidates,
            catalog_fingerprint=catalog_fingerprint,
            candidate_count=len(candidates),
        )

    return None, SkillActivationDecision(
        False,
        "auto_skill_skipped_question" if looks_like_question else "auto_skill_no_match",
        0.0,
        source="auto",
        catalog_fingerprint=catalog_fingerprint,
        candidate_count=len(candidates),
    )
