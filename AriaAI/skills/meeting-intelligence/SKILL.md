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
