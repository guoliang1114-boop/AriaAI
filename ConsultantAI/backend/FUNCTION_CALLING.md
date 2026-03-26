# Claude Function Calling (Tool Use) 架构

本文档介绍 ConsultantAI 的 Claude Function Calling 实现，支持通过对话自动生成 PPT、Word、Excel、PDF 等文件。

## 架构概览

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   SwiftUI App   │────▶│   FastAPI        │────▶│   Claude API    │
│   (ChatView)    │◄────│   (chat.py)      │◄────│   (tool_use)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │   Tool Executor  │
                        │   (tool_executor)│
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │   File Generators│
                        │   (file_generators│
                        └──────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │   Generated Files│
                        │   (uploads/)     │
                        └──────────────────┘
```

## 流程说明

### 1. 技能配置

在创建 Skill 时，通过 `tools_definition_json` 字段定义可用的工具：

```json
{
  "name": "咨询报告生成器",
  "tools_definition_json": [
    {
      "name": "generate_ppt",
      "description": "生成 PowerPoint 演示文稿",
      "input_schema": {
        "type": "object",
        "properties": {
          "title": {"type": "string"},
          "slides": {"type": "array", ...}
        },
        "required": ["title", "slides"]
      }
    }
  ]
}
```

### 2. 对话流程

```
用户: "帮我生成一个数字化转型咨询报告"
   │
   ▼
Claude: 分析需求，决定调用工具
   │
   ├──▶ 调用 generate_ppt() ──▶ 生成 PPT 文件
   ├──▶ 调用 generate_docx() ──▶ 生成 Word 文件
   └──▶ 调用 generate_xlsx() ──▶ 生成 Excel 文件
   │
   ▼
返回文件下载链接给用户
```

### 3. API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/chat/send` | POST | 发送消息，支持流式响应和工具调用 |
| `/skills/tools/available` | GET | 列出所有可用工具 |
| `/skills/tools/schemas` | GET | 获取 Claude 格式的工具定义 |
| `/artifacts` | GET | 列出生成的文件 |
| `/artifacts/{id}/download` | GET | 下载文件 |

## 可用工具列表

### `generate_ppt`
生成 PowerPoint (.pptx) 演示文稿

```json
{
  "title": "数字化转型战略",
  "subtitle": "某企业 2024",
  "slides": [
    {
      "type": "content",
      "title": "执行摘要",
      "content": "- 当前数字化水平评估\n- 关键转型机会\n- 实施路线图"
    }
  ]
}
```

### `generate_docx`
生成 Word (.docx) 文档

```json
{
  "title": "数字化转型咨询报告",
  "sections": [
    {
      "heading": "现状分析",
      "content": "详细分析内容...",
      "level": 1
    }
  ]
}
```

### `generate_xlsx`
生成 Excel (.xlsx) 电子表格

```json
{
  "sheets": [
    {
      "name": "财务数据",
      "headers": ["年份", "收入", "利润率"],
      "data": [
        [2022, 1000000, 0.15],
        [2023, 1200000, 0.18]
      ]
    }
  ]
}
```

### `generate_pdf`
生成 PDF 文档

```json
{
  "title": "报告",
  "content": "Markdown 格式的内容",
  "orientation": "portrait"
}
```

### `save_json`
保存 JSON 数据文件

```json
{
  "filename": "analysis_result",
  "data": {"key": "value"}
}
```

### `save_text`
保存文本文件

```json
{
  "filename": "notes",
  "content": "文本内容",
  "extension": "txt"
}
```

## 工具注册

自定义工具可以通过以下方式注册：

```python
from app.tools import registry

@registry.register(
    name="my_custom_tool",
    description="工具描述",
    input_schema={
        "type": "object",
        "properties": {...}
    }
)
async def my_custom_tool(param1: str, param2: int) -> dict:
    # 实现工具逻辑
    return {"result": "success"}
```

## SSE 事件类型

聊天流支持以下事件类型：

| 类型 | 说明 |
|------|------|
| `conversation_id` | 对话 ID |
| `text` | 文本内容块 |
| `tool_executing` | 工具正在执行 |
| `tool_results` | 工具执行结果 |
| `done` | 流结束 |
| `error` | 错误信息 |

## 示例用法

### 创建一个带文件生成功能的技能

```bash
curl -X POST http://localhost:8000/skills \
  -H "Content-Type: application/json" \
  -d @tools_example.json
```

### 使用技能进行对话

```bash
curl -X POST http://localhost:8000/chat/send \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: your-token" \
  -d '{
    "content": "帮我生成一个数字化转型报告，包括PPT和分析文档",
    "skill_id": 1
  }'
```

### 下载生成的文件

```bash
curl -O http://localhost:8000/artifacts/1/download
```

## 文件存储

生成的文件保存在 `data/uploads/generated/` 目录下：

```
data/uploads/
├── projects/           # 项目文件
├── generated/          # AI 生成的文件
│   ├── generated_20240324_101530.pptx
│   ├── generated_20240324_101535.docx
│   └── generated_20240324_101540.xlsx
└── knowledge/          # 知识库文档
```

## 技术细节

### 工具执行流程

1. **调用阶段**: Claude 返回 `tool_use` 块
2. **解析阶段**: 后端解析 JSON 参数
3. **执行阶段**: 调用对应的 Python 函数
4. **结果阶段**: 将结果封装为 `tool_result`
5. **继续阶段**: 将结果返回给 Claude 继续对话

### 错误处理

- 工具参数错误: 返回 `{"status": "error", "error": "..."}`
- 工具不存在: 返回 400 错误
- 执行失败: 捕获异常并返回错误信息

## 前端集成

SwiftUI 前端需要：

1. 监听 `tool_executing` 事件显示进度
2. 监听 `tool_results` 事件获取文件链接
3. 提供下载按钮让用户获取文件

```swift
// 示例：处理工具事件
switch event.type {
case "tool_executing":
    showProgress("正在生成文件...")
case "tool_results":
    hideProgress()
    showFileLinks(event.results)
}
```
