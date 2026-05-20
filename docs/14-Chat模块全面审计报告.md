# Chat 模块全面审计报告

> 审计日期：2026-05-20
> 审计基线：`a6fcb8b`（`Fix project chat feedback and tool recovery cues`）+ 本报告记录的流式韧性增量修复
> 审计范围：后端 `AriaAI/backend/app/services/chat/`、`task_orchestrator.py`、`chat_artifacts.py`、`chat_streaming.py`；前端 `aria-web/src/pages/projects/` 项目对话相关组件。
> 审计目标：确认 Chat 功能是否仍存在补丁式逻辑、错误路由、流式输出不稳定、资源生命周期和前端交互问题，并给出可执行修复优先级。

---

## 一、执行摘要

当前 Chat 模块已经完成一轮关键收敛：P0-P4 分层清晰，项目任务编排有结构化 Router，项目对话页的 Skill 误触发和 Auto-PPT 后处理补丁已经移除，项目对话页也不再把“项目关注锚点”卡片插入聊天流。最新版本还修复了发送后无即时反馈、普通工具失败误导打开空任务面板、Markdown 读取工具缺少 `action` 参数等体验问题。

但 Chat 仍有若干生产级风险，主要集中在四类：

1. **流式生命周期**：取消、断线、尾部 buffer、generator close 仍需加强。
2. **前端并发与恢复**：快速重复发送、网络中断、后台任务状态恢复仍不够稳。
3. **持久化一致性**：用户已经看到的内容，如果 P4 保存失败，仍可能刷新后丢失。
4. **大上下文治理**：RAG / 项目上下文 / 历史消息仍缺少统一 token 预算。

整体判断：
**Chat 架构方向已经正确，但还没有达到“高并发、弱网络、大项目上下文”下的生产稳态。**

---

## 二、已经修复的关键问题

以下问题在当前版本 `a6fcb8b` 已经修复，不应再作为当前缺陷重复记录。

| 问题 | 当前状态 | 说明 |
| --- | --- | --- |
| Skill 依赖关键词自动触发 | 已修复 | 新增 `SkillActivationDecision`，只有用户强制 Skill 或显式调用 Skill 才启用。 |
| “生成 / 报告 / 方案 / PPT”等词误触发 Skill | 已修复 | 这些意图交给项目任务 Router，而不是隐式启用选中的 Skill。 |
| Auto-PPT fallback | 已移除 | Chat 主链路不再在 P3 后偷偷补生成 PPT。交付物必须由 Planner/工具调用明确产生。 |
| `_should_auto_generate_digital_strategy_ppt` | 已删除 | 不再保留数字化战略专用自动补 PPT 入口。 |
| 项目对话页显示“项目关注锚点” | 已修复 | `ProjectAnchorsCard` 已从项目聊天主面板移除，锚点功能保留在概览/锚点管理页。 |
| `chat_streaming.py` 旧 shim patch 不生效 | 已修复 | 新增兼容 wrapper，旧测试/旧调用 patch shim helper 时仍能生效。 |
| 发送后长时间无可见反馈 | 已修复 | 前端发送后立即显示更明确的 AI 处理文案，避免用户误以为请求没有发出。 |
| 普通工具失败误导打开任务面板 | 已修复 | 只有真正来自 `TaskRun` 的可恢复任务才显示“打开任务面板处理”。普通工具失败会提示调整请求后重试。 |
| `read_project_markdown_document` 缺少 `action` | 已修复 | 后端在执行前自动补齐安全默认值：有文件目标时 `read`，无文件目标时 `list`。 |
| SSE 尾部事件可能丢失 | 已修复 | 前端在 `reader.read()` 完成后会 flush 剩余 buffer，最后一个无 `\n\n` 的事件也会被处理。 |
| 网络错误清空已接收内容 | 已修复 | 非主动取消的流式错误会保留已收到文本、工具步骤和附件，并标记 `stream_interrupted`。 |
| 客户会议准备被 LLM Router 误判为普通对话 | 已修复 | 明确命中咨询能力目录的结构化交付请求会强制保留规则路由，不再被 LLM 的 direct 误判覆盖。 |
| 文本交付物缺少统一能力协议 | 已修复 | 顾问能力命中后会生成 `CapabilityProtocol`，统一 required_sections、output_schema、quality_rules，并在保存前做结构校验。 |

历史验证：

```bash
PYTHONPYCACHEPREFIX=/private/tmp/aria_pycache PYTHONPATH=AriaAI/backend \
  AriaAI/backend/.venv/bin/python -m pytest \
  AriaAI/backend/tests/test_chat_streaming.py \
  AriaAI/backend/tests/test_chat_phases.py \
  AriaAI/backend/tests/test_chat_phases_integration.py -q

# 166 passed
```

```bash
PYTHONPYCACHEPREFIX=/private/tmp/aria_pycache PYTHONPATH=AriaAI/backend \
  AriaAI/backend/.venv/bin/python -m pytest \
  AriaAI/backend/tests/test_chat_flow.py::ChatStreamingServiceTestCase::test_prepare_chat_runtime_does_not_auto_apply_selected_skill_from_keywords \
  AriaAI/backend/tests/test_chat_flow.py::ChatStreamingServiceTestCase::test_prepare_chat_runtime_applies_forced_skill_contract \
  AriaAI/backend/tests/test_chat_flow.py::ChatStreamingServiceTestCase::test_stream_chat_events_does_not_auto_generate_ppt_after_skill_followup -q

# 3 passed
```

```bash
cd aria-web && npm run build
# passed
```

```bash
PYTHONPYCACHEPREFIX=/private/tmp/aria_pycache PYTHONPATH=AriaAI/backend \
  AriaAI/backend/.venv/bin/python -m pytest \
  AriaAI/backend/tests/test_task_orchestrator.py::test_rule_router_routes_markdown_artifacts \
  AriaAI/backend/tests/test_task_orchestrator.py::test_consulting_capability_route_overrides_llm_direct_misclassification \
  AriaAI/backend/tests/test_task_orchestrator.py::test_high_confidence_rule_route_overrides_wrong_llm_artifact_type \
  AriaAI/backend/tests/test_task_orchestrator.py::test_text_artifact_plan_exposes_capability_protocol \
  AriaAI/backend/tests/test_task_orchestrator.py::test_text_artifact_storyline_respects_requested_chapter_count_and_hierarchy \
  AriaAI/backend/tests/test_task_orchestrator.py::test_execute_text_artifact_task_records_markdown_project_file -q

# 6 passed
```

最新验证：

```bash
PYTHONPYCACHEPREFIX=/private/tmp/aria_pycache PYTHONPATH=AriaAI/backend \
  AriaAI/backend/.venv/bin/python -m pytest \
  AriaAI/backend/tests/test_chat_streaming.py -q

# 109 passed
```

```bash
cd aria-web && npm run build
# passed
```

---

## 三、当前架构状态

### 3.1 后端 Chat 主链路

当前后端主链路：

1. `prepare_chat_runtime`
   - 解析 Skill 激活决策
   - 获取/创建会话
   - 保存用户消息
   - 构建上下文
   - 选择模型与 provider

2. `stream_chat_events`
   - P0：可恢复项目任务判断与早返回
   - P1：模型初始输出与工具调用提取
   - P2：执行工具
   - P3：工具结果后的最终回复
   - P4：持久化 assistant 消息与 done 事件

3. `task_orchestrator.py`
   - 项目任务使用结构化 Router
   - 支持 direct / analyze / artifact / orchestrated / edit
   - 支持动态步骤和 text artifact

### 3.2 前端项目 Chat 主链路

当前前端主链路：

1. `ProjectChatTab`
   - 管理项目会话、记忆、模型、Skill、文件预览、任务面板

2. `useProjectChatComposer`
   - 发送消息
   - 读取 SSE
   - 聚合 text/status/tool/artifact/task 事件
   - 写入 `chatStreamStore`

3. `ProjectChatMessages`
   - 渲染历史消息
   - 渲染 streaming 内容
   - 渲染工具调用、任务步骤、附件卡片

4. `ProjectTaskRunsDrawer`
   - 展示可恢复任务与步骤详情

---

## 四、仍然有效的高优先级问题

### P0-1. `CancelledError` 与资源清理需要按生命周期最佳实践处理

旧报告建议“把 `except Exception` 扩展为 `except (Exception, asyncio.CancelledError)`”，这个建议不准确。

更合理的最佳实践是：

```python
try:
    ...
except asyncio.CancelledError:
    # 只做清理和必要状态记录
    raise
except Exception as exc:
    # 普通错误转成用户可见错误
    ...
finally:
    # 关闭 generator / HTTP stream / DB session / pending task
    ...
```

原因：

- `CancelledError` 表示调用方主动取消，不应该被吞掉。
- `sse.py` 已在 pending task cleanup 中处理 `CancelledError`，但主 orchestrator / phase 层还没有按生命周期单独处理取消。
- 需要确保 LLM stream、async generator、pending task、DB session 都能在 `finally` 中释放。
- 对用户刷新页面、Nginx 超时、移动端网络切换很关键。

建议修复范围：

- `services/chat/__init__.py`
- `services/chat/sse.py`
- `services/chat/phases/p0_durable_task.py`
- `services/chat/phases/p1_planning.py`
- `services/chat/phases/p2_tools.py`
- `services/chat/phases/p3_followup.py`
- `services/chat/phases/p4_persist.py`

验收标准：

- 客户端中断后无悬挂 LLM 请求。
- 无未关闭 async generator。
- DB 连接不因流式中断而泄漏。
- 日志中可区分用户取消与真实错误。

---

### P0-2. 前端 SSE 尾部 buffer 仍可能被丢弃

位置：`aria-web/src/pages/projects/useProjectChatComposer.ts`

当前状态：已在本轮修复。前端会在 `reader.read()` 返回 `done` 后 flush `TextDecoder` 尾部内容，并处理剩余 buffer。

风险：

- `done` 事件丢失。
- `error` 事件丢失。
- `truncated` 事件丢失。
- 前端显示“还在生成”，但后端已经结束。

后续建议：

- 将当前内联解析逻辑进一步抽成独立 SSE parser。
- 给 `done/error/truncated` 增加前端单元测试。

验收标准：

- 最后一条 SSE 没有 `\n\n` 时仍能正确完成。
- `done` 事件一定会触发 `setStreamIsLoading(false)`。

---

### P0-3. 前端发送并发保护不完整

位置：`useProjectChatComposer.ts`

当前风险：

- 用户快速点击发送可能产生多个并行 stream。
- `abortControllerRef.current` 会被新请求覆盖。
- 旧流仍可能继续写 `chatStreamStore`。
- 工具调用、附件、进度卡可能交错。

建议：

- `sendMessage` / `sendMessageAsync` 开头增加运行中保护。
- 如果新请求必须开始，先 abort 旧请求并等待旧流退出。
- 每个 stream 分配 `streamRunId`，处理事件时校验当前 run 是否仍有效。

验收标准：

- 快速连点发送只产生一个有效请求。
- 停止按钮能停止当前唯一 stream。
- 旧 stream 结束后不会覆盖新 stream 状态。

---

### P0-4. P4 持久化失败仍可能造成“幽灵回复”

位置：`services/chat/phases/p4_persist.py`

风险：

- 用户已经看到完整回复。
- P4 保存 assistant 消息失败。
- 刷新页面后回复消失。

建议：

- P4 持久化失败时，不应简单返回 error。
- 前端已经收到的 `full_text` 应保留在当前 UI。
- 后端应发送 `done`，但 metadata 标记 `persist_failed: true`。
- 可选：写入本地 outbox / retry queue。

验收标准：

- 模拟 DB commit 失败，前端仍保留本轮回复。
- 用户看到明确提示：“回复已生成，但保存失败，可重试保存。”

---

### P0-5. `total_stream_ms` 指标仍不可信

位置：`services/chat/phases/p4_persist.py`

P0 durable task early-return 路径已经在 `stream_chat_events` 中修正 `total_stream_ms`。普通 P4 持久化路径仍在 P4 内部反推，容易变成接近 `save_ms` 的值，而不是用户感知总耗时。

建议：

- 在 `stream_chat_events` 开头记录 `stream_started_at`。
- 放入 `ChatSessionState`。
- P4 只读取该字段计算总耗时。

验收标准：

- `total_stream_ms >= prepare_total_ms + model_first_event_ms + tools_total_ms + follow_up_ms + save_ms` 的合理下界。
- P0 durable task 早返回也能正确记录总耗时。

---

## 五、重要但可分阶段处理的问题

### P1-1. 大上下文缺少统一 token 预算

涉及：

- 系统 prompt
- Skill prompt
- 项目上下文
- 客户记忆
- RAG 内容
- 历史消息
- 用户当前输入

当前主要限制的是输出 `max_tokens`，不是输入 prompt 总 token。

风险：

- 大项目空间或大 RAG 下，prompt 超上下文窗口。
- API 报错、静默截断或模型输出质量下降。

建议：

- 建立 `ContextBudget`：
  - `system`
  - `project_memory`
  - `rag`
  - `files`
  - `history`
  - `user`
- 根据模型 context window 做分层截断。
- 优先保留用户当前输入、显式引用文件、最近任务状态。

---

### P1-2. RAG 检索需要向量索引或分页策略

旧报告写“必然 OOM”过于绝对，但方向正确。

当前风险更准确地说是：

- chunk 越多，Python 侧全量相似度计算的 CPU 和内存线性增长。
- 在大知识库下会显著拖慢响应，并可能造成内存峰值过高。

建议：

- 优先：pgvector + HNSW/IVFFlat。
- 短期兜底：限制候选 chunk、分页 batch、记录检索耗时和候选数量。

---

### P1-3. `step_index` falsy 判断需要统一

位置：

- `useProjectChatComposer.ts`
- `projectChatWorkflow.ts`

当前状态：已在 `a6fcb8b` 修复主要前端入口，后续新增步骤逻辑仍需沿用同一写法。

风险：

- 如果某些事件使用 `step_index = 0`，前端会当作不存在。
- 当前多数步骤从 1 开始，因此不是立刻爆炸的问题，但属于类型判断不严谨。

建议：

```ts
if (payload.step_index !== undefined && payload.step_index !== null) {
  ...
}
```

---

### P1-4. P1/P3 工具 JSON 跨 chunk 解析仍需加强

当前 P1/P3 会从 chunk 中提取 `tool_use` JSON。如果 JSON 被模型流拆到多个 chunk，存在识别失败风险。

建议：

- 维护跨 chunk JSON buffer。
- 使用增量 JSON 解析。
- 对过长 buffer 设置上限，防止异常内容无限增长。

---

### P1-5. 网络错误时应保留已接收内容

位置：`useProjectChatComposer.ts`

当前状态：已在本轮修复。非主动 abort 的异常会保留当前收到的文本、工具步骤和附件，并在 metadata 中标记 `stream_interrupted`。

风险：

- 用户已经看到部分回复。
- 后续如果新增其他 stream 入口，仍需沿用同一保留策略。

后续建议：

- UI 可进一步显式展示“连接中断，以下为已收到内容”提示。
- 后端 P4 持久化失败也应使用类似的可恢复语义。

---

### P1-6. 后台任务注册表需要并发保护

位置：`chat_async.py`

风险：

- 同一 conversation 的后台任务互相覆盖。
- 旧任务 finally pop 掉新任务。

建议：

- `_background_chat_tasks` 读写加 `asyncio.Lock`。
- pop 时校验 task identity。

---

### P1-7. P3 re-follow-up 文本完全替换主 follow-up 文本

位置：`services/chat/phases/p3_followup.py`

风险：

- 用户已在 SSE 流中看到主 follow-up 的完整文本。
- re-follow-up（二次 tool_use 后的补充回复）执行后，`follow_up_text = re_follow_text` 完全替换原内容。
- 导致**用户看到的内容 ≠ 最终保存到数据库的内容**。

建议：

- 将 re-follow-up 内容追加到主 follow-up 后，而非替换。
- 或明确分隔两段内容（如 `"---\n补充回复：\n"`）。

---

### P1-8. P1 续写时仍传递 `tools=runtime.tools`

位置：`services/chat/phases/p1_planning.py`

风险：

- 截断续写 prompt 已明确要求模型"不要调用工具，只继续之前的文本"。
- 但 `runtime.llm.stream_response(..., tools=runtime.tools)` 仍传入完整 tools 定义。
- LLM 可能在续写中再次 emit `tool_use`，导致无限循环或异常流程。

建议：

- 续写调用时显式传入 `tools=None`（或不传 tools 参数）。

---

### P1-9. `iter_with_heartbeat` 的 dict/str union 混淆

位置：`services/chat/sse.py`

风险：

- `iter_with_heartbeat` 签名是 `AsyncIterator[str | dict]`，但内部逻辑把 dict 当作普通值 yield。
- 如果上游生成器 yield dict（如状态对象），会被误传给 SSE 序列化层，可能导致非法 JSON。
- 类型系统没有保护这种运行时错误。

建议：

- 明确拆分：heartbeat 生成器只 yield str（已序列化的事件），状态更新走单独通道。
- 或改用 `yield sse_event({...})` 保证输出始终是 str。

---

## 六、当前不应再继续走的补丁路线

以下做法应避免继续扩散：

1. **根据关键词直接修某个场景**
   - 例如“看到故事线就走专门逻辑”
   - 更合理：通用咨询能力 schema + Planner 动态步骤

2. **工具失败后静默自动补一个交付物**
   - 例如已移除的 Auto-PPT fallback
   - 更合理：Planner 明确创建交付物步骤，失败则进入可恢复任务状态

3. **在前端用显示层逻辑弥补后端状态不一致**
   - 更合理：后端事件语义清楚，前端只负责渲染和轻量恢复

4. **在 tool repair 中做过多业务猜测**
   - repair 应负责最小参数补齐和校验
   - 任务类型、输出格式、章节结构应由 Router/Planner 决策

5. **让 LLM Router 覆盖高置信规则能力命中**
   - 例如“客户会议准备 + 四个明确模块”已经命中咨询能力目录
   - 更合理：LLM Router 可补充计划步骤，但不能把明确交付物误降级为普通聊天

---

## 七、推荐修复路线

### 第一阶段：流式可靠性

目标：用户发送后，不会出现“无提示、刷新才有结果、内容突然消失”。

任务：

1. SSE 尾部 buffer flush。
2. 前端并发 guard + streamRunId。
3. 网络错误保留已接收内容。
4. `CancelledError` 单独处理 + finally 清理。
5. `iter_with_heartbeat` 对 source 做 `aclose()`。

### 第二阶段：持久化一致性

目标：用户看到的内容，刷新后仍能找到；保存失败要可感知、可恢复。

任务：

1. P4 persist 失败时保留前端内容。
2. metadata 标记 `persist_failed`。
3. 支持“重试保存本轮回复”。
4. 持久化失败测试覆盖。

### 第三阶段：上下文与任务质量

目标：大项目、大文件、多知识源下仍能稳定回答。

任务：

1. ContextBudget。
2. RAG 向量索引或 batch 检索。
3. 工具 JSON 跨 chunk buffer。
4. Planner 输出结构化 schema 校验。

### 第四阶段：前端状态统一

目标：项目 Chat 和通用 Chat 的状态模型不再分叉。

任务：

1. 统一 stream store。
2. 抽离 SSE parser。
3. 抽离 artifact / task / workflow event reducer。
4. **`ProjectChatTab` 迁移到 `chatStore.ts`**：当前 `ProjectChatTab` 仍使用 local `useState` 和 `useProjectChatConversations`，`chatStore.ts` 已创建但未被引用，存在状态树分叉风险。其他组件若消费 `useChatStore` 将与 `ProjectChatTab` 的本地状态不一致。

---

## 八、建议测试补充

### 后端

| 测试 | 目的 |
| --- | --- |
| `CancelledError` 中断 stream | 确认 generator 和 session 清理 |
| P4 persist 抛异常 | 确认前端可保留内容，后端事件不乱 |
| P1/P3 tool_use 跨 chunk | 确认工具调用不会漏识别 |
| P1 续写不传 tools | 确认续写不会再次触发 tool_use |
| P3 re-follow-up 文本追加 | 确认保存内容与用户看到一致 |
| `total_stream_ms` | 确认耗时指标真实 |
| 大 context budget | 确认输入 prompt 不越界 |

### 前端

| 测试 | 目的 |
| --- | --- |
| SSE 最后一条无 `\n\n` | 确认 done/error/truncated 不丢 |
| 连续点击发送 | 确认不会双流交错 |
| 网络错误中断 | 确认已收到文本保留 |
| step_index 为 0 | 确认不会被 falsy 吃掉 |
| artifact download/open | 确认文件卡片行为一致 |

---

## 九、当前结论

Chat 模块现在已经摆脱了最明显的补丁式路径：Skill 不再被宽泛关键词误触发，PPT 不再被后处理自动补生成，项目对话页也不再插入影响焦点的锚点卡片。

下一步的核心不是继续补场景，而是把 **流式生命周期、并发控制、持久化一致性、上下文预算** 做扎实。完成这些后，Chat 才能在真实客户使用中稳定支撑长任务、交付物生成和项目记忆协作。

优先级建议：

1. 先修 SSE buffer flush、并发 guard、取消清理。
2. 再修 P4 持久化失败的用户可见恢复。
3. 然后做 ContextBudget 和 RAG 检索升级。
4. 最后统一前端 Chat 状态模型和 SSE parser。
