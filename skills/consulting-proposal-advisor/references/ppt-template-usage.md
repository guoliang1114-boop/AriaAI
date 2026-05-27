# PPT Template Usage

Use an original neutral consulting template by default. The goal is to create a clean, editable, consultant-style deck that the user can later modify manually, without carrying artifacts from any reference deck.

## Default Visual Direction

- Use a white or very light background.
- Use one restrained accent color, preferably deep red, burgundy, charcoal, or muted gold depending on client context.
- Use dark gray body text, not pure black everywhere.
- Keep generous margins and strict alignment.
- Use thin dividers, small page numbers, and understated footers.
- Prefer editable PowerPoint shapes, tables, and charts over pasted screenshots.
- Avoid decorative gradients, large rounded cards, stock-photo hero pages, and generic SaaS dashboard styling.
- Use a 16:9 wide layout.
- Keep font sizes practical for business review: large titles, readable labels, compact but legible tables.
- Leave enough whitespace that the page feels deliberate, but keep the content density appropriate for a consulting discussion deck.

## PPTX Technical Path

When an actual editable PPTX is required inside AriaAI chat:

1. Build a slide-by-slide deck plan first.
2. Call `generate_ppt_from_skill` with `skill_name: "presentation-builder"`, `deck_type: "proposal"`, the deck title, subtitle when useful, and the complete slides array.
3. Use content-rich slides with conclusion-led titles, 3-6 specific bullets, and explicit visuals or proof objects.
4. Do not ask the user to run local scripts.

For local Codex/offline workflows:

1. Use the workspace bundled Node runtime when available.
2. Prefer `pptxgenjs` for editable PowerPoint generation.
3. Use `scripts/create_neutral_pptx.cjs` when a JSON deck plan is sufficient.
4. Export or render the generated PPTX to PDF with LibreOffice or another available renderer to verify it opens.
5. Run `scripts/check_ppt_residue.py` when any reference deck, old client file, or template was involved.

Expected command pattern:

```bash
node scripts/create_neutral_pptx.cjs deck-plan.json output.pptx
python scripts/check_ppt_residue.py output.pptx "old client" "old industry"
scripts/verify_pptx.sh output.pptx "old client" "old industry"
```

The JSON deck plan should contain:

```json
{
  "title": "Client proposal title",
  "subtitle": "One-line subtitle",
  "footer": "Client proposal | Draft",
  "slides": [
    {
      "type": "cover",
      "title": "Client",
      "subtitle": "Proposal title"
    },
    {
      "type": "section",
      "kicker": "01",
      "title": "观势：现状、挑战与机会",
      "subtitle": "Chapter framing"
    },
    {
      "type": "bullets",
      "title": "Conclusion-led title",
      "subtitle": "Short so-what",
      "bullets": ["Point 1", "Point 2", "Point 3"]
    },
    {
      "type": "table",
      "title": "Conclusion-led title",
      "columns": ["A", "B", "C"],
      "rows": [["a", "b", "c"]]
    },
    {
      "type": "chart",
      "chartType": "bar",
      "title": "Conclusion-led title",
      "labels": ["A", "B", "C"],
      "values": [10, 20, 30],
      "takeaway": "Short implication beside the chart"
    },
    {
      "type": "chart",
      "chartType": "bar",
      "title": "Conclusion-led comparison title",
      "labels": ["A", "B", "C"],
      "series": [
        {"name": "Current", "values": [10, 20, 30]},
        {"name": "Target", "values": [25, 35, 45]}
      ],
      "takeaway": "Use multi-series charts for baseline vs target or option comparisons"
    },
    {
      "type": "matrix",
      "title": "Conclusion-led title",
      "xAxis": "Feasibility",
      "yAxis": "Impact",
      "points": [{"label": "Option A", "x": 0.8, "y": 0.75}],
      "takeaway": "Prioritize options in the upper-right zone"
    },
    {
      "type": "journey",
      "title": "Conclusion-led title",
      "stages": [
        {"name": "New member", "behavior": "...", "gap": "...", "action": "...", "metric": "..."}
      ]
    },
    {
      "type": "roadmap",
      "title": "Conclusion-led title",
      "phases": [
        {"period": "Weeks 1-2", "title": "Diagnose", "actions": ["Interview", "Analyze"], "milestone": "Decision gate"}
      ]
    }
  ]
}
```

## Standard Consulting Deck Rhythm

For Chinese proposal decks, use this default flow:

```text
封面
项目理解与方法
目录 / 章节导航
观势：现状、挑战与机会
破局：核心判断与方案建议
笃行：实施路径、治理机制与下一步行动
附录：支撑分析、测算假设、访谈或资料来源
```

Adapt chapter names to the engagement:

- `观势`: market, business context, current-state diagnosis, customer or stakeholder needs, opportunity sizing
- `破局`: core problem, strategic choice, solution architecture, operating model, workstreams
- `笃行`: implementation roadmap, pilot plan, governance, milestones, decision gates, immediate next steps

## Recommended Slide Archetypes

Build from these archetypes rather than copying reference slides:

- Cover: client name, proposal title, subtitle, date
- Method: work approach, input sources, workstreams
- TOC: chapter navigation
- Section divider: chapter label, chapter title, page marker
- Executive summary: recommendation plus 3-4 support points
- Current-state diagnosis: symptoms, root causes, business impact
- Opportunity matrix: value vs feasibility, urgency vs readiness, or impact vs satisfaction
- Customer journey: lifecycle stages, behavior, gaps, actions, success metrics
- Comparison table: options, cases, vendors, capabilities, or operating models
- Solution architecture: workstreams, capabilities, roles, dependencies
- Capability roadmap: current asset -> target capability -> value
- Implementation roadmap: phases, milestones, decision gates
- Governance model: steering committee, project team, cadence, escalation
- Value case: benefit categories, assumptions, rough economics
- Risks and mitigations: risk, impact, mitigation, owner
- Next steps: decisions, preparation, kickoff actions

## Minimum PPTX Pack

When the user asks for a quick PPT deliverable and provides limited facts, create a concise 10-14 page draft:

1. Cover
2. Project understanding and key question
3. Executive summary
4. Current-state diagnosis
5. Root causes and business impact
6. Recommended solution
7. Workstreams and deliverables
8. Implementation roadmap
9. Governance and collaboration model
10. Expected value and success metrics
11. Key risks and mitigations
12. Next steps

Add appendix pages only when supporting data, assumptions, or detailed tables are available.

## Standard PPTX Pack

When the user asks for a normal proposal deck and does not explicitly ask for a quick draft, create a richer 16-24 page draft:

1. Cover
2. Research method and inputs
3. Contents / chapter navigation
4. Executive summary
5. Chapter divider: 观势
6. Market/category context
7. Client current-state diagnosis
8. Competitive or benchmark comparison
9. Opportunity prioritization matrix
10. Chapter divider: 破局
11. Core judgment and strategic choice
12. Recommended solution architecture
13. Workstreams and deliverables
14. Operating model / governance
15. Value case and success metrics
16. Chapter divider: 笃行
17. Pilot design
18. Implementation roadmap
19. Risks and mitigations
20. Next steps and decisions needed
21+. Appendix: assumptions, source notes, detailed tables, interview guide, KPI definitions

If facts are limited, keep the standard structure but label assumptions and validation needs clearly.

## Layout Guidance

- Use conclusion-led slide titles, 16-26 words in Chinese when needed, not topic labels.
- Place the title at the top left; keep it visually dominant but not oversized.
- Put the "so what" near the top of analysis pages.
- Use one primary proof object per slide: chart, table, matrix, map, or roadmap.
- Use 3-5 supporting bullets; avoid paragraph walls.
- For Standard and Deep depth decks, do not use bullet-only slides except for cover, section, and next-step pages.
- Tables should have clear column logic and a final `对客户的启示` or `建议` column when useful.
- Roadmaps should show phases, milestones, owners, and decision gates.
- Use callouts sparingly for key implications, not for decoration.

## Page-Specific Guidance

- Executive summary: 3-4 message blocks, each with one conclusion and one evidence line.
- Diagnosis page: organize as `现象 -> 根因 -> 业务影响 -> 对客户的启示`.
- Matrix page: make axes business meaningful; do not create a decorative 2x2 without decision value.
- Solution page: show workstreams, outcomes, key activities, and deliverables.
- Roadmap page: show phases, timing, milestones, client inputs, and decision gates.
- Governance page: show sponsor, steering committee, project team, working groups, cadence, and escalation path.
- Value page: separate hard value, operational value, management value, and strategic value.
- Risk page: show risk, impact, mitigation, and owner.

## Copy Rules

- Replace generic claims with concrete business outcomes.
- Label assumptions and data gaps clearly.
- Avoid empty consulting phrases such as `赋能升级`, `打造闭环`, `全面提升` unless the next phrase explains the real action.
- Prefer section labels such as `核心判断`, `方案建议`, `实施路径`, `价值测算`, `风险保障`, `下一步行动`.

## Reference Deck Policy

- Use reference decks only for inspiration or user review, not as the default construction source.
- Do not perform broad find-and-replace over a reference deck.
- If the user explicitly asks to use a reference template, first create or request a sanitized skeleton: selected page archetypes, no old client content, no hidden old-topic text, no old chart data.
- Run `scripts/check_ppt_residue.py` for old client names, old industries, old product terms, placeholders, and source-specific footers before delivery.

## Handoff Standard

Before final delivery:

- Confirm the deck opens or exports to PDF.
- Confirm no reference-deck residue remains.
- Confirm all placeholders are filled.
- Confirm slide count and section flow.
- Mention any remaining assumptions or pages that need user-provided facts.
