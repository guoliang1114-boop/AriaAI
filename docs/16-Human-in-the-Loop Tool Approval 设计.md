# Human-in-the-Loop Tool Approval System (HITAS)

> 工业级方案：解决"用户确认后执行操作"的确定性问题

---

## 问题定义

当前架构的确认机制依赖 LLM 的**确定性重放**：
1. P2 拦截工具 → 生成 token → 前端弹窗
2. 用户 Confirm → 前端重新发送原始消息 + token
3. 后端重新走 P0→P4 → **赌 LLM 会生成相同的 tool_use**

这个假设在复杂场景（如"清理文档"需要 list → 分析 → delete）下不成立。

---

## 核心设计原则

| 原则 | 说明 |
|---|---|
| **服务端持久化** | 待确认操作存入数据库，不依赖内存或 SSE 事件 |
| **确定性执行** | 用户确认后，后端直接执行已存储的操作，不经过 LLM |
| **状态机驱动** | pending → confirmed → executing → completed/failed |
| **前后端同步** | 独立 API 获取 pending actions，不依赖 message metadata |
| **向后兼容** | 保留现有 token 机制，新系统作为增强层 |

---

## 架构图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   用户消息   │ ──→ │ P1 Planning │ ──→ │   P2 Tools      │
└─────────────┘     └─────────────┘     └─────────────────┘
                                                │
                                    ┌───────────┴───────────┐
                                    │ 需要确认？              │
                                    └───────────┬───────────┘
                                                ▼
                                    ┌───────────────────────┐
                                    │ 创建 PendingToolAction │
                                    │ 状态 = pending         │
                                    │ 发送 SSE done          │
                                    └───────────────────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │   前端弹窗显示         │
                                    │   GET /pending-actions │
                                    └───────────┬───────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │ 用户点击 Approve       │
                                    │ POST /actions/{id}/    │
                                    │      confirm           │
                                    └───────────┬───────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │ 后端直接执行工具        │
                                    │ 不经过 LLM             │
                                    │ 状态 = completed       │
                                    └───────────┬───────────┘
                                                │
                                    ┌───────────▼───────────┐
                                    │ 前端刷新消息列表       │
                                    │ 显示执行结果           │
                                    └───────────────────────┘
```

---

## 数据库模型

```python
class PendingToolAction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trace_id: str = Field(index=True)
    conversation_id: int = Field(foreign_key="conversation.id", index=True)
    message_id: Optional[int] = Field(default=None, foreign_key="message.id")
    project_id: Optional[int] = Field(default=None, foreign_key="project.id")

    tool_name: str
    tool_input_json: str = "{}"

    action_type: str          # delete_files, modify_document, etc.
    title: str                # 弹窗标题
    description: str          # 弹窗描述
    details_json: str = "[]"  # 详细列表

    status: str = "pending"   # pending | confirmed | rejected | executing | completed | failed
    confirmed_by_user_id: Optional[int] = None
    confirmed_at: Optional[datetime] = None
    result_json: Optional[str] = None
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=utc_now_naive)
    expires_at: Optional[datetime] = None
```

---

## API 设计

### 获取对话的待确认操作
```
GET /chat/conversations/{conversation_id}/pending-actions
Response: { items: PendingToolAction[], has_pending: bool }
```

### 确认执行
```
POST /chat/actions/{action_id}/confirm
Body: { reason?: string }
Response: { status: "executing" | "completed" | "failed", result?: dict }
```

### 拒绝执行
```
POST /chat/actions/{action_id}/reject
Body: { reason?: string }
Response: { status: "rejected" }
```

---

## 后端改动点

### P2 Tools 阶段
拦截时不再只发 token，而是：
1. 创建 `PendingToolAction` 记录
2. 将 `pending_action_id` 写入 `state.pending_tool_actions`
3. 发送 SSE 事件携带 `pending_action_id`

### P4 Persist 阶段
1. 将 `pending_tool_action_ids` 写入 message metadata
2. 生成自然的"等待确认"回复文本

### Action Executor
新建 `app/services/chat/action_executor.py`：
```python
async def execute_pending_action(session, action: PendingToolAction) -> dict:
    tool_input = json.loads(action.tool_input_json)
    tool_func = registry.get(action.tool_name)
    return await tool_func(**tool_input)
```

---

## 前端改动点

### 状态管理
- 新增 `pendingActions` 状态（从 API 获取）
- 确认后调用 `POST /actions/{id}/confirm`，不再重新发送消息

### 弹窗组件
- `ProjectChatActionPreviewPanel` 从 API 获取数据
- 显示标题、描述、详情列表
- Approve/Reject 按钮调用独立 API

### 结果展示
- 执行完成后，前端自动刷新消息列表
- 新增系统消息显示执行结果

---

## 状态机

```
                    ┌─────────────┐
         ┌─────────│   pending   │◄──────────────┐
         │         └──────┬──────┘               │
         │                │ create                │
    reject│           confirm│                   │ retry
         │                ▼                      │
         │         ┌─────────────┐              │
         └────────►│  confirmed  │──────────────┘
                   └──────┬──────┘
                          │ execute
                          ▼
                   ┌─────────────┐
                   │  executing  │
                   └──────┬──────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       ┌─────────────┐         ┌─────────────┐
       │  completed  │         │   failed    │
       └─────────────┘         └─────────────┘
```

---

## 与现有系统的兼容性

- 保留 `action_confirmations` 字段作为降级方案
- 保留 `tool_confirmation_token` 用于旧端点
- 新系统通过 `pending_action_id` 字段识别
- 旧消息中的 `pending_tool_confirmations` 仍然可用
