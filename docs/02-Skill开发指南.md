# AriaAI Skill 开发指南

> 更新日期：2026-04-14
> 适用范围：当前仓库中的数据库 Skill 模型、后端工具注册机制和前端 Skill 编辑能力。

---

## 1. 当前 Skill 的真实形态

在当前代码里，Skill 不是仓库中的独立插件目录，而是数据库中的一条记录，核心定义在：

- `AriaAI/backend/app/models/db.py`

关键字段包括：

| 字段 | 说明 |
|---|---|
| `name` | 技能名称 |
| `category` | 分类，当前仍是自由文本 |
| `description` | 简介 |
| `system_prompt` | 系统提示词 |
| `user_template` | 用户输入模板 |
| `estimated_time` | 预估耗时 |
| `max_tokens` | 最大 tokens |
| `tools_definition_json` | Anthropic 风格 tools schema |
| `tools_json` | 兼容旧版本的工具名列表 |

结论：

- 当前系统已支持完整 tool schema
- 同时保留旧格式兼容层

---

## 2. Skill 相关接口

后端入口：

- `AriaAI/backend/app/routers/skills.py`

主要接口：

- `GET /skills`
- `POST /skills`
- `PATCH /skills/{skill_id}`
- `DELETE /skills/{skill_id}`
- `POST /skills/migrate-categories`
- `POST /skills/seed`
- `POST /skills/seed-pro`
- `POST /skills/seed-templates`
- `GET /skills/tools/available`
- `GET /skills/tools/schemas`
- `POST /skills/tools/validate`
- `POST /skills/{skill_id}/tools/test`

---

## 3. 一个 Skill 的最小结构

建议至少包含：

```json
{
  "name": "Executive Summary",
  "category": "项目交付",
  "description": "将复杂资料压缩成管理层摘要",
  "system_prompt": "你是一名资深咨询顾问，负责输出清晰、可执行的摘要。",
  "user_template": "请基于以下信息生成执行摘要：",
  "estimated_time": "~2 min",
  "tools_definition_json": "[]"
}
```

如果需要文件生成或外部工具，请优先使用 `tools_definition_json`。

---

## 4. Tool 定义格式

当前工具格式遵循 Anthropic tools schema，例如：

```json
[
  {
    "name": "generate_ppt",
    "description": "Generate a PowerPoint presentation",
    "input_schema": {
      "type": "object",
      "properties": {
        "title": { "type": "string" },
        "slides": { "type": "array" }
      },
      "required": ["title", "slides"]
    }
  }
]
```

相关代码：

- 工具注册：`AriaAI/backend/app/tools/__init__.py`
- 工具执行：`AriaAI/backend/app/services/tool_executor.py`

---

## 5. 当前已注册工具

当前 `file_generators.py` 已注册的工具包括：

- `generate_ppt`
- `generate_ppt_from_skill`
- `generate_docx`
- `generate_xlsx`
- `generate_pdf`
- `save_json`
- `save_text`

这些工具主要承担“生成交付物”或“保存结构化结果”的职责。

---

## 6. 推荐的 Skill 设计方式

### 6.1 Quick Task

适合：

- 客户邮件草稿
- 执行摘要
- 简短分析

特点：

- 单轮或少量轮次
- 模板明确
- 工具依赖少

### 6.2 Deep Task

适合：

- 尽调
- 战略路线图
- 根因分析

特点：

- Prompt 更长
- 更依赖项目上下文
- 可能伴随文件生成

### 6.3 Guided Workflow

适合：

- 分阶段追问
- 结构化信息收集
- 多步输出

特点：

- `user_template` 更像表单
- 输出格式要写清楚

---

## 7. 编写建议

### 7.1 Prompt 层

- 先写角色，再写任务，再写输出格式
- 明确产物结构，不要只写“请详细分析”
- 如需工具，要明确触发时机

### 7.2 Template 层

- 把必填信息做成清晰槽位
- 优先短段落和列表
- 避免自由发挥空间过大

### 7.3 Tool 层

- 工具定义尽量小而稳
- 输入 schema 不要过度复杂
- 名称与用途保持一一对应

---

## 8. 开发流程

1. 先确定目标用户和交付物。
2. 写 `system_prompt` 与 `user_template`。
3. 如需文件生成，再补 `tools_definition_json`。
4. 用 `/skills/tools/validate` 校验 schema。
5. 用 `/skills/{id}/tools/test` 做验证。
6. 在 Web 或 macOS 端实际走一遍聊天链路。

---

## 9. 当前仍值得改进的点

- `category` 仍是自由文本，缺少统一枚举
- Skill 缺少版本号与发布状态
- Skill 导入导出能力还未正式建立
- 模板资产与数据库 Skill 的关系仍偏松散
