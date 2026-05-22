---
name: goal-definition
description: "Structure and validate project or business goals using SMART criteria and consulting frameworks. Use when the user needs to (1) define project goals, (2) set OKRs, (3) clarify objectives, (4) validate if a goal is well-defined, (5) break down a vague goal into measurable targets. Produces structured goal documents with success criteria, metrics, and milestones."
---

# Goal Definition

Structure and validate goals using proven consulting frameworks. Turns vague intentions into clear, measurable, actionable objectives.

## When To Use

- 用户需要定义项目目标
- 用户需要设定 OKR/KPI
- 用户需要把模糊的目标变成可衡量的指标
- 用户需要验证目标是否合理
- 用户需要拆解大目标为子目标

## Tools

| Tool | Purpose |
|------|---------|
| `update_project_markdown_document` | Save goal document to project |
| `write_project_office_document` | Generate goal document as Word/PDF |

## Frameworks

### SMART Criteria
Every goal must be:
- **S**pecific — 清晰明确，不含歧义
- **M**easurable — 可量化，有明确指标
- **A**chievable — 可实现，有资源支撑
- **R**elevant — 与战略/业务相关
- **T**ime-bound — 有明确截止日期

### OKR Structure
- **Objective**: Qualitative, inspiring, time-bound
- **Key Results**: 3-5 measurable outcomes (quantitative)
- **Initiatives**: Specific actions to achieve key results

### Consulting Goal Pyramid
```
Vision (3-5 year)
  └── Strategic Goals (annual)
        └── Project Goals (quarterly)
              └── Sprint Goals (weekly)
                    └── Task Goals (daily)
```

## Workflow

```
1. Receive  → Get raw goal statement from user
2. Diagnose → Check if goal meets SMART criteria
3. Refine   → Ask clarifying questions for gaps
4. Structure → Organize into goal framework
5. Validate → Verify achievability and alignment
6. Output   → Produce structured goal document
```

## Output Format

```markdown
# 目标定义文档

## 🎯 核心目标

**目标陈述**：[一句话清晰描述]

**目标类型**：[战略目标 / 项目目标 / 个人目标]
**时间范围**：[起止日期]
**负责人**：[姓名/角色]

---

## 📊 SMART 检验

| 维度 | 检验项 | 状态 | 说明 |
|------|--------|------|------|
| Specific | 目标是否清晰明确？ | ✅/⚠️/❌ | ... |
| Measurable | 是否有可量化指标？ | ✅/⚠️/❌ | ... |
| Achievable | 是否有资源支撑？ | ✅/⚠️/❌ | ... |
| Relevant | 是否与战略相关？ | ✅/⚠️/❌ | ... |
| Time-bound | 是否有明确截止日期？ | ✅/⚠️/❌ | ... |

**SMART 评分**：X/5
**建议**：[改进建议]

---

## 📈 衡量指标

| 指标 | 当前值 | 目标值 | 数据来源 | 检查频率 |
|------|--------|--------|---------|---------|
| ... | ... | ... | ... | 周/月/季 |

---

## 🏗️ 目标拆解

### 子目标 1：[名称]
- **衡量指标**：[指标]
- **目标值**：[值]
- **截止日期**：[日期]
- **关键动作**：
  - [ ] 动作 1
  - [ ] 动作 2

### 子目标 2：[名称]
...

---

## ⚠️ 风险与依赖

| 风险/依赖 | 影响 | 缓解措施 |
|----------|------|---------|
| ... | ... | ... |

---

## 🚀 第一步行动

**本周必须完成**：
1. [ ] 行动 1（负责人，截止日期）
2. [ ] 行动 2（负责人，截止日期）
```

## Diagnostic Questions

When the user provides a vague goal, ask these questions:

1. **具体化**: "这个目标的具体含义是什么？能举个例子吗？"
2. **量化**: "怎么衡量目标是否达成？用什么指标？"
3. **可行性**: "现有的资源（人力/预算/时间）能支撑这个目标吗？"
4. **相关性**: "这个目标与团队/公司的战略方向一致吗？"
5. **时间**: "这个目标什么时候需要完成？有阶段性里程碑吗？"

## OKR Generation

When user asks for OKRs:

```markdown
## Objective: [鼓舞人心的目标描述]

**时间**：Q[X] 20XX
**负责人**：[姓名]

### Key Results

| # | 关键结果 | 当前值 | 目标值 | 信心指数 |
|---|---------|--------|--------|---------|
| 1 | ... | ... | ... | X/10 |
| 2 | ... | ... | ... | X/10 |
| 3 | ... | ... | ... | X/10 |

### Initiatives

| # | 关键动作 | 负责人 | 预计完成 |
|---|---------|--------|---------|
| 1 | ... | ... | ... |
| 2 | ... | ... | ... |
```

## Saving

After generating goal document, offer to save:
- As Markdown: `update_project_markdown_document`
- As Word: `write_project_office_document` (file_type=docx)
