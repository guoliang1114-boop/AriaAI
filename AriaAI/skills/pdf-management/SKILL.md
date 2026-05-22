---
name: pdf-management
description: "PDF file management toolkit. Use when the user needs to (1) merge multiple PDFs into one, (2) split a PDF into multiple files, (3) extract specific pages from a PDF, (4) read PDF text content, (5) add watermark to PDF. Supports advanced PDF operations beyond simple reading."
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
