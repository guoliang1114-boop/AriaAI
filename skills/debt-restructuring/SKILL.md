---
name: debt-restructuring
description: "债务重组：债务结构分析、重组路径设计、债权人谈判策略"
---

# 债务重组方案设计

## When To Use

- 企业面临债务偿还困难，需要重组债务结构
- 银行贷款即将到期且无法正常偿还
- 债券违约或即将违约
- 需要与债权人协商调整还款条件
- 企业陷入财务困境，需设计整体债务解决方案

## Tools

- 债务结构分析模板
- 现金流预测模型
- 债权人优先级矩阵
- 重组方案比较模型
- 法律程序评估工具

## Framework

### 债务重组路径选择

**Path A: Out-of-Court Workout（庭外重组/协商重组）**
- 适用条件：债务人仍有持续经营价值，债权人数量有限且愿意协商
- 主要手段：
  - 债务展期（Extension）
  - 利率调整（Interest Rate Reduction）
  - 债转债（Debt-for-Debt Exchange）
  - 债转股（Debt-for-Equity Swap）
  - 部分豁免（Haircut）
  - 资产处置偿债
- 优势：成本低、速度快、对经营影响小
- 劣势：需要全体/多数债权人同意，可能面临"钉子户"

**Path B: Formal Insolvency Procedures（正式破产程序）**

中国《企业破产法》框架下：
- **破产重整（Reorganization）**：企业仍有挽救价值，法院主导下的债务重组
  - 重整计划需债权人会议分组表决
  - 法院可强制批准（Cram Down）
  - 重整期间可继续经营
- **破产和解（Composition）**：债务人与债权人达成和解协议
- **破产清算（Liquidation）**：企业无挽救价值，资产变现分配

**国际比较**：
- US Chapter 11：DIP融资、自动冻结、确认听证
- UK Company Voluntary Arrangement (CVA) / Administration
- Singapore Scheme of Arrangement

### 债权人优先级（Waterfall）

```
1. 有担保债权（Secured Claims）— 担保物优先受偿
2. 破产费用和共益债务
3. 职工债权（工资、社保、补偿金）
4. 税款债权
5. 无担保债权（Unsecured Claims）
6. 次级债权（Subordinated Claims）
7. 股权（Equity）— 剩余财产分配
```

### 重组可行性评估

- **持续经营价值 vs 清算价值**：Going Concern Value > Liquidation Value → 重组优先
- **现金流测试**：重组后经营现金流能否覆盖重组后债务
- **利益相关方分析**：各债权人的谈判立场和底线

## Workflow

```
1. 债务结构分析
   ├─ 债务清单（金额、利率、期限、担保情况）
   ├─ 债权人分类（银行/债券/供应商/关联方）
   ├─ 到期时间分布
   ├─ 担保物评估
   └─ 交叉违约条款识别

2. 财务状况评估
   ├─ 资产负债分析
   ├─ 经营现金流分析
   ├─ 可变现资产评估
   ├─ 持续经营价值评估
   └─ 清算价值评估

3. 重组方案设计
   ├─ 重组目标设定（减债规模、展期期限）
   ├─ 多方案设计（展期/减免/债转股组合）
   ├─ 各方案现金流测算
   ├─ 各方案对债权人的回收率
   └─ 方案可行性评估

4. 债权人谈判
   ├─ 债权人立场分析
   ├─ 谈判策略制定
   ├─ 关键条款设计
   ├─ 分组表决安排
   └─ 法律文件准备

5. 方案执行
   ├─ 重组协议签署
   ├─ 法院裁定（如适用）
   ├─ 条件满足/豁免
   ├─ 资金安排
   └─ 后续监控
```

## Output Format

```markdown
# 债务重组方案

## 一、企业基本情况
| 项目 | 内容 |
|------|------|
| 企业名称 | |
| 所属行业 | |
| 债务总额 | |
| 资产总额 | |
| 资产负债率 | |
| 经营状况 | |

## 二、债务结构分析
| 债权人 | 本金 | 利率 | 到期日 | 担保情况 | 优先级 |
|--------|------|------|--------|----------|--------|
| 银行A | | | | | 有担保 |
| 债券B | | | | | 无担保 |
| 供应商C | | | | | 无担保 |
| **合计** | | | | | |

## 三、重组路径选择
| 路径 | 适用条件 | 优势 | 劣势 | 可行性 |
|------|----------|------|------|--------|
| 庭外协商 | | | | |
| 破产重整 | | | | |
| 破产和解 | | | | |
| **建议路径** | | | | |

## 四、重组方案
### 方案A：展期+减免
| 债权人 | 原债务 | 减免比例 | 重组后债务 | 展期期限 | 新利率 |
|--------|--------|----------|------------|----------|--------|
| | | | | | |

### 方案B：债转股
| 债权人 | 转股金额 | 转股价格 | 转股比例 | 稀释后持股 |
|--------|----------|----------|----------|------------|
| | | | | |

### 方案比较
| 维度 | 方案A | 方案B |
|------|-------|-------|
| 债权人回收率 | | |
| 原股东稀释 | | |
| 重组后负债率 | | |
| 现金流压力 | | |
| 可行性 | | |

## 五、重组后财务预测
| 指标 | Year 1 | Year 2 | Year 3 |
|------|--------|--------|--------|
| 收入 | | | |
| EBITDA | | | |
| 偿债现金流 | | | |
| 资产负债率 | | | |
| 利息覆盖率 | | | |

## 六、谈判策略
| 债权人 | 谈判立场 | 底线 | 策略 | 关键筹码 |
|--------|----------|------|------|----------|
| | | | | |

## 七、时间表
| 阶段 | 时间 | 关键事项 |
|------|------|----------|
| 准备期 | | |
| 谈判期 | | |
| 签约期 | | |
| 执行期 | | |
```

## Diagnostic Questions

1. 企业的债务总额和构成？有哪些类型的债权人？
2. 是否有已违约或即将违约的债务？
3. 企业的核心资产和持续经营价值如何？
4. 主要债权人的态度和立场？
5. 是否已有部分债权人采取法律行动？
6. 企业是否有引入战略投资者的可能？

## Verification

- 核实债务数据的完整性和准确性
- 验证可变现资产估值的合理性
- 确认重组方案的法律合规性
- 检查现金流预测的保守性
- 评估各方案对债权人的公平性

## Saving

保存路径：`/cases/{client}/debt-restructuring/`
文件命名：`debt-restructuring-proposal-{company}-{date}.md`
关联文件：债务清单、现金流模型、法律意见书

## Capability Upgrade

### Mode Selection

- **Quick**: 输出债务压力、可选路径和谈判重点。
- **Standard**: 输出债务结构、现金流、债权人分层、重组方案和谈判策略。
- **Deep**: 结合债务合同、担保、现金流模型、资产处置、法律约束和债权人画像，形成重组方案包。

### Restructuring Decision Model

| 方案 | 适用条件 | 关注点 |
|------|----------|--------|
| 展期 | 短期流动性压力，业务仍可恢复 | 现金流覆盖、利率调整 |
| 减免 | 偿债缺口明确，债权人需承担损失 | 公平性、谈判筹码 |
| 债转股 | 长期价值仍在，现金偿付困难 | 估值、控制权、退出 |
| 资产处置 | 非核心资产可变现 | 时间、折价、税费 |

### Quality Gates

- [ ] 债权人顺位、担保和交叉违约条款已识别。
- [ ] 现金流预测有保守、基准和乐观情景。
- [ ] 每个方案显示债权人回收率和公司可持续性。
- [ ] 谈判策略区分金融债权人、供应商和其他利益方。
- [ ] 推荐方案包含时间线、条件和备选路径。

## Consulting Excellence Layer

### Restructuring Storyline

A restructuring recommendation must explain:

1. Why the current capital structure is unsustainable.
2. How much liquidity runway remains.
3. Which stakeholders control the outcome.
4. Which restructuring options preserve the most enterprise value.
5. What concessions are required from each stakeholder.
6. What happens if no agreement is reached.

### Liquidity First

Always build the work around a 13-week cash view when available:

| Week | Opening Cash | Receipts | Critical Payments | Debt Service | Closing Cash | Covenant / Trigger |
|------|--------------|----------|-------------------|--------------|--------------|--------------------|

If no cash data exists, request it or produce a data request list before recommending aggressive options.

### Stakeholder Map

| Stakeholder | Exposure | Security | Motivation | Likely Position | Negotiation Lever |
|-------------|----------|----------|------------|-----------------|-------------------|
| Senior lenders |  |  |  |  |  |
| Trade creditors |  |  |  |  |  |
| Shareholders |  |  |  |  |  |
| Employees / unions |  |  |  |  |  |
| Government / regulators |  |  |  |  |  |

### Plan B Requirement

Every consensual restructuring plan must include a fallback scenario: standstill failure, enforcement, insolvency filing, asset sale, or emergency financing.

### Output Standard

The final output should include liquidity diagnosis, creditor waterfall, option comparison, recommended term sheet, negotiation strategy, communications plan and implementation timetable.

### Deliverable Catalog

| Deliverable | When to use | Minimum content | Format |
|-------------|-------------|-----------------|--------|
| Liquidity diagnostic memo | 判断危机程度 | 现金余额、runway、关键支付、违约风险和触发点 | Markdown / PPT |
| 13-week cash flow | 短期现金管理 | 周度收款、付款、债务服务、缺口和行动项 | Excel |
| Creditor waterfall | 判断债权人回收 | 债务层级、担保、优先级、回收率和敏感性 | Excel / PPT |
| Stakeholder map | 制定谈判策略 | 债权人、股东、供应商、员工、监管方立场和筹码 | PPT |
| Restructuring options paper | 比较重组路径 | 展期、减免、债转股、资产处置、再融资和影响 | Word / PPT |
| Indicative term sheet | 进入谈判 | 期限、利率、偿还、减免、担保、约束和条件 | Word |
| Negotiation plan | 与债权人沟通 | 顺序、话术、让步、底线、材料和时间表 | Markdown / PPT |
| Contingency plan | 协商失败准备 | standstill failure、执行、破产、紧急融资和沟通预案 | Word / PPT |
