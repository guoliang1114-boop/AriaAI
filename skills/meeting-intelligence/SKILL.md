---
name: meeting-intelligence
description: "Extract structured meeting intelligence from transcripts or notes. Use when the user provides (1) meeting transcript, (2) interview notes, (3) call recording text, (4) workshop notes, or asks to (5) summarize a meeting, (6) extract action items, (7) identify decisions and risks from a meeting. Produces structured minutes with decisions, action items, risks, and follow-ups."
---

# Meeting Intelligence

Extract structured meeting intelligence from raw transcripts, interview notes, or workshop outputs. Turns unstructured conversation into actionable meeting minutes.

## When To Use

- 用户粘贴了会议录音转写文本
- 用户提供了访谈笔记
- 用户要求整理会议纪要
- 用户要求提取会议中的决策/待办/风险
- 用户要求总结工作坊产出

## Tools

| Tool | Purpose |
|------|---------|
| `update_project_markdown_document` | Save meeting minutes as project document |
| `write_project_office_document` | Generate meeting minutes as Word/PDF |

## Workflow

```
1. Receive  → Get transcript/notes from user
2. Parse    → Identify speakers, topics, timestamps
3. Extract  → Pull out decisions, actions, risks, questions
4. Structure → Organize into standard meeting minutes format
5. Save     → Persist to project space
```

## Output Format

Always produce meeting minutes in this structure:

```markdown
# 会议纪要：[会议主题]

**日期**：YYYY-MM-DD
**参会人**：[名单]
**时长**：[时长]

---

## 📋 议题摘要

| # | 议题 | 讨论要点 | 结论 |
|---|------|---------|------|
| 1 | ... | ... | ... |

---

## ✅ 关键决策

| # | 决策内容 | 决策人 | 影响范围 |
|---|---------|--------|---------|
| 1 | ... | ... | ... |

---

## 📌 行动项（Action Items）

| # | 待办事项 | 负责人 | 截止日期 | 优先级 |
|---|---------|--------|---------|--------|
| 1 | ... | ... | ... | 高/中/低 |

---

## ⚠️ 风险与问题

| # | 风险/问题 | 影响 | 建议处理方式 |
|---|----------|------|-------------|
| 1 | ... | ... | ... |

---

## ❓ 待解决问题

- [ ] 问题 1（需要谁回复）
- [ ] 问题 2（需要谁回复）

---

## 💡 关键洞察

- 洞察 1
- 洞察 2

---

## 📅 下次会议

- **时间**：[建议时间]
- **议题**：[待讨论事项]
- **准备**：[需要提前准备的材料]
```

## Extraction Rules

### 决策识别
- Look for phrases: "决定了", "同意", "确认", "approved", "agreed", "decided"
- Include who made the decision
- Note any conditions or caveats

### 行动项识别
- Look for phrases: "需要", "负责", "跟进", "action", "todo", "follow up", "will do"
- Extract: what needs to be done, by whom, by when
- Assign priority based on urgency indicators

### 风险识别
- Look for phrases: "风险", "担心", "问题", "blocker", "concern", "risk", "issue"
- Note the impact and suggested mitigation

### 待解决问题
- Look for phrases: "待定", "需要确认", "TBD", "pending", "need to check"
- Note who needs to provide the answer

## Special Handling

### 多人对话
- Identify speakers by name or role
- Attribute decisions and actions to specific people
- Note disagreements or alternative viewpoints

### 访谈场景
- Focus on interviewee's responses
- Extract key quotes (verbatim if important)
- Note non-verbal cues if mentioned (hesitation, emphasis)

### 工作坊场景
- Focus on group decisions and consensus
- Note voting results if any
- Capture brainstorming outputs

## Saving

After generating minutes, ask user if they want to save:
- As Markdown: `update_project_markdown_document`
- As Word: `write_project_office_document` (file_type=docx)
- Both formats

Always offer to save to project space.

## Capability Upgrade

### Mode Selection

- **Quick**: 只输出会议摘要、关键决策和行动项，适合短会或用户临时追问。
- **Standard**: 输出完整会议纪要、风险、待办、责任人、截止时间和下次会议建议。
- **Deep**: 针对客户访谈、项目例会、售前会议或管理层会议，进一步提取客户画像、项目机会、异议、承诺和可沉淀到项目记忆的事实。

### Context Enrichment

处理会议材料时，优先结合：

- 当前项目名称、阶段、客户、关键干系人。
- 历史会议纪要与未完成行动项。
- 项目记忆中已有的目标、风险、范围和决策。
- 客户记忆中的偏好、关注点、组织关系和历史合作。

如果会议内容与已有记忆冲突，应标记为“需确认”，不要直接覆盖旧记忆。

### Intelligence Extraction Model

| 信息类型 | 判断规则 | 输出位置 |
|----------|----------|----------|
| 决策 | 有明确同意、确认、批准、否决或选择 | 关键决策 |
| 行动项 | 有责任人、动作、截止日期或交付物 | 行动项 |
| 风险 | 出现阻塞、担心、依赖、资源不足、范围变化 | 风险与问题 |
| 客户偏好 | 反复强调的风格、关注指标、沟通方式 | 客户记忆候选 |
| 项目事实 | 范围、时间、预算、系统、组织、约束变化 | 项目记忆候选 |

### Memory Handoff

在 Deep 模式下，额外输出“可沉淀记忆”区块：

```markdown
## 可沉淀记忆
| 类型 | 内容 | 置信度 | 是否需人工确认 |
|------|------|--------|----------------|
| 项目事实 |  | 高/中/低 | 是/否 |
| 客户偏好 |  | 高/中/低 | 是/否 |
| 风险信号 |  | 高/中/低 | 是/否 |
```

### Quality Gates

- [ ] 每个行动项都有责任人；缺失时标记“待确认”。
- [ ] 每个日期使用明确格式，避免“下周”“月底”等模糊表达。
- [ ] 决策与讨论意见分开，不把倾向性发言误写成正式决策。
- [ ] 重要客户原话保留短引用，但不大段复制全文。
- [ ] 已识别哪些内容应进入项目记忆或客户记忆。

## Consulting Excellence Layer

### Consulting Signal Extraction

Beyond minutes, extract consulting signals:

| Signal | What To Look For | Why It Matters |
|--------|------------------|----------------|
| Decision pressure | Deadline, sponsor demand, board meeting | Proposal urgency |
| Buying criteria | Budget, value, proof, risk concerns | Sales strategy |
| Stakeholder map | Sponsor, blocker, user, approver | Influence plan |
| Pain intensity | Repeated complaints, quantified loss | Problem framing |
| Scope boundary | What they refuse or defer | SOW and expectation control |
| Success metric | How client will judge outcome | Project goal |

### Meeting-to-Consulting Handoff

After important meetings, produce:

1. Executive summary.
2. Confirmed decisions.
3. Open questions.
4. Client pain and root cause hypotheses.
5. Stakeholder positions.
6. Opportunity or risk signals.
7. Recommended follow-up.
8. Memory candidates.

### Follow-up Recommendation Logic

Each follow-up should say:

- Who should do it.
- What message or artifact is needed.
- Why it matters.
- When it should happen.
- What risk exists if delayed.

### Output Standard

For client-facing meetings, the output should support both project execution and account development. Do not reduce it to a neutral transcript summary.

### Deliverable Catalog

| Deliverable | When to use | Minimum content | Format |
|-------------|-------------|-----------------|--------|
| Structured meeting minutes | 常规会议整理 | 摘要、议题、决策、行动项、风险、待确认问题 | Markdown / Word |
| Decision log | 有关键决策 | 决策、背景、决策人、日期、影响、后续动作 | Markdown / Table |
| Action tracker | 需要跟进执行 | 行动项、owner、截止日期、状态、依赖、风险 | Tasks / Excel |
| Stakeholder signal brief | 客户会议或售前 | 角色、立场、关注点、阻力、影响力、跟进建议 | Markdown |
| Issue and risk register | 项目例会 | 问题、风险、影响、责任人、缓释、升级路径 | Excel / Markdown |
| Consulting opportunity brief | 发现潜在机会 | 客户痛点、触发事件、价值假设、建议动作 | Markdown |
| Memory handoff pack | 需要沉淀记忆 | 项目事实、客户偏好、风险信号、置信度、是否需确认 | Markdown / Memory |
| Follow-up note draft | 会后发客户或团队 | 感谢、确认事项、行动项、材料请求、下次节点 | Email / Markdown |
