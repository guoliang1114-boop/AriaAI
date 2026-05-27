# 代码 Review 遗留事项

> 记录日期：2026-05-27
> 来源：一次全栈整体 review（后端 chat 子系统、前端 chat 子系统、后端安全/越权）。
> 本文件仅记录**已知但暂不修复**的事项；已修复项见 git 历史，不在此列。

---

## 已修复（仅备查，详见 commit）

- **provider API 密钥明文泄露（P0）**：`GET /settings/` 曾把 `Setting` 表里明文存储的所有 LLM 密钥返回给任何登录用户；`PUT /settings/{key}` 可改写密钥。已改为：读端点过滤密钥（直读返回 404）、通配 PUT 拒写密钥，密钥只走专用掩码端点。
- **agent loop 截断只在 step 0 自动续写**：已扩展到任意"产出最终答案且无待执行工具"的 step。
- **markdown 表格分隔行列数不匹配导致整表不渲染**：渲染前规范化分隔行到表头列数（`normalizeMarkdownTables`），并跳过代码块/缩进代码块。
- **项目对话非真流式 + 回复闪现**：`agent_loop._consume_stream` 由"攒完一轮批量返回"改为 async generator 边解析边 `yield`。
- **任务进度 4 步罐头模板**：改为按真实工具调用渲染步骤。
- **用户菜单退出登录字号 16px**：`button` reset 由无层移入 `@layer base`，恢复 Tailwind 工具类优先级。

---

## 遗留事项（暂不修复）

### 1. 访问模型：团队共享（设计如此，非 bug）

- **现象**：项目、客户的 CRUD 路由（`projects.py`、`projects_files.py`、`clients.py`、`projects_briefing.py`）不做按用户/成员的归属校验，任何登录用户可读写全部项目/客户/文件。
- **结论**：经确认这是**预期设计**——内部团队工具，所有登录用户共享全部数据。全局登录中间件（`main.py` `auth_middleware`）已挡未登录者。
- **若将来要做多租户/按成员隔离**，需要：
  - 建项目时把创建者写为 `owner` 成员（当前 `projects.py:create_project` 未接 `current_user`，也不写 `ProjectMember`）。
  - 给上述路由统一加 `chat_security.require_project_access`（chat 路由已用此模式）。
  - 为客户设计归属模型（当前无 `ClientMember`）。

### 2. 全局配置可被任意成员改写（含 `api_base_url`）

- **现象**：settings 为全局表，通配 `PUT /settings/{key}` 已禁止写密钥，但仍允许任意登录用户改写非密钥的全局配置（`selected_model`、`temperature`、`api_base_url` 等）。其中 `api_base_url` 被 `services/claude.py` 用作 LLM 端点，恶意成员改写可把携带密钥的请求重定向到第三方（MITM/密钥外泄）。
- **暂不修复原因**：受信任团队模型下风险较低；正解是对敏感全局配置加 `require_admin`，但 `ServerSettings`/`AISettings` 页面也在写这些 key，需先确认前端是否已 admin-only，避免改坏正常流程。
- **建议**：将敏感写入（`api_base_url` 等）改为 admin-only；偏好类（`timezone`、`font_size`、`theme`、`language`）保持普通用户可写。

### 3. 前端 `agent_step` 事件未接线（死代码，非 bug）

- **现象**：后端 agent loop 发 `agent_step` 汇总事件，前端 `useProjectChatComposer.ts` 无对应分支；store 的 `streamingSteps`/`upsertStep`/`setStreamingSteps` 与 `AgentStepView` 未被使用。
- **结论**：**不是可见 bug**。流式过程中工具进度已由 `tool_executing`/`tool_result` → `streamingToolCalls` 实时显示，`agent_step` 与之重复。
- **可选清理**：删除 store 中未使用的 `streamingSteps`/`upsertStep`/`setStreamingSteps` 与后端的 `agent_step` 发送，或保留备用。

### 4. markdown 正文可能重复显示（低频，模型行为）

- **现象**：当模型把同一段正文**既当对话 text 流式输出、又作为 content 传给写 markdown 文件的工具**时，工具会把该 content 再作为 `markdown_inline_text` 流出，用户可能看到两遍，`full_text` 也可能持久化两遍。
- **暂不修复原因**：属模型输出行为，做通用去重（如比对工具 content 与已流式文本）有误删正文的风险。
- **相关位置**：`agent_loop.py` 中 `outcome.markdown_inline_text` 的追加；`tool_executor.py` 的 markdown 内联文本产出。

### 5. 切换会话时极端时序下 loading 可能卡住（边缘）

- **现象**：`useProjectChatComposer.ts` 的 `finally` 仅在 `canUpdateVisibleStream(...)` 为真时清 `isLoading`；若旧流在用户切换会话/再次发送后才结束，极端时序下可能留下 `isLoading=true`（转圈不消失）。常见路径下新发送会自愈。
- **建议（若要修）**：把清 `isLoading` 改为只依据 `requestId === streamRequestSeqRef.current`，与会话匹配解耦。

### 6. 全局 `font_size` 设置无用户维度（次要）

- **现象**：`font_size`（本次新增）存于全局 `Setting` 表，无 user 维度，后端值对所有用户共享；每设备仍以 localStorage 为准，所以影响有限。
- **若要做"按用户跨设备同步"**，需引入按用户的设置存储。
