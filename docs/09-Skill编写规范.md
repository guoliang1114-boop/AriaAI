# Skill 编写规范 v1.0

> 适用范围：本项目全部 48 个 Skill 及未来新增 Skill
> 生效日期：2026-05-27
> 下次评审：2026-06-10

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **最小可用优先** | 先让每个 Skill 达到可用级（300 行 + 5 个核心章节），再追求丰富度 |
| **领域聚类** | 按审计、税务、咨询、Tech 四大域统一风格，便于用户预期一致 |
| **标杆复制** | 以 `consulting-proposal-advisor`、`digital-strategy` 为模板，提炼通用结构 |
| **工具真实** | 所有引用的工具必须在 `dependencies` 中声明，并确保真实可用 |
| **可测可验** | 每个 Skill 至少包含一个 example input/output 对 |
| **单语一致** | 同一 Skill 内保持单一工作语言；默认中文，技术术语保留英文 |

---

## 2. 强制目录结构

每个 Skill 必须遵循以下目录结构。括号内为优先级：【必须】/【推荐】/【可选】。

```
skills/{skill-name}/
├── SKILL.md                    【必须】主文件
├── .version                    【必须】版本号，如 1.2.0
├── README.md                   【推荐】快速上手说明（面向人类开发者）
├── references/                 【推荐】参考文档目录
│   ├── framework.md            【推荐】方法论/框架详解
│   ├── checklist.md            【推荐】质量检查清单
│   └── examples.md             【推荐】输入输出示例说明
├── examples/                   【可选】示例文件目录
│   ├── input.md                【可选】示例输入
│   └── output.md               【可选】示例输出
├── assets/                     【可选】模板/图片/PPT 等资源
│   └── template.pptx
└── scripts/                    【可选】辅助脚本
    └── validate.py
```

### 目录命名规则

- 统一使用 **kebab-case**（短横线连接的小写字母）
- 示例：`tax-risk-assessment`、`digital-transformation-blueprint`
- 禁止：驼峰命名、下划线命名、中文命名

---

## 3. SKILL.md 头部规范（Frontmatter）

### 3.1 完整字段定义

```yaml
---
name: skill-name                           # 【必须】kebab-case，与目录名一致
description: "一句话描述，包含触发条件和输出物"   # 【必须】50–120 字，一句话说明
version: "1.0.0"                          # 【必须】semver 格式
domain: "audit"                           # 【必须】audit | tax | consulting | tech
tags: ["audit", "report", "ISA-700"]      # 【推荐】用于搜索和分类
author: "Team/Name"                       # 【可选】维护者信息
last_updated: "2026-05-27"                # 【必须】ISO 日期格式
status: "stable"                          # 【必须】stable | beta | deprecated
dependencies:                             # 【可选】依赖声明
  - skill: "presentation-builder"
    version: ">=1.0.0"
    reason: "生成 PPT 交付物时调用"
  - tool: "generate_ppt_from_skill"
    reason: "AriaAI 内置 PPT 生成工具"
---
```

### 3.2 字段约束

| 字段 | 类型 | 约束 | 示例 |
|------|------|------|------|
| `name` | string | kebab-case，与目录名完全一致 | `audit-risk-assessment` |
| `description` | string | 50–120 字，首句说明触发条件，次句说明输出物 | `"基于 ISA 315 框架评估重大错报风险，输出风险评估矩阵和审计策略建议"` |
| `version` | string | semver，初始版本 `1.0.0` | `"1.2.3"` |
| `domain` | string | 四选一：`audit` / `tax` / `consulting` / `tech` | `"audit"` |
| `tags` | array | 3–8 个标签，小写，用空格分隔的多词用短横线 | `["ISA-315", "risk-matrix", "audit-planning"]` |
| `status` | string | 三选一 | `"stable"` |
| `dependencies` | array | 每个依赖必须说明 `reason` | 见上方示例 |

### 3.3 description 编写模板

```
【触发条件】+ 【核心动作】+ 【输出物】+ 【适用场景补充】

示例：
"基于 ISA 315 框架识别和评估财务报表重大错报风险，输出风险评估矩阵、
固有风险/控制风险评级及审计策略调整建议。适用于年报审计、IPO 审计及
集团审计的风险评估阶段。"
```

### 3.4 标准化标签词表

为确保标签一致性和可检索性，使用以下推荐标签。自定义标签需小写 kebab-case。

| Domain | 推荐标签 |
|--------|---------|
| **audit** | `audit`, `risk-assessment`, `internal-controls`, `substantive-testing`, `ISA`, `PCAOB`, `SOX`, `fraud`, `report-drafting`, `walkthrough`, `ITGC`, `compliance` |
| **tax** | `tax`, `compliance`, `VAT`, `transfer-pricing`, `BEPS`, `corporate-tax`, `cross-border`, `tax-planning`, `dispute-resolution`, `indirect-tax`, `customs`, `tax-digital` |
| **consulting** | `consulting`, `due-diligence`, `strategy`, `ESG`, `debt`, `valuation`, `M&A`, `proposal`, `meeting`, `anomaly-detection` |
| **tech** | `diagram`, `architecture`, `PlantUML`, `ArchiMate`, `BPMN`, `mindmap`, `PPT`, `presentation`, `PDF`, `infocard` |
| **通用** | `framework`, `checklist`, `template`, `best-practice`, `methodology` |

### 3.5 name 字段规范

- 必须与目录名 **完全一致**
- 格式：`kebab-case`（小写字母 + 短横线）
- 长度：3–60 个字符
- 禁止：驼峰、下划线、中文、大写字母、连续短横线 `--`

| ✅ 正确 | ❌ 错误 |
|---------|---------|
| `audit-risk-assessment` | `AuditRiskAssessment` |
| `vat-compliance-optimization` | `vat_compliance_optimization` |
| `beps-pillar-two-assessment` | `BEPS-Pillar-Two` |

---

## 4. SKILL.md 正文章节（强制）

以下 **9 个章节** 为 **必须包含** 的章节。若某章节确实无内容，保留章节标题并注明 `"N/A - [原因]"`。

### 4.2 章节清单

```markdown
# Skill 标题

## 1. When To Use（触发条件）
## 2. Workflow（工作流）
## 3. Framework / Methodology（方法论）
## 4. Diagnostic Questions（诊断问题）
## 5. Output Format（输出格式）
## 6. Quality Checklist（质量检查）
## 7. Dependencies & Integrations（依赖与集成）
## 8. References（参考资料）
## 9. Changelog（变更日志）
```

### 4.3 各章节详细规范

#### 1. When To Use

- 列出 **3–5 个明确的触发场景**
- 每个场景用一句话描述，包含用户行为和上下文
- 增加 **关键词触发列表**（用于搜索和自动推荐）

```markdown
## 1. When To Use

- 审计团队在风险评估阶段需要识别重大错报风险
- 用户要求评估特定账户余额或交易类别的风险水平
- 需要基于行业特征调整审计策略

**触发关键词**：风险评估、重大错报、固有风险、控制风险、审计策略、ISA 315
```

#### 2. Workflow

- 步骤化流程，明确标注 **不可跳过的步骤**
- 每步说明：输入 → 处理 → 输出
- 使用 `→` 或编号列表，保持视觉一致性

```markdown
## 2. Workflow

```
1. Intake（信息收集）
   → 输入：客户行业、规模、前期审计发现
   → 处理：提取关键风险信号
   → 输出：风险关注点清单

2. Assessment（评估）
   → 输入：风险关注点 + 财务数据
   → 处理：应用风险评估矩阵
   → 输出：固有风险/控制风险评级

3. Strategy（策略制定）
   → 输入：风险评级结果
   → 处理：匹配审计程序
   → 输出：审计策略调整建议
```
```

#### 3. Framework / Methodology

- 阐述 **核心判断逻辑**：决策树、判断矩阵、流程图、评分标准
- 引用外部标准时注明 **具体条款编号**（如 `ISA 700 第 24–28 条`）
- 提供 **可操作的规则**，而非泛泛而谈

```markdown
## 3. Framework

### 意见类型决策逻辑（ISA 700 第 14–22 条）

```
审计证据是否充分适当？
├── 是 → 财务报表是否在所有重大方面公允反映？
│   ├── 是 → 无保留意见（Unmodified）
│   └── 否 → 错报是否重大且广泛？
│       ├── 是 → 否定意见（Adverse）
│       └── 否 → 保留意见（Qualified）
└── 否 → 无法获取充分审计证据的原因是否重大且广泛？
    ├── 是 → 无法表示意见（Disclaimer）
    └── 否 → 保留意见（Qualified）
```

### 评分标准

| 风险等级 | 可能性 | 影响程度 | 审计响应 |
|---------|--------|---------|---------|
| 高 | >70% | 重大 | 扩大测试范围、增加实质性程序 |
| 中 | 30–70% | 中等 | 标准测试程序 |
| 低 | <30% | 轻微 | 依赖控制测试 |
```

#### 4. Diagnostic Questions

- 至少 **5 个高质量追问**
- 区分 **Mandatory（必须回答）** 和 **Optional（可选）**
- 问题应能 **实质性改变输出结果**
- 避免泛泛而谈的问题（如"你有什么需求？"）

```markdown
## 4. Diagnostic Questions

### Mandatory
1. 被审计单位的行业类别和主要业务线是什么？
2. 本期相比上期，收入/成本/关联交易是否有重大波动？
3. 是否存在前期审计发现但未整改的重大内控缺陷？

### Optional
4. 管理层是否对关键会计估计提供了敏感性分析？
5. 是否有涉及重大管理层判断的复杂交易（如并购、重组）？
```

#### 5. Output Format

- 提供 **完整的 Markdown 输出模板**
- 明确标注 **必填字段 `[必填]`** 和 **选填字段 `[选填]`**
- 包含示例数据，让用户理解字段含义
- 若输出格式多样（如 memo / PPT / Excel），分别提供模板

```markdown
## 5. Output Format

```markdown
# 风险评估报告

## 基本信息
- **客户名称**：[必填]
- **审计期间**：[必填，如 2025-01-01 至 2025-12-31]
- **编制日期**：[必填]

## 风险评估矩阵

| 风险领域 | 固有风险 | 控制风险 | 综合风险 | 审计响应 |
|---------|---------|---------|---------|---------|
| 收入确认 | 高 | 中 | **高** | 扩大函证范围 |
| 存货计价 | 中 | 高 | **高** | 增加监盘程序 |

## 关键假设
- [ ] 假设 1：[需要验证的假设]
```
```

##### 多格式输出规范

当 Skill 支持多种输出格式时，需在 Output Format 中分别定义：

| 格式 | 何时输出 | 模板位置 | 工具依赖 |
|------|---------|---------|---------|
| **Markdown** | 默认输出 | SKILL.md 内嵌模板 | 无 |
| **PPT** | 用户明确要求 | `assets/template.pptx` | `generate_ppt_from_skill` |
| **Excel** | 数据表格场景 | `assets/template.xlsx` | `office-document-editor` |
| **PDF** | 正式交付物 | 由 Markdown 转换 | `pdf-management` |

每种格式需提供：触发条件、模板/示例、工具依赖声明。

#### 6. Quality Checklist

- 至少 **5 条交付前检查项**
- 使用 `[ ]` 复选框格式，便于实际勾选
- 覆盖：完整性、准确性、一致性、合规性、可执行性

```markdown
## 6. Quality Checklist

交付前必须确认：

- [ ] 所有风险领域均已评估，无遗漏
- [ ] 风险评级与审计响应措施逻辑一致
- [ ] 引用的审计准则条款编号准确
- [ ] 关键假设已标注并说明验证方式
- [ ] 输出模板中无占位符残留（如 `[示例]` 未替换）
```

#### 7. Dependencies & Integrations

- 列出 **调用的其他 Skill**（含版本约束）
- 列出 **依赖的外部工具/数据源**
- 说明 **调用时机和条件**

```markdown
## 7. Dependencies & Integrations

### Skill 依赖
| Skill | 版本 | 调用时机 | 说明 |
|-------|------|---------|------|
| `presentation-builder` | >=1.0.0 | 用户要求 PPT 输出时 | 将报告内容转换为咨询级 PPT |
| `audit-substantive-procedures` | >=1.0.0 | 风险评估完成后 | 根据风险等级匹配实质性程序 |

### 工具依赖
| 工具 | 用途 | 是否必需 |
|------|------|---------|
| `generate_ppt_from_skill` | PPT 生成 | 否，仅 PPT 模式需要 |
| `search` | 检索历史审计发现 | 是 |
```

#### 8. References

- 列出 **外部标准链接**（ISA、税法条文、会计准则等）
- 索引 **内部 references/ 目录文件**
- 注明 **最后访问日期**

```markdown
## 8. References

### 外部标准
- ISA 315 (Revised 2019) — Identifying and Assessing the Risks of Material Misstatement
- [中国注册会计师审计准则第 1211 号](https://www.cicpa.org.cn/...)（2026-05-20 访问）

### 内部参考
- `references/framework.md` — 风险评估框架详解
- `references/checklist.md` — 行业特定风险检查清单
- `references/examples.md` — 历史项目风险评估示例
```

#### 9. Changelog

- 记录 **所有版本变更**，从初始版本到最新版本
- 使用 **倒序排列**（最新版本在前）
- 每个版本注明 **日期** 和 **变更类型**（新增/修复/优化/废弃）
- 与 `.version` 文件中的版本号保持一致

```markdown
## 9. Changelog

### v1.2.0 (2026-05-27)
- 新增：跨境电商税务处理章节
- 优化：诊断问题从 5 个扩充到 8 个

### v1.1.0 (2026-04-15)
- 修复：税率引用错误（旧版 16% → 新版 13%）

### v1.0.0 (2026-03-01)
- 初始版本
```

### 4.4 常见错误示例

以下是各章节的典型错误写法，编写时应避免：

| 章节 | ❌ 错误示例 | ✅ 正确示例 | 问题 |
|------|-----------|-----------|------|
| **When To Use** | "当用户需要帮助时" | "审计团队在风险评估阶段需要识别重大错报风险" | 过于泛泛，无法触发 |
| **When To Use** | 无触发关键词 | "触发关键词：风险评估、重大错报、ISA 315" | 缺少搜索入口 |
| **Workflow** | "第一步收集信息，第二步分析，第三步输出" | "1. Intake → 输入：X → 处理：Y → 输出：Z" | 缺少输入/处理/输出三要素 |
| **Framework** | "参考相关准则进行判断" | "ISA 700 第 14-22 条：审计证据充分适当 → 无保留意见" | 无具体条款和判断逻辑 |
| **Diagnostic Questions** | "你有什么需求？" | "被审计单位的行业类别和主要业务线是什么？" | 泛泛而谈，无法改变输出 |
| **Diagnostic Questions** | 3 个问题 | 至少 5 个，区分 Mandatory/Optional | 数量不足 |
| **Output Format** | 无模板，仅文字描述 | 完整 Markdown 模板 + `[必填]` 标注 | 用户无法直接使用 |
| **Quality Checklist** | "检查内容是否完整" | "[ ] 所有风险领域均已评估，无遗漏" | 不可操作，无法勾选 |
| **Dependencies** | 未声明 `presentation-builder` 依赖 | 在 YAML `dependencies` 中声明并说明 `reason` | 运行时调用失败 |
| **References** | "参见 ISA 315" | "ISA 315 (Revised 2019) — [链接]（2026-05-20 访问）" | 缺少版本号和访问日期 |
| **Changelog** | 无 Changelog 章节 | 从 v1.0.0 开始记录所有变更 | 无法追溯变更历史 |

---

## 5. 行数与深度标准

| 等级 | SKILL.md 行数 | references/ | examples/ | 质量要求 | 适用阶段 |
|------|--------------|-------------|-----------|---------|---------|
| **骨架级** | 100–200 | 无 | 无 | 基本流程 + 输出模板 | 概念验证 |
| **可用级** | 250–400 | ≥1 文件 | 可选 | 完整 9 章节 + 诊断问题 + 质量检查 | **生产可用** |
| **标杆级** | 400+ | ≥2 文件 | ≥1 对 input/output | 可用级全部 + 脚本 + 多场景示例 | 最佳实践 |

### 升级路径

```
骨架级 → 可用级：补充 Diagnostic Questions + Quality Checklist + references/
可用级 → 标杆级：补充 examples/ + scripts/ + 多场景输出模板
```

---

## 6. 语言规范

### 6.1 默认规则

- **同一 Skill 内保持单一工作语言**
- **默认中文**：面向国内审计/税务团队的 Skill 使用中文
- **技术术语保留英文**：如 PlantUML、ArchiMate、KPI、OKR、RACI、EBITDA 等

### 6.2 禁止行为

| ❌ 禁止 | ✅ 正确 |
|--------|--------|
| 同一章节中英混杂 | 全中文或全英文 |
| "提升 efficiency" | "提升效率" 或 "improve efficiency" |
| 空泛的口号式表达 | 可衡量的具体描述 |

### 6.3 多语言 Skill 处理

若 Skill 需支持双语输出，在 `SKILL.md` 中明确说明：

```markdown
## Language Support

本 Skill 默认输出中文。若用户明确要求英文输出，切换为英文模式，
保持所有专业术语和结构不变。
```

### 6.4 语言切换规则

| 场景 | 处理方式 |
|------|---------|
| 用户用英文提问 | 默认仍用中文输出（除非用户明确要求英文） |
| 用户明确说"用英文" / "in English" | 切换为英文输出，专业术语保持英文原文 |
| 技术字段名、代码、API | 始终保持英文原文 |
| 标准引用（ISA、IFRS、GAAP） | 保持英文缩写 + 中文解释 |
| 输出模板中的字段名 | 保持与模板定义一致的语言 |

### 6.5 术语一致性要求

同一 Skill 内，同一概念必须使用统一译名。常见术语对照：

| 英文术语 | 推荐中文 | 禁止混用 |
|---------|---------|---------|
| Material Misstatement | 重大错报 | 重大错报 / material misstatement 混用 |
| Internal Controls | 内部控制 | 内控 / IC / internal controls 混用 |
| Substantive Procedures | 实质性程序 | 实质性测试 / substantive testing 混用 |
| Transfer Pricing | 转让定价 | 转移定价 / TP 混用 |
| Risk Assessment | 风险评估 | 风险评价 / risk evaluation 混用 |

---

## 7. 依赖管理规范

### 7.1 Skill 间调用

- 禁止 **循环依赖**（A 调用 B，B 调用 A）
- 建议采用 **单向依赖**：底层 Skill → 上层 Skill
- 依赖关系图：

```
底层（通用工具）
├── presentation-builder
├── office-document-editor
└── pdf-management

中层（领域框架）
├── audit-risk-assessment → 依赖 presentation-builder
├── tax-risk-management-framework → 依赖 presentation-builder
└── digital-strategy → 依赖 presentation-builder

上层（场景应用）
├── audit-report-draft → 依赖 audit-risk-assessment
├── ma-tax-due-diligence → 依赖 tax-risk-management-framework
└── consulting-proposal-advisor → 依赖 presentation-builder
```

### 7.2 工具依赖声明

所有引用的外部工具必须在 `dependencies` 中声明，并注明：

```yaml
dependencies:
  - tool: "generate_ppt_from_skill"
    availability: "AriaAI-chat-only"  # 或 "universal" / "local-only"
    fallback: "输出 Markdown 大纲，提示用户手动制作 PPT"
```

---

## 8. 版本管理

### 8.1 版本号文件

每个 Skill 目录下必须包含 `.version` 文件：

```
1.2.3
```

### 8.2 变更日志

在 `SKILL.md` 头部后添加 `## Changelog` 章节：

```markdown
## Changelog

### v1.2.3 (2026-05-27)
- 新增：增值税留抵退税场景的判断逻辑
- 修复：税率引用错误（旧版 16% → 新版 13%）

### v1.2.0 (2026-04-15)
- 新增：跨境电商税务处理章节

### v1.1.0 (2026-03-01)
- 优化：诊断问题从 5 个扩充到 8 个

### v1.0.0 (2026-01-15)
- 初始版本
```

### 8.3 版本升级规则（semver）

| 版本位 | 升级条件 | 示例 |
|--------|---------|------|
| **Major** (X.0.0) | 破坏性变更：删除章节、修改输出格式、重命名工具 | 1.0.0 → 2.0.0 |
| **Minor** (x.Y.0) | 新增功能：增加章节、新增输出格式、新增示例 | 1.1.0 → 1.2.0 |
| **Patch** (x.y.Z) | 修复：修正错误、更新引用、优化措辞 | 1.2.0 → 1.2.1 |

---

## 9. 质量门禁（Linter 检查项）

未来 `scripts/skill-linter.py` 将自动检查以下项目：

### 9.1 结构检查

| # | 检查项 | 严重级别 |
|---|--------|---------|
| 1 | 目录名与 `name` 字段一致 | 🔴 Error |
| 2 | 存在 `.version` 文件 | 🔴 Error |
| 3 | SKILL.md 包含全部 9 个强制章节 | 🟡 Warning |
| 4 | YAML Frontmatter 字段完整 | 🔴 Error |
| 5 | `description` 长度在 50–120 字之间 | 🟡 Warning |
| 6 | `dependencies` 中声明的工具有 `availability` 说明 | 🟡 Warning |

### 9.2 内容检查

| # | 检查项 | 严重级别 |
|---|--------|---------|
| 7 | Diagnostic Questions 数量 ≥5 | 🟡 Warning |
| 8 | Quality Checklist 数量 ≥5 | 🟡 Warning |
| 9 | Output Format 包含示例数据 | 🟡 Warning |
| 10 | 无占位符残留（`[示例]`、`[TODO]`、`TBD`） | 🔴 Error |
| 11 | 无空章节（标题下无内容） | 🔴 Error |
| 12 | Changelog 包含至少 1 个版本记录 | 🟡 Warning |
| 13 | `.version` 文件与 Changelog 最新版本一致 | 🟡 Warning |

### 9.3 规范检查

| # | 检查项 | 严重级别 |
|---|--------|---------|
| 14 | 技术术语使用一致（如全程使用"固有风险"而非混用"inherent risk"） | 🟡 Warning |
| 15 | 外部引用包含具体条款编号 | 🟢 Info |
| 16 | 存在 `references/` 目录（可用级以上要求） | 🟡 Warning |
| 17 | `name` 字段与目录名一致 | 🔴 Error |
| 18 | `tags` 使用标准化标签词表中的标签 | 🟢 Info |

---

## 10. 附录：标杆 Skill 参考

| Skill | 等级 | 学习点 |
|-------|------|--------|
| `consulting-proposal-advisor` | ⭐⭐⭐⭐⭐ | Reference Reading Order、Quick Mode、Deliverable Decision |
| `digital-strategy` | ⭐⭐⭐⭐⭐ | PPT Tool Call 规范、标准 storyline、layout_key 定义 |
| `audit-report-draft` | ⭐⭐⭐ | ISA 条款引用格式、决策树表达 |
| `goal-definition` | ⭐⭐⭐ | 输出模板结构化、SMART 检验表 |

---

## 11. 附录：Skill 模板脚手架

复制 `templates/skill-template/`（待创建）即可快速新建 Skill：

```bash
# 使用脚手架创建新 Skill
cp -r templates/skill-template skills/my-new-skill
# 编辑 SKILL.md、.version、references/
# 运行 linter 检查
python scripts/skill-linter.py skills/my-new-skill
```

---

*规范版本：v1.0*  
*维护者：架构组*  
*下次评审：2026-06-10*
