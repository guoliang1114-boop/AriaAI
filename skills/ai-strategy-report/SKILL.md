---
name: ai-strategy-report
argument-hint: "[company name] [industry] [focus area] e.g. ABC Manufacturing, Auto Parts, Cost Reduction"
description: "Generate comprehensive AI strategy reports (15+ slides) in PowerPoint format. Analyzes company's digital readiness, identifies high-value AI use cases, creates implementation roadmaps, and provides ROI projections. Designed for consulting firm quality deliverables."
allowed-tools: "Read Write Bash"
metadata:
  version: 1.0.0
  description_zh: "生成完整的AI战略报告PPT（15+页），分析企业数字化现状、识别高价值AI场景、制定实施路线图、提供ROI预测。咨询公司级别的交付物。"
  category: digital-transformation
---

# AI Strategy Report

## Overview

AI Strategy Report is a comprehensive strategic document that analyzes a company's AI readiness, identifies high-value use cases, and creates a practical implementation roadmap. This skill generates **professional-grade PowerPoint presentations of 15+ slides** using the **KPMG consulting template** for consistent, professional formatting.

**Key Features:**
- **Complete strategic framework**: 15-slide structure covering the full AI transformation journey
- **Data-driven analysis**: Digital maturity assessment and data readiness evaluation
- **Prioritization matrix**: 2×2 value-feasibility matrix for AI opportunities
- **Implementation roadmap**: 3-phase timeline (0-6m/6-18m/18-36m)
- **Financial projections**: Investment breakdown and ROI calculations
- **Risk assessment**: Technical, organizational, and compliance risks with mitigations

**Output Format:** PowerPoint (.pptx) with professional styling and structured content.

## When to Use This Skill

This skill should be used when:
- Developing AI transformation strategy for enterprises
- Evaluating AI opportunities and prioritizing use cases
- Creating implementation roadmaps for digital transformation
- Building business cases for AI investments
- Assessing organizational readiness for AI adoption
- Planning talent and capability building for AI teams
- Preparing board-level presentations on AI strategy
- Supporting M&A due diligence for AI capabilities
- Planning cloud migration and data infrastructure
- Creating vendor selection criteria for AI platforms

## Report Structure (15 Slides)

```
Slide 1:  Cover Page
Slide 2:  Executive Summary
Slide 3-4: Current State Assessment
Slide 5-6: AI Opportunity Map (2×2 Matrix)
Slide 7-9: Top 3 Use Cases Deep Dive
Slide 10-11: Implementation Roadmap (3 Phases)
Slide 12: Investment & ROI Analysis
Slide 13: Organizational Capabilities
Slide 14: Risk Assessment & Mitigation
Slide 15: Next Steps & Action Items
```

## Input Requirements

### Required Information

```markdown
**Company Basics**
- Company Name: [Name]
- Industry: [Industry Sector]
- Company Size: [Employees] / [Revenue]
- Digital Maturity: [Beginner/Intermediate/Advanced]

**Business Context**
- Core Business: [Description]
- Key Challenges: [List 2-3 major pain points]
- AI Objectives: [What problems to solve with AI]

**Strategic Priorities** (Select all that apply)
- [ ] Cost Reduction & Efficiency
- [ ] Revenue Growth
- [ ] Customer Experience
- [ ] Innovation & New Products
- [ ] Risk Management
```

### Optional Information

```markdown
**Data Assets**
- Existing data types: [Customer/Operational/IoT/etc]
- Data history: [Years of historical data]

**Technology Stack**
- Cloud platform: [AWS/Azure/GCP/Alibaba/etc]
- Existing systems: [ERP/CRM/MES/etc]

**Constraints**
- Budget range: [Amount]
- Timeline: [Expected delivery]
- Special restrictions: [Data privacy/etc]
```

## Workflow

### Phase 1: Analysis (Internal)

Analyze the input information and determine:
1. **Digital maturity level** based on described systems and processes
2. **Data readiness** for each potential AI use case
3. **Priority ranking** of AI opportunities (value × feasibility)
4. **Implementation complexity** for each phase

### Phase 2: Content Generation

Generate structured content for each slide:

**Slide 2 - Executive Summary:**
- 3-5 key conclusions
- Investment overview
- Expected ROI
- Critical milestones

**Slide 5-6 - AI Opportunity Map:**
Create a 2×2 matrix categorizing opportunities:
- **Quick Wins** (High Value, High Feasibility): Immediate start
- **Strategic Bets** (High Value, Low Feasibility): Long-term planning
- **Low Priority** (Low Value): Defer or discard

**Slide 10-11 - Roadmap:**
Define 3 phases:
- **Phase 1 (0-6 months)**: Foundation + Pilot
- **Phase 2 (6-18 months)**: Scale + Capability Building
- **Phase 3 (18-36 months)**: Optimization + Innovation

### Phase 3: Tool Execution

Call `generate_ppt_from_skill` tool with structured slide content:

```json
{
  "skill_name": "ai-strategy-report",
  "title": "[Company] AI Strategy Report",
  "subtitle": "Digital Transformation Roadmap",
  "slides": [
    {
      "type": "title",
      "title": "Cover Title",
      "content": "Subtitle"
    },
    {
      "type": "content",
      "title": "Slide Title",
      "content": "Bullet points and analysis"
    },
    {
      "type": "two_column",
      "title": "Comparison Slide",
      "left_content": "Current State",
      "right_content": "Future State"
    }
  ]
}
```

### Phase 4: Optional Data Export

If user needs editable data, call `save_json`:

```json
{
  "filename": "[Company]_AI_Strategy_Data",
  "data": {
    "scenarios": [...],
    "roadmap": {...},
    "financial": {...}
  }
}
```

## Tool Configuration

### Tool 1: generate_ppt_from_skill

**Purpose**: Generate PowerPoint using the KPMG template bundled with this skill

**When to Call**: After content generation is complete, always call this tool to create the deliverable.

**Parameters**:
```json
{
  "skill_name": "ai-strategy-report",
  "title": "Company AI Strategy Report",
  "subtitle": "Digital Transformation Roadmap (2024-2027)",
  "slides": [
    {
      "type": "title|content|two_column",
      "title": "Action-oriented title (verb-first)",
      "content": "Markdown formatted content with bullet points",
      "left_content": "For two-column layout",
      "right_content": "For two-column layout"
    }
  ]
}
```

**Content Guidelines**:
- Use action-oriented titles ("Drive Efficiency Through AI-Powered Quality Control")
- Format with Markdown: `- Bullet points`, `**Bold highlights**`
- Keep bullet points concise (1-2 lines each)
- Use color coding: 🔴 High Risk, 🟡 Medium Risk, 🟢 Low Risk

### Tool 2: save_json (Optional)

**Purpose**: Export structured data for further editing or integration

**When to Call**: When user explicitly asks for editable data or mentions integrating with other systems.

**Parameters**:
```json
{
  "filename": "Company_AI_Strategy_Data",
  "data": {
    "company": "Company Name",
    "industry": "Industry Sector", 
    "scenarios": [...],
    "roadmap": {...},
    "financial": {...},
    "organization": {...},
    "risks": [...]
  }
}
```

## Quality Standards

### Content Requirements

- **Specificity**: All recommendations must be specific to the company's industry and stated challenges
- **Quantification**: Include estimated savings/returns where possible (mark as "estimated" if not precise)
- **Feasibility**: Only recommend AI use cases that match the described data availability
- **Actionability**: Every recommendation must have clear next steps

### Slide Content Standards

**Executive Summary (Slide 2)**:
- Max 5 conclusions
- Include 1-line ROI summary
- List 3 critical milestones

**Opportunity Map (Slide 5-6)**:
- Minimum 4 opportunities mapped
- Clear rationale for each quadrant placement
- Prioritization within each quadrant

**Use Case Deep Dive (Slide 7-9)**:
For each of top 3 use cases:
- Business pain point (2-3 sentences)
- AI solution approach (high-level)
- Quantified expected benefit
- Implementation complexity rating

**Roadmap (Slide 10-11)**:
- Each phase has clear deliverables
- Logical dependencies between phases
- Resource requirements specified

**ROI Analysis (Slide 12)**:
- 3-year investment breakdown
- Year-by-year savings projection
- Payback period calculation
- Key assumptions listed

### Prohibited Content

- Do NOT specify specific vendors (e.g., "use AWS SageMaker")
- Do NOT make unrealistic claims (e.g., "100% automation")
- Do NOT ignore stated constraints (e.g., data privacy requirements)
- Do NOT provide implementation details beyond strategic level

## Example Output

See `examples/manufacturing_example.md` for a complete input-output example.

## Best Practices

### For High-Quality Output

1. **Encourage detailed input**: If user input is vague, ask clarifying questions
2. **Be conservative with estimates**: Better to under-promise than over-promise
3. **Highlight risks explicitly**: Don't hide implementation challenges
4. **Emphasize data readiness**: Make clear when data preparation is needed
5. **Provide alternatives**: Offer options when ideal path isn't feasible

### Industry Customization

**Manufacturing**:
- Focus: Predictive maintenance, quality control, supply chain
- Key metrics: OEE, defect rates, inventory turnover

**Retail/E-commerce**:
- Focus: Demand forecasting, personalization, pricing
- Key metrics: Conversion rate, customer LTV, inventory accuracy

**Financial Services**:
- Focus: Risk modeling, fraud detection, customer service
- Key metrics: False positive rate, processing time, compliance score

**Healthcare**:
- Focus: Diagnostic imaging, patient triage, resource optimization
- Key metrics: Diagnostic accuracy, wait times, resource utilization

## Dependencies

### Required Backend Tools
- `generate_ppt` - python-pptx 1.0.2
- `save_json` - Python built-in json

### System Requirements
- AriaAI Backend >= 1.0.0
- Function Calling support enabled

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-03-25 | Initial release |

## Maintenance

- **Maintainer**: AriaAI Team
- **Update Cycle**: Quarterly review
- **Feedback**: Submit via Issue or contact admin

## Capability Upgrade

### Mode Selection

- **Quick**: 输出 AI 机会清单、优先级和 90 天试点建议。
- **Standard**: 输出完整 AI 战略报告、用例组合、路线图、投资和组织能力建议。
- **Deep**: 结合客户行业、数据资产、系统架构、组织成熟度、知识库案例和历史项目记忆，形成董事会级 AI 转型方案。

### AI Portfolio Logic

每个 AI 用例必须同时评估：业务价值、数据可得性、技术可行性、组织准备度、风险合规、落地周期和可复制性。优先级不能只按“看起来先进”排序。

### Quality Gates

- [ ] AI 用例与客户业务痛点和数据资产匹配。
- [ ] 投资收益有假设、区间和验证方式。
- [ ] 路线图区分数据基础、模型能力、业务流程和组织变革。
- [ ] 风险覆盖数据隐私、模型准确性、合规、采纳和运维。
- [ ] PPT 输出前已有清晰 storyline，不直接堆幻灯片。

## Consulting Excellence Layer

### AI Value Pool Logic

AI strategy must quantify value pools before listing use cases. Organize value into:

| Value Pool | Typical Levers | Evidence Needed |
|------------|----------------|-----------------|
| Revenue growth | Conversion, pricing, cross-sell, retention | Funnel, customer, sales data |
| Cost reduction | Automation, workload reduction, rework reduction | Process volume, FTE, cycle time |
| Risk control | Fraud, compliance, quality, safety | Incidents, exceptions, loss data |
| Decision quality | Forecasting, planning, prioritization | Historical decisions and outcomes |
| Knowledge leverage | Proposal reuse, case retrieval, expert assistance | Document corpus and usage patterns |

### Use Case Investment Committee

Every AI use case must be described as an investment case:

- Business problem.
- User and workflow.
- Data required.
- Model approach.
- Integration point.
- Human review point.
- Benefit hypothesis.
- Risk and control.
- Pilot metric.
- Scale condition.

### Build / Buy / Partner Decision

| Condition | Recommended Path |
|-----------|------------------|
| Commodity capability, low differentiation | Buy SaaS or API |
| Proprietary data and workflow advantage | Build on internal data |
| Need speed plus domain expertise | Partner / co-build |
| High compliance or sensitive data | Private deployment or controlled harness |

### AI Governance Minimum

Deep AI strategy must include:

- Model ownership and approval.
- Data access and permission rules.
- Prompt and output review policy.
- Evaluation metrics and regression testing.
- Incident response and rollback.
- Human-in-the-loop points.
- Vendor and cost governance.

### Pilot Design Standard

Each pilot must be small enough to run in 8-12 weeks and strong enough to prove business value. Define baseline, target, sample users, process integration, evaluation method, and scale/no-scale decision gate.

### Deliverable Catalog

| Deliverable | When to use | Minimum content | Format |
|-------------|-------------|-----------------|--------|
| AI readiness assessment | 判断企业是否适合推进 AI | 数据、流程、系统、人才、治理、风险成熟度 | Markdown / PPT |
| AI value pool map | 寻找高价值机会 | 收入、成本、风险、决策、知识价值池和证据 | PPT / Excel |
| AI use-case portfolio | 选择 AI 场景 | 用例、用户、数据、模型、价值、风险、优先级 | Excel / PPT |
| Pilot charter | 启动试点 | 目标、范围、用户、数据、指标、时间、评估方式 | Markdown / Word |
| Data readiness checklist | 试点前准备 | 数据源、权限、质量、历史长度、敏感等级、缺口 | Markdown / Excel |
| AI governance framework | 管理模型风险 | 角色、审批、评估、HITL、回滚、供应商和成本治理 | Word / PPT |
| AI transformation roadmap | 进入规模化建设 | 阶段、能力、平台、流程、组织、投资、KPI | PPT |
| Board AI strategy deck | 董事会或高管汇报 | AI 战略命题、用例组合、投资收益、治理风险、90 天行动 | PPT |
