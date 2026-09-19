# 代码 Review 遗留事项

> 记录日期：2026-05-27；最近复核：2026-09-20。
> 来源：一次全栈整体 review（后端 chat 子系统、前端 chat 子系统、后端安全/越权）。
> 本文件区分历史问题、当前实现与仍待验收事项；本轮改动及证据见 [验收记录](./23-2026-09-19全量推进验收.md)。
> V0.0.4 迭代进度见 [docs/13-V0.0.4迭代计划.md](./13-V0.0.4迭代计划.md)。

---

## 已修复（仅备查，详见 commit）

- **provider API 密钥明文泄露（P0）**：`GET /settings/` 曾把 `Setting` 表里明文存储的所有 LLM 密钥返回给任何登录用户；`PUT /settings/{key}` 可改写密钥。已改为：读端点过滤密钥（直读返回 404）、通配 PUT 拒写密钥，密钥只走专用掩码端点。
- **agent loop 截断只在 step 0 自动续写**：已扩展到任意"产出最终答案且无待执行工具"的 step。
- **markdown 表格分隔行列数不匹配导致整表不渲染**：渲染前规范化分隔行到表头列数（`normalizeMarkdownTables`），并跳过代码块/缩进代码块。
- **项目对话非真流式 + 回复闪现**：`agent_loop._consume_stream` 由"攒完一轮批量返回"改为 async generator 边解析边 `yield`。
- **任务进度 4 步罐头模板**：改为按真实工具调用渲染步骤。
- **用户菜单退出登录字号 16px**：`button` reset 由无层移入 `@layer base`，恢复 Tailwind 工具类优先级。
- **前端对话状态重复实现**：移除了从未被页面订阅的 `chatStore` / `chatStreamStore` / `runActivityStore`，以及只有死代码消费的重复 SSE 类型、未接线干系人 hook 和失效特性开关。当前对话页面直接消费 Product Run Event 回执，纯 `runActivityReducer` 作为已测试的事件折叠合约保留。
- **【V0.0.4】§2 `api_base_url` 等敏感全局配置可被任意成员改写**：通配 `PUT /settings/{key}` 对 `api_base_url`/`ai_model`/`selected_model`/`llm_provider`/`temperature`/`max_tokens`/`top_p`/`presence_penalty`/`frequency_penalty` 加 admin 门；偏好类（timezone/theme/language/font_size）保持普通用户可写。读端点继续开放（不含密钥）。对应 docs/13 §6 C1。
- **【V0.0.4】§5 切会话 loading 卡住**：`useProjectChatComposer.ts` 的 `finally` 改为只看 `requestId === streamRequestSeqRef.current`，与 conversation 匹配解耦。对应 docs/13 §6 C3。

---

## 历史事项的当前状态

### 1. 项目、客户与会话访问隔离（旧说明已失效）

- **当前实现**：项目路由使用 `chat_security.require_project_access` / `require_project_write_access`；普通成员写入需要相应角色。项目创建、文件与子路由、共享客户写入均有对应权限回归。
- **客户边界**：`client_permissions.py` 基于创建者、管理员和稳定的关联项目关系授权；仅能编辑其中一个关联项目不等于有权修改共享客户，返回内容也按可见项目过滤。
- **会话边界**：项目会话要求真实成员身份，管理员也不绕过；独立会话要求 owner。知识检索先校验 Source ACL 和文档作用域，再读取与评分。
- **证据**：`test_project_subroute_write_acl.py`、`test_clients_router.py`、`test_knowledge_conversation_access.py`、`test_knowledge_retrieval.py`。旧“所有登录用户共享全部数据”不能再作为实现依据。

### 2. ~~全局配置可被任意成员改写（含 `api_base_url`）~~

> **状态**：✅ 已在 V0.0.4 修复（commit `7c08815`，对应 docs/13 §6 C1）。LLM 配置类 + `api_base_url`/`ai_model` 改为 admin-only；偏好类(timezone/theme/language/font_size)保持普通用户可写。详见上方"已修复"。

### 4. Markdown 工具正文重复（本轮已增加精确保护）

> **状态**：本轮工作区已实现，发布状态见验收记录。

- **现象**：当模型把同一段正文**既当对话 text 流式输出、又作为 content 传给写 markdown 文件的工具**时，工具会把该 content 再作为 `markdown_inline_text` 流出，用户可能看到两遍，`full_text` 也可能持久化两遍。
- **保护范围**：完整正文相同，或至少 80 字符的正文与双换行分隔的完整末尾相同，才抑制再次内联。保留原工具调用、结果、文件回执与变更过的正文；不做模糊去重或删除重复段落。
- **相关位置**：`agent_loop.py` 中 `outcome.markdown_inline_text` 的追加；`tool_executor.py` 的 markdown 内联文本产出。

### 5. ~~切换会话时极端时序下 loading 可能卡住~~

> **状态**：✅ 已在 V0.0.4 修复（commit `1899efc`，对应 docs/13 §6 C3）。`finally` 改为只看 `requestId === streamRequestSeqRef.current`，与 conversation 匹配解耦。详见上方"已修复"。

### 6. 外观偏好的用户维度（历史实现已变化）

> **状态**：当前外观页通过 `/user-memory` 保存 `appearance`，本地存储负责首屏外观。旧独立 `font_size` 设置不再是当前外观页的写入路径。

- **边界**：不把历史全局值自动提升为某个用户的偏好；是否需要导入旧值须另有明确规则。当前个人偏好不能覆盖 Aria 授权或 HITAS。
