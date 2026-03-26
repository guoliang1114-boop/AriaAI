# AriaAI 当前架构图

> 日期：2026-03-26  
> 说明：本图基于当前仓库实际代码结构整理，反映的是“现在的系统”，不是未来目标架构。

---

## 1. 总览图

```mermaid
flowchart LR
    U[User]

    subgraph FE[macOS Client - SwiftUI]
        APP[ConsultantAIApp]
        VIEWS[Views\nChat / Projects / Clients / Knowledge / Skills / Templates / Settings]
        STORE[DataStore]
        API[APIClient\nHTTP + SSE]
    end

    subgraph BE[FastAPI Backend]
        MAIN[main.py]
        AUTHMW[Auth Middleware]

        subgraph ROUTERS[Routers]
            R_AUTH[auth.py]
            R_CHAT[chat.py]
            R_PROJECTS[projects.py]
            R_CLIENTS[clients.py]
            R_KNOWLEDGE[knowledge.py]
            R_SKILLS[skills.py]
            R_SCHEDULES[schedules.py]
            R_TEMPLATES[templates.py]
            R_SETTINGS[settings.py]
            R_ARTIFACTS[artifacts.py]
        end

        subgraph SERVICES[Services]
            S_CLAUDE[claude.py]
            S_RAG[rag.py]
            S_PARSER[parser.py]
            S_TOOL_EXEC[tool_executor.py]
            S_TASK[task_runner.py]
            S_SCHED[scheduler.py]
        end

        subgraph TOOLS[Tools]
            T_FILES[file_generators.py]
            T_REG[tool registry]
        end
    end

    subgraph DATA[Data Layer]
        DB[(PostgreSQL\nSQLModel)]
        UPLOADS[(Uploads Directory)]
        KEYRING[Keyring\nAPI Key]
    end

    EXT[Anthropic Claude API]

    U --> APP
    APP --> VIEWS
    VIEWS --> STORE
    STORE --> API
    API --> MAIN
    MAIN --> AUTHMW
    AUTHMW --> ROUTERS

    R_CHAT --> S_CLAUDE
    R_CHAT --> S_RAG
    R_CHAT --> S_TOOL_EXEC

    R_KNOWLEDGE --> S_PARSER
    R_KNOWLEDGE --> S_RAG

    R_SCHEDULES --> S_SCHED
    S_SCHED --> S_TASK

    S_TOOL_EXEC --> T_REG
    T_REG --> T_FILES

    ROUTERS --> DB
    ROUTERS --> UPLOADS
    R_SETTINGS --> KEYRING

    S_CLAUDE --> EXT
```

---

## 2. 前端结构图

```mermaid
flowchart TD
    APP[ConsultantAIApp.swift]
    ROOT[RootView]
    STATE[AppStateManager]
    STORE[DataStore]

    APP --> ROOT
    APP --> STATE
    APP --> STORE

    ROOT --> LOGIN[LoginView]
    ROOT --> MAIN[MainWorkbenchView]

    MAIN --> SIDEBAR[SidebarView]
    MAIN --> CHAT[ChatView]
    MAIN --> PROJECTS[ProjectsView]
    MAIN --> PROJECTSPACE[ProjectSpaceView]
    MAIN --> CLIENTS[ClientsView]
    MAIN --> KB[KnowledgeBaseView]
    MAIN --> SKILLS[SkillsView]
    MAIN --> SCHEDULES[SchedulesView]
    MAIN --> TEMPLATES[TemplatesView]
    MAIN --> SETTINGS[SettingsView]

    STORE --> API[APIClient.swift]
    STORE --> MODELS[APIModels.swift]
```

---

## 3. 后端结构图

```mermaid
flowchart TD
    MAIN[main.py]
    DBSETUP[create_db + migrate_db + seed admin + start scheduler]
    MIDDLEWARE[Auth Middleware]

    MAIN --> DBSETUP
    MAIN --> MIDDLEWARE
    MAIN --> AUTH[auth router]
    MAIN --> CHAT[chat router]
    MAIN --> PROJECTS[projects router]
    MAIN --> CLIENTS[clients router]
    MAIN --> KNOWLEDGE[knowledge router]
    MAIN --> SKILLS[skills router]
    MAIN --> SCHEDULES[schedules router]
    MAIN --> TEMPLATES[templates router]
    MAIN --> SETTINGS[settings router]
    MAIN --> ARTIFACTS[artifacts router]

    CHAT --> CLAUDE[claude service]
    CHAT --> RAG[rag service]
    CHAT --> TOOL_EXEC[tool executor]

    KNOWLEDGE --> PARSER[parser service]
    KNOWLEDGE --> RAG

    SCHEDULES --> SCHED[scheduler service]
    SCHED --> TASK[task runner]

    TOOL_EXEC --> REGISTRY[tool registry]
    REGISTRY --> FILE_TOOLS[file generators]
```

---

## 4. 数据模型关系图

```mermaid
erDiagram
    ClientRecord ||--o{ KnowledgeDocument : owns
    Project ||--o{ Milestone : has
    Project ||--o{ ProjectFolder : has
    Project ||--o{ ProjectFile : has
    Project ||--o{ ProjectPayment : has
    Project ||--o{ Conversation : has

    ProjectFolder ||--o{ ProjectFile : groups

    Conversation ||--o{ Message : contains
    Conversation ||--o{ GeneratedFile : produces
    Conversation ||--o{ ToolCall : records

    Skill ||--o{ Conversation : used_by
    Skill ||--o{ ScheduledTask : powers

    KnowledgeDocument ||--o{ DocumentChunk : split_into

    User {
        int id
        string email
        string display_name
        bool is_admin
        bool is_active
        string auth_token
    }

    ClientRecord {
        int id
        string name
        string industry
        string contact
    }

    Project {
        int id
        string name
        string client
        string status
        float contract_amount
    }

    Conversation {
        int id
        int project_id
        int skill_id
        string title
    }

    Message {
        int id
        int conversation_id
        string role
        string content
    }

    KnowledgeDocument {
        int id
        string name
        string file_type
        string vector_status
        int client_id
    }

    DocumentChunk {
        int id
        int document_id
        int chunk_index
        string content
    }

    Skill {
        int id
        string name
        string category
    }

    GeneratedFile {
        int id
        int conversation_id
        int project_id
        string file_type
        string path
    }

    ScheduledTask {
        int id
        int project_id
        int skill_id
        string frequency
        string status
    }
```

---

## 5. 关键链路图

## 5.1 聊天与工具调用链路

```mermaid
sequenceDiagram
    participant User
    participant ChatView
    participant APIClient
    participant ChatRouter
    participant Claude
    participant ToolExec
    participant FileTool
    participant DB

    User->>ChatView: 输入消息
    ChatView->>APIClient: streamChat(...)
    APIClient->>ChatRouter: POST /chat/send
    ChatRouter->>DB: 保存 user message
    ChatRouter->>ChatRouter: 组装 system prompt / project context / RAG
    ChatRouter->>Claude: 流式请求
    Claude-->>ChatRouter: text chunks / tool_use
    ChatRouter-->>APIClient: SSE text

    alt 触发工具
        ChatRouter->>ToolExec: execute(tool_name, input)
        ToolExec->>FileTool: 生成文件
        FileTool-->>ToolExec: result + path
        ToolExec-->>ChatRouter: tool_result
        ChatRouter->>Claude: continuation with tool_result
        Claude-->>ChatRouter: follow-up text
    end

    ChatRouter->>DB: 保存 assistant message
    ChatRouter-->>APIClient: done
    APIClient-->>ChatView: 更新 UI
```

---

## 5.2 知识库上传与索引链路

```mermaid
sequenceDiagram
    participant User
    participant KBView
    participant APIClient
    participant KnowledgeRouter
    participant Parser
    participant RAG
    participant DB
    participant Uploads

    User->>KBView: 上传文档
    KBView->>APIClient: uploadFile(/knowledge/documents)
    APIClient->>KnowledgeRouter: POST /knowledge/documents
    KnowledgeRouter->>Uploads: 保存原始文件
    KnowledgeRouter->>DB: 创建 KnowledgeDocument
    KnowledgeRouter-->>APIClient: 返回 doc

    KnowledgeRouter->>Parser: 后台提取文本
    Parser-->>KnowledgeRouter: plain text
    KnowledgeRouter->>RAG: index_document(...)
    RAG->>DB: 写入 DocumentChunk + embedding
    RAG->>DB: 更新 vector_status / progress
```

---

## 5.3 定时任务链路

```mermaid
sequenceDiagram
    participant User
    participant SchedulesView
    participant APIClient
    participant SchedulesRouter
    participant Scheduler
    participant TaskRunner
    participant ChatFlow

    User->>SchedulesView: 创建任务
    SchedulesView->>APIClient: POST /schedules
    APIClient->>SchedulesRouter: 创建任务
    SchedulesRouter->>Scheduler: register_task

    Scheduler->>TaskRunner: 到时间触发
    TaskRunner->>ChatFlow: 运行 skill + prompt
    ChatFlow-->>TaskRunner: 输出结果 / 文件
```

---

## 6. 当前架构特点

### 优点

- 前后端职责大致清晰
- 已经具备完整的业务骨架
- 聊天、知识库、技能、项目、交付物基本串起来了
- 数据模型已经覆盖了实际业务对象

### 当前瓶颈

- 聊天路由承担职责过多
- RAG 仍偏轻量实现
- 工具执行与交付物生成耦合较深
- 异步任务状态还不够统一
- 现架构更像单体应用，后续扩展会面临边界划分压力

---

## 7. 后续演进建议

如果后面要从当前架构继续演进，建议优先往这几个方向拆：

- `context builder`
- `retrieval service`
- `generation service`
- `task state / background jobs`

这几个拆出来之后，当前架构会更容易往：

- Vercel 轻 API + 外部 worker
- 主后端 + AI 子服务
- 单体到模块化单体

这样的路线继续演进。
