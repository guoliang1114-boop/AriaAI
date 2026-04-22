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

This skill produces **structured strategic content** (text outline + detailed section content).

- **For PPT delivery**: Pass content to `pptx` skill for slide rendering
- **For document delivery**: Pass content to `docx` skill for document formatting
- **For roadmap visualization**: Generate timeline data in table format, render with `xlsx` skill for Gantt or phased timeline
- **For architecture diagrams**: Use `generate_image` for capability blueprint or target operating model visualization

Do not produce PPT, Excel, or image files directly. Produce content that collaborating skills can render.

## References

- **Framework details**: See `references/frameworks.md` for expanded methodology descriptions, assessment questionnaires, and benchmark data
- **Industry notes**: See `references/industry-notes.md` for industry-specific digital transformation patterns, KPI benchmarks, and common pitfalls
