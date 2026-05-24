"""Consulting deliverable capability catalog.

This module is intentionally data-first.  The chat router and orchestrator can
ask "what kind of consulting artifact is the user asking for?" without baking
every scenario into one long chain of keyword branches.
"""
from __future__ import annotations

import re
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


@dataclass(frozen=True)
class CapabilityProtocol:
    """Execution contract for a consulting capability.

    The protocol is intentionally separate from route decisions: once a
    capability is matched, the same sections, rules and validation expectations
    apply whether the final path is direct answer, text artifact, or a richer
    orchestrated flow.
    """

    capability_id: str
    name: str
    artifact_kind: ArtifactKind
    title: str
    required_sections: tuple[str, ...]
    quality_rules: tuple[str, ...]
    min_chapter_count: int = 0
    requires_hierarchy: bool = False


@dataclass(frozen=True)
class CapabilityValidationResult:
    ok: bool
    errors: tuple[str, ...] = ()


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


def clean_requested_heading(value: str) -> str:
    heading = re.sub(r"\s+", "", str(value or "").strip())
    heading = re.sub(r"^(请)?(输出|包含|包括|提供|生成|整理)[:：]?", "", heading)
    return heading.strip(" ：:，,。；;、")


def extract_requested_headings(text: str, *, limit: int = 8) -> tuple[str, ...]:
    requested: list[str] = []
    pattern = r"(?:^|[：:；;，,\n]\s*)(?:\d{1,2}|[一二三四五六七八九十])\s*[）).、]\s*([^；;\n]+)"
    for match in re.finditer(pattern, text or ""):
        heading = clean_requested_heading(match.group(1))
        if 2 <= len(heading) <= 28 and heading not in requested:
            requested.append(heading)
    return tuple(requested[:limit])


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


def build_capability_protocol(
    content: str,
    capability: ConsultingCapability,
    *,
    requested_headings: tuple[str, ...] | None = None,
    requested_chapter_count: int = 0,
) -> CapabilityProtocol:
    explicit_headings = requested_headings if requested_headings is not None else extract_requested_headings(content)
    required_sections = explicit_headings or capability.default_sections
    min_chapter_count = max(int(requested_chapter_count or 0), int(capability.default_chapter_count or 0))
    return CapabilityProtocol(
        capability_id=capability.id,
        name=capability.name,
        artifact_kind=capability.artifact_kind,
        title=capability.default_title,
        required_sections=tuple(required_sections),
        quality_rules=capability.quality_rules,
        min_chapter_count=min_chapter_count,
        requires_hierarchy=capability.requires_hierarchy,
    )


def capability_output_schema_markdown(protocol: CapabilityProtocol) -> str:
    lines = [f"# {protocol.title}"]
    for section in protocol.required_sections:
        lines.append(f"## {section}")
    if protocol.min_chapter_count:
        lines.append(f"至少 {protocol.min_chapter_count} 个一级章节")
    if protocol.requires_hierarchy:
        lines.append("必须包含一级目录和二级目录")
    return "\n".join(lines)


def validate_capability_markdown(
    *,
    title: str,
    content: str,
    protocol: CapabilityProtocol | None,
) -> CapabilityValidationResult:
    if protocol is None:
        return CapabilityValidationResult(ok=True)

    errors: list[str] = []
    text = content or ""
    for section in protocol.required_sections:
        if protocol.requires_hierarchy:
            continue
        if f"## {section}" not in text:
            errors.append(f"缺少章节：{section}")

    if protocol.min_chapter_count:
        chapter_count = len(re.findall(r"^# \d{2}\. ", text, flags=re.MULTILINE))
        if chapter_count < protocol.min_chapter_count:
            errors.append(f"一级章节数不足：需要至少 {protocol.min_chapter_count} 个，当前 {chapter_count} 个")

    if protocol.requires_hierarchy:
        h1_count = len(re.findall(r"^# \d{2}\. ", text, flags=re.MULTILINE))
        h2_count = len(re.findall(r"^## \d+\.\d+ ", text, flags=re.MULTILINE))
        if h1_count <= 0 or h2_count <= 0:
            errors.append("缺少一级/二级目录层级")

    correction_terms = ("不行", "重新", "修正", "改一下", "至少", "需要1级", "需要一级")
    if any(term in title for term in correction_terms):
        errors.append("标题包含用户纠错语或操作指令")

    return CapabilityValidationResult(ok=not errors, errors=tuple(errors))


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
