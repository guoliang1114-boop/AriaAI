"""Consulting deliverable capability catalog.

This module is intentionally data-first.  The chat router and orchestrator can
ask "what kind of consulting artifact is the user asking for?" without baking
every scenario into one long chain of keyword branches.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


ArtifactKind = Literal["md", "pptx", "xlsx", "docx", "pdf"]


@dataclass(frozen=True)
class ConsultingCapability:
    id: str
    name: str
    description: str
    artifact_kind: ArtifactKind
    trigger_terms: tuple[str, ...]
    default_title: str
    default_sections: tuple[str, ...]
    quality_rules: tuple[str, ...] = ()
    default_chapter_count: int = 0
    requires_hierarchy: bool = False


CONSULTING_CAPABILITIES: tuple[ConsultingCapability, ...] = (
    ConsultingCapability(
        id="client_meeting_brief",
        name="客户会议准备",
        description="开场话术、议题顺序、关键人表达方式和会后行动清单。",
        artifact_kind="md",
        trigger_terms=("客户会议", "会议准备", "开场话术", "关键议题", "议题顺序", "会后行动", "关键人", "表达方式"),
        default_title="客户会议准备",
        default_sections=("开场话术", "关键议题顺序", "每个关键人应关注的表达方式", "会后行动清单"),
        quality_rules=("必须覆盖用户指定模块", "避免泛化项目背景模板", "行动项要可执行"),
    ),
    ConsultingCapability(
        id="consulting_storyline",
        name="咨询故事线大纲",
        description="一级章节与二级目录组成的咨询叙事结构。",
        artifact_kind="md",
        trigger_terms=("故事线", "storyline", "大纲", "一级目录", "二级目录", "章节", "目录结构", "沟通框架"),
        default_title="客户战略沟通故事线大纲",
        default_sections=(
            "项目背景与沟通目标",
            "客户现状与战略动因",
            "赛道机会与市场吸引力",
            "客户适配度假设",
            "进入机会判断框架",
            "关键分歧与敏感风险",
            "进入路径与方案选项",
            "最小验证计划",
            "客户会议沟通方式",
            "会后行动与下一阶段交付",
        ),
        quality_rules=("至少包含用户要求的章节数", "必须有一级和二级目录", "标题不能包含用户纠错语"),
        default_chapter_count=10,
        requires_hierarchy=True,
    ),
    ConsultingCapability(
        id="interview_guide",
        name="访谈提纲",
        description="访谈对象、访谈目标、核心问题、追问和记录字段。",
        artifact_kind="md",
        trigger_terms=("访谈提纲", "访谈问题", "访谈清单", "interview guide", "客户访谈"),
        default_title="客户访谈提纲",
        default_sections=("访谈目标", "访谈对象分层", "核心问题", "追问问题", "记录与输出格式"),
        quality_rules=("问题要服务于决策", "区分事实问题、判断问题和行动问题"),
    ),
    ConsultingCapability(
        id="issue_tree",
        name="问题树拆解",
        description="用 MECE 方式拆解核心问题、二级议题和验证点。",
        artifact_kind="md",
        trigger_terms=("问题树", "议题树", "issue tree", "mece", "拆解问题", "拆问题"),
        default_title="问题树拆解",
        default_sections=("核心问题", "一级议题", "二级议题", "验证假设", "所需资料"),
        quality_rules=("层级互斥且穷尽", "每个议题对应验证方式"),
    ),
    ConsultingCapability(
        id="hypothesis_tree",
        name="假设树",
        description="把战略判断拆成可验证假设、证据和判定标准。",
        artifact_kind="md",
        trigger_terms=("假设树", "假设清单", "hypothesis", "验证假设", "待验证"),
        default_title="假设树与验证计划",
        default_sections=("核心判断", "关键假设", "验证证据", "判定标准", "优先级"),
        quality_rules=("每个假设必须可验证", "明确数据来源和判定标准"),
    ),
    ConsultingCapability(
        id="research_plan",
        name="桌面研究计划",
        description="研究主题、信息源、验证路径和输出格式。",
        artifact_kind="md",
        trigger_terms=("桌面研究", "研究计划", "资料收集", "信息源", "desk research"),
        default_title="桌面研究计划",
        default_sections=("研究目标", "研究问题", "信息源", "验证路径", "输出格式"),
        quality_rules=("研究问题要和决策相关", "信息源要分层"),
    ),
    ConsultingCapability(
        id="opportunity_assessment",
        name="机会评估",
        description="从吸引力、适配度、进入难度和验证成本评估机会。",
        artifact_kind="md",
        trigger_terms=("机会评估", "进入机会", "机会判断", "opportunity", "优先级排序"),
        default_title="机会评估框架",
        default_sections=("机会定义", "赛道吸引力", "客户适配度", "进入难度", "验证成本", "优先级建议"),
        quality_rules=("不要只描述机会，要给判断标准", "必须给下一步验证动作"),
    ),
    ConsultingCapability(
        id="strategic_options",
        name="战略选项设计",
        description="方案 A/B/C、适用条件、利弊和推荐路径。",
        artifact_kind="md",
        trigger_terms=("战略选项", "方案选项", "路径选项", "方案A", "方案 B", "option"),
        default_title="战略选项与推荐路径",
        default_sections=("选项总览", "方案 A", "方案 B", "方案 C", "比较维度", "推荐路径"),
        quality_rules=("每个选项必须可比较", "推荐必须说明前提条件"),
    ),
    ConsultingCapability(
        id="implementation_plan",
        name="落地计划",
        description="阶段、里程碑、责任人、依赖项、风险和 KPI。",
        artifact_kind="md",
        trigger_terms=("落地计划", "实施计划", "推进计划", "roadmap", "里程碑", "行动计划"),
        default_title="落地推进计划",
        default_sections=("阶段划分", "关键里程碑", "责任分工", "依赖条件", "风险与应对", "KPI"),
        quality_rules=("每个动作要有责任人和时间点", "风险必须绑定缓释动作"),
    ),
)


def normalize_text(value: str) -> str:
    return (value or "").strip().lower()


def match_consulting_capability(content: str) -> ConsultingCapability | None:
    """Return the best matching consulting capability for a user request."""
    text = normalize_text(content)
    if not text:
        return None

    best: tuple[int, int, ConsultingCapability] | None = None
    for index, capability in enumerate(CONSULTING_CAPABILITIES):
        score = sum(1 for term in capability.trigger_terms if term.lower() in text)
        if score <= 0:
            continue
        candidate = (score, -index, capability)
        if best is None or candidate > best:
            best = candidate
    return best[2] if best else None


def should_create_text_artifact_for_capability(content: str, capability: ConsultingCapability | None) -> bool:
    if capability is None or capability.artifact_kind != "md":
        return False
    text = normalize_text(content)
    creation_terms = (
        "准备", "生成", "创建", "制作", "输出", "导出", "整理", "梳理", "起草", "写",
        "重构", "完善", "优化", "修正", "改", "不行", "至少", "需要", "给我",
    )
    structure_terms = ("章节", "目录", "一级", "二级", "模块", "结构", "清单", "提纲", "框架")
    return any(term in text for term in creation_terms) or any(term in text for term in structure_terms)
