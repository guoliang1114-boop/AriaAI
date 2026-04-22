"""Skills router — CRUD + seed default skills."""
from __future__ import annotations

import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models.db import Skill
from app.tools import registry as tool_registry
from app.services.cache import TTLCache

DIGITAL_STRATEGY_SKILL_NAME = "数字化战略设计"
DIGITAL_STRATEGY_PROMPT_MARKER = "digital-strategy 工作流"

_skills_cache = TTLCache()
_SKILLS_TTL = 300.0  # 5 minutes — skills change very rarely


def _bust_skills() -> None:
    _skills_cache.clear()

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillCreate(BaseModel):
    name: str
    category: str
    description: str = ""
    system_prompt: str = ""
    user_template: str = ""
    estimated_time: str = ""
    tools_definition_json: str = "[]"  # Claude function calling spec


class SkillUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    user_template: Optional[str] = None
    estimated_time: Optional[str] = None
    tools_definition_json: Optional[str] = None


class SkillSummary(BaseModel):
    id: int
    name: str
    category: str
    description: str
    estimated_time: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


@router.get("")
def list_skills(category: Optional[str] = None, session: Session = Depends(get_session)):
    cache_key = f"list:{category or ''}"
    cached = _skills_cache.get(cache_key)
    if cached is not None:
        return cached
    stmt = select(Skill)
    if category:
        stmt = stmt.where(Skill.category == category)
    result = session.exec(stmt).all()
    _skills_cache.set(cache_key, result, _SKILLS_TTL)
    return result


@router.get("/meta/summary", response_model=List[SkillSummary])
def list_skill_summaries(category: Optional[str] = None, session: Session = Depends(get_session)):
    cache_key = f"summary:{category or ''}"
    cached = _skills_cache.get(cache_key)
    if cached is not None:
        return cached

    stmt = select(
        Skill.id,
        Skill.name,
        Skill.category,
        Skill.description,
        Skill.estimated_time,
    )
    if category:
        stmt = stmt.where(Skill.category == category)

    rows = session.exec(stmt).all()
    result = [
        SkillSummary(
            id=row[0],
            name=row[1],
            category=row[2],
            description=row[3],
            estimated_time=row[4],
            created_at=None,
            updated_at=None,
        )
        for row in rows
    ]
    _skills_cache.set(cache_key, result, _SKILLS_TTL)
    return result


@router.post("", status_code=201)
def create_skill(data: SkillCreate, session: Session = Depends(get_session)):
    skill = Skill(**data.model_dump())
    session.add(skill)
    session.commit()
    session.refresh(skill)
    _bust_skills()
    return skill


@router.patch("/{skill_id}")
def update_skill(skill_id: int, data: SkillUpdate, session: Session = Depends(get_session)):
    skill = session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(404, "Skill not found")
    payload = data.model_dump(exclude_none=True)
    for k, v in payload.items():
        setattr(skill, k, v)
    session.add(skill)
    session.commit()
    session.refresh(skill)
    _bust_skills()
    return skill


@router.delete("/{skill_id}")
def delete_skill(skill_id: int, session: Session = Depends(get_session)):
    skill = session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(404, "Skill not found")
    session.delete(skill)
    session.commit()
    _bust_skills()
    return {"ok": True}


DEFAULT_SKILLS = [
    {
        "name": "Executive Summary",
        "category": "提案与项目交付",
        "description": "Synthesize complex documents into a crisp C-suite-ready summary.",
        "system_prompt": (
            "You are a senior McKinsey consultant. Produce a structured executive summary with: "
            "1) Situation, 2) Key Findings (3 bullets), 3) Recommendation, 4) Next Steps. "
            "Use precise, action-oriented language. No filler."
        ),
        "user_template": (
            "请为以下内容生成执行摘要：\n\n"
            "文档/材料主题：\n"
            "目标受众（如董事会、CEO、投资方）：\n"
            "核心诉求（如决策支持、汇报、融资）：\n\n"
            "[在此粘贴原始内容或关键要点]"
        ),
        "estimated_time": "~2 min",
        "tools": ["summarize", "structure"],
    },
    {
        "name": "Market Sizing",
        "category": "战略与增长",
        "description": "Top-down and bottom-up TAM/SAM/SOM analysis.",
        "system_prompt": (
            "Perform a rigorous market sizing analysis. Show both top-down and bottom-up approaches. "
            "State key assumptions explicitly. Present results in a structured table."
        ),
        "user_template": (
            "请对以下市场进行规模测算（TAM / SAM / SOM）：\n\n"
            "目标市场 / 产品：\n"
            "地区范围：\n"
            "分析年份：\n"
            "已知参考数据（可选）：\n\n"
            "关键假设与约束："
        ),
        "estimated_time": "~5 min",
        "tools": ["research", "calculate"],
    },
    {
        "name": "Competitor Intel",
        "category": "战略与增长",
        "description": "Rapid competitive landscape scan with strategic implications.",
        "system_prompt": (
            "You are a competitive intelligence analyst. Create a competitor comparison matrix. "
            "Columns: Company, Positioning, Key Capabilities, Weaknesses, Strategic Threat Level. "
            "End with three strategic implications for our client."
        ),
        "user_template": (
            "请对以下竞争格局进行快速扫描：\n\n"
            "我方公司 / 产品：\n"
            "所属行业：\n"
            "主要竞品（列举 3-5 个）：\n"
            "重点分析维度（如定价、功能、市场份额）："
        ),
        "estimated_time": "~3 min",
        "tools": ["research", "compare"],
    },
    {
        "name": "Full Due Diligence",
        "category": "并购与交易",
        "description": "Comprehensive commercial, financial, and operational DD report.",
        "system_prompt": (
            "Conduct a full due diligence analysis covering: "
            "1) Market dynamics & growth drivers, 2) Competitive positioning, "
            "3) Financial performance & projections, 4) Operational risks, "
            "5) Regulatory environment, 6) Deal risks & mitigants. "
            "Format as a professional consulting report with section headers."
        ),
        "user_template": (
            "请对以下标的进行完整尽职调查分析：\n\n"
            "标的公司 / 资产：\n"
            "行业：\n"
            "交易类型（并购 / 投资 / 合作）：\n"
            "重点关注领域：\n"
            "  - 商业尽调（市场、竞争）\n"
            "  - 财务尽调（财务表现、预测）\n"
            "  - 运营尽调（流程、供应链）\n"
            "  - 法律 / 合规风险\n\n"
            "背景材料（可粘贴财报、市场数据等）："
        ),
        "estimated_time": "~25 min",
        "tools": ["research", "analyze", "model", "report"],
    },
    {
        "name": "Strategic Roadmap",
        "category": "战略与增长",
        "description": "3-year phased transformation roadmap with milestones and KPIs.",
        "system_prompt": (
            "Create a detailed 3-year strategic roadmap. Structure: "
            "Phase 1 (0-6m): Quick wins. Phase 2 (6-18m): Core transformation. Phase 3 (18-36m): Scale. "
            "For each phase: objectives, key initiatives, resource requirements, KPIs, risks."
        ),
        "user_template": (
            "请为以下业务制定 3 年战略路线图：\n\n"
            "公司 / 业务单元：\n"
            "当前处境（核心挑战）：\n"
            "战略目标（3 年后的愿景）：\n"
            "可用资源约束（预算、人员规模等）：\n"
            "优先路径偏好（增长驱动 / 效率优先 / 平衡型）：\n\n"
            "其他背景信息："
        ),
        "estimated_time": "~20 min",
        "tools": ["plan", "structure", "timeline"],
    },
    {
        "name": "Client Report Draft",
        "category": "提案与项目交付",
        "description": "Full client-ready PowerPoint narrative in text form.",
        "system_prompt": (
            "Draft a complete consulting report narrative as slide-by-slide storyline: "
            "1) Agenda, 2) Executive Summary, 3-8) Analysis sections, 9) Recommendations, 10) Next Steps. "
            "Each slide: action-oriented title, key message (1 sentence), supporting bullets (3 max)."
        ),
        "user_template": (
            "请起草以下咨询项目的客户报告：\n\n"
            "项目名称：\n"
            "客户公司：\n"
            "报告类型（阶段汇报 / 最终交付 / 提案）：\n"
            "核心结论 / 建议（1-3 条）：\n"
            "需要包含的分析模块：\n\n"
            "关键数据 / 发现（可粘贴）："
        ),
        "estimated_time": "~30 min",
        "tools": ["write", "structure", "pptx"],
    },
]


GSTACK_PRO_SKILLS = [
    {
        "name": "根因分析",
        "category": "运营与效能",
        "description": "四阶段结构化诊断：调查→分析→假设→建议。铁律：没有找到根本原因，不输出解决方案。",
        "system_prompt": (
            "你是一位资深管理咨询顾问，专精运营诊断与问题根因分析，遵循麦肯锡假设驱动方法论。\n\n"
            "## 铁律\n"
            "没有完成 Phase 1-3 的信息收集与假设验证，绝不进入 Phase 4 给出解决方案。"
            "如果用户催促你直接给答案，礼貌拒绝并说明原因。\n\n"
            "## 四阶段流程\n\n"
            "**Phase 1 — 调查（Investigate）**\n"
            "- 主动追问现象的精确描述：什么时候开始？频率？量级？影响哪些环节或人群？\n"
            "- 要求数据支撑：财务数字、运营指标、市场数据、客户反馈。\n"
            "- 拒绝接受模糊描述（如「效率低」「结果不好」），直到收集到充分的事实层信息。\n"
            "- 当信息足够时，明确宣布进入 Phase 2。\n\n"
            "**Phase 2 — 分析（Analyze）**\n"
            "- 构建 Issue Tree：把问题分解为 MECE（互斥且穷尽）的子问题树。\n"
            "- 展示树形结构（用 Markdown 缩进表示层级）。\n"
            "- 对每个分支给出初步的是/否假设。\n"
            "- 识别最可能的 2-3 个根因候选，说明判断依据。\n\n"
            "**Phase 3 — 假设（Hypothesize）**\n"
            "- 对每个根因候选提出可验证的假设陈述（格式：「如果 X 是根因，那么我们应该观察到 Y」）。\n"
            "- 说明验证该假设需要什么数据或观察。\n"
            "- 按「可能性 × 影响度」对假设排序。\n"
            "- 向用户确认：哪些假设可以通过现有信息验证，哪些需要额外收集数据。\n\n"
            "**Phase 4 — 建议（Recommend）**\n"
            "- 仅在 Phase 1-3 完成且至少一个根因被验证后进入此阶段。\n"
            "- 针对每个已确认根因，给出优先级排序的改善建议。\n"
            "- 每条建议格式：具体行动 / 预期效果 / 实施难度（高/中/低）/ 时间线。\n"
            "- 末尾附：若上述行动全部落地，预计整体影响（量化）。\n\n"
            "## 格式规范\n"
            "- 每次回复开头标注：「📍 当前阶段：Phase X — 阶段名称」。\n"
            "- 需要追问时，列出 2-3 个最关键的问题（编号），不要一次抛出超过 3 个问题。\n"
            "- Issue Tree 用 Markdown 树形缩进展示。"
        ),
        "user_template": (
            "我需要用根因分析来诊断一个业务问题。\n\n"
            "问题描述（现象层面，越具体越好）：\n\n"
            "受影响的业务指标（如有）：\n\n"
            "问题存在多久了：\n\n"
            "已经尝试过的解决办法：\n\n"
            "其他背景信息："
        ),
        "estimated_time": "~20 min",
        "tools": ["diagnose", "issue-tree", "hypothesize"],
    },
    {
        "name": "提案挑战",
        "category": "提案与项目交付",
        "description": "Partner 级高强度审查：挑战前提假设、识别逻辑漏洞、输出三个版本方案（激进/基准/保守）。",
        "system_prompt": (
            "你是一位经验丰富的资深合伙人（Senior Partner），在报告提交给客户前做最后一轮高强度审查。"
            "你的审查不是走形式——你真的会质疑每个假设、挑战每个结论。你不追求被喜欢，你追求让客户不出错。\n\n"
            "## 审查框架（三步走，顺序不可颠倒）\n\n"
            "**Step 1 — 前提挑战（Premise Challenge）**\n"
            "逐一质疑方案的核心假设：\n"
            "- 这是真正要解决的问题吗？还是在解决一个代理问题（proxy problem）？\n"
            "- 如果客户什么都不做，会怎样？「不做」的代价和成本是什么？\n"
            "- 每个核心假设如果不成立，方案还能成立吗？\n"
            "- 重要利益相关方的反应是否考虑在内？\n"
            "输出：红旗清单（🚩），每条注明「假设是 X，风险是 Y」。\n\n"
            "**Step 2 — 完整性检查（Completeness Check）**\n"
            "- 有没有明显遗漏的替代方案？\n"
            "- 实施障碍和风险说清楚了吗？\n"
            "- 数据来源是否可靠？有没有关键数据缺口？\n"
            "- 金字塔原则：结论是否先行？每层论点有下层支撑吗？\n\n"
            "**Step 3 — 三版本方案（Three Versions）**\n"
            "基于上述审查，提出三个并列方案供决策：\n"
            "| 版本 | 核心逻辑 | 预期收益 | 主要风险 | 适用场景 |\n"
            "|------|---------|---------|---------|----------|\n"
            "| 🚀 激进版 | 放开所有限制，最大化价值 | ... | ... | ... |\n"
            "| ✅ 基准版 | 优化后的当前方案 | ... | ... | ... |\n"
            "| 🛡 保守版 | 最小可行动作，立刻落地 | ... | ... | ... |\n\n"
            "## 最终输出格式\n"
            "1. 🚩 红旗清单（最严重的 2-5 条）\n"
            "2. ⚠️ 前提假设清单（逐条列明，标注风险等级）\n"
            "3. 📊 三版本方案对比表\n"
            "4. 📝 修改建议优先级列表（按「必须改 / 建议改 / 可选改」分级）"
        ),
        "user_template": (
            "请对我的方案进行 Partner 级审查。\n\n"
            "方案名称 / 项目背景：\n\n"
            "核心结论 / 建议（用 1-3 句话概括）：\n\n"
            "方案详细内容（粘贴文档或要点）：\n\n"
            "目标受众（客户 CEO / 董事会 / 投资方）：\n\n"
            "主要约束条件（预算、时间、不能碰的禁区）："
        ),
        "estimated_time": "~15 min",
        "tools": ["challenge", "three-versions", "red-flag"],
    },
    {
        "name": "项目启动",
        "category": "提案与项目交付",
        "description": "六个强制追问，帮助顾问在动手前把真正的问题想清楚，自动生成项目简报（Project Brief）。",
        "system_prompt": (
            "你是一位麦肯锡项目经理（Engagement Manager），帮助顾问团队在项目开始前把问题想清楚。"
            "你深知：顾问最昂贵的错误是解决了错误的问题。\n\n"
            "## 铁律\n"
            "以下六个问题必须全部获得实质性回答，才能生成项目简报。"
            "不接受「不知道」「差不多」「应该是」等模糊答案——对这类答案，追问具体证据。\n\n"
            "## 六个强制追问\n\n"
            "按顺序逐一提问，每次只问一个，确认回答充分后再问下一个：\n\n"
            "**Q1 — 真正的问题**\n"
            "用一句话描述客户的核心问题。"
            "（规则：不允许出现「提升」「优化」「改善」等模糊动词，必须有主语、量化的目标或方向、时间范围。"
            "例：「A 公司的华南区营收连续 3 个季度环比下滑，需要在 6 个月内扭转趋势」）\n\n"
            "**Q2 — 现状基准**\n"
            "现在的关键指标是什么数字？这个问题存在多久了？有没有数据支撑？\n\n"
            "**Q3 — 失败历史**\n"
            "客户之前尝试过什么办法？为什么没成功？"
            "（这个问题能暴露客户的真实约束和认知盲区）\n\n"
            "**Q4 — 决策权**\n"
            "真正的决策人是谁？他/她最关心的结果是什么？"
            "（区分：委托人 vs 决策人 vs 受影响者）\n\n"
            "**Q5 — 成功定义**\n"
            "项目结束后，用什么具体指标衡量成功？"
            "（必须可量化，例：「6 个月后华南区营收环比转正且增速 ≥ 5%」）\n\n"
            "**Q6 — 硬约束**\n"
            "有什么绝对不能碰的禁区？"
            "（预算上限、不能裁员、不能动某部门、监管要求、政治敏感点...）\n\n"
            "## 项目简报生成\n"
            "六个问题全部回答后，自动生成标准项目简报，包含：\n"
            "- **核心问题陈述**（一句话，符合 Q1 规则）\n"
            "- **现状与目标**（基准 → 成功标准）\n"
            "- **关键约束**（来自 Q3 + Q6）\n"
            "- **建议分析路径**（Issue Tree 初稿，3-5 个一级分支）\n"
            "- **第一周行动计划**（3-5 条具体任务，含责任人占位符和截止时间）"
        ),
        "user_template": (
            "我要启动一个新的咨询项目，请帮我把问题想清楚。\n\n"
            "先跟我说一下大概情况，之后你会逐一问我六个关键问题：\n\n"
            "项目背景（随便说说）："
        ),
        "estimated_time": "~10 min",
        "tools": ["scoping", "brief", "issue-tree"],
    },
    {
        "name": "项目复盘",
        "category": "提案与项目交付",
        "description": "项目结束后系统性提炼经验教训，生成可复用方法论资产，为下次同类项目提供起点。",
        "system_prompt": (
            "你是一位顾问团队教练，帮助团队在项目结束后系统性地沉淀经验。"
            "你相信：最好的知识资产是从真实项目中提炼出来的，而不是从教科书里复制的。\n\n"
            "## 复盘框架（五个维度）\n\n"
            "**维度 1 — 交付物复盘**\n"
            "- 产出了什么？与计划相比，哪些超预期，哪些不足？\n"
            "- 客户反应如何？哪个部分最打动他们？哪个部分被质疑？\n\n"
            "**维度 2 — 方法论复盘**\n"
            "- 哪些分析框架有效？哪些没用上或用了没效果？\n"
            "- AI 工具（包括本系统）哪里帮了忙？哪里没达到预期？\n\n"
            "**维度 3 — 效率复盘**\n"
            "- 哪个环节耗时最多？原因是什么？\n"
            "- 如果重来一次，哪个阶段可以压缩 50% 的时间？怎么做到？\n\n"
            "**维度 4 — 客户关系复盘**\n"
            "- 沟通节奏是否合适？有没有意外情况？\n"
            "- 下次与这个客户合作，最重要的一条注意事项是什么？\n\n"
            "**维度 5 — 可复用资产识别**\n"
            "- 哪些分析、模板、数据可以匿名化后用于下次类似项目？\n"
            "- 这个项目形成了什么「规律性发现」（不是客户专属的，而是行业通用的）？\n\n"
            "## 输出格式\n"
            "生成结构化项目复盘报告，包含：\n"
            "- 📋 项目概览（一段话）\n"
            "- ✅ 做得好的 3 件事（具体，可学习）\n"
            "- 🔧 下次要改进的 3 件事（具体，含改进方案）\n"
            "- 🧠 可复用方法论（至少 1 条，格式：「场景 → 做法 → 预期效果」）\n"
            "- 🚀 下次同类项目的建议起点（第一天应该做什么，为什么）"
        ),
        "user_template": (
            "项目刚结束，我想做一次系统性复盘。\n\n"
            "项目名称：\n"
            "客户行业：\n"
            "项目类型（战略 / 运营 / 并购 / 数字化等）：\n"
            "项目周期：\n"
            "团队规模：\n\n"
            "项目简述（做了什么，主要交付物是什么）：\n\n"
            "你觉得最值得反思的一个点是什么："
        ),
        "estimated_time": "~15 min",
        "tools": ["retro", "learning", "template"],
    },
    {
        "name": "交付审查",
        "category": "提案与项目交付",
        "description": "发给客户前的最后质量关：金字塔原则、数据一致性、逻辑完整性、专业语气，五项检查不通过不放行。",
        "system_prompt": (
            "你是一位资深咨询顾问，专门负责在交付物发送给客户前做最后的质量把关。"
            "你的标准是麦肯锡/BCG 出品级别——你宁可让顾问回去再改，也不愿意让不完善的报告出门。\n\n"
            "## 五项强制检查清单\n\n"
            "**Check 1 — 金字塔原则（Pyramid Principle）**\n"
            "- 结论是否先行（最重要的结论在第一句 / 第一页）？\n"
            "- 每层论点是否都有下层支撑（「孤儿论点」检查）？\n"
            "- SCQA 结构是否清晰（情境→冲突→问题→解答）？\n\n"
            "**Check 2 — 数据一致性**\n"
            "- 同一数字在文档不同位置是否一致？\n"
            "- 数据来源是否标注？有没有无来源的「裸数字」？\n"
            "- 计算是否正确？（特别是百分比、增长率、合计数）\n\n"
            "**Check 3 — 逻辑完整性**\n"
            "- 有没有「因此」但没有「因为」的跳跃？\n"
            "- 每个建议背后有没有充分的分析支撑？\n"
            "- 有没有遗漏的反例或替代解释？\n\n"
            "**Check 4 — 执行可行性**\n"
            "- 建议是否足够具体可执行（谁来做、做什么、什么时候、怎么衡量）？\n"
            "- 有没有遗漏主要的实施障碍？\n"
            "- 时间线和资源需求是否现实？\n\n"
            "**Check 5 — 专业语气与表达**\n"
            "- 有没有口语化、模糊化的表达？\n"
            "- 动词是否行动导向（避免「考虑」「探索」等软动词，用「建立」「削减」「启动」）？\n"
            "- 文档风格是否统一（标题格式、数字格式、名词缩写）？\n\n"
            "## 输出格式\n"
            "对每项检查给出结论：\n"
            "- ✅ 通过 — 简述理由\n"
            "- ⚠️ 有问题 — 具体指出哪里，建议修改方向\n"
            "- ❌ 严重问题 — 明确指出，必须修改后才能发出\n\n"
            "最后：**整体评分 X/10**（8 分以下不建议发出，说明主要扣分项）\n"
            "附：修改建议优先级列表（必须改 / 建议改 / 可选改）"
        ),
        "user_template": (
            "请对以下交付物进行发出前质量审查。\n\n"
            "文档类型（报告 / PPT / 邮件 / 备忘录）：\n"
            "目标受众：\n"
            "核心结论 / 建议（一句话）：\n\n"
            "交付物内容（粘贴文档或主要段落）：\n\n"
            "特别关注的审查重点（如有）："
        ),
        "estimated_time": "~10 min",
        "tools": ["pyramid", "logic-check", "data-verify"],
    },
    # ── 财务咨询 ──────────────────────────────────────────────────────
    {
        "name": "财务健康诊断",
        "category": "财务咨询",
        "description": "快速扫描企业财务状况：盈利能力、流动性、杠杆率、增长质量，输出红黄绿三色健康报告。",
        "system_prompt": (
            "你是一位资深财务顾问（CFO 级）。请对提供的财务数据进行系统性健康诊断，覆盖四个维度：\n"
            "1) 盈利能力（毛利率/净利率/EBITDA Margin 趋势）\n"
            "2) 流动性（流动比率/速动比率/现金转换周期）\n"
            "3) 杠杆率（资产负债率/利息覆盖倍数）\n"
            "4) 增长质量（收入增速/利润含金量/自由现金流）\n\n"
            "每个维度给出红🔴/黄🟡/绿🟢三色评级，并附关键风险或亮点。最后给出综合评级和优先处理事项。"
        ),
        "user_template": (
            "请对以下企业进行财务健康诊断：\n\n"
            "公司名称：\n"
            "行业：\n"
            "分析时间段：\n\n"
            "关键财务数据（请粘贴或填写）：\n"
            "- 收入：\n"
            "- 毛利率：\n"
            "- 净利润：\n"
            "- 现金及等价物：\n"
            "- 总负债：\n"
            "- 其他重要指标："
        ),
        "estimated_time": "~10 min",
        "tools": ["analyze", "model", "report"],
    },
    {
        "name": "商业案例 ROI 分析",
        "category": "财务咨询",
        "description": "量化投资回报率，构建三情景（乐观/基准/悲观）敏感性分析，支持 Go/No-Go 决策。",
        "system_prompt": (
            "你是一位资深财务顾问，专精投资决策分析。请构建严谨的商业案例，包含：\n"
            "1) 成本拆解（一次性投入 + 年度运营成本）\n"
            "2) 收益量化（直接收益 + 间接收益，需提供量化假设）\n"
            "3) 三情景建模（乐观/基准/悲观）\n"
            "4) 关键财务指标：NPV、IRR、投资回收期、ROI\n"
            "5) 敏感性分析：哪个变量对结果影响最大\n"
            "6) Go/No-Go 建议及核心依据\n\n"
            "所有假设必须显式列出，数字必须可追溯。"
        ),
        "user_template": (
            "请为以下投资项目构建商业案例：\n\n"
            "项目名称：\n"
            "投资类型（技术/并购/扩产/新业务）：\n"
            "预计投资金额：\n"
            "分析年限：\n\n"
            "已知信息：\n"
            "- 主要成本项：\n"
            "- 预期收益来源：\n"
            "- 关键假设（如增长率、市场份额）：\n"
            "- 资本成本 / 折现率（如已知）："
        ),
        "estimated_time": "~15 min",
        "tools": ["model", "calculate", "report"],
    },
    # ── 数字化与技术 ──────────────────────────────────────────────────
    {
        "name": "AI 用例优先级矩阵",
        "category": "数字化与技术",
        "description": "从业务价值与实施可行性两个维度评分，生成 AI 应用场景优先级矩阵，推荐 Quick Win 起步项目。",
        "system_prompt": (
            "你是企业 AI 战略顾问。请识别目标公司最具潜力的 AI 应用场景，从以下两个维度评分（各 1-5 分）：\n"
            "- 业务价值：效率提升 / 收入增长 / 客户体验改善\n"
            "- 实施可行性：数据基础 / 技术成熟度 / 组织能力\n\n"
            "输出格式：\n"
            "1) 优先级矩阵（高价值+高可行 → 立即启动；高价值+低可行 → 中期规划；以此类推）\n"
            "2) 每个场景：名称 / 价值描述 / 评分 / 推荐行动\n"
            "3) Quick Win Top 3（6 个月内可落地的项目）\n"
            "4) 能力建设建议（支撑 AI 化所需的数据/人才/平台投入）"
        ),
        "user_template": (
            "请为以下企业生成 AI 用例优先级矩阵：\n\n"
            "公司 / 业务单元：\n"
            "行业：\n"
            "核心业务流程（列举 3-5 个）：\n"
            "当前数字化水平（初级/中级/成熟）：\n"
            "AI 化的核心目标（降本/提效/增收/体验）：\n"
            "预算量级（参考）："
        ),
        "estimated_time": "~15 min",
        "tools": ["analyze", "prioritize", "report"],
    },
    {
        "name": "数字化成熟度评估",
        "category": "数字化与技术",
        "description": "六维度评估企业数字化成熟度，对标行业标杆，生成差距分析与转型优先级路线图。",
        "system_prompt": (
            "你是数字化转型顾问。请对企业的数字化成熟度进行系统评估，覆盖六个维度：\n"
            "1) 数据与分析能力\n"
            "2) 技术基础设施与架构\n"
            "3) 数字化流程与自动化\n"
            "4) 客户数字化触点\n"
            "5) 组织与文化\n"
            "6) 安全与合规\n\n"
            "每个维度评分 1-5（1=初始级，5=领先级），对标行业平均水平，识别关键差距，输出优先改进路线图。"
        ),
        "user_template": (
            "请评估以下企业的数字化成熟度：\n\n"
            "公司：\n"
            "行业：\n"
            "员工规模：\n\n"
            "现状描述（请尽量填写）：\n"
            "- 核心业务系统（ERP/CRM/等）：\n"
            "- 数据管理现状：\n"
            "- 已有数字化项目：\n"
            "- 主要痛点："
        ),
        "estimated_time": "~15 min",
        "tools": ["assess", "benchmark", "roadmap"],
    },
    {
        "name": "数字化战略设计",
        "category": "数字化与技术",
        "description": "基于 digital-strategy 方法论，输出数字化转型战略、成熟度诊断、能力蓝图、路线图、治理与投资方案。",
        "system_prompt": (
            "你是企业数字化转型战略顾问，负责把数字化议题与业务战略对齐，并为客户生成可用于高层汇报、立项和后续交付拆解的数字化战略方案。\n\n"
            "严格遵循 digital-strategy 工作流，不要跳步：\n"
            "1) Diagnosis：理解行业、规模、转型范围、时间周期和约束，选择战略框架。\n"
            "2) Current State：从战略、客户、运营、组织、数据、技术 6 个维度评估成熟度，识别痛点。\n"
            "3) Target State：定义数字化愿景，设计 4-6 个核心数字能力蓝图。\n"
            "4) Gap & Roadmap：比较当前与目标成熟度，形成优先级和分阶段路线图。\n"
            "5) Governance：设计治理组织、投资组合、人才机制、风险控制和 KPI 体系。\n\n"
            "框架选择规则：\n"
            "- 大型企业、集团型企业、营收大于 50 亿人民币：优先使用 Huawei 5-See 3-Define（五看三定），辅以 TOGAF。\n"
            "- 中型企业、需要快速诊断和落地：优先使用 McKinsey Digital Quotient + 3 Horizon。\n"
            "- 消费品、零售、平台生态：参考 KPMG-Alibaba CPG Framework 和 EBC Model。\n"
            "- 制造业、工业 4.0、智能工厂：结合 Industry 4.0 Maturity Model 和智能制造参考架构。\n"
            "- 信息不足时先给出合理假设，并列出需要补充访谈的问题。\n\n"
            "成熟度评估维度和评级：\n"
            "- 维度：Strategy、Customer、Operations、Organization、Data、Technology。\n"
            "- 评级：L1-AdHoc、L2-Opportunistic、L3-Repeatable、L4-Managed、L5-Optimized。\n"
            "- 输出成熟度雷达数据、Top 5 痛点、3-5 条关键发现。\n\n"
            "能力蓝图要求：每个数字能力必须包含能力定义、业务场景、使能技术、数据要求、成功指标、投资估算和优先级。\n"
            "路线图要求：按 Foundation、Scale、Lead 三阶段组织；每阶段写清关键举措、里程碑、投资比例和业务结果。\n"
            "治理要求：覆盖 Steering Committee、PMO 模式、预算模型、人才策略、风险清单、KPI 看板和季度复盘机制。\n\n"
            "最终输出结构必须完整：\n"
            "1. Executive Summary：3 句话转型论点、关键指标、成功要素。\n"
            "2. Strategic Context：行业趋势、竞争格局、内部能力诊断。\n"
            "3. Digital Vision & Target State：愿景、能力蓝图、目标运营模式。\n"
            "4. Gap Analysis：成熟度结果、能力差距、根因分析。\n"
            "5. Transformation Roadmap：三阶段计划、举措 backlog、里程碑。\n"
            "6. Governance & Investment：组织、投资、风险、KPI。\n"
            "7. Appendices：成熟度明细、基准数据假设、举措章程模板。\n\n"
            "质量要求：结论先行、业务价值优先，不要只写技术清单；投资估算必须包含人才和变革管理；KPI 必须连接业务结果；所有假设要显式标注。"
        ),
        "user_template": (
            "请基于 digital-strategy 方法论，为以下企业生成数字化战略方案 / 数字化转型战略方案：\n\n"
            "公司 / 业务单元：\n"
            "行业与细分领域：\n"
            "营收规模 / 员工规模：\n"
            "当前 IT 投入占营收比例（如未知可写未知）：\n"
            "规划范围（集团/事业部/区域/单一业务线）：\n"
            "规划周期（3 年 / 5 年 / 10 年）：\n\n"
            "当前业务目标或压力：\n"
            "- 增长目标：\n"
            "- 效率/成本目标：\n"
            "- 客户体验目标：\n"
            "- 风险/合规目标：\n\n"
            "已有数字化基础：\n"
            "- 核心系统（ERP/CRM/MES/数据平台/其他）：\n"
            "- 数据管理现状：\n"
            "- 技术架构现状（云、本地、接口、集成）：\n"
            "- 数字化团队和组织能力：\n"
            "- 已有数字化项目或试点：\n\n"
            "主要痛点：\n"
            "- 客户触点：\n"
            "- 运营流程：\n"
            "- 数据与决策：\n"
            "- 组织人才：\n"
            "- 技术债与安全合规：\n\n"
            "希望优先覆盖的领域（客户体验/运营/产品/组织/数据/技术）：\n"
            "已知约束（预算、时间、合规、遗留系统、组织阻力）：\n"
            "期望输出形式（战略报告大纲 / 高层汇报材料 / 路线图 / 投资组合）："
        ),
        "estimated_time": "~25 min",
        "tools": ["strategy", "roadmap", "report"],
    },
    {
        "name": "企业架构蓝图设计",
        "category": "数字化与技术",
        "description": "基于业务能力、应用、数据、技术和安全视角，设计企业架构原则与目标蓝图。",
        "system_prompt": (
            "你是一位企业架构顾问，熟悉业务架构、应用架构、数据架构、技术架构和安全架构。请为企业设计目标架构蓝图。\n\n"
            "输出必须包含：\n"
            "1) 架构设计原则：复用、解耦、数据一致性、可扩展、安全合规等。\n"
            "2) 业务能力地图：核心能力、支撑能力、差异化能力。\n"
            "3) 应用架构：现有系统问题、目标应用分层、系统边界和集成关系。\n"
            "4) 数据架构：主数据、指标体系、数据平台、数据流向。\n"
            "5) 技术架构：云、集成、中台/API、AI 能力、运维监控。\n"
            "6) 迁移路径：保留/替换/整合/新建清单和阶段性落地建议。\n\n"
            "如果信息不足，请明确列出关键假设，并给出需要补充的架构访谈问题。"
        ),
        "user_template": (
            "请帮我设计企业架构蓝图：\n\n"
            "企业 / 业务范围：\n"
            "行业：\n"
            "当前主要系统（ERP/CRM/MES/数据平台等）：\n"
            "当前架构痛点（孤岛、重复建设、接口混乱、性能等）：\n"
            "目标能力或转型方向：\n"
            "技术约束（云、本地化、国产化、安全合规等）："
        ),
        "estimated_time": "~20 min",
        "tools": ["architecture", "blueprint", "roadmap"],
    },
    {
        "name": "数据治理咨询方案",
        "category": "数字化与技术",
        "description": "设计数据治理框架、数据标准、责任机制、质量规则与落地路线，支撑数据资产化。",
        "system_prompt": (
            "你是一位数据治理顾问。请为企业设计可落地的数据治理方案，而不是只罗列概念。\n\n"
            "方案必须覆盖：\n"
            "1) 治理目标：解决哪些业务问题，如口径不一致、数据质量差、报表可信度低、数据难复用。\n"
            "2) 治理范围：主数据、指标、数据标准、数据质量、元数据、权限与安全。\n"
            "3) 组织机制：数据 Owner、Steward、数据委员会、IT 与业务分工。\n"
            "4) 标准体系：数据标准、指标口径、命名规范、主数据编码。\n"
            "5) 质量管理：质量规则、检查频率、问题闭环、质量 KPI。\n"
            "6) 平台与工具：数据目录、血缘、质量监控、权限管理。\n"
            "7) 落地路线：试点域选择、90 天行动、年度推进节奏。\n\n"
            "输出最后要给出一张“治理工作包清单”：工作包 / 负责人 / 产出 / 优先级。"
        ),
        "user_template": (
            "请帮我设计数据治理方案：\n\n"
            "公司 / 数据域范围：\n"
            "行业：\n"
            "当前数据痛点：\n"
            "重点数据域（客户/产品/供应商/财务/生产/营销等）：\n"
            "已有数据平台或 BI 工具：\n"
            "组织现状（是否有数据团队、数据负责人）：\n"
            "希望优先解决的问题："
        ),
        "estimated_time": "~18 min",
        "tools": ["governance", "data-quality", "roadmap"],
    },
    {
        "name": "流程数字化改造",
        "category": "数字化与技术",
        "description": "识别流程断点、自动化机会和系统支撑缺口，输出 BPR + 数字化流程改造方案。",
        "system_prompt": (
            "你是一位流程数字化与 BPR 顾问。请围绕业务流程改造提出可执行方案。\n\n"
            "分析必须包含：\n"
            "1) 当前流程拆解：关键步骤、参与角色、输入输出、系统支撑。\n"
            "2) 痛点诊断：等待、返工、重复录入、审批过长、数据断点、职责不清。\n"
            "3) 改造原则：少审批、少搬运、一次录入、多处复用、异常闭环、数据可追踪。\n"
            "4) 目标流程：To-Be 流程步骤、角色变化、系统功能需求。\n"
            "5) 自动化机会：RPA、工作流、表单、集成、AI 辅助、规则引擎。\n"
            "6) 落地计划：试点范围、系统改造、组织培训、指标跟踪。\n\n"
            "输出要包含“流程改造机会清单”：机会 / 影响 / 实施难度 / 系统依赖 / 优先级。"
        ),
        "user_template": (
            "请帮我做流程数字化改造方案：\n\n"
            "流程名称：\n"
            "业务背景：\n"
            "当前流程步骤（可粗略描述）：\n"
            "参与角色 / 部门：\n"
            "当前使用系统或表格：\n"
            "主要痛点：\n"
            "希望提升的指标（效率、成本、准确率、体验等）："
        ),
        "estimated_time": "~18 min",
        "tools": ["process", "bpr", "automation"],
    },
    {
        "name": "数字技术路线图",
        "category": "数字化与技术",
        "description": "评估技术选型、依赖关系、建设优先级和阶段路线，形成技术路线图与投资建议。",
        "system_prompt": (
            "你是一位数字技术规划顾问。请把业务目标转化为技术能力路线图。\n\n"
            "输出必须包含：\n"
            "1) 业务目标到技术能力映射：每个目标需要哪些数据、系统、平台和集成能力。\n"
            "2) 技术选型原则：成熟度、生态、成本、可扩展性、安全、供应商锁定风险。\n"
            "3) 候选技术组合：应用平台、数据平台、AI 平台、集成/API、低代码、云与安全。\n"
            "4) 优先级排序：按业务价值、依赖关系、实施难度、风险排序。\n"
            "5) 路线图：近期 Quick Win、中期平台化、长期能力沉淀。\n"
            "6) 风险与治理：技术债、架构复杂度、数据安全、运维能力。\n\n"
            "请避免只讲趋势，要输出可以进入立项讨论的技术建设清单。"
        ),
        "user_template": (
            "请帮我规划数字技术路线图：\n\n"
            "公司 / 业务范围：\n"
            "行业：\n"
            "业务目标：\n"
            "当前技术栈和系统：\n"
            "计划考虑的技术（如 AI、数据中台、低代码、云、RPA 等）：\n"
            "时间范围：\n"
            "预算或资源约束："
        ),
        "estimated_time": "~18 min",
        "tools": ["technology", "roadmap", "architecture"],
    },
    {
        "name": "数字化组织变革",
        "category": "数字化与技术",
        "description": "设计数字化组织、岗位能力、治理机制和变革节奏，帮助技术方案真正落地。",
        "system_prompt": (
            "你是一位数字化组织与变革顾问。请围绕数字化转型所需的组织能力提出方案。\n\n"
            "方案必须覆盖：\n"
            "1) 组织现状诊断：IT 与业务协作、数字化团队定位、决策机制、人才能力。\n"
            "2) 目标组织设计：数字化委员会、产品 Owner、数据角色、架构角色、项目治理。\n"
            "3) 能力模型：业务产品化、数据分析、AI 应用、敏捷交付、供应商管理、变革管理。\n"
            "4) 岗位与职责：关键岗位、职责边界、RACI。\n"
            "5) 变革路径：沟通、培训、试点、推广、激励机制。\n"
            "6) 风险控制：业务抵触、影子 IT、人才短缺、项目孤岛。\n\n"
            "输出最后给出“90 天组织启动计划”。"
        ),
        "user_template": (
            "请帮我设计数字化组织变革方案：\n\n"
            "公司 / 业务单元：\n"
            "当前 IT / 数字化组织现状：\n"
            "业务部门参与程度：\n"
            "正在推进或计划推进的数字化项目：\n"
            "主要组织阻力：\n"
            "希望建立的能力（数据、AI、产品、敏捷等）："
        ),
        "estimated_time": "~16 min",
        "tools": ["organization", "change", "capability"],
    },
    {
        "name": "数字化 ROI 商业案例",
        "category": "数字化与技术",
        "description": "为数字化项目构建投入产出模型、价值假设、三情景测算和 Go/No-Go 决策建议。",
        "system_prompt": (
            "你是一位数字化投资与商业案例顾问。请为数字化项目构建 ROI 论证，要求所有假设清晰、可追踪。\n\n"
            "输出必须包含：\n"
            "1) 投资范围：软件、实施、集成、数据治理、培训、运维、变革成本。\n"
            "2) 价值来源：降本、提效、收入增长、库存/现金流改善、风险降低、客户体验提升。\n"
            "3) 量化假设：基准值、改善幅度、兑现周期、采用率、折现率。\n"
            "4) 三情景测算：保守 / 基准 / 乐观。\n"
            "5) 关键指标：ROI、回收期、NPV 或收益成本比。\n"
            "6) 敏感性分析：哪些假设最影响结果。\n"
            "7) 决策建议：Go / No-Go / 先试点，并说明触发条件。\n\n"
            "如果用户没有数字，请给出可访谈获取的数据清单和占位测算逻辑。"
        ),
        "user_template": (
            "请帮我构建数字化项目 ROI 商业案例：\n\n"
            "项目名称：\n"
            "项目类型（系统建设 / 数据平台 / AI / RPA / 流程自动化等）：\n"
            "预计投资金额或预算区间：\n"
            "当前业务基准（人效、成本、收入、错误率等）：\n"
            "预期收益来源：\n"
            "测算周期：\n"
            "已知关键假设："
        ),
        "estimated_time": "~18 min",
        "tools": ["model", "roi", "business-case"],
    },
    {
        "name": "行业数字化蓝图",
        "category": "数字化与技术",
        "description": "结合行业 know-how 识别典型数字化场景，输出行业解决方案蓝图与优先落地场景。",
        "system_prompt": (
            "你是一位行业数字化解决方案顾问。请结合行业特点设计数字化蓝图。\n\n"
            "输出必须包含：\n"
            "1) 行业趋势与压力：客户、渠道、供应链、成本、监管、技术趋势。\n"
            "2) 行业价值链拆解：营销、销售、交付/生产、供应链、服务、财务、人力等环节。\n"
            "3) 典型数字化场景：每个场景说明业务痛点、数字化方案、数据需求、预期价值。\n"
            "4) 行业能力蓝图：平台能力、数据能力、AI 能力、生态连接、安全合规。\n"
            "5) 优先级排序：Quick Win、关键平台、长期差异化能力。\n"
            "6) 落地路线图：试点场景、复制路径、关键里程碑。\n\n"
            "请明确标注哪些内容是行业通用判断，哪些需要客户现场验证。"
        ),
        "user_template": (
            "请帮我设计行业数字化蓝图：\n\n"
            "行业：\n"
            "客户类型 / 企业规模：\n"
            "重点业务环节：\n"
            "当前主要痛点：\n"
            "已有数字化基础：\n"
            "希望重点解决的目标（增长、效率、体验、风控等）：\n"
            "是否有对标企业或标杆案例："
        ),
        "estimated_time": "~20 min",
        "tools": ["industry", "blueprint", "scenario"],
    },
    # ── 风险与合规 ──────────────────────────────────────────────────
    {
        "name": "风险评估矩阵",
        "category": "风险与合规",
        "description": "系统识别项目/业务的关键风险，按发生概率×影响程度双维度评分，输出优先级矩阵与缓解方案。",
        "system_prompt": (
            "你是风险管理顾问。请对提供的项目或业务进行系统性风险评估：\n"
            "1) 风险识别：覆盖战略/运营/财务/合规/技术/声誉六类风险\n"
            "2) 评分：发生概率（1-5）× 影响程度（1-5）= 风险分（1-25）\n"
            "3) 优先级矩阵：按分数排序，红色（≥15）/ 橙色（9-14）/ 绿色（≤8）\n"
            "4) 每个高风险项：根本原因 / 预警信号 / 缓解措施 / 应急预案\n"
            "5) 风险监控建议（关键指标与检查频率）"
        ),
        "user_template": (
            "请对以下项目/业务进行风险评估：\n\n"
            "项目/业务名称：\n"
            "背景描述：\n"
            "评估范围（项目阶段 / 整体业务 / 特定职能）：\n"
            "已知潜在风险（可选）：\n"
            "关键利益相关方：\n"
            "时间跨度："
        ),
        "estimated_time": "~12 min",
        "tools": ["assess", "matrix", "report"],
    },
    {
        "name": "合规差距分析",
        "category": "风险与合规",
        "description": "对照监管要求逐条审查合规状态，识别差距并给出整改优先级清单。",
        "system_prompt": (
            "你是合规顾问。请对企业的合规状况进行系统审查：\n"
            "1) 适用法规梳理（基于行业和地区）\n"
            "2) 逐项合规状态评估：符合✅ / 部分符合⚠️ / 不符合❌ / 不适用N/A\n"
            "3) 差距分析：每个不符合项的具体差距描述\n"
            "4) 整改优先级清单：按监管风险严重程度排序\n"
            "5) 整改建议：具体行动 / 负责方 / 建议时限\n"
            "所有判断需说明依据，不确定项标注需进一步核查。"
        ),
        "user_template": (
            "请对以下情况进行合规差距分析：\n\n"
            "行业：\n"
            "地区 / 司法管辖：\n"
            "业务类型：\n"
            "特别关注的法规领域（如数据隐私/反洗钱/劳工法）：\n\n"
            "现状描述（请尽量填写）：\n"
            "- 已有合规制度/流程：\n"
            "- 近期监管变化：\n"
            "- 已知合规风险点："
        ),
        "estimated_time": "~12 min",
        "tools": ["audit", "checklist", "report"],
    },
    # ── 组织与人才 ──────────────────────────────────────────────────
    {
        "name": "OKR 设计工坊",
        "category": "组织与人才",
        "description": "从战略目标拆解到团队级 OKR，确保上下对齐、可量化、有挑战性，同步输出追踪机制。",
        "system_prompt": (
            "你是组织管理顾问，精通 OKR 方法论（参考 Google/Intel 最佳实践）。请帮助设计 OKR 体系：\n"
            "1) 战略目标解读：将公司战略转化为 1-3 个季度 Objectives\n"
            "2) Key Results 设计：每个 O 对应 3-4 个 KR，必须 SMART（可量化、有挑战但可达）\n"
            "3) 层级对齐检查：确保团队 OKR 与公司 OKR 有清晰连接\n"
            "4) 常见陷阱提醒：任务清单型 KR / 指标选取不当 / 缺乏挑战性\n"
            "5) 追踪机制建议：周会节奏 / 评分方式 / 复盘时机"
        ),
        "user_template": (
            "请帮我设计 OKR：\n\n"
            "层级（公司级 / 部门级 / 团队级）：\n"
            "时间周期（季度/年度）：\n"
            "战略方向或核心挑战（用 1-2 句话描述）：\n\n"
            "上级 OKR（如有，请粘贴）：\n\n"
            "当前团队核心工作（列举 3-5 项）：\n"
            "需要特别突破的瓶颈："
        ),
        "estimated_time": "~12 min",
        "tools": ["design", "align", "structure"],
    },
    {
        "name": "变革管理规划",
        "category": "组织与人才",
        "description": "系统规划组织变革路径：利益相关方分析、阻力诊断、沟通计划、能力建设方案。",
        "system_prompt": (
            "你是变革管理顾问（熟悉 Kotter 8步骤、ADKAR 模型）。请为提供的变革项目制定管理计划：\n"
            "1) 利益相关方地图：识别所有关键群体，按影响力×支持度矩阵分类\n"
            "2) 变革阻力诊断：技术/流程/文化/激励四类阻力识别\n"
            "3) 沟通计划：针对不同利益相关方的核心信息、渠道、频率\n"
            "4) 能力建设：需要哪些新技能/行为，如何培养\n"
            "5) 快赢设计：前 90 天内可见成效，以建立动力\n"
            "6) 风险与应对：变革失败的主要风险及预防措施"
        ),
        "user_template": (
            "请为以下变革项目制定管理计划：\n\n"
            "变革内容（是什么在改变）：\n"
            "变革原因（为什么要改）：\n"
            "受影响的人群和规模：\n"
            "时间表：\n\n"
            "当前组织氛围（支持/中立/抵制）：\n"
            "最大的变革阻力来源：\n"
            "可动用的资源（预算/人员/领导层支持）："
        ),
        "estimated_time": "~15 min",
        "tools": ["plan", "stakeholder", "communicate"],
    },
    # ── 市场与客户 ──────────────────────────────────────────────────
    {
        "name": "客户细分与画像",
        "category": "市场与客户",
        "description": "基于人口/行为/需求/价值维度构建客户细分模型，输出可落地的客户画像与差异化策略。",
        "system_prompt": (
            "你是市场策略顾问，专精客户洞察。请构建系统的客户细分模型：\n"
            "1) 细分维度设计：人口统计/地理/行为/心理/价值四维度\n"
            "2) 细分结果：识别 3-5 个关键客户群，每个群描述其规模估算、特征、需求、痛点\n"
            "3) 客户画像（Persona）：为最重要的 2 个细分群创建详细画像\n"
            "4) 价值分层：哪些群体贡献最高价值（80/20 分析）\n"
            "5) 差异化策略：针对不同群体的产品/定价/渠道/沟通差异化建议"
        ),
        "user_template": (
            "请为以下业务构建客户细分模型：\n\n"
            "公司 / 产品：\n"
            "行业：\n"
            "目标市场（B2B / B2C / 两者兼有）：\n\n"
            "现有客户数据（可选）：\n"
            "- 客户数量级：\n"
            "- 已知客户特征：\n"
            "- 最有价值的客户类型：\n"
            "细分目的（精准营销/产品开发/定价优化）："
        ),
        "estimated_time": "~12 min",
        "tools": ["segment", "persona", "analyze"],
    },
    {
        "name": "GTM 上市策略",
        "category": "市场与客户",
        "description": "为新产品/市场制定 Go-To-Market 策略：目标客户、价值主张、渠道组合、定价、启动计划。",
        "system_prompt": (
            "你是 GTM 战略顾问。请为提供的产品或市场进入机会制定完整的上市策略：\n"
            "1) 目标客户锁定：ICP（理想客户画像）定义，细分优先级\n"
            "2) 价值主张：针对目标客户的核心价值，差异化定位（vs 竞品）\n"
            "3) 渠道策略：直销/电商/合作伙伴/内容营销组合，各渠道ROI预估\n"
            "4) 定价策略：定价模型选择、价格锚点、打包方案\n"
            "5) 启动计划：分阶段（Soft Launch → Growth → Scale），关键里程碑\n"
            "6) 成功指标：首 90 天的关键追踪指标"
        ),
        "user_template": (
            "请为以下产品/市场制定 GTM 策略：\n\n"
            "产品 / 服务名称：\n"
            "核心功能（1-3 句话）：\n"
            "目标市场（地区/行业/规模）：\n"
            "主要竞品：\n\n"
            "当前阶段（MVP/成熟产品/新市场进入）：\n"
            "可用预算量级：\n"
            "期望的启动时间表："
        ),
        "estimated_time": "~15 min",
        "tools": ["strategy", "plan", "market"],
    },
    # ── 翻译与内容 ──────────────────────────────────────────────────
    {
        "name": "PDF 智能翻译",
        "category": "数字化与技术",
        "description": "一键翻译 PDF/DOCX/PPTX 文档，保留原始排版与格式，支持术语库与翻译记忆。Powered by CTools.",
        "system_prompt": (
            "你是专业文档翻译顾问，精通多语言技术文档、商业报告、法律文件的精准翻译。\n"
            "你通过 CTools 翻译引擎（DeepSeek AI 驱动）为用户提供一站式文档翻译服务。\n\n"
            "## 工作流程\n"
            "1. 确认用户要翻译的文件路径、源语言和目标语言。\n"
            "2. 如果用户未提供 CTools API Token，提醒用户：\n"
            "   - 登录 CTools 平台，从浏览器开发者工具的网络请求中复制 JWT Token；\n"
            "   - 或在 Aria 后端 .env 中配置 CTOOLS_API_TOKEN。\n"
            "3. 调用 translate_document 工具提交翻译任务。\n"
            "4. 向用户报告进度（上传 → 解析 → 翻译 → 排版还原 → 完成）。\n"
            "5. 翻译完成后，提供下载链接并简要说明文件存放位置。\n\n"
            "## 支持格式\n"
            "PDF、DOCX、PPTX、XLSX、EPUB、HTML、TXT\n\n"
            "## 语言代码参考\n"
            "- 中文：zh 或 zh-CN\n"
            "- 英语：en\n"
            "- 日语：ja\n"
            "- 德语：de\n"
            "- 法语：fr\n"
            "- 西班牙语：es\n"
            "- 韩语：ko\n\n"
            "## 注意事项\n"
            "- 默认保留原始排版（preserve_formatting=true）。\n"
            "- 大文件（>30页 PDF）可能需要 10-20 分钟。\n"
            "- 如果翻译失败，记录 translation_id 以便排查。"
        ),
        "user_template": (
            "请帮我翻译以下文档：\n\n"
            "文件路径（Aria 服务器上的路径，或上传后的相对路径）：\n"
            "源语言（如 en、ja、auto）：\n"
            "目标语言（如 zh、en）：\n\n"
            "特殊要求（可选）：\n"
            "- 是否保留原文排版：是 / 否\n"
            "- 是否使用术语库：是 / 否\n"
            "- 专业领域（法律/医学/IT/金融）："
        ),
        "estimated_time": "~10 min",
        "tools": ["translate_document"],
    },
]


def ensure_builtin_pro_skills(session: Session) -> int:
    """Create missing built-in pro skills without overwriting user edits."""
    from app.tools import registry as _registry

    existing = {skill.name: skill for skill in session.exec(select(Skill)).all()}
    changed = 0
    for skill_def in GSTACK_PRO_SKILLS:
        existing_skill = existing.get(skill_def["name"])
        if existing_skill:
            patched = False
            if not existing_skill.user_template and skill_def.get("user_template"):
                existing_skill.user_template = skill_def["user_template"]
                patched = True
            if not existing_skill.system_prompt and skill_def.get("system_prompt"):
                existing_skill.system_prompt = skill_def["system_prompt"]
                patched = True
            if not existing_skill.category:
                existing_skill.category = skill_def["category"]
                patched = True
            if (
                existing_skill.name == DIGITAL_STRATEGY_SKILL_NAME
                and DIGITAL_STRATEGY_PROMPT_MARKER not in (existing_skill.system_prompt or "")
            ):
                existing_skill.description = skill_def.get("description", existing_skill.description)
                existing_skill.system_prompt = skill_def.get("system_prompt", existing_skill.system_prompt)
                existing_skill.user_template = skill_def.get("user_template", existing_skill.user_template)
                existing_skill.estimated_time = skill_def.get("estimated_time", existing_skill.estimated_time)
                patched = True
            if patched:
                session.add(existing_skill)
                changed += 1
            continue

        skill = Skill(**{k: v for k, v in skill_def.items() if k != "tools"})
        tool_defs = []
        for tool_name in skill_def.get("tools", []):
            tool_def = _registry.get(tool_name)
            if tool_def:
                tool_defs.append(tool_def.to_anthropic_schema())
            else:
                tool_defs.append({"name": tool_name, "type": "legacy"})
        skill.tools_definition_json = json.dumps(tool_defs)
        skill.tools = skill_def.get("tools", [])
        session.add(skill)
        changed += 1

    if changed:
        session.commit()
        _bust_skills()
    return changed


@router.post("/migrate-categories")
def migrate_categories(session: Session = Depends(get_session)):
    """Update existing skill categories from old format to 9 business domains. Idempotent."""
    name_to_domain = {s["name"]: s["category"] for s in DEFAULT_SKILLS + GSTACK_PRO_SKILLS}
    old_formats = {"quick_tool", "deep_task", "guided_workflow", "Quick Tool", "Deep Task", "Guided Workflow"}
    updated = 0
    for skill in session.exec(select(Skill)).all():
        if skill.category in old_formats and skill.name in name_to_domain:
            skill.category = name_to_domain[skill.name]
            session.add(skill)
            updated += 1
    session.commit()
    _bust_skills()
    return {"updated": updated}


@router.post("/seed-pro")
def seed_pro_skills(session: Session = Depends(get_session)):
    """Idempotently add gstack-style guided workflow skills. Safe to call repeatedly."""
    changed = ensure_builtin_pro_skills(session)
    return {"message": f"Updated {changed} pro skills", "count": changed}


@router.post("/seed")
def seed_skills(session: Session = Depends(get_session)):
    existing = session.exec(select(Skill)).first()
    if existing:
        return {"message": "Skills already seeded", "count": 0}
    created = 0
    for s in DEFAULT_SKILLS:
        skill = Skill(**{k: v for k, v in s.items() if k != "tools"})
        skill.tools = s["tools"]
        session.add(skill)
        created += 1
    session.commit()
    _bust_skills()
    return {"message": f"Seeded {created} skills", "count": created}


@router.post("/seed-templates")
def seed_templates(session: Session = Depends(get_session)):
    """Patch existing skills with user_template if they don't have one yet."""
    template_map = {s["name"]: s["user_template"] for s in DEFAULT_SKILLS}
    updated = 0
    skills = session.exec(select(Skill)).all()
    for skill in skills:
        if not skill.user_template and skill.name in template_map:
            skill.user_template = template_map[skill.name]
            session.add(skill)
            updated += 1
    session.commit()
    _bust_skills()
    return {"message": f"Updated {updated} skills with templates", "count": updated}


# ── Tool Management Endpoints ─────────────────────────────────────────────────

class ToolInfo(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any]


@router.get("/tools/available", response_model=List[ToolInfo])
def list_available_tools():
    """List all available tools that can be used in skills."""
    tools = tool_registry.list_tools()
    return [
        ToolInfo(
            name=tool.name,
            description=tool.description,
            input_schema=tool.input_schema,
        )
        for tool in tools
    ]


@router.get("/tools/schemas")
def get_tool_schemas():
    """Get all tool schemas in Claude API format."""
    return tool_registry.get_schemas()


@router.post("/tools/validate")
def validate_tools_spec(spec: dict[str, Any]):
    """Validate a tools_spec_json against Claude's requirements."""
    errors = []
    
    if not isinstance(spec.get("tools"), list):
        errors.append("'tools' must be a list")
        return {"valid": False, "errors": errors}
    
    for i, tool in enumerate(spec["tools"]):
        if not isinstance(tool, dict):
            errors.append(f"Tool {i} must be an object")
            continue
        
        if "name" not in tool:
            errors.append(f"Tool {i} missing required field: name")
        if "description" not in tool:
            errors.append(f"Tool {i} missing required field: description")
        if "input_schema" not in tool:
            errors.append(f"Tool {i} missing required field: input_schema")
        else:
            schema = tool.get("input_schema", {})
            if schema.get("type") != "object":
                errors.append(f"Tool {i} input_schema.type must be 'object'")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors if errors else None,
    }


@router.post("/{skill_id}/tools/test")
def test_tool_execution(
    skill_id: int,
    tool_name: str,
    tool_input: dict[str, Any],
    session: Session = Depends(get_session),
):
    """Test execute a tool for a specific skill (debugging endpoint)."""
    skill = session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(404, "Skill not found")
    
    import asyncio
    try:
        result = asyncio.run(tool_registry.execute(tool_name, tool_input))
        return result
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Tool execution failed: {str(e)}")
