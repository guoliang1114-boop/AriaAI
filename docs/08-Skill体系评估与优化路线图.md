# Skill 体系评估与优化路线图

> 评估时间：2026-05-27
> 当前 Skill 总量：48 个
> 总文件数：186 个
> 全部 Markdown 行数：约 19,600 行（含 references/examples/styles/layouts 等全部 .md 文件）
> SKILL.md 行数合计：9,833 行（平均 205 行/Skill）
> 关联规范：[Skill 编写规范 v1.0](./09-Skill编写规范.md)

---

## 一、现状全景

### 1.1 Skill 分布矩阵

> 行数统计口径：每个 Skill 目录下全部 .md 文件的行数合计（含 SKILL.md、references/、examples/、styles/、layouts/ 等）。

| 类别 | 数量 | 代表 Skill | 平均文件数 | 平均行数 | 质量评级 |
|------|------|-----------|-----------|---------|---------|
| **Diagram / Tech** | 13 | archimate, bpmn, architecture, infocard, mindmap, presentation-builder, ai-strategy-report, office-document-editor, pdf-management | 10.5 | 812 | ⭐⭐⭐⭐ ~ ⭐⭐⭐⭐⭐ |
| **Consulting / 通用** | 6 | consulting-proposal-advisor, digital-strategy, goal-definition, meeting-intelligence, data-analytics-anomaly-detection, compliance-investigation-design | 4.2 | 378 | ⭐⭐⭐ ~ ⭐⭐⭐⭐⭐ |
| **审计类** | 14 | audit-risk-assessment, group-audit-strategy, itgc-testing, sox-compliance-checklist 等 | 1.0 | 192 | ⭐⭐ ~ ⭐⭐⭐ |
| **税务类** | 17 | beps-pillar-two-assessment, vat-compliance-optimization, tp-documentation-preparation 等 | 1.0 | 172 | ⭐⭐ |
| **其他专业** | 5 | commercial-due-diligence, debt-restructuring, esg-assurance-preparation, valuation-and-pricing, post-merger-integration | 1.0 | 228 | ⭐⭐ ~ ⭐⭐⭐ |

### 1.2 质量分层

> 分层依据：综合考量 SKILL.md 深度、目录结构完整度、references/examples/scripts 配套情况。行数为全部 .md 文件合计。

```
Tier 1 (标杆级) — 7 个
├── consulting-proposal-advisor   15 files, 1,219 lines  ★ 有 references + examples + scripts
├── infocard                       66 files, 4,682 lines  ★ 有 styles + layouts 模板体系
├── architecture                   26 files, 1,887 lines  ★ 有 styles + layouts 模板体系
├── ai-strategy-report              9 files, 1,097 lines  ★ 有 references + examples + scripts + README
├── bpmn                            9 files,   944 lines  ★ 有 examples
├── archimate                       9 files,   798 lines  ★ 有 examples
└── digital-strategy                4 files,   792 lines  ★ 有 references + assets

Tier 2 (可用级) — 7 个
├── mindmap                         8 files,   405 lines  ← 有 examples，SKILL.md 158 行
├── data-analytics-anomaly-detection  1 file,  424 lines
├── esg-assurance-preparation         1 file,  396 lines
├── itgc-testing                      1 file,  321 lines
├── office-document-editor            1 file,  293 lines
├── compliance-investigation-design   1 file,  245 lines
└── commercial-due-diligence          1 file,  212 lines

Tier 3 (骨架级) — 34 个
└── 仅含 1 个 SKILL.md，95–259 行，缺少 references / examples / scripts
    └── 涵盖：全部税务 Skill（17 个）、大部分审计 Skill（12 个）、及其他（5 个）
```

### 1.3 关键问题诊断

| # | 问题 | 影响 | 涉及 Skill 数 |
|---|------|------|-------------|
| 1 | **内容厚度不足** | 骨架级 Skill 只有基础流程和输出格式，缺少判断逻辑、诊断问题、参考标准 | 35 |
| 2 | **结构不统一** | 有的有 references/examples/scripts，有的只有 SKILL.md，AI 调用时行为不可预测 | 48 |
| 3 | **元数据不规范** | description 有的加引号有的不加；缺少 version、author、tags、dependencies 字段 | 48 |
| 4 | **工具引用混乱** | 部分 Skill 引用 `generate_ppt_from_skill`、`update_project_markdown_document` 等工具，但未声明这些工具是否真实可用 | 15+ |
| 5 | **交叉引用缺失** | 审计/税务/咨询 Skill 之间缺少明确的调用关系（如 audit-report-draft 应该引用 audit-risk-assessment 的数据） | 20+ |
| 6 | **语言混合** | 部分 Skill 中英混杂，未约定默认工作语言 | 10+ |
| 7 | **缺少质量门禁** | 无统一的 Quality Checklist，无自动化校验脚本 | 48 |
| 8 | **版本管理粗放** | 所有 Skill 均未标注版本号，无法追溯变更 | 48 |

### 1.4 Skill 依赖关系图

当前已存在的 Skill 间调用关系（基于 SKILL.md 中的 dependencies 声明和代码中的 skill_router 逻辑）：

```
底层（通用工具 Skill）
├── presentation-builder ──────────────────┐
├── office-document-editor                 │
└── pdf-management                         │
                                           │
中层（领域框架 Skill）                      │
├── audit-risk-assessment ─────────────┐   │
├── tax-risk-management-framework ──┐  │   │
├── digital-strategy ────────────┐  │  │   │
└── goal-definition              │  │  │   │
                                 │  │  │   │
上层（场景应用 Skill）            │  │  │   │
├── audit-report-draft ──────────┘  │  │   │
├── group-audit-strategy ───────────┘  │   │
├── ma-tax-due-diligence ──────────────┘   │
├── consulting-proposal-advisor ───────────┘
└── ...
```

**当前问题**：大部分 Skill（39/48）为独立文件，未声明任何依赖关系。建议在优化过程中逐步建立完整的依赖图。

### 1.5 按 Domain 分类明细

| Domain | 数量 | Skill 列表 |
|--------|------|-----------|
| **audit** | 14 | audit-risk-assessment, audit-report-draft, audit-substantive-procedures, fraud-risk-assessment, group-audit-strategy, internal-audit-annual-plan, internal-audit-execution, itgc-testing, sox-compliance-checklist, walkthrough-and-control-testing, compliance-investigation-design |
| **tax** | 17 | beps-pillar-two-assessment, vat-compliance-optimization, tp-documentation-preparation, tax-compliance-calendar, tax-incentive-application, tax-dispute-response, tax-risk-management-framework, tax-digital-transformation, cross-border-investment-tax, ma-tax-due-diligence, deal-structure-tax-optimization, customs-and-trade-compliance, excise-and-other-indirect-taxes, equity-incentive-tax, expatriate-tax-planning, executive-compensation-tax, post-merger-tax-integration, apa-arrangement |
| **consulting** | 6 | consulting-proposal-advisor, digital-strategy, goal-definition, meeting-intelligence, commercial-due-diligence, debt-restructuring, valuation-and-pricing, esg-assurance-preparation, data-analytics-anomaly-detection, post-merger-integration |
| **tech** | 11 | infocard, architecture, ai-strategy-report, bpmn, archimate, mindmap, presentation-builder, office-document-editor, pdf-management |

---

## 二、优化目标与原则

### 2.1 目标（6 个月）

- **Tier 3 → Tier 2**：将 35 个骨架级 Skill 提升到可用级（至少 300 行 + references）
- **Tier 2 → Tier 1**：将 6 个可用级 Skill 完善到标杆级（加入 examples + scripts）
- **建立标准**：制定并落地《Skill 编写规范 v1.0》
- **自动化**：引入 Skill 质量扫描脚本，每次提交自动检查

### 2.2 核心原则

1. **最小可用优先** — 先让每个 Skill 达到 300 行 + 5 个核心章节，再追求丰富度
2. **领域聚类** — 按审计、税务、咨询、Tech 四大域分批处理，统一风格
3. **标杆复制** — 以 `consulting-proposal-advisor`、`digital-strategy` 为模板，提炼通用结构
4. **工具真实** — 所有引用的工具必须在 SKILL.md 的 `dependencies` 中声明，并确保可用
5. **可测可验** — 每个 Skill 至少包含一个 example input/output 对

---

## 三、标准化规范（建议稿）

### 3.1 强制目录结构

```
skills/{skill-name}/
├── SKILL.md                    # 主文件（必须）
├── .version                    # 版本号，如 1.2.0
├── references/                 # 参考文档（推荐）
│   ├── framework.md            # 方法论/框架详解
│   ├── checklist.md            # 质量检查清单
│   └── examples.md             # 输入输出示例
├── examples/                   # 示例文件（可选）
│   ├── input.md
│   └── output.md
├── assets/                     # 模板/图片资源（可选）
│   └── template.pptx
└── scripts/                    # 辅助脚本（可选）
    └── validate.py
```

### 3.2 SKILL.md 头部规范

```yaml
---
name: skill-name                           # 必须，kebab-case
description: "一句话描述，包含触发条件和输出物"   # 必须，50–120 字
version: "1.0.0"                          # 必须，semver
domain: "audit" | "tax" | "consulting" | "tech"  # 必须，用于分类和检索
tags: ["audit", "report", "ISA-700"]      # 可选，用于搜索
author: "Team/Name"                       # 可选
last_updated: "2026-05-27"                # 必须
status: "stable" | "beta" | "deprecated"  # 必须
dependencies:                             # 可选，依赖的其他 Skill 或工具
  - skill: "presentation-builder"
    version: ">=1.0.0"
  - tool: "generate_ppt_from_skill"
---
```

### 3.3 SKILL.md 正文章节（强制）

```markdown
# Skill 标题

## 1. When To Use（触发条件）
- 明确列出 3–5 个触发场景
- 包含关键词触发列表

## 2. Workflow（工作流）
- 步骤化流程，不可跳过
- 每步说明输入、处理、输出

## 3. Framework / Methodology（方法论）
- 核心判断逻辑（如决策树、矩阵）
- 引用标准（如 ISA 700、税法条款）

## 4. Diagnostic Questions（诊断问题）
- 至少 5 个高质量追问
- 区分 mandatory vs optional

## 5. Output Format（输出格式）
- 提供 Markdown 模板
- 明确必填 vs 选填字段

## 6. Quality Checklist（质量检查）
- 交付前必须通过的检查项
- 至少 5 条

## 7. Dependencies & Integrations（依赖与集成）
- 调用的其他 Skill
- 依赖的外部工具/数据源

## 8. References（参考资料）
- 外部标准链接
- 内部 references/ 文件索引
```

### 3.4 行数与深度标准

| 等级 | SKILL.md 行数 | references/ | examples/ | 适用阶段 |
|------|--------------|-------------|-----------|---------|
| 骨架级 | 100–200 | 无 | 无 | 概念验证 |
| 可用级 | 250–400 | ≥1 文件 | 可选 | 生产可用 |
| 标杆级 | 400+ | ≥2 文件 | ≥1 对 | 最佳实践 |

---

## 四、分批优化路线图

### Phase 1：筑基期（第 1–2 周）

**目标：建立标准 + 工具链**

| 任务 | 负责人 | 交付物 |
|------|--------|--------|
| 发布《Skill 编写规范 v1.0》 | 架构组 | `docs/09-Skill编写规范.md` |
| 开发 Skill 扫描脚本 | 工程组 | `scripts/skill-linter.py` |
| 创建 Skill 模板脚手架 | 架构组 | `templates/skill-template/` |
| 为所有 Skill 补全 YAML 头部 | 运维组 | 48 个 SKILL.md 更新 |

### Phase 2：审计域攻坚（第 3–4 周）

**目标：14 个审计 Skill → 全部可用级**

重点 Skill（高优先级）：
- `audit-risk-assessment` — 被多个下游 Skill 引用
- `audit-report-draft` — 审计工作最终交付物
- `group-audit-strategy` — 集团审计复杂度最高

具体动作：
1. 提取审计通用判断逻辑（ISA/PCAOB 引用）到 `references/audit-common-framework.md`
2. 为每个审计 Skill 补充：
   - 诊断问题（≥5 个）
   - 质量检查清单（≥5 条）
   - 输出模板（完整 Markdown）
   - 至少 1 个 input/output example

### Phase 3：税务域攻坚（第 5–6 周）

**目标：17 个税务 Skill → 全部可用级**

重点 Skill：
- `beps-pillar-two-assessment` — 内容最厚（199 行），优先标杆化
- `ma-tax-due-diligence` — 并购税务 DD，高频使用
- `tax-risk-management-framework` — 框架级 Skill，影响面广

具体动作：
1. 统一税法引用格式（如 `[企业所得税法第 X 条]`）
2. 补充各税种的“常见风险信号”checklist
3. 建立税务 Skill 间的调用关系图

### Phase 4：咨询域提升（第 7–8 周）

**目标：6 个可用级 → 3 个标杆级**

- `data-analytics-anomaly-detection` → 补充 anomaly detection 算法说明 + 案例
- `esg-assurance-preparation` → 补充 GRI/ISSB 标准映射
- `meeting-intelligence` → 补充多语言场景 + 会议纪要模板库

### Phase 5：Tech 域整合（第 9–10 周）

**目标：Tech Skill 间打通 + 自动化**

- 统一 diagram 类 Skill 的 PlantUML / Mermaid 规范
- 为 `presentation-builder` 补充更多 deck presets
- 引入 `skill-linter.py` CI 检查（GitHub Actions）

### Phase 6：全域优化（第 11–12 周）

**目标：质量门禁 + 度量**

- 运行全量 Skill 扫描，生成质量报告
- 清理 deprecated / 无维护的 Skill
- 建立 Skill 评分卡（使用率、满意度、错误率）

---

## 五、关键依赖与风险

### 5.1 风险矩阵

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|------|------|------|---------|
| 1 | 内容专家时间不足 | 高 | 高 | 按领域分批，每次聚焦 1 个域；先补 mandatory 章节，optional 后续迭代 |
| 2 | 工具链未就绪 | 中 | 中 | Phase 1 优先完成 linter 脚本；可先手工检查 |
| 3 | 多语言混用 | 中 | 低 | 规范中明确：同一 Skill 内保持单一语言；默认中文，技术术语保留英文 |
| 4 | Skill 间循环依赖 | 低 | 高 | 建立依赖图，禁止循环；使用 DAG 验证 |
| 5 | 过度工程 | 中 | 中 | 严格控制"标杆级"标准，先全员可用级，再精选标杆级 |
| 6 | 骨架级 Skill 内容质量参差 | 高 | 中 | 统一使用 Doc 09 模板，linter 强制校验章节完整性 |

### 5.2 回滚与降级策略

| 场景 | 策略 |
|------|------|
| 某域 Skill 升级延期 >1 周 | 降级目标：骨架级→可用级可延后，但 YAML 头部补全不延后 |
| Linter 脚本开发延期 | 先用人工 Checklist 手工检查，Phase 1 可交付手工版检查清单 |
| 标杆级 Skill 内容争议 | 先冻结当前版本为 beta，争议内容放 references/ 待评审 |
| 新增 Skill 需求 | 必须符合 Doc 09 规范方可合入，不新增骨架级 Skill |

### 5.3 资源分配建议

| 阶段 | 工时估算 | 角色 | 交付物 |
|------|---------|------|--------|
| Phase 1 筑基期 | 2 人周 | 架构 1 + 工程 1 | 规范文档、linter 脚本、模板脚手架、48 个 YAML 头部 |
| Phase 2 审计域 | 3 人周 | 领域专家 2 + 架构 1 | 14 个审计 Skill 升级 |
| Phase 3 税务域 | 3 人周 | 领域专家 2 + 架构 1 | 17 个税务 Skill 升级 |
| Phase 4 咨询域 | 1 人周 | 领域专家 1 | 6 个咨询 Skill 升级 |
| Phase 5 Tech 域 | 1 人周 | 工程 1 | Tech Skill 整合 + CI 检查 |
| Phase 6 全域优化 | 1 人周 | 架构 1 | 质量报告、清理、评分卡 |
| **合计** | **11 人周** | | |

---

## 六、度量指标

| 指标 | 当前值 | 2 个月目标 | 6 个月目标 |
|------|--------|-----------|-----------|
| 标杆级 Skill 数 | 7 | 10 | 15 |
| 可用级+ Skill 占比 | 29% (14/48) | 60% (29/48) | 90% (43/48) |
| 平均 SKILL.md 行数 | 205 | 280 | 350 |
| 含 references/ 的 Skill 占比 | 6% (3/48) | 50% | 80% |
| 含 examples/ 的 Skill 占比 | 10% | 30% | 60% |
| Linter 通过率 | 0% | 60% | 90% |

---

## 七、下一步行动（本周）

1. [ ] **评审本路线图** — 与核心团队确认优先级和资源分配
2. [ ] **冻结 Skill 规范** — 发布《Skill 编写规范 v1.0》到 `docs/`
3. [ ] **选定试点** — 选 2 个骨架级 Skill（如 `audit-risk-assessment` + `vat-compliance-optimization`）做标杆升级
4. [ ] **开发 linter** — 实现基础的 YAML 头部校验 + 章节完整性检查
5. [ ] **建立看板** — 用 GitHub Project 或内部看板跟踪 48 个 Skill 的升级状态

---

## 附录 A：全部 Skill 明细与分级

> 行数为该 Skill 目录下全部 .md 文件行数合计。SKILL.md 单独行数见 §1.2 质量分层注释。
> 排序：按质量等级降序，同级内按行数降序。

| Skill | 文件数 | 行数 | 当前等级 | 目标等级 | 优先级 |
|-------|--------|------|---------|---------|--------|
| consulting-proposal-advisor | 15 | 1,219 | ⭐⭐⭐⭐⭐ | 保持 | P2 |
| infocard | 66 | 4,682 | ⭐⭐⭐⭐⭐ | 保持 | P2 |
| architecture | 26 | 1,887 | ⭐⭐⭐⭐⭐ | 保持 | P2 |
| ai-strategy-report | 9 | 1,097 | ⭐⭐⭐⭐⭐ | 保持 | P2 |
| bpmn | 9 | 944 | ⭐⭐⭐⭐⭐ | 保持 | P2 |
| archimate | 9 | 798 | ⭐⭐⭐⭐⭐ | 保持 | P2 |
| digital-strategy | 4 | 792 | ⭐⭐⭐⭐⭐ | 保持 | P2 |
| data-analytics-anomaly-detection | 1 | 424 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | P1 |
| esg-assurance-preparation | 1 | 396 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | P1 |
| itgc-testing | 1 | 321 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | P1 |
| office-document-editor | 1 | 293 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | P3 |
| compliance-investigation-design | 1 | 245 | ⭐⭐⭐ | ⭐⭐⭐⭐ | P2 |
| commercial-due-diligence | 1 | 212 | ⭐⭐⭐ | ⭐⭐⭐⭐ | P2 |
| valuation-and-pricing | 1 | 212 | ⭐⭐ | ⭐⭐⭐ | P2 |
| beps-pillar-two-assessment | 1 | 199 | ⭐⭐ | ⭐⭐⭐ | P2 |
| sox-compliance-checklist | 1 | 199 | ⭐⭐ | ⭐⭐⭐ | P2 |
| cross-border-investment-tax | 1 | 199 | ⭐⭐ | ⭐⭐⭐ | P2 |
| tax-compliance-calendar | 1 | 192 | ⭐⭐ | ⭐⭐⭐ | P3 |
| tax-incentive-application | 1 | 188 | ⭐⭐ | ⭐⭐⭐ | P3 |
| tax-dispute-response | 1 | 182 | ⭐⭐ | ⭐⭐⭐ | P3 |
| presentation-builder | 1 | 184 | ⭐⭐⭐ | ⭐⭐⭐⭐ | P1 |
| goal-definition | 1 | 168 | ⭐⭐⭐ | ⭐⭐⭐⭐ | P2 |
| group-audit-strategy | 1 | 169 | ⭐⭐ | ⭐⭐⭐ | P1 |
| meeting-intelligence | 1 | 145 | ⭐⭐⭐ | ⭐⭐⭐⭐ | P2 |
| audit-substantive-procedures | 1 | 141 | ⭐⭐ | ⭐⭐⭐ | P1 |
| equity-incentive-tax | 1 | 141 | ⭐⭐ | ⭐⭐⭐ | P3 |
| expatriate-tax-planning | 1 | 140 | ⭐⭐ | ⭐⭐⭐ | P3 |
| post-merger-tax-integration | 1 | 129 | ⭐⭐ | ⭐⭐⭐ | P3 |
| internal-audit-annual-plan | 1 | 123 | ⭐⭐ | ⭐⭐⭐ | P2 |
| internal-audit-execution | 1 | 149 | ⭐⭐ | ⭐⭐⭐ | P2 |
| audit-report-draft | 1 | 142 | ⭐⭐ | ⭐⭐⭐ | P1 |
| audit-risk-assessment | 1 | 204 | ⭐⭐ | ⭐⭐⭐ | P1 |
| fraud-risk-assessment | 1 | 214 | ⭐⭐ | ⭐⭐⭐ | P1 |
| walkthrough-and-control-testing | 1 | 259 | ⭐⭐ | ⭐⭐⭐ | P1 |
| debt-restructuring | 1 | 207 | ⭐⭐ | ⭐⭐⭐ | P3 |
| post-merger-integration | 1 | 204 | ⭐⭐ | ⭐⭐⭐ | P3 |
| executive-compensation-tax | 1 | 223 | ⭐⭐ | ⭐⭐⭐ | P3 |
| ma-tax-due-diligence | 1 | 195 | ⭐⭐ | ⭐⭐⭐ | P1 |
| deal-structure-tax-optimization | 1 | 162 | ⭐⭐ | ⭐⭐⭐ | P3 |
| customs-and-trade-compliance | 1 | 153 | ⭐⭐ | ⭐⭐⭐ | P3 |
| excise-and-other-indirect-taxes | 1 | 161 | ⭐⭐ | ⭐⭐⭐ | P3 |
| tp-documentation-preparation | 1 | 154 | ⭐⭐ | ⭐⭐⭐ | P3 |
| vat-compliance-optimization | 1 | 146 | ⭐⭐ | ⭐⭐⭐ | P3 |
| tax-digital-transformation | 1 | 165 | ⭐⭐ | ⭐⭐⭐ | P3 |
| tax-risk-management-framework | 1 | 172 | ⭐⭐ | ⭐⭐⭐ | P1 |
| apa-arrangement | 1 | 174 | ⭐⭐ | ⭐⭐⭐ | P3 |
| mindmap | 8 | 405 | ⭐⭐⭐⭐ | 保持 | P2 |
| pdf-management | 1 | 95 | ⭐⭐ | ⭐⭐⭐ | P3 |

---

*文档版本：v1.0*  
*下次评审：2026-06-10*
