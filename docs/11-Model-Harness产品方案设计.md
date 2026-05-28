# Model + Harness 产品方案设计

> 更新日期：2026-05-28  
> 关联文档：[05-对话系统设计与规范](./05-对话系统设计与规范.md)、[06-HITAS设计](./06-Human-in-the-Loop%20Tool%20Approval%20设计.md)、[08-Skill体系评估与优化路线图](./08-Skill体系评估与优化路线图.md)

## 目录

- [1. 文档定位](#1-文档定位)
- [2. 为什么现在引入](#2-为什么现在引入)
- [3. 设计目标](#3-设计目标)
  - [3.1 产品目标](#31-产品目标)
  - [3.2 工程目标](#32-工程目标)
  - [3.3 非目标](#33-非目标)
- [4. 核心概念](#4-核心概念)
  - [4.1 Model](#41-model)
  - [4.2 Harness](#42-harness)
  - [4.3 AI Run](#43-ai-run)
- [5. 总体架构](#5-总体架构)
- [6. Harness 分层设计](#6-harness-分层设计)
  - [6.1 Context Harness](#61-context-harness)
  - [6.2 Routing Harness](#62-routing-harness)
  - [6.3 Tool Harness](#63-tool-harness)
  - [6.4 Policy Harness](#64-policy-harness)
  - [6.5 Persistence Harness](#65-persistence-harness)
  - [6.6 Event Harness](#66-event-harness)
  - [6.7 Run Manager](#67-run-manager)
- [7. Run Lifecycle 设计](#7-run-lifecycle-设计)
  - [7.1 状态枚举](#71-状态枚举)
  - [7.2 Display Mode](#72-display-mode)
- [8. Product Run Event 协议](#8-product-run-event-协议)
- [9. 前端展示原则](#9-前端展示原则)
- [10. 与现有系统的关系](#10-与现有系统的关系)
- [11. 分阶段落地](#11-分阶段落地)
- [12. 风险与取舍](#12-风险与取舍)
- [13. 建议的近期决策](#13-建议的近期决策)
- [14. 第一版验收标准](#14-第一版验收标准)
- [15. 总结](#15-总结)

## 1. 文档定位

本文描述 AriaAI 在产品层面引入 Model + Harness 的设计方案。目标不是立即重构为完整 Agent 平台，而是把现有项目对话、Skill、工具调用、项目记忆、交付物生成和用户确认机制收敛为一套稳定的 AI Run Harness。

核心判断：

- Model 负责理解、生成、推理和规划。
- Harness 负责上下文、工具、权限、状态、执行、持久化、展示和失败处理。
- 用户感知到的 AI 可靠性主要来自 Harness，而不只来自模型能力。

当前 AriaAI 已有 Harness 雏形，包括对话 runtime、context builder、tool executor、HITAS、task orchestration、project memory、stream events 和 artifact 保存。但这些能力仍比较分散，部分内部日志和底层 tool event 会直接暴露给前端，导致产品体验不稳定。

## 2. 为什么现在引入

近期项目对话暴露出的几个问题，本质上都是 Harness 问题：

| 现象 | 本质原因 |
|---|---|
| 普通问答下展示“任务进度” | 底层工具调用事件直接映射到用户界面 |
| “AI 正在读取”出现后很快消失 | 前端状态与真实 run lifecycle 没有统一协议 |
| 回复看起来不是流式输出 | 后端内部收集 LLM chunk 后再统一发送 |
| Markdown、表格和工具日志混在一起 | assistant content、tool summary、run progress 边界不清 |
| 生成物、记忆、任务、消息保存逻辑分散 | 缺少统一的 run persistence contract |

因此，当前引入 Harness 的意义是：

1. 提升用户体验稳定性。
2. 降低后续 Skill、任务、文件、记忆能力扩展成本。
3. 避免前端继续绑定底层工具实现细节。
4. 为未来更复杂的项目 AI 工作流预留边界。

## 3. 设计目标

### 3.1 产品目标

- 用户发送消息后立即获得稳定反馈。
- 普通问答保持轻量，不展示内部执行日志。
- 长任务展示进度，但使用产品语言而不是技术日志。
- 危险或不可逆动作必须明确确认。
- AI 输出可以沉淀为消息、项目记忆、任务、文件或交付物。
- 失败时给出可理解的结果，而不是中断在内部状态。

### 3.2 工程目标

- 统一一次 AI 执行的生命周期。
- 统一后端到前端的 run event 协议。
- 统一上下文构造、工具执行、权限判断和结果持久化边界。
- 将 UI 从底层 tool call 中解耦。
- 保留现有对话、Skill、HITAS 和 task orchestration 能力，采用渐进式收敛。

### 3.3 非目标

第一阶段不做以下事情：

- 不重写所有 Agent/Skill 执行链路。
- 不引入复杂的外部 workflow engine。
- 不做多 Agent 协作平台。
- 不做完整 run replay/debug console。
- 不改变现有核心业务数据模型的大方向。

## 4. 核心概念

### 4.1 Model

Model 是推理与生成层。它可以：

- 理解用户问题。
- 生成回答。
- 规划工具调用。
- 根据上下文做分析和总结。
- 产出结构化内容或交付物草稿。

Model 不应该直接决定：

- 用户是否看见内部工具日志。
- 工具是否允许执行。
- 高风险动作是否绕过确认。
- 结果如何写入项目空间。
- 失败状态如何恢复。

### 4.2 Harness

Harness 是模型外部的产品执行层。它负责：

- 选择上下文。
- 选择 mode、policy、skill 和工具。
- 执行权限与安全检查。
- 管理一次 AI run 的状态。
- 将工具调用转换为产品事件。
- 持久化消息、artifact、memory、task 和 pending action。
- 向前端输出稳定的 UX event。

### 4.3 AI Run

AI Run 是一次用户请求对应的完整执行单元。其生命周期由 Run Manager 编排，各阶段由对应的 Harness 处理。详见 [6. Harness 分层设计](#6-harness-分层设计) 和 [7. Run Lifecycle 设计](#7-run-lifecycle-设计)。

```text
User Message
  ↓
Create AI Run（Run Manager）
  ↓
Prepare Context（Context Harness）
  ↓
Route Mode / Policy / Skill（Routing Harness + Policy Harness）
  ↓
Model Stream（Model Layer）
  ↓
Tool / Task / Artifact / Memory（Tool Harness）
  ↓
Persist Result（Persistence Harness）
  ↓
Emit Events（Event Harness）
  ↓
Close AI Run（Run Manager）
```

AI Run 可以对应：

- 一次普通项目问答。
- 一次 Skill 执行。
- 一次文件读取和总结。
- 一次交付物生成。
- 一次需要用户确认的项目修改。
- 一次长耗时 durable task。

## 5. 总体架构

```text
Frontend
  ├── Chat UI
  ├── Run Status UI
  ├── Confirmation UI
  └── Artifact / Memory / Task UI

Backend Harness
  ├── Run Manager（编排器）
  ├── Context Harness
  ├── Routing Harness
  ├── Tool Harness
  ├── Policy Harness
  ├── Persistence Harness
  └── Event Harness
      ↓
  Product State（数据持久化层）
      ├── Message
      ├── Project Memory
      ├── Project File / Artifact
      ├── Task Run
      └── Pending Tool Action

Model Layer（外部推理服务）
  ├── LLM Provider
  ├── Prompt / System Frame
  └── Stream Response
```

关键原则：

- 后端输出给前端的是产品事件，不是底层工具日志。
- 底层 trace 仍然保留，但默认只用于调试和审计。
- 普通对话与长任务共用 run lifecycle，但前端展示策略不同。

## 6. Harness 分层设计

### 6.1 Context Harness

职责：

- 统一项目上下文构造。
- 控制模型每轮能看到哪些内容。
- 区分自动注入上下文和按需读取上下文。
- 避免模型为了普通问答频繁调用只读工具。

输入：

- user message
- project id
- conversation id
- selected skill
- mention context
- knowledge scope
- recent history

输出：

- structured project context
- selected files or memory snippets
- prompt context block
- context trace

设计原则：

- 普通项目问答优先使用已注入上下文。
- 用户明确提到文件、文档、空间内容时，才进入 read-on-demand。
- Context Harness 不负责 UI 展示，只负责“模型看到什么”。

### 6.2 Routing Harness

职责：

- 决定本轮属于普通问答、项目深潜、Skill 执行、文件处理、交付物生成或长任务。
- 输出 mode、action policy、tool access policy。
- 限制模型不能自行升级权限。

当前基础：

- `ChatMode`
- `ActionPolicy`
- `ToolAccessPolicy`
- `IntentRouter`
- `Consulting Turn Frame`

后续收敛方向：

- 路由结果成为 AI Run 的正式字段。
- 前端展示不直接依赖 route 细节，只消费 run display mode。

### 6.3 Tool Harness

职责：

- 统一工具注册、参数校验、权限判断和执行结果。
- 将底层 tool call 转换为产品事件。
- 区分 read-only、write artifact、modify existing、destructive action。

设计原则：

- 只读工具默认不在普通问答中展示为“任务进度”。
- 写入、新建、修改、删除类工具可以展示产品级进度。
- 需要确认的工具必须进入 HITAS，而不是依赖模型复述确认。
- 工具执行失败要返回可保存、可展示的失败结果。

### 6.4 Policy Harness

职责：

- 定义副作用边界。
- 控制工具可见性。
- 控制是否需要用户确认。
- 保护项目、客户、用户权限范围。

设计原则：

- 默认从严。
- 读写分离。
- 修改和删除必须可审计。
- 用户确认后执行冻结参数，不重新让模型生成工具调用。

### 6.5 Persistence Harness

职责：

- 统一保存 assistant message。
- 统一保存 artifact、project memory、task run、pending tool action。
- 保证前端临时 streaming 状态最终可以稳定替换为持久化状态。

设计原则：

- 一次 AI Run 最终必须有明确结束状态。
- 没有文本但有 artifact、tool result 或 task run 时，也要有可理解的 assistant message。
- 持久化结果与 stream event 不应相互矛盾。

### 6.6 Event Harness

职责：

- 将内部事件转换为前端消费的产品事件。
- 保证立即反馈、真实流式输出和最终完成事件。
- 隐藏普通问答中的内部工具细节。

事件分两层：

1. Internal Trace Event：用于调试、审计、回放。
2. Product Run Event：用于前端展示。

前端默认只消费 Product Run Event。

### 6.7 Run Manager

职责：

- 持有 AI Run 状态机（`created` → `preparing` → ... → `completed`/`failed`）。
- 协调各 Harness 的执行顺序：Context → Routing → Model → Tool → Persistence → Event。
- 处理异常中断和状态回滚。
- 管理 run 级别的超时和取消。

设计原则：

- Run Manager 不处理业务逻辑，只负责编排。
- 各 Harness 向 Run Manager 报告成功/失败，由 Run Manager 决定状态转移。
- Run Manager 是 AI Run 状态机的唯一持有者，防止多个 Harness 同时修改状态导致竞态。

## 7. Run Lifecycle 设计

### 7.1 状态枚举

建议的 run status：

| 状态 | 说明 |
|---|---|
| `created` | run 已创建 |
| `preparing` | 正在准备上下文和路由 |
| `generating` | 模型正在生成 |
| `reading_context` | 正在读取用户明确要求的上下文 |
| `running_tool` | 正在执行可展示工具 |
| `waiting_confirmation` | 等待用户确认 |
| `persisting` | 正在保存结果 |
| `completed` | 完成 |
| `failed` | 失败 |
| `cancelled` | 用户取消 |

### 失败恢复策略

| 失败阶段 | 用户感知 | 恢复方式 | 数据一致性 |
|---------|---------|---------|-----------|
| `preparing` | "生成失败，请重试" | 用户重新发送消息，创建新 run | 无 side effect |
| `generating` | 文本截断，显示"生成中断" | 前端保留已流式内容，用户可点击"继续生成" | 不保存不完整 message |
| `running_tool` | 展示工具失败原因 | 若工具支持幂等，自动重试 1 次；否则进入 `failed` | 已执行的写入操作不自动回滚 |
| `persisting` | "保存结果失败" | 保留 trace，开发者手动修复 | 内部标记为 `persist_failed`，人工介入 |

关键原则：失败时必须给用户可理解的状态，而不是空白或无限 loading。

### 7.2 Display Mode

同一个 run status 在不同场景下展示方式不同。

| display mode | 场景 | 展示策略 |
|---|---|---|
| `quiet` | 普通问答 | 只展示输入中、正在生成、正文流式输出 |
| `contextual` | 明确读文件或检索资料 | 可展示“正在读取相关资料” |
| `task` | 长任务或交付物生成 | 展示任务进度 |
| `confirmation` | 需要用户确认 | 展示确认卡片 |
| `debug` | 开发或内部审计 | 展示完整 tool trace |

普通用户默认不进入 `debug`。

### Display Mode 决策规则

- **初始决策**：由 Routing Harness 在 `preparing` 阶段根据 user message + project context 决定。
- **动态切换**：允许在 `running_tool` 阶段因工具权限升级而切换（如 `quiet` → `confirmation`），但禁止降级。
- **固定约束**：一次 run 的 display mode 最多切换一次，避免前端展示抖动。

| 切换场景 | 从 | 到 | 触发条件 |
|---------|----|----|---------|
| 普通问答中发现需要写入文件 | `quiet` | `confirmation` | Tool Harness 检测到 destructive/write 工具调用 |
| 文件读取后进入交付物生成 | `contextual` | `task` | Routing Harness 识别到 Skill 执行意图 |
| 长任务完成后需要用户确认 | `task` | `confirmation` | Policy Harness 判断需要显式确认 |

## 8. Product Run Event 协议

建议第一版事件：

| event type | 用途 | 必填字段 | 选填字段 | 字段约束 |
|---|---|---|---|---|
| `run_started` | run 已开始，前端立即进入 loading | `run_id`, `timestamp` | `display_mode` | `display_mode` 必须在 run 创建时提供 |
| `status` | 产品级状态文案 | `run_id`, `message` | `display_mode`, `progress` | `message` 长度 ≤ 50 字，面向用户 |
| `text_delta` | 模型文本增量 | `run_id`, `content` | - | `content` 为 UTF-8 文本片段，禁止在后端批量缓存后发送 |
| `reference_delta` | 资料来源增量 | `run_id`, `source` | `url`, `title` | `source` 为文件/文档标识符 |
| `artifact_ready` | 交付物可用 | `run_id`, `artifact_id`, `artifact_type` | `download_url`, `preview_url` | `artifact_type` 枚举：`pptx`, `docx`, `xlsx`, `pdf`, `markdown` |
| `tool_progress` | 可展示工具进度 | `run_id`, `title`, `status` | `detail`, `progress` | `status` 枚举：`pending`, `running`, `completed`, `failed` |
| `confirmation_required` | 需要用户确认 | `run_id`, `action`, `impact` | `params_snapshot`, `deadline` | `action` 必须人类可读，`params_snapshot` 用于确认后冻结执行 |
| `task_update` | 长任务进度更新 | `run_id`, `task_id`, `status` | `progress_pct`, `current_step`, `total_steps` | `progress_pct` 为 0–100 整数 |
| `message_persisted` | assistant message 已保存 | `run_id`, `message_id` | `parent_run_id` | 用于 streaming 气泡替换为持久化消息 |
| `run_done` | run 完成 | `run_id`, `final_status` | `message_id`, `artifact_ids` | `final_status` 必须与 run status 一致 |
| `run_failed` | run 失败 | `run_id`, `error_code`, `error_message` | `retryable`, `fallback_content` | `error_message` 面向用户，禁止暴露内部堆栈 |

示例：

```json
{
  "type": "status",
  "run_id": "run_123",
  "display_mode": "quiet",
  "message": "正在生成回复..."
}
```

```json
{
  "type": "text_delta",
  "run_id": "run_123",
  "content": "这里是对项目风险的总结："
}
```

```json
{
  "type": "tool_progress",
  "run_id": "run_123",
  "display_mode": "task",
  "title": "生成项目简报",
  "status": "running"
}
```

### Event 字段约束

| 约束项 | 规则 |
|--------|------|
| `run_id` | 全局唯一，格式 `run_{uuid}`，贯穿同一次 AI Run 的全部事件 |
| `timestamp` | ISO 8601 格式，精确到毫秒，用于事件排序和时序分析 |
| `display_mode` | 与 run 的 display mode 一致，前端据此选择展示组件 |
| `message` | 面向最终用户的中文文案，禁止包含内部技术术语或堆栈信息 |
| `content` | 纯文本片段，禁止包含 Markdown 格式控制符（由前端统一渲染） |
| `error_code` | 机器可读的错误码，如 `TOOL_EXECUTION_FAILED`、`MODEL_TIMEOUT`、`PERSISTENCE_ERROR` |

关键要求：

- 前端不再直接根据底层 `tool_executing` 决定是否展示任务进度。
- `text_delta` 必须尽量实时转发，不能在后端整轮缓存后批量发送；允许 50–100ms 的合并窗口以降低 WS 压力。
- `status` 文案应面向用户，而不是工具内部日志。

## 9. 前端展示原则

### 9.1 普通项目问答

展示：

- 用户消息立即出现。
- AI 占位立即出现。
- 正文流式输出。
- 必要时展示引用来源。

不展示：

- 读取项目上下文的内部步骤。
- 只读工具日志。
- “步骤 1/4”类内部执行过程。

### 9.2 明确读取文件

展示：

- “正在读取相关文件”
- 最终回答
- 文件来源

谨慎展示：

- 读取多个文件时可以显示简短状态，但不展开技术日志。

### 9.3 长任务和交付物生成

展示：

- 任务标题。
- 当前阶段。
- 生成物状态。
- 失败原因和可重试入口。

不展示：

- 每个底层工具调用的原始参数。
- 模型内部思考或 prompt。

### 9.4 高风险动作

展示：

- 明确确认卡片。
- 影响范围。
- 即将执行的动作。
- Confirm / Reject。

不允许：

- 模型一句话确认后直接执行。
- 前端确认后重新跑模型来“猜”原动作。

## 10. 与现有系统的关系

### 现有概念映射表

| 现有概念 | 归属 Harness | 调整方式 | 备注 |
|---------|------------|---------|------|
| `ChatMode` | Routing Harness | 抽象为 run display mode 的输入之一 | 保留枚举值，收敛判断逻辑 |
| `ActionPolicy` | Policy Harness | 收敛为副作用边界定义 | 与 ToolAccessPolicy 合并为统一策略 |
| `ToolAccessPolicy` | Policy Harness + Tool Harness | 工具可见性与权限判断合并 | 注册到 Harness 而非分散在前端 |
| `IntentRouter` | Routing Harness | 路由结果成为 AI Run 正式字段 | 增加 route decision 的持久化 |
| `HITAS`（Human-in-the-Loop Tool Approval）| Policy Harness + Persistence Harness | pending action → `confirmation_required` 事件 | 确认后执行冻结参数，不重新生成 tool call |
| `Consulting Turn Frame` | Context Harness | 纳入上下文构造逻辑 | 作为 system prompt 的一部分注入 |
| `Skill Router` | Routing Harness | Skill 触发判断归入路由层 | Skill 执行本身也生成 AI Run |
| `Task Orchestration` | Run Manager + Tool Harness | 长任务纳入统一 run lifecycle | 保留 durable task 能力 |
| `Project Memory` | Persistence Harness | 明确 memory candidate 的产生规则 | 只有显式值得沉淀的信息进入 memory |
| `Artifact Save` | Persistence Harness + Event Harness | 统一为 `artifact_ready` 事件 | 前端通过事件感知，而非轮询 |

### 10.1 对话系统

现有 `ChatMode`、`ActionPolicy`、`ToolAccessPolicy` 可以保留，作为 Harness 的 routing 和 policy 基础。

调整方向：

- 将一次请求包装为 AI Run。
- 将内部 phase event 转换为 Product Run Event。
- 普通问答默认 quiet display mode。

### 10.2 HITAS

HITAS 是 Policy Harness 和 Persistence Harness 的一部分。

保留原则：

- 待确认动作继续服务端持久化。
- 确认后继续执行冻结参数。
- 前端展示从 pending action 转换为 `confirmation_required` 产品事件。

### 10.3 Skill

Skill 是 Model 的专业能力包，不应该替代 Harness。

调整方向：

- Skill 决定专业工作流和输出标准。
- Harness 决定上下文、工具权限、执行状态和结果沉淀。
- Skill 执行也应生成 AI Run。

### 10.4 Project Memory

Project Memory 是长期状态，不是普通聊天上下文的副产品。

调整方向：

- 只有明确值得沉淀的信息进入 memory。
- AI Run 记录本轮是否产生 memory candidate。
- 用户可追踪 memory 来源和更新时间。

## 11. 分阶段落地

| Phase | 目标 | 预估工时 | 关键里程碑 | 成功标准 |
|-------|------|---------|-----------|---------|
| Phase 1 | 轻量 Harness 收口 | 2 人周 | Product Run Event v1 发布 | 异常率 < 1%，用户反馈正向 |
| Phase 2 | AI Run 数据模型 | 3 人周 | Run 状态可追踪、前端可恢复 | 排查问题不再依赖 message metadata |
| Phase 3 | Harness 标准化 | 4 人周 | 新工具接入成本降低 50% | 新增工具无需单独写前端展示逻辑 |
| Phase 4 | 高级 Harness 能力 | 视业务需求 | - | 有明确业务场景后再启动 |
| **合计** | | **9 人周 + 弹性** | | |

### Phase 1：轻量 Harness 收口

目标：解决当前项目对话体验问题，不做大重构。

范围：

- 定义 Product Run Event v1。
- 将普通问答的只读工具进度默认隐藏。
- 修复 LLM 文本事件后端缓存问题，实现真实 text delta。
- 前端基于 display mode 展示进度。
- 明确 streaming 状态与最终 message 替换规则。

预期收益：

- 用户立即看到稳定反馈。
- 普通问答不再展示“任务进度”。
- 文本看起来是真正逐步输出。
- 前端减少对底层 tool event 的依赖。

### Phase 1 过渡策略

- **事件双发**：Phase 1 期间，后端同时发送旧版 stream event 和 Product Run Event。
- **前端开关**：前端通过 feature flag 选择消费哪套事件，默认使用旧事件，按会话灰度切流。
- **回滚条件**：若 Product Run Event 导致对话异常率超过 1%（按 run 计数），自动切回旧事件。
- **完全下线**：Phase 2 开始前，确认所有前端场景已迁移，下线旧事件协议。

### Phase 2：AI Run 数据模型

目标：让每次 AI 执行可追踪、可审计、可恢复。

范围：

- 增加或抽象 `AIRun` / `ChatRun`。
- 保存 run status、display mode、route decision、policy、tool summary、artifact summary。
- 将 message、artifact、task、pending action 与 run 关联。
- 保留 internal trace 供开发和审计使用。

预期收益：

- 后续排查问题不再只靠 message metadata。
- 前端可以通过 run 状态恢复页面。
- 长任务和普通对话有统一执行底座。

### Phase 3：Tool / Context / Persistence Harness 标准化

目标：降低扩展新工具、新 Skill、新交付物的成本。

范围：

- 工具注册表标准化。
- 工具结果 schema 标准化。
- context builder 输出 schema 标准化。
- artifact 和 memory candidate 保存流程标准化。
- tool result 到 product event 的映射标准化。

预期收益：

- 新工具不需要单独写一套前端展示逻辑。
- 新 Skill 可以复用统一上下文和持久化能力。
- 失败处理更一致。

### Phase 4：高级 Harness 能力

目标：在业务复杂度增长后继续提升可靠性。

可能能力：

- run replay。
- evaluation。
- planner。
- multi-step durable workflow。
- 多模型路由。
- 成本和 token 预算控制。
- 更完整的 observability dashboard。

该阶段不建议立即启动，除非已有明确业务场景。

## 12. 风险与取舍

| 风险 | 说明 | 应对 |
|---|---|---|
| 一次性重构过大 | 容易影响现有对话和 Skill | 按 Phase 1 先收口事件和展示 |
| 前端与旧事件兼容复杂 | 当前已有多种 stream event | 新旧事件并行一段时间 |
| 过度展示进度 | 用户会看到系统内部噪音 | 引入 display mode |
| 过度隐藏过程 | 长任务缺少信任感 | 只在 task/confirmation 场景展示 |
| 数据模型提前设计过重 | 影响迭代速度 | Phase 2 再持久化 run |
| 工具结果 schema 不统一 | 后续扩展难 | Phase 3 标准化工具输出 |
| 高频流式事件压垮连接 | text_delta 在高并发下产生大量 WS 消息 | 引入 50–100ms 合并窗口，批量发送 delta |
| Trace 存储成本激增 | Internal Trace Event 数据量远大于 Product Event | Trace 保留 7 天，仅采样 10% 长期持久化 |

## 13. 建议的近期决策

建议现在确认以下产品决策：

1. 普通项目问答默认不展示底层工具进度。
2. 只有长任务、交付物生成、明确文件读取和用户确认展示进度。
3. 前端展示基于 Product Run Event，不直接依赖 raw tool call。
4. 模型文本必须尽量真实流式输出。
5. 所有会产生副作用的动作必须通过 Policy Harness 和 HITAS。
6. Harness 先以 AI Run v1 的方式收口，不立即建设完整 Agent 平台。

## 14. 第一版验收标准

AI Run Harness v1 完成后，至少满足：

- 用户发送消息后，用户消息和 AI 状态立即出现。
- 普通问答不会展示“步骤 1/4”或只读工具日志。
- 文本回复逐段显示，而不是整段突然出现。
- 文件读取场景可以展示简短、可理解的读取状态。
- 交付物生成有任务进度和 artifact ready 事件。
- 高风险修改或删除动作进入确认流程。
- run 完成后 streaming 气泡稳定替换为持久化 assistant message。
- 开发者仍可在 trace 中看到底层工具和执行日志。

## 15. 总结

AriaAI 当前不需要立刻建设复杂 Agent 平台，但需要从现在开始引入 Harness 边界。正确路径是：

```text
先统一 AI Run lifecycle
  ↓
再统一 Product Run Event
  ↓
再统一 Tool / Context / Persistence Harness
  ↓
最后根据业务复杂度引入高级 Agent 能力
```

这条路径可以在不推倒现有系统的前提下，逐步把 AriaAI 从“能聊天的项目系统”升级为“可控、可沉淀、可审计的项目 AI 工作台”。
