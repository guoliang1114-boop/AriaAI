---
name: digital-strategy
description: "Digital transformation strategy planning and blueprint design for consulting engagements. Use when the user requests (1) creating or updating a digital transformation strategy, (2) digital top-level design or blueprint, (3) digital vision mission or goal setting, (4) digital transformation roadmap or phased planning, (5) digital strategy reports or presentation materials for leadership. Also triggers when keywords appear such as digital transformation strategy, digital blueprint, digital top-level design, transformation roadmap, digital vision, digital strategic planning. This skill produces structured strategic content that can be rendered into PPT, documents, or Excel deliverables via collaborating skills."
---

# Digital Strategy

Strategic planning for enterprise digital transformation. Produces structured strategic content covering vision, maturity assessment, gap analysis, target blueprint, implementation roadmap, and governance framework.

## Workflow

Follow this sequence. Do not skip steps.

```
1. Diagnosis        → Understand context, select framework, define scope
2. Current State    → Assess digital maturity, identify pain points
3. Target State     → Design digital vision, capability blueprint
4. Gap & Roadmap    → Analyze gaps, define phases, set milestones
5. Governance       → Design organization, investment, risk control
```

## Step 1: Diagnosis

Determine the engagement context and select the appropriate strategic framework.

### Framework Selection Guide

| Scenario | Primary Framework | Secondary Reference |
|:---|:---|:---|
| Large enterprise, business-led transformation | Huawei 5-See 3-Define (五看三定) | TOGAF |
| Mid-size, rapid digital build-out | McKinsey Digital Quotient + 3 Horizon | Lean Digital |
| Platform/ecosystem strategy | KPMG-Alibaba CPG Framework | EBC Model |
| Public sector/SOE | Government Digital Maturity + Policy Alignment | ISO 22301 |
| Industry 4.0 / Manufacturing | Smart Manufacturing Reference Architecture | Industry 4.0 Maturity |

**Decision rule**: If user does not specify, default to **Huawei 5-See 3-Define** for enterprises with revenue > 5B RMB, **McKinsey Digital Quotient** for others.

### Scope Definition Checklist

Confirm with user (or infer from input):

- [ ] Industry and sub-sector
- [ ] Revenue scale and employee count
- [ ] Current IT spend as % of revenue
- [ ] Scope: Enterprise-wide or division/business-unit level
- [ ] Time horizon: 3-year / 5-year / 10-year
- [ ] Priority domains (select from: customer experience, operations, products, organization, data, technology)
- [ ] Known constraints (budget, timeline, regulatory, legacy systems)

## Step 2: Current State Assessment

Evaluate the client's digital maturity across 6 dimensions.

### Assessment Dimensions

| Dimension | Key Questions | Data Sources |
|:---|:---|:---|
| **Strategy** | Is there a published digital strategy? Is it linked to business strategy? | Strategy docs, board minutes |
| **Customer** | Digital touchpoint coverage? Customer data platform maturity? | CRM audit, journey maps |
| **Operations** | Process automation rate? IoT/shop floor digitization? | Process mining, site visits |
| **Organization** | Digital talent ratio? Agile adoption? CDO role? | Org chart, HR data |
| **Data** | Data governance maturity? Analytics adoption? Data quality score? | Data audit, system logs |
| **Technology** | Cloud adoption? Legacy system age? API maturity? | Architecture review |

**Rating scale**: L1-AdHoc → L2-Opportunistic → L3-Repeatable → L4-Managed → L5-Optimized

### Output of This Step

- Maturity radar chart data (6 dimensions × 5 levels)
- Top 5 pain points ranked by business impact
- Key findings summary (3-5 bullet points)

## Step 3: Target State Design

Define the digital vision and capability blueprint.

### Vision Statement Template

```
By [year], [company name] will be a [data-driven / digitally-native / intelligent] enterprise
where [key capability 1], [key capability 2], and [key capability 3] enable
[sustainable growth / operational excellence / customer intimacy / ecosystem leadership].
```

### Capability Blueprint Structure

Design 4-6 core digital capabilities. For each capability, define:

| Element | Description |
|:---|:---|
| **Capability Name** | E.g., "Intelligent Customer Operations" |
| **Definition** | 1-2 sentence description |
| **Business Scenarios** | 3-5 specific use cases |
| **Enabling Technologies** | Key tech stack components |
| **Data Requirements** | Critical data assets and flows |
| **Success Metrics** | 2-3 KPIs with target values |
| **Investment Estimate** | T-shirt sizing: S/M/L/XL |

### Common Capability Patterns by Industry

| Industry | Typical Capability Set |
|:---|:---|
| Manufacturing | Smart Factory, Digital Supply Chain, Connected Products, Digital R&D |
| Retail/CPG | Omnichannel Commerce, Precision Marketing, Smart Supply Chain, Consumer Data Platform |
| Financial Services | Digital Banking, Intelligent Risk, Open Finance, Embedded Finance |
| Energy/Utilities | Smart Grid, Digital Asset Management, Customer Energy Platform, Carbon Intelligence |
| Pharma/Healthcare | Digital R&D, Smart Manufacturing, Patient Engagement, Real-World Evidence |

## Step 4: Gap Analysis & Roadmap

### Gap Analysis Matrix

For each capability, compare current (L?) vs target (L?) maturity:

| Capability | Current | Target | Gap | Priority |
|:---|:---|:---|:---|:---|
| Example: Smart Factory | L2 | L4 | 2 levels | P1 |

Priority rules:
- **P1 (Quick Wins)**: High impact, low effort, can start in Year 1
- **P2 (Foundation)**: High impact, high effort, required before P3
- **P3 (Differentiators)**: Strategic differentiation, start Year 2-3
- **P4 (Future-Proof)**: Emerging tech, monitor and pilot

### Roadmap Structure

Divide into 3 phases (adjust based on time horizon):

```
Phase 1: Foundation (Year 1)
  → Digital infrastructure, data governance, pilot use cases
  → Quick wins to build momentum

Phase 2: Scale (Year 2-3)
  → Enterprise rollout of validated capabilities
  → Cross-domain integration

Phase 3: Lead (Year 4-5)
  → Ecosystem expansion, AI-native operations
  → Continuous innovation
```

For each phase, specify:
- Key initiatives (5-8 per phase)
- Deliverables/milestones
- Investment allocation (%)
- Expected business outcomes

## Step 5: Governance & Investment

### Governance Framework

| Element | Design Points |
|:---|:---|
| **Steering Committee** | C-level sponsors, meeting cadence |
| **Program Management Office** | Central vs federated model |
| **Budget Model** | Central funding vs charge-back, innovation fund |
| **Talent Strategy** | Build/buy/partner mix, academy plan |
| **Risk Management** | Top 10 risks with mitigation strategies |
| **Success Metrics** | KPI dashboard, quarterly review cadence |

### Investment Estimation Guidelines

- **Light digitalization** (L1→L2): 0.5-1.5% of revenue
- **Medium transformation** (L2→L3): 1.5-3.5% of revenue
- **Deep transformation** (L3→L4): 3.5-6% of revenue
- Split: 40% technology / 30% talent/change / 20% data / 10% ecosystem

## Output Structure

The final output follows this structure. Populate every section.

```
1. Executive Summary (1 page)
   - Transformation thesis in 3 sentences
   - Key metrics: investment, timeline, expected ROI
   - Critical success factors

2. Strategic Context (2-3 pages)
   - Industry digital trends and benchmarks
   - Competitive landscape analysis
   - Internal capability assessment summary

3. Digital Vision & Target State (3-5 pages)
   - Vision statement
   - Capability blueprint (4-6 capabilities)
   - Target operating model

4. Gap Analysis (2-3 pages)
   - Maturity assessment results
   - Priority capability gaps
   - Root cause analysis

5. Transformation Roadmap (3-5 pages)
   - 3-phase implementation plan
   - Initiative backlog per phase
   - Milestone timeline

6. Governance & Investment (2-3 pages)
   - Organization design
   - Investment plan and business case
   - Risk mitigation
   - KPI framework

7. Appendices
   - Detailed maturity assessment
   - Benchmark data sources
   - Initiative charters (template)
```

## Quality Checklist

Before delivering, verify:

- [ ] Vision statement is specific, measurable, and time-bound
- [ ] Each capability has clear business scenarios (not just tech features)
- [ ] Roadmap phases have realistic sequencing (no foundational gaps)
- [ ] Investment estimate includes change management, not just technology
- [ ] KPIs link to business outcomes, not just IT delivery metrics
- [ ] Governance design addresses who decides, who delivers, who measures
- [ ] Risk section includes legacy system migration and talent retention
- [ ] All external data/references have source citations

## Deliverable Format

This skill produces **structured strategic content** and can hand it to AriaAI generation tools for downloadable deliverables.

- **For PPT delivery**: call `generate_ppt_from_skill` with `skill_name: "digital-strategy"` after the strategic content is complete
- **For document delivery**: Pass content to `docx` skill for document formatting
- **For roadmap visualization**: Generate timeline data in table format, render with `xlsx` skill for Gantt or phased timeline
- **For architecture diagrams**: Use `generate_image` for capability blueprint or target operating model visualization

### PPT Tool Call

When the user asks for a PPT, leadership deck, presentation material, downloadable deliverable, or slide version, always create a slide-by-slide outline first and then call `generate_ppt_from_skill`.

PPT depth standard:

- Build a consulting-grade deck of **20-24 slides** by default, unless the user explicitly asks for fewer pages.
- Every business slide needs an action-oriented title, a clear recommendation, supporting evidence or assumptions, and implications for management.
- Use at least 4-6 substantive bullets per content slide. Avoid placeholder bullets such as "validate with interviews" unless they are attached to a specific question, data source, or decision.
- Include quantified assumptions where exact data is missing: revenue impact range, cost takeout range, investment envelope, timeline, adoption target, KPI baseline and target.
- Include the full storyline: executive answer, context, maturity diagnosis, heatmap, pain-point root causes, target ambition, operating model blueprint, capability blueprint, use-case portfolio, prioritization logic, roadmap, investment case, KPI dashboard, risk controls, governance, 90-day action plan, and appendices.
- Make the deck useful for a consulting partner reviewing client-ready material: each slide should be able to stand alone with enough detail for discussion.
- Add chapter divider slides every 4-6 business pages. Recommended dividers: Executive Alignment, Target Blueprint, Roadmap and Investment, Governance and Mobilization.
- Use `two_column` whenever the page compares current vs target, strengths vs constraints, value vs feasibility, investment vs benefits, or risks vs mitigations.
- Ensure roadmap, capability blueprint, maturity, target operating model, and investment pages contain enough visual keywords and structured bullets for the PPT generator to render richer visual pages.
- Keep the deck language consistent with the user's language. For Chinese requests, write slide titles, bullets, labels, notes, and section names in Chinese; do not mix English labels such as Executive Summary, Current/Target, Foundation/Scale/Lead unless the user explicitly asks for bilingual output.
- Do not pass raw Markdown into the PPT tool. Convert headings, bold text, tables, and long paragraphs into clean slide titles, bullets, two-column text, or structured visual pages.
- Use varied layouts across the deck: `title` for chapter dividers, `content` for argument pages, `two_column` for contrast, `roadmap` for phases, `matrix` for prioritization, `kpi` for scorecards, `risk` for risk registers, and `next_steps` for action plans.

PPT design specification:

- Visual tone: consulting partner review deck, white background, restrained blue/teal accents, clear hierarchy, high whitespace, no decorative gradients or random illustration.
- Canvas: 16:9 executive presentation; each business page must have one main argument, one primary visual structure, and no more than 6 dense bullets.
- Page rhythm:
  - `breathing`: cover, chapter divider, single-message page.
  - `anchor`: executive answer, blueprint, operating model, capability map.
  - `dense`: diagnosis, matrix, roadmap, KPI, risk, appendix.
- Every slide object must include `layout_key`, `page_rhythm`, `visualization_type`, `insight`, and either `content` or `left_content/right_content`.
- `insight` is the page's one-sentence takeaway. It should be written like a slide headline claim, not a topic label.
- `data_points` should contain quantified assumptions, benchmark ranges, KPI targets, or evidence needed for the visual. If exact data is missing, provide explicit assumptions and label them as assumptions.
- `management_implications` should state the decision, trade-off, owner, or governance action required from management.

### Digital Strategy PPT Standard Storyline

Use this richer second-level storyline by default for digital-strategy PPTs. Keep the order stable so the generator can apply chapter dividers, section numbering, visual pages, and lead sentences consistently.

1. 高层共识
   - 执行摘要：把数字化作为业务价值组合来管理
   - 战略背景：数字化窗口期已经从试点转向规模化
   - 战略目标拆解：把业务战略翻译为数字化议题
   - 战略设计原则：哪些事情必须统一，哪些事情允许业务创新

2. 现状诊断
   - 现状诊断：从六个维度识别成熟度短板
   - 成熟度热力图：优势基础与制约因素
   - 痛点根因：区分症状、结构性原因和管理动作
   - 客户与一线声音：把体验问题转化为可改造的流程断点
   - 系统与数据底座诊断：找出规模化复制前必须补齐的短板

3. 目标蓝图
   - 客户与增长体验缺口：优先找到价值泄漏点
   - 数字化愿景与目标状态：形成数据驱动的运营体系
   - 能力蓝图：围绕客户、运营、数据、AI 和平台建设
   - 数据与 AI 架构蓝图：从报表数据走向可运营的数据产品
   - 目标运营模式：把价值、数据、技术和变革责任拆清

4. 场景组合与能力落地
   - 场景组合：平衡快赢、基础能力和战略差异化
   - 场景优先级逻辑：按价值、可行性、依赖和变革准备度排序
   - 首批试点设计：用 3-5 个场景验证价值、数据和组织机制
   - 能力建设包：把单点场景沉淀为可复制的企业能力

5. 路线图与投资
   - 现状与目标状态对比
   - 差距优先级矩阵：先做高价值、低复杂度和可见成果
   - 三阶段路线图：夯实基础、规模复制、领先优化
   - 举措组合与里程碑：每个项目都要有价值、负责人和闸口
   - 收益实现路径：把业务价值拆成可跟踪的领先指标和滞后指标
   - 投资测算与资金机制：用阶段门把投入和价值绑定
   - 投资、KPI 与风险控制：建立可追踪的价值闭环

6. 治理与动员
   - 治理与运营模式：用节奏、责任和指标保证落地
   - 组织与人才机制：把数字化能力嵌入业务岗位和管理节奏
   - 风险登记与缓释计划：提前管理遗留、数据、采用和伙伴风险
   - 90 天行动计划：把共识转成可执行启动方案
   - 立即下一步：确认决策、验证基线并启动首批试点

Each chapter divider should include a short one-sentence lead in white text. Each business slide should include a one-sentence lead below the title, followed by enough structured content for the page to stand alone.

Allowed `layout_key` values:

| layout_key | Use for | Visual discipline |
|---|---|---|
| `executive_summary` | executive answer, high-level thesis | 4 executive cards: thesis, value, priorities, decisions |
| `maturity_heatmap` | maturity diagnosis | 6-dimension maturity grid / heatmap |
| `root_cause` | pain-point analysis | symptom -> structural cause -> management action |
| `target_blueprint` | target-state ambition | target capability map |
| `capability_blueprint` | digital capability blueprint | hub-and-spoke capability system |
| `operating_model` | governance and TOM | role / decision-rights map |
| `portfolio_matrix` | use-case portfolio | 2x2 quick-win / foundation / differentiator / defer matrix |
| `prioritization_matrix` | initiative priority | value vs feasibility matrix |
| `roadmap` | implementation roadmap | 3-phase timeline |
| `investment_kpi` | investment, funding, KPI | 4-card scorecard |
| `risk_register` | risk and mitigation | risk-mitigation paired rows |
| `action_plan` | 90-day plan | week-by-week action timeline |
- 逐页版式意图：
  - 执行摘要 / 战略答案：价值论点卡片 + 管理层决策焦点。
  - 成熟度诊断 / 热力图：六维成熟度网格。
  - 痛点根因：业务症状 -> 结构性原因 -> 管理动作漏斗。
  - 能力蓝图：中心辐射式数字能力地图。
  - 目标运营模式：治理与角色责任图。
  - 场景组合 / 优先级：2x2 组合矩阵。
  - 路线图 / 举措里程碑：三阶段时间线。
  - 投资 / KPI：价值、采用、交付、风险四卡片计分板。
  - 风险登记：风险与缓释动作成对展示。
  - 90 天计划 / 下一步：按周推进的行动时间线。

数字化战略 PPT 标准目录：

默认使用以下 **22 页标准结构**，除非用户明确要求更短、更长或行业定制版本。请保持章节顺序稳定，便于 PPT 生成器按页面类型应用专属版式和图形。

| 页码 | 章节 | 页面类型 | 标准页标题 | 页面目的 |
|------|------|----------|------------|----------|
| 1 | 封面 | title | 数字化转型战略方案 | 明确客户、范围、规划周期和高层汇报语境 |
| 2 | 高层共识 | title | 高层共识 | 作为管理层答案章节的分隔页 |
| 3 | 高层共识 | content | 执行摘要：把数字化作为业务价值组合来管理 | 说明转型论点、价值目标、所需决策和立即请示事项 |
| 4 | 高层共识 | content | 战略背景：数字化窗口期已经从试点转向规模化 | 解释市场、客户、竞争和内部压力点 |
| 5 | 现状诊断 | content | 现状诊断：从六个维度识别成熟度短板 | 评估战略、客户、运营、组织、数据和技术成熟度 |
| 6 | 现状诊断 | matrix | 成熟度热力图：优势基础与制约因素 | 可视化优势、短板和需要高层介入的领域 |
| 7 | 现状诊断 | content | 痛点根因：区分症状、结构性原因和管理动作 | 将观察到的痛点转化为根因和管理动作 |
| 8 | 目标蓝图 | title | 目标蓝图 | 作为目标状态设计章节的分隔页 |
| 9 | 目标蓝图 | content | 客户与增长体验缺口：优先找到价值泄漏点 | 识别客户旅程断点和增长场景 |
| 10 | 目标蓝图 | content | 数字化愿景与目标状态：形成数据驱动的运营体系 | 定义北极星目标、运营原则和目标状态 |
| 11 | 目标蓝图 | content | 能力蓝图：围绕客户、运营、数据、AI 和平台建设 | 展示数字能力地图和关键使能条件 |
| 12 | 目标蓝图 | two_column | 目标运营模式：把价值、数据、技术和变革责任拆清 | 明确角色、决策权、治理节奏和责任边界 |
| 13 | 场景组合 | content | 场景组合：平衡快赢、基础能力和战略差异化 | 构建增长、效率、风险和员工场景组合 |
| 14 | 场景组合 | matrix | 场景优先级逻辑：按价值、可行性、依赖和变革准备度排序 | 用组合矩阵排序举措优先级 |
| 15 | 路线图与投资 | title | 路线图与投资 | 作为实施顺序和资金机制章节的分隔页 |
| 16 | 路线图与投资 | two_column | 现状与目标状态对比 | 展示数据、流程、治理和能力的前后变化 |
| 17 | 路线图与投资 | roadmap | 三阶段路线图：夯实基础、规模复制、领先优化 | 定义三阶段实施路径和管理闸口 |
| 18 | 路线图与投资 | content | 举措组合与里程碑：每个项目都要有价值、负责人和闸口 | 将战略转化为举措组合、负责人和里程碑 |
| 19 | 路线图与投资 | kpi | 投资测算与资金机制：用阶段门把投入和价值绑定 | 说明投资边界、资金模型、收益假设和阶段门 |
| 20 | 治理与动员 | title | 治理与动员 | 作为执行控制章节的分隔页 |
| 21 | 治理与动员 | risk | 风险登记与缓释计划：提前管理遗留、数据、采用和伙伴风险 | 将关键风险与缓释责任人、监控节奏配对 |
| 22 | 治理与动员 | next_steps | 90 天行动计划：把共识转成可执行启动方案 | 定义分周行动、负责人、所需输入和指导委员会决策 |

可选附录页，仅在用户要求更长版本时添加：评估问卷、访谈提纲、基准假设、系统清单、详细举措章程、商业测算模型、KPI 字典和治理 RACI。

```json
{
  "skill_name": "digital-strategy",
  "title": "[公司名称] 数字化转型战略方案",
  "subtitle": "数字化战略、能力蓝图、路线图与治理机制",
  "slides": [
    {
      "type": "content",
      "layout_key": "executive_summary",
      "page_rhythm": "anchor",
      "visualization_type": "executive_summary",
      "title": "执行摘要：把数字化作为业务价值组合来管理",
      "insight": "数字化转型应从零散项目升级为由业务价值、数据能力和治理节奏共同驱动的组合管理机制。",
      "content": "- 战略判断：数字化窗口期已从试点验证转向规模复制\n- 价值目标：用增长、效率、风险和决策速度四类 KPI 衡量转型\n- 优先动作：先补数据基础，再推进高价值场景和流程重构\n- 高层决策：确认范围、资金、负责人和第一批试点",
      "data_points": ["假设：3 年投资强度为收入的 1.5%-3.5%", "目标：首年形成 3-5 个可量化价值样板"],
      "management_implications": ["需要指导委员会确认投资边界和跨部门决策权"]
    },
    {
      "type": "two_column",
      "layout_key": "operating_model",
      "page_rhythm": "anchor",
      "visualization_type": "operating_model",
      "title": "目标运营模式：把价值、数据、技术和变革责任拆清",
      "insight": "目标运营模式的关键不是新增组织层级，而是把业务价值、数据责任、平台能力和采用率责任绑定到同一套节奏。",
      "left_content": "当前状态\n- 价值目标与项目交付脱节\n- 数据口径和质量责任不清\n- 技术平台重复建设\n- 一线采用率缺少责任人",
      "right_content": "目标状态\n- 业务负责人拥有价值和采用率 KPI\n- 数据负责人管理口径、质量和权限\n- 技术团队提供平台与安全护栏\n- PMO 跟踪组合价值和依赖风险",
      "management_implications": ["需要明确转型 PMO、业务 Owner、数据 Owner 和技术平台团队的 RACI"]
    }
  ]
}
```

推荐 PPT 结构：默认使用上方 22 页标准目录。如果用户要求 20-24 页，保持同一顺序，只在第 22 页后追加可选附录页。

## Dependencies

- `generate_ppt_from_skill` - creates `.pptx` files through AriaAI's `python-pptx` backend tool
- Optional template: place `KPMG-Template.pptx` or `template.pptx` under `assets/` or `references/`; without a template, AriaAI falls back to the default PPT layout

## References

- **Framework details**: See `references/frameworks.md` for expanded methodology descriptions, assessment questionnaires, and benchmark data
- **Industry notes**: See `references/industry-notes.md` for industry-specific digital transformation patterns, KPI benchmarks, and common pitfalls
