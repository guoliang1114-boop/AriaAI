# 项目对话与 Skill 交互全量优化方案

> 更新日期：2026-08-24
> 对照基线：OpenAI Codex `83d1fe0e67b1323f71febc2925817732b449f1d9`
> 产品边界：只吸收源码机制，不运行、不调用、不连接 Codex。

## 1. 结论

Aria 当前最薄弱的不是“模型不够强”，而是模型前后的交互控制还没有完全形成一个用户可理解、系统可验证的闭环。项目上下文、Skill、记忆、RAG、工具和执行记录已经具备较好的工程基础，但此前仍有两个会直接破坏交互信任的问题：

1. `Conversation.skill_id` 被当成永久生效开关。用户切换话题后，旧 Skill 仍可能静默改变后续回答。
2. 后端自动匹配或沿用 Skill 时，聊天页不知道本轮实际使用了哪个 Skill，也不能解释它为何被启用。

Phase 2T 先关闭这两个缺口。长期目标则是让每一轮项目对话都能回答五个问题：

- 我理解你现在要什么？
- 我正在使用哪些项目事实、文件、记忆和 Skill？
- 我准备回答、规划，还是直接执行？
- 哪些动作已经完成，哪些仍需确认或失败？
- 下一轮继续时，需要保留什么，应该释放什么？

## 2. Codex 可借鉴能力全量地图

| 能力层 | Codex 参考路径/机制 | 值得借鉴的原则 | Aria 当前状态 | Aria 后续动作 |
|---|---|---|---|---|
| 本轮输入边界 | `core/src/session/turn_input.rs`、`session/turn.rs` | 每轮输入是新的决策边界；追加上下文、纠偏和开始新轮次必须可区分 | 已有 `SendMessageRequest`、Turn Contract | 增加结构化“本轮目标/约束/引用对象”输入，不依赖纯文本猜测 |
| 项目指令层级 | `codex-home/src/instructions/mod.rs` | 全局、项目、目录指令按明确层级加载，越近的规则越具体 | 已有系统 Prompt、项目上下文、Skill Prompt，但优先级主要靠拼接顺序 | 建立显式 `InstructionManifest`，记录来源、优先级、作用域和冲突裁决 |
| Skill 发现 | `skills/src/loading.rs`、`parser.rs` | 先发现元数据，命中后再加载完整内容；坏包隔离 | 已完成 Skill Root 快照、发布态目录、解析校验 | 增加作者预览、依赖校验、样例输入和质量评分 |
| Skill 本轮选择 | `skills/src/mentions.rs`、`selection.rs` | 只解析本轮结构化输入和显式提及；去重后注入本轮 | 曾把会话 Skill 无条件粘住；Phase 2T 已修复 | 增加更丰富的显式 `@Skill` 解析和歧义候选确认 |
| Skill 续用/释放 | Codex 的 per-turn selection boundary | Skill 不是会话永久所有者；是否续用应由本轮相关性决定 | Phase 2T 已实现相关追问续用、无关话题释放、显式退出 | 用真实匿名交互数据持续校准续用词与误触发率 |
| Skill 可见性 | Turn 内 Skill 注入项 + 运行事件 | 用户应知道本轮实际加载了什么能力 | Phase 2T 已通过 `run_started.skill` 展示来源 | 增加可展开的“为什么匹配”和一键关闭/切换 |
| 项目世界状态 | `core/src/context/world_state/` | 把工作目录、规则和环境变化建模为基线与差异，不把所有内容反复塞入 Prompt | 已有项目/客户结构化上下文与 Context Assembly Manifest | 增加项目状态版本、变化摘要和陈旧证据提示 |
| 对话历史治理 | `core/src/context_manager/history.rs` | 保持工具调用/结果配对，压缩时保留任务状态和恢复边界 | 已有 history window、工具转录规范化和本地预算压缩 | 从“摘录旧消息”升级为结构化 continuation capsule |
| 长对话压缩 | Context compaction 与状态续接 | 压缩结果必须保留目标、已完成动作、假设、标识、工具结果、阻塞与下一步 | 已有确定性本地压缩，未使用 Provider 专属远程压缩 | 建立 Provider-neutral `Conversation Capsule v1`，必要时再评估官方 Compaction API |
| 计划与执行 | `session/turn.rs` 的 turn loop、任务状态 | 计划、执行、反馈和完成应有状态边界，用户纠偏可进入当前轮次 | 已有 Intent/Turn/Artifact Contract、Agent Loop、Durable Task | 给用户展示简洁执行契约，并支持“只改计划、不重开任务” |
| Steering | `session/turn_input.rs` 的 steer + expected turn id | 用户追加要求必须绑定正确运行，防止发给已经结束或另一个 Run | 已有 stop/cancel 和 run id，普通追加仍是新消息 | 增加运行中追加指令队列与 expected run id 校验 |
| 中断与恢复 | Task abort、rollout reconstruction | 停止不是删掉结果；应保存部分输出、已执行副作用和可恢复状态 | 已完成用户中断、Rollout、恢复规划 | 前端提供“从中断点继续”而非只显示失败 |
| 工具协议 | tool call/result pairing、registry、parallel lanes | 工具定义、权限、调度和回填必须共享同一事实源 | 已完成 Tool Capability Manifest、转录规范化、只读并行 | 增加面向用户的工具原因和影响说明 |
| 审批边界 | approvals、sandboxing、exec policy | 技术可执行不等于产品允许；动作在执行前应重验 | 已完成三态策略、HITAS、审批信封 | 统一聊天页与项目页审批体验，增加批量影响摘要 |
| 运行事件 | 结构化 turn/item/event 流 | 文本只是结果之一；步骤、工具、交付物、错误需要独立事件 | 已有 Product Run Event v1 和时间线 | 补充 Context/Skill receipt，并逐步淘汰旧 status 特例 |
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
  ├─ Skill / Context 回执
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

## 7. Conversation Capsule v1 建议

长对话不能只保留最近 24 条，也不能用一段自由文本摘要代替状态。建议建立可版本化、Provider-neutral 的续接胶囊：

```json
{
  "version": 1,
  "active_goal": "当前要完成的业务目标",
  "turn_mode": "answer_only | plan_only | execute_now",
  "active_artifact": {"id": "...", "type": "pptx", "status": "draft"},
  "confirmed_constraints": ["不修改原文件"],
  "decisions": ["使用三阶段路线图"],
  "completed_actions": ["已读取项目范围说明"],
  "tool_outcomes": [{"call_id": "...", "status": "completed", "summary": "..."}],
  "open_questions": ["预算上限尚未确认"],
  "blockers": [],
  "next_step": "补齐价值测算",
  "source_message_ids": [101, 102]
}
```

胶囊必须由确定性字段与有界摘要组成，绑定来源消息和版本；不能保存隐藏推理，也不能越过项目权限。官方长上下文建议同样强调，压缩后要保留已完成动作、假设、标识、工具结果、阻塞和下一目标。Aria 应先实现本地、Provider-neutral 版本，再决定是否对支持的模型使用远程 Compaction API。

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

### Phase 2U：Conversation Capsule 与上下文优先级

- 建立 `Conversation Capsule v1`；
- 引入显式 Instruction Manifest 和冲突裁决；
- 压缩前后验证目标、约束、工具结果、交付物和下一步不丢失；
- 在 Context Assembly Manifest 中只记录摘要哈希和来源，不记录敏感原文。

### Phase 2V：运行中 Steering 与理解回执

- 支持绑定 `expected_run_id` 的追加要求；
- 在模型开始前展示简洁 Turn Receipt；
- 用户可修正范围、格式和交付物，不必终止并重开整个任务；
- 错 Run、已终止 Run 或越权追加全部拒绝。

### Phase 2W：多轮项目对话 Evals

- 建立项目对话、Skill 生命周期、话题切换、长对话续接和用户纠偏数据集；
- CI 输出误触发率、释放正确率、约束保持率和虚假完成率；
- 发布前对 Provider/模型变化做同集对比，不只看测试是否报错。

## 11. 官方资料与许可证

- OpenAI 模型与 Agent 提示建议：<https://developers.openai.com/api/docs/guides/latest-model>
- OpenAI Compaction API：<https://developers.openai.com/api/reference/resources/responses/methods/compact>
- OpenAI Skills 指南：<https://learn.chatgpt.com/docs/build-skills>
- OpenAI Codex 源码：<https://github.com/openai/codex>

本阶段改编遵循 Apache License 2.0，具体归属、固定 commit 和本地许可证副本见仓库根目录 `THIRD_PARTY_NOTICES.md` 与 `third_party/openai-codex/LICENSE`。
