# AriaAI Skill 体系

> 更新日期：2026-05-20
> 适用范围：Skill 开发、注册、执行与结果回流全链路

---

## 1. Skill 定位

在当前代码里，Skill 是数据库中的可配置能力模块，不是本地插件目录。它的作用是把可复用的方法论、提示词模板、工具定义和执行约束沉淀成业务工作流。

当前 Skill 体系由三部分组成：

- 数据库 Skill 定义。
- 后端 Skill CRUD 与工具 schema 验证。
- 聊天/项目空间中的 Skill 执行入口和结果回流。

Skill 已经从"可选模板"升级为"项目/客户空间中的一等动作"。同时，项目对话中也引入了**顾问能力目录**（Consulting Capability），用于自动识别高频咨询场景并进入结构化任务编排。

> 顾问能力目录与 Skill 的关系：能力目录是后端内置的"自动 Skill 识别器"，用户不需要手动选择 Skill，系统根据输入自动匹配对应的能力并进入任务编排。Skill 则适合用户主动选择、需要特定方法论或工具组合的场景。

---

## 2. 数据模型

Skill 模型位于：

- `AriaAI/backend/app/models/db.py`

核心字段：

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

---

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

---

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

---

## 5. 当前已完成联动

- Skill CRUD 与分类。
- Skill 进入聊天链路，可选知识范围与上下文。
- **项目空间启动 Skill**：项目概览提供意图入口，从项目简报、风险行动、客户沟通等场景进入 Skills。
- **上下文预填**：Skills 识别项目来源，选择 Skill 后返回项目 Chat 并自动携带项目上下文 Prompt。
- **客户空间启动 Skill**：客户详情把客户档案、关联项目带入 Skills；有关联项目时导向项目 Chat 执行。
- **结果沉淀**：Skill 输出可通过 `ProjectChatSaveModal` 保存为项目文档/项目笔记，并触发项目记忆刷新。
- **结构化干系人注入**：Skill 执行时自动携带客户结构化干系人上下文，无需用户手工复制。
- **顾问能力目录自动识别**：项目对话中，系统根据用户输入自动匹配 `consulting_capabilities.py` 中的能力，进入结构化任务编排（`create_text_artifact` 等）。

---

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

---

## 7. 数字化与技术 Skill 注册表

原始清单方向合理，覆盖了数字化咨询项目的主线：战略、成熟度、架构、数据治理、流程、技术路线、组织变革、ROI 和行业蓝图。

需要修正的点：

- 原始清单只有 slug 和协作工具，不足以直接成为 AriaAI Skill。
- `digital-maturity-assessment` 已经在系统内存在，避免重复新增。
- `digital-roi-business-case` 与财务咨询里的 ROI Skill 有交叉，但数字化项目的 ROI 需要单独保留，因为成本项、收益假设和落地风险不同。
- `digital-strategy`、`enterprise-architecture`、`data-governance-consulting` 等更适合先输出文本方案，后续再联动 PPT、Excel、图表能力。
- `digital-strategy` 需要同时保留"后端内置 Skill"和"文件型 Skill"两套资产：前者用于页面展示和调用，后者用于沉淀完整方法论、行业参考和后续协作工具复用。

### 当前已接入数字化栏目

| # | Skill 名称 | 建议 slug | 主要用途 | 独立产出 | MVP 优先级 |
|---|---|---|---|---|---|
| 1 | AI 用例优先级矩阵 | `ai-use-case-priority-matrix` | 识别 AI 场景并按价值/可行性排序 | 优先级矩阵 + Quick Win Top 3 | P0 |
| 2 | 数字化成熟度评估 | `digital-maturity-assessment` | 六维度评估数字化成熟度和差距 | 评分表 + 差距分析 + 路线图 | P0 |
| 3 | 数字化战略设计 | `digital-strategy` | 基于 digital-strategy 工作流形成数字化转型战略、成熟度诊断、能力蓝图、路线图、治理与投资方案 | 战略报告大纲 + 能力蓝图 + 三阶段路线图 + 治理投资方案 | P0 |
| 4 | 企业架构蓝图设计 | `enterprise-architecture` | 设计业务/应用/数据/技术/安全架构 | 架构原则 + 目标蓝图 + 迁移路径 | P1 |
| 5 | 数据治理咨询方案 | `data-governance-consulting` | 设计数据治理框架和落地机制 | 治理方案 + 工作包清单 | P1 |
| 6 | 流程数字化改造 | `process-digitization` | 分析流程断点和自动化机会 | To-Be 流程方案 + 改造机会清单 | P1 |
| 7 | 数字技术路线图 | `digital-technology-roadmap` | 技术选型、能力依赖和建设节奏 | 技术路线图 + 投资建议 | P1 |
| 8 | 数字化组织变革 | `digital-organization-change` | 设计数字化组织、职责和能力模型 | 组织方案 + 90 天启动计划 | P2 |
| 9 | 数字化 ROI 商业案例 | `digital-roi-business-case` | 构建数字化项目投入产出论证 | ROI 测算逻辑 + Go/No-Go 建议 | P1 |
| 10 | 行业数字化蓝图 | `industry-digital-blueprint` | 结合行业价值链设计场景蓝图 | 行业蓝图 + 场景优先级 | P2 |

### 后续实现建议

- `digital-strategy` 已参考桌面资料 `Kimi_Agent_数字化赋能Skill表/digital-strategy` 升级为五步工作流：Diagnosis、Current State、Target State、Gap & Roadmap、Governance。
- `digital-strategy` 文件型 Skill 已补齐到 `AriaAI/skills/digital-strategy/`，包含 `SKILL.md`、`references/frameworks.md`、`references/industry-notes.md`，后续迭代应优先在该目录维护完整方法论，再同步必要摘要到后端种子。
- P0 先验证咨询高频入口：数字化战略、成熟度评估、AI 用例优先级。
- P1 补齐交付型能力：企业架构、数据治理、流程改造、技术路线、ROI。
- P2 再做行业化与组织变革，这两类更依赖客户上下文和行业模板库。
- 后续联动工具时，优先支持 `pptx` 和 `xlsx`：成熟度评分、ROI 测算、路线图最适合结构化输出。

---

## 8. 后续工程任务

1. 设计 Skill 运行记录表。
2. 给 Skill 增加版本号和发布状态。
3. 给核心 Skill 增加回归样例。
4. 为 Skill 执行失败增加结构化错误分类。
5. 设计 Skill 导入/导出格式。
