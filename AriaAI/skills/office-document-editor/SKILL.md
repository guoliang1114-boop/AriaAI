---
name: office-document-editor
description: "Edit existing Office documents in the project space. Use when the user asks to (1) modify a PPT slide's title/content/data, (2) update a Word document's section/paragraph/table, (3) change Excel cell values/formulas/rows/columns, (4) add/remove/reorder slides or pages, (5) fix formatting, update data, or make corrections to an existing file. Covers PPT, Word, Excel editing. Does NOT create new files from scratch — use presentation-builder or write_project_office_document for that."
---

# Office Document Editor

Edit existing Office documents (PPTX, DOCX, XLSX) in the project space using direct file manipulation.

## When To Use

Use this Skill when the user wants to:

- 修改现有 PPT 的页面内容、标题、数据
- 更新 Word 文档的段落、章节、表格
- 修改 Excel 的单元格、公式、行列
- 给现有文档添加/删除内容
- 修复格式问题

Do NOT use this Skill for creating brand new files. For new file creation, use `write_project_office_document` directly.

## Tools

| Tool | Purpose |
|------|---------|
| `read_project_file` | Read existing file content to understand structure |
| `edit_project_office_document` | Apply edits to existing PPTX/DOCX/XLSX files |
| `write_project_office_document` | Only used when creating a new file from scratch |

## Workflow

```
1. Read    → read_project_file to understand file structure
2. Plan    → Identify what needs to change
3. Edit    → edit_project_office_document with specific edits
4. Confirm → Report changes to user
```

## Step 1: Read the Existing File

Always read the file first to understand its structure:

```
read_project_file(project_id=X, action='read', file_id=Y)
```

- **PPTX**: Returns slide-by-slide text with titles, body, layout info
- **DOCX**: Returns section headings, paragraph text, table content
- **XLSX**: Returns sheet names, cell values, structure

## Step 2: Plan Modifications

After reading, outline the changes clearly:

```
修改计划：
- 第 3 页：标题从 "XXX" 改为 "YYY"
- 第 5 页：更新 body text
- Excel Sheet1：更新 B2:B10 的数据
```

## Step 3: Apply Edits

Use `edit_project_office_document` to apply changes directly to the file.

### PPTX Edit Actions

#### `update_slide` — Update slide title and/or content
```json
{
  "file_id": 123,
  "edits": [
    {
      "action": "update_slide",
      "slide_index": 2,
      "title": "New Slide Title",
      "content": "- Point 1\n- Point 2\n- Point 3"
    }
  ]
}
```

#### `update_text` — Replace specific text on a slide
```json
{
  "file_id": 123,
  "edits": [
    {
      "action": "update_text",
      "slide_index": 2,
      "old_text": "2023年数据",
      "new_text": "2024年数据"
    }
  ]
}
```

#### `add_slide` — Add a new slide
```json
{
  "file_id": 123,
  "edits": [
    {
      "action": "add_slide",
      "layout_index": 1,
      "title": "New Section Title",
      "content": "- Content line 1\n- Content line 2"
    }
  ]
}
```

#### `delete_slide` — Delete a slide by index
```json
{
  "file_id": 123,
  "edits": [
    {"action": "delete_slide", "slide_index": 4}
  ]
}
```

### DOCX Edit Actions

#### `update_text` — Replace text throughout the document
```json
{
  "file_id": 456,
  "edits": [
    {
      "action": "update_text",
      "old_text": "旧公司名称",
      "new_text": "新公司名称"
    }
  ]
}
```

#### `replace_paragraph` — Replace all content under a heading
```json
{
  "file_id": 456,
  "edits": [
    {
      "action": "replace_paragraph",
      "heading": "第二章 市场分析",
      "content": "Updated market analysis content...\nSecond paragraph..."
    }
  ]
}
```

#### `add_paragraph` — Add content after a heading
```json
{
  "file_id": 456,
  "edits": [
    {
      "action": "add_paragraph",
      "after_heading": "结论",
      "content": "新增的风险分析段落..."
    }
  ]
}
```

### XLSX Edit Actions

#### `update_cell` — Update a single cell
```json
{
  "file_id": 789,
  "edits": [
    {
      "action": "update_cell",
      "sheet": "Sheet1",
      "cell": "B2",
      "value": 15000
    }
  ]
}
```

#### `update_cells` — Update multiple cells at once
```json
{
  "file_id": 789,
  "edits": [
    {
      "action": "update_cells",
      "sheet": "Sheet1",
      "updates": {
        "B2": 15000,
        "B3": 23000,
        "C2": "=B2*1.1"
      }
    }
  ]
}
```

#### `update_row` — Replace an entire row
```json
{
  "file_id": 789,
  "edits": [
    {
      "action": "update_row",
      "sheet": "Sheet1",
      "row": 5,
      "values": ["Q2", 15000, 23000, 38000]
    }
  ]
}
```

#### `add_row` — Insert or append a row
```json
{
  "file_id": 789,
  "edits": [
    {
      "action": "add_row",
      "sheet": "Sheet1",
      "after_row": 10,
      "values": ["Total", "=SUM(B2:B10)"]
    }
  ]
}
```

#### `delete_row` — Delete a row
```json
{
  "file_id": 789,
  "edits": [
    {"action": "delete_row", "sheet": "Sheet1", "row": 11}
  ]
}
```

#### `add_sheet` — Add a new worksheet
```json
{
  "file_id": 789,
  "edits": [
    {"action": "add_sheet", "name": "Summary"}
  ]
}
```

## Saving Behavior

- **Default**: Overwrites the original file
- **New copy**: Provide `output_name` to save as a new file instead of overwriting

```json
{
  "file_id": 123,
  "output_name": "报告_修改版.pptx",
  "edits": [...]
}
```

## Important Rules

1. **Always read before editing** — Never guess the content of an existing file
2. **Use slide_index correctly** — PPTX slide indices are 0-based (first slide = 0)
3. **Preserve structure** — Don't break the document's logical structure
4. **Confirm destructive changes** — If overwriting the original, confirm with user
5. **Name clearly** — Use `output_name` for edited copies (e.g., "报告_修改版.pptx")

## Modification Patterns

### Pattern 1: Single Slide Edit
User: "把 PPT 第 3 页的标题改一下"
→ read_project_file → edit_project_office_document(action=update_slide, slide_index=2)

### Pattern 2: Data Update
User: "把 Excel 里的 2024 年数据更新一下"
→ read_project_file → edit_project_office_document(action=update_cells, updates={...})

### Pattern 3: Add Content
User: "在 Word 的结论后面加一段风险分析"
→ read_project_file → edit_project_office_document(action=add_paragraph, after_heading="结论")

### Pattern 4: Replace Text
User: "把 PPT 里所有的 '旧公司' 改成 '新公司'"
→ read_project_file → edit_project_office_document(action=update_text, old_text="旧公司", new_text="新公司")

### Pattern 5: Create Edited Copy
User: "基于这个 PPT 做一个修改版，不要改原文件"
→ read_project_file → edit_project_office_document(output_name="修改版.pptx", edits=[...])
