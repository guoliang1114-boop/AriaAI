---
name: internal-audit-execution
description: "基于IIA绩效标准执行内部审计项目，涵盖审计目标、范围、程序、抽样方法和工作底稿编制"
---
# 内部审计项目执行

## When To Use
- 按年度计划启动具体审计项目时
- 执行专项审计或管理层要求的咨询项目时
- 需要编制审计程序和工作底稿时
- 实施审计抽样和实质性测试时

## Tools
- audit-program-builder: 审计程序编制器
- sampling-calculator: 抽样计算器
- working-paper-template: 工作底稿模板
- walkthrough-trace-tool: 穿行测试追踪工具
- interview-questionnaire: 访谈问卷生成器

## Framework
基于 IIA Performance Standards:

**Standard 2200 – Engagement Planning:**
Internal auditors must develop and document a plan for each engagement, including the objectives, scope, timing, and resource allocations.

**Standard 2201 – Engagement Planning Considerations:**
In planning the engagement, internal auditors must consider:
- The objectives of the activity being reviewed and the means by which the activity controls its performance
- The significant risks to the activity, its objectives, resources, and operations
- The adequacy and effectiveness of the activity's risk management and control processes

**Standard 2210 – Engagement Objectives:**
Objectives must be established for each engagement.

**Standard 2220 – Engagement Scope:**
The scope of the engagement must be sufficient to satisfy the objectives of the engagement.

**Standard 2230 – Engagement Resource Allocation:**
Internal auditors must determine appropriate and sufficient resources to achieve engagement objectives.

**Standard 2300 – Performing the Engagement:**
Internal auditors must identify, analyze, evaluate, and document sufficient information to achieve engagement objectives.

**Standard 2310 – Identifying Information:**
Internal auditors must identify sufficient, reliable, relevant, and useful information to achieve engagement objectives.

**Standard 2320 – Analysis and Evaluation:**
Internal auditors must base conclusions and engagement results on appropriate analyses and evaluations.

**ISA 530 Sampling Reference:**
审计抽样应遵循国际审计准则530号的统计和非统计抽样方法。

## Workflow
1. **项目启动** — 发送审计通知书，召开启动会议，确认联络人
2. **初步调查** — 了解被审计单位的业务流程、内部控制、风险状况
3. **编制审计程序** — 根据审计目标制定详细的审计程序和测试步骤
4. **穿行测试** — 选取一笔交易从头到尾追踪，验证对流程的理解
5. **控制测试** — 测试关键控制点的设计有效性和运行有效性
6. **实质性测试** — 根据风险评估结果执行实质性程序
   - 确定抽样方法（属性抽样/变量抽样/MUS）
   - 确定样本量（基于置信水平、可容忍偏差率、预期偏差率）
   - 执行测试并记录结果
7. **分析与评价** — 汇总测试结果，分析异常事项
8. **工作底稿编制** — 记录审计程序执行过程和结论
9. **质量复核** — 项目负责人复核工作底稿的完整性和准确性
10. **结果汇总** — 整理审计发现，准备与管理层沟通

## Output Format
```
# 审计项目工作底稿
## 一、项目基本信息
- 审计项目名称：[名称]
- 审计期间：[起止日期]
- 项目负责人：[姓名]
- 项目组成员：[姓名列表]
- 审计通知书编号：[编号]

## 二、审计目标与范围
### 审计目标
1. [目标1]
2. [目标2]

### 审计范围
- 业务范围：[描述]
- 时间范围：[描述]
- 组织范围：[描述]

### 不在审计范围内的事项
- [排除项及原因]

## 三、风险评估
| 风险领域 | 风险描述 | 风险等级 | 拟实施的审计程序 |
|---------|---------|---------|-----------------|
| [领域]  | [描述]  | [高/中/低] | [程序概述]     |

## 四、审计程序表
| 序号 | 审计领域 | 审计目标 | 审计程序 | 测试步骤 | 样本量 | 执行人 | 计划工时 |
|------|---------|---------|---------|---------|--------|--------|---------|
| 1    | [领域]  | [目标]  | [程序]  | [步骤]  | [数量] | [姓名] | [小时]  |

## 五、抽样方案
- 总体规模：[数量]
- 抽样方法：[统计抽样/非统计抽样/MUS]
- 置信水平：[百分比]
- 可容忍偏差率：[百分比]
- 预期偏差率：[百分比]
- 确定样本量：[数量]
- 实际选取样本：[数量]

## 六、工作底稿索引
| 索引号 | 底稿标题 | 编制人 | 编制日期 | 复核人 | 复核日期 |
|--------|---------|--------|---------|--------|---------|
| WP-001 | [标题]  | [姓名] | [日期]  | [姓名] | [日期]  |

## 七、访谈记录
| 访谈日期 | 被访谈人 | 职务 | 访谈主题 | 主要内容 | 底稿索引 |
|---------|---------|------|---------|---------|---------|
| [日期]  | [姓名]  | [职务] | [主题]  | [摘要]  | [索引]  |

## 八、测试结果汇总
| 审计领域 | 测试样本数 | 例外数量 | 例外率 | 结论 | 相关发现 |
|---------|-----------|---------|--------|------|---------|
| [领域]  | [数量]    | [数量]  | [百分比] | [结论] | [发现编号] |
```

## Diagnostic Questions
1. 被审计单位的核心业务流程是什么？关键控制点在哪里？
2. 上次审计以来，业务流程有哪些重大变化？
3. 管理层对本审计项目有何预期和特别关注点？
4. 是否存在已知的控制缺陷或合规问题需要重点测试？
5. 可获取的数据和系统权限是否满足审计需要？
6. 是否需要外部专家（IT审计师、估值专家）参与？
7. 审计时间安排是否与被审计单位的业务周期协调？

## Verification
- [ ] 审计目标明确且可衡量
- [ ] 审计范围充分覆盖风险评估识别的高风险领域
- [ ] 审计程序与审计目标之间有清晰的对应关系
- [ ] 抽样方法和样本量符合专业标准
- [ ] 所有工作底稿均经过适当复核
- [ ] 审计证据充分、适当，支持审计结论
- [ ] 工作底稿索引完整、交叉引用正确

## Saving
将完成的审计工作底稿保存至项目目录：
- 工作底稿主文件：`/audit-engagements/{YYYY}/{project-name}/working-papers.md`
- 审计程序表：`/audit-engagements/{YYYY}/{project-name}/audit-program.md`
- 访谈记录：`/audit-engagements/{PROJECT}/interview-notes/`
- 抽样工作底稿：`/audit-engagements/{YYYY}/{project-name}/sampling-workpaper.md`
