# Human-in-the-Loop Tool Approval System (HITAS)

> 当前实现版本：v1.3，2026-05-23。
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
| 批次级审批 | 同一轮对话产生的一组高风险工具动作共享 `approval_batch_id`，前端只展示一次确认 |
| 确定性执行 | Confirm 只执行数据库里的 `tool_name + tool_input_json`，不重新规划 |
| 默认安全 | 所有 HITAS 端点必须认证；非管理员必须是项目成员 |
| 幂等执行 | 重复点击 Confirm 不重复执行工具；已完成动作返回已有状态 |
| 失败关闭 | 参数非法、工具异常、过期动作都标记为 `failed`，不执行或不继续悬挂 |
| 短事务 | Claim 阶段和结果写回阶段使用短 DB 会话；工具长时间执行期间不占连接 |
| 范围二次校验 | Confirm 前再次校验冻结 `tool_input.project_id` 必须匹配 `PendingToolAction.project_id` |
| 可恢复删除 | 项目文件删除默认进入回收站，不物理删除；文件列表、上下文、mention 默认过滤回收站文件 |
| 角色化授权 | 普通成员必须具备 `owner/editor` 写权限才能 confirm/reject 修改或删除动作 |
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
POST /chat/actions/batches/{batch_id}/confirm
  ↓
后端按批次原子 claim: pending → executing
  ↓
关闭请求 session，按 sequence_index 顺序执行冻结工具参数
  ↓
新 session 写回 completed / failed + 一条 assistant 汇总结果消息
  ↓
前端刷新消息和 pending actions
```

拒绝路径：

```text
用户 Reject
  ↓
POST /chat/actions/batches/{batch_id}/reject
  ↓
批次内 pending → rejected，写 confirmed_by_user_id / confirmed_at / reason + assistant 汇总结果消息
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
    risk_level: str = "medium"
    policy_at_creation: str = ""
    tool_input_hash: str = ""
    approval_batch_id: str = Field(default="", index=True)
    sequence_index: int = 0
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
AriaAI/backend/alembic/versions/013_v1_13_hitas_governance_fields.py
AriaAI/backend/alembic/versions/014_v1_14_hitas_approval_batches.py
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
      "risk_level": "destructive",
      "tool_input_hash": "b4f...",
      "approval_batch_id": "hitas-123-abc",
      "sequence_index": 0,
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

兼容说明：如果 action 带 `approval_batch_id`，该端点会委托到批次 confirm，执行同一批次里的全部 pending actions。新前端优先调用批次端点：

```http
POST /chat/actions/batches/{batch_id}/confirm
Body: {"approved": true}
```

认证：必须登录。
授权：管理员或 action 所属项目成员。
行为：

- `approved=false` 不在 confirm 端点处理，返回 400；拒绝必须走 `/reject`。
- 非 pending action / batch 直接返回已有状态，保证幂等。
- 过期 action 标记为 `failed` 并返回 400。
- `tool_input_json` 必须是 JSON object，否则 fail closed。
- 如果 action 绑定项目，`tool_input_json.project_id` 必须存在并与 action 项目一致，否则 fail closed。
- 普通项目成员必须是 `owner/editor`；`viewer` 无权确认修改或删除动作。
- 使用 `UPDATE ... WHERE status='pending'` 原子 claim，防止双击/并发重复执行。
- claim 后关闭当前 session，工具执行完成后再新开 session 写结果。
- 批次 confirm 按 `sequence_index` 顺序执行，每个工具结果写回各自 action；对话中写入一条 `tool_action_batch_result` 汇总消息。

响应：

```json
{
  "status": "completed",
  "result": {"success": true, "completed_count": 1, "failed_count": 0, "actions": []},
  "error_message": null,
  "message_id": 789,
  "approval_batch_id": "hitas-123-abc",
  "action_ids": [1]
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

新前端优先调用：

```http
POST /chat/actions/batches/{batch_id}/reject
Body: {"approved": false, "reason": "不需要了"}
```

行为：

- 单个 action 或批次内 pending actions → rejected。
- 写 `confirmed_by_user_id`、`confirmed_at` 和可选 reason。
- 写 `result_json` 和 assistant 汇总消息，确保对话里留下“已取消”的可审计痕迹。
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
- `risk_level`、`policy_at_creation`、`tool_input_hash`
- 同一轮 `state.pending_tool_actions` 共享 `approval_batch_id`
- `sequence_index` 记录批次内执行顺序
- 持久化前按 `conversation_id + tool_name + tool_input_hash + status=pending` 去重，避免刷新/重试产生重复确认
- 先创建 action，再持久化 assistant message
- assistant message 创建后，把 `message_id` 回填到 pending action
- message metadata 写入 `pending_action_ids` 和 `pending_action_batch_id`

### 6.5 Direct Action Executor

文件：`AriaAI/backend/app/services/chat/action_executor.py`

执行规则：

- 从工具注册表读取 `ToolDefinition`。
- 执行 `tool_def.handler(**tool_input)`。
- 支持 sync/async handler。
- 标准化返回 `{"success": bool, ...}`。
- 工具返回 `status="error"` 时视为失败。
- 工具返回 `ok=false` 时视为失败，避免工具协议不一致造成误判成功。

### 6.6 Project File Trash

文件：`AriaAI/backend/app/services/project_files.py`

- `archive_project_file(...)` 将文件标记为 `deleted_at`，不删除磁盘文件。
- 常规文件列表、项目上下文、mention、读取工具默认排除 `deleted_at != null` 的文件。
- `GET /projects/{project_id}/files/trash` 可查看回收站。
- `POST /projects/{project_id}/files/{file_id}/restore` 可恢复文件。
- 项目整体删除仍会物理清理项目相关记录和文件，这是项目级危险操作边界，不属于 HITAS 普通文件清理。

---

## 7. 前端落点

### 7.1 数据流

文件：`aria-web/src/pages/projects/useProjectChatConversations.ts`

- `fetchPendingToolActions(conversationId)` 调用 `/pending-actions`。
- 切换对话、拉取消息、确认/拒绝后都会刷新 pending actions。
- `confirmToolActionBatch(batchId)` 调用 `/chat/actions/batches/{batch_id}/confirm`。
- `rejectToolActionBatch(batchId)` 调用 `/chat/actions/batches/{batch_id}/reject`。
- confirm/reject 失败会向上抛错，由页面层 toast。

### 7.2 UI

文件：`aria-web/src/pages/projects/ProjectChatMainPanel.tsx`

- HITAS 面板优先于 legacy token panel。
- 使用固定定位全局 modal，避免被聊天输入框或滚动容器遮住。
- UI 按 `approval_batch_id` 聚合，同一流程只展示一个 Action Preview。
- 老数据没有 `approval_batch_id` 时，前端按 `tool_name + action_type + tool_input_hash` 兼容聚合。
- 每个批次有独立 loading/disabled 状态，防重复点击。

文件：`aria-web/src/pages/projects/ProjectChatTab.tsx`

- Confirm 成功后刷新消息列表。
- Confirm/Reject 成功或失败都会用 toast 告知用户。
- UI 展示业务化动作名（如“删除需确认”），内部工具名仅保留在 trace/debug 语境。

### 7.3 Legacy Fallback

旧 `ProjectChatActionPreviewPanel` 仍用于：

- 老消息里的 `pending_tool_confirmations`
- 尚未转成 HITAS 的历史数据
- 需要“重新生成 preview”的 legacy 场景

当 `pendingToolActions.length > 0` 时，HITAS modal 优先展示，legacy panel 不展示。

HITAS 结果消息包含 `tool_action_batch_result`。legacy fallback 在看到 `tool_action_result` 或 `tool_action_batch_result` 后，不再重新合成旧 token 确认，避免“执行后又弹确认”的回环。

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
- 超时 `executing` 会由 reaper 转为 `failed`，错误信息标记为“执行状态未知，需人工核查”，不会自动重试 destructive action。

---

## 9. 安全与权限

HITAS 端点必须满足：

1. `current_user = Depends(get_current_user)`。
2. 管理员可访问全部 action。
3. 普通用户必须是 action 所属项目的 `ProjectMember`。
4. action 没有 `project_id` 时，从 `conversation.project_id` 回推。
5. 无法确定项目归属时拒绝访问。
6. Confirm 前校验 `tool_input.project_id == action.project_id`。
7. 普通成员需要 `owner/editor` 角色才能确认或拒绝修改/删除动作。

这是必要约束，因为 confirm 端点会直接执行删除、覆盖等真实工具操作。

---

## 10. 测试覆盖

后端测试文件：

```text
AriaAI/backend/tests/test_chat_actions.py
```

覆盖：

- HITAS 路由没有 `/chat/chat` 双前缀。
- action-id confirm 对带 `approval_batch_id` 的记录会委托到批次 confirm。
- 批次 confirm 会按顺序执行批次内全部 frozen actions，且只写一条汇总消息。
- 前端按批次聚合 pending actions；legacy 重复 pending action 按 hash 聚合。
- confirm 幂等，只执行一次。
- 非项目成员无法 confirm。
- `viewer` 成员无法 confirm destructive action。
- 冻结工具参数项目范围不一致时 fail closed。
- reject 不执行工具。
- reject 写入 assistant 消息。
- list 只返回 pending 且未过期 action。
- 过期 action 不能 confirm。
- 并发 confirm 不重复执行。
- 工具抛异常后 action 持久化为 failed。
- 非 object 的 `tool_input_json` fail closed。
- stale `executing` reaper 只标记 failed/unknown，不自动重试。
- API 级 cleanup HITAS 链路：`GET pending-actions → POST confirm → manage_project_files delete → 消息回显`。
- `ok=false` 工具返回被标准化为失败。
- 项目文件删除进入回收站，隐藏于正常文件列表且可恢复。

建议发布前最小验证：

```bash
cd AriaAI/backend
./.venv/bin/python -m pytest tests/test_chat_actions.py tests/test_chat_phases_integration.py tests/test_chat_pending_action.py tests/test_chat_golden_set.py tests/test_tool_executor.py -q

cd ../../aria-web
npm run test:project-chat
npm run build
```

---

## 11. 崩溃恢复与后台 reaper

文件：

```text
AriaAI/backend/app/services/chat/action_reaper.py
```

生产环境通过 APScheduler 每 5 分钟执行一次：

```text
hitas_stale_executing_reaper
```

行为：

- 扫描 `status = executing` 且 `confirmed_at` 超过 30 分钟的 action。
- 标记为 `failed`。
- 写入 `result_json.requires_manual_verification = true`。
- 写 assistant 消息提示“执行状态未知：请人工核查后再继续”。
- **不自动重试**。尤其对删除/覆盖类 destructive action，自动重试可能造成二次破坏。

---

## 12. CI 要求

前端测试脚本必须显式指定 Vitest 配置，避免 CI 默认 glob 或工作目录差异：

```json
{
  "test": "vitest run --config vitest.config.ts",
  "test:watch": "vitest --config vitest.config.ts",
  "test:coverage": "vitest run --config vitest.config.ts --coverage"
}
```

GitHub Actions deploy workflow 在 build 后运行：

```bash
cd aria-web
npm run test:project-chat
```

---

## 13. 已知边界

- HITAS 是普通聊天工具确认系统；durable task 的 step-level 确认仍由 task orchestrator 自己管理。
- `PendingToolAction` 当前没有重试端点。失败后需要用户重新发起请求。
- 工具执行仍在 HTTP confirm 请求中完成；对特别长的工具，后续可升级为后台 job，但 claim/幂等/授权/reaper 模型可复用。
- Legacy token 流仍保留是为了历史消息兼容，不应作为新确认链路的主路径。
- 当前已有 `owner/editor/viewer` 写权限边界；更细粒度的 `delete_file`/`restore_file` capability 可以在后续权限系统中继续拆分。
