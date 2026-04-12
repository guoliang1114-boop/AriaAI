# AriaAI Skill 开发指南

> 更新日期：2026-04-12
> 适用范围：当前仓库中的数据库 Skill 模型与后端工具注册机制

---

## 1. 当前 Skill 的真实形态

在当前代码里，Skill 不是单独的文件协议，而是数据库中的一条记录，定义在：

- `AriaAI/backend/app/models/db.py`

关键字段：

| 字段 | 说明 |
|---|---|
| `name` | 技能名称 |
| `category` | 分类，当前是自由文本 |
| `description` | 简述 |
| `system_prompt` | 系统提示词 |
| `user_template` | 用户输入模板 |
| `estimated_time` | 预计耗时 |
| `max_tokens` | 最大 tokens |
| `tools_definition_json` | Claude 标准 tools 定义 |
| `tools_json` | 兼容旧版的工具名列表 |

结论：

- 当前系统支持“完整 tool schema”
- 同时保留“旧版工具名列表”兼容层

---

## 2. Skill 的接口

当前 Skill 相关接口在：

- `AriaAI/backend/app/routers/skills.py`

主要接口：

- `GET /skills`
- `POST /skills`
- `PATCH /skills/{skill_id}`
- `DELETE /skills/{skill_id}`
- `POST /skills/migrate-categories`
- `POST /skills/seed-pro`
- `POST /skills/seed`
- `POST /skills/seed-templates`
- `GET /skills/tools/available`
- `GET /skills/tools/schemas`
- `POST /skills/tools/validate`
- `POST /skills/{skill_id}/tools/test`

---

## 3. 一个 Skill 最少需要什么

建议最少提供：

```json
{
  "name": "Executive Summary",
  "category": "提案与项目交付",
  "description": "把复杂材料压缩成管理层摘要",
  "system_prompt": "你是一名资深咨询顾问……",
  "user_template": "请基于以下内容生成执行摘要：",
  "estimated_time": "~2 min",
  "tools_definition_json": "[]"
}
```

如果要接工具，优先使用 `tools_definition_json`。

---

## 4. Tool 定义格式

当前工具格式遵循 Anthropic tools schema，形态如下：

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

工具注册入口在：

- `AriaAI/backend/app/tools/__init__.py`

工具执行服务在：

- `AriaAI/backend/app/services/tool_executor.py`

---

## 5. 当前已注册工具

当前 `file_generators.py` 中注册的工具包括：

- `generate_ppt`
- `generate_ppt_from_skill`
- `generate_docx`
- `generate_xlsx`
- `generate_pdf`
- `save_json`
- `save_text`

这些工具主要负责生成交付物或保存文本结果。

---

## 6. 推荐的 Skill 设计方式

### 6.1 Quick Tool

适合：

- 执行摘要
- 市场速算
- 客户邮件草稿

特点：

- 单轮或少量轮次
- `user_template` 明确
- 工具依赖少

### 6.2 Deep Task

适合：

- 尽调
- 战略路线图
- 根因分析

特点：

- prompt 更长
- 需要项目上下文
- 可能伴随文件生成

### 6.3 Guided Workflow

适合：

- 分阶段追问
- 结构化信息采集
- 多步输出

特点：

- `user_template` 像表单
- prompt 中应明确阶段和输出格式

---

## 7. Skill 编写建议

### 7.1 Prompt 层

- 先写角色，再写任务，再写输出格式
- 明确输出结构，避免只写“请详细分析”
- 如果需要工具，prompt 中要告诉模型什么时候应该用工具

### 7.2 Template 层

- 把用户必须提供的信息做成槽位
- 优先使用短段落 + 列表
- 避免自由发挥过多，降低输入质量波动

### 7.3 Tool 层

- 工具定义尽量小而稳定
- 输入 schema 不要过度复杂
- 工具名要和用途一一对应

---

## 8. 开发流程

1. 先确定 Skill 的目标用户和目标交付物。
2. 写 `system_prompt` 和 `user_template`。
3. 如果需要文件生成，再定义 `tools_definition_json`。
4. 用 `/skills/tools/validate` 检查 schema。
5. 通过 `/skills/{id}/tools/test` 做验证。
6. 在 Web 或 macOS 端实测对话链路。

---

## 9. 常见问题

### 9.1 分类是否有严格枚举？

当前没有。`category` 在模型里仍是自由文本，所以要靠约定保持一致。

### 9.2 是否必须写工具？

不是。纯 prompt Skill 仍然是有效的。

### 9.3 Skill 是否一定要在仓库里建目录？

不一定。当前主线产品里的 Skill 主要存数据库。仓库里的 `AriaAI/skills/ai-strategy-report` 更像一个带模板资产的特殊示例。

---

## 10. 当前阶段最值得改进的点

- 为 category 建立统一枚举和中英映射
- 把 Skill 的 tool 使用说明做成显式字段
- 给 Skill 增加版本号和发布状态
- 增加 Skill 导入导出能力
- 让模板资产和数据库 Skill 建立正式关联
