# AriaAI (ConsultantAI) - LLM 协作文档

> **版本**: v1.0  
> **更新日期**: 2026-03-26  
> **用途**: 本文档供各大语言模型阅读和参考，便于协作开发  

---

## 1. 项目概述

### 1.1 产品定位

**AriaAI** (内部代号 ConsultantAI) 是一款专为管理咨询行业打造的 **AI 原生工作台**。

> **核心主张**: 不止聊天，搞定一切

解决通用 AI 工具的三大痛点：
- **上下文割裂** → 项目空间 + 知识库，AI 始终了解项目背景
- **输出不专业** → 内置顾问场景技能库，遵循 Pyramid Principle 等方法论
- **数据安全** → 本地运行 + 私有部署，数据不出企业

### 1.2 目标用户

| 角色 | 核心诉求 | 使用频率 |
|------|----------|----------|
| Analyst / Associate | 数据整理、PPT 制作、纪要撰写 | 日常高频 |
| Consultant / Manager | 框架分析、报告撰写、汇报材料 | 日常高频 |
| Partner / Director | 提案生成、战略洞察、董事会材料 | 按需使用 |

### 1.3 部署模式

- ✅ **阶段一**: Mac 桌面 App（单机使用，本地存储）- **当前阶段**
- 🔄 **阶段二**: 私有化部署（团队共享知识库、模板）
- 🔲 **阶段三**: SaaS 订阅（多租户隔离）

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      顾问 AI 工作台                               │
├─────────────────┬─────────────────────────────────────────────────┤
│   SwiftUI App   │           Python FastAPI Backend                │
│   (macOS 13+)   │                                                │
│                 │   ┌──────────┐   ┌──────────┐   ┌──────────┐  │
│ · 对话工作区     │   │  Chat    │   │ Projects │   │Knowledge │  │
│ · 技能中心       │   │  Router  │   │  Router  │   │  Router  │  │
│ · 项目空间       │   └────┬─────┘   └────┬─────┘   └────┬─────┘  │
│ · 知识库         │        └──────────────┼──────────────┘        │
│ · 定时任务       │                       ▼                      │
│                 │                ┌──────────┐                   │
│ · 模板管理       │                │ Claude   │                   │
│                 │                │  API     │                   │
└─────────────────┤                └────┬─────┘                   │
                  │                     │                        │
                  │   ┌─────────────────┼─────────────────┐      │
                  │   ▼                 ▼                 ▼      │
                  │ ┌────────┐     ┌─────────┐     ┌─────────┐  │
                  │ │ SQLite │     │RAG/Embed│     │ Tool    │  │
                  │ │  DB    │     │  ding   │     │Executor │  │
                  │ └────────┘     └─────────┘     └─────────┘  │
                  └─────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| **前端** | SwiftUI (macOS 13+) | 原生 macOS 应用体验 |
| **后端** | Python 3.9 + FastAPI | 高性能异步 API 服务 |
| **ORM** | SQLModel | SQLAlchemy + Pydantic 结合 |
| **数据库** | SQLite | 本地轻量存储 |
| **AI 模型** | Claude API (Sonnet/Opus) | 主要推理引擎 |
| **Embedding** | sentence-transformers | 本地向量化 (all-MiniLM-L6-v2) |
| **RAG** | 余弦相似度检索 | 基于 numpy 的向量检索 |
| **文件生成** | python-pptx, python-docx, openpyxl | PPT/Word/Excel 生成 |
| **调度** | APScheduler | 定时任务执行 |

### 2.3 项目结构

```
AP/
├── ConsultantAI/                    # macOS SwiftUI 应用
│   ├── ConsultantAI/
│   │   ├── ConsultantAIApp.swift    # 应用入口
│   │   ├── Models/                  # 数据模型
│   │   ├── Services/                # API 客户端、数据存储
│   │   │   ├── APIClient.swift      # HTTP + SSE 流式通信
│   │   │   ├── APIModels.swift      # API 数据模型
│   │   │   └── DataStore.swift      # 全局状态管理
│   │   ├── Views/                   # UI 视图
│   │   │   ├── Chat/                # 对话工作区
│   │   │   ├── Projects/            # 项目列表
│   │   │   ├── ProjectSpace/        # 项目详情
│   │   │   ├── KnowledgeBase/       # 知识库
│   │   │   ├── Skills/              # 技能中心
│   │   │   ├── Schedules/           # 定时任务
│   │   │   ├── Templates/           # 模板库
│   │   │   ├── Settings/            # 设置
│   │   │   └── Sidebar/             # 侧边导航
│   │   └── Design/                  # 设计系统
│   ├── backend/                     # Python FastAPI 后端
│   │   ├── main.py                  # 应用入口
│   │   ├── app/
│   │   │   ├── routers/             # API 路由
│   │   │   │   ├── chat.py          # 对话 + SSE 流式
│   │   │   │   ├── projects.py      # 项目管理
│   │   │   │   ├── knowledge.py     # 知识库 + RAG
│   │   │   │   ├── skills.py        # 技能管理
│   │   │   │   ├── schedules.py     # 定时任务
│   │   │   │   ├── templates.py     # 模板管理
│   │   │   │   ├── auth.py          # 认证
│   │   │   │   └── artifacts.py     # 生成文件下载
│   │   │   ├── services/            # 业务服务
│   │   │   │   ├── claude.py        # Claude API 封装
│   │   │   │   ├── rag.py           # 向量化 + 检索
│   │   │   │   ├── parser.py        # 文档解析
│   │   │   │   ├── tool_executor.py # 工具执行
│   │   │   │   ├── task_runner.py   # 定时任务执行
│   │   │   │   └── scheduler.py     # APScheduler 管理
│   │   │   ├── tools/               # 工具定义
│   │   │   │   ├── file_generators.py  # PPT/Word/Excel/PDF 生成
│   │   │   │   └── __init__.py      # 工具注册中心
│   │   │   ├── models/              # 数据库模型
│   │   │   │   └── db.py            # SQLModel 表定义
│   │   │   ├── core/                # 核心工具
│   │   │   │   └── security.py      # API Key 管理 (Keychain)
│   │   │   ├── config.py            # 配置项
│   │   │   └── database.py          # 数据库连接
│   │   ├── data/                    # 数据存储
│   │   │   ├── uploads/             # 上传文件
│   │   │   │   ├── projects/        # 项目文件
│   │   │   │   ├── generated/       # AI 生成文件
│   │   │   │   └── knowledge/       # 知识库文档
│   │   │   └── consultant.db        # SQLite 数据库
│   │   └── skills/                  # 技能定义目录
│   │       └── ai-strategy-report/  # 示例技能
│   └── Package.swift                # Swift Package Manager
├── AppIcons/                        # 多平台图标资源
├── stitch_ai/                       # AI 相关脚本/实验
└── 设计文档.md                       # 产品设计文档
```

---

## 3. 核心模块详解

### 3.1 对话系统 (Chat)

**文件**: `ConsultantAI/backend/app/routers/chat.py`

**核心流程**:
```
1. 用户发送消息 → POST /chat/send
2. 创建/获取 Conversation
3. 构建 System Prompt (技能 + 项目上下文 + RAG)
4. SSE 流式调用 Claude API
5. 检测 tool_use → 执行工具 → 返回结果
6. 多轮对话 → 生成文件 → 持久化消息
```

**SSE 事件类型**:
| 类型 | 说明 |
|------|------|
| `conversation_id` | 对话 ID |
| `text` | 文本内容块 |
| `tool_executing` | 工具正在执行 |
| `tool_result` | 工具执行结果 (含文件路径) |
| `done` | 流结束 |
| `error` | 错误信息 |

### 3.2 技能系统 (Skills)

**文件**: `ConsultantAI/backend/app/routers/skills.py`

**技能分类**:
| 分类 | 说明 | 示例 |
|------|------|------|
| `quick_tool` | 快速工具 (5分钟内) | 会议纪要、SWOT分析 |
| `deep_task` | 深度任务 (5-30分钟) | 市场研究报告、战略报告 |
| `guided_workflow` | 引导式工作流 | 根因分析、项目启动 |

**技能结构**:
```json
{
  "name": "技能名称",
  "category": "quick_tool|deep_task|guided_workflow",
  "description": "一句话描述",
  "system_prompt": "AI 角色定义 + 工作流程 + 输出格式",
  "user_template": "用户输入模板",
  "tools_definition_json": "[Claude Function Calling 工具定义]",
  "estimated_time": "~15 min",
  "max_tokens": 4096
}
```

### 3.3 RAG 知识库

**文件**: `ConsultantAI/backend/app/services/rag.py`

**流程**:
1. 文档上传 → 解析文本 (pdfplumber / python-docx)
2. 文本分块 (chunk_size=500, overlap=50)
3. Embedding (sentence-transformers all-MiniLM-L6-v2)
4. 存储到 SQLite (DocumentChunk 表)
5. 检索时：query embedding → 余弦相似度 → Top-K

### 3.4 文件生成工具

**文件**: `ConsultantAI/backend/app/tools/file_generators.py`

**可用工具**:
| 工具名 | 功能 | 输出 |
|--------|------|------|
| `generate_ppt` | 生成 PowerPoint | .pptx |
| `generate_docx` | 生成 Word | .docx |
| `generate_xlsx` | 生成 Excel | .xlsx |
| `generate_pdf` | 生成 PDF | .pdf |
| `save_json` | 保存 JSON | .json |
| `save_text` | 保存文本 | .txt/.md |

---

## 4. 数据库模型

**文件**: `ConsultantAI/backend/app/models/db.py`

### 4.1 核心表

```python
# 项目
Project(id, name, client, description, status, created_at)
  ├─ Milestone(id, project_id, title, is_done, priority, due_date)
  ├─ ProjectFile(id, project_id, name, file_type, path)
  ├─ Conversation(id, project_id, title, created_at)
  └─ ProjectPayment(id, project_id, amount, payment_date)

# 对话
Conversation(id, project_id, skill_id, title)
  └─ Message(id, conversation_id, role, content, metadata_json)

# 知识库
KnowledgeDocument(id, name, file_type, vector_status, chunk_count)
  └─ DocumentChunk(id, document_id, content, embedding_json)

# 技能
Skill(id, name, category, system_prompt, tools_definition_json)

# 定时任务
ScheduledTask(id, name, project_id, skill_id, prompt, frequency, is_enabled)

# 生成文件
GeneratedFile(id, conversation_id, name, file_type, path)

# 用户
User(id, email, display_name, password_hash, is_admin, auth_token)
```

---

## 5. API 接口

### 5.1 核心端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/chat/send` | POST | SSE 流式对话 |
| `/chat/conversations` | GET/POST | 对话列表/创建 |
| `/projects` | CRUD | 项目管理 |
| `/projects/{id}/milestones` | CRUD | 里程碑 |
| `/projects/{id}/files` | POST | 文件上传 |
| `/knowledge` | CRUD | 知识库文档 |
| `/knowledge/upload` | POST | 文档上传 |
| `/skills` | CRUD | 技能管理 |
| `/skills/seed` | POST | 初始化默认技能 |
| `/schedules` | CRUD | 定时任务 |
| `/templates` | CRUD | 模板管理 |
| `/settings/api-key` | GET/POST | API Key 管理 |
| `/artifacts/download` | GET | 下载生成文件 |

### 5.2 认证

- Header: `X-Auth-Token: <auth_token>`
- Token 通过 `/auth/login` 获取
- 用户系统支持: admin / normal user

---

## 6. 开发指南

### 6.1 启动项目

**Terminal 1 - Backend**:
```bash
cd ConsultantAI/backend
./start.sh  # 自动创建 venv + 安装依赖 + 启动
```

**Terminal 2 - Mac App**:
```bash
cd ConsultantAI
swift run
```

### 6.2 添加新技能

1. 在 `backend/app/routers/skills.py` 的 `DEFAULT_SKILLS` 中添加技能定义
2. 重启后端服务，自动种子到数据库
3. 或调用 `POST /skills/seed` 手动触发

### 6.3 添加新工具

1. 在 `backend/app/tools/` 创建新文件
2. 使用 `@registry.register()` 装饰器注册工具
3. 在 `main.py` 导入新工具模块
4. 重启服务

示例:
```python
# app/tools/my_tool.py
from app.tools import registry

@registry.register(
    name="my_tool",
    description="工具描述",
    input_schema={"type": "object", "properties": {...}}
)
async def my_tool_handler(param: str) -> dict:
    return {"success": True, "result": ...}
```

### 6.4 前端添加新页面

1. 在 `ConsultantAI/Views/` 创建新文件夹和 Swift 文件
2. 在 `AppScreen` enum 中添加新页面类型
3. 在 `MainWorkbenchView` 的 switch 中添加路由
4. 在 `SidebarView` 添加导航项

---

## 7. 配置项

### 7.1 后端配置 (config.py)

```python
UPLOADS_DIR = Path("data/uploads")      # 上传文件目录
DEFAULT_MODEL = "claude-3-sonnet-4-6"   # 默认 Claude 模型
DEFAULT_MAX_TOKENS = 4096               # 默认最大 token
CHUNK_SIZE = 500                        # RAG 分块大小
CHUNK_OVERLAP = 50                      # 分块重叠
TOP_K_RESULTS = 5                       # RAG 检索 Top-K
EMBEDDING_MODEL = "all-MiniLM-L6-v2"    # Embedding 模型
```

### 7.2 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_EMAIL` | 管理员邮箱 | admin@d2cgo.com |
| `ADMIN_PASSWORD` | 管理员密码 | Admin@d2cgo |
| `ANTHROPIC_API_KEY` | Claude API Key | - |
| `API_BASE_URL` | Claude API 基础 URL | https://api.anthropic.com |

---

## 8. 已知问题与待办

### 8.1 已完成 ✅
- SSE 流式对话
- Claude Function Calling (文件生成)
- 项目 CRUD + 里程碑
- 知识库上传 + RAG 检索
- 技能系统基础
- 定时任务调度
- API Key 管理 (Keychain)

### 8.2 进行中 🟡
- 文件上传 UI (知识库/项目)
- 历史对话列表 UI
- 技能选择器 (@ 触发)
- 新建项目/任务表单

### 8.3 待开发 🔲
- 用户权限管理
- 团队协作功能
- 在线搜索集成
- PPTX 模板自动填充增强
- Excel 财务模型生成

---

## 9. 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| 产品设计文档 | `设计文档.md` | 产品定位、功能设计、路线图 |
| Skill 开发指南 | `SKILL_DEVELOPMENT.md` | Skill 开发规范、示例 |
| Function Calling | `ConsultantAI/backend/FUNCTION_CALLING.md` | 工具调用架构 |
| 功能清单 | `ConsultantAI/TODO.md` | 开发进度追踪 |

---

## 10. LLM 协作提示

### 10.1 当你需要修改代码时

1. **先阅读相关文档**: 本文件 + 对应模块的设计文档
2. **了解数据流**: 从 UI → APIClient → Backend Router → Service → DB
3. **遵循现有风格**: 
   - Swift: 使用现有 DesignSystem 颜色和间距
   - Python: 使用 SQLModel + FastAPI 模式
4. **注意类型安全**: Swift 严格类型，Python 使用类型注解
5. **测试工具调用**: 修改 tools 后务必测试文件生成

### 10.2 常见修改场景

**添加新 API 端点**:
- Backend: 在 `routers/` 添加路由函数
- Frontend: 在 `APIClient.swift` 添加调用方法
- DataStore: 添加状态管理和缓存

**修改数据库模型**:
- 修改 `models/db.py`
- 创建 Alembic migration (如需要)
- 更新前后端模型定义

**添加新工具**:
- Backend: `tools/file_generators.py` 或新建文件
- 使用 `@registry.register()` 注册
- 在 Skill 的 `tools_definition_json` 中引用

---

*本文档供 LLM 协作使用，人类开发者请优先参考具体的设计文档和代码注释。*
