# 项目对话与 Skill 交互全量优化方案

> 更新日期：2026-08-28
> 对照基线：OpenAI Codex `83d1fe0e67b1323f71febc2925817732b449f1d9`；发布快照/重建机制固定于 `343074d4207d572809bd8cea15f4be1d09d98e0b`；Phase 4A Skill 本轮加载边界固定于 `5e26f7621c1c470fe62350d61c9eb4d6c772a0da`
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
| 本轮输入边界 | `core/src/session/turn_input.rs`、`session/turn.rs` | 每轮输入是新的决策边界；追加上下文、纠偏和开始新轮次必须可区分 | Phase 3C 已支持发送前联合建议、修订差异与来源追踪 | 用匿名真实交互持续评测建议采纳率和修订成功率 |
| 项目指令层级 | `codex-home/src/instructions/mod.rs` | 全局、项目、目录指令按明确层级加载，越近的规则越具体 | Phase 2U 已建立显式 `InstructionManifest v1` | 后续把简化冲突回执开放给前端，持续扩充跨层冲突评测 |
| Skill 发现 | `skills/src/loading.rs`、`parser.rs` | 先发现元数据，命中后再加载完整内容；坏包隔离 | 已完成 Skill Root 快照、发布态目录、解析校验 | 增加作者预览、依赖校验、样例输入和质量评分 |
| Skill 本轮选择 | `skills/src/mentions.rs`、`selection.rs` | 只解析本轮结构化输入和显式提及；去重后注入本轮 | Phase 3C 已复用生产 Skill Router 提供发送前 Brief + Skill 联合建议，仍由用户显式应用 | 用真实匿名反馈持续校准建议阈值和业务解释 |
| Skill 续用/释放 | Codex 的 per-turn selection boundary | Skill 不是会话永久所有者；是否续用应由本轮相关性决定 | Phase 2T 已实现相关追问续用、无关话题释放、显式退出 | 用真实匿名交互数据持续校准续用词与误触发率 |
| Skill 可见性 | Turn 内 Skill 注入项 + 运行事件 | 用户应知道本轮实际加载了什么能力 | Phase 2Y 已支持项目内选择、歧义点选和一键关闭/切换 | 持续把内部匹配原因翻译为更具体的业务说明 |
| 项目世界状态 | `core/src/context/world_state/` | 把工作目录、规则和环境变化建模为基线与差异，不把所有内容反复塞入 Prompt | 已有项目/客户结构化上下文与 Context Assembly Manifest | 增加项目状态版本、变化摘要和陈旧证据提示 |
| 对话历史治理 | `core/src/context_manager/history.rs` | 保持工具调用/结果配对，压缩时保留任务状态和恢复边界 | Phase 2U 已用结构化 Capsule 绑定目标、约束、工具结果、阻塞和来源消息 | 扩大真实长对话集，并在压缩前后自动比较状态保持率 |
| 长对话压缩 | Context compaction 与状态续接 | 压缩结果必须保留目标、已完成动作、假设、标识、工具结果、阻塞与下一步 | Phase 2U 已建立 Provider-neutral `Conversation Capsule v1`，仍使用确定性本地预算压缩 | 先积累 Provider 对比数据，再决定是否按模型启用官方 Compaction API |
| 计划与执行 | `session/turn.rs` 的 turn loop、任务状态 | 计划、执行、反馈和完成应有状态边界，用户纠偏可进入当前轮次 | Phase 3C 已保存五类修订差异，并在请求与回应两侧显示来源和效果归因 | 增加同一目标多次修订的版本链与结果对比 |
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

### Phase 2Z：统一 @ 检索与结构化项目对象引用（已实施）

- 参考 Codex `skills/src/mentions.rs` 与 `selection.rs` 的“结构化选择优先、名称仅用于交互、精确身份去重、本轮重新决策”机制，在 Aria 原生 React/FastAPI 架构内实现，不引入 Codex 运行时或通信依赖。
- 项目对话输入框输入 `@` 后统一检索发布态 Skill、当前项目文件、当前客户干系人和当前项目里程碑；支持名称、说明、类别与角色检索，并支持 `↑/↓`、Enter、Esc 完整键盘操作。
- Skill 选择写入下一轮显式 `skill_id`；项目对象选择写入已有 `mention_context` 的精确 ID 数组，文件正文、重点干系人和重点里程碑继续由 Aria 原生上下文构建器按项目权限装配，不靠名称猜测。
- 已选项目对象显示为可移除引用标签，删除输入中的闭合引用令牌会同步撤销结构化选择；同类型同 ID 去重，空查询按对象类型均衡展示，项目切换期间不会短暂复用上一项目候选。
- 用户消息元数据持久化本轮 `mention_context`，便于历史审计和恢复；发布质量门禁扩展为 26 场景并新增 `structured_reference_accuracy` 指标。本阶段不新增数据库迁移。

### Phase 3A：结构化 Turn Brief 与全路径执行收敛（已实施）

- 参考 Codex 的 per-turn input boundary，将“本轮目标、明确约束、结构化引用”组合为 Aria 原生 Turn Brief；项目对话可在发送前编辑、查看预览，发送后自动清空本轮草稿。
- 目标不再只能等于消息正文；Turn Contract、模型可见执行帧和 Turn Receipt 使用同一个显式目标，回执同步展示最多八项去重、限长后的用户约束。
- 用户消息元数据保存 `turn_brief`，Assistant 元数据保存完整 `turn_contract`；明确约束进入 Conversation Capsule 和 ConversationState，未知业务约束不再依赖关键词猜测，同维度新约束确定性覆盖旧约束。
- Brief 只能保持或收紧权限，不能扩大 Intent Router 已授予的能力。“不要执行、只分析、只回答、不要修改、不要写入”等限制会切换为 plan-only，清空普通工具，并短路 Durable Task、Markdown/PPT 缺失交付物补偿和写入确认。
- `needs_artifact` 按当前轮次的实际模式计算；plan-only 即使正文描述了最终交付物，也只返回方案，不会因原 Artifact Contract 在持久化阶段被误判为交付失败或触发补偿写入。
- 前后端增加 Turn Brief 规范化、编辑预览、发送契约、乐观消息、回执、权限收敛、旁路短路、审计与记忆保持测试；确定性发布质量门禁扩展为 29 场景并新增 `turn_brief_accuracy` 指标。
- 全部能力复用现有请求模型、消息 metadata、ConversationState、Capsule 和 Product Run Event，无数据库迁移，不运行、不调用、不连接 Codex。

### Phase 3B：Brief 模板、历史契约与安全修订恢复（已实施）

- 项目对话新增“只读分析、管理层结论、证据优先、仅做计划”四类内置 Brief 模板；模板保留用户已输入目标，约束与现有约束确定性合并、去重并继续受八项上限约束。
- Brief 编辑器展示当前对话最近四个不同 Brief，可直接恢复目标与约束；历史候选完全由已加载消息的结构化 metadata 派生，不新增查询接口或数据库表。
- 用户历史消息显示其持久化 `turn_brief`；Aria 历史消息优先显示 `turn_receipt`，并兼容读取 `turn_contract`，用户可展开检查目标、模式、约束和写入边界。
- “复用到输入框 / 修订并重试”只准备下一轮草稿，不覆盖旧消息、不自动执行；正文、Brief、显式 Skill 和结构化项目引用可一起恢复，用户仍可在发送前修改。
- 恢复文件、干系人和里程碑时重新用当前项目候选校验精确 ID；对象改名后使用当前名称，对象已删除或 Skill 已下线时移除失效选择并提示用户，绝不回退到同名对象或纯文本猜测。
- 历史 mention 令牌会先从正文剥离，再仅附加重验成功的当前令牌，从而保证显示名称、结构化 ID 和下一轮请求三者一致。
- 新增模板合并、最近历史去重、恶意/失效 ID 边界、令牌重建、用户 Brief 展示、Assistant Contract 修订和 Composer 恢复测试；无数据库迁移，不运行、不调用、不连接 Codex。

### Phase 3C：发送前联合建议与修订效果归因（已实施）

- 项目对话新增用户主动触发的“建议配置”：后端直接复用生产 `Skill Router` 的候选评分、问题模式阈值和歧义规则，同时用确定性业务信号推荐 Brief；前端不复制 Skill 匹配算法，避免发送前预览与实际执行漂移。
- 建议严格保持非执行语义：接口不创建消息、不调用模型、不修改项目；只有用户点击“应用建议”后才写入下一轮草稿。明确关闭 Skill、明确指定 Skill、自动匹配和歧义候选均保持各自边界。
- “修订并重试”建立稳定的 Turn 指纹与 `turn_revision` metadata，记录来源角色、来源消息以及正文、目标、约束、Skill、项目引用五类有界差异；该审计数据不进入模型指令，也不扩大工具权限。
- Composer 在发送前实时展示修订差异，用户可以取消修订；发送后的用户消息显示修订轨迹，Assistant 回应显示本轮效果归因，并可用消息 ID 或稳定指纹定位历史来源，兼容流式消息临时 ID 与刷新后的数据库 ID。
- 普通 Agent Loop、Durable Task 和失败/中断持久化路径均继承修订 metadata；历史来源优先用消息 ID 定位，仅在结构化指纹唯一命中时回退定位，不在加载窗口或指纹重复时明确提示不可定位。
- 发布质量门禁由 29 扩展为 35 场景，新增 `turn_setup_recommendation_accuracy` 与 `turn_revision_attribution_accuracy`；前端增加联合建议、稳定指纹、精确差异、历史归因和来源定位测试。
- 本阶段继续复用 Aria 原生 Skill、消息 metadata、Turn Contract 与 Product Run Event，无数据库迁移，不运行、不调用、不连接 Codex。

### Phase 3D：真实反馈、中断连续性与项目状态版本（已实施）

- Assistant 历史消息新增“有帮助 / 没帮助”反馈；负向反馈最多选择三个固定原因（事实不准、缺少上下文、Skill 不合适、行动不对、表达不清、结果不完整）。反馈可覆盖更新，不接收自由文本，也不额外保存消息正文或反馈者身份。
- 项目级交互指标聚合反馈覆盖率、帮助率、修订轮次成功率、发送前配置建议采用率和负向原因分布；指标只读取角色与结构化 metadata，不把对话正文带入分析结果。
- 发送前配置建议在真正发送下一轮时记录“已应用 / 已关闭”，模板与 Skill 只保存受限 ID，使建议质量可以用真实采用结果评估，而不是只看点击或接口调用次数。
- 停止、失败和异常中断消息提供恢复入口。Phase 3D 首版由后端重新读取持久 Rollout 并提示核对 checkpoint 与副作用；恢复始终创建新的审计 Turn，不修改旧消息。该版本只有提示级防重放，已由 Phase 3N 的可验证 effect 契约和执行器硬门禁替代，不再称为“安全继续”。
- 每个项目 Turn 在消息 metadata 中保存 `Project World State Manifest v2`：项目、里程碑、待办、文件夹、文件（含所在目录）、进展、财务、干系人和交付物只保留实体 ID、计数与 SHA-256 状态指纹。下一轮生成分类级新增/移除/更新数量，Context Receipt 展示 12 位状态版本；业务正文、文件名和金额不会进入状态回执或变化提示。v1 快照不与 v2 误比较，会安全重建新基线。
- 发布质量门禁由 35 扩展为 41 场景，新增 `project_world_state_accuracy`、`turn_recovery_safety_rate` 与 `interaction_feedback_privacy_rate`；前端增加分类反馈、恢复动作、请求审计和状态回执测试。
- 本阶段复用 Aria 原生 Message metadata、Context Assembly、Context Receipt、Run Evaluation 和此前基于 OpenAI Codex Apache-2.0 源码移植的 Rollout 重建机制；未引入 Codex 进程、协议、SDK 或通信依赖，也不新增数据库迁移。

### Phase 3E：统一活动时间线、正式 Run 与记忆冲突治理（已实施）

- 项目对话实时流和历史 Assistant 消息统一消费 `RunActivityTimeline`；安静问答保持折叠，Skill、任务、步骤、工具、交付物、记忆候选、确认和错误使用同一产品级展示，不向用户暴露底层 Provider 事件。
- 新增内容安全的 `ChatRun` 生命周期投影，以 Aria `run_id` 关联现有 Rollout `TaskRun`，保存会话/项目/Skill/模型/策略、阶段、终态、步骤/工具/产出数量、耗时和错误码；不保存请求正文、模型正文、工具参数或工具结果。迁移由 `029_v1_29` 管理。
- 新增按项目和按 Run 的授权查询接口；原有 TaskEvent 仍负责 append-only checkpoint 和恢复，`ChatRun` 只作为稳定查询投影，不复制业务状态或取代 HITAS。
- `ChatRun` 生命周期跟随 Aria 业务所有权：删除会话或项目时先删除相应 Run 投影，避免遗留内容摘要和外键阻塞；删除用户或 Skill 时只解除可选外键，保留不含正文的历史运行事实与 Skill 名称快照。
- 项目对话标题栏加入隐私安全的交互质量面板，展示反馈覆盖率、有效回答率、修订成功率、配置采纳率和固定负向原因分布；聚合明确不读取正文、自由文本反馈或用户身份。
- Memory Candidate 新增创建时正式记忆基线版本；若审批期间项目/客户/用户记忆已变化，接受请求必须绑定当前版本并显式确认合并，版本再次漂移时返回 409。已存在的重复内容直接完成审批，不生成无内容变化的新版本。迁移由 `030_v1_30` 管理。
- 项目记忆页展示最近快照、生成触发原因和相对当前版本的字段级增删摘要；待确认候选同时展示旧基线、当前版本和重复状态。
- 48 个 Skill 包统一 `version/domain/last_updated/status` 元数据并加入确定性 CI 质量门禁；首批十个高优先级包补齐专业参考资料、质量检查清单和最小示例，并确保文件内容进入实际 Skill system prompt。
- 本阶段继续保持 Aria 原生权限、事件、数据库和 Provider 路径；不运行、不导入、不连接 Codex 进程、SDK、App Server 或通信协议。

### Phase 3F：版本化 Skill 运行质量闭环（已实施）

- 文件型 Skill 的 `version/status` 与精确发布 SHA-256 在发布同步时进入 Aria 数据库；DB-only Skill 创建和修改同样受 semver 与 `preview/stable/deprecated` 状态校验。修改 system prompt、输入模板或工具定义必须显式升级版本，最终 DB 运行契约会重新计算指纹；Skill 库详情和项目选择器可查看实际发布版本。
- 每个新 `ChatRun` 冻结本轮 `skill_version`、发布状态、包指纹和启用来源。后续更新或删除 Skill 不会改变历史事实；迁移前 Run 明确显示“历史版本未记录”，不以当前版本反向填充。
- 项目交互质量接口把内容安全的 Run 投影与 Assistant 固定分类反馈按消息 ID 关联，按 Skill 版本/指纹汇总运行数、完成率、反馈覆盖、帮助率、Skill 不合适原因、修订成功率、平均耗时及显式/自动/沿用来源。
- 项目对话质量面板新增“Skill 版本质量”，让团队直接看到真实使用版本和效果，不再只依赖静态 prompt 检查；Skill 详情同步展示发布版本与状态。
- 聚合实现不读取 `Message.content`，不接收自由文本反馈，也不保存反馈者身份；`deprecated` Skill 会退出启动目录、自动路由和发送前明确推荐，但保留历史记录。发布门禁由 41 扩展为 44 场景，新增 `skill_quality_attribution_accuracy`，同时验证版本隔离、退役隔离和内容隐私。
- 数据迁移由 `031_v1_31` 管理，保持单一 Alembic head 和幂等升级；所有状态、权限、反馈、Run 与审计仍属于 Aria 原生服务，不运行、不调用、不连接 Codex。

### Phase 3G：不可变 Skill 发布、项目灰度与自动止损（已实施）

- 新增不可变 `SkillRelease`。每次创建、编辑或文件包同步都会冻结完整运行契约和精确 SHA-256；`Skill.active_release_id` 单独表示线上版本，因此编辑 `preview` 不会静默改变普通问答、自动路由或项目对话。
- 新增 Aria 原生 `SkillRollout`。流量按 rollout 与 `project_id` 确定性分桶；无项目时依次退回 conversation、owner 和 Skill 作用域。同一项目跨会话、跨用户始终命中同一候选或基线，避免同一项目答案方法论随机漂移。
- 每个 Run 冻结 release/rollout/variant/bucket，实际 Context Builder 使用分配到的不可变 prompt 和工具契约。灰度健康只读取 Run 终态与分组，不读取消息正文、Prompt、工具参数或用户身份。
- 候选终态样本达到管理员配置下限且失败率超过阈值时，系统在 Run 收口事务内锁定灰度并自动切回基线；管理员也可调比例、暂停、恢复、推广和回滚。所有控制都带预期状态/候选指纹，数据库同时保证每个 Skill 只有一个开放灰度。
- Skill 详情新增“发布治理”，展示线上版本、候选比例、基线/候选终态健康、止损阈值和不可变发布历史；控制操作仅管理员可见。活动灰度期间拒绝 Skill 编辑和删除，避免被测契约漂移。
- 确定性发布门禁由 44 扩展为 47 场景、16 项指标，新增 `skill_release_governance_accuracy`；数据库迁移由幂等 `032_v1_32` 管理并保持单一 Alembic head。
- 本阶段只借鉴 Codex rollout recorder 与 reconstruction 的“不可变记录/重建视图分离”原则，并重写为 Aria 的 Python、SQLModel、FastAPI 和 React 实现；不运行、不导入、不连接 Codex，也不引入其 SDK、协议、账号或第二运行时。

### Phase 3H：用户/客户/项目三层记忆路由与偏好冲突回执（已实施）

- 在现有项目记忆按问题选槽位的基础上，增加 Aria 原生三层记忆选择边界。项目层继续按风险、交付、财务、干系人和文档召回；客户层只在客户关系、决策、干系人、历史经验和跨项目问题中进入提示词，普通项目问答不再携带整块客户记忆。
- 用户偏好在注入前确定性识别本轮明确的语言、语气、格式和详略要求；只移除同维度的旧偏好，保留称呼、工作方式和未冲突偏好。当前用户要求始终优先，不再把互相矛盾的新旧指令同时交给模型自行猜测。
- `context_receipt.memory.layers` 以 `user/client/project` 三层展示状态、版本、召回模式、槽位与条目计数、截断和被本轮覆盖的偏好维度；新增 `client_memory_stale` 与 `user_preference_overridden` 告警。回执不包含偏好值、客户记忆正文、项目正文、名称、用户身份或 Prompt。
- 流式与历史项目对话均展示每层本轮是否使用、使用数量、新鲜度，以及“本轮要求覆盖已保存的语言/语气/格式/详略偏好”，让用户能够理解 Aria 为什么这样回答。
- 确定性发布门禁由 47 扩展为 52 个场景、17 项指标，新增 `layered_memory_routing_accuracy`，覆盖无关问题不注入、中英文客户关系精准路由、本轮要求覆盖旧偏好和回执无正文边界。
- 本阶段复用既有 `UserMemory`、`ClientRecord.client_memory_json`、项目记忆 JSON、Context Assembly、Instruction Manifest 和 Product Run Event，不新增数据库迁移。机制参考 Codex 固定世界状态身份与指令优先级边界后重写为 Aria Python/React 实现，不运行、不导入、不连接 Codex。

### Phase 3I：项目/客户记忆槽位账本、真实来源与定向失效（已实施）

- 新增 Aria 原生 `ProjectMemorySlot` 与 `ClientMemorySlot`，分别管理 12/8 个稳定槽位。每个槽位拥有独立版本、聚合记忆版本、内容 SHA-256、有界 evidence refs、新鲜度和失效原因。
- 项目/客户重建保持综合 JSON 与 slot 双写，仅内容变化的槽位增加独立版本。项目财务、待办、里程碑、进展、文件和干系人变化以及客户/项目关系变化会定向标记受影响槽位，未知变更才保守地失效全部槽位。
- 重建时从实际读取的项目、客户、进展、里程碑、待办、文件、付款、干系人和 accepted candidate 生成来源引用；项目记忆页展示这些真实来源，不再把所有文件/对话伪装为每个槽位的依据。
- Provider 读取前会校验槽位 SHA-256，并只降级本轮问题选中且陈旧的槽位。Context Receipt 新增 `stale_slots` / `stale_slot_count` / `evidence_ref_count`，前端能说清“这次用了几个陈旧槽位、几个真实来源”，但不泄露正文、Prompt 或隐藏推理。
- 幂等迁移 `033_v1_33` 回填历史聚合记忆，发布门禁扩展为 54 个场景。当前仍保留综合 JSON 作双写兼容视图；事实级证据条目和 slot-level 局部重建属于下一阶段。
- 该机制参考 Codex 固定 world-state identity 和 digest 边界后重写为 Aria Python/SQLModel/React 实现；不运行、不导入、不连接 Codex。

### Phase 3J：项目/客户事实级记忆溯源（已实施）

- 新增 Aria 原生 `ProjectMemoryFact` / `ClientMemoryFact`，把槽位中的标量、列表项及 pinned/AI 条目拆成内容寻址事实。未变化事实跨重建保留同一 identity 和首次出现版本；移除事实进入 retired，不会被静默覆盖或伪装成新事实。
- 每条事实独立保存 SHA-256、新鲜度、来源关系与最多 6 个证据引用。`matched` 代表来源标签确定性命中；`scoped` 仅代表重建该槽位时读过；`legacy` 表示历史聚合无法恢复精确来源；`unresolved` 明确待补证。
- 项目问答 `M*` Manifest 和用户可见引用增加 fact identity、provenance、fact status 与证据数；Context Receipt 只展示匹配/范围来源/待补证数量，不保存事实正文。客户提示词同样带可信度守卫。
- 项目和客户记忆页支持逐事实查看内容摘要、来源强度和实际来源；损坏内容不会被渲染为有效事实。删除项目/客户时事实账本级联清理，业务权限继续复用原路由边界。
- 幂等迁移 `034_v1_34` 从 `033_v1_33` 槽位回填历史事实；确定性发布门禁由 54 扩展为 56 场景、继续保持 17 项指标全通过。
- 该机制固定参考 Codex world-state 身份/摘要边界后重写为 Aria Python/SQLModel/FastAPI/React；不运行、不导入、不连接 Codex。Phase 3K/3L 继续补齐 slot-level 局部重建和结构化 source ID 直连，不把标签匹配夸大为语义证明。

### Phase 3K：项目/客户槽位级局部重建（已实施）

- 重建执行不再由最后一个调度 trigger 猜测范围，而是读取全部持久槽位状态并按实际 stale/corrupt 子集规划；版本为零、账本不完整、手动请求或全部槽位失效时保守全量。
- 项目局部路径按目标槽位选择性读取进展、里程碑、待办、文件、付款和干系人；客户局部路径按目标槽位选择性读取项目历史与干系人。Prompt 只声明目标 key，严格 parser 要求所有目标 key/type 合法。
- 局部保存只更新目标 slot 的值、版本、来源和 fact active/retired 生命周期，未选槽位保留原 aggregate version 与 fact last-seen version；其他仍陈旧槽位会继续保持父记忆 stale，不会被一次局部成功误清除。
- 模型生成前捕获 aggregate memory version 和目标 slot 的版本、状态、摘要、stale/updated 时间；写入事务内重新锁定验证。并发业务变化会触发 conflict 并使用现有有界重试，避免旧生成覆盖新事实。
- 局部 payload 缺 key、JSON 或类型不合法时自动进行一次全量安全回退，重建日志/API/UI 展示 `partial/full/full_fallback/targeted_edit` 及实际槽位范围。用户定点编辑和候选接受同样只双写目标槽位。
- 确定性发布门禁由 56 扩展为 60 场景、18 项指标；聚焦测试覆盖范围规划、未选事实不退休、自动回退和并发基线拒绝。本阶段不新增数据库迁移，不运行、不导入、不连接 Codex。

### Phase 3L：结构化来源 ID 直连与可验证归因（已实施）

- 项目与客户记忆重建数据为当次实际读取的业务记录加上稳定、模型可见的 `[source_type:id]` 标记，例如 `[project:42]`、`[project_payment:17]` 和 `[client_stakeholder:9]`；槽位级选择性加载仍然适用，未读取来源不会进入该次白名单。
- Provider 可选在记忆内容之外返回私有 `_source_attributions` 数组；每项仅使用 `slot_key`、从 0 开始的 `fact_index` 和有界 `source_ids`。该键不是公开记忆槽位，在事实同步后会从综合 JSON 中移除，不会作为业务记忆注入后续问答。
- Aria 不信任模型给出的 ID：先校验数量、字段形式、目标槽位和事实索引，再与该槽位当次实际 evidence pool 做精确白名单匹配。只有命中的来源才以 `direct_source_id` 关系写入事实账本，其 provenance 为 `direct`。`direct` 同时校验 Prompt 前捕获的 `source_sha256` 与保存时当前业务投影摘要，并用 `source_kind + fact_value_sha256` 绑定 parser 验证后的事实值；来源改变或过滤导致的索引漂移都会降级。快照只持久化 SHA-256 和有界身份元数据，不保存来源原文。
- 私有归因缺失、格式无效、越界或伪造时不会整轮失败，而是保守回退到 `matched → scoped → unresolved`：`matched` 仍只是确定性标签命中，`scoped` 仍只表示该槽位重建时读过来源。旧 Provider 完全可以不返回私有键，现有综合 JSON 兼容路径不变。
- 未改变事实在后续定点编辑、回滚或旧 Provider 重建时，只有原直连仍属于当前槽位来源白名单才保留；内容变更会产生新 fact identity，不会继承旧证据。
- 项目晋升客户记忆使用单独的 `[project_memory:id]`，其摘要与模型看到的完整业务槽位投影完全一致；普通客户重建的 `[project:id]` 仍是精简项目投影。两条来源路径不会互相冒充，运行期间新增来源也不能被 `matched/scoped` 事后引用。
- 事实渲染按 `source_kind + value_sha256` 查找，不再依赖过滤、去重后会漂移的数组位置；非 ready 事实强制降级为 `unresolved`。项目记忆与 Stakeholder 的跨作用域变化会通过当前来源摘要校验让依赖槽位和事实显示 `source_changed`。
- LLM 等待期间不持有同步数据库事务；项目/客户重建和晋升生成后会重新取数，并验证 owner 版本与槽位基线。归档晋升将客户记忆和 completed receipt 原子提交，失败可重试；run-now 失败会落库为 `failed`，避免孤儿 queued 状态。
- 确定性发布门禁扩展为 63 个场景、19 项指标，新增 `memory_direct_source_accuracy`，当前全部通过。
- 本阶段复用现有事实账本、证据 JSON、slot 双写、Provider adapter 与权限边界，不新增数据库迁移。机制只参考 Codex world-state 的稳定身份原则，已重写为 Aria Python/FastAPI/SQLModel 服务；不启动、不导入、不连接 Codex 运行时。

### Phase 3M：稳定客户身份、项目交互隔离与写后验证（已实施）

- 项目对话、客户记忆、Stakeholder、知识检索和跨项目组合统一以 `Project.client_id` 解析客户；客户名称只作展示，不再承担权限或归属。迁移 `035_v1_35` 仅首次对唯一历史名称回填，重名/空白/未匹配保持未关联，后建同名客户不能认领旧项目。
- 新建和编辑项目提供稳定客户选择。重复名称显示记录 ID；未触碰客户字段的普通保存不发送客户关系字段；显式 `client_id: null` 才解除关系。选中某个同名客户后，相似项目和 Stakeholder 只查询该 ID，不回退到名称。
- 客户读取覆盖管理员、创建者和稳定关联项目成员；客户普通写入仅允许管理员、创建者、项目 `owner/editor`。`viewer` 可阅读授权范围内信息，但不能通过项目子路由、客户记忆、Briefing 或知识接口产生持久写入。改名和删除属于 client-wide 写入：非管理员/创建者必须对每个关联项目都有 owner/editor 权限，仅能写项目 A 的成员不能改写或解除项目 B 的客户关系。
- 所有经过 Provider 等待的客户/项目写入，在结果保存前重新加载 active User、项目、客户和成员关系。撤权、停用、降级、改绑或来源漂移会返回 403/409，旧模型结果不会覆盖当前业务状态。
- 项目子路由的文件/文档/文件夹与 Durable Task 变更统一使用 write gate；文件夹 GET 不再惰性写库。上传后的后台摘要携带真实发起人，Provider 返回后同时复核项目写权限、文件记录快照和磁盘内容 SHA-256，撤权或文件内容变化时丢弃旧结果。
- Briefing 保存前按稳定身份锁定 Project、Client、成员关系以及 Milestone、Todo、File、Conversation、Message、Stakeholder 全部确定性来源，冻结后再计算 source version；父行锁同时阻断新的来源子记录，关闭“最终校验通过后、缓存提交前”的漂移窗口。客户/项目记忆失败回执也在内部 rollback 后重新最终授权，不能由已撤权用户写入。
- 文档从项目/客户范围改挂时同时校验来源和目标写权限；客户删除与解除文档关联不会把 client-only 内容静默扩大为全局知识。知识上传、同步、重建、删除和任务重试使用独立 write gate，不再把 read access 当 write access。
- Knowledge job 冻结 `requested_by_user_id` 或代码级 trusted-system 二选一上下文，并以 `status + attempt + lease_token` 做 worker CAS。Provider/embedding/文件读取后的 chunk、document/source status、checkpoint、成功与失败 event 都必须再次通过精确 Project-first 授权；同客户的另一项目权限不能成为替代授权。
- Knowledge 的磁盘派生物不再覆盖固定 JSON：extracted/chunks 使用唯一版本 key，文件以同目录临时文件 + `fsync` + `os.replace` 原子发布，并由 Session rollback journal 在 flush/commit 失败或未提交关闭时删除新版本。原件在抽取前后和最终复权后均校验 path/SHA-256；成功提交保留旧版本供已经捕获旧 DB key 的并发读者完成读取。
- Durable TaskRun 冻结真实发起人，每个 TaskStep 用不对 API 序列化的内部 lease token 标识当前执行代。cancel 将未完成步骤改为 skipped，pause 将 running 步骤退回 pending，二者都清除 lease；Office/Markdown 先生成临时结果，最终授权 + lease CAS 事务才创建 ProjectFile、TaskArtifact 和 step receipt，撤权或取消后临时源会被清理。
- HITAS 确认后的 Office 新建/编辑与 Markdown 更新也采用 prepare→finalize：长耗时阶段只产生私有临时结果，最终按 active User、精确项目成员、PendingToolAction 状态/actor/project/tool/input 快照和目标文件重新加锁。数据库提交失败会补偿删除新文件或恢复原文件；撤权、停用或最终签名/CAS 失败时，控制面仅把完全相同且仍 `executing` 的动作代终结为 `failed`，不落业务文件。reaper、拒绝、supersede 或已换代动作保留其既有终态/代际，不追加迟到回执。
- 内置 Skill 的发布契约只保留工具注册表中真实可执行的工具。历史上仅表示流程步骤、从未有实现的 `diagnose`、`issue-tree` 等 `type=legacy` 占位符会在同步时清除；这些方法论仍保留在 Skill Prompt 中，但不会再误导模型发起必然失败的工具调用。
- 这一阶段借鉴 Codex world-state 的稳定身份与 verify-before-write 原则，但关系、ACL、锁、数据库、模型调用和事件均由 Aria 原生实现；不启动、不调用、不连接 Codex。

### Phase 3N：可验证中断恢复与跨 Worker Run 控制（已实施）

- 停止/失败卡片改为“先核对、再确认”两阶段恢复。服务端从精确 ChatRun、Assistant Message 和持久 Rollout 重建 v2 契约，前端不能自行宣称哪些写入已完成。旧 v1、身份不匹配、正在运行的来源或状态已漂移均失败关闭。
- 每个工具 effect 使用输入摘要、目标身份和持久结果引用进行无原文记录。文件/项目记录/真实字节 SHA-256 全部验证通过时，已完成写入才以 `already_completed` 复用，不会再执行工具；无法证明时转人工复核。
- 被复用的附件会以“已核验原任务已有附件、本次未重复生成”呈现，仍可在新回复中下载；来源 Run 的产物归属和字节证据不会被子 Run 改写。尚在等待用户确认的旧动作不与自动重新规划并存，一律转人工核对。
- 恢复契约绑定当前 Project World State，包括文件夹层级和文件所在目录。所有新非只读提议都强制进入带恢复身份与隐藏状态 guard 的签名 HITAS 供人工审阅；确认时重验当前写权限和项目指纹，但项目 Office 创建/编辑、结构化 Markdown、文件/文件夹管理、普通生成器及外部/legacy handler 全部固定失败关闭，零业务调用、零 `ProjectFile`，必须核对后从 fresh non-recovery 新轮重新发起。当前不声称能把全量 Project World State 的所有子资源与任意写入严格线性化。普通非恢复审批仅允许三个 Aria 原生 final-authorized project writer 执行项目写；项目 scope 在 server runtime、审批动作和工具输入三处必须是精确相等的正整数，拒绝 `bool`、字符串、浮点数、零与负数。其他 project-scoped mutating registry handler 在 registry 前失败关闭。非项目作用域全局工具在项目会话中可继续使用自身签名/HITAS，但其 `tool_input` 顶层不得出现 `project_id` 键；无论该值为 `None`、布尔、字符串、整数或浮点数，一律失败关闭。final-auth 失败只终结 exact same generation，批次余项收口为 `skipped`，不会留下旧 `executing` 悬挂项。只读重试策略的写调用由执行器硬拒绝，不依赖模型遵守文字建议。
- 恢复用户 Message 和唯一子 Run 在同一数据库事务中预留，重复确认在产生幽灵消息前返回 409。进程在 SSE 启动前崩溃所留下的、未激活且无 Assistant 的 `reserved` 子 Run，超过配置 TTL 后可审计失效并重试；已激活 Run 不会被该机制误回收。
- 当前恢复只允许走同步 SSE `/chat/send`；异步发送会在创建 Message、子 Run 或后台 TaskRun 前返回 409，不让后台路径绕过恢复事务边界。
- 取消和运行中追加从单进程队列升级为 Aria 数据库邮箱。输入正文仍是 ACL 保护的普通用户 Message，邮箱仅保存 Run/Message 身份、序号和哈希。普通 Agent Loop 在模型/工具安全边界领取；Durable Task 仅领取 cancel 并调用原生 TaskRun 取消，不把不支持的 Steering 误标记为已应用。
- Steering 与 cancel 都使用 at-most-once 领取。`applied` 表示 Aria worker 已领取，不是 Provider 接收证明；因此新恢复契约会区分 `unapplied` 和 `applied` 输入身份，经 ACL、Message metadata 和内容 SHA-256 复核后，仅以原始 `role=user` 信任级别注入新 Run 一次。数据库领取失败时不会继续调模型或提交工具。
- 基础 Context Assembly Manifest 在邮箱领取前必须与初始 Provider 请求精确匹配。经身份和正文摘要校验的 Steering 若在 Assembly 后追加，系统会生成内容安全的派生 Manifest，绑定基础摘要、最多 24 个 Run/序号/Message/内容摘要身份，以及最终 system/messages/tools 指纹；任一失配都在 Provider 前失败关闭。
- 恢复来源 Run/会话/项目、`GeneratedFile/ProjectFile`、output identity、受控路径与真实字节 SHA-256 必须全部精确匹配，才复用附件。恢复守卫的多动作 HITAS 批次在任何业务写入前拒绝，必须拆成单动作预览并逐次确认。
- 卡片显示已验证/待处理 effect 数、状态变化和重复处理策略；无法验证的内部代码不直接暴露给用户。HTTP 200 不等于激活：前端等到 `conversation_id` 或 `run_started` 才发布本地恢复用户气泡，且只接受同一 `run_id` 的 `run_started`→`run_done(completed|waiting_confirmation)` 为成功。用户停止、`run_done(cancelled)`、网络、SSE 错误/空流、`run_failed`、缺失启动身份、终态身份不一致或并发确认都不会误报恢复成功；激活前取消不生成本地 Assistant 气泡，409 会清除旧草稿并要求重新预览。
- Assistant Message/交付证据持久化后，必须先提交 Rollout/`ChatRun` 终态，才释放 legacy `done` 和 Product `run_done`；终态提交失败只发 `run_failed(PERSISTENCE_ERROR)`，不会产生成功假象。
- 迁移 `036_v1_36` 增加恢复 parent/snapshot 唯一身份与耐久输入表；未激活且无 Assistant Message 的 `reserved` 恢复子 Run 继续使用独立 TTL。激活后的 active Run lease/reaper 已由 Phase 3O 和 `037_v1_37` 落地，两类超时不会互相接管。

### Phase 3O：active Run 租约、心跳与跨进程故障收口（已实施）

- 每个新 ChatRun 在正常启动或恢复预留激活时绑定内部 worker owner hash、64-hex fencing token、generation、heartbeat 与 expiry；同步 SSE 和异步后台聊天使用同一事实源。token 不出现在 API、事件、消息、Trace 或日志。
- 邮箱领取/关闭、工具批次、Durable Task 控制、checkpoint、Persist、Assistant Message 投影和终态提交均要求精确运行代且租约未过期。租约丢失会停止当前 worker，迟到结果不能写成新的 checkpoint、Message 绑定或成功终态；lease 只证明执行代，不替代 Aria ACL、HITAS 或业务授权。
- Assistant Message 保存后、终态提交前会先用同一租约挂接 ChatRun 并追加一次 `message_persisted`。进程在此后崩溃时，reaper 可以保留精确 Assistant 身份与 Rollout；若崩溃发生得更早、没有可核验 Assistant，则只允许 fresh Turn，不伪造“安全续跑”。
- Scheduler 使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 回收确实过期的 active Run，并把异常收口为 `interrupted + retryable`、`run_interrupted` 和 `unapplied` 邮箱输入。它不接管、不续跑、不重放 Provider/工具/业务写；正常 heartbeat/checkpoint/finalizer 已持锁的 Run 会被跳过。
- 异步包装 TaskRun 持久保存真实 ChatRun ID；跨 worker 查询优先读取 ChatRun lease/terminal，而非只看当前 Python 进程的 task registry。诊断接口显示无敏感 token 的 owner hash、generation、heartbeat 和 expiry。
- 幂等迁移 `037_v1_37` 增加租约字段、索引与一致性 CHECK，并保持单一 Alembic head。运行参数具有保守默认值和硬上下限；滚动部署期间的旧无租约 active Run 只有超过独立保护期才会被收口。
- 本阶段不恢复 Codex transcript，不运行或连接 Codex；项目、消息、记忆、Skill、任务、工具、权限、审批和审计全部继续属于 Aria。

### Phase 3P：项目级运行恢复中心（已实施）

- 项目对话左栏增加“恢复”入口，不再要求用户先记得是哪条 Assistant 消息中断。入口汇总待核对、未应用追问、已继续和缺少恢复投影的近期运行，并可定位到精确会话与消息。
- `GET /chat/projects/{project_id}/recovery-center` 是授权后的只读、无正文投影：只返回 Run/Conversation/Message 身份、安全原因分类、终止阶段、恢复状态、后续子 Run 与 Steering 数量/消息身份；不返回消息正文、Prompt、原始异常文本、worker fencing token 或租约 token。
- `ready` 只代表 Assistant Message 与持久 Rollout 的结构身份匹配，不代表可以跳过校验。用户仍需在原消息卡片调用既有 `recovery-preview v2`，由服务端重新核对 World State、effect ledger、未应用/已应用输入和恢复子 Run 后，才能确认创建新的审计 Turn。
- `continued` 显示已存在的后续 Run 并定位结果；`projection_missing` 明确提示从 fresh Turn 重新说明未完成部分。恢复中心不接管 worker、不恢复 Provider transcript、不自动重试模型/工具/业务写，也不创建第二套恢复协议。
- 运行结束后恢复索引自动刷新；窗口有界并明确标记截断。新增服务级权限/隐私/状态测试与前端交互测试。本阶段不新增数据库迁移，不运行或连接 Codex。

### Phase 3Q：项目对话连续性与问题闭环（已实施）

- 项目对话标题栏增加“进展”入口，将当前目标、Turn 模式、已确认约束、既有决策、未解决阻塞和项目待确认问题集中为可核对协作状态，不再要求用户从长对话中人工重建“做到哪、还差什么”。
- `GET /chat/conversations/{conversation_id}/continuity` 只读投影最近的 `Conversation Capsule v1`。接口复用对话 ACL，并再次校验精确字段、版本、SHA-256、Conversation/Project scope 以及全部来源 Message 都属于当前对话；最新 Capsule 非法时失败关闭并返回 `state=null`，不会向前回退到较旧状态掩盖异常。
- 对用户只返回有界的目标、下一步、约束、决策摘要、阻塞和安全 Artifact/Task 字段；不返回 Prompt、工具输入/输出、隐藏推理或 Assistant 内部摘要。来源消息可定位，Fingerprint 短摘要可供核对。
- 项目待确认问题独立读取当前 `open_questions` 记忆槽位，最多返回 8 个去重条目，并明确区分 ready/stale/missing；Capsule 校验失败不影响独立项目问题，陈旧记忆也不会被展示为新鲜事实。
- “继续当前目标”“处理阻塞”“推进待确认问题”都只把明确文本追加到输入框，保留用户已有草稿，由用户修改并发送；当前轮次执行中全部禁用。面板不自动创建 Message/Run、调用模型或工具，也不产生业务写入。
- 服务测试覆盖正常投影、隐私边界、Fingerprint 篡改、跨对话来源和 ACL；前端测试覆盖草稿准备、消息定位、非法状态失败关闭、陈旧记忆和运行中禁用。本阶段复用现有 Message metadata 与项目记忆账本，不新增数据库迁移，不运行或连接 Codex。

### Phase 3R：项目问题解决账本与人工复核（已实施）

- “进展”面板中的项目待确认问题现在可以由项目 owner/editor 明确标记为已解决。用户必须选择当前对话中已经持久化的 Assistant Message，并填写有界解决摘要；AI 回答、Conversation Capsule、普通聊天文本或记忆重建都不能自动关单。
- `POST /chat/conversations/{conversation_id}/continuity/questions/resolve` 同时核对对话写权限、最终项目写权限、Assistant Message 的精确 Conversation scope、项目记忆版本和 `open_questions` 槽位版本。任一范围或版本变化均以 `409` 失败关闭，不接受客户端提交的任意“问题”作为项目事实。
- 关单在一个事务中完成：从 AI/pinned 开放问题及对应 accepted anchor 中移除问题、更新聚合记忆与独立槽位版本、退休事实账本条目，并写入 `ProjectQuestionResolution` 当前状态和只追加的 `ProjectQuestionResolutionEvent`。每次解决/重开都永久记录问题事实身份、回答 Message/Conversation、操作者、说明、结果版本与独立 revision，再次解决不会覆盖旧历史。
- 最近解决项回到 Continuity Snapshot v2，但不返回绑定回答正文。后续项目记忆版本变化、记忆陈旧或同一问题再次出现时，只把旧结论标为 `needs_review`；系统不会自行推断结论仍有效，也不会自动重开。
- `POST /chat/conversations/{conversation_id}/continuity/questions/{resolution_id}/reopen` 要求用户填写原因并再次通过项目写权限和乐观版本校验；问题以用户 pinned 锚点回到 `open_questions`，保留原回答绑定和解决审计。viewer 只能查看，不能解决或重开。
- 幂等迁移 `038_v1_38` 建立解决账本、唯一问题身份、状态/revision CHECK、CASCADE/SET NULL 外键和查询索引，并保持单一 Alembic head。部署门禁与生产数据库 E2E 在备份后的隔离 schema 中覆盖迁移、外键、解决/重开和投影往返；不在 `public` 测试，不引入 Codex 运行时、SDK、协议或通信。

### Phase 3S：项目问题工作台、责任协同与跨对话回答选择（已实施）

- 项目详情新增“问题”标签，把 `open_questions` 与解决账本组合成开放、待复核、已解决三类项目视图；提供计数、搜索和状态筛选，不要求用户先定位某一条对话。
- `ProjectQuestionProfile` 是负责人、优先级和截止日期的独立覆盖层，不复制开放/解决事实。写入必须提交问题 SHA-256 与 expected revision，在最终项目写锁内重新授权、验证问题属于当前记忆或解决账本，并验证负责人是有效项目成员。`ProjectQuestionProfileEvent` 逐 revision 只追加前后值，重复无变化提交不制造审计噪声。
- `GET /projects/{project_id}/questions` 返回有界的项目问题、成员和候选回答。候选只在调用者有写权限且确有开放问题时返回，最多 40 条，每条仅包含 Conversation/Message 身份、标题、时间和 280 字预览；不返回完整回答、Prompt、工具输入、工具输出或隐藏推理。
- 关单允许选择同一项目任一对话中的持久化 Assistant Message。后端不信任客户端候选，再次核对 Message role 和精确 Project/Conversation scope，然后复用 Phase 3R 的记忆版本、槽位版本、最终授权和原子解决事务；跨项目回答、过期版本和只读成员均失败关闭。
- 项目级重开不依赖原回答对话仍然存在，但仍要求 resolution revision、记忆版本、槽位版本和人工原因；问题回到 pinned 锚点。迁移 `039_v1_39` 幂等创建 profile/current-event 两表并保持单一 head，生产数据库测试继续只在备份后的隔离 schema 运行。
- 本阶段仍未运行、连接或嵌入 Codex。项目、对话、回答、问题、责任、权限、审批和审计均属于 Aria 原生服务；下一阶段再进入问题级证据召回与回答质量评估。

### Phase 3T：问题级证据召回与回答选择准备度（已实施）

- 新增无副作用的 `POST /projects/{project_id}/questions/{question_sha256}/evidence`。问题正文使用 JSON body，避免进入 URL 访问日志；接口只向项目 owner/editor/admin 开放，先验证问题文本 SHA-256 以及问题仍存在于开放记忆或解决账本，再执行任何检索；viewer、跨项目问题、伪造 identity 均失败关闭。
- 用户显式点击分析后，Aria 在当前权限下重新召回项目知识和 query-aware 项目记忆。知识证据沿用稳定 Evidence ID，记忆证据使用 `slot + content_sha256` 跨版本对齐；只把当前重新召回且范围有效的来源元数据展示给用户，历史候选中未对齐、无效或跨项目的 manifest 不会泄露来源标题，也不能获得证据分。`open_questions` 中的问题本身只作为 context-only 来源，支持权重为零，防止用“存在这个问题”循环证明答案。
- 最多评估最近 40 条项目 Assistant Message，返回准备度最高的 12 条和每条最多 280 字预览。确定性评分组合问题相关性、有效引用/当前证据对齐、原始 Run Evaluation 和已有人工反馈；同一引用重复出现不能刷分，引用无关答案仍为弱候选。`strong/review/weak/unrated` 只是选择准备度，不是模型真伪判断或概率置信度。
- 前端展示当前召回的知识/记忆来源数、回答准备度、相关性、引用数、当前对齐数和首要风险。系统不会因为推荐结果自动预选答案；用户仍需点击“采用”、填写解决摘要并通过 Phase 3R/3S 的版本与最终写锁后才能关单。陈旧记忆继续阻止解决，分析结果只提供复核线索。
- 隐私契约明确禁止完整回答、检索 chunk、Prompt、工具输入/输出和隐藏推理进入响应；项目记忆来源也不返回事实正文或 content SHA。知识检索异常会局部降级，保留项目记忆与候选相关性分析，不让整个工作台不可用。
- 确定性发布门禁由 63 个场景/19 项指标扩展为 66 个场景/20 项指标，新增 `question_answer_readiness_accuracy`，固定“相关且当前对齐可升为强候选、无关答案不能靠引用获救、准备度永不成为自动正确性裁决”三条不变量。本阶段复用现有 Message metadata、RAG、记忆事实/槽位和 Run Evaluation，不新增迁移。
- 机制复用此前基于 Codex `protocol/src/models.rs`、`protocol/src/items.rs`（commit `83d1fe0e67b1323f71febc2925817732b449f1d9`）以及 `core/src/context/guardian_review_evidence.rs`（commit `99660ab3c7b861c916e467581fa9b8723504d66b`）吸收的稳定证据身份与有界裁决原则（Apache License 2.0），并改写为 Aria 原生 Python/FastAPI/React、项目 ACL 和多 Provider 实现；不运行、导入或连接 Codex。

### Phase 3U：证据缺口补证计划与本地协作草稿（已实施）

- 新增 `POST /projects/{project_id}/questions/{question_sha256}/remediation`。它先执行与 Phase 3T 相同的项目写授权、问题文本/SHA-256 一致性和当前问题范围校验，再重新召回当前证据，不信任浏览器先前展示的分析结果。
- 规划器不调用模型，使用确定性规则将问题分为确认、时间、数值、责任和一般五类，并将陈旧记忆、无当前支持来源、无强候选、无效引用、当前证据不对齐、弱 provenance、失败 Run Evaluation 和负向反馈投影为最多 8 个证据缺口。
- 最多返回 6 个补证动作，覆盖干系人追问、原始资料请求、内部核验、候选回答复核和最终人工确认。每个动作带有界草稿、理由、完成标准和建议责任角色，执行模式固定为 `manual_only`；即使已有强证据，也必须保留最终人工确认。
- `plan_contract` 明确声明 `persists_changes=false`、`sends_messages=false`、`executes_tools=false` 和 `requires_human_confirmation=true`。前端允许本地编辑标题/草稿、选择责任人、移除或增加自定义动作，但没有保存、发送或执行入口，重新生成才会用新的 evidence basis 重置草稿。
- 隐私投影只保留问题正文、证据计数、缺口代码、动作草稿和 hash-only fingerprint；候选回答预览、来源标题/正文、Prompt、工具输入/输出和隐藏推理均不进入响应。viewer 不能生成计划，规划结果也不能自动选择回答、重建记忆、解决或重开问题。
- 确定性发布门禁由 66 个场景/20 项指标扩展为 69 个场景/21 项指标，新增 `question_remediation_safety_rate`，固定“缺证据时生成追问/资料草稿、任何计划都不能产生副作用、强证据仍需人工确认且不泄露回答”三条不变量。本阶段复用已有 Message metadata 和 Phase 3T 证据视图，不新增数据库迁移。
- 该阶段沿用 Codex 不可变证据与结构化裁决中“证据事实、审阅判断、后续动作分离”的原则，来源 commit、路径和 Apache-2.0 归因与 Phase 3T 相同；实现已重写为 Aria 原生 Python/FastAPI/React 与项目 ACL，不运行、导入或连接 Codex。
- Phase 3V 已按下述领域 HITAS 合同实现，不再把该项列为待办。

### Phase 3V：补证动作领域 HITAS 与原生协作目标（已实施）

- 新增 `prepare / confirm / reject / history` 四类项目问题 promotion 接口。准备阶段在项目最终写锁内重新授权、重新计算当前 Phase 3U basis、核对来源动作和有效负责人，只保存 24 小时有效的冻结预览与 prepared 事件；不会创建 ProjectTodo、沟通请求、Message、Run 或工具调用。
- 确认阶段只能提交已持久化 preview 的 snapshot SHA-256 和 expected revision，不能替换标题、草稿、负责人、截止日期、对象或目标类型。服务再次获取项目写锁、重新授权、校验快照完整性/过期状态，并在锁内重新计算当前证据 basis；证据、来源动作、权限或负责人发生变化时写 failed/expired 事件并以 `409/403` 失败关闭。
- `project_todo` 在确认事务中创建 Aria 原生 `ProjectTodo`，并按现有记忆治理把项目相关槽位/事实标为 stale；相同 action hash 在项目锁下复用已存在目标，网络重试和不同 idempotency key 都不会产生重复待办。原始 idempotency key 不入库，只保存带命名空间的 SHA-256。
- `communication_request` 创建 Aria 原生 `ProjectCommunicationRequest`，状态固定为 `ready_for_manual_send`，数据库 CHECK 强制 `delivery_mode=manual_only`。产品 API、前端和领域服务均不提供发送步骤，响应明确 `delivered=false`、`outbound_delivery=false`；确认只是批准并保存人工沟通稿，不代表对方已经收到。
- `ProjectQuestionRemediationPromotionEvent` 按 promotion/revision 只追加 prepared、confirmed、rejected、failed、expired 生命周期，并记录操作者、精确 snapshot 和目标引用。迁移 `040_v1_40` 幂等创建 promotion、communication request、event 三表，使用 CASCADE/SET NULL 外键、状态/哈希 CHECK、唯一 revision 和查询索引，保持 Alembic 单一 head。
- 前端对每个动作增加目标类型、负责人、截止日和沟通对象；第一次点击只显示服务端返回的冻结预览、快照与到期时间，第二次明确确认才创建目标。冻结后输入不可修改；拒绝没有副作用；确认后同时刷新项目问题/详情。自定义内部核验动作也进入相同 HITAS，不能绕过权限与证据 basis。
- 发布门禁从 69 个场景/21 项指标扩展为 72 个场景/22 项指标，新增 `question_remediation_promotion_safety_rate`；SQLite 行为/迁移、React 交互和 PostgreSQL 外键/去重合同进入部署与备份后隔离 schema E2E。实现继续完全属于 Aria 原生 Python/FastAPI/React 与数据库，不运行、导入或连接 Codex。
- Phase 3W 已按下述执行账本与证据回挂合同实现，不再把该项列为待办。

### Phase 3W：补证执行中心、证据回挂与人工生命周期（已实施）

- 每个 Phase 3V 已确认目标原子建立一个 `ProjectQuestionRemediationExecution`，与冻结 promotion 分离保存。项目“问题”页提供集中执行中心，统一展示原生项目待办和人工沟通请求的状态、证据、允许动作与只追加历史；列表只向项目可写成员开放。
- 人工沟通只支持用户证明“已在 Aria 外部发送”、完成或取消。`manual_send_is_user_attestation=true`、`delivered_by_aria=false`、`outbound_delivery=false`、`sends_messages=false`、`executes_tools=false` 同时进入服务、API、前端和确定性门禁；系统没有外发端点，也不会把保存草稿或点击状态解释为对方已收到。
- 完成动作必须至少有一条数据库内不可变证据附件。当前项目文件和知识文档为 direct；当前项目消息、去除 fragment 且禁止凭据的 HTTP(S) 外链、人工备注为 `review_required`。引用在项目最终写锁内重新授权和校验，幂等 key 与证据内容身份双重去重，普通 ProjectTodo 更新/删除不能绕过 execution 完成边界。
- `ProjectQuestionRemediationExecutionEvent` 按 execution/revision 只追加 created、marked_sent、evidence_attached、completed、cancelled；每次写入都提交 expected revision。执行完成只同步目标待办/沟通请求状态，绝不写 `ProjectQuestionResolution`，问题仍由 Phase 3R/3S 的人工采用回答、摘要和版本锁关闭。
- 当前未取消的附件进入 Phase 3T 当前证据池。直接项目文件/知识文档可增加支持来源；消息、外链和人工备注只提供待复核线索，附件 note 不当作答案事实。完成项目待办会使项目记忆 stale，后续重建重新裁决；人工沟通状态不自动改变记忆事实。
- 幂等迁移 `041_v1_41` 创建 execution、evidence attachment、execution event 三表，扩展人工沟通状态 CHECK，并为目标唯一性、证据身份、revision、引用完整性、FK 与查询建立约束/索引；历史 confirmed promotion 会回填 created execution event，Alembic 保持单一 head。
- 发布门禁从 72 个场景/22 项指标扩展为 75 个场景/23 项指标，新增 `question_remediation_execution_safety_rate`；SQLite 行为/迁移、React 生命周期以及 PostgreSQL 唯一约束与完整往返进入部署和备份后隔离 schema E2E。实现完全属于 Aria 原生 Python/FastAPI/React 与数据库，不运行、导入或连接 Codex。
- Phase 3X 已按下述人工证据裁决合同实现，不再把该项列为待办。

### Phase 3X：待复核证据人工裁决与准备度重算（已实施）

- `message`、`external_reference` 和 `manual_note` 附件保持不可变；新的 current review 只保存 accepted/rejected、独立 revision、必填有界理由、操作者与时间，review event 按 review/revision 只追加完整前态/后态。项目文件和知识文档保持 direct，明确显示“无需裁决”。
- `POST /projects/{project_id}/questions/remediation-executions/{execution_id}/evidence/{attachment_id}/review` 在路由和领域服务双层执行项目写授权，锁定项目、execution、attachment 和 current review，并用 expected review revision 做 CAS。相同裁决/相同理由的网络重试幂等返回；跨项目、跨 execution、旧 revision、直接来源或已取消 execution 均失败关闭。
- 只有 accepted 的待复核附件增加当前问题 `supporting_source_count`；pending/rejected 仍显示来源、状态和有界理由，但不能提高支持度。review status/revision 纳入 evidence identity fingerprint，因此已经准备的冻结 promotion 会在确认时检测裁决漂移，不能沿用过期证据基准。
- 人工接受固定声明 `human_judgment_only=true`、`acceptance_is_truth_verdict=false`。裁决不修改不可变附件和 execution revision，不写 ProjectMemoryFact/候选记忆，不使记忆 stale，不访问外链，不发消息，不调用工具，也不创建或解决 ProjectQuestionResolution；最终回答采用和关单仍走 Phase 3R/3S。
- 前端在整改执行中心展示 pending、人工接受（不等同事实）、已驳回、无需裁决四种状态，要求填写理由后才可接受/驳回，并展示最新 revision 与依据。裁决成功后刷新执行中心、问题证据和补证计划，不自动触发模型、重建、发送或关单。
- 幂等迁移 `042_v1_42` 创建 current review 与 append-only review event 两表，为附件唯一当前态、逐 review revision、状态、SHA-256 身份、FK 和检索索引建立数据库约束并保持单一 Alembic head。发布门禁从 75 个场景/23 项指标扩展为 78 个场景/24 项指标，SQLite 行为/迁移、React 裁决生命周期和 PostgreSQL 唯一当前态进入部署与备份后隔离 schema E2E。
- 本阶段借鉴 Codex `codex-rs/core/src/context/guardian_review_evidence.rs` 在 commit `99660ab3c7b861c916e467581fa9b8723504d66b` 的“不可变证据与审阅判断分离”原则（Apache-2.0），重写为 Aria 原生 SQLModel/FastAPI/React、项目 ACL、CAS 与业务审计。源码归因见 `THIRD_PARTY_NOTICES.md`；Aria 生产运行时不导入、运行或连接 Codex。

### Phase 3Y：已核验证据重新回答与 A 引用闭环（已实施）

- 项目问题最薄弱的“补到证据后仍无法生成可对齐新答案”缺口已闭合：工作台可将 direct/accepted 整改附件冻结并带到项目对话，用户在发送前仍可审阅和修改问题表述。
- 服务端不信任浏览器草稿。发送前重新验证问题仍开放、项目记忆 ready、附件未取消、人工裁决 revision 和源内容摘要未漂移；冲突返回 409，前端不显示未被服务端接受的用户消息。
- 该轮禁用 Skill 和工具并强制 answer-only。模型必须区分直接证据、人工判断和未知信息，使用 `[A1]…[A8]`；外链不会被 Aria 自动访问，人工接受不等于真实性裁决。
- 新 Assistant Message 保存无正文证据 manifest 与实际引用；问题工作台重算准备度时能够识别整改证据引用。裁决或来源变化后，旧回答不再保持强对齐，必须重新分析。
- 用户仍需回到问题页选择新回答、填写解决摘要并通过记忆/槽位版本锁关单。该链路不会篡改历史回答、自动沉淀记忆、发送外部消息或自动解决问题；82 个确定性场景、25 项指标全部为 1.0，无数据库迁移。

### Phase 3Z：回答采用快照、二次确认与证据漂移复核（已实施）

- 问题工作台选择回答和填写解决摘要后，必须先调用 `POST /projects/{project_id}/questions/{question_sha256}/answer-adoption/prepare`。服务端重新召回当前证据、评估精确 Message，并返回无完整回答/无 chunk/无 Prompt 的采用预览；该步骤不修改项目记忆或解决账本。
- 采用快照绑定问题、memory/slot version、Message/Conversation、回答正文 SHA-256、解决摘要 SHA-256、全量当前证据身份、整改附件裁决身份和准备度摘要。最终 `/questions/resolve` 必须携带 snapshot SHA-256；项目写锁内再次授权和重算，漂移以 409 失败关闭。
- 确认后才执行 Phase 3R 的原子关单。v1 采用审计 envelope 写入当前 resolution revision 对应的 append-only event note；旧纯文本 note 可读为 `legacy_unbound`。这复用了既有表和唯一事件 revision，不新增迁移。
- 问题页显示 `bound / legacy_unbound / answer_unavailable / answer_changed / evidence_changed`。回答不可用、正文改变，或整改附件集合/人工裁决变化会自动把解决项投影为待复核；准备度始终声明不是正确性裁决。
- 重答成功后不再只弹出“请自己返回”的提示：项目对话给出精确返回入口，携带持久 Message ID；问题页自动重新召回答案证据并预选该回答，但不自动填写人工摘要、不自动采用、不自动关单。
- 本阶段借鉴 Codex 固定 commit `986ff1cc7ced0081ec5014b700a376333d87f869` 的稳定 review target 与 durable terminal item 原则，全部实现仍是 Aria 原生 Python/FastAPI/React、项目权限、项目记忆和审计事件。发布门禁为 85 个场景、26 项指标，新增 `question_answer_adoption_safety_rate`；不运行、导入或连接 Codex。

### Phase 4A：Skill 本轮按需加载与验证契约（已实施）

- Skill 被选中后，不再只显示名称。运行时基于已经解析出的不可变 `SkillRelease` 生成 `Skill Runtime Contract v1`，绑定 release ID、semver、发布状态、release SHA-256、指令是否加载、最终 Provider 上下文是否完整保留、实际随发布快照注入的 bundled resource 名称和数量；若上下文预算压缩了完整 Skill body，状态确定性降为 `compacted`，验证上下文也标为不完整。不返回 Skill Prompt、工具 schema、项目正文、工具参数或隐藏推理。
- 资源清单只从当前 release 的冻结 Prompt 中已存在的 `Bundled Reference` 标记提取，最多 16 项。当前文件系统后来增加或修改的资源不能反向改变历史 Turn；未命中的 Skill 包和未显式加入发布 Prompt 的 reference/example/asset/script 不进入本轮上下文。
- Skill 声明工具与通过 `ActionPolicy` / `ToolAccessPolicy` 后真正可见的 Aria 工具取交集，回执只显示声明数、授权数和被策略过滤数。包内脚本固定 `scripts_executable=false`；文档提到脚本、资源名包含脚本，或模型提出脚本都不会获得执行权，只有本轮正式暴露的 Aria 工具可运行。
- Runtime 确定性识别 `Quality Checklist`、验证/验收/完成标准及质量清单 reference，生成 `available / not_declared` 和检查项数量。该状态表示 Skill 声明了交付前检查，不冒充实际自动验证结果；未声明时 Provider 边界明确禁止声称“已通过包级验证”，前端也显示黄色提示。
- 项目对话“本轮依据”新增精确 Skill 发布、短 SHA、按需加载指令/资源、工具授权比例、验证清单和“脚本不会自动执行”回执；旧消息和没有新字段的客户端继续兼容。Context Receipt 新增三类受控 warning：缺指令、工具合同损坏、未声明验证。
- 确定性发布门禁由 85 个场景/26 项指标扩展为 90 个场景/27 项指标，新增 `skill_runtime_contract_accuracy`，固定精确发布身份、按需资源、权限交集、脚本不可执行、验证声明和无正文回执五条不变量。本阶段复用现有 `SkillRelease`、`ChatRun`、Message metadata 与 Context Receipt，不新增数据库迁移。
- 本阶段参考 OpenAI Codex `codex-rs/skills/src/selection.rs`、`codex-rs/ext/skills/src/host_prompt.rs` 和 `fragments.rs` 在 commit `5e26f7621c1c470fe62350d61c9eb4d6c772a0da` 的“轻量发现、本轮命中后再加载、显式加载结果”边界，并重写为 Aria 原生 Python/React、数据库发布快照与业务授权。Aria 生产运行时不导入、运行或连接 Codex。

### Phase 4B：Skill 交付物验证与证据账本（已实施）

- `Skill Runtime Contract v1` 对识别出的验收步骤及验收资源生成内容安全的 `verification_plan_sha256`，使后续证据能证明“针对哪一版清单”，但不暴露清单正文。
- 制品只有在 `UPLOADS_DIR`、项目文件归属、真实大小与内容 SHA-256 校验后才进入验证。Aria 自有校验器再检查存在/非空/扩展名/字节身份，以及 OpenXML、PDF、常见图片、Markdown/文本/JSON/CSV/HTML 的格式完整性；检查有资源上限，不执行宏、嵌入代码、Skill script、包内工具或外部命令。
- `ArtifactVerification` 按 `GeneratedFile + content SHA-256 + verifier version + Skill release SHA-256` 建立幂等不可变记录，保存受控检查码、计数、格式指标和 evidence SHA-256，不保存文件路径、文件正文、Prompt、工具输入/输出或隐藏推理。授权读取沿用附件所属 Conversation/Project ACL。
- 结果分为 `passed / failed / partial / manual_required`。Skill 业务清单默认只能成为人工验收要求；上下文被压缩则是 `context_incomplete`，技术失败附件不能满足交付契约。事件、消息、恢复交付、活动时间线和两套附件卡片共享同一摘要，旧附件无证据时继续兼容但不会伪造状态。
- 幂等迁移 `043_v1_43` 管理证据表、约束、外键和索引，并保持单一 Alembic head。部署门禁纳入迁移、纯逻辑验证、路由授权、级联删除和备份后生产隔离 schema E2E；确定性评测扩展为 95 个场景、28 项指标，新增 `artifact_verification_accuracy`。
- 本阶段依据 OpenAI 官方 Skill 指南中“指令与资源渐进加载；仅在确定性行为或外部工具确有必要时使用代码”的产品边界设计验证层，具体实现为 Aria 原生代码，没有复用新的 Codex 源文件，也不引入 Codex runtime、App Server、SDK、协议、进程或通信。

### Phase 4C：业务验收与最终交付闸门（已实施）

- `manual_required` 制品现在可由当前会话所有者或项目可写成员接受或退回，理由必填；判断以 expected revision 防止并发覆盖，并同时写当前态和 append-only 历史。
- 判断绑定精确技术 verification、文件字节、evidence SHA-256 和 Skill verification plan。`failed/partial` 不能被人工覆盖；接受只代表允许最终交付，不是真值认证，也不写记忆、不关问题、不发送外部消息。
- Aria 自有声明式业务校验器只读取已验证的有界结构指标。未知规则失败关闭，Skill 包代码、脚本、宏、shell 和动态 callable 不可执行。幂等迁移 `044_v1_44` 保持单一 head。

### Phase 4D：结构化交付物目录与对话选择（已实施）

- 全部 48 个内置 Skill 的 311 个 Deliverable Catalog 条目由活动不可变发布确定性解析。每项包含稳定 ID、格式、阶段、最低内容、归档目标和合同 SHA-256，目录另有 catalog SHA-256 并绑定 release SHA-256。
- 项目对话在明确指定 Skill 后提供一次性交付物选择。服务端不信任浏览器名称，而是用 `deliverable_id + catalog_sha256 + contract_sha256` 对本轮实际发布重新核对；任何发布或条目漂移返回 409。
- 精确合同进入 Provider 指令边界、Message metadata、Context Receipt 和历史回执；生成文件进一步持久化交付物 ID、名称、合同、目录及 Skill 发布哈希。由此“用户选了什么、模型被要求生成什么、哪个真实文件被产出”形成同一可审计链。
- 保存、知识归档、记忆更新、外部交付和业务验收继续是独立授权动作，不会因为目录声明而自动发生。当前已提供显式“保存到项目文档”：只接受技术校验通过且请求/数据库/真实字节 SHA-256 一致的制品，在锁内重做项目写授权并保存 `project_file_id`、操作者和时间；重试幂等，且响应声明不写知识库、记忆或外部消息。新增项目文档只会使已派生的项目记忆失效，不会自动重建或推广内容。幂等迁移 `045_v1_45` 保持唯一 head；确定性门禁为 104 个场景、30 项指标；实现完全是 Aria 原生 Python/FastAPI/React，不引入或连接 Codex 运行时。

### Phase 4E：显式知识归档与交付物结构验收（已实施）

- 48 个内置 Skill 的 311 个交付物条目都按声明格式生成 Aria 自有、有界、声明式的结构校验要求，并将它纳入条目 contract SHA-256、本轮上下文、Product Run Event 和 `GeneratedFile`。实际制品只运行与其文件类型相符的规则；未达阈值为 `failed`，规则不可应用为 `partial`，二者都不能绕过最终交付门禁。
- 自动化范围只包含 PPTX 幻灯片数、XLSX 工作表数、DOCX 段落数、PDF 页数、文本行数和 CSV 行数。目录的“最低内容”及行业语义不会被伪造为机器验证，仍需人工验收；Skill 脚本、宏、shell 和动态 callable 没有执行通道。
- 制品卡片提供独立的知识归档控件，只在用户展开时读取当前可写 Source 和已有归档。用户必须选择激活 Source、显式勾选确认，并上送精确 content SHA-256；模型、Skill 目录和浏览器都无权替代该动作。
- 服务端分别锁定制品与 Knowledge Source，对两个资源重做最终写授权，核对真实文件字节与技术/业务/人工合成验收门禁。按制品、Source 和内容摘要去重，原始字节落到受控知识存储，审计关系与持久化 `KnowledgeJob` 负责可恢复索引。响应明确声明不写项目/客户记忆、不外发、不解决项目问题。
- 幂等迁移 `046_v1_46` 增加制品校验要求和归档关系，保持唯一 Alembic head。部署与备份后生产数据库 E2E 纳入新迁移测试；超时窗口扩展为 job 40 分钟/SSH 35 分钟，以覆盖已达 98% 的全套件而不放宽 schema 隔离、`public` 签名或清理要求。确定性门禁为 108 个场景、31 项指标。全部实现是 Aria 原生 Python/FastAPI/React/PostgreSQL，不运行、导入或连接 Codex。

### Phase 4F：长期对话压缩与回答诊断（已实施）

- 普通问答、项目深挖和 Skill 执行最多读取 96 条可见候选消息，再由 Context Budget 在真实模型窗口内决定保留与压缩；跨项目/工作台查询保留 6 条，任务编排不携带普通聊天历史。Mode 的历史行为统一来自 `MODE_CONFIG`，不再由 runtime 分支各自猜测。
- 压缩保持最近消息优先、UTF-8 安全和 tool_use/tool_result 原子关系，较早历史只形成有界摘录并明确标为历史数据。预算报告固定记录策略、原因、摘要注入、最早保留位置及前后计数，不调用 Codex 或任一远程 compaction API。
- Context Receipt 新增加载、Provider 实际保留、摘要化和近期截短计数；旧回执字段可继续读取。三套对话 UI 使用同一标签逻辑，不再把预预算加载量展示成最终上下文量。
- 新增单消息回答诊断、Conversation 内分页列表和 trace-id 对比接口。投影只包含 Mode、Action Policy、路由方法/受控原因、模型、上下文完整性与计数、工具状态计数、Artifact 数、fallback 类型及白名单耗时；严格排除 Message/Prompt 正文、工具参数/结果、Artifact 路径和隐藏推理，并在读取及对比前执行 Conversation ACL。
- 项目消息只在用户点击“查看回答诊断”后加载；可选择同一会话另一轮，直接看到路由、模型、压缩、历史保留、工具与降级变化。本阶段复用现有 `ChatTrace`，无数据库迁移。上下文预算与历史管理继续基于仓库已注明的 Codex Apache-2.0 固定版本机制，全部实现为 Aria 原生 Python/React，不运行或连接 Codex。
- 确定性发布门禁扩展为 112 个场景、32 项指标，新增 `conversation_trace_diagnostic_safety_rate`，覆盖 full/recent/none Mode、超限历史压缩和诊断隐私。

### Phase 4G：对话运行配置与 Prompt 层完整性（已实施）

- 6 个 Chat Mode 的 Prompt、模型策略、Token 上限、上下文模式、历史策略、身份前言和工具池统一由 `MODE_CONFIG` 驱动。Portfolio/Workspace/Standalone 不再在 runtime 内各自维护模型分支；Scheduled Task 显式选择 Mode。
- 工具进入 Provider 前先经过 Mode 工具池，再经过 ToolAccessPolicy 与 ActionPolicy。普通项目对话只能看到声明的项目工具；Skill/Task 虽允许冻结动态工具集，但未知或未注册工具仍被移除。运行时 Capability Manifest 继续是权限、副作用、重试、并行和事件映射的唯一事实源。
- 基础身份、Mode、统一回答纪律、Skill/Project/Knowledge 上下文包装、工具历史、Turn Contract 和能力边界改为文件化 Prompt。统一回答纪律固定结论优先、事实/推断分离、陈旧/缺失证据披露、禁止虚报执行以及合法证据键引用。
- 每轮持久化 `Prompt Layer Manifest v1`，只含有序相对路径、层 SHA-256 和整体 SHA-256；用户侧回答诊断只展示是否存在、是否完整、层数和跨轮版本变化，不返回任一 Prompt 或业务正文。
- `assert_chat_runtime_configuration` 在启动与部署测试中检查 Mode 全覆盖、17 个工具注册/Manifest 一致性、操作枚举与权限映射、工具池、Prompt 文件及工具说明 YAML。任何缺失或漂移失败关闭。确定性门禁为 116 个场景、33 项指标，新增 `chat_runtime_configuration_integrity_rate`；无数据库迁移，无新增 Codex 源码复用，不运行或连接 Codex。

### Phase 4H：回答完整性、来源优先级与溯源校准（已实施）

- 文件化回答纪律新增多维度覆盖清单：用户说“分别”或要求多个指标时，每一项都必须单独回答，相邻指标不能替代。
- 证据冲突时优先使用当前、直连原始来源；陈旧或间接记忆只可作为限定上下文。`scoped`/`legacy`/`unresolved` 事实不得被描述为已核验事实。
- 真实 Provider 门禁由 4 个扩展为 6 个合成项目问答，新增陈旧/当前来源冲突和未解析记忆用例。事实完整率、引用覆盖率、拒答、来源优先和溯源校准阈值为 1.0，不支持主张率为 0。
- 首答质量单独计量；若有维度遗漏、引用关联或限定失败，Aria 基于安全的 `[R*]` 失败摘要执行最多两轮定向修复，修复后仍须满足同一组 100% 门禁。
- 确定性门禁扩展为 120 个场景、34 项指标，新增 `grounded_answer_contract_accuracy`。项目记忆页显示来源可核验比例、范围来源和待补证数，对话回执对非直接来源给出警示。
- 本阶段无数据库迁移，不运行、导入或连接 Codex；项目、记忆、Skill、权限与审计仍全部属于 Aria。

### Phase 4I：聚合记忆兼容依赖量化（已实施）

- 新增无正文 `Memory Read Authority Report v1`，按项目/客户精确统计预期槽位、可读账本值、缺失/损坏回退、陈旧槽位、双写差异和非槽位聚合键，并按固定安全槽位名汇总差异计数。
- 陈旧槽位按键汇总；双写差异额外汇总 JSON 类型变化和槽位/当前聚合版本关系，用于安全识别历史 `null` 占位而不暴露任何记忆内容或实体 ID。
- 报告分别表示业务槽位是否可切换、双写是否一致、聚合容器是否可废弃，不把“槽位齐全”误报成“历史、rebuild 和 candidate 元数据已可删除”。
- 项目和客户记忆界面显示槽位账本权威或兼容回退/双写差异数。部署与生产数据库 E2E 运行只读全库汇总，输出不含实体 ID、记忆值、证据正文或凭据。
- 确定性门禁扩展为 124 个场景、35 项指标，新增 `memory_read_authority_accuracy`。本阶段无迁移，不自动删除聚合数据，不引入或连接 Codex。

### Phase 4J：历史空槽位收敛（已实施）

- 生产审计将 21 个差异全部定位为版本一致的 `null -> array`：18 个客户 `relationship_signals`、3 个项目 `client_stakeholders`，无缺失、无损坏、无回退。
- 幂等迁移 `047_v1_47` 只修复「原聚合键缺失 + 槽位为合法 `null` + 版本一致」的历史占位，不覆盖显式空值、内容、异常摘要或版本冲突，不修改快照。
- 迁移测试同时覆盖 SQLite 幂等性和隔离 PostgreSQL 真实方言；生产仍由部署工作流在已验证备份后执行。不运行或连接 Codex。

### Phase 4K：用户可见记忆读取切换（已实施）

- 项目/客户记忆详情、项目简报、干系人分析 Prompt、工作区清单和客户项目组合不再直接信任兼容聚合 JSON，而是以 SHA-256 校验通过的独立槽位为读取权威。
- 单个槽位缺失或损坏时仅该槽位回退聚合值；有效槽位即使与聚合副本分歧也保持权威。工作区通过一次批量查询覆盖全部已授权项目，避免随项目数增加槽位查询。
- 记忆重建、候选接受、快照、回滚、客户晋升和聚合专属运维元数据保持原有事务语义。本阶段不删数据、不新增迁移、不改变 Aria 权限或 HITAS，也不运行或连接 Codex。

### Phase 4L：聚合元数据作用域分类（已实施）

- 读取权威报告在公共安全键之外按实体类型识别 Aria 自有运维键：项目允许 `_client_promotion`、`_last_failure`，客户只允许 `_last_failure`。报告只返回固定键名和计数，不返回失败详情、晋升内容或业务正文。
- 跨作用域键和任意未知键继续计为未知，避免宽泛白名单掩盖异常。已知元数据分类不使聚合容器可退役，后续仍须先迁移历史、候选、覆盖、晋升和失败状态。
- 确定性门禁扩展为 125 个场景、35 项指标；本阶段不写生产业务数据、不新增迁移、不运行或连接 Codex。

### Phase 4M：记忆运维状态原生化（已实施）

- 幂等迁移 `048_v1_48` 为项目增加失败与客户晋升回执列，为客户增加失败与重建取消代次列，并只从格式合法的旧聚合键回填；不删除任何旧值、槽位或快照。
- 失败、成功、取消和晋升写入继续服从 Aria 项目/客户最终授权、owner 行锁与现有事务；运行期双写兼容副本，读取原生列优先、未回填才回退聚合。
- 部署与生产 E2E 的只读报告增加 operation-state 原生覆盖、缺失和分歧计数，不返回错误正文、晋升内容、代次或实体 ID。确定性门禁为 126 个场景、35 项指标；不运行、导入或连接 Codex。

### Phase 4N：未知聚合键无正文指纹（已实施）

- 生产 Phase 4L 审计确认项目未知键为 0；客户仍有一个实体包含 7 个未分类键，因此保持告警，未用更宽的白名单掩盖。
- 每个未知键只生成 `aria.memory.aggregate-key.v1` 命名空间 SHA-256、键长度和 JSON 类型，全库仅输出相同 profile 的次数；按实体最多保留 64 项、汇总最多保留 128 项并显式标记截断；不返回键名、值、客户 ID 或业务正文。
- 指纹用于和代码内已知历史 schema 候选离线比对。无法证明来源的键继续视为未知并阻止聚合容器退役。确定性门禁为 127 个场景、35 项指标；本阶段只读、无迁移、不运行或连接 Codex。

## 11. 官方资料与许可证

- OpenAI 模型与 Agent 提示建议：<https://developers.openai.com/api/docs/guides/latest-model>
- OpenAI Compaction API：<https://developers.openai.com/api/reference/resources/responses/methods/compact>
- OpenAI Skills 指南：<https://learn.chatgpt.com/docs/build-skills>
- OpenAI Codex 源码：<https://github.com/openai/codex>

本阶段改编遵循 Apache License 2.0，具体归属、固定 commit 和本地许可证副本见仓库根目录 `THIRD_PARTY_NOTICES.md` 与 `third_party/openai-codex/LICENSE`。
