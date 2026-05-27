---
name: internal-audit-findings
description: "使用CCCE框架（状况、标准、原因、效果）编制内部审计发现报告，涵盖发现分类、整改追踪和报告编制"
---
# 内部审计发现与报告

## When To Use
- 审计项目执行完成，需要整理和报告审计发现时
- 需要对审计发现进行严重程度分类时
- 编制审计报告和管理层沟通函时
- 跟踪审计发现的整改进展时
- 向审计委员会报告重大审计发现时

## Tools
- finding-classifier: 发现分类器
- ccce-template-builder: CCCE模板构建器
- remediation-tracker: 整改追踪器
- report-generator: 审计报告生成器
- management-response-tracker: 管理层回复追踪器

## Framework
基于 IIA Performance Standards:

**Standard 2400 – Communicating Results:**
Internal auditors must communicate the results of engagements.

**Standard 2410 – Criteria for Communicating:**
Communications must include the engagement's objectives and scope as well as applicable conclusions, recommendations, and action plans.

**Standard 2420 – Quality of Communications:**
Communications must be accurate, objective, clear, concise, constructive, complete, and timely.

**Standard 2421 – Errors and Omissions:**
If a final communication contains a significant error or omission, the chief audit executive must communicate corrected information to all parties who received the original communication.

**Standard 2430 – Use of "Conducted in Conformance with the International Standards for the Professional Practice of Internal Auditing":**
Internal auditors may report engagement results as having been conducted in conformance with the IIA Standards only when supported by the quality assurance and improvement program.

**CCCE Framework (Finding Elements):**
- **Condition（状况）:** What is actually happening? What did the auditor find?
- **Criteria（标准）:** What should be happening? What is the benchmark?
- **Cause（原因）:** Why is the gap occurring? Root cause analysis.
- **Effect（效果）:** What is the impact? What are the consequences?

**Finding Classification (IIA Practice Guide):**
- **Significant（重大）:** Material financial impact, regulatory non-compliance, significant operational disruption, fraud
- **Moderate（中等）:** Moderate financial impact, control weakness requiring management attention, process inefficiency
- **Minor（一般）:** Minor control improvement opportunities, best practice recommendations

## Workflow
1. **汇总测试结果** — 从工作底稿中提取所有例外事项和异常发现
2. **初步筛选** — 排除不构成审计发现的事项（如解释合理的差异）
3. **CCCE分析** — 对每个审计发现进行四要素分析
   - 记录发现的状况（Condition）
   - 确认适用的标准（Criteria）
   - 分析根本原因（Cause）— 使用5 Why分析法或鱼骨图
   - 评估影响效果（Effect）— 量化财务影响和定性影响
4. **严重程度分类** — 根据影响程度和发生可能性对发现分级
5. **制定建议** — 针对每个发现提出具体、可行的改进建议
6. **管理层沟通** — 与被审计单位讨论发现，获取管理层回复
7. **编制审计报告** — 按标准格式编制审计发现报告
8. **整改计划确认** — 确认整改责任人、整改措施和完成期限
9. **报告审批** — 审计负责人审批后正式发布
10. **整改追踪** — 定期跟踪整改进展直至关闭

## Output Format
```
# 审计发现报告
## 一、报告概要
- 审计项目：[名称]
- 报告日期：[YYYY-MM-DD]
- 报告编号：[编号]
- 审计期间：[起止日期]
- 发现总数：[数量]（重大：X，中等：Y，一般：Z）

## 二、审计发现汇总
| 编号 | 发现标题 | 严重程度 | 涉及领域 | 整改期限 | 整改状态 |
|------|---------|---------|---------|---------|---------|
| F-001 | [标题]  | [级别]  | [领域]  | [日期]  | [状态]  |

## 三、重大审计发现详情
### 发现 F-001: [发现标题]
**严重程度：** 重大

**状况（Condition）：**
[描述审计发现的实际情况，包含具体数据、样本、时间等]

**标准（Criteria）：**
[引用适用的政策、法规、行业标准或最佳实践]

**原因（Cause）：**
[根本原因分析，使用5 Why或鱼骨图方法]

**效果（Effect）：**
- 财务影响：[量化金额或估算范围]
- 运营影响：[描述对业务运营的影响]
- 合规影响：[描述监管/法律风险]
- 声誉影响：[描述对组织声誉的潜在影响]

**审计建议：**
1. [具体建议1]
2. [具体建议2]

**管理层回复：**
- 整改措施：[描述]
- 责任人：[姓名/职位]
- 计划完成日期：[YYYY-MM-DD]

## 四、整改追踪表
| 编号 | 发现标题 | 严重程度 | 责任人 | 整改措施 | 计划完成日 | 实际完成日 | 验证结果 | 状态 |
|------|---------|---------|--------|---------|-----------|-----------|---------|------|
| F-001 | [标题]  | [级别]  | [姓名] | [措施]  | [日期]    | [日期]    | [结果]  | [开放/已关闭/逾期] |

## 五、审计发现趋势分析
| 年度 | 重大发现 | 中等发现 | 一般发现 | 总计 | 同比变化 |
|------|---------|---------|---------|------|---------|
| [年度] | [数量] | [数量]  | [数量]  | [总数] | [百分比] |

## 六、向审计委员会报告事项
- 需立即关注的重大发现：[列表]
- 逾期未整改的发现：[列表]
- 系统性/跨部门问题：[描述]
```

## Diagnostic Questions
1. 发现的控制缺陷是设计缺陷还是运行缺陷？
2. 是否存在系统性问题，而不仅是个别控制点的问题？
3. 根本原因是人员能力、制度设计、系统支持还是管理层意识？
4. 该发现是否与其他审计项目中的发现有关联？
5. 整改措施是否针对根本原因，而非仅解决表面问题？
6. 整改时间表是否合理，是否考虑了业务优先级？
7. 是否需要向监管机构报告该发现？
8. 管理层对发现的认同程度如何？是否存在分歧？

## Verification
- [ ] 每个发现均包含完整的CCCE四要素
- [ ] 发现描述客观、准确，有充分的审计证据支持
- [ ] 引用的标准权威、适当且与发现直接相关
- [ ] 根本原因分析深入，不仅停留在表面原因
- [ ] 影响评估量化且合理
- [ ] 建议具体、可行且与原因分析相呼应
- [ ] 管理层回复包含明确的整改措施、责任人和时间表
- [ ] 严重程度分类符合既定标准

## Saving
将完成的审计发现报告保存至项目目录：
- 审计报告：`/audit-engagements/{YYYY}/{project-name}/audit-report.md`
- 发现追踪表：`/audit-findings/remediation-tracker.md`
- 管理层回复：`/audit-engagements/{YYYY}/{project-name}/management-responses.md`
- 季度汇总：`/audit-findings/quarterly-summary-{YYYY}-Q{N}.md`
