---
name: sox-compliance-checklist
description: "基于PCAOB AS 2201和SOX Section 302/404，执行萨班斯-奥克斯利法案合规检查，涵盖管理层评估、内部控制评价和审计师鉴证"
---
# SOX合规检查清单

## When To Use
- 年度SOX 404合规评估周期开始时
- 季度SOX 302认证准备时
- 新业务流程或系统上线需要评估内控影响时
- 管理层需要对内部控制有效性发表意见时
- 外部审计师要求提供内控测试支持时
- 控制缺陷发生后评估影响和补救措施时

## Tools
- coso-principle-assessor: COSO原则评估器
- control-test-executor: 控制测试执行器
- deficiency-classifier: 缺陷分类器
- sox-evidence-collector: SOX证据收集器
- management-assessment-builder: 管理层评估报告构建器

## Framework
基于以下国际标准：

**PCAOB Auditing Standard No. 2201 (AS 2201) — An Audit of Internal Control Over Financial Reporting:**
- Paragraph 5: Definition of significant deficiency and material weakness
- Paragraph 7-9: Planning the audit of ICFR
- Paragraph 34-42: Identifying significant accounts and disclosures
- Paragraph 44-49: Understanding likely sources of misstatement
- Paragraph 70-78: Testing design and operating effectiveness of controls
- Paragraph 113-120: Evaluating identified deficiencies

**SOX Section 302 — Corporate Responsibility for Financial Reports:**
- CEO/CFO certification of financial statements
- Responsibility for internal controls
- Disclosure of control deficiencies to audit committee and auditor

**SOX Section 404 — Management Assessment of Internal Controls:**
- Annual management assessment of ICFR effectiveness
- Auditor attestation on management's assessment

**COSO 2013 Internal Control — Integrated Framework (5 Components × 17 Principles):**

### 1. Control Environment（控制环境）
- P1: Demonstrates commitment to integrity and ethical values
- P2: Exercises oversight responsibility
- P3: Establishes structure, authority, and responsibility
- P4: Demonstrates commitment to competence
- P5: Enforces accountability

### 2. Risk Assessment（风险评估）
- P6: Specifies suitable objectives
- P7: Identifies and analyzes risk
- P8: Assesses fraud risk
- P9: Identifies and analyzes significant change

### 3. Control Activities（控制活动）
- P10: Selects and develops control activities
- P11: Selects and develops general controls over technology
- P12: Deploys through policies and procedures

### 4. Information & Communication（信息与沟通）
- P13: Uses relevant information
- P14: Communicates internally
- P15: Communicates externally

### 5. Monitoring Activities（监督活动）
- P16: Conducts ongoing and/or separate evaluations
- P17: Evaluates and communicates deficiencies

## Workflow
1. **范围界定** — 确定SOX重要账户、重大业务流程和IT系统范围
2. **流程文档化** — 编制或更新流程描述、风险控制矩阵（RCM）
3. **控制识别** — 识别每个业务流程中的关键控制点
4. **COSO原则评估** — 逐一评估17项COSO原则的设计有效性
5. **控制测试设计** — 针对每个关键控制设计测试程序
6. **样本量确定** — 根据控制频率确定测试样本量
   - 年度控制：1个样本
   - 季度控制：2个样本
   - 月度控制：2-5个样本
   - 周控制：5-15个样本
   - 日常控制：20-40个样本
7. **执行测试** — 按计划执行控制测试并收集证据
8. **缺陷评估** — 按AS 2201标准评估发现的缺陷
9. **管理层评估** — 编制管理层对ICFR有效性的评估报告
10. **审计师协调** — 与外部审计师沟通测试结果和发现的缺陷

## Output Format
```
# SOX合规检查清单
## 一、评估概述
- 评估年度：[YYYY]
- 编制日期：[YYYY-MM-DD]
- 评估范围：[重要账户和业务流程列表]
- 评估负责人：[姓名]
- 外部审计师：[事务所名称]

## 二、重要账户与流程矩阵
| 序号 | 重要账户 | 相关业务流程 | 涉及IT系统 | 风险等级 | 重大错报风险 |
|------|---------|-------------|-----------|---------|-------------|
| 1    | [账户]  | [流程]      | [系统]    | [高/中]  | [描述]      |

## 三、COSO五要素 × 17原则评估
### 3.1 控制环境
| 原则 | 原则描述 | 评估结论 | 设计有效性 | 运行有效性 | 证据索引 |
|------|---------|---------|-----------|-----------|---------|
| P1   | Demonstrates commitment to integrity | [有效/无效] | [是/否] | [是/否] | [索引] |
| P2   | Exercises oversight responsibility | [有效/无效] | [是/否] | [是/否] | [索引] |
| P3   | Establishes structure, authority | [有效/无效] | [是/否] | [是/否] | [索引] |
| P4   | Demonstrates commitment to competence | [有效/无效] | [是/否] | [是/否] | [索引] |
| P5   | Enforces accountability | [有效/无效] | [是/否] | [是/否] | [索引] |

### 3.2 风险评估
| 原则 | 原则描述 | 评估结论 | 设计有效性 | 运行有效性 | 证据索引 |
|------|---------|---------|-----------|-----------|---------|
| P6   | Specifies suitable objectives | [有效/无效] | [是/否] | [是/否] | [索引] |
| P7   | Identifies and analyzes risk | [有效/无效] | [是/否] | [是/否] | [索引] |
| P8   | Assesses fraud risk | [有效/无效] | [是/否] | [是/否] | [索引] |
| P9   | Identifies significant change | [有效/无效] | [是/否] | [是/否] | [索引] |

### 3.3 控制活动
| 原则 | 原则描述 | 评估结论 | 设计有效性 | 运行有效性 | 证据索引 |
|------|---------|---------|-----------|-----------|---------|
| P10  | Selects control activities | [有效/无效] | [是/否] | [是/否] | [索引] |
| P11  | General controls over technology | [有效/无效] | [是/否] | [是/否] | [索引] |
| P12  | Deploys through policies | [有效/无效] | [是/否] | [是/否] | [索引] |

### 3.4 信息与沟通
| 原则 | 原则描述 | 评估结论 | 设计有效性 | 运行有效性 | 证据索引 |
|------|---------|---------|-----------|-----------|---------|
| P13  | Uses relevant information | [有效/无效] | [是/否] | [是/否] | [索引] |
| P14  | Communicates internally | [有效/无效] | [是/否] | [是/否] | [索引] |
| P15  | Communicates externally | [有效/无效] | [是/否] | [是/否] | [索引] |

### 3.5 监督活动
| 原则 | 原则描述 | 评估结论 | 设计有效性 | 运行有效性 | 证据索引 |
|------|---------|---------|-----------|-----------|---------|
| P16  | Conducts evaluations | [有效/无效] | [是/否] | [是/否] | [索引] |
| P17  | Communicates deficiencies | [有效/无效] | [是/否] | [是/否] | [索引] |

## 四、风险控制矩阵（RCM）
| 流程 | 风险描述 | 控制活动 | 控制类型 | 控制频率 | 测试样本量 | 测试结果 | 缺陷 |
|------|---------|---------|---------|---------|-----------|---------|------|
| [流程] | [风险] | [控制] | [预防/检测] | [频率] | [数量] | [通过/未通过] | [编号] |

## 五、缺陷评估汇总
| 缺陷编号 | 涉及控制 | 缺陷描述 | 缺陷分类 | 影响评估 | 整改措施 | 责任人 | 计划修复日 |
|---------|---------|---------|---------|---------|---------|--------|-----------|
| D-001   | [控制]  | [描述]  | MW/SD/CD | [影响]  | [措施]  | [姓名] | [日期]    |

**缺陷分类说明：**
- MW = Material Weakness（重大缺陷）：合理可能性导致重大错报未被及时防止或发现
- SD = Significant Deficiency（重要缺陷）：严重程度低于重大缺陷但值得审计委员会关注
- CD = Control Deficiency（一般缺陷）：其他控制缺陷

## 六、管理层评估结论
- 内部控制总体结论：[有效/无效]
- 是否存在重大缺陷：[是/否]
- 是否存在重要缺陷：[是/否]
- 需披露的控制缺陷：[列表]

## 七、SOX 302认证检查项
| 检查项 | 状态 | 备注 |
|--------|------|------|
| 财务报表已审阅 | [完成/待完成] | [备注] |
| 报告不含重大虚假陈述 | [确认/待确认] | [备注] |
| 内部控制设计和运行有效性已评估 | [完成/待完成] | [备注] |
| 向审计委员会披露了所有缺陷 | [完成/待完成] | [备注] |
| 过去90天内评估了内控变化 | [完成/待完成] | [备注] |
```

## Diagnostic Questions
1. 本年度是否发生了重大业务变化（并购、新系统、重组）？
2. 上年外部审计师是否提出了新的测试要求或关注领域？
3. 本年度是否发生了已知的欺诈事件或合规违规？
4. IT系统环境是否有重大变更（ERP升级、新模块上线）？
5. 管理层是否已评估所有未整改的控制缺陷的累积影响？
6. 与外部审计师的协调安排和时间表是否已确认？
7. 控制测试证据的保留和归档是否符合PCAOB要求？
8. 是否存在需要单独报告给SEC的实质性弱点？

## Verification
- [ ] 所有重要账户和业务流程均已纳入评估范围
- [ ] COSO 17项原则均已逐一评估并记录结论
- [ ] 关键控制的设计有效性和运行有效性均已测试
- [ ] 控制测试样本量符合PCAOB AS 2201要求
- [ ] 缺陷分类符合AS 2201定义（重大缺陷/重要缺陷/一般缺陷）
- [ ] 管理层评估报告已包含所有必需要素
- [ ] SOX 302认证检查项全部完成
- [ ] 与外部审计师的测试结果已协调一致

## Saving
将完成的SOX合规检查清单保存至项目目录：
- 合规检查清单：`/sox-compliance/{YYYY}/sox-checklist.md`
- 风险控制矩阵：`/sox-compliance/{YYYY}/rcm-matrix.md`
- COSO评估报告：`/sox-compliance/{YYYY}/coso-assessment.md`
- 管理层评估报告：`/sox-compliance/{YYYY}/management-assessment.md`
- 缺陷追踪表：`/sox-compliance/{YYYY}/deficiency-tracker.md`
- 测试证据：`/sox-compliance/{YYYY}/testing-evidence/`
