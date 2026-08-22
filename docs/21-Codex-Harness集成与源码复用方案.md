# Codex 源码吸收与 Aria 原生 Harness 优化方案

> 更新日期：2026-08-23
> 状态：Phase 1 + Phase 2A + Phase 2B + Phase 2C + Phase 2D + Phase 2E + Phase 2F + Phase 2G + Phase 2H 已实施
> 核心结论：Aria 不运行、不调用、不连接 Codex；仅从其开源仓库吸收适合 Aria 的源码与工程机制。

## 1. 架构决策

本方案采用“源码吸收型”路线，不采用“运行时集成型”路线。

```text
错误方向（已撤回）
Aria FastAPI ── JSONL / SDK / MCP ──> Codex App Server

当前方向
Codex 开源源码 ── 审计、筛选、Python 化、Aria 化 ──> Aria Native Harness
                                                        │
                                                        ├─ Aria Agent Loop
                                                        ├─ Aria HITAS
                                                        ├─ Aria Skills
                                                        └─ Aria Product Run Event
```

因此，部署和运行 Aria 时：

- 不需要安装 Codex CLI；
- 不会启动 `codex app-server` 子进程；
- 不使用 Codex SDK；
- 不保存 Codex Thread / Turn / Item 标识；
- 不配置 `ARIA_CODEX_*` 环境变量；
- 不依赖 Codex 账号、Codex Cloud 或 Codex 协议；
- Aria 继续直接使用现有模型 Provider，并由自己的 Agent Loop 编排工具。

根目录 `.agents/` 和 `AGENTS.md` 仅服务于开发阶段的代码协作，不属于 Aria 生产运行时。

## 2. 官方开源边界

OpenAI 官方资料确认，Codex CLI、SDK、App Server、Skills 等关键组件在 GitHub 开源；IDE Extension 和 Codex Cloud 不开源。

参考资料：

- <https://learn.chatgpt.com/docs/open-source>
- <https://github.com/openai/codex>
- <https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2>（`apply_patch` 的结构化 diff 与应用结果反馈边界）
- <https://learn.chatgpt.com/docs/build-skills>（Skill 包结构与渐进披露原则）
- <https://learn.chatgpt.com/docs/agent-approvals-security>（技术权限边界与审批策略分层）
- <https://developers.openai.com/api/docs/guides/function-calling>（工具输出通过 `call_id` 与具体调用配对）
- <https://developers.openai.com/api/docs/guides/compaction>（长交互在阈值处压缩上下文并携带后续所需状态）
- <https://developers.openai.com/api/docs/guides/prompt-caching>（精确稳定前缀有利于缓存命中）
- <https://developers.openai.com/api/docs/guides/error-codes>（临时限流、服务端错误与配额错误的恢复边界）
- <https://developers.openai.com/api/docs/guides/rate-limits>（限流退避与 `Retry-After`）
- <https://developers.openai.com/api/docs/guides/streaming-responses>（流式增量输出形成不可盲目重放的提交边界）

本轮审计基线：

- 上游仓库：`openai/codex`；
- 上游提交：`343074d4207d572809bd8cea15f4be1d09d98e0b`；
- 提交日期：2026-08-22；
- 许可证：Apache License 2.0。

“开源”不等于“全部可搬”。选择源码时同时考虑产品相关性、技术栈差异、维护成本、安全边界和许可证义务。

## 3. 源码吸收原则

每次吸收上游源码都必须通过以下六个判断：

1. 解决的是 Aria 已存在或近期确定要解决的问题。
2. 模块可以与 Codex 的认证、云服务、协议和存储解耦。
3. Python 化后的实现仍能保留核心算法和测试价值。
4. 不复制 Aria 已有且更贴合咨询业务的能力。
5. 能接入 Aria 现有 Agent Loop、HITAS、Skill 和审计模型。
6. 能明确记录来源、提交、许可证和本地修改。

优先级顺序：

```text
独立算法 > 稳定数据模型 > 工程模式 > 大型子系统 > 整体运行时
```

大型 Rust 子系统只有在 Python 重写成本明显高于收益、且 Aria 确实需要同类能力时才重新评估。目前没有这种必要。

## 4. Phase 1 + Phase 2A + Phase 2B + Phase 2C + Phase 2D + Phase 2E + Phase 2F + Phase 2G + Phase 2H 已吸收的源码机制

| Codex 上游机制 | 上游路径 | Aria 原生实现 | 接入位置 | 价值 |
|---|---|---|---|---|
| Head/Tail 输出缓冲 | `codex-rs/core/src/unified_exec/head_tail_buffer.rs` | `backend/app/services/agent_harness/output_buffer.py` | `chat/tool_executor.py` | 长工具结果保留开头与结尾，避免上下文被中间冗余输出占满 |
| 上下文预算、每回合压缩与中间截断 | `codex-rs/utils/string/src/truncate.rs`、`core/src/session/context_window.rs`、`core/src/context_manager/history.rs` | `backend/app/services/agent_harness/context_budget.py` | `chat/runtime.py` + `chat/agent_loop.py` | 每次模型请求重新管理系统提示、工具、历史、推理内容、输出预留和安全余量；工具批次保持结构化且不可拆分 |
| Run Rollout 与重建 | `codex-rs/rollout/src/recorder.rs`、`ordinal.rs`、`core/src/session/rollout_reconstruction.rs` | `backend/app/services/agent_harness/run_rollout.py` | Chat Run + `TaskRun/TaskStep/TaskEvent` | 每步写入有序 checkpoint，中断后可确定性重建并生成安全恢复决策 |
| 结构化文本 Patch | `codex-rs/apply-patch/src/parser.rs`、`file_update.rs`、`seek_sequence.rs`、`text_file.rs` | `backend/app/services/agent_harness/structured_patch.py` | Markdown Tool + HITAS + `ProjectFileVersion` | 先生成并冻结 diff，再做基线校验、原子写入、冲突拒绝和版本回滚 |
| 三态执行策略 | `codex-rs/execpolicy/src/decision.rs` | `backend/app/services/agent_harness/tool_policy.py` | Agent Loop + Tool Executor | 用 `allow / prompt / forbidden` 明确区分直接执行、HITAS、禁止执行 |
| 审批执行信封 | `core/src/tools/sandboxing.rs`、`approvals.rs`、`runtimes/apply_patch.rs` | `backend/app/services/agent_harness/approval_envelope.py` | HITAS 持久化 + 普通/批量确认 | 将用户看到的动作与最终执行动作做版本化完整绑定，篡改或策略漂移时拒绝执行 |
| 工具转录规范化 | `core/src/context_manager/normalize.rs`、`history.rs` | `backend/app/services/agent_harness/tool_transcript.py` | `chat/agent_loop.py` 的每次 Provider 请求边界 | 补齐缺失结果、移除孤立结果、稳定修复调用 ID，并在执行前拒绝重复 ID，避免协议错误与重复副作用 |
| 模型回合安全重试 | `core/src/responses_retry.rs`、`protocol/src/error.rs`、`codex-api/src/sse/responses.rs` | `backend/app/services/agent_harness/turn_retry.py` | `chat/agent_loop.py` + 各模型 Provider | 统一错误分类、服务端等待时间、有限退避和遥测；任何模型事件出现后关闭自动重放窗口 |
| Skill 前置信息解析 | `codex-rs/skills/src/parser.rs` | `backend/app/services/agent_harness/skill_package.py` | `routers/skills.py` | 校验 `SKILL.md`、修复有限 YAML 歧义、安全加载指定引用 |
| Skill Root 快照与选择 | `codex-rs/skills/src/loading.rs`、`selection.rs`、`ext/skills/src/loader/` | `backend/app/services/agent_harness/skill_roots.py` | Skill 启动同步 + `skill_router.py` | 有序 Root、不可变内容指纹、增量缓存、坏包隔离和发布态候选选择 |

### 4.1 工具输出头尾缓冲

Codex 的设计不是简单保留前 N 个字符，而是把容量对半分给稳定的 head 和最新的 tail，并统计中间省略字节数。这样既保留调用起因、参数和初始日志，也保留最终结果或错误堆栈。

Aria 的修改：

- Rust 字节缓冲翻译为 Python；
- 容量从编译期常量改为运行时参数；
- 工具结果超过 64 KiB 时生成合法 JSON 包装；
- 完整结果仍进入 Aria 的审计、Artifact 和前端路径；
- 仅压缩反馈给下一轮模型的副本，避免损失业务数据。

### 4.2 `allow / prompt / forbidden` 三态策略

Aria 原有 `ActionPolicy` 已能判断权限等级，但调用端仍分别处理“能否调用”和“是否需要确认”。本次借鉴 Codex 的三态 Decision，把两层语义统一为一个结果：

- `allow`：可直接执行；
- `prompt`：工具计划有效，但执行前必须进入 Aria HITAS；
- `forbidden`：不得执行，也不应伪装成已完成。

Aria 的 `prompt` 是业务审批，不是 Codex sandbox approval。审批记录、授权复检、执行参数冻结和审计继续完全由 Aria 管理。

### 4.3 `SKILL.md` 解析与引用安全

原实现只按字符串 `---` 切割 frontmatter，无法稳定发现无效 YAML、缺失描述、超长名称或引用越界。本次吸收后：

- 强制合法 YAML frontmatter；
- Skill 名称不超过 64 个字符；
- `description` 和指令正文不能为空；
- 支持 `metadata.short-description`；
- 对 `description: Build for AWS: ECS` 这类常见第三方 YAML 歧义做保守修复；
- 只加载调用方明确选择的 reference；
- 阻止 `../` 或符号链接逃出 Skill 包根目录。

现有 48 个 Aria Skill 包已全部通过新解析器。

### 4.4 上下文预算与旧历史压缩

Aria 现在在每次模型调用前执行一次本地预算：

```text
模型上下文窗口
  ├─ 输出 token 预留
  ├─ 安全余量
  └─ 输入预算
       ├─ 系统提示 / 项目 / RAG / Skill / Memory
       ├─ Tool Schema
       ├─ 最近对话原文
       └─ 更早历史的紧凑摘录
```

具体行为：

- 使用与 Codex 相同的 UTF-8 字节近似估算，不引入特定 Provider tokenizer；
- `*-8k`、`*-32k`、`*-128k-*` 等显式模型窗口优先于全局默认值；
- 短上下文完全不改写；
- 超限时保留系统提示开头和结尾，并优先保留最近四条消息；
- 更早消息生成带角色标签的确定性原文摘录，不调用任何摘要模型；
- 当前请求过长时使用 UTF-8 安全的中间截断，保留任务开头和约束结尾；
- 将压缩前后 token、消息数、摘要数和安全余量写入 `prepare_metrics.context_budget`；
- 默认窗口、安全比例和历史摘录预算可通过通用 Aria 配置调整。

### 4.5 Run Rollout、重建与恢复决策

Aria 现在为每个普通聊天 Run 建立隐藏的持久化 rollout，复用自己已有的 `TaskRun / TaskStep / TaskEvent`，不新建 Codex Thread 或 JSONL 存储。

具体机制：

- Run 开始时写入 `run_started`，每个 Agent Step 结束时追加 `step_checkpoint`；
- 每条记录带单调 ordinal，重建时按 ordinal 而不是数据库偶然返回顺序 replay；
- 同一 ordinal 冲突时保留最新记录并生成 integrity warning，缺失 ordinal 也会显式报告；
- checkpoint 只保存工具名、参数哈希、有界结果摘要、尝试次数和状态，不重复存储原始敏感参数或完整工具结果；
- 失败、消息持久化、等待 HITAS 和正常完成都有终态边界；
- 恢复器产生 `none / wait_for_confirmation / retry_step / resume_from_checkpoint / restart_turn` 五种明确结果；
- 只有结果明确失败的交付工具，或出现短暂错误的只读工具，才会在当前步进行有界自动重试；
- 写入结果不确定时默认 `restart_turn`，不会自动重放可能已生效的副作用；
- `GET /chat/conversations/{conversation_id}/rollout` 可按权限读取最新或指定 `run_id` 的重建结果。

长时间任务继续由 Aria Task Orchestrator 执行已有的步骤级 retry/resume；普通聊天则先生成可审计恢复决策。这避免把“可重建”错当成“所有副作用都可自动重放”。

### 4.6 结构化 Patch、并发冲突与回滚

Aria 现在为既有 Markdown Artifact 增加 `patch` 与 `rollback` 两种修改模式。它借鉴 Codex `apply-patch` 的 Patch marker、顺序上下文定位、替换计划、unified diff 和行结束符保留机制，但把能力严格收敛到 Aria 业务对象：

```text
read_project_markdown_document
  └─ content_sha256 + 当前 version
          │
          ▼
update_project_markdown_document(mode=patch / rollback)
  └─ 服务端预检：解析 → 唯一上下文定位 → 计算结果 → 冻结 diff
          │
          ▼
Aria HITAS Action Preview
  └─ 用户查看目标、基线、结果哈希和 diff 后确认/拒绝
          │
          ▼
确认执行
  └─ 文件锁内重新读取 → 再校验 base_sha256 → 重新推导结果
       ├─ 不一致：409 冲突，零写入
       └─ 一致：同目录临时文件 + fsync + os.replace
                    └─ ProjectFileVersion 前后快照 + 可确认回滚
```

与 Codex 通用源码编辑器不同，Aria 的约束是：

- 只允许一次更新一个通过 `project_id + file_id` 授权的既有 Markdown 文档；
- Patch 中的文件名必须与选中的 Artifact 匹配；
- 禁止 Add、Delete、Move、多文件 Patch、绝对路径、`..` 路径穿越和符号链接目标；
- Patch 最大 256 KiB，目标文本最大 4 MiB；
- 上下文必须精确且唯一，找不到或出现多个匹配位置都拒绝执行，不做模糊猜测；
- 预检时冻结 `base_sha256 / result_sha256 / unified diff`，确认时不信任冻结的新内容，而是重新解析和推导；
- 基线在等待确认期间发生变化时返回冲突，原文件保持不变；
- 所有 Markdown 更新改为同目录原子替换，结构化 Patch 还在数据库提交失败时执行文件补偿；
- 成功写入同时保留前后 `ProjectFileVersion`，回滚本身也要重新预览并进入 HITAS；
- 审批卡以可滚动等宽文本呈现 diff，超长预览采用头尾截断，但完整结果哈希仍参与校验。

本阶段没有新增数据库表或迁移，继续复用 Aria 已有 `ProjectFileVersion`、`PendingToolAction`、项目权限和审计消息。Office 文档仍不套用文本 Patch；PPTX/DOCX/XLSX 后续必须基于 OOXML 对象模型单独设计。

### 4.7 Skill Root 快照、增量刷新与发布态选择

Aria 现在把文件型 Skill 的发现过程拆成三个边界清晰的层次：

```text
ARIA_SKILL_ROOTS（高优先级，可选）
          + 仓库 skills/（最低优先级兜底）
                    │
                    ▼
有界扫描 → Root inventory fingerprint → 不可变 Package Snapshot
                    │                        ├─ SKILL.md 元数据
                    │                        ├─ 包内冻结文件
                    │                        └─ SHA-256 content fingerprint
                    ▼
启动/手动同步 → 仅发布有效包 → Aria Skill 数据库
                                      │
                                      ▼
聊天意图候选排序、歧义拒绝和审计指纹
```

具体约束：

- Root 按配置顺序从高到低处理，同一个 package key 只保留第一个有效包；
- 隐藏目录不扫描，目录/文件符号链接不跟随，绝对 Root 以外的内容不能进入快照；
- 扫描深度、目录数、文件数、单文件、单包和单 Root 字节量均有硬上限；
- Inventory 未变化时复用完整不可变快照，只有发生变化的 Root 才重新读取和解析；
- Package fingerprint 覆盖 `SKILL.md` 及包内文件，所选 reference 从同一冻结快照渲染；
- 单个无效 `SKILL.md`、非 UTF-8 文件或越界 reference 只产生该包错误，不影响有效兄弟包；
- 文件同步失败时不会用空 Prompt 覆盖数据库中已经发布的 Skill；
- `builtin_hash` 同时纳入源码内容指纹，文件更新会在下一次同步时增量发布；
- 自动选择只读取 Aria 数据库发布态 Skill，记录 catalog fingerprint 和 Top Candidates；
- 多个候选同分达到高置信阈值时拒绝自动启用，避免依赖数据库偶然顺序；
- `GET /skills/meta/root-snapshot` 提供不暴露 Root 绝对路径的安全诊断摘要。

官方 OpenAI 文档将 Skill 描述为包含 `SKILL.md`、可选脚本与引用的目录，并采用渐进披露：先暴露名称和描述，选中后再加载完整指令。Aria 借鉴这一工程原则，但发布、权限、执行上下文和候选选择仍由自己的数据库及 Agent Loop 控制。

### 4.8 HITAS 审批执行信封

OpenAI 官方文档把技术能力限制与审批策略定义为相互配合的两层控制；Codex 源码中的 `ApprovalAction` 也把一次批准绑定到具体工具动作。Aria 不移植命令执行器或 OS 沙箱，而是把这一原则落在自己的业务工具和项目权限上。

Phase 2E 新生成的每个 `PendingToolAction` 都保存 `aria-approval-v2` 指纹，覆盖：

- 工具名称与冻结 JSON 参数；
- 项目范围、动作类型和风险等级；
- 创建审批时的 `ActionPolicy`；
- 审批批次 ID 与批次内顺序。

确认接口先重新读取持久化动作、复检当前用户对 Conversation/Project 的写权限，再使用常量时间比较校验完整信封，并重新执行三态策略判断。只有仍属于 `prompt` 路径、风险等级没有降低、快照完全一致的动作才会被原子认领为 `executing`。普通确认、批量确认和后台任务使用同一校验结果冻结的本地参数；批次中任一信封失效时，整个批次在认领前停止。

Phase 2E 不新增数据库字段或迁移，复用已有 `tool_input_hash` 保存带版本前缀的信封。部署前创建的 input-only SHA-256 仍在其最长 24 小时待审批窗口内兼容校验；重新发布相同 Preview 时会升级为 v2。空哈希旧记录保持兼容但明确标记为 legacy，不会由新代码继续产生。

### 4.9 工具调用转录规范化

官方 Function Calling 协议要求工具输出通过 `call_id` 回指具体调用。正常情况下 Aria Agent Loop 已按批次生成 `tool_use` 与 `tool_result`，但中断恢复、异常 Provider 输出、重复调用 ID 或未来的历史重写仍可能破坏配对关系。Phase 2F 在每次调用 Claude、Kimi、DeepSeek、GLM 或 MiMo 之前统一规范化 Aria 的 Provider-neutral 消息，而不是把修复逻辑分散到各 Provider。

规范化规则为：

- 完整且合法的消息保持内容与顺序不变，输入对象不会被原地修改；
- 每个 assistant 工具调用只与紧随其后的 Aria tool-result 消息配对；
- 缺失结果时立即插入确定性的 `aborted` 结果，明确标记执行结果未知、不可自动重试，绝不伪造成功；
- 孤立或重复结果被删除，但同一用户消息中的普通文本和元数据继续保留；
- 缺失或跨历史重复的调用 ID 使用稳定 SHA-256 派生 ID 修复，并同步改写对应结果；
- 同一模型回合内的重复调用 ID 在工具执行前只保留第一项，避免写操作被重复执行；
- 异常代码、修复计数和前后指纹进入 Aria internal trace，不记录原始工具参数或输出。

Aria 使用 Anthropic-shaped 内部消息作为中立格式，之后仍由现有适配器转换到 OpenAI-compatible `tool_calls` / `role=tool`。本阶段不引入 Codex Response Item、Thread、协议绑定或运行时依赖，也不新增数据库迁移。

### 4.10 每回合工具感知上下文预算

Phase 2A 已在 Runtime 创建时计算初始预算，但工具执行后的 assistant call 与 user result 会继续追加到内存消息中；此前第二轮及后续模型请求不会重新计算窗口。与此同时，旧 `_truncate_message` 会把结构化 content 列表整体序列化成普通字符串，超限时可能破坏工具协议。

Phase 2G 将预算边界移动到 Agent Loop 每次 Provider 请求之前，并增加工具感知压缩：

- Runtime 创建阶段仍解析模型窗口、安全余量、输出预留和历史摘录配置；
- 每次 Claude、Kimi、DeepSeek、GLM、MiMo 请求前，都对当时最新的 system、tools、history、reasoning 与工具结果重新估算；
- 未超限请求保持内容、顺序和稳定前缀不变，避免无意义改写；
- assistant `tool_use` 与紧随其后的 user `tool_result` 被视为一个原子历史单元，只能成对保留或成对移入旧历史摘录；
- 保留批次内只压缩 `text`、tool input 和 tool result payload，不改变 role、block type、tool name、call ID 或 result ID；
- 被压缩的 tool result 仍是合法 JSON，明确包含 `_aria_compacted` 和原始 token 估算，并在容量允许时保留 head/tail excerpt；
- reasoning content 纳入预算，并在必要时独立压缩；
- 压缩只作用于发送给下一轮模型的深拷贝，Aria Step、审计、Artifact 和持久化状态继续保留完整工具结果；
- 压缩后再次运行 Phase 2F 配对校验；若发生意外修复，记录高优先级 internal trace；
- 每回合记录压缩前后 token、消息数、结构化消息数和工具批次数，不保存额外原始内容。

OpenAI 官方 Compaction 文档说明长交互应在渲染 token 超过阈值时压缩并携带后续所需状态；Prompt Caching 文档说明缓存依赖精确前缀。Aria 借鉴这两项原则，但不调用 Responses Compaction API：本地确定性实现继续兼容全部既有 Provider，也不产生 OpenAI/Codex 专属 opaque item。

### 4.11 模型回合安全重试与副作用隔离

Phase 2H 把模型流重试从 Kimi、DeepSeek、MiMo、GLM 的适配器内部上移到 Aria Agent Loop。旧实现各自进行最多三次随机退避，但适配器不知道上层是否已经向用户输出文本或收到工具计划；SSE 中途断开时可能从头重放整个请求。

现在的回合边界为：

```text
每次 Provider 请求
  ├─ 尚未收到模型事件
  │    ├─ 408 / 409 / 425 / 429 / 5xx / 短暂网络错误
  │    │      └─ 有界退避后重试，并记录安全遥测
  │    └─ 认证 / 参数 / 上下文 / 配额 / 计费错误
  │           └─ 立即失败，不重试
  └─ 已收到任意模型事件（提交屏障）
       ├─ 文本 delta
       ├─ reasoning envelope
       ├─ TOOL_START / tool_use
       └─ 任意 Provider 字符串事件
              └─ 后续即使断流也绝不自动重放
```

具体约束：

- 默认总尝试次数为 2（一次初始请求 + 一次安全重试），代码硬上限为 3；
- 退避采用确定性的 500 ms 指数增长，上限默认 5 秒，便于测试、审计和容量预测；
- 对临时 429 优先使用 Provider 的 `Retry-After`，但若等待时间超过 Aria 单回合预算则直接失败，不会提前请求；
- `insufficient_quota`、账单、余额、用量上限、API Key、权限、上下文长度和请求参数错误不可重试；
- Aria 自己发出的思考心跳不构成模型提交，首个模型事件之前仍可恢复；
- 一旦有模型事件，记录 `model_turn_retry_suppressed` 并让当前 Run 失败，避免重复文本、重复工具计划和潜在重复副作用；
- Kimi、DeepSeek、MiMo、GLM 的 Provider 内部随机重放已删除；Claude HTTP 错误也转换为同一结构化错误；
- Trace 只记录错误类别、固定原因、状态码、尝试次数和等待时长，不记录原始请求、API Key 或完整错误正文；
- `model_retry_count` 与 `model_retry_wait_ms` 进入 Aria 原有 timing/trace，前端收到 `model_retry` 状态后可显示恢复进度。

Codex 上游允许对 retryable sampling stream 进行有界重连，并保留服务端提供的等待时间。Aria 吸收错误分类、等待策略与遥测字段，但采用更保守的业务副作用模型：Codex 的通用回合重连不直接照搬，Aria 只在没有任何上层可见或可执行状态时重放。整个过程仍直接调用 Aria 已配置的 Claude、Kimi、DeepSeek、GLM 或 MiMo Provider，不启动或连接 Codex。

## 5. 已撤回的错误方向

下列通信型实现已从工作区移除：

- Codex App Server 子进程客户端；
- stdio JSONL 请求、通知与审批协议；
- Codex Thread 与 Aria Conversation 的数据库绑定；
- `ARIA_CODEX_*` 配置和环境变量；
- App Server schema 兼容检查脚本；
- 外部运行时事件映射器；
- 对应 Alembic migration 和测试。

撤回这些模块不会削弱 Aria 的现有聊天能力，因为它们从未接入主聊天路由；Claude、Kimi、DeepSeek、GLM、MiMo 等既有 Provider 路径保持不变。

## 6. 不应直接搬入 Aria 的部分

| Codex 部分 | 当前决定 | 原因 |
|---|---|---|
| App Server / SDK / JSONL protocol | 不采用 | 形成第二运行时，与“不通信”目标冲突 |
| Thread / Turn / Item 持久化 | 不采用 | Aria 已有 Conversation、Message、Run、Step、Trace |
| Codex 模型客户端和认证 | 不采用 | Aria 已有多 Provider 管理和密钥体系 |
| Rust sandbox / OS 隔离实现 | 暂不采用 | Aria 当前执行结构化业务工具，不开放通用 shell |
| TUI / CLI | 不采用 | Aria 的产品界面是 React Web 工作台 |
| MCP Server / connectors | 按需求独立评估 | 只有 Aria 明确需要对应外部系统时才引入 |
| Codex memory | 不采用 | Aria 的用户、客户、项目和工作记忆更贴合业务域 |
| Codex Cloud / IDE extension | 不可用 | 官方资料明确不属于开源组件 |

## 7. 已完成阶段与下一步源码吸收路线

### Phase 2A：上下文预算与压缩（已实施）

参考候选：

- `codex-rs/core/src/session/context_window.rs`；
- `codex-rs/core/src/compact_remote.rs`；
- `codex-rs/core/src/session/token_budget.rs`。

已完成：统一 Context Budget、显式模型窗口识别、输出与安全余量预留、UTF-8 中间截断、旧历史确定性摘录和运行指标。全过程在 Aria 本地执行，不调用 Codex，也不要求某一 Provider 支持专用 compaction API。

### Phase 2B：Run Rollout 与可恢复执行（已实施）

参考候选：

- `codex-rs/rollout/`；
- `codex-rs/state/`；
- `codex-rs/core/src/session/rollout_reconstruction.rs`。

已完成：有序追加记录、步骤 checkpoint、中断/失败/HITAS/完成重建、安全恢复决策、工具尝试次数持久化和 Golden Case 对照。Aria 数据库与业务权限仍是唯一事实源。

### Phase 2C：结构化 Patch（已实施）

参考候选：

- `codex-rs/apply-patch/`。

已完成：单 Markdown Artifact Patch grammar、服务端 diff 预检、精确且唯一的上下文匹配、基线 SHA-256 双重校验、HITAS diff 审批卡、跨线程/进程文件锁、原子替换、数据库失败补偿、前后版本快照和需再次确认的版本回滚。Office 文档需要独立的 OOXML 结构化编辑策略，不能直接套用文本 patch。

### Phase 2D：Skill Root 快照与缓存（已实施）

参考候选：

- `codex-rs/skills/src/loading.rs`；
- `codex-rs/skills/src/selection.rs`。

已完成：提供可配置高优先级 Root 与仓库兜底 Root、不可变内容快照、精确 package fingerprint、基于 inventory 的增量缓存、单包错误隔离、符号链接与遍历边界、同步诊断、数据库发布目录指纹、确定性 Top Candidates 和高置信同分拒绝。数据库中的发布态 Skill 仍是产品事实源，Root 快照不会绕过发布流程直接进入模型上下文。

### Phase 2E：HITAS 审批执行信封（已实施）

参考候选：

- `codex-rs/core/src/tools/sandboxing.rs`；
- `codex-rs/core/src/tools/approvals.rs`；
- `codex-rs/core/src/tools/runtimes/apply_patch.rs`；
- `codex-rs/execpolicy/src/decision.rs`。

已完成：使用版本化、域分离 SHA-256 绑定工具、参数、项目、风险、创建策略与批次顺序；确认时复检项目写权限、快照完整性、三态策略和风险下限；普通/批量/后台路径共享同一冻结参数；篡改、策略漂移、风险降级或批次重排全部在执行认领前失败关闭。实现复用现有字段，无数据库迁移，也不包含 Codex sandbox、命令执行或通信协议。

### Phase 2F：工具调用转录规范化（已实施）

参考候选：

- `codex-rs/core/src/context_manager/normalize.rs`；
- `codex-rs/core/src/context_manager/history.rs`。

已完成：在 Aria Agent Loop 的统一 Provider 请求边界校验工具调用与结果配对；缺失输出补入不可重试的中断结果，孤立/重复输出安全移除，缺失或冲突 ID 确定性修复；模型同一回合重复 ID 在业务工具执行前去重；所有异常只写入 Aria internal trace。Claude 与全部 OpenAI-compatible Provider 继续共用既有接口，不调用 Codex，也不新增数据表或迁移。

### Phase 2G：每回合工具感知上下文预算（已实施）

参考候选：

- `codex-rs/core/src/context_manager/history.rs`；
- `codex-rs/core/src/session/context_window.rs`；
- `codex-rs/utils/string/src/truncate.rs`。

已完成：把 Aria 本地 Context Budget 接入 Agent Loop 的每次模型请求；工具调用与结果作为原子单元选择，结构化 payload 在原位压缩并保持合法 JSON，reasoning 纳入估算，压缩后再次验证 Phase 2F 协议不变量；每回合指标进入 internal trace。正常请求保持稳定，全部 Provider 共用同一实现，不调用远程 Compaction API，不新增数据库迁移。

### Phase 2H：模型回合安全重试与副作用隔离（已实施）

参考候选：

- `codex-rs/core/src/responses_retry.rs`；
- `codex-rs/protocol/src/error.rs`；
- `codex-rs/codex-api/src/sse/responses.rs`；
- `codex-rs/codex-client/src/retry.rs`。

已完成：把模型流重试从各 Provider 上移到 Aria Agent Loop，统一临时 HTTP/网络错误、配额/认证/请求错误与 `Retry-After` 分类；采用总次数硬上限和确定性退避；首个模型事件前允许恢复，任何文本、推理或工具计划出现后永久关闭本回合自动重放。四个 OpenAI-compatible Provider 不再内部随机重试，Claude HTTP 路径保留结构化状态与响应头，所有重试和抑制决策进入 Aria internal trace。实现不运行、不导入、不连接 Codex，也不新增数据库迁移。

## 8. 许可证与升级流程

Aria 主项目继续使用 MIT License；从 Codex 改编的具体文件同时受 Apache License 2.0 的适用要求约束。

仓库需要保留：

- `THIRD_PARTY_NOTICES.md` 中的上游归属；
- `third_party/openai-codex/LICENSE` 的完整许可证副本；
- 每个改编文件顶部的上游路径、提交和“已修改”说明；
- 改编机制的测试。

后续更新流程：

1. 固定新的上游 commit，不追踪漂移的 `main` 行为。
2. 对比已吸收源文件，而不是对比整个 Codex 仓库。
3. 只移植与 Aria 场景相关的 bug fix 或算法优化。
4. 在 Aria Python 实现上补回归测试。
5. 更新 notice、方案文档和变更记录。
6. 不允许上游更新悄悄引入 Codex runtime dependency。

## 9. 验收标准

每个源码吸收项必须满足：

- Aria 在未安装 Codex 的环境中可启动、测试和运行；
- 不存在对 `codex` 可执行文件、App Server、SDK 或协议的 import/call；
- 现有 Provider 与聊天路径行为不回退；
- 权限失败默认为 `forbidden`，高风险修改进入 HITAS；
- 完整业务结果不因模型上下文压缩而丢失；
- 上游来源和修改说明可追溯；
- 聚焦测试通过，数据库相关测试在 PostgreSQL 测试库可用时补跑。

最终定位不是“Aria 内置 Codex”，而是：

> Aria 拥有自己的专业服务 Agent Harness，并持续从优秀开源 Agent 工程中吸收经过验证的机制。
