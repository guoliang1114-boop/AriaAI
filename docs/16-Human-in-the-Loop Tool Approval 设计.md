# Human-in-the-Loop Tool Approval System (HITAS)

> 当前实现版本：v1.1，2026-05-23。
> 目标：把项目对话里的高风险工具调用，从“LLM 重放确认”升级为“服务端持久化 + 用户确认 + 确定性执行”。

---

## 1. 问题定义

旧确认机制依赖一次不可靠的假设：

1. P2/P3 拦截高风险工具，前端显示确认。
2. 用户点击确认后，前端重新发送原始消息和 token。
3. 后端重新跑 P0→P4，期待 LLM 再次生成完全相同的 `tool_use`。

这个方案在“清理项目空间”“先分析再删除”“后续 follow-up 又触发修改工具”等场景里不稳定。LLM 可能改写工具参数、漏掉工具调用、只输出解释文本，导致确认后又回到“我没有删除权限”的体验。

HITAS 的核心改变是：**确认前冻结工具名和工具参数；确认后直接执行已冻结的工具调用，不再经过 LLM。**

---

## 2. 设计原则

| 原则 | 说明 |
|---|---|
| 服务端持久化 | 待确认动作写入 `PendingToolAction`，刷新页面、新窗口、SSE 中断后仍可恢复 |
| 确定性执行 | Confirm 只执行数据库里的 `tool_name + tool_input_json`，不重新规划 |
| 默认安全 | 所有 HITAS 端点必须认证；非管理员必须是项目成员 |
| 幂等执行 | 重复点击 Confirm 不重复执行工具；已完成动作返回已有状态 |
| 失败关闭 | 参数非法、工具异常、过期动作都标记为 `failed`，不执行或不继续悬挂 |
| 短事务 | Claim 阶段和结果写回阶段使用短 DB 会话；工具长时间执行期间不占连接 |
| 向后兼容 | 旧 `pending_tool_confirmations` 仍保留为 legacy fallback，但 HITAS 优先展示 |

---

## 3. 总体流程

```text
用户消息
  ↓
IntentRouter / Policy Guard
  ↓
P2 工具执行 或 P3 follow-up 工具执行
  ↓
发现 MODIFY_EXISTING_FILE / DESTRUCTIVE_ACTION 且未确认
  ↓
构造 pending action payload
  ↓
P4 持久化 PendingToolAction(status=pending)
  ↓
前端 GET /chat/conversations/{id}/pending-actions
  ↓
显示 Action Preview 模态层
  ↓
用户 Confirm
  ↓
POST /chat/actions/{id}/confirm
  ↓
后端原子 claim: pending → executing
  ↓
关闭请求 session，执行冻结工具参数
  ↓
新 session 写回 completed / failed + assistant 结果消息
  ↓
前端刷新消息和 pending actions
```

拒绝路径：

```text
用户 Reject
  ↓
POST /chat/actions/{id}/reject
  ↓
pending → rejected，写 confirmed_by_user_id / confirmed_at / reason
```

---

## 4. 数据模型

模型位置：`AriaAI/backend/app/models/db.py`

```python
class PendingToolAction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trace_id: str = Field(default="", index=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    message_id: Optional[int] = Field(default=None, foreign_key="message.id", index=True)
    project_id: Optional[int] = Field(default=None, foreign_key="project.id", index=True)

    tool_name: str = ""
    tool_input_json: str = "{}"

    action_type: str = ""
    title: str = ""
    description: str = ""
    details_json: str = "[]"

    status: str = "pending"  # pending | rejected | executing | completed | failed
    confirmed_by_user_id: Optional[int] = None
    confirmed_at: Optional[datetime] = None
    result_json: Optional[str] = None
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=utc_now_naive)
    expires_at: Optional[datetime] = None
```

迁移文件：

```text
AriaAI/backend/alembic/versions/012_v1_12_pending_tool_actions.py
```

部署要求：

```bash
cd AriaAI/backend
alembic upgrade head
```

---

## 5. API 合约

路由挂载在 `app.routers.chat` 下，最终路径没有重复 `/chat/chat`。

### 5.1 获取对话待确认动作

```http
GET /chat/conversations/{conversation_id}/pending-actions
```

认证：必须登录。
授权：管理员或对话所属项目成员。
行为：

- 只返回 `status = pending` 且未过期动作。
- 发现过期 pending 时顺手标记为 `failed`。

响应：

```json
{
  "items": [
    {
      "id": 1,
      "trace_id": "conv-123",
      "conversation_id": 123,
      "message_id": 456,
      "project_id": 27,
      "tool_name": "manage_project_files",
      "tool_input": {"action": "delete", "file_ids": [130, 131]},
      "action_type": "delete_files",
      "title": "确认删除项目文件",
      "description": "即将删除 2 个项目空间中的文件。此操作不可撤销。",
      "details": ["待删除文件 ID：130, 131"],
      "status": "pending",
      "created_at": "2026-05-23T00:00:00",
      "expires_at": "2026-05-24T00:00:00"
    }
  ],
  "has_pending": true
}
```

### 5.2 确认执行

```http
POST /chat/actions/{action_id}/confirm
Body: {"approved": true}
```

认证：必须登录。
授权：管理员或 action 所属项目成员。
行为：

- `approved=false` 不在 confirm 端点处理，返回 400；拒绝必须走 `/reject`。
- 非 pending action 直接返回已有状态，保证幂等。
- 过期 action 标记为 `failed` 并返回 400。
- `tool_input_json` 必须是 JSON object，否则 fail closed。
- 使用 `UPDATE ... WHERE status='pending'` 原子 claim，防止双击/并发重复执行。
- claim 后关闭当前 session，工具执行完成后再新开 session 写结果。

响应：

```json
{
  "status": "completed",
  "result": {"success": true, "output": {"message": "删除完成"}},
  "error_message": null,
  "message_id": 789
}
```

失败响应也会持久化：

```json
{
  "status": "failed",
  "result": {"success": false, "error": "disk full"},
  "error_message": "disk full"
}
```

### 5.3 拒绝执行

```http
POST /chat/actions/{action_id}/reject
Body: {"approved": false, "reason": "不需要了"}
```

行为：

- pending → rejected。
- 写 `confirmed_by_user_id`、`confirmed_at` 和可选 reason。
- 非 pending action 返回已有状态，保证幂等。

### 5.4 获取单个动作

```http
GET /chat/actions/{action_id}
```

认证和授权同上。若 pending 已过期，读取时会标记为 `failed`。

---

## 6. 后端落点

### 6.1 P2 Tools

文件：`AriaAI/backend/app/services/chat/phases/p2_tools.py`

当工具需要确认时：

1. 生成 `confirmation_token`。
2. 构造用户可读的 `details`。
3. 调 `_build_pending_action_payload(...)` 生成 HITAS payload。
4. 写入 `state.pending_tool_actions`，供 P4 持久化。
5. 同时写入 legacy `state.pending_tool_confirmations`，作为旧消息兼容 fallback。

`_build_pending_action_payload` 有专门模板：

- `manage_project_files` + `delete` → `delete_files`
- `manage_project_folders` + `delete` → `delete_folder`
- `project_markdown` → `modify_document`
- `write_project_office_document` → `write_document`
- 未列出的确认型工具 → generic fallback `tool_action_requires_confirmation`

### 6.2 P3 Follow-up

文件：`AriaAI/backend/app/services/chat/phases/p3_followup.py`

P3 中如果模型再次发起修改/删除工具，也会复用 P2 的 `_build_pending_action_payload`，确保后续工具确认也进入 HITAS，而不是只进入旧 token 流。

### 6.3 Deterministic Cleanup Fallback

文件：`AriaAI/backend/app/services/chat/phases/p4_persist.py`

如果用户明确要求“清理/删除项目空间垃圾文件”，但模型没有发出删除工具调用，P4 会调用 `_ensure_project_cleanup_confirmation(...)`：

1. 用保守规则生成 `manage_project_files delete` 候选。
2. 写入 legacy `pending_tool_confirmations`。
3. 同时写入 `state.pending_tool_actions`，确保刷新/新窗口后仍能显示 HITAS Action Preview。
4. Trace 记录 `deterministic_cleanup_confirmation_created`。

### 6.4 P4 持久化

文件：`AriaAI/backend/app/services/chat/phases/p4_persist.py`

P4 将 `state.pending_tool_actions` 写入 `PendingToolAction` 表：

- `status = pending`
- `expires_at = utc_now_naive() + 24h`
- 先创建 action，再持久化 assistant message
- assistant message 创建后，把 `message_id` 回填到 pending action
- message metadata 写入 `pending_action_ids`

### 6.5 Direct Action Executor

文件：`AriaAI/backend/app/services/chat/action_executor.py`

执行规则：

- 从工具注册表读取 `ToolDefinition`。
- 执行 `tool_def.handler(**tool_input)`。
- 支持 sync/async handler。
- 标准化返回 `{"success": bool, ...}`。
- 工具返回 `status="error"` 时视为失败。

---

## 7. 前端落点

### 7.1 数据流

文件：`aria-web/src/pages/projects/useProjectChatConversations.ts`

- `fetchPendingToolActions(conversationId)` 调用 `/pending-actions`。
- 切换对话、拉取消息、确认/拒绝后都会刷新 pending actions。
- confirm/reject 失败会向上抛错，由页面层 toast。

### 7.2 UI

文件：`aria-web/src/pages/projects/ProjectChatMainPanel.tsx`

- HITAS 面板优先于 legacy token panel。
- 使用固定定位全局 modal，避免被聊天输入框或滚动容器遮住。
- 每个 action 有独立 loading/disabled 状态，防重复点击。

文件：`aria-web/src/pages/projects/ProjectChatTab.tsx`

- Confirm 成功后刷新消息列表。
- Confirm/Reject 失败时用 toast 告知用户。

### 7.3 Legacy Fallback

旧 `ProjectChatActionPreviewPanel` 仍用于：

- 老消息里的 `pending_tool_confirmations`
- 尚未转成 HITAS 的历史数据
- 需要“重新生成 preview”的 legacy 场景

当 `pendingToolActions.length > 0` 时，HITAS modal 优先展示，legacy panel 不展示。

---

## 8. 状态机

```text
            create
              ↓
          ┌─────────┐
          │ pending │
          └────┬────┘
       reject  │ confirm(claim)
          ↓    ↓
   ┌─────────┐ ┌───────────┐
   │rejected │ │ executing │
   └─────────┘ └─────┬─────┘
                     │
              ┌──────┴──────┐
              ↓             ↓
        ┌───────────┐ ┌────────┐
        │ completed │ │ failed │
        └───────────┘ └────────┘
```

说明：

- 当前实现不使用持久化 `confirmed` 中间态；确认后直接 claim 为 `executing`。
- 已终态 action 再次 confirm/reject，返回已有状态，不重复执行。
- 过期 pending 会转为 `failed`。

---

## 9. 安全与权限

HITAS 端点必须满足：

1. `current_user = Depends(get_current_user)`。
2. 管理员可访问全部 action。
3. 普通用户必须是 action 所属项目的 `ProjectMember`。
4. action 没有 `project_id` 时，从 `conversation.project_id` 回推。
5. 无法确定项目归属时拒绝访问。

这是必要约束，因为 confirm 端点会直接执行删除、覆盖等真实工具操作。

---

## 10. 测试覆盖

后端测试文件：

```text
AriaAI/backend/tests/test_chat_actions.py
```

覆盖：

- HITAS 路由没有 `/chat/chat` 双前缀。
- confirm 幂等，只执行一次。
- 非项目成员无法 confirm。
- reject 不执行工具。
- list 只返回 pending 且未过期 action。
- 过期 action 不能 confirm。
- 并发 confirm 不重复执行。
- 工具抛异常后 action 持久化为 failed。
- 非 object 的 `tool_input_json` fail closed。

建议发布前最小验证：

```bash
cd AriaAI/backend
./.venv/bin/python -m pytest tests/test_chat_actions.py tests/test_chat_phases_integration.py tests/test_chat_pending_action.py tests/test_chat_golden_set.py tests/test_tool_executor.py -q

cd ../../aria-web
npm test -- ProjectChatActionPreviewPanel.test.tsx ProjectChatMainPanel.test.tsx useProjectChatConversations.test.ts ProjectChatToolCallCard.test.tsx --run
npm run build
```

---

## 11. 已知边界

- HITAS 是普通聊天工具确认系统；durable task 的 step-level 确认仍由 task orchestrator 自己管理。
- `PendingToolAction` 当前没有重试端点。失败后需要用户重新发起请求。
- 工具执行仍在 HTTP confirm 请求中完成；对特别长的工具，后续可升级为后台 job，但 claim/幂等/授权模型可复用。
- Legacy token 流仍保留是为了历史消息兼容，不应作为新确认链路的主路径。
