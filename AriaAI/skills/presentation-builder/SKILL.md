---
name: presentation-builder
description: "Base consulting PowerPoint generation skill. Use when the user asks for a PPT, presentation deck, executive briefing, proposal, project update, workshop material, roadmap deck, review deck, or client-ready slide deliverable. Provides reusable storyline presets and template guidance for strategy, proposal, and project-update decks."
---

# Presentation Builder

This is the base Skill for consulting-style PowerPoint deliverables. It turns rough content, project context, client notes, or strategic analysis into a structured, editable PPT deck.

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
6. Call `generate_ppt_from_skill` with `skill_name: "presentation-builder"`.

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
