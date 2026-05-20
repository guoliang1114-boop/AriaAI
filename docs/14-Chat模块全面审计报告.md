# Chat 模块全面审计报告

> 审计日期：2026-05-20
> 审计范围：后端 `services/chat/`（P0-P4、orchestrator、SSE、state、errors、runtime、RAG）+ 前端 `pages/projects/`（ProjectChatTab、useProjectChatComposer、chatStore、chatStreamStore、types/chat）
> 代码版本：V0.0.2 + P0-P4 重构补丁（commit ef4eec8）
> 审计方法：四维度并发代码走读（编排层、Phase 实现、前端 SSE、运行时与上下文）

---

## 一、执行摘要

Chat 模块在 **业务逻辑拆分** 上已相当成熟（P0-P4 各 phase 职责清晰、类型守卫完善、Zustand store 引入），但在 **并发安全、资源生命周期管理、生产容错** 三个维度存在系统性缺口。

**当前代码在开发环境和低负载下表现良好，但在高并发、大知识库、网络波动的生产环境中会暴露出严重问题。**

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构模块化 | ⭐⭐⭐⭐☆ | P0-P4 拆分清晰，向后兼容 shim 到位 |
| 类型安全 | ⭐⭐⭐☆☆ | 前端 Discriminated Union 好，但运行时无校验；Python 类型提示不完整 |
| 并发安全 | ⭐⭐☆☆☆ | 前后台都有明显竞态，async generator 不清理，后台任务注册表无锁 |
| 错误处理 | ⭐⭐☆☆☆ | `CancelledError` 漏网，P4 失败 = 数据丢失，网络错误丢弃已收内容 |
| 资源管理 | ⭐⭐☆☆☆ | DB session 跨 yield、RAG 全量加载、无 `aclose()` |
| 测试覆盖 | ⭐⭐⭐☆☆ | 单元测试较好（87-100%），集成测试已补充 14 个，但端到端/压力测试缺失 |
| 可观测性 | ⭐⭐⭐☆☆ | timing 指标失真（`total_stream_ms` broken），日志较干净但错误场景覆盖不全 |

---

## 二、严重级别问题（CRITICAL）—— 共 4 项

### CR-1. RAG 检索：全量 chunk 加载到内存 → 必然 OOM

**位置**：`app/services/rag.py:106-121`

```python
chunks = session.exec(stmt).all()  # ← 加载所有 chunk
scored = [(cosine_similarity(query_embedding, chunk.embedding), chunk) for chunk in chunks]
```

- 无向量数据库（pgvector / FAISS / Qdrant），纯 Python 循环做余弦相似度
- 随着知识库增长，每次查询线性增长内存占用
- **影响**：项目到 10k+ chunk 时单次查询可能占用数十 MB，100k+ 时直接 OOM
- **与现有技术债文档的关联**：`02-技术债与行动清单.md` 第 3.3 节已标记，但当前审计确认该风险在生产环境中是**必然触发**的，而非"可能"

**建议**：立即引入 `pgvector` 的 `vector` 类型 + `IVFFlat`/`HNSW` 索引，或至少对 chunk 查询加 `LIMIT` + batch 处理。

---

### CR-2. `asyncio.CancelledError` 完全未捕获 → 客户端断开 = 资源泄漏

**位置**：整个后端调用链

- Python 3.8+ 中 `CancelledError` 继承自 `BaseException`，**不在 `except Exception` 范围内**
- Orchestrator（`__init__.py`）、所有 phase（P0-P4）、`iter_with_heartbeat` 都只 catch `Exception`
- **后果**：用户刷新页面或 Nginx 超时断开时：
  - LLM HTTP 连接未关闭（`iter_with_heartbeat` 不 `aclose()` source）
  - P0 的 `Session(bind)` 同步上下文管理器跨 yield 持有，abandon 时可能不释放回连接池
  - `ChatSessionState` 处于半写完的不一致状态
  - 没有任何 SSE error 事件通知前端，前端只能看到连接中断

**建议**：所有 `except Exception` 扩展为 `except (Exception, asyncio.CancelledError)`；orchestrator 加 `try/finally` 确保状态一致性；`iter_with_heartbeat` 在 `finally` 中 `await source.aclose()`。

---

### CR-3. 前端 SSE 尾部 buffer 被静默丢弃

**位置**：`useProjectChatComposer.ts` read loop

```typescript
while (true) {
  const { done, value } = await reader.read();
  if (done) break;  // ← 剩余 buffer 未 flush
  // ...
}
```

- 如果服务器最后一条事件不以 `\n\n` 结尾，该事件丢失
- 特别是 `done`、`truncated`、`error` 等最终事件——这会导致前端永远等不到 stream 结束

**建议**：`break` 前处理 `buffer` 中剩余的未完成事件。

---

### CR-4. 前台并发无保护 → 多次点击 corrupt 全局状态

**位置**：`useProjectChatComposer.ts` `sendMessage` / `sendMessageAsync`

- 无 `if (isLoading) return;` guard
- 第二次请求覆盖 `abortControllerRef.current`，旧流继续在后台运行
- 两个流同时写入同一个 `chatStreamStore`，`streamingContent` / `streamingToolCalls` / `streamingArtifacts` 内容交错
- `AbortController` 被覆盖后，`stopGeneration` 只能取消最新的请求

**建议**：`sendMessage` 和 `sendMessageAsync` 入口加 `if (isLoading) return false;`；赋值 `abortControllerRef.current` 前先 abort 现有 controller。

---

## 三、高风险问题（HIGH）—— 共 10 项

### HI-1. P4 持久化失败 = 幽灵消息

**位置**：`p4_persist.py:142`

- `persist_assistant_message` 抛异常（DB 死锁、连接断开）时：
  - 用户**已经**在 SSE 流中看到了完整回复
  - 但 DB 中**没有**这条 assistant 消息
  - 刷新页面后，这条"已看过"的回复彻底消失
- 无任何重试或降级保存机制

**建议**：P4 加 `try/except` 包裹 persist，异常时仍 emit `done` 并保留 `full_text`，至少保证前端状态不丢失。

---

### HI-2. `total_stream_ms` 指标完全失真

**位置**：`p4_persist.py:40,115`

```python
stream_started_at = time.perf_counter() - (state.stage_timings.get("total_stream_ms", 0) / 1000)
# 正常流：total_stream_ms 还不存在 → stream_started_at ≈ time.perf_counter()
# 然后 total_stream_ms = time.perf_counter() - stream_started_at ≈ save_ms（几毫秒）
```

- 正常聊天流的总耗时被报告为 **P4 内部的几毫秒**，完全失去监控意义
- 无法用于监控真实用户感知的延迟

**建议**：在 orchestrator `stream_chat_events` 开头记录 `stream_started_at`，存入 `ChatSessionState`，P4 直接读取。

---

### HI-3. 输入 token 无限制 → 可能超过模型上下文窗口

**位置**：`chat/runtime.py`、`openai_compat.py`、`claude.py`

- 系统 prompt (~1,100 字) + skill prompt + project_context（无界）+ RAG（无界）+ 24 条历史消息
- `_cap_max_tokens_for_model()` 只限制 **输出** `max_tokens`
- 无任何 tokenizer 计算或截断逻辑
- 大项目 + 大 RAG 可能轻松组装出 50k+ token 的 prompt，API 直接拒绝或静默截断

**建议**：引入 `tiktoken` 或 provider 专用 tokenizer，在 `prepare_chat_runtime` 中对 project_context、rag_context、历史消息做截断，确保总 prompt < model_context_window - max_tokens。

---

### HI-4. 后台任务注册表竞态

**位置**：`chat_async.py`

```python
_background_chat_tasks: dict[int, asyncio.Task] = {}  # 无锁
```

- 同一 `conv_id` 的新任务取消旧任务后，旧任务的 `finally: pop()` 可能把**新任务**也 pop 掉
- 状态端点返回"已完成"，但实际上后台任务仍在跑
- 同步 DB commit 阻塞事件循环

**建议**：用 `asyncio.Lock` 保护 `_background_chat_tasks` 的读写；DB commit 用 `loop.run_in_executor()`。

---

### HI-5. P3 re-follow-up 截断被静默吞掉

**位置**：`p3_followup.py:389-421`

- 二次 follow-up（执行 P3 内检测到的额外工具后）如果再次截断：
  - 只 emit `status: continuing`，**不发** `{"type": "truncated", "can_continue": true}`
  - **不触发**自动续写循环
  - 用户看不到"Continue"按钮，内容不完整就被保存

**建议**：re-follow-up 流补全与主 P3 流相同的截断检测 + 续写逻辑。

---

### HI-6. 网络错误丢弃已接收内容

**位置**：`useProjectChatComposer.ts` catch 块

- 非 `AbortError`（如 Wi-Fi 断开、服务器 5xx）时调用 `resetStream()`
- 已积累的 `fullContent` 被完全丢弃
- 用户已经看到部分回复，但断网后全部消失

**建议**：非 abort 异常时，将 `fullContent` 追加到 messages 中（类似 abort 的处理方式），再调用 `fetchMessages()` 同步。

---

### HI-7. `iter_with_heartbeat` 不 `aclose()` source → LLM 连接泄漏

**位置**：`sse.py:22-54`

```python
async def iter_with_heartbeat(source, ...):
    iterator = source.__aiter__()
    pending = asyncio.create_task(iterator.__anext__())
    try:
        while True:
            ...
    finally:
        if not pending.done():
            pending.cancel()
            try:
                await pending
            except (asyncio.CancelledError, StopAsyncIteration):
                pass
```

- `finally` 只取消 `pending`，但**从不调用 `await source.aclose()`**
- 如果 consumer abandon 了 generator，底层 LLM HTTP 连接/订阅/WebSocket 可能一直保持打开

**建议**：`finally` 块中增加 `await source.aclose()`；orchestrator 中用 `contextlib.aclosing` 包裹所有 phase generator。

---

### HI-8. P0 的 `Session(bind)` 跨 yield 持有 → DB 连接泄漏

**位置**：`p0_durable_task.py:65`

```python
with Session(bind) as task_session:
    ...
    yield sse_event(...)  # ← 同步上下文管理器跨 yield
```

- Python 3.9 中同步上下文管理器在 async generator 被 abandon 时，`__exit__` 不保证调用
- DB 连接可能永远停留在"已检出"状态，连接池耗尽

**建议**：将 SSE event 收集到 list buffer，在 `with Session(...)` 块内完成所有 DB 操作，退出后再 yield buffer 中的事件。

---

### HI-9. `step_index: 0` 被当 falsy → 工作流第一步跳过

**位置**：`useProjectChatComposer.ts`

```typescript
if (payload.step_index) { ... }  // step_index=0 走不进这里
```

- 工作流第一步（index=0）被误当作普通 status，不渲染为工作流步骤
- 用户看不到"第 1 步：..."的 UI

**建议**：改为 `if (payload.step_index !== undefined)`。

---

### HI-10. 部分响应在 phase 失败时不持久化

**位置**：`__init__.py` orchestrator

- P1 成功流了很长内容给用户，但 P2 抛异常
- orchestrator yield error 后返回，部分 assistant 文本**从未持久化**
- 用户刷新后，这条已看过的回复消失

**建议**：orchestrator 的 `except` 块中，如果 `state.text_buffer` 非空，将其作为降级内容持久化（标记为 `incomplete`）。

---

## 四、中等风险问题（MEDIUM）—— 共 9 项

### ME-1. `tool_use` JSON 跨 chunk 分裂无法恢复

- P1/P3 的 `extract_tool_use_json_blocks(chunk)` 是**逐 chunk** 调用
- 如果 `{"type": "tool_use", ...}` 被 SSE 分割到两个 chunk，永远检测不到
- 残留 JSON 作为普通文本存入 `text_buffer`，最终被用户看到

**建议**：在 P1/P3 中维护一个跨 chunk 的 JSON buffer，对不完整 JSON 做增量解析尝试。

---

### ME-2. P1 续写时仍传递 `tools`

- 续写 prompt 明确要求"不要调用工具"
- 但 `runtime.llm.stream_response(..., tools=runtime.tools)` 仍传了 tools
- LLM 可能在续写中再次 emit `tool_use`

**建议**：续写调用时 `tools=None`。

---

### ME-3. P3 re-follow-up 的 `follow_up_text` 被完全替换

- 用户已在 SSE 中看到主 follow-up 的文本
- re-follow-up 后 `follow_up_text = re_follow_text` 完全替换
- **看到的内容 ≠ 保存的内容**

**建议**：re-follow-up 文本追加到已有 `follow_up_text` 上，而非替换。

---

### ME-4. `ChatError` 类型体系是 dead code

**位置**：`errors.py`

- 定义了 `ChatStreamingError` / `ChatContextError` / `ChatToolError`
- 没有任何 phase raise 它们，也没有任何 caller catch 它们
- 维护负担 + 虚假安全感

**建议**：要么在各 phase 中使用它们（orchestrator catch 它们并做特殊处理），要么删除 `errors.py`。

---

### ME-5. `chatStore.ts` 在 `ProjectChatTab` 中未被使用

- `ProjectChatTab` 仍使用 local `useState` 和 `useProjectChatConversations`
- 其他组件如果消费 `useChatStore`，状态树分叉，active conversation ID 不一致

**建议**：统一迁移到 `useChatStore`，或暂时移除未使用的 store。

---

### ME-6. 后台任务同步 DB commit 阻塞事件循环

**位置**：`chat_async.py`

- `_mark_background_chat_run()` 是同步函数，在 async 任务中直接调用
- 阻塞整个事件循环直到 DB commit 完成

**建议**：用 `asyncio.get_event_loop().run_in_executor()` 包装同步 DB 操作。

---

### ME-7. 无重试 / 断线重连 / 恢复逻辑

- SSE 断开即终止，无任何重试
- 30 秒超时后只 abort，不尝试恢复
- 长时间任务（如 PPT 生成）对网络波动极度敏感

**建议**：前端实现指数退避重试（最多 3 次），或至少在网络恢复后自动 `fetchMessages()` 同步最新状态。

---

### ME-8. `StreamConversationIdEvent` 定义了但从未处理

**位置**：`types/chat.ts` / `useProjectChatComposer.ts`

- 后端 emit `conversation_id` 事件，但前端 composer 的 event parser 没有处理它的分支
- 如果服务器 emit 它，事件被静默跳过

**建议**：composer 中补充 `conversation_id` 的处理分支，更新 `activeConvId`。

---

### ME-9. `sendMessageAsync` timeout ID 组件卸载后泄漏

**位置**：`useProjectChatComposer.ts`

- `setTimeout` 的 ID 在组件卸载时未清理
- 超时回调仍尝试 abort `abortControllerAsyncRef.current`
- 虽然不会 crash（有 optional chaining），但 timeout ID 泄漏直到触发

**建议**：在 `useEffect` cleanup 中 `clearTimeout(timeoutId)`。

---

## 五、低风险问题（LOW）—— 共 8 项

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| LO-1 | `first_model_event_recorded` 重复设置 | `p1_planning.py:97-106, 157-168` | 安全但冗余 |
| LO-2 | `tool_duration_ms` 对失败工具也计时 | `p2_tools.py:232` | 设计如此，但可能误导 |
| LO-3 | `stage_timings` 混存 `int` 和 `str` | `state.py` | `selected_model`（str）和毫秒（int）在同一个 dict |
| LO-4 | `bind` 参数无类型注解 | 所有 phase 签名 | 应注解为 `sqlalchemy.engine.Engine` |
| LO-5 | `reader.releaseLock()` 未被调用 | `useProjectChatComposer.ts` | 现代引擎通常自动清理，但显式释放更安全 |
| LO-6 | `as StreamEvent` 运行时 cast 无校验 | `useProjectChatComposer.ts` | 无 Zod/io-ts 验证， malformed 数据可能导致运行时异常 |
| LO-7 | 动态 import `parseMentions` 增加延迟 | `ProjectChatTab.tsx` | 模块已缓存，但每次 send 都触发 import 表达式 |
| LO-8 | 前端 SSE 事件链未使用类型守卫 | `useProjectChatComposer.ts` | 已定义 `isTextEvent` / `isStatusEvent` 等，但代码用 `if/else if` 链 |

---

## 六、与历史文档的对比

### 6.1 已修复项（自 `13-项目对话代码审阅报告.md` 以来）

| 历史问题 | 状态 | 说明 |
|---------|------|------|
| `chat_streaming.py` 1,740 行未拆分 | ✅ **已修复** | 拆为 `services/chat/` 13 个模块 + shim |
| `context_builder.py` 1,122 行未拆分 | ✅ **已修复** | 拆为 `services/context_builder/` 9 个模块 |
| `print()` 调试语句残留 | ✅ **已修复** | 已替换为 `logging` |
| 后端核心流逻辑 0% 覆盖 | ✅ **已改善** | 新增 `test_chat_phases.py`（44 测试）、`test_context_builder_modules.py`（36 测试）、`test_chat_phases_integration.py`（14 测试） |
| @文件提及不注入内容 | ✅ **已修复** | `mention_context.file_ids` 合并到 `file_ids` |
| P3 re-follow-up 截断未追踪 | ✅ **已修复** | 添加 `p3_double_truncated` |
| P3 follow-up 缺少 `original_content` | ✅ **已修复** | 字段补全 |

### 6.2 仍待修复（历史遗留 + 本次新发现）

| 历史问题 | 优先级 | 本次审计是否升级 |
|---------|--------|-----------------|
| RAG 全量 chunk 加载 | P0 | ⚠️ **从 HIGH 升级到 CRITICAL**（确认为必然 OOM） |
| 后台任务内存注册表 | P1 | 维持 HIGH |
| sendMessageAsync 无超时/取消 | P1 | 维持 HIGH（并发安全问题已加入 CR-4） |
| 自动干系人检测无取消机制 | P1 | 维持 MEDIUM |
| 计划模式双 LLM 调用 | P2 | 维持 MEDIUM |
| 工具调用代码重复 | P2 | 维持 MEDIUM |
| 硬编码中文提示 | P3 | 维持 LOW |

### 6.3 本次新发现（历史文档未覆盖）

| 新问题 | 级别 | 关键性说明 |
|--------|------|-----------|
| `CancelledError` 全链未捕获 | **CRITICAL** | 生产环境客户端断开 = 资源泄漏 + 状态不一致 |
| SSE 尾部 buffer 丢弃 | **CRITICAL** | 最终事件（done/error/truncated）可能丢失 |
| P4 失败 = 幽灵消息 | **HIGH** | 用户已看到回复但刷新后消失 |
| `total_stream_ms` 失真 | **HIGH** | 监控指标完全不可用 |
| 输入 token 无限制 | **HIGH** | 大项目 prompt 可能超模型上下文窗口 |
| P3 re-follow-up 截断丢失 | **HIGH** | 二次 follow-up 无截断恢复 |
| 网络错误丢弃已收内容 | **HIGH** | 用户体验严重受损 |
| `iter_with_heartbeat` 不 aclose | **HIGH** | LLM HTTP 连接泄漏 |
| P0 DB session 跨 yield | **HIGH** | 连接池耗尽风险 |
| 部分响应失败不持久化 | **HIGH** | 刷新后已读内容消失 |
| `tool_use` JSON 跨 chunk 分裂 | **MEDIUM** | 工具调用可靠性 |
| `ChatError` dead code | **MEDIUM** | 维护负担 |
| `chatStore.ts` 未使用 | **MEDIUM** | 状态分叉风险 |

---

## 七、修复优先级建议

### 🔴 立即修复（本周内）—— 不做则生产环境暴露

| 优先级 | 修复项 | 责任人 | 预计工时 |
|--------|--------|--------|----------|
| 1 | RAG 加 `pgvector` 或至少加 `LIMIT` + batch 相似度 | 后端 | 1-2 天 |
| 2 | 所有 `except Exception` 扩展为 `except (Exception, asyncio.CancelledError)`，并加 `finally` 清理 | 后端 | 4-6 小时 |
| 3 | 前端 `sendMessage` 加并发 guard + 尾部 buffer flush | 前端 | 2-3 小时 |
| 4 | `total_stream_ms` 在 orchestrator 开头记录并传入 P4 | 后端 | 1 小时 |

### 🟠 短期修复（两周内）—— 不做则用户体验/可观测性受损

| 优先级 | 修复项 | 责任人 | 预计工时 |
|--------|--------|--------|----------|
| 5 | P4 加 `try/except` 包裹 persist，异常时仍 emit `done` | 后端 | 2 小时 |
| 6 | 输入 token 计数 + 截断（`tiktoken` 或 provider tokenizer） | 后端 | 1 天 |
| 7 | `chat_async.py` `_background_chat_tasks` 加 `asyncio.Lock` | 后端 | 2 小时 |
| 8 | P3 re-follow-up 补全截断事件 + 续写循环 | 后端 | 3-4 小时 |
| 9 | 前端网络错误时保留已接收内容 | 前端 | 2 小时 |
| 10 | `iter_with_heartbeat` / 所有 async generator 加 `aclose()` | 后端 | 3-4 小时 |

### 🟡 中期优化（一个月内）—— 架构健壮性

| 优先级 | 修复项 | 责任人 | 预计工时 |
|--------|--------|--------|----------|
| 11 | 跨 chunk 的 `tool_use` JSON 恢复（buffer + 增量解析） | 后端 | 1 天 |
| 12 | P1 续写时不传 `tools` | 后端 | 1 小时 |
| 13 | 前端 SSE 重试 / 断线恢复 | 前端 | 1 天 |
| 14 | `ChatError` 用起来或删掉 | 后端 | 1 小时 |
| 15 | `chatStore.ts` 统一接入 `ProjectChatTab` 或移除 | 前端 | 2-3 小时 |
| 16 | P0 DB session 不跨 yield（buffer 模式） | 后端 | 2 小时 |

---

## 八、一句话总结

> Chat 模块的**模块化拆分已经完成**，但**资源生命周期管理**和**生产容错**是当前的系统性短板。`CancelledError` 漏网、async generator 不清理、RAG 必然 OOM、P4 失败导致幽灵消息——这四个问题如果不在本周内处理，上线后会在真实用户场景中反复触发，严重损害产品可信度。建议立即投入 `pgvector` 改造和 `CancelledError` 全链修复。
