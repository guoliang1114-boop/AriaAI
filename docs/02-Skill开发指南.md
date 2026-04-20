# AriaAI Skill 开发指南

更新时间：2026-04-20

## 1. Skill 定位

在当前代码里，Skill 是数据库中的可配置能力模块，不是本地插件目录。它的作用是把可复用的方法论、提示词模板、工具定义和执行约束沉淀成业务工作流。

当前 Skill 体系由三部分组成：

- 数据库 Skill 定义。
- 后端 Skill CRUD 与工具 schema 验证。
- 聊天/项目空间中的 Skill 执行入口和结果回流。

下一版本的目标是让 Skill 从“可选模板”升级为“项目/客户空间中的一等动作”。

## 2. 数据模型

Skill 模型位于：

- `AriaAI/backend/app/models/db.py`

核心字段包括：

| 字段 | 说明 |
|---|---|
| `id` | Skill ID |
| `name` | 名称 |
| `description` | 描述 |
| `category` | 分类 |
| `system_prompt` | 系统提示词 |
| `user_template` | 用户输入模板 |
| `tools_definition_json` | 工具 schema |
| `is_active` | 是否启用 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

## 3. 后端接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/skills` | 获取 Skill 列表，可按分类过滤 |
| `POST` | `/skills` | 创建 Skill |
| `PATCH` | `/skills/{skill_id}` | 更新 Skill |
| `DELETE` | `/skills/{skill_id}` | 删除 Skill |

注意：

- Skill 列表带缓存。
- Skill 变更后会清理缓存。
- `tools_definition_json` 需要保持 JSON schema 可解析。

## 4. 推荐 Skill 定义

最小可用 Skill：

```json
{
  "name": "项目复盘助手",
  "description": "基于项目资料生成复盘摘要、经验和后续行动",
  "category": "项目交付",
  "system_prompt": "你是一名资深交付负责人，擅长结构化复盘。",
  "user_template": "请基于以下项目资料生成复盘：\n\n项目背景：\n关键结果：\n主要问题：\n后续行动：",
  "tools_definition_json": "[]",
  "is_active": true
}
```

如果 Skill 需要生成文档、PPT、Excel 或其他产物，再把对应工具 schema 填到 `tools_definition_json`。

## 5. 当前已完成联动

已完成：

- Skill CRUD 与分类。
- Skill 可进入聊天链路。
- 项目聊天里可表达当前项目/客户知识范围。
- 选中 Skill 后提示当前上下文。
- Skill 结果可保存，并提示进入项目记忆治理。
- 保存后可触发项目记忆刷新。

仍需推进：

- 项目页显性启动 Skill。
- 客户页显性启动 Skill。
- Skill 执行默认携带项目/客户记忆。
- Skill 结果一键保存为项目文档、项目笔记、客户记忆沉淀。
- Skill 运行记录、版本、验证机制。

## 6. 编写建议

好的 Skill 应该满足：

- 有明确任务边界，而不是泛泛聊天。
- 输入模板能引导用户补齐关键资料。
- 输出结构稳定，可被保存或复用。
- 能说明结果适合沉淀到哪里：项目文档、项目笔记、项目记忆、客户记忆。
- 如果使用工具，工具 schema 要小而明确。

不建议：

- 一个 Skill 同时承担多个互不相关的任务。
- 系统提示词过长但没有输出约束。
- 工具 schema 过宽，导致模型难以稳定调用。
- 依赖用户手工复制大量项目上下文。

## 7. 下一版本 Skill 工作流

### 项目空间启动

目标：

- 在项目 Chat / Overview / Memory 中提供 Skill 入口。
- 默认带入项目记忆、客户名称、文件摘要、里程碑和待办。
- 执行后可保存为项目资产。

### 客户空间启动

目标：

- 在客户 Detail / Memory 中提供 Skill 入口。
- 默认带入客户记忆、关联项目和客户摘要。
- 适合生成客户沟通策略、关系复盘、机会分析、交付风险总结。

### 结果回流

目标：

- 保存为项目文档。
- 保存为项目笔记。
- 保存为项目记忆 pinned 槽位。
- 保存为客户记忆沉淀。
- 保存后触发记忆刷新或摘要预热。

## 8. 后续工程任务

1. 设计 Skill 运行记录表。
2. 给 Skill 增加版本号和发布状态。
3. 给核心 Skill 增加回归样例。
4. 为 Skill 执行失败增加结构化错误分类。
5. 设计 Skill 导入/导出格式。
