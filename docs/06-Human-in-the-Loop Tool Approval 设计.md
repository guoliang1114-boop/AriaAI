# Human-in-the-Loop Tool Approval 设计

> 更新日期：2026-05-24  
> 简称：HITAS  
> 关联文档：[05-对话系统设计与规范](./05-对话系统设计与规范.md)

## 1. 目标

HITAS 的目标是把高风险工具调用从“LLM 重放确认”升级为“服务端持久化、用户确认、确定性执行”。

旧机制的问题：

```text
模型提出删除/修改
  ↓
前端展示确认
  ↓
用户点击确认
  ↓
后端重新跑一遍聊天
  ↓
期望模型再次生成同样的 tool_use
```

这个假设不可靠。模型可能改写参数、漏掉工具调用、只输出解释文本，或者在 follow-up 中产生不同动作。

HITAS 的核心改变：

> 确认前冻结工具名和工具参数；确认后直接执行数据库中冻结的工具调用，不再经过 LLM。

## 2. 适用范围

需要 HITAS 的操作：

- 修改现有 Markdown、Office 或项目文件。
- 删除项目文件或文件夹。
- 批量清理项目空间。
- 其他被 `ActionPolicy` 标记为 `MODIFY_EXISTING_FILE` 或 `DESTRUCTIVE_ACTION` 的工具动作。

通常不需要 HITAS 的操作：

- 只读文件。
- 读取项目上下文。
- 新建交付物。
- 生成新的 DOCX/PPTX/XLSX/PDF。

最终是否需要确认由 policy、工具类型和 `_tool_requires_confirmation` 一起决定。

## 3. 设计原则

| 原则 | 说明 |
|---|---|
| 服务端持久化 | 待确认动作写入 `PendingToolAction`，刷新页面也能恢复 |
| 参数冻结 | 保存 `tool_name` 和 `tool_input_json` |
| 确定性执行 | Confirm 直接执行冻结工具，不重新问模型 |
| 批次审批 | 同一轮多个动作共享 `approval_batch_id` |
| 幂等 | 重复 confirm/reject 不重复执行 |
| 原子 claim | `UPDATE ... WHERE status='pending'` 防止并发双执行 |
| 短事务 | 工具执行不长期占用 DB session |
| 范围校验 | Confirm 前再次校验 project scope |
| 角色校验 | viewer 不能确认修改/删除 |
| 失败关闭 | 参数非法、过期、工具异常都标记 failed |
| 可观测 | 指标、告警、Trace 和结果消息都可查 |

## 4. 总体流程

```text
用户消息
  ↓
IntentRouter 得到 ActionPolicy
  ↓
P1 模型生成 tool_use
  ↓
P2 检查工具权限
  ↓
发现需确认的修改/删除动作
  ↓
构造 pending action payload
  ↓
P4 写入 PendingToolAction(status=pending)
  ↓
前端拉取 /chat/conversations/{id}/pending-actions
  ↓
展示 Action Preview
  ↓
用户 Confirm 或 Reject
  ↓
Confirm: claim pending → executing
  ↓
执行冻结工具参数
  ↓
写 completed / failed + assistant 结果消息
```

拒绝流程：

```text
用户 Reject
  ↓
pending → rejected
  ↓
写 confirmed_by_user_id / confirmed_at / reason
  ↓
写 assistant 汇总消息
```

## 5. 数据模型

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

    status: str = "pending"
    confirmed_by_user_id: Optional[int] = None
    confirmed_at: Optional[datetime] = None
    result_json: Optional[str] = None
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=utc_now_naive)
    expires_at: Optional[datetime] = None
```

当前状态枚举：

- `pending`
- `confirmed`，历史兼容状态
- `rejected`
- `executing`
- `completed`
- `failed`
- `skipped`
- `superseded`

## 6. 迁移

相关迁移：

```text
012_v1_12_pending_tool_actions
013_v1_13_hitas_governance_fields
014_v1_14_hitas_approval_batches
015_v1_15_chat_owner_scope
016_v1_16_hitas_schema_guard
```

说明：

- `012` 增加 `PendingToolAction`。
- `013` 增加治理字段，如 hash、risk、policy。
- `014` 增加批次审批字段。
- `015` 增加 conversation owner scope。
- `016` 是 schema guard，幂等补齐 HITAS 和 owner scope 的关键字段。

部署要求：

```bash
cd AriaAI/backend
alembic upgrade head
```

## 7. API 合约

所有路径挂载在 `/chat` 下。

### 7.1 获取待确认动作

```http
GET /chat/conversations/{conversation_id}/pending-actions
```

行为：

- 只返回 `status = pending`。
- 读取时顺手把过期 pending 标记为 `failed`。
- legacy 无 batch 的重复 action 会被标记为 `superseded`。

响应：

```json
{
  "items": [
    {
      "id": 1,
      "trace_id": "trace-id",
      "conversation_id": 12,
      "message_id": 34,
      "project_id": 56,
      "tool_name": "manage_project_files",
      "tool_input": {"project_id": 56, "action": "delete", "file_ids": [1, 2]},
      "action_type": "delete_files",
      "risk_level": "destructive",
      "policy_at_creation": "destructive_action",
      "tool_input_hash": "hash",
      "approval_batch_id": "hitas-batch-id",
      "sequence_index": 0,
      "title": "确认删除项目文件",
      "description": "即将删除 2 个项目空间中的文件。",
      "details": ["待删除文件 ID：1, 2"],
      "status": "pending",
      "created_at": "2026-05-24T00:00:00",
      "expires_at": "2026-05-25T00:00:00"
    }
  ],
  "has_pending": true
}
```

### 7.2 确认单个动作

```http
POST /chat/actions/{action_id}/confirm
Body: {"approved": true}
```

如果 action 带 `approval_batch_id`，该端点会委托到批次 confirm。

### 7.3 确认批次

```http
POST /chat/actions/batches/{batch_id}/confirm
Body: {"approved": true}
```

行为：

- 校验用户权限。
- 校验 action 未过期。
- 校验 `tool_input_json` 是 JSON object。
- 校验 `tool_input.project_id` 与 action project scope 一致。
- 原子 claim：`pending → executing`。
- 按 `sequence_index` 顺序执行。
- 写入 `tool_action_result` 或 `tool_action_batch_result` 消息。
- 长耗时工具进入后台 job。

响应：

```json
{
  "status": "completed",
  "result": {"success": true, "completed_count": 1, "failed_count": 0},
  "error_message": null,
  "message_id": 789,
  "approval_batch_id": "hitas-batch-id",
  "action_ids": [1]
}
```

### 7.4 拒绝动作或批次

```http
POST /chat/actions/{action_id}/reject
Body: {"approved": false, "reason": "不需要了"}

POST /chat/actions/batches/{batch_id}/reject
Body: {"approved": false, "reason": "不需要了"}
```

行为：

- pending actions 标记为 `rejected`。
- 写入确认人、确认时间和原因。
- 写 assistant 汇总消息。

### 7.5 查询指标

```http
GET /chat/actions/metrics
```

仅管理员可访问。返回：

- 总 action 数。
- resolved / failed 数。
- confirmation failure rate。
- stale executing 数。
- partial failed batches。
- 按状态和风险等级统计。
- 告警候选。

## 8. 后端实现落点

### 8.1 P2 Tools

文件：`services/chat/phases/p2_tools.py`

职责：

- 检查工具是否被 policy 允许。
- 判断是否需要确认。
- 构造 pending action payload。
- 同时写 legacy `pending_tool_confirmations` 作为旧消息兼容 fallback。

### 8.2 P3 Follow-up

文件：`services/chat/phases/p3_followup.py`

职责：

- 对 follow-up 中再次出现的修改/删除工具复用 HITAS payload 构造逻辑。
- 避免只有 P2 才能进入 HITAS 的漏洞。

### 8.3 P4 Persist

文件：`services/chat/phases/p4_persist.py`

职责：

- 给同轮 action 分配 `approval_batch_id`。
- 设置 `sequence_index`。
- 计算或保存 `tool_input_hash`。
- 去重已有 pending action。
- 写入 `PendingToolAction`。

### 8.4 Action Executor

文件：`services/chat/action_executor.py`

职责：

- 根据 `tool_name` 从 registry 找到工具。
- 使用冻结的 `tool_input_json` 执行。
- 不调用 LLM。

### 8.5 Background Jobs

文件：

- `services/chat/action_background.py`
- `services/chat/action_reaper.py`

职责：

- Office、PDF、生成类长耗时工具可进入后台执行。
- stale executing action 由 reaper 标记失败，避免永久悬挂。
- main.py 启动时注册 `hitas_stale_executing_reaper` interval job。

## 9. 前端契约

核心文件：

- `aria-web/src/pages/projects/ProjectChatMainPanel.tsx`
- `aria-web/src/pages/projects/ProjectChatActionPreviewPanel.tsx`
- `aria-web/src/pages/projects/projectChatPendingActions.ts`

前端要求：

- pending actions 必须以模态层展示，不能被聊天输入遮挡。
- 批次 action 优先调用 batch confirm/reject。
- confirm 后刷新消息和 pending actions。
- executing 状态要显示“执行中”而不是误报完成。
- failed 状态要展示错误信息。
- destructive action 文案要清楚说明影响范围。

## 10. 安全规则

### 10.1 鉴权

所有 HITAS API 都要求登录。公共路径不包括 HITAS。

### 10.2 授权

用户必须满足之一：

- 管理员。
- 对话所属项目成员。
- 对修改/删除动作，普通项目成员必须是 `owner` 或 `editor`。

`viewer` 不能确认 destructive 或 modify 动作。

### 10.3 范围校验

如果 action 绑定 `project_id`：

- `tool_input.project_id` 必须存在。
- `tool_input.project_id` 必须等于 action 的 `project_id`。

校验失败时标记 action 为 `failed`，不执行。

### 10.4 删除策略

项目文件删除默认采用软删除：

- 写入 `deleted_at`。
- 写入 `deleted_by_user_id`。
- 写入 `delete_reason` / `delete_batch_id`。

文件列表、上下文和 mention 默认过滤已删除文件。

## 11. 运营与排障

常用检查：

```bash
cd AriaAI/backend
alembic current
alembic upgrade head
pytest tests/test_chat_pending_action.py tests/test_chat_actions.py
```

排障重点：

- pending action 是否写入。
- `approval_batch_id` 是否为空。
- `tool_input_hash` 是否重复。
- action 是否已过期。
- 用户是否有项目写权限。
- 工具是否已导入并注册到 registry。
- 后台任务是否执行或被 reaper 标记失败。

## 12. 后续演进

1. 风险分层：低风险新建可自动执行，中高风险继续确认。
2. 用户信任级别：`ask-always`、`auto-approve-low`、`never-auto`。
3. Action Preview 增加 diff 视图。
4. destructive action 增加二次确认或延迟撤销窗口。
5. 将 HITAS 指标纳入设置页或管理员面板。
