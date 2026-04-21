# AriaAI Skill 开发指南

更新时间：2026-04-21

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

已完成（截至 2026-04-21）：

- Skill CRUD 与分类。
- Skill 进入聊天链路，可选知识范围与上下文。
- **项目空间启动 Skill**：项目概览新增 `ProjectSkillWorkflowsCard`，从项目简报、风险行动、客户沟通三个意图进入 Skills。
- **上下文预填**：Skills 识别项目来源，选择 Skill 后返回项目 Chat 并自动携带项目上下文 Prompt。
- **客户空间启动 Skill**：客户详情把客户档案、关联项目带入 Skills；有关联项目时导向项目 Chat 执行。
- **结果沉淀**：Skill 输出可通过 `ProjectChatSaveModal` 保存为项目文档/项目笔记，并触发项目记忆刷新。
- **结构化干系人注入**：Skill 执行时自动携带客户结构化干系人上下文，无需用户手工复制。

仍需推进：

- 真正的客户级资产沉淀入口（客户笔记/客户文档/客户记忆沉淀）。
- Skill 运行记录、版本号和失败分类。
- 统一 Chat 启动协议，清理旧全局 Chat 示例页。
- 批量 Skill 结果沉淀与多目标保存。

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

## 7. Skill 工作流（当前已落地）

### 项目空间启动

已完成：

- 项目概览 `ProjectSkillWorkflowsCard` 提供三个意图入口（简报、风险行动、客户沟通）。
- Skills 页识别来源项目，选择 Skill 后携带项目上下文返回项目 Chat。
- 项目 Chat 读取 `skill` 与 `q` 参数，自动进入新对话、选中 Skill、预填上下文。

### 客户空间启动

已完成：

- 客户详情把客户档案、记忆状态、关联项目带入 Skills。
- 存在关联项目时，执行导向该项目 Chat。
- 无关联项目时，全局 Chat 兜底并提示先关联项目。

### 结果回流

当前复用：

- `ProjectChatSaveModal`：保存为项目 Markdown 文档或笔记。
- 保存后提示刷新项目记忆。

待补：

- 保存为项目记忆 pinned 槽位。
- 保存为客户记忆沉淀（客户笔记/客户文档）。
- 保存后触发预热。

## 8. 后续工程任务

1. 设计 Skill 运行记录表。
2. 给 Skill 增加版本号和发布状态。
3. 给核心 Skill 增加回归样例。
4. 为 Skill 执行失败增加结构化错误分类。
5. 设计 Skill 导入/导出格式。
