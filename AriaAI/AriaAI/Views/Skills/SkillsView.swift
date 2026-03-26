import SwiftUI

// MARK: - Skill Template (built-in catalog)
struct SkillTemplate: Identifiable {
    let id = UUID()
    let name: String
    let nameEn: String
    let description: String
    let descriptionEn: String
    let category: String
    let estimatedTime: String
    let estimatedTimeEn: String
    let tools: [String]
    let systemPrompt: String
    let userTemplate: String
    let icon: String
    let iconColor: String

    // A. 战略与增长
    static let strategySkills: [SkillTemplate] = [
        SkillTemplate(name: "SWOT / PESTLE 分析", nameEn: "SWOT / PESTLE Analysis",
            description: "系统梳理优势、劣势、机会、威胁与宏观环境六要素，生成结构化战略报告",
            descriptionEn: "Systematically analyze SWOT and PESTLE factors for a structured strategy report",
            category: "战略与增长", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["战略分析", "报告生成"],
            systemPrompt: "你是顶级战略咨询顾问。请对用户提供的主题进行深入的 SWOT 与 PESTLE 分析，每个维度至少给出 3 个具体要点，最后给出战略建议。输出结构化 Markdown 报告。",
            userTemplate: "请对以下主题进行 SWOT / PESTLE 分析：\n\n主题：[公司/产品/项目名称]\n行业背景：[简要描述]\n\n请输出完整分析报告及战略建议。",
            icon: "chart.bar.xaxis", iconColor: "#6366F1"),
        SkillTemplate(name: "Porter 五力分析", nameEn: "Porter's Five Forces",
            description: "评估行业竞争烈度与盈利空间，识别结构性机会与威胁",
            descriptionEn: "Assess industry competitive intensity and structural opportunities using Porter's Five Forces",
            category: "战略与增长", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["战略分析"],
            systemPrompt: "你是资深战略顾问，精通 Porter 五力模型。请对目标行业从供应商议价能力、买方议价能力、潜在进入者威胁、替代品威胁、现有竞争者五个维度深入分析，给出行业吸引力评分与战略含义。",
            userTemplate: "请对以下行业进行 Porter 五力分析：\n\n行业：[填写]\n目标公司（可选）：[填写]\n\n请输出五力分析报告及战略建议。",
            icon: "star.circle", iconColor: "#6366F1"),
        SkillTemplate(name: "BCG 矩阵分析", nameEn: "BCG Matrix Analysis",
            description: "对业务组合进行四象限分类，生成资源配置优先级建议",
            descriptionEn: "Classify business portfolio into four quadrants with resource allocation recommendations",
            category: "战略与增长", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["战略分析", "数据分析"],
            systemPrompt: "你是战略咨询顾问，擅长投资组合分析。请根据用户提供的业务信息，绘制 BCG 矩阵（明星/现金牛/问题/瘦狗），并给出各业务单元的资源配置建议。",
            userTemplate: "请对以下业务组合进行 BCG 矩阵分析：\n\n公司：[填写]\n业务单元列表：\n- [业务1：市场增速X%，市占率Y%]\n- [业务2：...]\n\n请输出矩阵分析及优先级建议。",
            icon: "square.grid.2x2", iconColor: "#6366F1"),
        SkillTemplate(name: "增长战略评估", nameEn: "Growth Strategy Assessment",
            description: "评估有机增长、并购、合作等多种增长路径，生成优先级矩阵",
            descriptionEn: "Evaluate organic growth, M&A, partnerships and other paths with a prioritization matrix",
            category: "战略与增长", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["战略分析"],
            systemPrompt: "你是资深增长战略顾问。请系统评估有机增长（产品/市场/客户扩张）、无机增长（并购/合作）等多种增长路径，从可行性、影响力、资源需求三个维度评分，输出增长路径优先级矩阵及建议。",
            userTemplate: "请评估以下公司的增长战略选项：\n\n公司：[填写]\n当前业务：[简述]\n增长目标：[填写]\n资源约束：[填写]\n\n请输出增长路径矩阵及推荐方案。",
            icon: "arrow.up.right.circle", iconColor: "#6366F1"),
        SkillTemplate(name: "竞争格局全景分析", nameEn: "Competitive Landscape Analysis",
            description: "系统梳理行业主要玩家的定位、策略与差异化，识别白空间机会",
            descriptionEn: "Map key players' positioning, strategies and differentiation to identify white-space opportunities",
            category: "战略与增长", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["市场研究", "数据分析"],
            systemPrompt: "你是资深市场研究分析师。请对目标行业进行竞争格局全景分析：梳理主要玩家定位、产品/服务范围、定价策略、目标客群、核心优劣势，用对比矩阵呈现，并识别未被充分服务的细分市场。",
            userTemplate: "请对以下行业进行竞争格局分析：\n\n行业/细分市场：[填写]\n我方公司：[填写]\n主要竞争对手：[列举]\n\n请输出竞争全景报告及差异化建议。",
            icon: "person.3.fill", iconColor: "#6366F1"),
        SkillTemplate(name: "市场规模测算（TAM/SAM/SOM）", nameEn: "Market Sizing (TAM/SAM/SOM)",
            description: "用自上而下与自下而上双路径测算市场总量、可服务市场与可获取份额",
            descriptionEn: "Estimate TAM/SAM/SOM using top-down and bottom-up approaches",
            category: "战略与增长", estimatedTime: "20–30 分钟", estimatedTimeEn: "20–30 min",
            tools: ["市场研究", "数据分析"],
            systemPrompt: "你是市场研究专家，擅长市场规模测算。请分别用自上而下（行业报告拆解）和自下而上（客户数量×ARPU）两种方法测算 TAM、SAM、SOM，列出关键假设，给出合理区间估算。",
            userTemplate: "请测算以下市场规模：\n\n目标市场：[填写]\n地区范围：[填写]\n核心产品/服务：[填写]\n已知数据：[填写相关数据点]\n\n请输出 TAM/SAM/SOM 测算模型及报告。",
            icon: "chart.pie.fill", iconColor: "#6366F1"),
        SkillTemplate(name: "市场进入策略", nameEn: "Market Entry Strategy",
            description: "评估进入新市场的时机、路径、风险与资源需求，形成可执行方案",
            descriptionEn: "Assess timing, entry modes, risks and resources for entering a new market",
            category: "战略与增长", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["战略分析", "市场研究"],
            systemPrompt: "你是市场进入战略专家。请评估以下维度：市场吸引力（规模/增速/竞争）、进入模式选择（有机/并购/合作/授权）、目标客户与定位、所需能力与资源、风险与应对措施，输出可执行的市场进入方案。",
            userTemplate: "请制定以下市场进入策略：\n\n目标市场：[填写]\n目标地区：[填写]\n我方核心优势：[填写]\n资源约束：[填写]\n\n请输出市场进入策略报告。",
            icon: "map.fill", iconColor: "#6366F1"),
    ]

    // B. 运营与效能
    static let operationsSkills: [SkillTemplate] = [
        SkillTemplate(name: "SOP 标准流程编写", nameEn: "SOP Documentation",
            description: "将业务流程规范化为标准作业程序文档，明确步骤、责任人与质量标准",
            descriptionEn: "Standardize business processes into clear SOPs with steps, owners and quality criteria",
            category: "运营与效能", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["文档生成"],
            systemPrompt: "你是流程改善专家。请根据用户描述，编写规范的 SOP 文档，包含：目的与范围、触发条件、详细步骤（含责任人、时间要求、工具）、质量检查点、异常处理、相关文件。",
            userTemplate: "请为以下流程编写 SOP：\n\n流程名称：[填写]\n流程描述：[描述流程大致步骤]\n参与角色：[填写]\n主要输出：[填写]\n\n请输出标准 SOP 文档。",
            icon: "list.number", iconColor: "#10B981"),
        SkillTemplate(name: "KPI 体系设计", nameEn: "KPI Framework Design",
            description: "为业务目标设计层次清晰、可量化的 KPI 指标体系",
            descriptionEn: "Design a hierarchical and measurable KPI framework aligned with business objectives",
            category: "运营与效能", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["战略分析"],
            systemPrompt: "你是绩效管理顾问。请根据用户提供的业务目标，设计层次清晰的 KPI 体系：战略目标→关键结果→具体 KPI（含定义、计算公式、数据来源、目标值、频率）。确保指标 SMART 且可落地。",
            userTemplate: "请为以下业务设计 KPI 体系：\n\n公司/部门：[填写]\n战略目标：[填写]\n业务阶段：[填写]\n\n请输出 KPI 指标体系文档。",
            icon: "chart.line.uptrend.xyaxis", iconColor: "#10B981"),
        SkillTemplate(name: "快赢机会识别", nameEn: "Quick Win Identification",
            description: "从成本、效率、收入三个维度识别 90 天内可落地的快赢举措",
            descriptionEn: "Identify 90-day quick wins across cost, efficiency and revenue dimensions",
            category: "运营与效能", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["战略分析"],
            systemPrompt: "你是运营改善顾问，专注快赢机会挖掘。请从成本削减、效率提升、收入增长三个维度，识别 90 天内可落地的快赢举措，每项需说明：问题描述、改善措施、预期影响（量化）、所需资源、实施难度。",
            userTemplate: "请识别以下业务的快赢机会：\n\n公司/部门：[填写]\n当前主要痛点：[描述]\n可动用资源：[填写]\n\n请输出优先行动清单（按影响力×可行性排序）。",
            icon: "bolt.circle.fill", iconColor: "#10B981"),
        SkillTemplate(name: "流程优化（As-Is → To-Be）", nameEn: "Process Optimization",
            description: "诊断现有流程的浪费与瓶颈，设计优化后的目标流程并量化收益",
            descriptionEn: "Diagnose waste and bottlenecks in current processes and design optimized target state",
            category: "运营与效能", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["流程分析", "数据分析"],
            systemPrompt: "你是精益运营专家。请分析现有流程（As-Is）：识别浪费（等待/重复/错误）、瓶颈与根本原因；设计优化流程（To-Be）；量化改善收益（时间/成本/质量）；提供实施路径与变革管理要点。",
            userTemplate: "请优化以下业务流程：\n\n流程名称：[填写]\n现有流程描述：[详述当前步骤]\n主要问题：[描述痛点]\n改善目标：[填写]\n\n请输出 As-Is/To-Be 流程对比及改善方案。",
            icon: "arrow.triangle.2.circlepath.circle", iconColor: "#10B981"),
        SkillTemplate(name: "成本削减方案", nameEn: "Cost Reduction Program",
            description: "系统分析成本结构，制定分阶段降本路线图",
            descriptionEn: "Systematically analyze cost structure and develop a phased cost reduction roadmap",
            category: "运营与效能", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["财务分析", "运营分析"],
            systemPrompt: "你是成本管理专家。请对目标公司进行成本结构分析（Pareto）、标杆对比、降本机会识别（直接成本/间接成本/资本支出），按照影响力与可行性排序，制定分阶段降本路线图并量化目标。",
            userTemplate: "请制定成本削减方案：\n\n公司/业务：[填写]\n当前成本结构：[填写主要成本项]\n目标降幅：[填写]\n时间范围：[填写]\n\n请输出成本分析及削减路线图。",
            icon: "arrow.down.circle.fill", iconColor: "#10B981"),
    ]

    // C. 财务咨询
    static let financeSkills: [SkillTemplate] = [
        SkillTemplate(name: "场景分析（Base/Bull/Bear）", nameEn: "Scenario Analysis",
            description: "构建三情景财务预测模型，量化不同假设下的业绩区间",
            descriptionEn: "Build three-scenario financial models to quantify performance ranges under different assumptions",
            category: "财务咨询", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["财务分析", "数据分析"],
            systemPrompt: "你是资深财务顾问。请基于用户提供的信息，构建 Base/Bull/Bear 三情景分析：明确各情景的核心假设差异、关键驱动因素、财务影响（收入/利润/现金流），输出情景对比矩阵与关键风险提示。",
            userTemplate: "请构建以下业务的场景分析：\n\n业务描述：[填写]\n主要驱动因素：[填写]\n基准预测：[填写]\n时间范围：[填写]\n\n请输出三情景对比分析文档。",
            icon: "chart.bar.fill", iconColor: "#F59E0B"),
        SkillTemplate(name: "商业案例（Business Case）", nameEn: "Business Case",
            description: "量化投资回报与风险，支持管理层决策的完整 Business Case 文档",
            descriptionEn: "Quantify ROI and risks for a complete Business Case supporting management decisions",
            category: "财务咨询", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["财务分析", "报告生成"],
            systemPrompt: "你是商业案例分析专家。请构建完整 Business Case：背景与问题陈述、方案描述、成本效益分析（NPV/IRR/回收期）、风险评估、实施计划、成功指标，并给出明确的投资建议。",
            userTemplate: "请构建以下项目的 Business Case：\n\n项目名称：[填写]\n投资金额：[填写]\n预期收益：[描述]\n时间范围：[填写]\n\n请输出完整 Business Case 文档。",
            icon: "doc.richtext.fill", iconColor: "#F59E0B"),
        SkillTemplate(name: "财务健康诊断", nameEn: "Financial Health Diagnosis",
            description: "全面分析盈利能力、流动性、偿债能力与经营效率，识别财务风险",
            descriptionEn: "Comprehensive analysis of profitability, liquidity, solvency and efficiency to identify financial risks",
            category: "财务咨询", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["财务分析"],
            systemPrompt: "你是财务诊断专家。请从盈利能力（毛利/净利/EBITDA）、流动性（流动比率/速动比率）、偿债能力（负债率/利息覆盖）、经营效率（存货/应收/资产周转）四个维度全面诊断，与行业标杆对比，识别核心风险并给出改善建议。",
            userTemplate: "请对以下公司进行财务健康诊断：\n\n公司：[填写]\n财务数据：\n- 收入：[填写]\n- 净利润：[填写]\n- 资产负债表关键数据：[填写]\n\n请输出财务诊断报告。",
            icon: "stethoscope", iconColor: "#F59E0B"),
    ]

    // D. 并购与交易
    static let maSkills: [SkillTemplate] = [
        SkillTemplate(name: "投资论文（Investment Thesis）", nameEn: "Investment Thesis",
            description: "构建清晰的投资逻辑，说明为什么投、投什么、如何创造价值",
            descriptionEn: "Build a clear investment thesis explaining why, what and how to create value",
            category: "并购与交易", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["战略分析", "财务分析"],
            systemPrompt: "你是私募投资专家。请构建结构化的投资论文：市场机会（规模/趋势）、标的优势（护城河/团队/财务）、价值创造路径（增长/效率/多重扩张）、关键风险与应对、退出路径与回报预期。",
            userTemplate: "请构建以下投资标的的 Investment Thesis：\n\n公司/项目：[填写]\n行业：[填写]\n投资阶段：[填写]\n已知信息：[填写]\n\n请输出投资逻辑文档。",
            icon: "arrow.up.forward.circle.fill", iconColor: "#8B5CF6"),
        SkillTemplate(name: "商业尽职调查（CDD）", nameEn: "Commercial Due Diligence",
            description: "深度评估目标公司的市场地位、商业模式可持续性与增长潜力",
            descriptionEn: "In-depth assessment of target company's market position, business model sustainability and growth potential",
            category: "并购与交易", estimatedTime: "35–45 分钟", estimatedTimeEn: "35–45 min",
            tools: ["市场研究", "财务分析", "风险评估"],
            systemPrompt: "你是投资银行资深 CDD 专家。请系统评估：市场吸引力与增速、竞争地位与护城河、客户质量与集中度、收入可持续性与增长驱动、管理团队能力、关键风险（监管/技术/竞争）。输出完整 CDD 报告。",
            userTemplate: "请对以下标的进行商业尽职调查：\n\n公司名称：[填写]\n行业：[填写]\n已知信息：[填写公司背景、财务数据等]\n投资目的：[填写]\n\n请输出完整 CDD 报告。",
            icon: "magnifyingglass.circle.fill", iconColor: "#8B5CF6"),
        SkillTemplate(name: "并购整合计划（PMI）", nameEn: "Post-Merger Integration Plan",
            description: "制定并购完成后 Day 1 至 100 天的系统整合计划",
            descriptionEn: "Develop Day 1 to 100-day systematic integration plan after M&A completion",
            category: "并购与交易", estimatedTime: "30–40 分钟", estimatedTimeEn: "30–40 min",
            tools: ["项目管理", "变革管理"],
            systemPrompt: "你是并购整合专家。请制定系统 PMI 计划：整合目标与原则、Day 1 清单（法律/IT/HR/财务/客户通知）、100 天优先事项（协同效应实现/组织设计/文化融合）、关键里程碑、风险管控。",
            userTemplate: "请制定以下并购的整合计划：\n\n收购方：[填写]\n被收购方：[填写]\n交割时间：[填写]\n主要整合目标：[填写]\n\n请输出 Day 1 至 100 天 PMI 计划。",
            icon: "link.circle.fill", iconColor: "#8B5CF6"),
        SkillTemplate(name: "协同效应分析", nameEn: "Synergy Analysis",
            description: "量化并购的收入协同、成本协同与财务协同，建立实现路径",
            descriptionEn: "Quantify revenue, cost and financial synergies from M&A with realization roadmap",
            category: "并购与交易", estimatedTime: "20–25 分钟", estimatedTimeEn: "20–25 min",
            tools: ["财务分析"],
            systemPrompt: "你是并购协同分析专家。请量化三类协同效应：收入协同（交叉销售/定价提升/新市场）、成本协同（采购/运营/管理费用）、财务协同（税务/资本成本）。提供实现时间表、主要假设与风险。",
            userTemplate: "请分析以下并购的协同效应：\n\n收购方业务：[填写]\n目标方业务：[填写]\n交易目的：[填写]\n\n请输出协同效益分析文档。",
            icon: "plus.circle.fill", iconColor: "#8B5CF6"),
    ]

    // E. 数字化与技术
    static let digitalSkills: [SkillTemplate] = [
        SkillTemplate(name: "AI 用例优先级矩阵", nameEn: "AI Use Case Prioritization",
            description: "识别并评估企业 AI 应用场景，按价值与可行性生成优先级矩阵",
            descriptionEn: "Identify and evaluate AI use cases, generating a value-vs-feasibility prioritization matrix",
            category: "数字化与技术", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["AI 战略", "数字化转型"],
            systemPrompt: "你是企业 AI 战略顾问。请识别目标公司最具潜力的 AI 应用场景，从业务价值（效率/收入/体验）和实施可行性（数据/技术/组织）两个维度评分，生成优先级矩阵，并给出推荐的 Quick Win 起步项目。",
            userTemplate: "请为以下公司识别 AI 应用机会：\n\n公司/行业：[填写]\n业务描述：[填写]\n当前技术能力：[填写]\n\n请输出 AI 用例优先级矩阵。",
            icon: "cpu.fill", iconColor: "#3B82F6"),
        SkillTemplate(name: "数字化成熟度评估", nameEn: "Digital Maturity Assessment",
            description: "评估企业在数据、技术、流程、组织四个维度的数字化成熟度",
            descriptionEn: "Assess digital maturity across data, technology, processes and organization dimensions",
            category: "数字化与技术", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["数字化转型", "组织评估"],
            systemPrompt: "你是数字化转型专家。请设计并完成数字化成熟度评估问卷，从数据与分析、技术基础设施、流程数字化、组织能力与文化四个维度评分（1-5），与行业最佳实践对比，识别关键差距并给出提升路径。",
            userTemplate: "请评估以下公司的数字化成熟度：\n\n公司：[填写]\n行业：[填写]\n当前数字化状况：[简述]\n\n请输出成熟度评估报告及提升建议。",
            icon: "gauge.open.with.lines.needle.33percent", iconColor: "#3B82F6"),
        SkillTemplate(name: "数字化转型路线图", nameEn: "Digital Transformation Roadmap",
            description: "制定企业数字化转型的分阶段实施路线图，含技术选型与组织变革",
            descriptionEn: "Develop phased digital transformation roadmap with technology choices and organizational change",
            category: "数字化与技术", estimatedTime: "35–45 分钟", estimatedTimeEn: "35–45 min",
            tools: ["数字化转型", "项目管理"],
            systemPrompt: "你是数字化转型战略专家。请制定系统转型路线图：现状诊断与差距分析、转型愿景与目标、分阶段实施计划（0-6月/6-18月/18-36月）、技术架构建议、组织与人才变革、投资估算与 ROI 预测。",
            userTemplate: "请制定以下公司的数字化转型路线图：\n\n公司：[填写]\n行业：[填写]\n战略目标：[填写]\n当前挑战：[填写]\n\n请输出三年转型路线图。",
            icon: "road.lanes", iconColor: "#3B82F6"),
        SkillTemplate(name: "系统选型评估", nameEn: "System Selection Evaluation",
            description: "对多个候选系统进行结构化评估，生成加权评分矩阵与推荐建议",
            descriptionEn: "Structured evaluation of candidate systems with weighted scoring matrix and recommendation",
            category: "数字化与技术", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["技术评估"],
            systemPrompt: "你是企业系统选型专家。请根据业务需求，设计评估框架（功能匹配度/技术成熟度/实施成本/供应商实力/集成难度），对候选系统进行加权评分，给出推荐结论与实施注意事项。",
            userTemplate: "请评估以下系统选型：\n\n业务需求：[填写]\n候选系统：[列举]\n关键评估维度：[填写]\n预算范围：[填写]\n\n请输出系统选型评估报告。",
            icon: "server.rack", iconColor: "#3B82F6"),
    ]

    // F. 风险与合规
    static let riskSkills: [SkillTemplate] = [
        SkillTemplate(name: "风险评估矩阵", nameEn: "Risk Assessment Matrix",
            description: "识别并量化业务风险，按概率×影响力生成优先级热力图及应对措施",
            descriptionEn: "Identify and quantify business risks with probability-impact heat map and mitigation actions",
            category: "风险与合规", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["风险管理"],
            systemPrompt: "你是企业风险管理专家。请识别目标业务/项目的主要风险（战略/运营/财务/合规/声誉），按概率（1-5）和影响（1-5）评分，生成风险热力图，并为高优先级风险设计缓解措施和应急预案。",
            userTemplate: "请对以下业务/项目进行风险评估：\n\n业务/项目：[填写]\n背景：[简述]\n已识别的潜在风险：[填写]\n\n请输出风险评估矩阵及应对措施。",
            icon: "exclamationmark.shield.fill", iconColor: "#EF4444"),
        SkillTemplate(name: "ESG 评估框架", nameEn: "ESG Assessment Framework",
            description: "从环境、社会、治理三个维度评估企业 ESG 现状，制定改善路径",
            descriptionEn: "Assess current ESG performance across Environmental, Social and Governance dimensions with improvement roadmap",
            category: "风险与合规", estimatedTime: "30–40 分钟", estimatedTimeEn: "30–40 min",
            tools: ["ESG", "合规"],
            systemPrompt: "你是 ESG 咨询专家。请对目标公司进行全面 ESG 评估：环境（碳排放/能源/废弃物）、社会（劳工/供应链/社区）、治理（董事会/透明度/反腐）三个维度，与行业标准和 ESG 评级框架对比，识别关键差距并制定提升路线图。",
            userTemplate: "请对以下公司进行 ESG 评估：\n\n公司：[填写]\n行业：[填写]\n当前 ESG 实践：[简述]\n\n请输出 ESG 评估报告及改善路径。",
            icon: "leaf.circle.fill", iconColor: "#EF4444"),
        SkillTemplate(name: "合规审查清单", nameEn: "Compliance Review Checklist",
            description: "针对特定行业/地区生成监管要求对照清单，识别合规缺口",
            descriptionEn: "Generate regulatory compliance checklist for specific industry/region to identify compliance gaps",
            category: "风险与合规", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["合规", "法律"],
            systemPrompt: "你是合规管理专家。请针对目标行业和地区，梳理适用的主要监管要求，生成结构化合规审查清单（含监管条款、要求内容、当前状态、整改建议），识别高风险合规缺口。",
            userTemplate: "请生成以下合规审查清单：\n\n行业：[填写]\n地区/司法管辖：[填写]\n业务类型：[填写]\n\n请输出监管要求对照清单及合规缺口分析。",
            icon: "checkmark.shield.fill", iconColor: "#EF4444"),
    ]

    // G. 组织与人才
    static let orgSkills: [SkillTemplate] = [
        SkillTemplate(name: "OKR 目标体系设计", nameEn: "OKR Framework Design",
            description: "为公司或团队设计对齐战略的 OKR 体系，包含目标分解与追踪机制",
            descriptionEn: "Design strategy-aligned OKR framework with objective breakdown and tracking mechanism",
            category: "组织与人才", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["绩效管理"],
            systemPrompt: "你是 OKR 推行专家。请根据战略目标，设计从公司层到团队层的 OKR 体系：年度目标→季度 O&KR（每个目标 2-4 个 KR，量化、有挑战性）、对齐逻辑说明、追踪频率与复盘机制。",
            userTemplate: "请为以下公司/团队设计 OKR 体系：\n\n公司/团队：[填写]\n战略目标：[填写]\n时间范围：[季度/年度]\n\n请输出 OKR 框架及说明。",
            icon: "target", iconColor: "#EC4899"),
        SkillTemplate(name: "组织架构设计", nameEn: "Organization Design",
            description: "根据战略与规模设计最优组织架构，平衡效率与协作",
            descriptionEn: "Design optimal org structure aligned with strategy and scale, balancing efficiency and collaboration",
            category: "组织与人才", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["组织设计", "战略分析"],
            systemPrompt: "你是组织设计专家。请根据公司战略和规模，评估职能型/事业部型/矩阵型等多种组织结构的优劣，推荐最优方案：汇报关系设计、职责边界划分、跨部门协作机制、关键岗位设置，并给出过渡计划。",
            userTemplate: "请设计以下公司的组织架构：\n\n公司：[填写]\n规模：[填写员工数]\n战略重点：[填写]\n当前组织问题：[描述]\n\n请输出组织架构设计方案。",
            icon: "person.3.sequence.fill", iconColor: "#EC4899"),
        SkillTemplate(name: "变革管理计划", nameEn: "Change Management Plan",
            description: "设计系统性变革管理方案，最大化变革成功率并降低阻力",
            descriptionEn: "Design systematic change management plan to maximize success rate and minimize resistance",
            category: "组织与人才", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["变革管理", "组织行为"],
            systemPrompt: "你是变革管理专家，精通 Kotter 8 步法和 ADKAR 模型。请制定系统变革管理计划：变革必要性宣导、领导层对齐、关键影响者地图、沟通计划（受众/信息/渠道/频率）、培训计划、阻力识别与应对、成功指标追踪。",
            userTemplate: "请制定以下变革的管理计划：\n\n变革内容：[描述变革]\n影响范围：[填写受影响人员]\n时间周期：[填写]\n主要阻力：[预估]\n\n请输出变革管理计划。",
            icon: "arrow.triangle.2.circlepath.circle.fill", iconColor: "#EC4899"),
        SkillTemplate(name: "员工调研问卷设计", nameEn: "Employee Survey Design",
            description: "设计结构化员工调研问卷，从敬业度、满意度与组织健康度维度收集洞察",
            descriptionEn: "Design structured employee survey covering engagement, satisfaction and organizational health",
            category: "组织与人才", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["调研设计"],
            systemPrompt: "你是组织效能专家。请设计专业的员工调研问卷：覆盖敬业度（Gallup Q12 参考）、工作满意度、管理质量、组织文化、改善建议等维度，问题简洁精准（20-30题），附带结果分析框架。",
            userTemplate: "请设计员工调研问卷：\n\n调研目的：[填写]\n重点关注维度：[填写]\n目标人群：[填写]\n\n请输出完整调研问卷及分析框架。",
            icon: "person.fill.questionmark", iconColor: "#EC4899"),
    ]

    // H. 市场与客户
    static let marketingSkills: [SkillTemplate] = [
        SkillTemplate(name: "客户细分模型", nameEn: "Customer Segmentation",
            description: "基于行为、需求与价值多维度细分客户群体，生成用户画像",
            descriptionEn: "Multi-dimensional customer segmentation by behavior, needs and value with persona profiles",
            category: "市场与客户", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["市场研究", "数据分析"],
            systemPrompt: "你是市场营销专家，擅长客户细分。请根据用户提供的信息，从人口特征、行为特征、需求特征、价值贡献四个维度设计客户细分框架，识别 3-5 个关键细分群体，为每个群体建立用户画像，并给出差异化服务策略。",
            userTemplate: "请为以下业务设计客户细分模型：\n\n业务：[填写]\n已有客户数据：[描述]\n细分目的：[填写]\n\n请输出细分框架、用户画像及差异化策略。",
            icon: "person.crop.circle.badge.checkmark", iconColor: "#06B6D4"),
        SkillTemplate(name: "客户旅程图", nameEn: "Customer Journey Map",
            description: "可视化客户从认知到购买到忠诚的全旅程，识别关键触点与改善机会",
            descriptionEn: "Visualize the end-to-end customer journey from awareness to loyalty, identifying key touchpoints and improvement opportunities",
            category: "市场与客户", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["用户研究"],
            systemPrompt: "你是用户体验专家。请绘制目标客群的完整客户旅程图：各阶段（认知/考虑/购买/使用/忠诚）的客户行为、情绪曲线、关键触点、痛点与 Moments of Truth，识别最高价值的改善机会。",
            userTemplate: "请绘制以下业务的客户旅程图：\n\n业务/产品：[填写]\n目标客群：[描述]\n重点改善阶段：[可选]\n\n请输出客户旅程地图及改善建议。",
            icon: "map.circle.fill", iconColor: "#06B6D4"),
        SkillTemplate(name: "GTM 策略制定", nameEn: "Go-to-Market Strategy",
            description: "制定新产品/新市场进入的完整 Go-to-Market 执行手册",
            descriptionEn: "Develop comprehensive Go-to-Market execution playbook for new product or market entry",
            category: "市场与客户", estimatedTime: "30–40 分钟", estimatedTimeEn: "30–40 min",
            tools: ["市场营销", "战略规划"],
            systemPrompt: "你是 GTM 战略专家。请制定系统 GTM 计划：目标市场与客户定义、价值主张与差异化定位、定价策略、渠道选择、销售运动（Sales Motion）、营销计划、关键里程碑与成功指标。",
            userTemplate: "请制定以下产品/市场的 GTM 策略：\n\n产品/服务：[填写]\n目标市场：[填写]\n竞争优势：[填写]\n资源限制：[填写]\n\n请输出 GTM 执行手册。",
            icon: "arrow.forward.circle.fill", iconColor: "#06B6D4"),
        SkillTemplate(name: "定价策略分析", nameEn: "Pricing Strategy Analysis",
            description: "评估多种定价模式，基于客户价值与竞争格局制定最优定价策略",
            descriptionEn: "Evaluate pricing models and develop optimal pricing strategy based on customer value and competitive landscape",
            category: "市场与客户", estimatedTime: "20–30 分钟", estimatedTimeEn: "20–30 min",
            tools: ["定价策略", "市场分析"],
            systemPrompt: "你是定价策略顾问。请分析：客户支付意愿（WTP）与价值感知、竞争对手定价对标、成本结构约束、定价模式选择（订阅/交易/基于价值/Freemium），制定定价策略并预测收入影响。",
            userTemplate: "请分析以下产品的定价策略：\n\n产品/服务：[填写]\n目标客群：[填写]\n竞争对手定价：[填写]\n成本结构：[填写]\n\n请输出定价策略分析及建议。",
            icon: "tag.circle.fill", iconColor: "#06B6D4"),
    ]

    // I. 提案与项目交付（通用工具）
    static let deliverySkills: [SkillTemplate] = [
        SkillTemplate(name: "会议纪要生成", nameEn: "Meeting Minutes",
            description: "将会议记录转化为结构化纪要，提取决策、行动项与责任人",
            descriptionEn: "Transform meeting notes into structured minutes with decisions, action items and owners",
            category: "提案与项目交付", estimatedTime: "5–10 分钟", estimatedTimeEn: "5–10 min",
            tools: ["文本处理"],
            systemPrompt: "你是专业会议纪要助手。请将会议记录整理为结构化纪要：会议概述（时间/参与者/目的）、讨论议题摘要、关键决策、行动项清单（含负责人+截止日期）、下次会议安排。语言简洁，突出行动导向。",
            userTemplate: "请整理以下会议记录：\n\n会议时间：[填写]\n参会人员：[填写]\n\n会议内容：\n[粘贴会议记录]\n\n请输出结构化纪要。",
            icon: "list.bullet.clipboard.fill", iconColor: "#64748B"),
        SkillTemplate(name: "PPT 内容润色", nameEn: "Deck Content Polish",
            description: "按照顾问写作规范（Pyramid Principle）润色 PPT 文字，使表达更专业有力",
            descriptionEn: "Polish deck content following Pyramid Principle and consulting writing standards",
            category: "提案与项目交付", estimatedTime: "5–10 分钟", estimatedTimeEn: "5–10 min",
            tools: ["商务写作"],
            systemPrompt: "你是顶级咨询公司 PPT 写作专家，精通 Pyramid Principle。请按照顾问写作规范润色文字：每个要点直接给出结论（BLUF），用数字和具体事实支撑，删除模糊表述，动词主动且有力，保持每条 bullet ≤20 字。",
            userTemplate: "请润色以下 PPT 内容：\n\n页面主题：[填写]\n原始内容：\n[粘贴 PPT 文字]\n\n请输出顾问化改写版本，并说明修改逻辑。",
            icon: "pencil.and.sparkles", iconColor: "#64748B"),
        SkillTemplate(name: "执行摘要", nameEn: "Executive Summary",
            description: "从长篇文档中提炼核心发现与建议，生成 1-2 页高管可读的执行摘要",
            descriptionEn: "Distill key findings and recommendations from lengthy documents into a 1-2 page executive summary",
            category: "提案与项目交付", estimatedTime: "5–10 分钟", estimatedTimeEn: "5–10 min",
            tools: ["摘要生成"],
            systemPrompt: "你是资深报告撰写专家。请将输入内容提炼为高质量执行摘要：情境/问题陈述（1-2句）、核心发现（3-5个关键洞察，每条有数据支撑）、战略建议（2-4个可行建议，按优先级排序）、下一步行动。总字数控制在 400-600 字。",
            userTemplate: "请为以下内容生成执行摘要：\n\n文档类型：[填写报告名称]\n核心内容：\n[粘贴需要摘要的内容]\n\n请输出 1-2 页执行摘要。",
            icon: "doc.text.magnifyingglass", iconColor: "#64748B"),
        SkillTemplate(name: "访谈提纲生成", nameEn: "Interview Guide",
            description: "针对特定研究目的生成结构化访谈提纲，涵盖开场、主题与追问",
            descriptionEn: "Generate structured interview guides for specific research objectives with opening, themes and probes",
            category: "提案与项目交付", estimatedTime: "5–10 分钟", estimatedTimeEn: "5–10 min",
            tools: ["调研设计"],
            systemPrompt: "你是定性研究专家。请生成专业访谈提纲：访谈目的说明（供访谈者参考）、开场白（建立信任）、3-5 个核心主题（每个主题 2-3 个主问题+追问探索句）、结束语与感谢。问题开放性强，避免引导性。",
            userTemplate: "请生成以下访谈提纲：\n\n访谈目的：[填写]\n受访对象：[描述职位/背景]\n核心研究问题：[填写]\n访谈时长：[填写]\n\n请输出结构化访谈提纲。",
            icon: "mic.circle.fill", iconColor: "#64748B"),
        SkillTemplate(name: "假设树（Issue Tree）", nameEn: "Issue Tree / Hypothesis Tree",
            description: "用 MECE 原则拆解核心问题，构建逻辑清晰的假设树",
            descriptionEn: "Decompose core problems using MECE principle to build a logically structured issue tree",
            category: "提案与项目交付", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["结构化思维"],
            systemPrompt: "你是麦肯锡资深顾问，精通结构化问题拆解。请使用 MECE 原则构建假设树：从核心问题出发，逐层分解（问题→假设→分析→证据），确保每层穷尽且互不重叠，标注每个分支的优先级和分析方法。",
            userTemplate: "请为以下问题构建假设树：\n\n核心问题：[填写]\n背景信息：[简述]\n已知约束：[填写]\n\n请输出完整假设树结构及分析优先级。",
            icon: "arrow.triangle.branch", iconColor: "#64748B"),
        SkillTemplate(name: "Storyboard 故事线", nameEn: "Storyboard / Report Storyline",
            description: "用金字塔原则搭建报告的页面逻辑框架，从结论到支撑论据",
            descriptionEn: "Build report page logic using Pyramid Principle, from conclusion to supporting arguments",
            category: "提案与项目交付", estimatedTime: "15–20 分钟", estimatedTimeEn: "15–20 min",
            tools: ["结构化写作", "PPT"],
            systemPrompt: "你是顶级咨询公司资深顾问，精通 Barbara Minto Pyramid Principle。请根据用户提供的主题和信息，设计报告故事线：核心结论（答案）→三个支撑论点→每个论点的关键证据，输出页面逻辑框架（每页一个关键信息，说明用哪类图表呈现）。",
            userTemplate: "请为以下报告搭建故事线：\n\n报告主题：[填写]\n受众：[填写]\n核心结论（如已知）：[填写]\n主要发现/素材：\n[填写]\n\n请输出完整 Storyboard 框架。",
            icon: "film.stack.fill", iconColor: "#64748B"),
        SkillTemplate(name: "工作计划 / 甘特图", nameEn: "Project Work Plan",
            description: "将项目任务拆解为时间线和责任矩阵，生成可视化工作计划",
            descriptionEn: "Break down project tasks into timeline and RACI matrix with a visual work plan",
            category: "提案与项目交付", estimatedTime: "10–15 分钟", estimatedTimeEn: "10–15 min",
            tools: ["项目管理"],
            systemPrompt: "你是项目管理专家。请根据项目描述，生成工作计划：任务分解（WBS，三层结构）、时间线（甘特图格式）、资源/责任矩阵（RACI）、关键里程碑与交付物、风险缓冲时间建议。",
            userTemplate: "请生成以下项目的工作计划：\n\n项目名称：[填写]\n项目范围：[描述]\n团队成员：[填写]\n总时间：[填写]\n关键约束：[填写]\n\n请输出工作计划及甘特图。",
            icon: "calendar.badge.clock", iconColor: "#64748B"),
        SkillTemplate(name: "Pitch Deck 制作", nameEn: "Pitch Deck",
            description: "生成结构完整、逻辑清晰的 10-20 页提案演示文稿框架",
            descriptionEn: "Generate a 10-20 page pitch deck framework with complete structure and clear logic",
            category: "提案与项目交付", estimatedTime: "30–40 分钟", estimatedTimeEn: "30–40 min",
            tools: ["商务写作", "PPT"],
            systemPrompt: "你是顶级咨询公司资深合伙人，精通提案撰写。请生成专业 Pitch Deck：封面与执行摘要、背景与问题/机会陈述、解决方案与差异化、市场分析与竞争格局、实施方法论与计划、团队能力、投资回报与成功案例、下一步行动呼吁。每页提供标题（结论型）+ 关键内容框架。",
            userTemplate: "请生成以下提案的 Pitch Deck：\n\n提案主题：[填写]\n客户/受众：[填写]\n核心价值主张：[填写]\n预算/规模：[填写]\n\n请输出完整 Pitch Deck 框架（含每页内容建议）。",
            icon: "play.rectangle.fill", iconColor: "#64748B"),
        SkillTemplate(name: "项目建议书（Proposal）", nameEn: "Project Proposal",
            description: "生成含目标、方法论、时间线、团队与报价的完整项目建议书",
            descriptionEn: "Generate complete project proposal with objectives, methodology, timeline, team and pricing",
            category: "提案与项目交付", estimatedTime: "25–35 分钟", estimatedTimeEn: "25–35 min",
            tools: ["商务写作", "文档生成"],
            systemPrompt: "你是咨询公司业务拓展专家。请生成专业项目建议书：执行摘要、客户问题理解与背景、我们的解决方案与独特价值、项目方法论（含工作流程/工具）、项目计划与里程碑、团队介绍与相关经验、费用方案（可选）、附录。",
            userTemplate: "请生成以下项目建议书：\n\n客户名称：[填写]\n项目背景：[描述客户需求]\n我们的解决方案：[概述]\n预算范围：[填写]\n时间周期：[填写]\n\n请输出完整项目建议书。",
            icon: "doc.text.fill", iconColor: "#64748B"),
        SkillTemplate(name: "市场研究报告", nameEn: "Market Research Report",
            description: "生成涵盖行业概况、竞争格局、趋势与机会的完整市场研究报告框架",
            descriptionEn: "Generate complete market research report framework covering industry overview, competitive landscape, trends and opportunities",
            category: "提案与项目交付", estimatedTime: "40–60 分钟", estimatedTimeEn: "40–60 min",
            tools: ["市场研究", "报告生成"],
            systemPrompt: "你是资深行业研究分析师。请生成完整市场研究报告：执行摘要、行业概况（定义/范围/价值链）、市场规模与增速（历史+预测）、竞争格局（主要玩家分析）、关键趋势与驱动因素、客户洞察、机会与风险、战略建议。每个章节提供数据需求说明。",
            userTemplate: "请生成以下市场的研究报告：\n\n目标市场：[填写]\n地理范围：[填写]\n研究深度：[填写（高层概览/深度报告）]\n核心研究问题：[填写]\n\n请输出完整报告框架及关键内容。",
            icon: "chart.line.uptrend.xyaxis.circle.fill", iconColor: "#64748B"),
    ]

    static let catalog: [SkillTemplate] = strategySkills + operationsSkills + financeSkills + maSkills + digitalSkills + riskSkills + orgSkills + marketingSkills + deliverySkills
}

struct SkillsView: View {
    @EnvironmentObject var dataStore: DataStore
    @EnvironmentObject var appState: AppStateManager
    @Environment(\.appLanguage) var lang
    @State private var searchText = ""
    @State private var headerVisible = false
    @State private var cardsVisible = false
    @State private var showInstallSheet = false

    var skills: [Skill] {
        if dataStore.apiSkills.isEmpty { return SampleData.skills(for: lang) }
        return dataStore.apiSkills.map { api in
            var s = api.toLocal()
            s.apiId = api.id
            s.name = api.localizedName(for: lang)
            s.description = api.localizedDescription(for: lang)
            s.estimatedTime = api.localizedEstimatedTime(for: lang)
            s.tools = api.localizedTools(for: lang)
            return s
        }
    }

    static let domainOrder: [(name: String, icon: String, colorHex: String)] = [
        ("战略与增长",     "chart.line.uptrend.xyaxis",  "#6366F1"),
        ("运营与效能",     "gearshape.2",                "#8B5CF6"),
        ("财务咨询",       "chart.bar.doc.horizontal",   "#059669"),
        ("并购与交易",     "arrow.triangle.merge",       "#DC2626"),
        ("数字化与技术",   "cpu",                         "#0891B2"),
        ("风险与合规",     "shield.lefthalf.filled",     "#D97706"),
        ("组织与人才",     "person.3.fill",              "#7C3AED"),
        ("市场与客户",     "megaphone.fill",             "#DB2777"),
        ("提案与项目交付", "doc.text.magnifyingglass",   "#64748B"),
    ]

    var filteredSkills: [Skill] {
        guard !searchText.isEmpty else { return skills }
        return skills.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.description.localizedCaseInsensitiveContains(searchText)
        }
    }

    // Catalog lookup: name/nameEn → business domain
    static let catalogDomainByName: [String: String] = {
        var d: [String: String] = [:]
        for t in SkillTemplate.catalog {
            d[t.name]   = t.category
            d[t.nameEn] = t.category
        }
        return d
    }()

    var groupedByDomain: [(name: String, icon: String, colorHex: String, skills: [Skill])] {
        let known = Set(Self.domainOrder.map { $0.name })
        // For skills with old/unknown category, fall back to catalog lookup
        let resolved = filteredSkills.map { skill -> Skill in
            guard !known.contains(skill.category) else { return skill }
            var s = skill
            s.category = Self.catalogDomainByName[skill.name] ?? skill.category
            return s
        }
        var result = Self.domainOrder.map { dom -> (String, String, String, [Skill]) in
            let s = resolved.filter { $0.category == dom.name }
            return (dom.name, dom.icon, dom.colorHex, s)
        }
        let others = resolved.filter { !known.contains($0.category) }
        if !others.isEmpty {
            result.append(("通用技能", "sparkles", "#94A3B8", others))
        }
        return result
    }

    var body: some View {
        VStack(spacing: 0) {
            TopBarView(
                title: lang.t("技能中心", "Skill Center"),
                subtitle: lang.t("选择 AI 工具处理你的咨询任务", "Select AI tools for your consulting tasks")
            ) {
                SearchBar(text: $searchText, placeholder: lang.t("搜索技能…", "Search skills…")).frame(width: 200)
                PrimaryButton(lang.t("安装技能", "Install Skill"), icon: "plus") {
                    showInstallSheet = true
                }
            }
            .sheet(isPresented: $showInstallSheet) {
                InstallSkillSheet(isPresented: $showInstallSheet)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xxl) {
                    ForEach(Array(groupedByDomain.enumerated()), id: \.element.name) { idx, group in
                        skillSection(title: group.name, icon: group.icon, colorHex: group.colorHex, skills: group.skills)
                            .opacity(headerVisible ? 1 : 0)
                            .offset(y: headerVisible ? 0 : 16)
                            .animation(.spring(response: 0.5, dampingFraction: 0.8).delay(Double(idx) * 0.05 + 0.05), value: headerVisible)
                    }
                }
                .padding(Spacing.xxl)
            }
            .background(.surfaceBase)
            .onAppear {
                withAnimation { headerVisible = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    withAnimation { cardsVisible = true }
                }
            }
        }
    }

    // MARK: - Guided workflow section (gstack-style, visually distinct)

    @ViewBuilder
    private func guidedWorkflowSection(skills: [Skill]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            // Section header
            HStack(spacing: Spacing.sm) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(LinearGradient(
                            colors: [.primary600, .primary500],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        ))
                        .frame(width: 28, height: 28)
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                }
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(lang.t("专家工作流", "Guided Workflows"))
                            .font(TextStyle.headlineSM).foregroundColor(.onSurface)
                        Text(lang.t("新", "NEW"))
                            .font(.system(size: 9, weight: .bold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.primary500)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                    Text(lang.t("AI 主动追问、结构化推进，比单次问答更深入", "AI proactively probes and guides — deeper than single Q&A"))
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                }
            }

            // Banner explaining the concept
            HStack(spacing: Spacing.md) {
                Image(systemName: "sparkles")
                    .font(.system(size: 16)).foregroundColor(.primary500)
                VStack(alignment: .leading, spacing: 2) {
                    Text(lang.t("这些技能来自 gstack 方法论", "These skills are built on the gstack methodology"))
                        .font(TextStyle.labelMD).foregroundColor(.onSurface)
                    Text(lang.t(
                        "AI 不会直接给答案——它会像资深 Partner 一样追问、挑战、推进你的思考过程。",
                        "The AI won't give instant answers — it challenges and advances your thinking like a senior Partner."
                    ))
                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(Spacing.md)
            .background(Color.primaryFixed)
            .clipShape(RoundedRectangle(cornerRadius: Radius.md))

            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: Spacing.md), GridItem(.flexible(), spacing: Spacing.md)],
                spacing: Spacing.md
            ) {
                ForEach(Array(skills.enumerated()), id: \.element.id) { idx, skill in
                    WorkflowSkillCard(skill: skill, onUseSkill: { useSkill(skill) })
                        .opacity(cardsVisible ? 1 : 0)
                        .offset(y: cardsVisible ? 0 : 20)
                        .animation(.spring(response: 0.5, dampingFraction: 0.75).delay(Double(idx) * 0.06), value: cardsVisible)
                }
            }
        }
    }

    @ViewBuilder
    private func skillSection(title: String, icon: String, colorHex: String, skills: [Skill]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            HStack(spacing: Spacing.sm) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(hex: colorHex).opacity(0.1))
                        .frame(width: 28, height: 28)
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Color(hex: colorHex))
                }
                Text(title).font(TextStyle.headlineSM).foregroundColor(.onSurface)
                if skills.isEmpty {
                    Text("· 未安装")
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant.opacity(0.5))
                } else {
                    Text("·  \(skills.count) 个技能")
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                }
            }

            if skills.isEmpty {
                Button { showInstallSheet = true } label: {
                    HStack(spacing: Spacing.sm) {
                        Image(systemName: "plus.circle")
                            .font(.system(size: 13))
                        Text(lang.t("从模板库安装技能", "Install from catalog"))
                            .font(TextStyle.labelSM)
                    }
                    .foregroundColor(Color(hex: colorHex).opacity(0.7))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.md)
                    .background(Color(hex: colorHex).opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Radius.md)
                        .strokeBorder(Color(hex: colorHex).opacity(0.15), lineWidth: 1, antialiased: true))
                }
                .buttonStyle(.plain)
            } else {
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: Spacing.md), GridItem(.flexible(), spacing: Spacing.md)],
                spacing: Spacing.md
            ) {
                ForEach(Array(skills.enumerated()), id: \.element.id) { idx, skill in
                    SkillCard(skill: skill, onUseSkill: { useSkill(skill) }, onAssignToProject: { project in
                        useSkill(skill, project: project)
                    })
                    .opacity(cardsVisible ? 1 : 0)
                    .offset(y: cardsVisible ? 0 : 20)
                    .animation(.spring(response: 0.5, dampingFraction: 0.75).delay(Double(idx) * 0.06 + 0.1), value: cardsVisible)
                }
            }
            } // end else
        }
    }

    private func useSkill(_ skill: Skill, project: Project? = nil) {
        let apiSkill = skill.apiId.flatMap { id in dataStore.apiSkills.first { $0.id == id } }
                    ?? dataStore.apiSkills.first { $0.name == skill.name }
        if let apiSkill {
            appState.pendingSkillId = apiSkill.id
            if !apiSkill.userTemplate.isEmpty {
                appState.pendingChatInput = apiSkill.userTemplate
            }
        }
        if let project { appState.selectedProject = project }
        appState.selectedScreen = .chat
    }
}

// MARK: - Install Skill Sheet

struct InstallSkillSheet: View {
    @EnvironmentObject var dataStore: DataStore
    @Environment(\.appLanguage) var lang
    @Binding var isPresented: Bool

    enum Tab { case catalog, custom }
    @State private var selectedTab: Tab = .catalog
    @State private var installedTemplateIds: Set<UUID> = []
    @State private var isInstalling: UUID? = nil
    @State private var installSuccess: UUID? = nil

    // Custom form
    @State private var customName = ""
    @State private var customDescription = ""
    @State private var customCategory = "战略与增长"
    @State private var customSystemPrompt = ""
    @State private var customUserTemplate = ""
    @State private var customEstimatedTime = ""
    @State private var customTools = ""
    @State private var isSavingCustom = false
    @State private var customError: String? = nil
    @State private var customSuccess = false

    private let domainCategories: [(zh: String, en: String, icon: String, colorHex: String)] = [
        ("战略与增长",     "Strategy",    "chart.line.uptrend.xyaxis", "#6366F1"),
        ("运营与效能",     "Operations",  "gearshape.2",               "#8B5CF6"),
        ("财务咨询",       "Finance",     "chart.bar.doc.horizontal",  "#059669"),
        ("并购与交易",     "M&A",         "arrow.triangle.merge",      "#DC2626"),
        ("数字化与技术",   "Digital",     "cpu",                       "#0891B2"),
        ("风险与合规",     "Risk",        "shield.lefthalf.filled",    "#D97706"),
        ("组织与人才",     "Org & HR",    "person.3.fill",             "#7C3AED"),
        ("市场与客户",     "Marketing",   "megaphone.fill",            "#DB2777"),
        ("提案与项目交付", "Delivery",    "doc.text.magnifyingglass",  "#64748B"),
    ]

    // Track which templates are already installed by matching names
    private var installedNames: Set<String> {
        Set(dataStore.apiSkills.map { $0.name })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(lang.t("安装技能", "Install Skill"))
                        .font(.system(size: 17, weight: .semibold)).foregroundColor(.onSurface)
                    Text(lang.t("从模板库选择或自定义创建新技能", "Choose from catalog or create a custom skill"))
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                }
                Spacer()
                Button { isPresented = false } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                        .frame(width: 28, height: 28)
                        .background(Color.surfaceContainerHigh)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(Spacing.xl)

            // Tab bar
            HStack(spacing: 0) {
                tabButton(lang.t("模板库", "Catalog"), tab: .catalog)
                tabButton(lang.t("自定义创建", "Custom"), tab: .custom)
            }
            .padding(.horizontal, Spacing.xl)

            Divider().opacity(0.4)

            // Content
            if selectedTab == .catalog {
                catalogContent
            } else {
                customContent
            }
        }
        .frame(width: 560, height: 600)
        .background(Color.surfaceContainerLowest)
    }

    @ViewBuilder
    private func tabButton(_ label: String, tab: Tab) -> some View {
        Button { selectedTab = tab } label: {
            Text(label)
                .font(TextStyle.labelMD)
                .foregroundColor(selectedTab == tab ? .primary500 : .onSurfaceVariant)
                .padding(.horizontal, Spacing.lg)
                .padding(.vertical, Spacing.md)
                .overlay(
                    Rectangle().frame(height: 2)
                        .foregroundColor(selectedTab == tab ? .primary500 : .clear),
                    alignment: .bottom
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: Catalog

    private var catalogContent: some View {
        ScrollView {
            VStack(spacing: Spacing.sm) {
                ForEach(SkillTemplate.catalog) { template in
                    catalogRow(template)
                }
            }
            .padding(Spacing.xl)
        }
    }

    @ViewBuilder
    private func catalogRow(_ template: SkillTemplate) -> some View {
        let name = lang == .zh ? template.name : template.nameEn
        let desc = lang == .zh ? template.description : template.descriptionEn
        let time = lang == .zh ? template.estimatedTime : template.estimatedTimeEn
        let alreadyInstalled = installedNames.contains(template.name) || installedNames.contains(template.nameEn)
        let isThisInstalling = isInstalling == template.id
        let isThisSuccess = installSuccess == template.id

        HStack(spacing: Spacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(hex: template.iconColor).opacity(0.12))
                    .frame(width: 40, height: 40)
                Image(systemName: template.icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Color(hex: template.iconColor))
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(name).font(TextStyle.titleSM).foregroundColor(.onSurface)
                    Text(lang == .zh
                         ? (template.category == "Quick Tool" ? "快捷工具" : template.category == "Deep Task" ? "深度任务" : "专家工作流")
                         : template.category)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.onSurfaceVariant)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Color.surfaceContainerHighest)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                Text(desc).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant).lineLimit(2)
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                    Text(time).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                }
            }

            Spacer()

            // Install button
            if alreadyInstalled {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                    Text(lang.t("已安装", "Installed"))
                }
                .font(TextStyle.labelSM)
                .foregroundColor(.statusActive)
                .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.xs + 2)
                .background(Color.statusActive.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            } else if isThisSuccess {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                    Text(lang.t("安装成功", "Installed!"))
                }
                .font(TextStyle.labelSM).foregroundColor(.statusActive)
                .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.xs + 2)
                .background(Color.statusActive.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: Radius.md))
            } else {
                Button {
                    Task {
                        isInstalling = template.id
                        let ok = await dataStore.createSkill(
                            name: template.name,
                            category: template.category,
                            description: template.description,
                            systemPrompt: template.systemPrompt,
                            userTemplate: template.userTemplate,
                            estimatedTime: template.estimatedTime,
                            tools: template.tools
                        )
                        isInstalling = nil
                        if ok { installSuccess = template.id }
                    }
                } label: {
                    HStack(spacing: 4) {
                        if isThisInstalling {
                            ProgressView().controlSize(.mini).tint(.white)
                        } else {
                            Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                        }
                        Text(isThisInstalling ? lang.t("安装中…", "Installing…") : lang.t("安装", "Install"))
                    }
                    .font(TextStyle.labelSM).foregroundColor(.white)
                    .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.xs + 2)
                    .background(isThisInstalling ? Color.primary500.opacity(0.6) : Color.primary500)
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
                .disabled(isThisInstalling)
            }
        }
        .padding(Spacing.md)
        .background(Color.surfaceContainerLowest)
        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color.outlineVariant.opacity(0.3), lineWidth: 1))
    }

    // MARK: Custom

    private var customContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                // Domain category picker
                VStack(alignment: .leading, spacing: 8) {
                    Text(lang.t("业务领域", "Business Domain"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Spacing.sm), count: 3), spacing: Spacing.sm) {
                        ForEach(domainCategories, id: \.zh) { dom in
                            let isSelected = customCategory == dom.zh
                            let label = lang == .zh ? dom.zh : dom.en
                            Button { customCategory = dom.zh } label: {
                                VStack(spacing: 4) {
                                    ZStack {
                                        RoundedRectangle(cornerRadius: 7)
                                            .fill(isSelected ? Color(hex: dom.colorHex).opacity(0.15) : Color.surfaceContainerHigh)
                                            .frame(width: 32, height: 32)
                                        Image(systemName: dom.icon)
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundColor(isSelected ? Color(hex: dom.colorHex) : .onSurfaceVariant)
                                    }
                                    Text(label)
                                        .font(.system(size: 10, weight: isSelected ? .semibold : .regular))
                                        .foregroundColor(isSelected ? Color(hex: dom.colorHex) : .onSurfaceVariant)
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.8)
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, Spacing.xs)
                                .background(
                                    RoundedRectangle(cornerRadius: Radius.sm)
                                        .fill(isSelected ? Color(hex: dom.colorHex).opacity(0.08) : Color.clear)
                                        .overlay(RoundedRectangle(cornerRadius: Radius.sm)
                                            .strokeBorder(isSelected ? Color(hex: dom.colorHex).opacity(0.4) : Color.clear, lineWidth: 1))
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }

                customField(label: lang.t("技能名称 *", "Skill Name *"),
                            placeholder: lang.t("例：客户满意度分析", "e.g. Customer Satisfaction Analysis"),
                            text: $customName)

                customField(label: lang.t("描述 *", "Description *"),
                            placeholder: lang.t("简述这个技能能做什么", "Brief description of what this skill does"),
                            text: $customDescription)

                customField(label: lang.t("预估时间", "Estimated Time"),
                            placeholder: lang.t("例：10–15 分钟", "e.g. 10–15 min"),
                            text: $customEstimatedTime)

                customField(label: lang.t("工具标签（逗号分隔）", "Tool Tags (comma-separated)"),
                            placeholder: lang.t("例：数据分析, 报告生成", "e.g. Data Analysis, Report Gen"),
                            text: $customTools)

                // System prompt
                VStack(alignment: .leading, spacing: 6) {
                    Text(lang.t("系统提示词 *", "System Prompt *"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                    Text(lang.t("告诉 AI 扮演什么角色、遵循什么规则", "Tell AI what role to play and what rules to follow"))
                        .font(.system(size: 11)).foregroundColor(.onSurfaceVariant.opacity(0.7))
                    TextEditor(text: $customSystemPrompt)
                        .font(TextStyle.bodyMD).foregroundColor(.onSurface)
                        .frame(height: 90)
                        .padding(Spacing.sm)
                        .background(Color.surfaceContainerLow)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                        .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Color.outlineVariant.opacity(0.5), lineWidth: 1))
                }

                // User template
                VStack(alignment: .leading, spacing: 6) {
                    Text(lang.t("用户模板（可选）", "User Template (optional)"))
                        .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                    Text(lang.t("使用技能时预填充到对话框的文本", "Text pre-filled in chat when using this skill"))
                        .font(.system(size: 11)).foregroundColor(.onSurfaceVariant.opacity(0.7))
                    TextEditor(text: $customUserTemplate)
                        .font(TextStyle.bodyMD).foregroundColor(.onSurface)
                        .frame(height: 70)
                        .padding(Spacing.sm)
                        .background(Color.surfaceContainerLow)
                        .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                        .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Color.outlineVariant.opacity(0.5), lineWidth: 1))
                }

                if let err = customError {
                    Text(err).font(TextStyle.labelSM).foregroundColor(.statusFailed)
                }
                if customSuccess {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill").foregroundColor(.statusActive)
                        Text(lang.t("技能创建成功！", "Skill created successfully!"))
                    }
                    .font(TextStyle.labelSM).foregroundColor(.statusActive)
                }

                HStack {
                    Spacer()
                    Button {
                        guard !customName.trimmingCharacters(in: .whitespaces).isEmpty,
                              !customSystemPrompt.trimmingCharacters(in: .whitespaces).isEmpty else {
                            customError = lang.t("请填写名称和系统提示词", "Name and system prompt are required")
                            return
                        }
                        customError = nil
                        isSavingCustom = true
                        let tools = customTools.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                        Task {
                            let ok = await dataStore.createSkill(
                                name: customName.trimmingCharacters(in: .whitespaces),
                                category: customCategory,
                                description: customDescription.trimmingCharacters(in: .whitespaces),
                                systemPrompt: customSystemPrompt.trimmingCharacters(in: .whitespaces),
                                userTemplate: customUserTemplate.trimmingCharacters(in: .whitespaces),
                                estimatedTime: customEstimatedTime.isEmpty ? lang.t("视任务而定", "Varies") : customEstimatedTime,
                                tools: tools
                            )
                            isSavingCustom = false
                            if ok {
                                customSuccess = true
                                customName = ""; customDescription = ""; customSystemPrompt = ""; customUserTemplate = ""; customTools = ""; customEstimatedTime = ""
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { customSuccess = false }
                            } else {
                                customError = dataStore.error ?? lang.t("创建失败", "Failed to create")
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if isSavingCustom { ProgressView().controlSize(.mini).tint(.white) }
                            Text(isSavingCustom ? lang.t("创建中…", "Creating…") : lang.t("创建技能", "Create Skill"))
                                .font(TextStyle.labelMD).foregroundColor(.white)
                        }
                        .padding(.horizontal, Spacing.lg).padding(.vertical, Spacing.sm)
                        .background(!customName.isEmpty && !customSystemPrompt.isEmpty
                            ? AnyShapeStyle(LinearGradient(colors: [.primary600, .primary500], startPoint: .topLeading, endPoint: .bottomTrailing))
                            : AnyShapeStyle(Color.onSurfaceVariant.opacity(0.4)))
                        .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                    .disabled(customName.isEmpty || customSystemPrompt.isEmpty || isSavingCustom)
                }
            }
            .padding(Spacing.xl)
        }
    }

    @ViewBuilder
    private func customField(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
            TextField(placeholder, text: text)
                .textFieldStyle(.plain).font(TextStyle.bodyMD).foregroundColor(.onSurface)
                .padding(Spacing.sm)
                .background(Color.surfaceContainerLow)
                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                .overlay(RoundedRectangle(cornerRadius: Radius.sm).strokeBorder(Color.outlineVariant.opacity(0.5), lineWidth: 1))
        }
    }
}

// MARK: - Workflow Skill Card (gstack-style, distinct look)
struct WorkflowSkillCard: View {
    let skill: Skill
    var onUseSkill: () -> Void = {}
    @Environment(\.appLanguage) var lang
    @State private var isHovered = false

    private var steps: [String] {
        switch skill.name {
        case "根因分析", "Root Cause Analysis":
            return [lang.t("调查", "Investigate"), lang.t("分析", "Analyze"), lang.t("假设", "Hypothesize"), lang.t("建议", "Recommend")]
        case "提案挑战", "Proposal Challenge":
            return [lang.t("前提挑战", "Premise"), lang.t("完整性检查", "Completeness"), lang.t("三版本方案", "3 Versions")]
        case "项目启动", "Project Kickoff":
            return [lang.t("六个追问", "6 Questions"), lang.t("生成简报", "Brief")]
        case "项目复盘", "Project Retrospective":
            return [lang.t("五维分析", "5 Dimensions"), lang.t("经验提炼", "Extract Learnings")]
        case "交付审查", "Delivery Review":
            return [lang.t("五项检查", "5 Checks"), lang.t("评分", "Score"), lang.t("修改建议", "Suggestions")]
        default:
            return []
        }
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: Radius.lg)
                .fill(isHovered ? Color.primaryFixed.opacity(0.6) : Color.surfaceContainerLowest)
            RoundedRectangle(cornerRadius: Radius.lg)
                .strokeBorder(
                    LinearGradient(
                        colors: [Color.primary500.opacity(0.4), Color.primary500.opacity(0.1)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )

            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                            .font(.system(size: 9, weight: .bold)).foregroundColor(.primary500)
                        Text(lang.t("专家工作流", "Guided Workflow"))
                            .font(.system(size: 10, weight: .semibold)).foregroundColor(.primary500)
                    }
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Color.primary500.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: Radius.pill))

                    Spacer()
                    HStack(spacing: Spacing.xs) {
                        Image(systemName: "clock").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                        Text(skill.estimatedTime).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(skill.name).font(TextStyle.titleSM).foregroundColor(.onSurface)
                    Text(skill.description)
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }

                if !steps.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(Array(steps.enumerated()), id: \.offset) { idx, step in
                            Text(step)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.primary600)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color.primary500.opacity(0.08))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            if idx < steps.count - 1 {
                                Image(systemName: "arrow.right")
                                    .font(.system(size: 8)).foregroundColor(.onSurfaceVariant)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }

                Button { onUseSkill() } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "play.fill").font(.system(size: 10))
                        Text(lang.t("启动工作流", "Launch Workflow"))
                    }
                    .font(TextStyle.labelSM).foregroundColor(.white)
                    .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.xs + 2)
                    .background(
                        LinearGradient(colors: [.primary600, .primary500], startPoint: .leading, endPoint: .trailing)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                }
                .buttonStyle(.plain)
            }
            .padding(Spacing.lg)
        }
        .scaleEffect(isHovered ? 1.015 : 1.0)
        .shadow(color: isHovered ? Color.primary500.opacity(0.18) : Color.black.opacity(0.04),
                radius: isHovered ? 12 : 4, x: 0, y: isHovered ? 6 : 2)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isHovered)
    }
}

// MARK: - Skill Card
struct SkillCard: View {
    let skill: Skill
    var onUseSkill: () -> Void = {}
    var onAssignToProject: (Project) -> Void = { _ in }
    @Environment(\.appLanguage) var lang
    @EnvironmentObject var dataStore: DataStore
    @State private var isHovered = false
    @State private var showProjectPicker = false
    @State private var confirmUninstall = false
    @State private var isUninstalling = false

    @ViewBuilder private var onAssignProjectPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(lang.t("选择项目", "Select Project"))
                .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                .padding(.horizontal, Spacing.md).padding(.top, Spacing.md).padding(.bottom, Spacing.xs)
            Divider()
            if dataStore.projects.isEmpty {
                Text(lang.t("暂无项目", "No projects yet"))
                    .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                    .padding(Spacing.md)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(dataStore.projects) { project in
                        Button {
                            onAssignToProject(project)
                            showProjectPicker = false
                        } label: {
                            HStack(spacing: Spacing.sm) {
                                Circle().fill(Color.statusActive).frame(width: 6, height: 6)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(project.name).font(TextStyle.labelMD).foregroundColor(.onSurface)
                                    Text(project.client).font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                                }
                                Spacer()
                            }
                            .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.sm)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(width: 220)
        .background(Color.surfaceContainerLowest)
    }

    var body: some View {
        CardContainer {
            VStack(alignment: .leading, spacing: Spacing.md) {
                HStack {
                    TagView(label: skill.type.label(for: lang), style: skill.type == .quickTool ? .quickTool : .deepTask)
                    Spacer()
                    HStack(spacing: Spacing.xs) {
                        Image(systemName: "clock").font(.system(size: 10)).foregroundColor(.onSurfaceVariant)
                        Text(skill.estimatedTime).font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(skill.name).font(TextStyle.titleSM).foregroundColor(.onSurface)
                    Text(skill.description)
                        .font(TextStyle.bodySM).foregroundColor(.onSurfaceVariant)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }

                if !skill.tools.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(skill.tools, id: \.self) { tool in
                            HStack(spacing: 3) {
                                Image(systemName: "wrench.and.screwdriver").font(.system(size: 9))
                                Text(tool).font(.system(size: 10))
                            }
                            .foregroundColor(.onSurfaceVariant)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.surfaceContainerHigh)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        Spacer(minLength: 0)
                    }
                }

                HStack(spacing: Spacing.sm) {
                    Button { onUseSkill() } label: {
                        Text(lang.t("使用技能", "Use Skill"))
                            .font(TextStyle.labelSM).foregroundColor(.primary500)
                            .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.xs + 2)
                            .background(.primaryFixed)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)

                    Button { showProjectPicker.toggle() } label: {
                        Text(lang.t("分配到项目", "Assign to Project"))
                            .font(TextStyle.labelSM).foregroundColor(.onSurfaceVariant)
                            .padding(.horizontal, Spacing.md).padding(.vertical, Spacing.xs + 2)
                            .background(.surfaceContainerHigh)
                            .clipShape(RoundedRectangle(cornerRadius: Radius.md))
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: $showProjectPicker, arrowEdge: .bottom) {
                        onAssignProjectPopover
                    }

                    Spacer()

                    if let apiId = skill.apiId {
                        Button {
                            confirmUninstall = true
                        } label: {
                            Image(systemName: isUninstalling ? "arrow.clockwise" : "trash")
                                .font(.system(size: 11))
                                .foregroundColor(.statusFailed.opacity(0.7))
                                .frame(width: 26, height: 26)
                                .background(Color.statusFailed.opacity(0.07))
                                .clipShape(RoundedRectangle(cornerRadius: Radius.sm))
                        }
                        .buttonStyle(.plain)
                        .disabled(isUninstalling)
                        .help(lang.t("卸载技能", "Uninstall skill"))
                        .alert(lang.t("卸载「\(skill.name)」？", "Uninstall \"\(skill.name)\"?"), isPresented: $confirmUninstall) {
                            Button(lang.t("卸载", "Uninstall"), role: .destructive) {
                                isUninstalling = true
                                Task {
                                    _ = await dataStore.deleteSkill(apiId: apiId)
                                    isUninstalling = false
                                }
                            }
                            Button(lang.t("取消", "Cancel"), role: .cancel) {}
                        } message: {
                            Text(lang.t("该技能将从技能中心移除，已关联的对话不受影响。", "This skill will be removed from the Skill Center. Existing conversations won't be affected."))
                        }
                    }
                }
            }
            .padding(Spacing.lg)
            .background(isHovered ? Color.surfaceBright : Color.surfaceContainerLowest)
        }
        .scaleEffect(isHovered ? 1.015 : 1.0)
        .shadow(color: isHovered ? Color.black.opacity(0.10) : Color.black.opacity(0.03),
                radius: isHovered ? 10 : 3, x: 0, y: isHovered ? 5 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isHovered)
    }
}
