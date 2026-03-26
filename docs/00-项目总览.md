# AriaAI / ConsultantAI - 应用上下文文档

> 版本：v2.0  
> 更新日期：2026-03-26  
> 适用对象：人类开发者、LLM 编码助手、协作代理  
> 说明：本文件以当前仓库代码为准，重点描述系统结构、模块职责、真实数据流和协作注意事项。

---

## 1. 项目概览

### 1.1 产品定位

**AriaAI**（代码目录仍以 `ConsultantAI` 为主）是一个面向咨询顾问和专业服务团队的 AI 工作台，核心目标不是“聊天”，而是围绕项目、客户、知识、技能和交付物组织完整工作流。

当前产品形态包括：

- 一个基于 **SwiftUI** 的 macOS 客户端
- 一个基于 **FastAPI** 的 Python 后端
- 以项目、知识库、技能、模板、定时任务为中心的数据模型
- 对 Claude 的流式调用、工具调用、文档生成和 RAG 检索能力

### 1.2 当前代码中的产品能力

仓库中已经落地或部分落地的能力包括：

- 登录认证与基础用户管理
- 项目管理、里程碑、项目文件、项目文件夹、项目财务
- 客户管理与知识文档关联
- 技能管理、默认技能种子、进阶技能种子、工具定义校验
- 知识库上传、解析、切块、向量化、检索
- 聊天工作区、SSE 流式输出、Claude 工具调用
- 生成文件管理与下载
- 模板上传与管理
- APScheduler 定时任务
- 设置管理，包括 Claude API Key 和自定义 API Base URL / HTTP 模式

### 1.3 命名说明

- 产品名：`AriaAI`
- 历史目录名：`ConsultantAI`
- 后端 FastAPI title：`ConsultantAI API`
- Swift Package name：`Aria AI`

也就是说，品牌名已向 AriaAI 迁移，但大量代码、目录和脚本仍保留 `ConsultantAI` 命名，这是当前仓库的正常状态，不是错误。

---

## 2. 技术架构

### 2.1 架构总览

```text
macOS SwiftUI App
  -> APIClient.swift
  -> FastAPI backend
      -> routers
      -> services
      -> SQLModel models
      -> PostgreSQL / SQLite-compatible model layer
      -> Claude API
      -> RAG embedding + retrieval
      -> file generators
      -> APScheduler
```

### 2.2 技术栈

| 层 | 技术 | 当前状态 |
|---|---|---|
| 前端 | SwiftUI, AppKit | macOS 客户端主应用 |
| Swift 包管理 | Swift Package Manager | `Package.swift` |
| 后端 | FastAPI, Uvicorn | 主 API 服务 |
| ORM / Model | SQLModel | 全部核心表定义在 `app/models/db.py` |
| 数据库 | PostgreSQL 优先，SQLite 兼容保留 | 当前默认配置是 PostgreSQL |
| LLM | Anthropic Claude | 通过 `app/services/claude.py` 调用 |
| 向量化 | sentence-transformers | `all-MiniLM-L6-v2` |
| 向量检索 | numpy + 自定义 cosine similarity | 轻量本地实现 |
| 调度 | APScheduler | 定时任务执行 |
| 文档生成 | python-pptx / python-docx / openpyxl / reportlab | 生成 PPT/Word/Excel/PDF |
| 认证安全 | bcrypt + token + keyring | 用户密码哈希与 API Key 存储 |

### 2.3 数据库现状

这一点和旧文档差异很大，必须注意：

- `ConsultantAI/backend/app/config.py` 中的默认 `DATABASE_URL` 是 **PostgreSQL**
- `ConsultantAI/backend/data/consultant.db` 仍存在，但更像兼容遗留或本地数据文件
- `requirements.txt` 已包含 `psycopg2-binary` 和 `alembic`
- `start.sh` 会显式导出远程 PostgreSQL 连接字符串

因此，不应再把系统描述为“默认 SQLite 单机应用”。更准确的表述是：

> 模型层兼容 SQLite，但当前仓库默认运行配置已经切到 PostgreSQL。

---

## 3. 仓库结构

### 3.1 顶层目录

```text
AriaAI/
├─ APP_CONTEXT.md
├─ app-contact.md
├─ 设计文档.md
├─ SKILL_DEVELOPMENT.md
├─ Deploy.md
├─ AppIcons/
├─ ConsultantAI/
└─ stitch_ai/
```

### 3.2 重点代码目录

```text
ConsultantAI/
├─ Package.swift
├─ TODO.md
├─ ConsultantAI/
│  ├─ ConsultantAIApp.swift
│  ├─ Localization.swift
│  ├─ Design/
│  ├─ Models/
│  ├─ Services/
│  │  ├─ APIClient.swift
│  │  ├─ APIModels.swift
│  │  └─ DataStore.swift
│  └─ Views/
│     ├─ Auth/
│     ├─ Chat/
│     ├─ Clients/
│     ├─ KnowledgeBase/
│     ├─ Projects/
│     ├─ ProjectSpace/
│     ├─ Schedules/
│     ├─ Settings/
│     ├─ Sidebar/
│     ├─ Skills/
│     └─ Templates/
├─ backend/
│  ├─ main.py
│  ├─ requirements.txt
│  ├─ start.sh
│  ├─ start_prod.sh
│  ├─ migrate_to_pg.py
│  ├─ FUNCTION_CALLING.md
│  ├─ alembic/
│  ├─ app/
│  │  ├─ config.py
│  │  ├─ database.py
│  │  ├─ core/
│  │  ├─ models/
│  │  ├─ routers/
│  │  ├─ services/
│  │  └─ tools/
│  └─ data/
└─ skills/
   └─ ai-strategy-report/
```

### 3.3 `stitch_ai/` 的定位

`stitch_ai/` 更像设计探索、页面实验或视觉草稿资产，并不是当前主应用运行路径的一部分。进行主应用修改时，一般优先关注 `ConsultantAI/ConsultantAI` 和 `ConsultantAI/backend`。

---

## 4. 前端架构

### 4.1 应用入口

入口文件：`ConsultantAI/ConsultantAI/ConsultantAIApp.swift`

关键点：

- 使用 `AppDelegate` 将激活策略设为 `.regular`
- 主状态对象：
  - `AppStateManager`
  - `DataStore`
- 根视图根据 `isAuthenticated` 在 `LoginView` 和 `MainWorkbenchView` 之间切换

### 4.2 主界面导航

当前主要页面包括：

- `ProjectsView`
- `ProjectSpaceView`
- `ChatView`
- `ClientsView`
- `KnowledgeBaseView`
- `SkillsView`
- `SchedulesView`
- `TemplatesView`
- `SettingsView`

主容器在 `MainWorkbenchView` 中通过 `selectedScreen` 切换。

### 4.3 前端数据层

核心文件：

- `Services/APIClient.swift`
- `Services/APIModels.swift`
- `Services/DataStore.swift`

职责分工：

- `APIClient.swift`
  - 负责 HTTP 请求
  - 负责 `X-Auth-Token` 注入
  - 负责 `/chat/send` 的 SSE 流式读取
  - 负责文件上传、生成文件下载
- `DataStore.swift`
  - 聚合所有业务数据加载与写操作
  - 将 API 模型转为本地 UI 模型
  - 负责项目、聊天、技能、知识库、任务、模板、客户、认证、设置等调用

### 4.4 默认 API 地址

`APIClient.swift` 中默认后端地址是：

```text
https://aria.d2cgo.co
```

用户也可以通过 `UserDefaults` 中的 `apiBaseURL` 覆盖。

---

## 5. 后端架构

### 5.1 入口与生命周期

入口文件：`ConsultantAI/backend/main.py`

启动时会做这些事情：

1. `create_db()`
2. `migrate_db()`
3. 回填项目默认文件夹 `_backfill_folders()`
4. 回填旧技能缺失的 `user_template`
5. 初始化默认管理员账号
6. 启动 APScheduler

关闭时会执行：

- `scheduler.shutdown()`

### 5.2 认证中间件

后端存在全局认证中间件：

- 放行：`/health` 与 `/auth/*`
- 其他接口默认要求 `X-Auth-Token`
- 如果系统中还没有任何用户，会短暂允许首轮初始化流程

### 5.3 路由模块

`main.py` 中实际挂载的 routers 有：

- `auth`
- `chat`
- `projects`
- `knowledge`
- `settings`
- `skills`
- `schedules`
- `templates`
- `clients`
- `artifacts`

这比旧文档更完整，尤其新增或已成型的模块包括：

- `clients`
- `artifacts`
- `auth`

---

## 6. 核心业务模块

### 6.1 Chat

文件：`backend/app/routers/chat.py`

能力：

- 创建/列出/删除 conversation
- 获取历史消息
- 接收用户输入后调用 Claude
- 支持 SSE 流式输出
- 支持技能 system prompt 注入
- 支持项目上下文注入
- 支持知识库 RAG 注入
- 支持项目文件内容注入
- 支持工具调用与二次追问续写

#### 聊天数据流

```text
UI -> APIClient.streamChat()
   -> POST /chat/send
   -> 记录用户消息
   -> 组装 system prompt
   -> 加载 skill tools
   -> 加载 project context / RAG context / file context
   -> 调用 Claude 流式生成
   -> 如有 tool_use 则执行工具
   -> 将 tool_result 回灌给 Claude
   -> 持久化 assistant 最终可见文本
```

#### SSE 事件类型

- `conversation_id`
- `text`
- `tool_executing`
- `tool_result`
- `done`
- `error`

### 6.2 Projects

文件：`backend/app/routers/projects.py`

能力：

- 项目 CRUD
- 里程碑 CRUD
- 项目文件上传/删除/列表
- 项目文件夹管理
- 项目财务管理
- AI 项目建议生成

新增或容易遗漏的真实能力：

- 每个项目会自动初始化 4 个默认文件夹
- 财务接口支持 `received`、`expense`、`milestone_payment`、`invoiced`
- 提供 `/projects/ai-suggest` 让 Claude 生成项目名与简介建议

### 6.3 Clients

文件：`backend/app/routers/clients.py`

能力：

- 客户 CRUD
- 客户与知识文档的绑定/解绑
- 自动汇总关联项目名
- AI 客户建议生成

这是当前系统里非常重要但旧文档缺失的模块。

### 6.4 Knowledge Base / RAG

文件：

- `backend/app/routers/knowledge.py`
- `backend/app/services/parser.py`
- `backend/app/services/rag.py`

流程：

1. 上传知识文档到 `data/uploads/knowledge`
2. 写入 `KnowledgeDocument`
3. 后台任务提取文本
4. 文本切块
5. 使用 `sentence-transformers` 生成 embedding
6. 写入 `DocumentChunk`
7. 查询时根据 cosine similarity 做 Top-K 检索

当前配置值见 `config.py`：

- `CHUNK_SIZE = 800`
- `CHUNK_OVERLAP = 100`
- `TOP_K_RESULTS = 5`
- `EMBEDDING_MODEL = "all-MiniLM-L6-v2"`

### 6.5 Skills

文件：`backend/app/routers/skills.py`

能力：

- 技能 CRUD
- 默认技能种子 `/skills/seed`
- 进阶技能种子 `/skills/seed-pro`
- 类别迁移 `/skills/migrate-categories`
- tools schema 列表与校验
- 指定 skill 的工具调试执行

当前实现已经不是旧文档中那种简单“quick_tool / deep_task / guided_workflow”模型了。实际情况是：

- 历史分类仍兼容
- 默认技能与进阶技能已经迁移到更偏业务域的分类
- skill 中同时存在：
  - `tools_json`：旧格式，工具名列表
  - `tools_definition_json`：新版 Claude tools 定义

### 6.6 Templates

文件：`backend/app/routers/templates.py`

能力：

- 模板上传
- 模板分类、标签、状态更新
- 模板删除

支持上传的模板类型：

- `.pptx`
- `.docx`
- `.pdf`

### 6.7 Schedules

文件：

- `backend/app/routers/schedules.py`
- `backend/app/services/scheduler.py`
- `backend/app/services/task_runner.py`

能力：

- 定时任务 CRUD
- 手动立即执行
- `daily / weekly / monthly / cron_expr`
- APScheduler 注册、更新、移除

### 6.8 Settings

文件：`backend/app/routers/settings.py`

能力：

- Claude API Key 状态查看/保存/删除
- 任意 key-value 设置读写

注意：

- API Key 存在 keyring，不在普通配置表中明文持久化
- 其他设置存到 `Setting` 表

### 6.9 Auth

文件：`backend/app/routers/auth.py`

能力：

- 登录
- 登出
- 获取当前用户
- 管理员查看用户列表
- 创建用户
- 更新用户启用状态 / 管理员状态 / 显示名
- 删除用户
- 管理员重置密码
- 当前用户修改密码

密码处理方式：

- `bcrypt` 哈希
- 登录后生成 UUID token
- 通过 `X-Auth-Token` 传递

### 6.10 Artifacts

文件：`backend/app/routers/artifacts.py`

能力：

- 列出生成文件
- 获取生成文件详情
- 按 artifact id 下载
- 按相对路径下载
- 删除 artifact 与实体文件

这部分和聊天工具调用配合使用，是交付物下载链路的关键一环。

---

## 7. 数据模型

文件：`backend/app/models/db.py`

### 7.1 核心实体

#### 客户

- `ClientRecord`

字段重点：

- `name`
- `industry`
- `contact`
- `notes`

#### 项目

- `Project`
- `Milestone`
- `ProjectFolder`
- `ProjectFile`
- `ProjectPayment`

项目字段重点：

- `status`: `lead | opportunity | won | delivering | archived`
- `context_freshness`
- `contract_amount`

#### 对话

- `Conversation`
- `Message`
- `ToolCall`

消息元数据通过 `metadata_json` 承载，比如：

- `skill_id`
- `doc_ids`
- `file_ids`
- `project_id`

#### 知识库

- `KnowledgeDocument`
- `DocumentChunk`

字段重点：

- `vector_status`: `pending | processing | synced | failed`
- `vector_progress`
- `chunk_count`
- `client_id`

#### 技能

- `Skill`

字段重点：

- `category`
- `system_prompt`
- `user_template`
- `estimated_time`
- `max_tokens`
- `tools_json`
- `tools_definition_json`

#### 交付物与调度

- `GeneratedFile`
- `ScheduledTask`
- `Template`
- `Setting`
- `User`

### 7.2 模型层新增点

和旧版认知相比，当前模型有几个重要扩展：

- 新增 `ClientRecord`
- 新增 `ProjectFolder`
- 新增 `ToolCall`
- `KnowledgeDocument` 可以绑定 `client_id`
- `User` 已经不是“待开发”，而是已落地
- `GeneratedFile` 和 `Template` 已完整建模

---

## 8. API 概览

### 8.1 已实现的主要端点

#### Health

- `GET /health`

#### Auth

- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /auth/users`
- `POST /auth/users`
- `PATCH /auth/users/{user_id}`
- `DELETE /auth/users/{user_id}`
- `POST /auth/users/{user_id}/reset-password`
- `POST /auth/change-password`

#### Chat

- `GET /chat/conversations`
- `POST /chat/conversations`
- `GET /chat/conversations/{conv_id}/messages`
- `POST /chat/send`
- `DELETE /chat/conversations/{conv_id}`

#### Projects

- `GET /projects`
- `POST /projects`
- `GET /projects/{project_id}`
- `PATCH /projects/{project_id}`
- `DELETE /projects/{project_id}`
- `GET /projects/{project_id}/milestones`
- `POST /projects/{project_id}/milestones`
- `PATCH /projects/{project_id}/milestones/{ms_id}`
- `DELETE /projects/{project_id}/milestones/{ms_id}`
- `GET /projects/{project_id}/files`
- `POST /projects/{project_id}/files`
- `DELETE /projects/{project_id}/files/{file_id}`
- `GET /projects/{project_id}/folders`
- `POST /projects/{project_id}/folders`
- `DELETE /projects/{project_id}/folders/{folder_id}`
- `GET /projects/{project_id}/financials`
- `POST /projects/{project_id}/financials`
- `DELETE /projects/{project_id}/financials/{payment_id}`
- `POST /projects/ai-suggest`

#### Clients

- `GET /clients`
- `POST /clients`
- `GET /clients/{client_id}`
- `PUT /clients/{client_id}`
- `DELETE /clients/{client_id}`
- `GET /clients/{client_id}/documents`
- `POST /clients/{client_id}/documents/{doc_id}`
- `DELETE /clients/{client_id}/documents/{doc_id}`
- `POST /clients/ai-suggest`

#### Knowledge

- `GET /knowledge/documents`
- `POST /knowledge/documents`
- `DELETE /knowledge/documents/{doc_id}`
- `GET /knowledge/stats`
- `POST /knowledge/query`

#### Skills

- `GET /skills`
- `POST /skills`
- `PATCH /skills/{skill_id}`
- `DELETE /skills/{skill_id}`
- `POST /skills/seed`
- `POST /skills/seed-pro`
- `POST /skills/seed-templates`
- `POST /skills/migrate-categories`
- `GET /skills/tools/available`
- `GET /skills/tools/schemas`
- `POST /skills/tools/validate`
- `POST /skills/{skill_id}/tools/test`

#### Schedules

- `GET /schedules`
- `POST /schedules`
- `PATCH /schedules/{task_id}`
- `DELETE /schedules/{task_id}`
- `POST /schedules/{task_id}/run`

#### Templates

- `GET /templates`
- `POST /templates`
- `PATCH /templates/{template_id}`
- `DELETE /templates/{template_id}`

#### Settings

- `GET /settings/api-key-status`
- `POST /settings/api-key`
- `DELETE /settings/api-key`
- `GET /settings/`
- `PUT /settings/{key}`
- `GET /settings/{key}`

#### Artifacts

- `GET /artifacts`
- `GET /artifacts/download-by-path`
- `GET /artifacts/{artifact_id}`
- `GET /artifacts/{artifact_id}/download`
- `DELETE /artifacts/{artifact_id}`

### 8.2 认证方式

- 请求头：`X-Auth-Token: <token>`
- 获取方式：`POST /auth/login`
- 公共路径：`/health` 与 `/auth/*`

---

## 9. 配置与运行

### 9.1 后端关键配置

文件：`backend/app/config.py`

当前默认值：

```python
DATABASE_URL = "postgresql://postgres:4LsPEyLFeaj3ZdAy@localhost/aria"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 100
TOP_K_RESULTS = 5
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
DEFAULT_MODEL = "claude-opus-4-6"
DEFAULT_MAX_TOKENS = 4096
```

### 9.2 环境变量

已知会使用到的环境变量：

- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

### 9.3 后端启动

参考脚本：`ConsultantAI/backend/start.sh`

脚本会：

1. 设置 `DATABASE_URL`
2. 创建 `.venv`
3. 安装依赖
4. 启动 Uvicorn

启动方式示例：

```bash
cd ConsultantAI/backend
./start.sh
```

### 9.4 前端启动

因为是 Swift Package，可用：

```bash
cd ConsultantAI
swift run
```

当前 `Package.swift` 指定：

- `swift-tools-version: 5.9`
- `platforms: [.macOS(.v14)]`

所以更准确的运行要求应写成：**macOS 14+**

---

## 10. 当前实现状态判断

### 10.1 已比较完整的模块

- 登录与用户管理
- 项目与项目空间基础能力
- 客户管理
- 知识库与轻量 RAG
- Claude 聊天与工具调用
- 模板管理
- 定时任务
- 交付物下载

### 10.2 仍需谨慎对待的部分

- 文案和注释中仍有零星乱码，说明仓库存在历史编码问题
- `skills.py` 中内置技能数据量很大，维护时要注意不要误改 JSON/字符串结构
- 前端和后端在命名上仍有 `AriaAI` / `ConsultantAI` 双轨并存
- 数据库虽然模型上兼容 SQLite，但运行脚本和依赖明显已经偏向 PostgreSQL

### 10.3 不应再沿用的旧认知

以下说法已经不准确：

- “系统默认使用 SQLite”
- “用户权限管理待开发”
- “只有项目、知识库、技能、模板几个基础模块”
- “技能分类仍然只有 quick_tool / deep_task / guided_workflow”
- “前端目标平台是 macOS 13+”

---

## 11. 对 LLM / 编码代理的协作提示

### 11.1 修改代码前优先理解的主路径

#### 聊天链路

```text
ChatView
-> APIClient.streamChat
-> /chat/send
-> chat.py
-> claude.py / tool_executor.py / tools registry
-> Message / GeneratedFile
```

#### 项目链路

```text
ProjectsView / ProjectSpaceView
-> DataStore
-> /projects...
-> projects.py
-> Project / Milestone / ProjectFile / ProjectPayment / ProjectFolder
```

#### 知识库链路

```text
KnowledgeBaseView
-> DataStore.uploadKnowledgeDocument
-> /knowledge/documents
-> knowledge.py
-> parser.py
-> rag.py
-> KnowledgeDocument / DocumentChunk
```

### 11.2 修改时的建议原则

- 优先以当前代码为准，不要依赖旧设计文档做强假设
- 修改后端接口时，通常还要同步检查：
  - `APIModels.swift`
  - `APIClient.swift`
  - `DataStore.swift`
  - 对应 SwiftUI View
- 修改模型字段时，务必同步检查：
  - `app/models/db.py`
  - 相关 router 的 Pydantic schema
  - 前端 API model 的字段映射
- 涉及聊天工具调用时，要同时检查：
  - `routers/chat.py`
  - `services/tool_executor.py`
  - `tools/__init__.py`
  - `tools/file_generators.py`

### 11.3 特别注意事项


---

## 9. 技能清单 (Skills Catalog)

> **版本**: v1.0  
> **更新日期**: 2026-03-26  
> **总计**: 24 个技能 (6 个基础 + 18 个专业)  
> **定义文件**: `ConsultantAI/backend/app/routers/skills.py`

### 9.1 Skill 分类体系

所有技能归属于以下 9 大业务领域：

| 图标 | 业务领域 | 技能数量 | 说明 |
|------|----------|----------|------|
| 📊 | 战略与增长 | 4 | 市场分析、竞争策略、增长规划 |
| 💰 | 财务咨询 | 2 | 财务分析、估值建模、ROI 计算 |
| 💻 | 数字化与技术 | 2 | AI 战略、数字化转型、技术架构 |
| ⚖️ | 风险与合规 | 2 | 风险评估、合规审查、内控设计 |
| 👥 | 组织与人才 | 2 | 组织架构、OKR、变革管理 |
| 🎯 | 市场与客户 | 2 | 客户细分、GTM 策略、品牌定位 |
| ⚙️ | 运营与效能 | 1 | 流程优化、供应链、精益管理 |
| 📋 | 提案与项目交付 | 6 | 报告撰写、交付物审查、项目管理 |
| 🤝 | 并购与交易 | 1 | 并购分析、交易结构、整合规划 |

### 9.2 Skill 类型说明

| 类型 | 描述 | 典型耗时 | 适用场景 |
|------|------|----------|----------|
| **Quick Tool** | 快速分析工具，单次交互完成 | 1-3 分钟 | 执行摘要、市场速算 |
| **Deep Task** | 深度分析任务，多轮对话 | 10-30 分钟 | 尽职调查、战略路线图 |
| **Guided Workflow** | 引导式工作流，分阶段进行 | 15-45 分钟 | 根因分析、项目启动 |

### 9.3 技能详情

#### 📊 战略与增长 (4)

**1. Market Sizing (市场规模测算)**
- **类型**: Deep Task
- **耗时**: ~5 min
- **触发**: `@市场规模`
- **描述**: Top-down 和 bottom-up 两种方法进行 TAM/SAM/SOM 分析，明确列出关键假设
- **工具**: `research`, `calculate`

**2. Competitor Intel (竞争情报)**
- **类型**: Quick Tool
- **耗时**: ~3 min
- **触发**: `@竞争分析`
- **描述**: 快速扫描竞争格局，输出竞争对手比较矩阵和战略影响分析
- **工具**: `research`, `compare`

**3. Strategic Roadmap (战略路线图)**
- **类型**: Deep Task
- **耗时**: ~20 min
- **触发**: `@战略路线图`
- **描述**: 制定详细的 3 年战略路线图，分三个阶段：快速获胜 → 核心转型 → 规模化
- **工具**: `plan`, `structure`, `timeline`

**4. Client Report Draft (客户报告起草)**
- **类型**: Deep Task
- **耗时**: ~30 min
- **触发**: `@报告起草`
- **描述**: 以幻灯片故事线形式起草完整的咨询报告叙述
- **工具**: `write`, `structure`, `pptx`

#### 💰 财务咨询 (2)

**5. 财务健康诊断**
- **类型**: Quick Tool
- **耗时**: ~10 min
- **触发**: `@财务诊断`
- **描述**: 快速扫描企业财务状况，覆盖盈利能力、流动性、杠杆率、增长质量四个维度
- **输出**: 红黄绿三色健康报告
- **工具**: `analyze`, `model`, `report`

**6. 商业案例 ROI 分析**
- **类型**: Deep Task
- **耗时**: ~15 min
- **触发**: `@ROI分析`
- **描述**: 量化投资回报率，构建三情景（乐观/基准/悲观）敏感性分析，支持 Go/No-Go 决策
- **工具**: `model`, `calculate`, `report`

#### 💻 数字化与技术 (2)

**7. AI 用例优先级矩阵**
- **类型**: Deep Task
- **耗时**: ~15 min
- **触发**: `@AI用例`
- **描述**: 从业务价值与实施可行性两个维度评分，生成 AI 应用场景优先级矩阵，推荐 Quick Win 起步项目
- **工具**: `analyze`, `prioritize`, `report`

**8. 数字化成熟度评估**
- **类型**: Deep Task
- **耗时**: ~15 min
- **触发**: `@数字化评估`
- **描述**: 六维度评估企业数字化成熟度，对标行业标杆，生成差距分析与转型优先级路线图
- **工具**: `assess`, `benchmark`, `roadmap`

#### ⚖️ 风险与合规 (2)

**9. 风险评估矩阵**
- **类型**: Quick Tool
- **耗时**: ~12 min
- **触发**: `@风险评估`
- **描述**: 系统识别项目/业务的关键风险，按发生概率×影响程度双维度评分，输出优先级矩阵与缓解方案
- **工具**: `assess`, `matrix`, `report`

**10. 合规差距分析**
- **类型**: Quick Tool
- **耗时**: ~12 min
- **触发**: `@合规差距`
- **描述**: 对照监管要求逐条审查合规状态，识别差距并给出整改优先级清单
- **工具**: `audit`, `checklist`, `report`

#### 👥 组织与人才 (2)

**11. OKR 设计工坊**
- **类型**: Guided Workflow
- **耗时**: ~12 min
- **触发**: `@OKR`
- **描述**: 从战略目标拆解到团队级 OKR，确保上下对齐、可量化、有挑战性，同步输出追踪机制
- **工具**: `design`, `align`, `structure`

**12. 变革管理规划**
- **类型**: Deep Task
- **耗时**: ~15 min
- **触发**: `@变革管理`
- **描述**: 系统规划组织变革路径：利益相关方分析、阻力诊断、沟通计划、能力建设方案
- **工具**: `plan`, `stakeholder`, `communicate`

#### 🎯 市场与客户 (2)

**13. 客户细分与画像**
- **类型**: Deep Task
- **耗时**: ~12 min
- **触发**: `@客户细分`
- **描述**: 基于人口/行为/需求/价值维度构建客户细分模型，输出可落地的客户画像与差异化策略
- **工具**: `segment`, `persona`, `analyze`

**14. GTM 上市策略**
- **类型**: Deep Task
- **耗时**: ~15 min
- **触发**: `@GTM`
- **描述**: 为新产品/市场制定 Go-To-Market 策略：目标客户、价值主张、渠道组合、定价、启动计划
- **工具**: `strategy`, `plan`, `market`

#### ⚙️ 运营与效能 (1)

**15. 根因分析**
- **类型**: Guided Workflow
- **耗时**: ~20 min
- **触发**: `@根因分析`
- **描述**: 四阶段结构化诊断：调查 → 分析 → 假设 → 建议。**铁律**：没有找到根本原因，不输出解决方案
- **工具**: `diagnose`, `issue-tree`, `hypothesize`

#### 📋 提案与项目交付 (6)

**16. Executive Summary (执行摘要)**
- **类型**: Quick Tool
- **耗时**: ~2 min
- **触发**: `@摘要`
- **描述**: 将复杂文档合成为简洁的 C 级高管就绪摘要
- **工具**: `summarize`, `structure`

**17. 提案挑战**
- **类型**: Guided Workflow
- **耗时**: ~15 min
- **触发**: `@提案挑战`
- **描述**: Partner 级高强度审查：挑战前提假设、识别逻辑漏洞、输出三个版本方案（激进/基准/保守）
- **工具**: `challenge`, `three-versions`, `red-flag`

**18. 项目启动**
- **类型**: Guided Workflow
- **耗时**: ~10 min
- **触发**: `@项目启动`
- **描述**: 六个强制追问，帮助顾问在动手前把真正的问题想清楚，自动生成项目简报（Project Brief）
- **工具**: `scoping`, `brief`, `issue-tree`

**19. 项目复盘**
- **类型**: Guided Workflow
- **耗时**: ~15 min
- **触发**: `@项目复盘`
- **描述**: 项目结束后系统性提炼经验教训，生成可复用方法论资产，为下次同类项目提供起点
- **工具**: `retro`, `learning`, `template`

**20. 交付审查**
- **类型**: Quick Tool
- **耗时**: ~10 min
- **触发**: `@交付审查`
- **描述**: 发给客户前的最后质量关：金字塔原则、数据一致性、逻辑完整性、专业语气，五项检查不通过不放行
- **工具**: `pyramid`, `logic-check`, `data-verify`

#### 🤝 并购与交易 (1)

**21. Full Due Diligence (完整尽职调查)**
- **类型**: Deep Task
- **耗时**: ~25 min
- **触发**: `@尽职调查`
- **描述**: 全面的商业、财务和运营尽职调查报告，覆盖市场动态、竞争定位、财务表现、运营风险、监管环境、交易风险
- **工具**: `research`, `analyze`, `model`, `report`

#### 📋 提案与项目交付 (续)

**22. 会议纪要生成**
- **类型**: Quick Tool
- **耗时**: ~3 min
- **触发**: `@会议纪要`
- **描述**: 上传录音或粘贴文字记录，30 秒内输出：决策事项、行动计划、责任人、截止日期
- **工具**: `summarize`, `structure`, `docx`

**23. PPT 润色**
- **类型**: Quick Tool
- **耗时**: ~2 min
- **触发**: `@润色`
- **描述**: 顾问化文字改写，遵循金字塔原则，结论先行，行动导向
- **工具**: `rewrite`, `structure`

**24. 访谈提纲**
- **类型**: Quick Tool
- **耗时**: ~3 min
- **触发**: `@访谈提纲`
- **描述**: 输入背景信息，生成结构化访谈问题清单
- **工具**: `design`, `structure`

### 9.4 技能工具清单

所有技能可用的工具（Function Calling）：

| 工具名 | 功能 | 输出格式 |
|--------|------|----------|
| `generate_ppt` | 生成 PowerPoint | .pptx |
| `generate_docx` | 生成 Word 文档 | .docx |
| `generate_xlsx` | 生成 Excel 表格 | .xlsx |
| `generate_pdf` | 生成 PDF 文档 | .pdf |
| `save_json` | 保存 JSON 数据 | .json |
| `save_text` | 保存文本文件 | .txt/.md |

### 9.5 使用提示

1. **触发技能**: 在聊天输入框输入 `@技能名称` 即可激活
2. **查看模板**: 激活技能后，系统会自动填充用户输入模板
3. **文件生成**: 支持生成 PPT/Word/Excel/PDF 等格式的交付物
4. **多轮对话**: Deep Task 和 Guided Workflow 类型支持多轮交互


---

## 10. 相关文档

仓库内可参考文档：

- `设计文档.md`
- `SKILL_DEVELOPMENT.md`
- `ConsultantAI/backend/FUNCTION_CALLING.md`
- `ConsultantAI/TODO.md`

建议使用顺序：

1. 先读本文件（APP_CONTEXT.md）
2. 再看目标模块源码
3. 必要时再补充阅读设计或技能说明文档

---

## 11. 文档更新说明

本次对 `APP_CONTEXT.md` 的更新包括：

- 清除原文件乱码与编码错误
- 用当前代码实际结构重写内容
- 更新数据库现状为 PostgreSQL 优先
- 补充 `clients`、`auth`、`artifacts`、`folders`、`financials` 等真实模块
- 修正前端平台要求为 macOS 14+
- 将"旧规划"型描述改为"当前实现"型描述
- **合并 `app-contact.md` 作为第9章技能清单**

如果后续再重构仓库命名（例如把 `ConsultantAI` 全面改成 `AriaAI`），这份文档也需要同步更新。
