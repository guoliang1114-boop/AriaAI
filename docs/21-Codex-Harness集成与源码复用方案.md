# Codex 源码吸收与 Aria 原生 Harness 优化方案

> 更新日期：2026-08-24
> 状态：Phase 1 + Phase 2A + Phase 2B + Phase 2C + Phase 2D + Phase 2E + Phase 2F + Phase 2G + Phase 2H + Phase 2I + Phase 2J + Phase 2K + Phase 2L + Phase 2M + Phase 2N + Phase 2O + Phase 2P + Phase 2Q + Phase 2R + Phase 2S + Phase 2T + Phase 2U 已实施
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
- <https://developers.openai.com/api/docs/guides/latest-model>（Agent 编排的并发、重试、停止条件与副作用边界）
- <https://learn.chatgpt.com/docs/build-skills>（Skill 包结构与渐进披露原则）
- <https://learn.chatgpt.com/docs/agent-approvals-security>（技术权限边界与审批策略分层）
- <https://developers.openai.com/api/docs/guides/function-calling>（工具输出通过 `call_id` 与具体调用配对）
- <https://developers.openai.com/api/docs/guides/compaction>（长交互在阈值处压缩上下文并携带后续所需状态）
- <https://developers.openai.com/api/docs/guides/prompt-caching>（精确稳定前缀有利于缓存命中）
- <https://developers.openai.com/api/docs/guides/error-codes>（临时限流、服务端错误与配额错误的恢复边界）
- <https://developers.openai.com/api/docs/guides/rate-limits>（限流退避与 `Retry-After`）
- <https://developers.openai.com/api/docs/guides/streaming-responses>（流式增量输出形成不可盲目重放的提交边界）
- <https://developers.openai.com/api/docs/guides/conversation-state>（多轮状态需要显式保留，输入、输出与推理共同占用上下文窗口）
- <https://developers.openai.com/api/docs/guides/agents/results>（最终答案、可续接状态与逐项工具/交付记录是不同结果边界）

本轮审计基线：

- 上游仓库：`openai/codex`；
- 上游提交：`83d1fe0e67b1323f71febc2925817732b449f1d9`；
- 提交日期：2026-08-23；
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

## 4. Phase 1 至 Phase 2U 已吸收的源码机制

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
| 只读工具并发车道与写入屏障 | `core/src/tools/parallel.rs`、`orchestrator.rs` | `backend/app/services/agent_harness/tool_scheduler.py` | `chat/agent_loop.py` + 项目文件读取工具 | 显式安全的连续读取可有界并发；写入、审批、未知工具始终作为顺序屏障，结果按模型调用顺序回填 |
| 用户中断与终止边界 | `core/src/tasks/mod.rs`、`context/turn_aborted.rs`、`tests/suite/abort_tasks.rs` | `backend/app/services/agent_harness/turn_interrupt.py` | Chat SSE + Run Rollout + 两个聊天前端 | 停止按钮取消真实后端任务，保留部分回复并持久化 `cancelled` 终态；可能已执行的工具不会被盲目重放 |
| 单轮执行预算与停止边界 | `ext/goal/src/accounting.rs`、`ext/goal/src/runtime.rs`、`core/src/tools/orchestrator.rs` | `backend/app/services/agent_harness/turn_budget.py` | Agent Loop + Model Stream + Tool Batch + Persist + Run Rollout | 用单调时钟统一限制步骤、计划工具总数和总耗时；超限保存部分结果并以不可重试失败终态收口 |
| 有界完成证据与结构化裁决 | `core/src/context/guardian_review_evidence.rs`、`prompts/templates/review/rubric.md`、`protocol/src/review_format.rs` | `backend/app/services/agent_harness/run_evaluation.py` | Persist + Run Rollout + Product Run Event | 以工具、交付物、策略、审批、预算和输出完整性事实裁决终态，阻止失败 Run 被误报为 completed |
| 工具执行台账与结果契约 | `core/src/tools/executed_tool_calls.rs`、`protocol/src/models/executed_tool_calls.rs` | `backend/app/services/agent_harness/tool_execution_record.py` | Tool Executor + Agent Loop + Durable Task + Persist + Rollout + Evaluation + 前端 Store | 用 `tool_use_id` 合并调用生命周期，统一 outcome，移除原始输入/输出，并按 256 条/32 KiB 预算优先保留最近证据和显式省略计数 |
| 上下文组装清单与请求绑定 | `core/src/context/world_state/mod.rs`、`core/src/context_manager/history.rs` | `backend/app/services/context_builder/assembly.py` | Context Builder + Runtime + Agent Loop + Trace + Rollout + Evaluation | 用稳定来源 ID、信任层级、有界元数据和域分离 SHA-256 记录每一层上下文，并把 Manifest 绑定到实际 Provider 首次请求；不持久化 Prompt、历史、RAG 或工具 Schema 原文 |
| 运行输出 Item 与生命周期事实 | `protocol/src/models.rs`、`analytics/src/facts.rs` | `backend/app/services/agent_harness/run_output_record.py` | Tool Executor + Artifact Persist + Evaluation + Rollout + Memory Candidate + 前端 Store | 将模型正文、交付物和记忆候选拆成不同结果边界；Artifact 只有在文件、项目证据与内容哈希验证后才成为 persisted，候选则单独进入人工裁决生命周期 |
| 知识证据 Item 与引用闭环 | `protocol/src/models.rs`、`protocol/src/items.rs` | `backend/app/services/agent_harness/knowledge_evidence.py` | RAG + Context Builder + Persist + Evaluation + Trace + 两个聊天前端 | 检索片段获得稳定 Evidence ID 与 `K*` 引用键；原文只进入本轮 Prompt，持久化仅保留来源元数据和 SHA-256，回答只展示实际引用且有效的来源 |
| 语义失败分类与有界退避 | `protocol/src/error.rs`、`core/src/util.rs` | `backend/app/jobs/knowledge_jobs.py` | Knowledge Job + Ingestion + Scheduler + API + 知识库前端 | 按短暂/永久错误决定自动恢复，通过幂等键、lease、checkpoint 和有界尝试保证重启后可继续且不重复索引 |
| 验证后应用与持久映射 | `apply-patch/src/file_update.rs`、`rollout/src/recorder.rs` | `backend/app/services/knowledge_migration.py` | Legacy Knowledge + Migration Job + Source/Document + 管理前端 | 预检数据库和文件事实并冻结 plan fingerprint；执行时检测漂移、逐项 checkpoint、保留旧记录并把重复内容映射到同一新文档 |
| Skill 前置信息解析 | `codex-rs/skills/src/parser.rs` | `backend/app/services/agent_harness/skill_package.py` | `routers/skills.py` | 校验 `SKILL.md`、修复有限 YAML 歧义、安全加载指定引用 |
| Skill Root 快照与选择 | `codex-rs/skills/src/loading.rs`、`selection.rs`、`ext/skills/src/loader/` | `backend/app/services/agent_harness/skill_roots.py` | Skill 启动同步 + `skill_router.py` | 有序 Root、不可变内容指纹、增量缓存、坏包隔离和发布态候选选择 |
| 本轮 Skill 生命周期与回执 | `codex-rs/skills/src/mentions.rs`、`selection.rs`、`core/src/session/turn.rs` | `backend/app/services/skill_router.py` + `web/src/utils/chatRunSkill.ts` | Chat Runtime + Product Run Event + Chat UI | 相关追问续用、无关话题释放、实际 Skill 来源可见，避免旧 Skill 静默接管后续对话 |

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

### 4.12 只读工具并发车道与写入屏障

Phase 2I 吸收 Codex Tool Runtime 的并发能力声明和读写隔离原则，但改造为更适合 Aria 业务工具的确定性连续批次：

- 工具必须同时满足当前 `ActionPolicy` 允许、必需权限为 `read_only_tool`、YAML 显式声明 `parallel_safe` 三个条件才能并发；
- 默认最多四路，环境可调，代码硬上限为八路；
- 只并发连续的安全读调用，任何写入、需要 HITAS 的动作、未知工具或无效调用都是不可跨越的顺序屏障；
- 每个并发调用使用独立 `ChatSessionState` 累加器，完成后按模型原始调用顺序合并审计事件、Artifact 和结果；
- Provider 看到的 `tool_result` 顺序始终与 `tool_use` 顺序一致，不受实际完成先后影响；
- 项目通用文件与 Markdown 读取移到工作线程，避免同步解析和 PostgreSQL 读取阻塞 Agent Loop 事件循环；
- `tool_execution_planned` 与 `tool_execution_batch_completed` 只记录车道、批大小、上限和时长，不保存工具参数或文件内容。

这不是照搬 Codex shell 并发执行器。Aria 不开放通用命令，并发资格由自己的工具规格和业务权限决定；默认是顺序执行，而不是从工具名猜测安全性。

### 4.13 用户中断与可验证终止边界

Phase 2J 吸收 Codex 活动 Turn 取消和对模型可见的中断标记，但把控制、鉴权和持久化全部放在 Aria 自己的运行时中：

- 每个普通 Chat Run 在当前 Aria ASGI 进程中注册实际服务该 SSE 的 `asyncio.Task`，Run 完成后按任务身份安全注销；
- 新增 `POST /chat/runs/{run_id}/cancel`，先按 Run 关联的 Conversation 复检当前用户写权限，再取消目标任务；
- 主聊天页和项目聊天页都从 `run_started` 捕获 `run_id`，停止时先请求后端取消，浏览器断流只作为 1.5 秒兜底；
- Agent Loop 在每个模型流和续写流的边界持续更新部分文本，因此中断发生在 delta 中间时也不会丢失已经展示的内容；
- 用户取消会保存部分 Assistant Message，并追加“本轮已由用户停止”的模型可见标记；网络断开使用不同原因 `stream_cancelled`；
- 已运行到工具阶段时，中断消息明确提示工具可能已经部分执行，后续操作必须先检查项目事实，不自动重放；
- 当前运行中的 Step 写入 `cancelled / STEP_CANCELLED` checkpoint，Run Rollout 追加 `run_cancelled`，Product Run Event 以 `run_done(final_status=cancelled)` 收口；
- 若取消抵达时 Assistant Message 已经成功持久化，则不创建重复消息，并保持原有完成/等待确认终态。

这一实现不包含 Codex 的任务对象、协议、App Server 或进程。活动表只保存随机 Aria `run_id`、Conversation ID 和本进程 Task 引用；生产当前为单 Uvicorn 进程，与部署拓扑一致。未来若改为多 Worker，活动信号需升级为 Redis/PostgreSQL 通知或统一 Run Worker，而不是依赖请求负载均衡恰好命中同一进程。

### 4.14 单轮执行预算与统一停止边界

Phase 2K 吸收 Codex 目标运行时的单调用量记账与 Tool Orchestrator 集中边界，并按 Aria 的多 Provider、结构化业务工具和持久化 Run 模型重写：

- 每个普通 Chat Run 创建一份 `TurnBudgetLedger`，统一记录已开始 Step、模型规划的工具调用总数和单调墙钟耗时；
- 默认限制为 8 步、24 次计划工具调用和 600 秒，总配置再由代码硬限制在 1–16 步、1–64 次、30–1800 秒；
- 工具调用按规范化后的完整批次原子预留；若新批次会越界，该批次一个也不执行；
- 同一总截止时间覆盖模型流、模型安全重试等待、串行工具与并行工具批次，而不是给每次请求重新计时；
- 超限产生稳定的 `TURN_BUDGET_EXCEEDED` Product Run Event，当前 Step 标记 `failed / retryable=false`，部分文本和预算快照写入 Assistant Message 与 Run Rollout；
- 截止时间落在工具执行期间时，用户会看到“工具可能已部分执行”的事实提示；取消协程后不自动重放，需先核对项目实际状态；
- 进入预算失败后，Persist 只保存已有文本、Artifact、审批和审计记录，不再启动缺失 PPT 补生成、Markdown 兜底写入或后台标题模型调用。

这不是 Codex Goal Runtime 的移植。Aria 没有引入 Goal、Token Budget 服务或 Codex Tool Runtime；当前执行预算只作用于一次普通聊天 Agent Loop，长任务继续由 Durable Task Orchestrator 的步骤级生命周期管理。

### 4.15 完成证据裁决与可验证终态

Phase 2L 吸收 Codex Guardian Review 的有界证据、结构化 Finding 和显式 Overall Verdict，但将代码审查语义改写为 Aria 原生的 Run 完成条件：

- Persist 在发送最终成功事件前统一检查执行预算、交付物契约、执行真实性门、权限策略、审批持久化、工具终态、Agent Step 终态和输出完整性；
- 每次裁决形成版本化 `run_evaluation`，包括 `verdict`、`score`、`checks`、`findings` 和数量型证据摘要，并随 Assistant Message 与 Run Rollout 保存；
- 证据最多保留八条 Finding、五个工具名，不保存工具参数、完整结果、原始错误正文或模型上下文；
- 未恢复的工具失败、缺失交付物、无证据完成表述、策略拒绝、审批保存失败、残留运行中 Step、二次续写后仍截断或空模型输出，都会产生不可重试的 `RUN_EVALUATION_FAILED`；
- 只有显式关联原失败调用的后续成功才能把早期失败降为警告；同名但未关联的工具调用可能作用于不同目标，不作为恢复证据；等待确认保持 `waiting_confirmation`，不会误判为失败；
- 普通文本问答无需虚构工具证据；无正文但已有成功工具或已持久化交付物时，也允许由事实证明完成。

裁决器完全确定性运行，不调用评审模型，不使用 OpenAI Evals API，也不引入 Codex Reviewer、协议或进程。它只审阅 Aria 已经产生的有界状态，因此不同模型 Provider、重试次数和部署环境会得到相同终态。

### 4.16 Context Assembly Manifest 与 Provider 请求绑定

Phase 2O 将此前分散在 Context Builder 与 Runtime 的 Skill、项目/客户上下文、RAG、工作记忆、近期工具历史、意图契约、Turn Contract、能力框架、用户偏好、会话历史和工具目录收敛为 `Context Assembly Manifest v1`：

- 每一层拥有稳定 `source_id`、类别、信任层级、顺序、字符数、近似 token 数和域分离 SHA-256；重复 ID、未知类别、未知信任层级或超过 24 个业务来源会失败关闭；
- Manifest 只保存有界元数据、计数、预算结果和指纹，不保存客户事实原文、历史消息、RAG 片段、用户偏好原文或工具 Schema；
- Context Builder 返回自己的三类来源，Runtime 补全本轮策略与运行来源；工具转录规范化和 Context Budget 完成后，再从同一对象产生最终 `system / messages / tools` 与 Manifest；
- Agent Loop 在首个 Provider 请求之前重新计算三部分请求指纹，任何组装后篡改或漂移都会在调用模型前拒绝；后续工具回合继续使用既有每回合预算 Trace；
- Chat Trace 的 Prompt Layer、Run Rollout 的 `run_started`、Assistant Message 内的 Rollout Snapshot 与完成裁决共享同一份 Manifest；完成裁决将完整性或预算校验失败判为 `CONTEXT_ASSEMBLY_INVALID`；
- 正常请求和压缩请求都可验证 `estimated_total_after <= context_window - safety_margin`，同时保留是否压缩 system/history 的显式摘要。

这一实现借鉴 Codex World State 的稳定 section identity、重复拒绝、compact snapshot 与 model-visible fingerprint，但没有引入 Codex 的 World State 类型、Response Item、Thread、协议或运行时。Aria 仍直接调用自己的 Claude、Kimi、DeepSeek、GLM 与 MiMo Provider。

### 4.17 Run Output 持久化事实与 Memory Candidate 裁决

Phase 2P 从 Codex 的 typed `ResponseItem` 与 Artifact lifecycle fact 中吸收“正文、工具结果和交付物不是同一个结果对象”以及“每个产物需要稳定 Item ID 与生命周期状态”的工程边界，并改写为 Aria 原生 `RunOutputRecord v1`：

- 工具刚返回文件元数据时只记录 `produced`；输出记录使用稳定 `output_id`，只保存来源工具、调用 ID、文件名/类型和路径哈希，不复制原始路径、文件内容、Prompt 或工具参数；
- Persist 必须把路径解析到 `UPLOADS_DIR` 内、确认真实文件存在，并在有 `project_file_id` 时核对项目、删除状态和文件路径；随后以实际字节数和 SHA-256 写入 `GeneratedFile`，状态才变为 `persisted`；
- 缺失文件、路径逃逸、Schema 缺项或 ProjectFile 证据不一致均失败关闭，不生成附件卡、不发送 `artifact_ready`，完成裁决产生 `OUTPUT_PERSISTENCE_FAILED`；
- `GeneratedFile` 增加 `run_id/output_id/source_tool/content_sha256/output_record_version`，Artifact 事件、持久化时间线、Rollout 和 Evaluation 共用相同输出身份；
- `MemoryCandidate` 作为另一类 Run Output，只在运行记录中保存 candidate ID、scope、类型、状态和内容哈希；候选正文、来源引用与裁决信息保存在 Aria 自己的业务表；
- 对话消息可以提交项目候选，但默认状态始终为 `pending`；项目/客户权限在创建与裁决时重新校验，接受后才写正式记忆版本，拒绝不会改变正式记忆；
- accepted 项目和客户内容同时记录为受保护锚点，后续 AI 重建会与新模型输出确定性合并，避免“用户已经确认的记忆被下一次总结覆盖”；
- 前端 Run Activity Store 对 Artifact 与 Candidate 采用 Item ID upsert，同一个生命周期事件重放不会产生重复卡片。

本阶段新增 Alembic `026_v1_26`，只做加法迁移；生产数据库测试继续在完整备份后使用独立 `ariaai_test_*` schema，测试结束删除该 schema 并比较 `public` 表与 revision 签名。Aria 没有引入 Codex Response API、协议类型、Analytics 服务或任何运行时依赖。

### 4.18 Knowledge Evidence Manifest 与引用闭环

Phase 2Q 从 Codex 的 typed `ResponseItem::WebSearchCall`、`WebSearchItem` 和稳定 Item ID 边界中吸收“检索动作、检索结果、模型正文与可展示引用必须是不同对象”的原则，并改写为 Aria 原生 `KnowledgeEvidenceManifest v1`：

- 每个进入 Provider 上下文的知识块按文档 ID、chunk index 与内容 SHA-256 生成稳定 `evidence_id`，并按本轮检索顺序获得不可跳号的 `K1/K2/...`；
- Prompt 明确要求模型只使用本轮存在的 `[K*]`，证据不足时显式说明，同时把检索内容标为 untrusted source data，禁止执行文档内指令；
- Evidence Manifest 最多保存 12 条有界元数据，只包含文档 ID、标题、chunk index、相似度、引用键和内容摘要，不保存 query 或检索片段原文；
- Persist 对最终正文做确定性引用解析，只把真实出现且能回指 Manifest 的来源写入 `references` 并发送 Product Run Event `reference_delta`；未知键记录为 invalid，未引用检索上下文记录为非阻断质量警告；
- 两个聊天前端使用后端给出的 `K*`，不会在过滤来源后错误重编号；旧消息仍兼容 `[1]` 数字标签，异常或含原文的旧引用 payload 会在持久化边界被收敛为安全字段；
- Run Evaluation、Chat Trace 和 Artifact Run Output 共享 Evidence Manifest 摘要，使交付物能追溯到本轮知识证据，而不复制客户材料正文；
- 显式 `rag_doc_ids` 与环境检索统一应用用户的 `ProjectMember` 项目清单；无权项目/客户文档即使 ID 被猜中也不会进入相似度计算或 Prompt，workspace/global 文档仍按既有规则可用。

本阶段没有新增数据库字段或迁移；完整 Evidence Manifest 随 Assistant Message 元数据保存，生产数据库验收在备份后的独立 schema 中覆盖引用持久化和跨项目检索隔离。Aria 没有引入 Codex Web Search、Responses API、协议类型或运行时。

### 4.19 Knowledge Job 持久恢复与状态闭环

Phase 2R 从 Codex 的语义错误分类和指数退避边界中吸收“只有短暂错误才自动重试”的原则，并改写为 Aria 原生的知识导入恢复机制：

- 上传、手动重建和知识源同步都先创建数据库 job，稳定幂等键和部分唯一索引阻止同一目标并发重复执行；
- worker 获取有时限的 lease，过期的 `running` job 可被定时器回收，未过期任务不会被其他 worker 抢占；
- extraction、understanding、chunk、embedding 和 indexed 阶段保存有界 checkpoint，重启后复用已持久化的中间结果，并使用幂等 chunk/模板提取写入；
- 网络、I/O 和短暂服务错误按可配置上限退避，格式、权限、文件缺失等永久错误直接失败关闭；用户仍可对已用尽自动尝试的短暂错误发起显式重试；
- API 和前端只暴露阶段、尝试次数、安全错误码与可重试标记，不返回 job payload、checkpoint、本地路径或文档原文；
- 知识库页面轮询活动任务，展示阶段进度、尝试次数和可恢复入口；旧版文档继续显示，不因 v0.0.5 source API 上线而消失。

本阶段使用加法迁移 `027_v1_27`扩展现有 `knowledge_job`；生产验收仍在完整备份后使用隔离 schema，结束后比对 `public` 表与 revision 签名。Aria 不运行、不导入、不连接 Codex，也没有新增第二个队列或数据库。

### 4.20 历史知识的验证后迁移与权限收口

Phase 2S 把 Codex apply-patch 的“先冻结基线、写入前重新验证”和 Rollout 的“逐项 checkpoint、重启后按事实恢复”改写为 Aria 原生知识迁移：

- 管理员预检旧 `KnowledgeDocument` 的业务 scope、文件类型、文件存在性、大小和 SHA-256，API 只返回安全清单，不返回 storage path 或内容；
- plan fingerprint 绑定全部待迁移事实，预检后文件或数据库记录发生变化时拒绝按旧计划继续执行；
- 迁移任务使用 Phase 2R 的 lease、重试和 checkpoint，每批最多 500 份，产品入口默认每批 100 份；
- 原文件复制到新的 source-scoped storage key，旧文件、旧记录和旧 chunk 均不删除，因此旧版本代码仍可回退；
- 同一 scope 下相同 content hash 复用一个新文档，多条旧记录通过 `knowledge_legacy_migration` 映射表保持独立审计身份；
- 项目文档、客户文档和 workspace 文档分别进入对应 scope；旧列表、上传、删除、重建、统计与 query API 同时补齐成员权限检查；
- 迁移成功后前端显示新文档并隐藏其旧副本；管理员能看到 ready / migrated / blocked 和活动任务状态，普通用户没有迁移控制入口。

本阶段使用加法迁移 `028_v1_28` 新增映射表和 source external key；不自动迁移、不删除生产数据，只有管理员提交与当前预检一致的 fingerprint 才会启动。Aria 不运行、不导入、不连接 Codex。

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

### Phase 2I：只读工具并发车道与写入屏障（已实施）

参考候选：

- `codex-rs/core/src/tools/parallel.rs`；
- `codex-rs/core/src/tools/orchestrator.rs`；
- `codex-rs/core/tests/suite/tool_parallelism.rs`。

已完成：建立只读工具的显式并发能力声明、权限二次校验、有界连续批次、写入/审批顺序屏障和完成顺序无关的确定性结果合并。目前仅项目通用文件与 Markdown 读取获得并发资格，并通过工作线程避免阻塞事件循环。未标记工具默认顺序，不新增通用 shell、Codex runtime 或数据库迁移。

### Phase 2J：用户中断与可验证终止边界（已实施）

参考候选：

- `codex-rs/core/src/tasks/mod.rs`；
- `codex-rs/core/src/context/turn_aborted.rs`；
- `codex-rs/core/tests/suite/abort_tasks.rs`。

已完成：停止生成从浏览器本地 `AbortController` 升级为经过 Conversation 写权限校验的 Aria Run 取消；模型流中的部分文本、中断原因、工具可能部分执行提示、Step cancelled checkpoint、Assistant Message 和 `run_cancelled` 终态形成同一持久化边界；两个聊天入口均已接通，并保留浏览器断流兜底。实现不调用 Codex、不新增数据库迁移，继续复用 Aria 的 Message 与 TaskRun/TaskStep/TaskEvent。

### Phase 2K：单轮执行预算与停止边界（已实施）

参考候选：

- `codex-rs/ext/goal/src/accounting.rs`；
- `codex-rs/ext/goal/src/runtime.rs`；
- `codex-rs/core/src/tools/orchestrator.rs`。

已完成：为普通聊天建立共享的 Step、计划工具调用和墙钟预算；模型流、重试等待和工具批次共用一个截止时间；超限时原子停止新工具、保存部分输出和预算证据、标记不可重试失败，并阻止 Persist 启动新的补偿性模型或写入工作。配置可通过 `AGENT_TURN_MAX_STEPS`、`AGENT_TURN_MAX_TOOL_CALLS`、`AGENT_TURN_TIMEOUT_SECONDS` 调整并受代码硬上限保护。不运行、不导入、不连接 Codex，不新增数据库迁移。

### Phase 2L：完成证据裁决与可验证终态（已实施）

参考候选：

- `codex-rs/core/src/context/guardian_review_evidence.rs`；
- `codex-rs/prompts/templates/review/rubric.md`；
- `codex-rs/protocol/src/review_format.rs`。

已完成：在 Persist 与成功终态之间加入确定性证据裁决，把预算、工具、交付物、策略、审批、Step 和输出完整性收敛为结构化 `run_evaluation`；证据失败时保存现有结果和裁决摘要，但只发送 `run_failed / RUN_EVALUATION_FAILED`，不再发送 `run_done(completed)`。实现不调用模型或 OpenAI Evals API，不保存原始工具参数/结果，不运行、不导入、不连接 Codex，也不新增数据库迁移。

### Phase 2M：工具执行台账与统一结果契约（已实施）

参考候选：

- `codex-rs/core/src/tools/executed_tool_calls.rs`；
- `codex-rs/protocol/src/models/executed_tool_calls.rs`；
- `codex-rs/core/src/tools/events.rs`。

已完成：新增 Aria 原生 `ToolExecutionRecord v1`，所有普通工具、文本回退工具、Persist 补偿工具和 Durable Task 工具都经过同一写入边界；`tool_use_id` 将 planned 与 terminal 状态合并，`outcome` 为 Rollout、完成裁决和时间线提供统一判定。长期台账只允许保存摘要、错误、审批、重试和耗时字段，拒绝原始 `input/tool_input/output`；记录超过 256 条或 32 KiB 时优先保留最近证据，并用本地生成、调用方不可伪造的 marker 记录省略数量。前端重复工具按 `tool_use_id` 区分，不再错误覆盖同一步内的同名调用。实现不调用 Codex、不新增数据库迁移。

### Phase 2N：工具能力清单与产品事件映射（已实施）

参考候选：

- `codex-rs/core/src/tools/registry.rs`；
- `codex-rs/core/src/tools/router.rs`；
- `codex-rs/core/src/tools/parallel.rs`；
- `codex-rs/core/src/tools/tool_dispatch_trace.rs`。

已完成：为现有 17 个 Aria 工具建立 `ToolCapabilityManifest v1`，统一声明 display name、项目作用域、操作级 ActionPolicy、副作用、只读并行、重试模式、结果类型和 Product Run Event；注册时校验名称与 JSON object schema、绑定 schema SHA-256 并拒绝重复名称，未分类工具默认按 `destructive_action + serial + never retry` 失败关闭。Policy Guard、Tool Scheduler、Agent Executor、Persist 真值门、工具审计和前端产品事件标题均改为读取同一事实源；Artifact 在提取时携带 `source_tool/product_event`，持久化后的 `artifact_ready` 可追溯到来源工具。该批同时补齐 `manage_pdf` 的项目作用域注入，并关闭 Office 编辑、PDF 写操作与文档翻译误落入只读默认策略的缺口。实现不调用 Codex，不新增数据库迁移。

### Phase 2O：上下文组装清单与请求绑定（已实施）

参考候选：

- `codex-rs/core/src/context/world_state/mod.rs`；
- `codex-rs/core/src/context_manager/history.rs`。

已完成：新增 `Context Assembly Manifest v1`，把 Context Builder 与 Runtime 的业务来源、最终 Provider 输入、预算结果和压缩状态绑定到一个有界、无原文、可校验的清单；首个模型请求前再次核对 system/messages/tools 指纹，Trace、Run Rollout 和完成裁决消费同一清单。来源最多 24 个，Manifest 仅含安全元数据与 SHA-256，失败时在调用模型或报告完成之前关闭。实现不调用 Codex、不新增数据库迁移。

### Phase 2P：Run Output 与 Memory Candidate 持久化闭环（已实施）

参考候选：

- `codex-rs/protocol/src/models.rs`；
- `codex-rs/analytics/src/facts.rs`。

已完成：新增有界、无原文的 `RunOutputRecord v1`，通过 `output_id` 连接工具产出、真实文件校验、`GeneratedFile`、Product Run Event、Activity Timeline、Rollout 和完成裁决；缺失或越界文件不能再以大小 0 的附件冒充交付成功。新增来源关联的 Memory Candidate 表与审核 API，项目聊天只提交 pending 候选，项目记忆页执行 accept/reject；accepted 内容写入带版本 snapshot 的正式记忆并在后续重建中保留。实现只借鉴 Item 与生命周期边界，不运行、不导入、不连接 Codex；数据库变更由加法迁移 `026_v1_26` 管理。

### Phase 2Q：Knowledge Evidence 与引用闭环（已实施）

参考候选：

- `codex-rs/protocol/src/models.rs`；
- `codex-rs/protocol/src/items.rs`。

已完成：新增无原文、可校验的 `KnowledgeEvidenceManifest v1`，将检索片段、模型引用、持久化来源和 Artifact provenance 绑定到稳定 evidence identity；只显示最终正文实际使用的合法 `[K*]` 来源，未知/缺失引用进入确定性完成质量检查。显式文档 ID 与自动 RAG 均在 Prompt 注入前应用项目/客户成员边界，两个聊天前端共享 canonical citation key。实现不调用 Codex，不使用其 Web Search 或协议，不新增数据库迁移。

### Phase 2R：Knowledge Job 持久恢复（已实施）

参考候选：

- `codex-rs/protocol/src/error.rs`；
- `codex-rs/core/src/util.rs`。

已完成：把知识文档导入、重建和 source sync 收口为 Aria 原生持久任务，通过幂等键、租约、心跳、过期回收、阶段 checkpoint、语义失败分类与有界退避实现可恢复执行；补齐 source/document/job/event/template/search API 和前端状态可见性。原始 payload、checkpoint、文档内容与本地路径不进入 API 状态。迁移由 `027_v1_27` 管理；实现不运行、不导入、不连接 Codex。

### Phase 2S：历史知识受控迁移（已实施）

参考候选：

- `codex-rs/apply-patch/src/file_update.rs`；
- `codex-rs/rollout/src/recorder.rs`。

已完成：新增管理员预检与 fingerprint 确认、持久迁移任务、逐文档映射审计、无损文件复制、内容去重、漂移拒绝和前端批次状态；旧管理 API 统一应用项目/客户成员边界。迁移成功后页面只显示 source-scoped 文档，旧记录和原文件仍保留供回退。数据库变更由 `028_v1_28` 管理；实现不运行、不导入、不连接 Codex。

### Phase 2T：本轮 Skill 生命周期与用户回执（已实施）

参考候选：

- `codex-rs/skills/src/mentions.rs`；
- `codex-rs/skills/src/selection.rs`；
- `codex-rs/core/src/session/turn.rs`。

已完成：把 `Conversation.skill_id` 从永久注入开关改为可续接元数据，只有相关追问、当前 Skill 明确提及或高置信相关工作流才在本轮继续生效；普通无关问题、话题切换和显式停用会释放旧关联，新工作流仍可切换到新的唯一高置信 Skill。`ChatRuntime`、`run_started` 和 Chat UI 现在共享实际 Skill ID、名称与来源，用户能看到显式启用、自动匹配或相关追问沿用的运行回执。实现不调用 Codex、不新增数据库迁移。完整差距矩阵和后续路线见 `docs/22-项目对话与Skill交互全量优化方案.md`。

### Phase 2U：Conversation Capsule 与指令优先级（已实施）

参考候选：

- `codex-rs/core/src/context_manager/history.rs`；
- `codex-rs/core/src/context/world_state/mod.rs`；
- `codex-rs/core/src/session/turn.rs`；
- `codex-rs/codex-home/src/instructions/mod.rs`。

已完成：新增 Provider-neutral `Conversation Capsule v1`，每轮从现有 `ConversationState` 和消息元数据确定性重建，保留当前目标、Turn 模式、交付物/任务、有效约束、决策、工具结果、未解除阻塞与下一目标；胶囊绑定会话/项目/来源消息并形成上一胶囊哈希链，跨项目状态不续接，工具输入、完整输出、服务器路径和隐藏推理不进入胶囊。用户明确重述语气、详略、格式、语言或写入策略时，同维度旧约束会被永久撤销，普通追问仍保留其他确认约束。

同时新增八层 `InstructionManifest v1`，固定平台规则 > 本轮用户要求 > 项目作用域 > 当前任务状态 > 有效 Skill > 用户偏好 > 工作区证据 > 历史 Capsule；Context Assembly、Message、ChatTrace 和 Run Evaluation 共享其无原文指纹清单与 Capsule 证据。实现复用现有 JSON 字段，不调用 Codex 或 Provider 专属远程压缩，不新增数据库迁移。完整交互规范见 `docs/22-项目对话与Skill交互全量优化方案.md`。

### Phase 2V：运行中 Steering 与理解回执（已实施）

参考候选：

- `codex-rs/core/src/session/turn_input.rs`（上游提交 `83d1fe0e67b1323f71febc2925817732b449f1d9`）。

已完成：新增 Aria 原生 `expected_run_id` 绑定的文本追加入口、受限 active-run mailbox、模型/工具批次安全边界注入和终止态拒绝；新要求在工具提交前到达时，旧的未执行工具计划会被配对标记并停止，下一模型步骤基于已完成事实重新规划。Steering 只能保持或收紧本 Run 权限，不能在运行中扩大能力；明确的“不执行/不写入/只做计划”会确定性移除后续工具与写入能力。追加消息、Assistant metadata、ChatTrace 和 Activity Timeline 共享 steering identity、序号与内容摘要。

同时新增由 `TurnContract` 生成的 `turn_receipt`，在模型开始前向用户展示本轮目标、回答/规划/执行模式、作用范围、预期结果、写入与确认策略；两个对话入口运行中保留“追加到当前任务”和独立“停止”动作。实现不暴露提示词或隐藏推理，不运行、不导入、不连接 Codex，不新增数据库迁移。

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
