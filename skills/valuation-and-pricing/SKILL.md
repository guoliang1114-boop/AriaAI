---
name: valuation-and-pricing
description: "估值与定价：DCF、可比公司、可比交易、LBO估值方法，WACC计算、终值、敏感性分析"
version: "1.0.0"
domain: "consulting"
last_updated: "2026-08-26"
status: "stable"
---

# 估值与定价分析

## When To Use

- 并购交易的标的估值和定价建议
- 股权融资的企业价值评估
- 财务报告目的的公允价值评估
- 投资决策的回报分析
- 争议解决中的价值评估

## Tools

- 财务数据库（Bloomberg、Capital IQ、Wind）
- WACC计算器
- DCF估值模型
- 可比公司/可比交易分析模板
- 敏感性分析矩阵

## Framework

### 估值方法论

**Method 1: Discounted Cash Flow (DCF)**
- 自由现金流预测（FCFF / FCFE）
- 折现率计算（WACC）
- 终值计算（永续增长法 / 退出倍数法）
- 企业价值 = PV(显性期FCF) + PV(终值) - 净债务

**WACC计算**：
```
WACC = E/(D+E) × Ke + D/(D+E) × Kd × (1-T)
Ke = Rf + β × ERP + α（公司特定风险溢价）
```
- Rf: 无风险利率（10年期国债收益率）
- β: 权益贝塔（行业可比公司去杠杆β的中位数）
- ERP: 股权风险溢价（通常4-6%）
- α: 公司特定风险溢价（0-5%）
- Kd: 债务成本（税前）
- T: 企业所得税率

**终值计算**：
- 永续增长法：TV = FCF_n × (1+g) / (WACC - g)
- 退出倍数法：TV = EBITDA_n × Exit Multiple

**Method 2: Comparable Company Analysis (Comps)**
- 选择可比公司（行业、规模、增长、盈利能力）
- 关键倍数：EV/EBITDA、EV/Revenue、P/E、P/B
- 调整因素：流动性折价、控制溢价、规模差异

**Method 3: Comparable Transaction Analysis (Precedents)**
- 选择同行业近期并购交易
- 关键倍数：EV/EBITDA、EV/Revenue、P/E
- 调整因素：交易时间、交易条件、协同效应

**Method 4: Leveraged Buyout (LBO)**
- 目标回报：IRR ≥ 20%，MOIC ≥ 2.5x
- 资本结构设计（优先级债务/次级债/夹层/股权）
- 退出估值假设
- 反推可支付价格（Pricing-to-Return）

### 中国资产评估准则

- 《资产评估基本准则》（财政部令第83号）
- 《资产评估执业准则——企业价值》
- 收益法、市场法、资产基础法三种基本方法

## Workflow

```
1. 基础数据收集
   ├─ 历史财务数据（3-5年）
   ├─ 管理层预测/商业计划
   ├─ 行业研究报告
   └─ 可比公司/交易数据

2. 财务分析
   ├─ 收入增长趋势分析
   ├─ 盈利能力分析（毛利率、EBITDA利润率）
   ├─ 资本支出和营运资本分析
   ├─ 资本结构分析
   └─ 可持续EBITDA调整

3. DCF估值
   ├─ 自由现金流预测
   ├─ WACC计算
   ├─ 终值计算
   ├─ 敏感性分析（WACC ± 0.5%，g ± 0.5%）
   └─ 估值区间确定

4. 相对估值
   ├─ 可比公司选择及倍数计算
   ├─ 可比交易选择及倍数计算
   ├─ 异常值剔除及中位数/均值
   └─ 估值区间确定

5. 综合估值
   ├─ 各方法估值权重设定
   ├─ Football Field图绘制
   ├─ 估值区间综合
   └─ 定价建议
```

## Output Format

```markdown
# 估值与定价分析报告

## 一、标的概况
| 项目 | 内容 |
|------|------|
| 公司名称 | |
| 所属行业 | |
| 收入规模 | |
| EBITDA | |
| 净利润 | |
| 交易类型 | |

## 二、财务分析
| 指标 | Year-2 | Year-1 | Year 0 | Year 1E | Year 2E | Year 3E |
|------|--------|--------|--------|---------|---------|---------|
| 收入 | | | | | | |
| 增长率 | | | | | | |
| EBITDA | | | | | | |
| EBITDA利润率 | | | | | | |
| 净利润 | | | | | | |
| CapEx | | | | | | |

## 三、DCF估值
### 关键假设
| 假设 | 数值 | 来源/依据 |
|------|------|-----------|
| 无风险利率 | | |
| Beta | | |
| ERP | | |
| 债务成本 | | |
| WACC | | |
| 永续增长率 | | |

### 估值结果
| 年份 | FCF | 折现因子 | PV(FCF) |
|------|-----|----------|---------|
| Year 1 | | | |
| Year 2 | | | |
| Year 3 | | | |
| Year 4 | | | |
| Year 5 | | | |
| 终值 | | | |
| **企业价值** | | | |

### 敏感性分析
| | WACC 8% | WACC 8.5% | WACC 9% | WACC 9.5% | WACC 10% |
|---|---------|-----------|---------|-----------|----------|
| g=1.5% | | | | | |
| g=2.0% | | | | | |
| g=2.5% | | | | | |
| g=3.0% | | | | | |

## 四、可比公司估值
| 公司 | EV/EBITDA | EV/Revenue | P/E | PEG |
|------|-----------|------------|-----|-----|
| | | | | |
| 中位数 | | | | |
| 均值 | | | | |

## 五、可比交易估值
| 交易 | 日期 | EV/EBITDA | EV/Revenue | P/E | 备注 |
|------|------|-----------|------------|-----|------|
| | | | | | |
| 中位数 | | | | | |

## 六、综合估值（Football Field）
| 方法 | 低值 | 中值 | 高值 | 权重 |
|------|------|------|------|------|
| DCF | | | | 50% |
| 可比公司 | | | | 25% |
| 可比交易 | | | | 25% |
| **综合估值** | | | | |

## 七、定价建议
- 建议交易价格区间：____
- 对应EV/EBITDA倍数：____
- 关键价值驱动因素：____
- 主要价值风险因素：____
```

## Diagnostic Questions

1. 交易的背景和目的（并购/融资/报告）？
2. 标的所处行业及发展阶段？
3. 是否有管理层预测或商业计划？
4. 历史财务数据的年限和质量？
5. 是否存在非经常性项目需要调整？
6. 对可比公司/交易的选择是否有特殊要求？

## Verification

- 核实财务数据的一致性和准确性
- 验证WACC各输入参数的合理性
- 确认可比公司/交易的可比性
- 检查敏感性分析的覆盖范围
- 交叉验证各方法估值的一致性

## Saving

保存路径：`/cases/{client}/valuation/`
文件命名：`valuation-report-{target}-{date}.md`
关联文件：财务模型、可比公司数据、可比交易数据

## Capability Upgrade

### Mode Selection

- **Quick**: 输出估值方法选择、关键假设和估值区间。
- **Standard**: 输出 DCF、可比公司、可比交易、敏感性和定价建议。
- **Deep**: 结合财务模型、商业尽调、协同、资本结构、交易条款和投资回报要求，形成投委会估值包。

### Valuation Judgment Model

估值必须解释方法权重，而不是机械平均。根据公司阶段、盈利稳定性、行业可比性、交易目的和数据质量选择 DCF、交易法、市场法或成本法。

### Quality Gates

- [ ] 财务预测与商业逻辑一致。
- [ ] WACC、终值、增长率和利润率假设可解释。
- [ ] 可比公司和交易剔除理由清楚。
- [ ] 敏感性分析覆盖关键价值驱动因素。
- [ ] 定价建议连接交易结构、协同和谈判空间。

## Consulting Excellence Layer

### Valuation as Decision Support

Valuation is not a spreadsheet exercise. It must support a decision:

- What price range is defensible?
- What assumptions make the deal work or fail?
- How much synergy can be paid away?
- What should be structured as earnout, holdback, or price adjustment?
- Where is the negotiation walk-away point?

### Assumption Governance

Classify assumptions:

| Type | Examples | Treatment |
|------|----------|-----------|
| Management case | Revenue growth, margin expansion | Challenge and normalize |
| Diligence-adjusted case | Churn, concentration, capex, working capital | Use as base case |
| Upside case | Synergy, cross-sell, cost savings | Probability weight |
| Downside case | Loss of customer, margin compression | Stress test |

### Pricing Bridge

Always build a bridge from enterprise value to price:

```text
Enterprise value
- Net debt
- Debt-like items
- Working capital adjustment
- Tax / legal exposures
+ Cash-like items
= Equity value / offer price
```

### Sensitivity Standards

At minimum test:

- Revenue growth.
- EBITDA margin.
- WACC / discount rate.
- Terminal growth or exit multiple.
- Synergy realization.
- Customer loss or volume decline.

### Output Standard

Final valuation advice must include valuation range, recommended offer range, walk-away logic, negotiation levers, and key diligence items that could move price.

### Deliverable Catalog

| Deliverable | When to use | Minimum content | Format |
|-------------|-------------|-----------------|--------|
| Valuation memo | 需要解释估值判断 | 估值结论、方法权重、关键假设、风险和建议价格区间 | Word / Markdown |
| DCF model | 现金流可预测时 | 收入、利润、CapEx、NWC、WACC、终值和敏感性 | Excel |
| Trading comps analysis | 有可比上市公司 | 可比公司、筛选理由、倍数、调整项和估值区间 | Excel / PPT |
| Precedent transactions analysis | 有可比交易 | 交易样本、时间、规模、倍数、控制权溢价和适用性 | Excel / PPT |
| Football field | 多方法综合展示 | DCF、comps、交易法、管理层案例和区间比较 | PPT |
| Pricing bridge | 从 EV 到报价 | 净债务、类债务、营运资本、税务风险、调整项 | Excel / PPT |
| Scenario and sensitivity pack | 关键假设不确定 | 上行、基准、下行、敏感性、break-even 和 walk-away | Excel |
| Negotiation price guidance | 出价或谈判 | 推荐报价、保留价格、让步空间、earnout/holdback 建议 | PPT / Memo |
