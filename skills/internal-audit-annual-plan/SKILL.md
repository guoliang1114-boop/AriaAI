---
name: internal-audit-annual-plan
description: "基于IIA国际内部审计专业实务标准，制定风险导向的年度内部审计计划，涵盖审计宇宙、风险评分、资源分配"
---
# 年度内部审计计划

## When To Use
- 每年年初制定或修订年度内部审计计划
- 组织架构、业务环境或风险状况发生重大变化时
- 管理层或审计委员会要求更新审计计划时
- 合并、收购或新业务线启动时重新评估审计范围

## Tools
- risk-scoring-matrix: 风险评分矩阵工具
- audit-universe-builder: 审计宇宙构建器
- resource-allocation-calculator: 资源分配计算器
- stakeholder-interview-template: 利益相关方访谈模板

## Framework
基于 IIA International Standards for the Professional Practice of Internal Auditing:

**Standard 2010 – Planning:**
Chief audit executive must establish a risk-based plan to determine the priorities of the internal audit activity, consistent with the organization's goals.

**Standard 2010.A1:**
The internal audit activity's plan of engagements must be based on a documented risk assessment, undertaken at least annually.

**Standard 2020 – Communication and Approval:**
The chief audit executive must communicate the internal audit activity's plans and resource requirements to senior management and the board for review and approval.

**Standard 2030 – Resource Management:**
The chief audit executive must ensure that internal audit resources are sufficient and appropriate to fulfill the approved plan.

**COSO 2013 Integration:**
审计计划应覆盖COSO五要素（控制环境、风险评估、控制活动、信息与沟通、监督活动）及其17项原则。

## Workflow
1. **收集背景信息** — 审阅组织战略、业务计划、上年审计报告、监管要求
2. **构建审计宇宙** — 识别所有可审计单元（业务流程、部门、系统、项目）
3. **风险评估与评分** — 使用固有风险和控制风险二维矩阵对每个可审计单元评分
   - 固有风险因素：财务影响、运营复杂性、监管环境、变革程度、历史问题
   - 控制风险因素：控制成熟度、上次审计时间、管理层关注程度
4. **优先级排序** — 综合风险评分排序，确定高/中/低优先级审计领域
5. **资源分配** — 根据可用审计资源（人天）匹配高优先级审计项目
6. **编制年度计划** — 汇总审计项目清单、时间表、资源需求
7. **审批流程** — 提交审计委员会和高级管理层审批
8. **沟通与发布** — 向相关部门负责人沟通计划安排

## Output Format
```
# 年度内部审计计划
## 一、计划概述
- 计划年度：[YYYY]
- 编制日期：[YYYY-MM-DD]
- 审计负责人：[姓名]
- 审计委员会审批日期：[YYYY-MM-DD]

## 二、审计宇宙清单
| 序号 | 可审计单元 | 所属部门 | 业务类型 | 上次审计日期 |
|------|-----------|---------|---------|-------------|
| 1    | [单元名称] | [部门]  | [类型]  | [日期]      |

## 三、风险评分矩阵
| 可审计单元 | 财务影响(1-5) | 运营复杂性(1-5) | 监管环境(1-5) | 变革程度(1-5) | 控制成熟度(1-5) | 综合风险评分 | 优先级 |
|-----------|--------------|----------------|--------------|--------------|----------------|-------------|--------|
| [单元]    | [评分]       | [评分]         | [评分]       | [评分]       | [评分]         | [加权总分]  | [高/中/低] |

## 四、年度审计项目计划
| 序号 | 审计项目 | 审计类型 | 计划人天 | 计划期间 | 审计目标 | 项目负责人 |
|------|---------|---------|---------|---------|---------|-----------|
| 1    | [项目名] | [类型]  | [天数]  | [月份]  | [目标]  | [姓名]    |

## 五、资源分配总表
- 总可用人天：[数量]
- 已分配人天：[数量]
- 预留应急人天：[数量]
- 资源利用率：[百分比]

## 六、专项审计/咨询项目
| 项目名称 | 触发原因 | 预计人天 | 时间安排 |
|---------|---------|---------|---------|
| [项目]  | [原因]  | [天数]  | [安排]  |

## 七、审批签署
- 审计负责人签署：________ 日期：________
- 审计委员会主席签署：________ 日期：________
```

## Diagnostic Questions
1. 组织当前面临的主要战略风险是什么？
2. 上年审计发现的重大问题是否已得到有效整改？
3. 本年度有哪些重大业务变革（新系统、新业务线、组织重组）？
4. 监管环境有何变化？是否有新的合规要求？
5. 管理层和审计委员会对审计重点有何特别关注？
6. 当前审计团队的专业能力和人数是否满足计划需求？
7. 是否有外部审计师的协调要求需要纳入计划？

## Verification
- [ ] 审计宇宙是否覆盖所有重要业务单元和流程
- [ ] 风险评分是否基于充分的信息和合理的判断
- [ ] 高风险领域是否均已安排审计项目
- [ ] 资源分配是否合理，不超过可用总量
- [ ] 计划已获得审计委员会正式审批
- [ ] 与外部审计师的协调安排已确认
- [ ] 预留适当的应急资源应对突发事件

## Saving
将完成的年度审计计划保存至项目目录：
- 文件路径：`/audit-plans/annual-plan-{YYYY}.md`
- 风险评分工作底稿：`/audit-plans/risk-assessment-{YYYY}.xlsx`
- 审计委员会审批记录：`/audit-plans/approval-memo-{YYYY}.md`
- 审计宇宙清单：`/audit-plans/audit-universe-{YYYY}.md`
- 利益相关方访谈记录：`/audit-plans/stakeholder-interviews-{YYYY}.md`

**版本控制：**
- 每次修订年度计划时，保留历史版本并注明修订原因
- 季度滚动更新时，在计划末尾附上变更记录表
- 年度结束后，将最终版计划与实际执行情况对比，作为下年计划参考

**文件命名规范：**
- 所有文件使用小写字母和连字符
- 包含年份标识以便归档检索
- 附件统一放在同目录下的 `attachments/` 子目录
