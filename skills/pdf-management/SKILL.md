---
name: pdf-management
description: "PDF file management toolkit. Use when the user needs to (1) merge multiple PDFs into one, (2) split a PDF into multiple files, (3) extract specific pages from a PDF, (4) read PDF text content, (5) add watermark to PDF. Supports advanced PDF operations beyond simple reading."
version: "1.0.0"
domain: "tech"
last_updated: "2026-08-26"
status: "stable"
---

# PDF Management Toolkit

Advanced PDF operations for project files. Handles merge, split, extract, read, and watermark operations.

## When To Use

- 合并多个 PDF 为一个文件
- 拆分 PDF 为多个文件
- 提取 PDF 的特定页面
- 读取 PDF 文本内容（比 read_project_file 更详细）
- 给 PDF 添加水印

## Tools

| Tool | Action | Description |
|------|--------|-------------|
| `manage_pdf` | `merge` | 合并多个 PDF |
| `manage_pdf` | `split` | 按页面范围拆分 PDF |
| `manage_pdf` | `extract` | 提取特定页面 |
| `manage_pdf` | `read` | 读取 PDF 文本和表格 |
| `manage_pdf` | `watermark` | 添加文字水印 |
| `read_project_file` | `read` | 简单 PDF 文本提取 |

## Usage Examples

### 合并 PDF
```json
{
  "action": "merge",
  "file_ids": [101, 102, 103],
  "output_name": "合并报告.pdf"
}
```

### 拆分 PDF
```json
{
  "action": "split",
  "file_id": 101,
  "page_ranges": [
    {"start": 1, "end": 5, "label": "第一部分"},
    {"start": 6, "end": 10, "label": "第二部分"}
  ]
}
```

### 提取页面
```json
{
  "action": "extract",
  "file_id": 101,
  "page_numbers": [1, 3, 5, 7],
  "output_name": "关键页面.pdf"
}
```

### 读取内容
```json
{
  "action": "read",
  "file_id": 101,
  "page_numbers": [1, 2, 3]
}
```

### 添加水印
```json
{
  "action": "watermark",
  "file_id": 101,
  "watermark_text": "内部文件",
  "output_name": "水印版本.pdf"
}
```

## Workflow

```
1. Identify → 确定操作类型和目标文件
2. Execute  → 调用 manage_pdf 执行操作
3. Confirm  → 向用户报告结果
```

## Important Notes

- 所有页码都是 **1-based**（第一页 = 1）
- 合并操作需要至少 2 个 PDF 文件
- 拆分和提取会创建新文件，不修改原文件
- 水印操作会创建新文件，不修改原文件
- 读取操作返回每页的文本内容和表格数据

## Capability Upgrade

### Mode Selection

- **Quick**: 用户只要求合并、拆分、提取或加水印时，直接确认文件、页码和输出名后执行。
- **Standard**: 处理项目交付物时，先校验文件顺序、页码范围、命名规范和是否需要保留原件。
- **Deep**: 文件用于知识库、客户档案或正式交付时，执行内容读取、页码索引、章节识别和结果复核。

### Context Enrichment

在 Aria 项目空间中使用时，先识别文件属于哪类资产：客户资料、项目文档、会议材料、交付物、合同、审计证据或知识库素材。若用户没有说明用途，根据项目阶段和文件名推断，但必须在回复中披露推断。

### Operation Decision Logic

| 用户目标 | 推荐动作 | 关键检查 |
|----------|----------|----------|
| 合成正式交付物 | `merge` | 文件顺序、封面、目录、页码连续性 |
| 拆出章节 | `split` | 页码范围、章节标题、输出命名 |
| 提取证据页 | `extract` | 页码准确性、证据上下文、原文件保留 |
| 读取知识内容 | `read` | 页码范围、表格/正文区分、缺页风险 |
| 发布前脱敏 | `watermark` | 水印文本、是否遮挡正文、是否保留无水印原件 |

### Failure Handling

- 文件缺失、页码越界、PDF 加密、扫描件无文本层时，不要静默失败。
- 如果读取结果为空，明确说明可能是扫描件，并建议走 OCR 或人工确认。
- 如果多个文件顺序不确定，先要求用户确认顺序，不要自行合并正式文件。

### Quality Gates

- [ ] 页码使用 1-based 规则，并已向用户确认。
- [ ] 输出文件名能体现客户、项目、用途和日期。
- [ ] 所有操作均生成新文件，不覆盖原文件。
- [ ] 对正式交付物，已检查合并顺序、页数和水印可读性。
- [ ] 对知识库素材，已说明是否成功提取文本和表格。

### Deliverable Catalog

| Deliverable | When to use | Minimum content | Format |
|-------------|-------------|-----------------|--------|
| Merged PDF package | 合并正式材料 | 文件顺序、页数、输出名、原件保留和结果确认 | PDF |
| Split PDF set | 按章节拆分 | 页码范围、章节名称、输出文件和索引 | PDF |
| Evidence page extract | 提取证据页 | 原文件、页码、证据说明、输出文件和引用 | PDF / Markdown |
| PDF text extraction note | 读取内容 | 页码、正文、表格、读取限制和扫描件提示 | Markdown |
| Watermarked PDF | 发布或流转 | 水印文本、位置、输出文件和可读性确认 | PDF |
| PDF processing log | 批量处理 | 操作、文件、页码、结果、失败原因和下一步 | Markdown / Excel |
