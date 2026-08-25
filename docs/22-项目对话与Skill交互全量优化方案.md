# 项目对话与 Skill 交互全量优化方案

> 更新日期：2026-08-25
> 对照基线：OpenAI Codex `83d1fe0e67b1323f71febc2925817732b449f1d9`
> 产品边界：只吸收源码机制，不运行、不调用、不连接 Codex。

## 1. 结论

Aria 当前最薄弱的不是“模型不够强”，而是模型前后的交互控制还没有完全形成一个用户可理解、系统可验证的闭环。项目上下文、Skill、记忆、RAG、工具和执行记录已经具备较好的工程基础，但此前仍有两个会直接破坏交互信任的问题：

1. `Conversation.skill_id` 被当成永久生效开关。用户切换话题后，旧 Skill 仍可能静默改变后续回答。
2. 后端自动匹配或沿用 Skill 时，聊天页不知道本轮实际使用了哪个 Skill，也不能解释它为何被启用。

Phase 2T 先关闭这两个缺口，Phase 2U 进一步补上长对话状态和指令冲突治理。长期目标则是让每一轮项目对话都能回答五个问题：

- 我理解你现在要什么？
- 我正在使用哪些项目事实、文件、记忆和 Skill？
- 我准备回答、规划，还是直接执行？
- 哪些动作已经完成，哪些仍需确认或失败？
- 下一轮继续时，需要保留什么，应该释放什么？

## 2. Codex 可借鉴能力全量地图

| 能力层 | Codex 参考路径/机制 | 值得借鉴的原则 | Aria 当前状态 | Aria 后续动作 |
|---|---|---|---|---|
| 本轮输入边界 | `core/src/session/turn_input.rs`、`session/turn.rs` | 每轮输入是新的决策边界；追加上下文、纠偏和开始新轮次必须可区分 | 已有 `SendMessageRequest`、Turn Contract | 增加结构化“本轮目标/约束/引用对象”输入，不依赖纯文本猜测 |
| 项目指令层级 | `codex-home/src/instructions/mod.rs` | 全局、项目、目录指令按明确层级加载，越近的规则越具体 | Phase 2U 已建立显式 `InstructionManifest v1` | 后续把简化冲突回执开放给前端，持续扩充跨层冲突评测 |
| Skill 发现 | `skills/src/loading.rs`、`parser.rs` | 先发现元数据，命中后再加载完整内容；坏包隔离 | 已完成 Skill Root 快照、发布态目录、解析校验 | 增加作者预览、依赖校验、样例输入和质量评分 |
| Skill 本轮选择 | `skills/src/mentions.rs`、`selection.rs` | 只解析本轮结构化输入和显式提及；去重后注入本轮 | Phase 2Y 已补齐自动/指定/禁用三态与歧义候选确认 | 后续增加输入框内的结构化对象引用与键盘检索 |
| Skill 续用/释放 | Codex 的 per-turn selection boundary | Skill 不是会话永久所有者；是否续用应由本轮相关性决定 | Phase 2T 已实现相关追问续用、无关话题释放、显式退出 | 用真实匿名交互数据持续校准续用词与误触发率 |
| Skill 可见性 | Turn 内 Skill 注入项 + 运行事件 | 用户应知道本轮实际加载了什么能力 | Phase 2Y 已支持项目内选择、歧义点选和一键关闭/切换 | 持续把内部匹配原因翻译为更具体的业务说明 |
| 项目世界状态 | `core/src/context/world_state/` | 把工作目录、规则和环境变化建模为基线与差异，不把所有内容反复塞入 Prompt | 已有项目/客户结构化上下文与 Context Assembly Manifest | 增加项目状态版本、变化摘要和陈旧证据提示 |
| 对话历史治理 | `core/src/context_manager/history.rs` | 保持工具调用/结果配对，压缩时保留任务状态和恢复边界 | Phase 2U 已用结构化 Capsule 绑定目标、约束、工具结果、阻塞和来源消息 | 扩大真实长对话集，并在压缩前后自动比较状态保持率 |
| 长对话压缩 | Context compaction 与状态续接 | 压缩结果必须保留目标、已完成动作、假设、标识、工具结果、阻塞与下一步 | Phase 2U 已建立 Provider-neutral `Conversation Capsule v1`，仍使用确定性本地预算压缩 | 先积累 Provider 对比数据，再决定是否按模型启用官方 Compaction API |
| 计划与执行 | `session/turn.rs` 的 turn loop、任务状态 | 计划、执行、反馈和完成应有状态边界，用户纠偏可进入当前轮次 | 已有 Intent/Turn/Artifact Contract、Agent Loop、Durable Task | 给用户展示简洁执行契约，并支持“只改计划、不重开任务” |
| Steering | `session/turn_input.rs` 的 steer + expected turn id | 用户追加要求必须绑定正确运行，防止发给已经结束或另一个 Run | 已有 stop/cancel 和 run id，普通追加仍是新消息 | 增加运行中追加指令队列与 expected run id 校验 |
| 中断与恢复 | Task abort、rollout reconstruction | 停止不是删掉结果；应保存部分输出、已执行副作用和可恢复状态 | 已完成用户中断、Rollout、恢复规划 | 前端提供“从中断点继续”而非只显示失败 |
| 工具协议 | tool call/result pairing、registry、parallel lanes | 工具定义、权限、调度和回填必须共享同一事实源 | 已完成 Tool Capability Manifest、转录规范化、只读并行 | 增加面向用户的工具原因和影响说明 |
| 审批边界 | approvals、sandboxing、exec policy | 技术可执行不等于产品允许；动作在执行前应重验 | 已完成三态策略、HITAS、审批信封 | 统一聊天页与项目页审批体验，增加批量影响摘要 |
| 运行事件 | 结构化 turn/item/event 流 | 文本只是结果之一；步骤、工具、交付物、错误需要独立事件 | 已有 Product Run Event v1、Context Receipt 和时间线 | 逐步淘汰旧 status 特例 |
| 完成裁决 | review evidence、structured findings | “模型说完成了”不能作为完成事实 | 已完成 Run Evaluation 和 Output Record | 建立任务类型专属 QA rubric 与失败修复入口 |
| 回归评测 | Codex 测试套件的场景化不变量 | 真实交互质量要用固定场景和边界条件衡量 | 已有 router/Skill golden cases | 建立项目对话多轮 golden set、误触发集、长对话续接集 |

## 3. 不能直接照搬的部分

| Codex 组件 | 决策 | 原因 |
|---|---|---|
| Codex App Server、SDK、JSONL 协议 | 不采用 | 会形成第二运行时，与 Aria 原生 Harness 冲突 |
| Codex Thread/Turn/Item 存储模型 | 不直接采用 | Aria 已有 Conversation、Message、TaskRun、Rollout 和业务实体 |
| Rust shell sandbox | 当前不采用 | Aria 执行结构化业务工具，不开放通用终端 |
| Codex 模型认证与客户端 | 不采用 | Aria 是多 Provider 产品，不能绑定单一模型体系 |
| Codex 原生 memory | 不采用 | Aria 的用户、客户、项目和咨询工作记忆更符合产品域 |
| IDE、CLI、Cloud 产品层 | 不采用或不可复用 | Aria 的入口是 Web 工作台，且部分组件不属于开源边界 |

“可以复用源码”的正确方式是复用小型、内聚、可测试的机制，并翻译到 Aria 的 Python/React 架构中；不是复制整个 Codex 目录或让 Aria 启动 Codex。

## 4. 项目对话的目标架构

```text
本轮用户输入
  ├─ 显式对象：项目 / 文件 / Skill / 交付物
  ├─ 本轮目标：回答 / 规划 / 执行 / 修改 / 删除
  └─ 本轮约束：不要执行 / 格式 / 时间 / 范围
        ↓
Turn Understanding
  ├─ Intent Contract
  ├─ Artifact Contract
  ├─ Skill Activation Decision
  └─ Ambiguity / Confirmation Decision
        ↓
Context Assembly
  ├─ 系统与产品规则
  ├─ 用户偏好
  ├─ 项目/客户结构化事实
  ├─ 对话 Continuation Capsule
  ├─ 已选 Skill
  ├─ 文件与 RAG 证据
  └─ 工具与权限清单
        ↓
Agent Loop / Durable Task
        ↓
Product Run Events
  ├─ 本轮理解回执
  ├─ Skill / Context 回执（实际 Skill、记忆新鲜度、证据计数与告警）
  ├─ 计划、工具、审批、交付物
  └─ 完成 / 部分完成 / 失败 / 已中断
        ↓
Message + Rollout + Evaluation + Next-turn Capsule
```

## 5. Skill 生命周期规范

| 当前输入 | 本轮行为 | 会话关联状态 | 用户可见回执 |
|---|---|---|---|
| 用户明确选择并运行 Skill | 启用 | 绑定当前 Skill | `已启用 Skill：…` |
| 未选择，但高置信匹配唯一 Skill | 自动启用 | 绑定命中 Skill | `已自动匹配 Skill：…` |
| “继续、沿用刚才格式、补充行动项” | 仅在相关追问时续用 | 保留 | `已沿用相关 Skill：…` |
| 普通无关问题 | 不注入旧 Skill | 释放旧关联 | 不展示 Skill 回执 |
| “换个话题/另一个问题” | 不注入旧 Skill；允许匹配新任务 | 释放或切换 | 仅命中新 Skill 时展示 |
| “不用这个 Skill/回到普通对话” | 强制停用且不自动重选 | 清除 | 后续按普通对话处理 |
| 多个同分候选 | 不猜 | 不改变 | 后续应展示候选让用户选 |

Phase 2W 进一步允许专业问答在唯一、高置信、无近似竞争候选时自动加载咨询 Skill。它只增强回答所需的方法论提示：问题仍按 `direct_answer` 或 `read_only_tool` 处理，自动 Skill 不得把工具权限升级到 `write_allowed`。通用“为什么需要 PPT”之类的弱信号问题不会启用制作类 Skill；高分并列或近似候选会返回歧义回执，不静默猜测。

关键不变量：

- 数据库里的 `Conversation.skill_id` 只表示可续接的最近 Skill，不代表永久 Prompt 注入权。
- 后端的有效 Skill 才是本轮事实源；前端选择框不能冒充实际运行结果。
- 每次 Skill 运行都要在 `run_started` 中回传名称、ID 和来源。
- Skill 未实际生效时，不得在消息元数据中伪造 Skill 进度。

## 6. 上下文优先级与冲突裁决

建议把上下文从简单字符串拼接升级为以下显式优先级：

1. 安全、权限和产品系统规则。
2. 本轮用户明确要求与否定约束。
3. 项目/客户作用域及访问权限。
4. 当前交付物与已确认任务状态。
5. 显式选择或本轮有效的 Skill 指令。
6. 用户长期偏好。
7. 项目结构化记忆与文件/RAG 证据。
8. 对话摘要和最近消息。

冲突时应遵守：本轮明确要求优先于历史偏好；权限规则优先于 Skill；证据事实优先于历史摘要；未确认候选不能冒充正式记忆。

## 7. Conversation Capsule v1（已实施）

长对话不能只保留最近 24 条，也不能用一段自由文本摘要代替状态。Phase 2U 已建立可版本化、Provider-neutral 的续接胶囊：

```json
{
  "schema_version": 1,
  "conversation_id": 42,
  "project_id": 7,
  "active_goal": "当前要完成的业务目标",
  "turn_mode": "answer_only | plan_only | execute_now",
  "active_artifact": {"id": "...", "type": "pptx", "status": "draft"},
  "confirmed_constraints": ["不修改原文件"],
  "decisions": ["使用三阶段路线图"],
  "tool_outcomes": [{"tool_use_id": "...", "status": "completed", "summary": "..."}],
  "blockers": [],
  "next_goal": "补齐价值测算",
  "source_message_ids": [101, 102],
  "previous_capsule_sha256": "...",
  "capsule_sha256": "..."
}
```

胶囊由确定性字段与有界摘要组成，绑定会话、项目、来源消息、上一胶囊哈希和当前指纹；只保留安全的 Artifact/Task 字段和工具结果摘要，不保存工具输入、完整输出、服务器路径或隐藏推理。相同工具后续成功不能自动抹掉旧失败，只有通过 `retry_of_tool_use_id` / `recovery_of_tool_use_id` 显式关联才解除阻塞。

每轮 Runtime 从 `ConversationState` 与消息元数据重建胶囊，P4 完成时写回当前工具结果与 Assistant 摘要。当前用户指令是新的裁决边界：明确重述语气、详略、格式、语言或写入策略时，只撤销同维度的旧约束；“不用、不要、取消、改为”等否定/切换表达也按同一规则处理。普通续接不会清空无关要求。跨项目历史胶囊一律不继承。

`InstructionManifest v1` 同时固定八层优先级：平台规则、本轮用户要求、项目作用域、当前任务状态、本轮有效 Skill、用户偏好、工作区证据、历史 Capsule。持久清单只记录层 ID、优先级、作用域、字符数和 SHA-256，不保存原始 Prompt。模型侧明确把项目/RAG/工具结果/历史摘要视为数据而不是可执行指令。

## 8. 让用户更容易和 AI 交互的产品改进

### 8.1 输入前

- 项目页默认携带项目作用域，并明确显示“当前项目”。
- Skill 选择不只展示名称，还展示适用场景、需要的输入和预期交付物。
- 输入框支持结构化引用项目文件、干系人、里程碑和已有交付物。
- 提供“只回答 / 先计划 / 直接执行”三种轻量意图开关，但自然语言仍可覆盖。

### 8.2 执行中

- 首个回执显示本轮模式、实际 Skill 和是否会写入项目。
- 自动选择必须说明来源；歧义时不静默猜测。
- 用户能在运行中补充约束，补充内容绑定当前 `run_id`。
- 工具状态用业务语言表达，例如“正在读取风险登记表”，而不是内部函数名。

### 8.3 完成后

- 区分正文、交付物、记忆候选、待确认动作和未完成事项。
- 明确列出“已完成 / 未完成 / 需要你确认”。
- 提供“继续完善当前交付物”和“换个话题”两个不会混淆状态的入口。
- 允许用户查看简化 Context Receipt，但不暴露系统 Prompt、服务器路径或敏感原文。

## 9. 评测体系

仅测试单轮答案不够。项目对话至少需要以下固定评测集：

| 评测集 | 核心指标 | 代表案例 |
|---|---|---|
| Skill 正确触发 | precision、recall、歧义拒绝率 | “整理会议纪要”命中；“项目风险是什么”不命中旧 Skill |
| Skill 多轮生命周期 | 续用正确率、释放正确率 | 相关追问继续；换话题释放；显式停用立即生效 |
| 项目事实引用 | 事实正确率、来源覆盖率、越权率 | 仅使用当前项目可访问事实 |
| 对话续接 | 目标保持率、约束保持率 | 长对话压缩后仍记得“不修改原文件” |
| 计划/执行边界 | mode 准确率、副作用误触发率 | “先给计划”不能写文件；“直接生成”应交付文件 |
| 用户纠偏 | steering 生效率、错 Run 拒绝率 | 运行中补充“控制在十页”只影响目标 Run |
| 工具与交付 | 工具成功率、虚假完成率 | 文件未持久化不得报告完成 |
| 中断恢复 | 部分结果保留率、重复副作用率 | 停止后继续不能重复写文件 |
| 交互可解释性 | Skill/模式/写入回执覆盖率 | 自动 Skill 必须展示，普通回答保持安静 |

每个生产问题都应先转成匿名化 golden case，再调整规则或 Prompt。这样优化的是系统，不是某次偶然回答。

## 10. 分阶段路线图

### Phase 2T：本轮 Skill 生命周期与运行回执（已实施）

- 相关追问才续用会话 Skill；
- 无关问题、换话题和显式退出释放旧 Skill；
- 新任务仍可自动切换到唯一高置信 Skill；
- `ChatRuntime` 保存实际 Skill ID、名称、来源和决策原因；
- `run_started` 向前端回传实际 Skill 与来源；
- 聊天页展示“显式启用 / 自动匹配 / 相关追问沿用”，并把实际 Skill 写入消息元数据；
- 增加路由、事件和前端回执回归测试；
- 无数据库迁移。

### Phase 2U：Conversation Capsule 与上下文优先级（已实施）

- 已建立 `Conversation Capsule v1`，保存目标、模式、当前交付物/任务、有效约束、已完成决策、工具结果、阻塞和下一目标；
- 已用会话、项目、来源消息、上一胶囊哈希和当前 SHA-256 防止错链或篡改；
- 已建立八层 `InstructionManifest v1`，当前用户要求可覆盖历史/偏好/Skill 默认值，但不能越过平台策略；
- 已将 Capsule、Instruction Manifest 接入 Context Assembly、Message Metadata、ChatTrace 和 Run Evaluation；
- 已增加多轮约束保持、显式覆盖、跨项目隔离、工具失败恢复、隐私与篡改拒绝测试；
- 复用现有 `ConversationState` 和 `Message.metadata_json`，无数据库迁移，也不调用 Provider 专属远程压缩。

### Phase 2V：运行中 Steering 与理解回执（已实施）

- 支持绑定 `expected_run_id` 的追加要求；
- 在模型开始前展示简洁 Turn Receipt；
- 用户可修正范围、格式和交付物，不必终止并重开整个任务；
- 错 Run、已终止 Run 或越权追加全部拒绝。

实施结果：

- 新增 `POST /chat/runs/{run_id}/steer`，正文必须同时携带相同的 `expected_run_id`；服务端先按当前 Run 的会话做写权限校验，再接受文本追加；
- 追加内容作为普通 `Message(role=user)` 保存，并带 `aria.run_steering.v1` 审计元数据；当前 Agent Loop 只在模型请求或工具批次之间的安全边界取出，不修改正在进行的 Provider 流；
- 新要求若在工具执行前到达，尚未执行的旧工具计划会被停止并由下一模型步骤重规划；已完成动作与真实结果不会被覆盖或伪装成未执行；
- Steering 只能保持或收紧本 Run 的能力边界，不能扩大权限；“不要执行/不要写入/只做计划”等纠偏会确定性移除后续工具与写入能力，并刷新 Turn Receipt；
- 新增 `turn_receipt` 与 `steering_applied` Product Run Event，两个聊天入口都展示本轮目标、模式、范围、写入/确认策略，并在可追加阶段保留输入框和独立停止按钮；
- Receipt 只来自 Aria `TurnContract`，不包含系统提示词、隐藏推理、工具参数或 Provider 状态；Steering 绑定 Aria `run_id`，不启动、不导入、不连接 Codex；
- 使用现有 `Message.metadata_json`、Assistant metadata、Activity Timeline 与 ChatTrace 完成审计，无数据库迁移。

### Phase 2W：项目问答、记忆与 Skill 质量门禁（已实施）

- 专业问答不再一律跳过 Skill 自动匹配：舞弊、审计、税务、尽调、会议等高信号问题可启用唯一匹配的 Skill，普通项目问题和弱信号制作词仍保持普通问答；
- 增加近似高分候选拒绝机制。存在歧义时不改变会话 Skill，并通过 Context Receipt 给出最多三个候选；
- 自动命中的咨询 Skill 只提供 advisory 方法论，确定性测试保证其 action policy 仍为直接回答/只读，绝不因 Skill 自动匹配获得写权限；
- 陈旧项目/客户记忆在模型上下文中被显式标为 `STALE`，要求优先采用更新的里程碑、待办、进展、文件与本轮输入，并在依赖陈旧综合结论时说明限制；
- 新增隐私安全的 `context_receipt` Product Run Event，两个聊天入口展示项目记忆版本与新鲜度、实际 Skill 用法、知识引用/历史/文件等证据计数以及歧义或压缩告警；相同回执进入 Assistant metadata、Activity Timeline、ChatTrace 和 Run Evaluation，但不保存提示词、记忆正文、文件内容、工具参数或隐藏推理；
- 新增 17 个确定性发布门禁案例，CI 输出 `skill_selection_accuracy`、`skill_lifecycle_accuracy`、`advisory_skill_safety_rate`、`memory_freshness_guard_rate` 和 `constraint_retention_rate`；任一指标低于 100% 即失败；
- Eval 使用进程内临时 SQLite，不读取配置数据库，不调用 Provider；生产数据库仍只在备份后的隔离 E2E 中验证真实迁移和服务链路；
- 使用现有项目记忆字段、消息 metadata、时间线与 Trace，无数据库迁移，不启动、不导入、不连接 Codex。

边界说明：上述确定性门禁验证的是 Aria 的上下文、Skill 与权限控制层，不等价于证明任意 Provider 回答的事实正确率已经达到 100%。

### Phase 2X：按问题项目记忆证据与 Provider 质量评测（已实施）

- 项目记忆不再无条件全量注入；根据风险、交付、财务、干系人、文档和概览等问题切面精选槽位，用户明确要求全量时才切换到 `full`。
- 建立 `Project Memory Evidence Manifest v1`：记忆正文只进入当次 Provider 上下文，消息、Trace、Artifact 和评测只保存项目/版本/槽位/索引/SHA 及稳定 `[M*]` 引用键。
- 最终回答只显示实际回指且校验通过的记忆来源；无引用、非法引用或 Manifest 被篡改会进入 Run Evaluation finding。
- Context Receipt 展示 `focused/overview/full`、命中切面、选中槽位数、记忆证据数与截断告警，但不暴露记忆正文、Prompt 或隐藏推理。
- 确定性质量门禁扩展到 22 个场景，新增 `memory_retrieval_precision_rate`，发布前必须为 100%。
- 新增独立手动工作流 `Provider Grounded QA Eval`，在已部署后使用当前配置的真实 Provider/模型运行 4 组合成项目事实问答，评分 `factual_accuracy`、`citation_coverage`、`unsupported_claim_rate` 和 `abstention_accuracy`。
- 引用合约要求每个事实在同一行/句内使用 ASCII `[E*]`（生产中为 `[K*]` / `[M*]`）；全角括号、独立来源列表或与对应事实分离的引用不计入覆盖率。评分器允许等价语序/表达，但不放宽来源绑定。
- Provider 评测不读取生产项目正文、不写数据库，报告只保存答案 SHA-256、字符数、指标和 finding；与自动部署解耦，避免第三方 Provider 短暂故障阻断发布。
- 工作流对 429、Provider 过载、超时和临时 502/503/504 最多做 3 次有界退避；API Key/配置错误、非瞬时异常和质量未达标不重试、不降级。
- 这一阶段复用 Aria 现有项目 JSON 记忆、消息 metadata、Trace 和 Provider adapter，无数据库迁移，不启动、不导入、不连接 Codex。

边界说明：真实 Provider 评测是固定小样本的上线后冒烟与模型对比基线，不是对所有项目、所有问法或所有 Provider 的 100% 正确性保证。真实生产问题仍应先匿名化为 golden case，再持续扩展回归集。

### Phase 2Y：项目对话 Skill 选择与歧义确认闭环（已实施）

- 项目对话输入框新增一次性 Skill 控制，明确区分“自动匹配 / 本轮不用 Skill / 明确指定下一轮”；显式选择只作用于下一轮，发送后回到自动边界。
- 新增结构化 `disable_skill` 请求字段。本轮禁用会在数据库查询和自动路由前短路并清除会话上一个 Skill；即使异常客户端同时提交启用字段，也以禁用为准，确保冲突只能缩小能力。
- Context Receipt 的歧义候选不再只是说明文字：流式回执和历史 Assistant 消息均提供“下一轮使用”按钮，用户点选后直接绑定候选 ID，无需猜测 Skill 名称或提示词写法。
- 项目聊天通过发布态 `/skills/meta/summary` 目录展示 Skill 名称、类别和适用说明；目录加载失败只退回自动模式，不阻断普通问答。
- 前端发送契约、选择器、历史候选动作与后端冲突优先级均增加确定性回归测试；发布质量门禁扩展为 24 场景并新增 `skill_control_accuracy` 指标；不新增数据库迁移，不启动、不导入、不连接 Codex。

## 11. 官方资料与许可证

- OpenAI 模型与 Agent 提示建议：<https://developers.openai.com/api/docs/guides/latest-model>
- OpenAI Compaction API：<https://developers.openai.com/api/reference/resources/responses/methods/compact>
- OpenAI Skills 指南：<https://learn.chatgpt.com/docs/build-skills>
- OpenAI Codex 源码：<https://github.com/openai/codex>

本阶段改编遵循 Apache License 2.0，具体归属、固定 commit 和本地许可证副本见仓库根目录 `THIRD_PARTY_NOTICES.md` 与 `third_party/openai-codex/LICENSE`。
