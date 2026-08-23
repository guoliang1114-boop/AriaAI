# Model + Harness 产品方案设计

> 更新日期：2026-08-23
> 关联文档：[05-对话系统设计与规范](./05-对话系统设计与规范.md)、[06-HITAS设计](./06-Human-in-the-Loop%20Tool%20Approval%20设计.md)、[08-Skill体系评估与优化路线图](./08-Skill体系评估与优化路线图.md)、[10-代码Review遗留事项](./10-代码Review遗留事项.md)

## 目录

- [1. 文档定位](#1-文档定位)
  - [1.1 产品定调：咨询交付 Agent 系统](#11-产品定调咨询交付-agent-系统)
  - [1.2 Agent 工作循环](#12-agent-工作循环)
  - [1.3 六层产品方针](#13-六层产品方针)
  - [1.4 不做通用 Agent 开发平台](#14-不做通用-agent-开发平台)
- [2. 为什么现在引入（含现状核实）](#2-为什么现在引入含现状核实)
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
  - [7.2 失败恢复策略](#72-失败恢复策略)
  - [7.3 Display Mode](#73-display-mode)
- [8. Product Run Event 协议](#8-product-run-event-协议)
- [9. 前端展示原则](#9-前端展示原则)
  - [9.1 普通项目问答](#91-普通项目问答)
  - [9.2 明确读取文件](#92-明确读取文件)
  - [9.3 长任务和交付物生成](#93-长任务和交付物生成)
  - [9.4 高风险动作](#94-高风险动作)
  - [9.5 Run Activity Timeline（Phase 1 UI 落地）](#95-run-activity-timelinephase-1-ui-落地)
- [10. 与现有系统的关系](#10-与现有系统的关系)
- [11. 分阶段落地](#11-分阶段落地)
- [12. 风险与取舍](#12-风险与取舍)
- [13. 建议的近期决策](#13-建议的近期决策)
- [14. 第一版验收标准](#14-第一版验收标准)
- [15. 总结](#15-总结)

## 1. 文档定位

本文描述 AriaAI 在产品层面引入 Model + Harness 的设计方案。目标不是立即重构为完整 Agent 平台，而是把现有项目对话、Skill、工具调用、项目记忆、交付物生成和用户确认机制收敛为一套稳定的 AI Run Harness，并在 Phase 1 给出可落地的 UI（项目对话 Run Activity Timeline）。

核心判断：

- Model 负责理解、生成、推理和规划。
- Harness 负责上下文、工具、权限、状态、执行、持久化、展示和失败处理。
- 用户感知到的 AI 可靠性主要来自 Harness，而不只来自模型能力。

当前 AriaAI 已有 Harness 雏形，包括对话 runtime、context builder、tool executor、HITAS、task orchestration、project memory、stream events 和 artifact 保存。但这些能力仍比较分散，部分内部日志和底层 tool event 会直接暴露给前端，导致产品体验不稳定。

### 1.1 产品定调：咨询交付 Agent 系统

从 Agent 产品演进趋势看，Messages API、Agent SDK 和 Managed Agents 会逐步把底层 agent loop、tool runtime、session checkpoint、auth、observability 和 hosting 平台化。AriaAI 不应把这些底层能力本身当成长期差异化，而应把它们作为可替换的运行基础。

AriaAI 的产品定调是：

> AriaAI 是面向专业咨询顾问的 Agentic Workspace。它不是通用 Agent 开发平台，也不是单纯 AI 聊天工具，而是把客户、项目、知识、Skill、交付物和记忆组织成一套可追踪、可复用、可沉淀的咨询交付 Agent 系统。

这个定调意味着：

- 用户不是来“搭 Agent”，而是来完成咨询工作。
- Aria 的 Agent 不是一个通用机器人，而是一套围绕客户关系和项目交付运转的工作系统。
- 底层模型、Agent SDK 或 Managed Agent 服务可以逐步替换，但 Aria 必须保留业务上下文、咨询方法论、交付物标准、权限边界和用户体验。
- 产品价值不来自“单次回复更聪明”，而来自“越用越懂客户、越用越沉淀团队经验、越用越能稳定交付”。

### 1.2 Agent 工作循环

Aria 的 Agent 工作不应被定义为一次聊天回复，而应被定义为一次可追踪的咨询工作循环：

```text
目标 → 上下文 → 计划 → 工具执行 → 交付物 → 记忆沉淀 → 下一步行动
```

| 环节 | 产品含义 | 典型对象 |
|---|---|---|
| 目标 | 用户到底要完成什么咨询任务 | 会前准备、风险分析、方案建议、交付物生成 |
| 上下文 | AI 本轮需要理解的业务事实和历史经验 | 项目记忆、客户记忆、联系人、知识库、文件、聊天历史 |
| 计划 | 将用户目标拆成可执行步骤 | Run Plan、Skill Steps、Tool Plan |
| 工具执行 | 读取、生成、保存、修改或等待确认 | read tool、write artifact、HITAS、task orchestrator |
| 交付物 | 用户真正拿走或复用的成果 | Markdown、PPT、Word、任务、简报、项目笔记 |
| 记忆沉淀 | 把有价值的过程和结论回流为上下文资产 | 项目记忆、客户记忆、用户偏好、知识案例 |
| 下一步行动 | 把洞察转成推进动作 | 待办、风险提醒、会议议程、客户跟进建议 |

这个循环是 Harness 的产品边界。Run Manager 不只是技术状态机，而是承载“咨询工作是否完成”的产品状态机。

### 1.3 六层产品方针

后续产品建设应围绕六层方针展开。

#### 1.3.1 Harness / Run 运行层

目标：让每一次 AI 工作可追踪、可恢复、可审计。

需要统一的核心对象：

| 对象 | 作用 |
|---|---|
| `Run` | 一次用户目标驱动的完整 AI 工作 |
| `Step` | Run 内部面向用户可理解的阶段 |
| `Tool` | 具体能力调用，包含 read/write/modify/destructive 分类 |
| `Artifact` | Run 生成或更新的交付物 |
| `Memory Update` | Run 产生的候选记忆或记忆刷新动作 |
| `Approval` | 高风险动作的人类确认 |
| `Trace` | 面向审计和调试的内部执行记录 |

设计要求：

- 普通问答也创建轻量 Run，但不展示复杂进度。
- 长任务、Skill、文件生成和修改类动作必须进入完整 Run。
- Run 结束时必须有明确状态：`completed`、`failed`、`cancelled` 或 `waiting_confirmation`。
- 前端展示 Product Run Event，内部调试保留 Trace Event。

#### 1.3.2 咨询 Skill 交付层

目标：把 Skill 从提示词能力升级为交付物能力。

每个核心咨询 Skill 必须明确：

| 维度 | 必须说明 |
|---|---|
| 使用场景 | 什么咨询任务应使用该 Skill |
| 输入资料 | 需要项目、客户、知识库、文件或用户补充哪些信息 |
| 分析逻辑 | 使用什么框架、判断路径、风险假设 |
| 交付物 | 输出 Markdown、PPT、Word、表格、清单还是行动建议 |
| 验证清单 | 如何判断交付物是否达标 |
| 沉淀位置 | 结果应保存到项目文档、项目笔记、客户记忆或知识库 |
| 失败处理 | 信息不足时如何提问、降级或给出待补资料 |

产品上，Skill 不应只是“生成一段话”，而应成为咨询团队可复用的交付物生产线。

#### 1.3.3 记忆与知识库层

目标：形成 Aria 的组织上下文壁垒。

Aria 需要区分六类上下文：

| 类型 | 作用 | 是否作为事实依据 |
|---|---|---|
| 用户记忆 | 偏好、称呼、表达风格、工作习惯 | 否，主要影响体验和表达 |
| 项目记忆 | 当前项目阶段、目标、风险、进展、交付状态 | 是 |
| 客户记忆 | 跨项目客户关系、决策模式、历史经验 | 是 |
| 联系人记忆 | 干系人角色、影响力、沟通偏好和风险信号 | 是 |
| 知识库 | 团队方法论、案例、模板、客户资料、历史交付 | 是，必须有来源 |
| 运行记忆 | 当前 Run 的计划、步骤、临时发现和候选结论 | 临时，仅经确认后沉淀 |

设计要求：

- 知识可以成为记忆来源，但不能自动污染记忆。
- 记忆更新应保留来源、时间、触发动作和可回滚路径。
- 项目对话、会前准备、Skill 和交付物生成应消费同一套上下文层，而不是各自拼 prompt。
- 权限边界必须早于检索和注入，避免跨客户、跨项目泄露。

#### 1.3.4 交付物工作流层

目标：从“回答用户”升级为“完成交付”。

典型工作流应从单次文本回复升级为结构化产出：

| 用户目标 | 应产出 |
|---|---|
| 会前准备 | 会前简报、关键人画像、会议议程、风险提醒、待确认问题 |
| 方案建议 | 目标定义、现状判断、方案路径、收益假设、风险与下一步 |
| 项目复盘 | 成功经验、踩坑、客户偏好、可复用模板、后续机会 |
| 风险分析 | 风险清单、影响评估、证据来源、缓解动作、责任人 |
| 交付物生成 | PPT/Word 大纲、可下载文档、保存位置、版本说明 |

设计要求：

- 交付物必须能保存为项目资产。
- 交付物应可关联来源、上下文版本和生成 Run。
- 交付物生成后应给出“建议沉淀位置”和“下一步行动”。
- 对复杂交付物，应支持先出大纲，再确认，再生成正式版本。

#### 1.3.5 质量与可控性层

目标：让 Agent 可靠，而不是只显得聪明。

必须补足的质量机制：

| 机制 | 作用 |
|---|---|
| 引用来源 | 让用户知道结论来自哪里 |
| 执行日志 | 让复杂任务可追踪，但不污染普通问答 UI |
| HITAS | 修改、删除、写入和高风险动作必须人类确认 |
| 失败恢复 | 流断、工具失败、保存失败时能恢复或说明 |
| 回滚 | 重要写入和记忆更新可回退 |
| 交付物 QA | 对 PPT/Word/报告进行结构、事实、格式和风险语言检查 |
| 评测集 | 用固定案例测试 Skill、RAG、记忆和 Run 表现 |
| Partner Review | 对重要咨询交付物进行红队审查或高阶复核 |

质量机制不是后台工程附属品，而是 Agent 产品体验的一部分。用户愿不愿意把真实工作交给 Aria，取决于它是否可解释、可恢复、可确认。

#### 1.3.6 产品形态层

目标：少配置，多完成工作。

Aria 不应把核心入口设计成“创建 Agent / 配置工具 / 写系统提示词”。更适合的形态是：

- 默认内置高质量咨询 Skill 和工作流。
- 用户从项目、客户、联系人、知识库或会前场景自然发起。
- 系统自动带入上下文、判断模式、选择工具和提示需要补足的资料。
- 输出可直接复制、下载、保存或继续推进。
- 复杂动作展示进度，普通问答保持安静。

这意味着 Aria 可以有 Agent 技术底座，但产品上要像专业顾问工作台，而不是开发者 Agent 平台。

### 1.4 不做通用 Agent 开发平台

短期内 Aria 不做以下方向：

- 不开放给用户从零配置通用 Agent。
- 不把 MCP、工具市场、模型路由作为普通用户主入口。
- 不追求多 Agent 自动协同的炫技体验。
- 不把底层 trace 和工具日志暴露成默认产品界面。
- 不为了兼容外部 Agent 平台牺牲咨询方法论、客户上下文和交付物标准。

Aria 可以在底层吸收 Agent SDK、Managed Agents 或自研 Harness 的成熟能力，但产品重心始终是咨询交付。

## 2. 为什么现在引入（含现状核实）

近期项目对话暴露出的几个问题，本质上都是 Harness 问题：

| 现象 | 本质原因 |
|---|---|
| 普通问答下展示"任务进度" | 底层工具调用事件直接映射到用户界面 |
| "AI 正在读取"出现后很快消失 | 前端状态与真实 run lifecycle 没有统一协议 |
| 回复看起来不是流式输出 | 后端内部收集 LLM chunk 后再统一发送 |
| Markdown、表格和工具日志混在一起 | assistant content、tool summary、run progress 边界不清 |
| 生成物、记忆、任务、消息保存逻辑分散 | 缺少统一的 run persistence contract |

### 2.1 现状核实（项目对话场景，已逐条核对代码）

| 场景 | 当前呈现 | 缺陷 | 代码锚点 |
|---|---|---|---|
| 普通工具回合 | 实时工具卡 + 思考转圈 | 工具卡零散堆叠，无"第几步"结构 | [`ProjectChatMessages.tsx`](../web/src/pages/projects/ProjectChatMessages.tsx)、[`ProjectChatToolCallCard.tsx`](../web/src/pages/projects/ProjectChatToolCallCard.tsx) |
| 调用 Skill | 项目对话**完全不显示**用了哪个 Skill、也没有 Skill 步骤 | 漂亮的 5 步 `skill_progress` 只在独立聊天页渲染 | [`Chat.tsx`](../web/src/pages/chat/Chat.tsx)（`metadata.skill_progress`）；项目对话无对应消费者 |
| 复杂/后台任务 | 对话仅显示"已转入后台,任务记录 #X" | 真实 4 步（收集上下文→生成大纲→生成保存→整理交付）只在「任务」面板，需跳出去看 | [`useProjectChatComposer.ts`](../web/src/pages/projects/useProjectChatComposer.ts)（"已转入后台执行"）、`task_orchestrator.py` |
| 步骤边界 | 后端发的 `agent_step` 被前端丢弃 | `streamingSteps` / `upsertStep` / `AgentStepView` 全是死代码 | [`chatStreamStore.ts`](../web/src/stores/chatStreamStore.ts)、[`agent_loop.py`](../backend/app/services/chat/agent_loop.py) `build_agent_step_event` |
| PPT 与对话大纲无关 | 凡说"ppt"被规则路由器丢给 `generate_client_ppt` 流水线 | 流水线无视对话大纲；本轮已修：引用大纲时改走对话模型 | [`intent_router.py`](../backend/app/services/intent_router.py)（`rule:pptx_from_prior_outline`） |

这些**都不是模型问题**，而是 Harness 边界不清的体现：底层事件直接到 UI、无统一 run 生命周期、Skill 身份/步骤未作为产品级信号、不同流水线各自维护自己的进度。

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
- Skill 调用时清晰展示"用的哪个 Skill + 每一步"。
- 危险或不可逆动作必须明确确认。
- AI 输出可以沉淀为消息、项目记忆、任务、文件或交付物。
- 失败时给出可理解的结果，而不是中断在内部状态。

### 3.2 工程目标

- 统一一次 AI 执行的生命周期。
- 统一后端到前端的 run event 协议。
- 统一上下文构造、工具执行、权限判断和结果持久化边界。
- 将 UI 从底层 tool call 中解耦。
- 流式输出与持久化消息使用同一套渲染逻辑（避免直播/刷新差异）。
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
  ├── Run Activity Timeline (§9.5)
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
- 流式与持久化共享同一渲染数据模型（§9.5）。

## 6. Harness 分层设计

### 6.1 Context Harness

职责：

- 统一项目上下文构造。
- 控制模型每轮能看到哪些内容。
- 区分自动注入上下文和按需读取上下文。
- 避免模型为了普通问答频繁调用只读工具。

输入：user message / project id / conversation id / selected skill / mention context / knowledge scope / recent history。

输出：structured project context / selected files or memory snippets / prompt context block / context trace。

设计原则：

- 普通项目问答优先使用已注入上下文。
- 用户明确提到文件、文档、空间内容时，才进入 read-on-demand。
- Context Harness 不负责 UI 展示，只负责"模型看到什么"。

### 6.2 Routing Harness

职责：

- 决定本轮属于普通问答、项目深潜、Skill 执行、文件处理、交付物生成或长任务。
- 输出 mode、action policy、tool access policy。
- 限制模型不能自行升级权限。

当前基础：`ChatMode` / `ActionPolicy` / `ToolAccessPolicy` / `IntentRouter` / `Consulting Turn Frame`。

后续收敛方向：

- 路由结果成为 AI Run 的正式字段。
- 前端展示不直接依赖 route 细节，只消费 run display mode。
- 已实现的"引用大纲→对话模型"路由（`rule:pptx_from_prior_outline`）是这套思路的早期落地。

### 6.3 Tool Harness

职责：

- 统一工具注册、参数校验、权限判断和执行结果。
- 将底层 tool call 转换为产品事件。
- 区分 read-only、write artifact、modify existing、destructive action。

设计原则：

- 只读工具默认不在普通问答中展示为"任务进度"。
- 写入、新建、修改、删除类工具可以展示产品级进度。
- 需要确认的工具必须进入 HITAS，而不是依赖模型复述确认。
- 工具执行失败要返回可保存、可展示的失败结果。

### 6.4 Policy Harness

职责：

- 定义副作用边界。
- 控制工具可见性。
- 控制是否需要用户确认。
- 保护项目、客户、用户权限范围。

设计原则：默认从严；读写分离；修改和删除必须可审计；用户确认后执行冻结参数，不重新让模型生成工具调用。

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

1. Internal Trace Event：用于调试、审计、回放（保留现有 `tool_executing` / `tool_result` / `agent_step` / `task_run` 等作为内部信号）。
2. Product Run Event：用于前端展示（§8）。

前端默认只消费 Product Run Event。

### 6.7 Run Manager

职责：

- 持有 AI Run 状态机（`created` → `preparing` → ... → `completed`/`failed`）。
- 协调各 Harness 的执行顺序：Context → Routing → Model → Tool → Persistence → Event。
- 处理异常中断和状态回滚。
- 管理 run 级别的超时和取消。
- 通过 `POST /chat/runs/{run_id}/cancel` 在复检 Conversation 写权限后取消活动 Turn；浏览器断流不是业务取消的唯一信号。
- 为普通聊天统一管理单轮 Step、计划工具调用总数和墙钟预算；模型流、重试等待与工具批次共享同一个停止边界。
- 预算超限以 `TURN_BUDGET_EXCEEDED` 失败终态收口，保存部分结果和预算快照，不自动重放可能已有副作用的工具。
- 在持久化与成功终态之间运行确定性完成证据裁决；只有交付物、工具、策略、审批、Step 与输出完整性检查通过，Run 才能进入 `completed`。
- 将版本化 `run_evaluation` 保存到 Assistant Message 与 Run Rollout；失败时发送 `RUN_EVALUATION_FAILED`，不再同时发送成功终态。

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

### 7.2 失败恢复策略

| 失败阶段 | 用户感知 | 恢复方式 | 数据一致性 |
|---------|---------|---------|-----------|
| `preparing` | "生成失败，请重试" | 用户重新发送消息，创建新 run | 无 side effect |
| `generating` | 文本截断，显示"生成中断" | 保存部分回复和中断标记；新 Run 可基于历史继续 | 保存 `cancelled` message/step/run 边界，不盲目重放工具 |
| `running_tool` | 展示工具失败原因 | 若工具支持幂等，自动重试 1 次；否则进入 `failed` | 已执行的写入操作不自动回滚 |
| `turn_budget` | 展示达到步数、工具调用或总时长上限 | 保存部分结果；用户发起新 Run 继续 | 新批次不执行；工具超时可能已部分生效，先核对事实且不自动重放 |
| `completion_evaluation` | 展示本轮未达到可验证完成状态 | 保存当前回复和有界 Finding；依据主错误码发起新 Run 修复 | 原结果不回滚；失败 Run 不发送 `run_done(completed)` |
| `persisting` | "保存结果失败" | 保留 trace，开发者手动修复 | 内部标记为 `persist_failed`，人工介入 |

关键原则：失败时必须给用户可理解的状态，而不是空白或无限 loading。

### 7.3 Display Mode

同一个 run status 在不同场景下展示方式不同。

| display mode | 场景 | 展示策略 |
|---|---|---|
| `quiet` | 普通问答 | 只展示输入中、正在生成、正文流式输出（无活动时间线） |
| `contextual` | 明确读文件或检索资料 | 展示精简版活动时间线："正在读取相关资料" + 文件列表 |
| `task` | 长任务或交付物生成 | 展示完整活动时间线（步骤、子工具、进度、交付物） |
| `skill` | Skill 执行 | 在活动时间线顶部展示 Skill 身份横幅 |
| `confirmation` | 需要用户确认 | 展示确认卡片 |
| `debug` | 开发或内部审计 | 展示完整 tool trace（普通用户默认不进入） |

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

第一版事件：

| event type | 用途 | 必填字段 | 选填字段 | 字段约束 |
|---|---|---|---|---|
| `run_started` | run 已开始，前端立即进入 loading | `run_id`, `timestamp` | `display_mode`, `skill` | `display_mode` 必须在 run 创建时提供；`skill` = `{name, id?}`，存在则 UI 渲染 Skill 横幅 |
| `status` | 产品级状态文案 | `run_id`, `message` | `display_mode`, `progress` | `message` 长度 ≤ 50 字，面向用户 |
| `text_delta` | 模型文本增量 | `run_id`, `content` | - | `content` 为 UTF-8 文本片段，禁止在后端批量缓存后发送 |
| `reference_delta` | 资料来源增量 | `run_id`, `source` | `url`, `title` | `source` 为文件/文档标识符 |
| `step_started` | 一个时间线步骤开始 | `run_id`, `step_index`, `title` | `step_total` | 对应一轮"LLM→工具"或一个 task 阶段 |
| `step_completed` | 步骤完成 | `run_id`, `step_index`, `status`, `duration_ms` | `truncated` | 对应内部 `agent_step` |
| `tool_progress` | 可展示工具进度 | `run_id`, `step_index`, `title`, `status` | `detail`, `progress` | `status` 枚举：`pending`, `running`, `completed`, `failed`；归属于当前步骤 |
| `task_update` | 长任务进度更新 | `run_id`, `task_id`, `status` | `progress_pct`, `current_step`, `total_steps`, `step_title` | `progress_pct` 为 0–100 整数；在 `task` mode 下作为时间线步骤渲染 |
| `confirmation_required` | 需要用户确认 | `run_id`, `action`, `impact` | `params_snapshot`, `deadline` | `action` 必须人类可读，`params_snapshot` 用于确认后冻结执行 |
| `artifact_ready` | 交付物可用 | `run_id`, `artifact_id`, `artifact_type` | `download_url`, `preview_url`, `source_tool` | `artifact_type` 枚举：`pptx`, `docx`, `xlsx`, `pdf`, `markdown`；`source_tool` 来自 Tool Capability Manifest 映射 |
| `message_persisted` | assistant message 已保存 | `run_id`, `message_id` | `parent_run_id` | 用于 streaming 气泡替换为持久化消息 |
| `run_done` | run 完成 | `run_id`, `final_status` | `message_id`, `artifact_ids` | `final_status` 必须与 run status 一致 |
| `run_failed` | run 失败 | `run_id`, `error_code`, `error_message` | `retryable`, `fallback_content` | `error_message` 面向用户，禁止暴露内部堆栈 |

示例：

```json
{ "type": "run_started", "run_id": "run_123", "display_mode": "skill",
  "skill": { "name": "数字化战略", "id": "digital-strategy" } }
```

```json
{ "type": "step_started", "run_id": "run_123", "step_index": 1,
  "step_total": 3, "title": "读取项目资料" }
```

```json
{ "type": "tool_progress", "run_id": "run_123", "step_index": 1,
  "title": "读取项目文档", "status": "running" }
```

```json
{ "type": "step_completed", "run_id": "run_123", "step_index": 1,
  "status": "completed", "duration_ms": 230 }
```

```json
{ "type": "text_delta", "run_id": "run_123", "content": "这里是对项目风险的总结：" }
```

### Event 字段约束

| 约束项 | 规则 |
|--------|------|
| `run_id` | 全局唯一，格式 `run_{uuid}`，贯穿同一次 AI Run 的全部事件 |
| `timestamp` | ISO 8601 格式，精确到毫秒，用于事件排序和时序分析 |
| `display_mode` | 与 run 的 display mode 一致，前端据此选择展示组件 |
| `step_index` | 单调递增，1 起算；`tool_progress` / `step_completed` 的 `step_index` 必须先有对应 `step_started` |
| `message` | 面向最终用户的中文文案，禁止包含内部技术术语或堆栈信息 |
| `content` | 纯文本片段，禁止包含 Markdown 格式控制符（由前端统一渲染） |
| `error_code` | 机器可读的错误码，如 `TOOL_EXECUTION_FAILED`、`MODEL_TIMEOUT`、`PERSISTENCE_ERROR`、`TURN_BUDGET_EXCEEDED`、`RUN_EVALUATION_FAILED` |

关键要求：

- 前端不再直接根据底层 `tool_executing` 决定是否展示任务进度。
- `text_delta` 必须尽量实时转发，不能在后端整轮缓存后批量发送；允许 50–100ms 的合并窗口以降低 WS 压力。
- `status` / `tool_progress.title` 文案应面向用户，而不是工具内部日志。

### 内部事件 → Product Run Event 映射

Event Harness 在 Phase 1 负责把现有内部事件映射为 Product Run Event：

| 内部事件 | 映射到 Product Run Event |
|---|---|
| 流开始 + `runtime.skill_name` | `run_started`（带 `skill`） |
| `status` | `status`（按 display_mode 过滤） |
| LLM text chunk | `text_delta` |
| 进入一个新工具轮 | `step_started` |
| `tool_executing` | `tool_progress` (status=running) |
| `tool_result` | `tool_progress` (status=completed/failed) |
| `agent_step` | `step_completed` |
| `task_run` 更新 | `task_update` |
| HITAS pending action | `confirmation_required` |
| artifact 持久化 | `artifact_ready` |
| persist 完成 | `message_persisted` → `run_done` |
| 异常 | `run_failed` |

## 9. 前端展示原则

### 9.1 普通项目问答

展示：用户消息立即出现；AI 占位立即出现；正文流式输出；必要时展示引用来源。

不展示：读取项目上下文的内部步骤；只读工具日志；"步骤 1/4"类内部执行过程。

### 9.2 明确读取文件

展示：精简版活动时间线（"正在读取相关文件" + 文件名）；最终回答；文件来源。

谨慎展示：读取多个文件时可以显示简短状态，但不展开技术日志。

### 9.3 长任务和交付物生成

展示：任务标题；当前阶段（活动时间线 task mode）；生成物状态；失败原因和可重试入口。

不展示：每个底层工具调用的原始参数；模型内部思考或 prompt。

### 9.4 高风险动作

展示：明确确认卡片；影响范围；即将执行的动作；Confirm / Reject。

不允许：模型一句话确认后直接执行；前端确认后重新跑模型来"猜"原动作。

### 9.5 Run Activity Timeline（Phase 1 UI 落地）

> 这是 §9.1–9.4 各 display mode（除 `quiet` 外）共用的核心 UI 组件，也是 Phase 1 的主要交付。
> 设计来源：与本设计一同评审的"项目对话活动时间线"草案。

#### 9.5.1 数据模型

流式与持久化共用：

```ts
type ActivityStatus = "pending" | "running" | "completed" | "error" | "confirmation_required";

interface ActivityItem {        // 时间线里的一个"工具/子动作"
  tool_name: string;            // 显示名（复用 readableToolName）
  status: ActivityStatus;
  message?: string;
  details?: string[];
  artifact?: GeneratedArtifact;
}

interface ActivityStep {        // 一个步骤
  index: number;
  title: string;
  status: ActivityStatus;
  duration_ms?: number;
  items: ActivityItem[];
  truncated?: boolean;
}

interface ActivityTimeline {
  skill?: { name: string; id?: string };    // 顶部 Skill 横幅
  steps: ActivityStep[];
  artifacts: GeneratedArtifact[];
  display_mode: "contextual" | "task" | "skill" | "confirmation";
  kind: "chat" | "durable_task";
}
```

#### 9.5.2 Product Run Event → Timeline 映射

| Event | 时间线变更 |
|---|---|
| `run_started.skill` | 设 `timeline.skill` 横幅 |
| `step_started` | 在 `timeline.steps` 末尾 push 一个 step（status=running） |
| `tool_progress` | upsert 到当前 step 的 `items`（同 `tool_name` 合并） |
| `step_completed` | 把对应 step 状态置 completed/error，写入 `duration_ms` |
| `task_update` | 在 `task` mode 下：把 TaskRun 的 step 同步进 `steps`（按 `task.steps`） |
| `confirmation_required` | 当前 step 末尾追加一个 `confirmation_required` 状态的 item |
| `artifact_ready` | push 到 `timeline.artifacts` |

#### 9.5.3 组件结构

```text
ProjectChatActivityTimeline({ timeline, ... })
├── SkillBanner(timeline.skill)            // 有 skill 才渲染
├── steps.map(ActivityStepRow)             // 抽取自 ProjectChatToolCallCard
│     └── items.map(ActivityItemRow)
└── artifacts.map(ProjectChatArtifactCard) // 已有组件
```

复用现有 `ProjectChatToolCallCard` 的视觉（它已支持 step 形态），抽出"步骤 + 子项分组"容器即可，不重造样式。`ChatStreamingMessage`（流式）和 `ProjectChatMessageBubble`（持久化）都改为：正文 + `<ProjectChatActivityTimeline timeline={...} />`。

#### 9.5.4 ASCII 示意

```text
🟦 Aria
┌ Skill：数字化战略 ───────────────────────┐   ← 仅 skill 激活时
└──────────────────────────────────────────┘
（正文 markdown 流式渲染中…▌）

活动 ▾                                        ← 可折叠
 ① 读取上下文          ✓ 0.2s
 ② 执行工具            ⟳ 进行中
     • 读取项目文件     ✓
     • 读取项目文档     ⟳ 正在读取…
 ③ 整理结果            · 待

📎 广州岭南…方案.pptx        [下载] [查看]
```

#### 9.5.5 默认折叠策略

- 进行中（`running`）：默认展开当前步骤；其他步骤折叠为单行摘要。
- 完成后（`completed`/`failed`）：默认折叠为单行摘要（"✓ 3 步 · 已生成 X.pptx"），用户可点开复盘。
- 完成后**保留**完整时间线（可折叠），用于后续追溯；不丢弃。

## 10. 与现有系统的关系

### 现有概念映射表

| 现有概念 | 归属 Harness | 调整方式 | 备注 |
|---------|------------|---------|------|
| `ChatMode` | Routing Harness | 抽象为 run display mode 的输入之一 | 保留枚举值，收敛判断逻辑 |
| `ActionPolicy` | Policy Harness | 收敛为副作用边界定义 | 与 ToolAccessPolicy 合并为统一策略 |
| `ToolAccessPolicy` | Policy Harness + Tool Harness | 工具可见性与权限判断合并 | 注册到 Harness 而非分散在前端 |
| `IntentRouter` | Routing Harness | 路由结果成为 AI Run 正式字段 | 增加 route decision 的持久化 |
| `HITAS` | Policy Harness + Persistence Harness | pending action → `confirmation_required` 事件 | 确认后执行冻结参数，不重新生成 tool call |
| `Consulting Turn Frame` | Context Harness | 纳入上下文构造逻辑 | 作为 system prompt 的一部分注入 |
| `Skill Router` | Routing Harness | Skill 触发判断归入路由层 | Skill 执行本身也生成 AI Run |
| `Task Orchestration` | Run Manager + Tool Harness | 长任务纳入统一 run lifecycle | 保留 durable task 能力；进度通过 `task_update` 进同一时间线 |
| `Project Memory` | Persistence Harness | 明确 memory candidate 的产生规则 | 只有显式值得沉淀的信息进入 memory |
| `Artifact Save` | Persistence Harness + Event Harness | 统一为 `artifact_ready` 事件 | 前端通过事件感知，而非轮询 |
| `agent_step` 内部事件 | Event Harness | 映射为 `step_completed` | 不再被前端直接消费 |
| `metadata.skill_progress`（独立聊天页用） | Event Harness | 重构为 Run Activity Timeline 持久化形态 | 项目对话首次获得 Skill 步骤视图 |

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
- Skill 执行也应生成 AI Run，并在前端通过 Run Activity Timeline 的 Skill 横幅显式露出。

### 10.4 Project Memory

Project Memory 是长期状态，不是普通聊天上下文的副产品。

调整方向：

- 只有明确值得沉淀的信息进入 memory。
- AI Run 记录本轮是否产生 memory candidate。
- 用户可追踪 memory 来源和更新时间。

## 11. 分阶段落地

| Phase | 目标 | 预估工时 | 关键里程碑 | 成功标准 |
|-------|------|---------|-----------|---------|
| Phase 1 | 轻量 Harness 收口 + Run Activity Timeline | 2 人周 | Product Run Event v1 发布 + 项目对话时间线上线 | 异常率 < 1%，普通问答无内部进度；Skill/长任务有真实可读步骤 |
| Phase 2 | AI Run 数据模型 | 3 人周 | Run 状态可追踪、前端可恢复 | 排查问题不再依赖 message metadata |
| Phase 3 | Harness 标准化 | 4 人周 | 新工具接入成本降低 50% | 新增工具无需单独写前端展示逻辑 |
| Phase 4 | 高级 Harness 能力 | 视业务需求 | - | 有明确业务场景后再启动 |
| **合计** | | **9 人周 + 弹性** | | |

### Phase 1：轻量 Harness 收口 + Run Activity Timeline

目标：解决当前项目对话体验问题，不做大重构。Phase 1 的可见交付就是 §9.5 的 Run Activity Timeline。

范围（按子阶段）：

- **1a Event 协议 + 时间线骨架 + Skill 身份**
  - 后端：定义 Product Run Event v1（§8）；Event Harness 把现有内部事件映射为产品事件；运行时把 `runtime.skill_name` 通过 `run_started.skill` 发出。
  - 前端：接 `step_started`/`tool_progress`/`step_completed`/`run_started` → `streamingSteps`（接替当前死代码）；新增 `buildActivityTimeline()` 规范化；新增 `ProjectChatActivityTimeline` 组件；流式与持久化都切到新组件。
- **1b 后台任务进度内联**
  - 把 `task_update` 灌进同一时间线（kind="durable_task"），复杂任务在对话里直接看 4 步 + 最终文件；面板保留为详情入口。
- **1c PPT 生成方式可见/可选**
  - 轻量提示/开关："按我的大纲" / "自动生成项目 PPT"，与已有的 `rule:pptx_from_prior_outline` 路由衔接。

预期收益：

- 用户立即看到稳定反馈。
- 普通问答不再展示"任务进度"。
- 文本看起来是真正逐步输出（本轮 `_consume_stream` 已改为真流式，Phase 1 完成 UI 闭环）。
- Skill 调用首次在项目对话里有清晰的身份与步骤呈现。
- 复杂任务无需跳到任务面板看进度。

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

当前进展（2026-08-23）：前三批已经落地。第一批统一 `ToolExecutionRecord v1`（版本、调用 ID、status、outcome、终态、摘要、错误、重试与耗时），Rollout、Evaluation、Persist 和前端 Store 共用该契约；原始工具输入/输出不进入长期台账，超限时保留最近记录并显式报告省略数。第二批统一 `ToolCapabilityManifest v1`：17 个现有工具的权限、副作用、并行、重试、项目作用域、结果类型、展示名和 Product Run Event 进入一个注册事实源，未知工具失败关闭，Artifact Ready 事件保留来源工具。第三批统一 `Context Assembly Manifest v1`：Skill、项目/客户、RAG、工作记忆、工具历史、意图与 Turn Contract、用户偏好、会话历史和工具目录拥有稳定来源身份，最终 Provider 请求与预算清单绑定，Trace、Rollout、Evaluation 共享同一份无原文 Manifest。后续继续推进 artifact / memory candidate 保存流程。

范围：

- 工具注册表标准化。（首批已完成）
- 工具结果 schema 标准化。（首批已完成）
- context builder 输出 schema 标准化。（第三批已完成）
- artifact 和 memory candidate 保存流程标准化。
- tool result 到 product event 的映射标准化。（Artifact / Tool Progress 首批已完成）

预期收益：

- 新工具不需要单独写一套前端展示逻辑。
- 新 Skill 可以复用统一上下文和持久化能力。
- 失败处理更一致。

### Phase 4：高级 Harness 能力

目标：在业务复杂度增长后继续提升可靠性。

可能能力：run replay；evaluation；planner；multi-step durable workflow；多模型路由；成本和 token 预算控制；更完整的 observability dashboard。

该阶段不建议立即启动，除非已有明确业务场景。

## 12. 风险与取舍

| 风险 | 说明 | 应对 |
|---|---|---|
| 一次性重构过大 | 容易影响现有对话和 Skill | 按 Phase 1 先收口事件和展示 |
| 前端与旧事件兼容复杂 | 当前已有多种 stream event | 新旧事件并行一段时间（§11 过渡策略） |
| 过度展示进度 | 用户会看到系统内部噪音 | 引入 display mode + 时间线默认折叠 |
| 过度隐藏过程 | 长任务缺少信任感 | 只在 task/contextual/skill/confirmation 场景展示时间线 |
| 数据模型提前设计过重 | 影响迭代速度 | Phase 2 再持久化 run |
| 工具结果 schema 不统一 | 后续扩展难 | Phase 3 标准化工具输出 |
| 高频流式事件压垮连接 | text_delta 在高并发下产生大量 WS 消息 | 引入 50–100ms 合并窗口，批量发送 delta |
| Trace 存储成本激增 | Internal Trace Event 数据量远大于 Product Event | Trace 保留 7 天，仅采样 10% 长期持久化 |
| 时间线"步骤"语义不统一 | chat 回合的 step 没有人类标题，与 durable task 的有标题不一致 | 见 §13 决策 5 |

## 13. 建议的近期决策

### 13.1 产品边界决策

1. 普通项目问答默认不展示底层工具进度。
2. 只有长任务、交付物生成、明确文件读取、Skill 调用和用户确认展示进度（即 `contextual` / `task` / `skill` / `confirmation` mode）。
3. 前端展示基于 Product Run Event，不直接依赖 raw tool call。
4. 模型文本必须尽量真实流式输出（本轮已修复 `_consume_stream` 缓存问题）。
5. 所有会产生副作用的动作必须通过 Policy Harness 和 HITAS。
6. Harness 先以 AI Run v1 的方式收口，不立即建设完整 Agent 平台。

### 13.2 Run Activity Timeline UI 决策

7. **默认折叠**：进行中展开当前步骤、其他步骤折叠；完成后整条时间线折叠为单行摘要（保留可点开复盘）。
8. **chat 回合步骤标题**：用工具名拼（如"读取项目文档、读取项目文件"）作为标题；durable task 用其自带 `step_title`；都不出现"步骤 X/N"的硬编码。
9. **完成后保留**完整时间线（可折叠）而非只留摘要，便于复盘和审计。
10. **agent_step 粒度**：当前一轮"LLM→工具"= 一步，通常 1–2 步——Phase 1 先保持此粒度；若用户反馈不够"harness 感"，Phase 2 再考虑细分子阶段。
11. **范围**：Phase 1 只统一项目对话；独立聊天页（`Chat.tsx`，目前有 `skill_progress`）的迁移放到 Phase 2 与 Run 数据模型一起做。

## 14. 第一版验收标准

AI Run Harness v1（Phase 1）完成后，至少满足：

- 用户发送消息后，用户消息和 AI 状态立即出现。
- 普通问答不会展示"步骤 1/4"或只读工具日志。
- 文本回复逐段显示，而不是整段突然出现。
- 文件读取场景可以展示简短、可理解的读取状态（contextual mode 时间线）。
- 交付物生成有任务进度和 artifact ready 事件。
- 高风险修改或删除动作进入确认流程。
- run 完成后 streaming 气泡稳定替换为持久化 assistant message，**且活动时间线一致**（流式/刷新无差异）。
- Skill 调用时项目对话顶部显示 Skill 横幅；时间线步骤反映真实工具执行。
- 复杂/后台任务在对话里直接看到 4 步进度 + 最终文件，不需跳任务面板。
- 开发者仍可在 trace 中看到底层工具和执行日志。

## 15. 总结

AriaAI 当前不需要立刻建设复杂 Agent 平台，但需要从现在开始引入 Harness 边界。正确路径是：

```text
先统一 AI Run lifecycle 与 Product Run Event
  ↓
落地 Run Activity Timeline UI（项目对话首发，§9.5）
  ↓
再统一 Tool / Context / Persistence Harness
  ↓
最后根据业务复杂度引入高级 Agent 能力
```

这条路径可以在不推倒现有系统的前提下，逐步把 AriaAI 从"能聊天的项目系统"升级为"可控、可沉淀、可审计的项目 AI 工作台"，并在 Phase 1 就让用户**看见**这套体系的价值——尤其是在 Skill 调用和复杂任务这两个场景下。
