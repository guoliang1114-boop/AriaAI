---
name: presentation-builder
description: "Base consulting PowerPoint generation skill. Use when the user asks for a PPT, presentation deck, executive briefing, proposal, project update, workshop material, roadmap deck, review deck, or client-ready slide deliverable. Provides reusable storyline presets and template guidance for strategy, proposal, and project-update decks."
version: "1.0.0"
domain: "tech"
last_updated: "2026-08-26"
status: "stable"
---

# Presentation Builder

This is the base Skill for consulting-style PowerPoint deliverables. It turns rough content, project context, client notes, or strategic analysis into a structured, editable PPT deck.

It is distilled from the stabilized `digital-strategy` PPT generation pattern: template-first rendering, chapter dividers, action-oriented titles, one-sentence page leads, rich body content, and management-grade evidence/action layers.

## When To Use

Use this Skill for:

- Executive briefings
- Strategy decks
- Client proposals
- Project update decks
- Steering committee materials
- Workshop decks
- Roadmap or implementation plans
- Review and retrospective decks

If the request is specifically about digital transformation strategy, use `digital-strategy` for the strategy content and this Skill's PPT standards as the presentation layer.

## Workflow

1. Clarify the decision purpose and audience.
2. Select a deck preset: `strategy`, `proposal`, or `project-update`.
3. Build a slide-by-slide storyline before calling the PPT tool.
4. Use action-oriented slide titles.
5. Fill each slide with enough evidence, assumptions, implications, and next actions for management discussion.
6. For every business page, include four layers: conclusion, evidence/assumption, management action, and risk/trade-off/decision.
7. Call `generate_ppt_from_skill` with `skill_name: "presentation-builder"`.

## Page Format Rules

Use slide types intentionally:

- `title`: chapter divider or major transition page, not a normal content page.
- `content`: one clear argument with 4-6 bullets. Use for executive answer, context, findings, recommendations, risks, and decisions.
- `two_column`: comparison pages such as current vs target, option A vs option B, issue vs action, plan vs actual, scope vs deliverables.
- `roadmap`: phased plan. Use `left_content`, `content`, and `right_content` for three phases.
- `matrix`: prioritization or portfolio logic. Use short labels and a bullet explanation.
- `kpi`: KPI dashboard or value scorecard. Use 3-5 metrics in bullets if structured metric fields are unavailable.
- `risk`: risk and mitigation page.
- `next_steps`: execution actions with owners, timing, and decision needs.

Formatting constraints:

- Do not put more than 6 bullets on one page.
- Keep bullets concise: one idea per bullet, preferably under 22 words.
- Avoid paragraphs inside slide content. Split paragraphs into bullets.
- Add a chapter divider every 4-6 business pages for decks longer than 10 slides.
- Prefer 2-column layouts when a page naturally contains contrast, trade-offs, or ownership split.
- Keep one language per deck. For Chinese requests, use Chinese slide titles, bullets, section names, chart labels, and action labels; avoid English defaults unless the user asks for bilingual material.
- Clean Markdown before calling the PPT tool. Do not send raw `#` headings, `**bold**`, Markdown tables, block quotes, or long prose into slide fields.
- Use varied page families deliberately: `roadmap` for phased plans, `matrix` for prioritization, `kpi` for scorecards, `risk` for risk registers, and `next_steps` for action plans.
- Do not leave placeholder bullets like "TBD" or "more analysis needed"; write the exact assumption or evidence gap.

## Deck Presets

### strategy

Use for strategy recommendations, transformation plans, market entry, growth, operating model, and roadmap decks.

Recommended structure:

1. Executive Answer
2. Strategic Context
3. Current State vs Target State
4. Strategic Options
5. Recommended Path
6. Initiative Portfolio
7. Roadmap and Investment Logic
8. Governance, KPI and Next Steps

Suggested format:

- Use `title` for "Strategic Direction" and "Roadmap and Governance" dividers.
- Use `two_column` for current vs target and option trade-offs.
- Use `roadmap` for implementation path.
- Use `kpi` for success metrics.
- Use `next_steps` for management actions.

### proposal

Use for client proposals and commercial materials.

Recommended structure:

1. Client Situation and Need
2. Our Understanding of the Challenge
3. Proposed Approach
4. Scope and Deliverables
5. Team, Timeline and Ways of Working
6. Commercials, Risks and Next Steps

Suggested format:

- Use `title` for "Client Need", "Proposed Solution", and "Mobilization".
- Use `two_column` for scope vs deliverables and client role vs consulting team role.
- Use `roadmap` for timeline.
- Use `risk` for delivery risks and mitigations.

### project-update

Use for project status, steering committee updates, and delivery governance.

Recommended structure:

1. Executive Status
2. Progress vs Plan
3. Workstream Highlights
4. Risks, Issues and Decisions
5. Value and Adoption Signals
6. Next Steps

Suggested format:

- Use `two_column` for progress vs plan.
- Use `risk` for risks, issues, and decisions.
- Use `kpi` for value and adoption signals.
- Use `next_steps` for the next action cycle.

## Quality Standard

- Default to 10-16 slides unless the user asks otherwise.
- Every slide needs an action-oriented title and 3-6 substantive bullets.
- Each content slide should contain at least one of: evidence, implication, decision, risk, owner, KPI, or next action.
- Every management-facing slide should be able to stand alone: a partner should understand the recommendation, basis, owner, and decision need without reading speaker notes.
- Prefer concrete numbers and ranges when exact data is missing: timeline, impact range, investment envelope, adoption target, KPI baseline, risk threshold, or stage-gate criteria.
- Avoid generic filler such as "validate with stakeholders" unless paired with the specific question, evidence source, or decision.
- Prefer `two_column` for current vs target, issue vs action, option comparison, or plan vs actual.
- Keep slides client-ready and editable; do not output screenshots or image-only decks.

## PPT Tool Call

Always use the base Skill name and pass the preset:

```json
{
  "skill_name": "presentation-builder",
  "deck_type": "strategy",
  "title": "[Deck Title]",
  "subtitle": "[Optional subtitle]",
  "slides": [
    {
      "type": "content",
      "title": "Executive Answer",
      "content": "- Recommendation and why it matters now\n- Evidence or assumption behind the recommendation\n- Management implication for scope, funding, or ownership\n- Decision required in this meeting"
    },
    {
      "type": "two_column",
      "title": "Current State vs Target State",
      "left_content": "Current state\n- ...",
      "right_content": "Target state\n- ..."
    },
    {
      "type": "roadmap",
      "title": "Three-Phase Implementation Roadmap",
      "left_content": "Phase 1\n- Foundation actions\n- First proof points",
      "content": "Phase 2\n- Scale validated moves\n- Build governance rhythm",
      "right_content": "Phase 3\n- Institutionalize capabilities\n- Optimize value realization"
    }
  ]
}
```

## Template Guidance

The base template can reuse the `digital-strategy` PPT template until a dedicated presentation-builder template library is added. Future template variants should include:

- `strategy`
- `executive-briefing`
- `proposal`
- `project-update`
- `workshop`
- `roadmap`
- `review`
- `research-report`
- `one-page-summary`
- `training`

## Capability Upgrade

### Mode Selection

- **Quick**: 生成 8-12 页结构清晰的初稿或 slide outline。
- **Standard**: 生成 15-25 页咨询级 PPT，包含 storyline、页面结构和视觉建议。
- **Deep**: 结合客户记忆、项目文档、知识库案例、数据表和品牌要求，生成可评审的完整 deck plan。

### Storyline Gate

生成 PPT 前必须先确认：受众是谁、他们要做什么决策、核心结论是什么、证据链如何展开、下一步行动是什么。没有 storyline 的内容不能直接进入页面生成。

### Quality Gates

- [ ] 每页标题是结论，不只是主题。
- [ ] 每页只有一个主信息，并有证据或结构支持。
- [ ] 页面类型与内容匹配：对比、矩阵、路线图、KPI、风险、行动计划等。
- [ ] 文字密度适合投屏和阅读。
- [ ] 输出前检查章节节奏、重复页面和空洞表述。

## Consulting Excellence Layer

### Deck Narrative Archetypes

Choose one narrative before building pages:

| Archetype | Use When | Typical Flow |
|-----------|----------|--------------|
| Recommendation | User needs a decision | Answer → evidence → options → recommendation → action |
| Diagnosis | User needs problem clarity | Symptoms → root causes → implications → priorities |
| Transformation | User needs roadmap | Ambition → current gap → target model → roadmap → governance |
| Investment | User needs funding / deal decision | Thesis → market/value → risks → financials → decision |
| Project Update | User needs steering | Progress → issues → decisions → next milestones |

### Slide Evidence Standard

Every analytical slide should contain:

- Message title.
- One primary visual structure.
- Evidence or assumption.
- Management implication.
- Decision or next action.

If a slide has only descriptive bullets, upgrade it into a table, matrix, roadmap, KPI view, operating model, risk register or decision page.

### Page Type Library

Use these page types deliberately:

- Issue tree.
- Current vs target.
- Pain point heatmap.
- Value pool.
- Option comparison.
- Prioritization matrix.
- Operating model.
- Roadmap.
- Investment case.
- Risk and mitigation.
- Governance cadence.
- 30/60/90 day plan.

### Executive Deck Quality Bar

A strong consulting deck can be read in two modes:

- **Skim mode**: titles alone tell the story.
- **Review mode**: body content contains enough evidence for discussion.

If titles do not form a logical storyline, revise titles before generating PPTX.

### Deliverable Catalog

| Deliverable | When to use | Minimum content | Format |
|-------------|-------------|-----------------|--------|
| Storyline one-pager | 生成 PPT 前 | 受众、决策、核心结论、章节逻辑、关键证据 | Markdown |
| Slide-by-slide outline | 用户要 PPT 大纲 | 页标题、key message、内容要点、视觉建议、speaker note | Markdown |
| Executive deck | 高管汇报 | 结论、证据、选择、路线图、风险、决策请求 | PPT |
| Proposal deck | 售前提案 | 背景、诊断、方案、工作计划、价值、团队、下一步 | PPT |
| Board / IC pack | 董事会或投委会 | 投资/战略命题、关键假设、风险、财务、决策事项 | PPT |
| Workshop deck | 工作坊 | 目标、议程、输入材料、讨论页、练习、输出模板 | PPT |
| Project update deck | 项目周/月报 | 进展、成果、风险、决策请求、下阶段计划 | PPT |
| One-page summary | 快速同步 | 一页结论、关键数据、行动项和风险 | PPT / PDF |
| Speaker notes pack | 用户需要讲稿 | 每页讲述逻辑、转场、强调点和可能问题 | Markdown / PPT notes |
