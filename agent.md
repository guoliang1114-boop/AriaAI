# AriaAI — Agent Collaboration Guide

> Version: v3.2 | Last updated: 2026-04-30
> Purpose: Onboarding document for LLM agents collaborating on this codebase.
> Read this file before reading anything else.

---

## 1. What Is This Project

AriaAI is an **AI-native workbench for consultants and professional service teams**.  
It is NOT a generic chatbot. It organises work around **Projects, Clients, Knowledge, Skills, Templates, Scheduled Tasks, and Deliverables**.

Three codebases live in this monorepo:

| Directory | Role |
|---|---|
| `aria-web/` | React + TypeScript web client |
| `AriaAI/backend/` | Python FastAPI backend |

---

## 2. Repository Layout

```
AP/
├── agent.md                    ← YOU ARE HERE
├── README.md                   ← quick-start guide
├── docs/                       ← all project documentation
│   ├── 00-项目总览.md           ← full system overview (start here for context)
│   ├── 01-产品设计文档.md        ← product design & roadmap
│   ├── 02-Skill开发指南.md      ← how to build Skills
│   ├── 03-代码问题清单.md        ← known bugs & issues
│   ├── 04-产品方向建议.md        ← product direction
│   ├── 05-技术建议.md           ← technical recommendations
│   ├── 06-当前架构图.md         ← architecture diagrams (Mermaid)
│   └── 07-RAG演进方案.md        ← RAG evolution plan
├── AriaAI/
│   ├── backend/                ← Python backend
│   │   ├── main.py             ← FastAPI entry point
│   │   ├── app/
│   │   │   ├── config.py       ← ALL configuration lives here
│   │   │   ├── database.py     ← DB engine & migrations
│   │   │   ├── models/db.py    ← ALL SQLModel data models
│   │   │   ├── routers/        ← one file per domain
│   │   │   ├── services/       ← business logic
│   │   │   └── tools/          ← registered tool implementations
│   │   ├── alembic/            ← DB migration scripts
│   │   └── requirements.txt
│   └── skills/                 ← example skill assets (not the main skill store)
├── aria-web/
│   ├── src/
│   │   ├── config/api.ts       ← unified API base URL (single source of truth)
│   │   ├── App.tsx             ← routes
│   │   ├── pages/              ← Chat, Dashboard, Login, Projects, Skills, Welcome
│   │   ├── components/         ← Layout, Sidebar, MarkdownRenderer, etc.
│   │   ├── contexts/           ← AuthContext, ThemeContext, ToastContext
│   │   ├── types/              ← TypeScript types & enums
│   │   └── i18n/               ← internationalisation strings
│   └── vite.config.ts          ← Vite proxies /api → http://127.0.0.1:8000
├── screenshots/
└── stitch_ai_prd/              ← UI mockups (HTML + PNG)
```

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Web client | React 19, TypeScript 5.9, Vite 8, React Router 7, i18next |
| Backend | FastAPI, Uvicorn, Python 3.9–3.12 |
| ORM | SQLModel |
| Database | PostgreSQL |
| LLM providers | Anthropic Claude, Kimi (OpenAI-compatible), BigModel (Zhipu AI) |
| RAG | fastembed + cosine similarity (baseline) |
| File generation | python-pptx, python-docx, openpyxl, reportlab |
| Scheduler | APScheduler |
| Secret storage | keyring |

---

## 4. Backend — Key Files

Read in this order to understand the backend:

1. `AriaAI/backend/main.py` — entry point, startup hooks, router registration
2. `AriaAI/backend/app/config.py` — **all** configuration (env-driven)
3. `AriaAI/backend/app/models/db.py` — **all** data models
4. `AriaAI/backend/app/services/context_builder.py` — chat context assembly
5. `AriaAI/backend/app/routers/chat.py` — SSE streaming, message persistence

### Routers (one per domain)

| File | Prefix | Responsibility |
|---|---|---|
| `auth.py` | `/auth` | Login, token management, user CRUD |
| `chat.py` | `/chat` | Conversations, SSE streaming, message history |
| `projects.py` | `/projects` | Project CRUD, milestones, files, AI suggestions |
| `clients.py` | `/clients` | Client CRM |
| `knowledge.py` | `/knowledge` | Document upload, chunking, embedding, retrieval |
| `skills.py` | `/skills` | Skill CRUD, tool validation, seeding |
| `settings.py` | `/settings` | API key management, app settings |
| `schedules.py` | `/schedules` | Scheduled task CRUD |
| `templates.py` | `/templates` | Template upload and management |
| `artifacts.py` | `/artifacts` | Generated file query and download |

### Services

| File | Responsibility |
|---|---|
| `context_builder.py` | Assembles chat context from Skill, Project, RAG, files |
| `claude.py` | Anthropic SDK wrapper |
| `openai_compat.py` | OpenAI-compatible provider wrapper (Kimi, BigModel) |
| `rag.py` | Document retrieval, embedding, cosine similarity |
| `tool_executor.py` | Dispatches LLM tool calls to registered tools |
| `task_runner.py` | Async execution of scheduled tasks |
| `scheduler.py` | APScheduler start/stop |
| `cache.py` | In-memory TTL cache for settings |
| `parser.py` | Response parsing utilities |

### Tools

All registered tools live in `AriaAI/backend/app/tools/file_generators.py`:

- `generate_ppt` / `generate_ppt_from_skill`
- `generate_docx`
- `generate_xlsx`
- `generate_pdf`
- `save_json`
- `save_text`

---

## 5. Core Data Models (db.py)

| Model | Purpose |
|---|---|
| `User`, `UserToken` | Auth, multi-device token management |
| `Project`, `ProjectFolder`, `ProjectFile` | Project workbench |
| `Milestone`, `ProjectPayment` | Project sub-records |
| `Conversation`, `Message` | Chat history |
| `ClientRecord` | CRM record |
| `KnowledgeDocument`, `DocumentChunk` | RAG pipeline |
| `Skill` | Prompt + tool schema stored per skill |
| `ToolCall`, `GeneratedFile` | Tool execution results |
| `ScheduledTask` | Recurring tasks |
| `Template` | Uploaded templates |
| `Setting` | Runtime key-value store |

---

## 6. Authentication

- All endpoints require `X-Auth-Token` header (except `/auth/login`).
- Token issued at login, invalidated on logout, stored in `UserToken` table.
- Initial admin credentials must be provided via `ADMIN_EMAIL` and `ADMIN_PASSWORD`; no default password is seeded.

---

## 7. Configuration

### Backend (`app/config.py`)

All settings are read from `backend/.env` (or environment variables).  
Key variables:

```
DATABASE_URL          # PostgreSQL connection string; defaults to postgresql://postgres:password@localhost:5432/ariaai
ADMIN_EMAIL / ADMIN_PASSWORD
JWT_SECRET
CORS_ORIGINS          # comma-separated allowed origins
SCHEDULER_ENABLED     # true/false
CLAUDE_API_KEY / KIMI_API_KEY / BIGMODEL_API_KEY
```

Do **not** hardcode values — always go through `config.py`.

### Web (`src/config/api.ts`)

API base URL resolution order:
1. `localStorage.serverUrl`
2. `VITE_API_URL` env variable
3. Default `http://127.0.0.1:8000`

All `axios` calls and the streaming fetch in `Chat.tsx` read from this single module.

---

## 8. Skill System

A Skill is a **database record** (not a file), with:

| Field | Purpose |
|---|---|
| `system_prompt` | LLM system role |
| `user_template` | Pre-filled user message template |
| `tools_definition_json` | Anthropic tool schema (JSON array) |
| `tools_json` | Legacy tool name list (backward-compat) |
| `category` | Free-text category (no strict enum yet) |

Tool schema follows Anthropic format. Use `POST /skills/tools/validate` to check schema, and `POST /skills/{id}/tools/test` to test execution.

---

## 9. Development Workflow

```bash
# Backend
cd AriaAI/backend
./start.sh            # starts uvicorn on :8000

# Web
cd aria-web
npm install
npm run dev           # starts Vite on :5173, proxies /api to :8000

# macOS
cd AriaAI
swift run
```

---

## 10. Production Deployment Protocol

The default production release path is GitHub Actions, not manual SSH.

Source of truth:
- Workflow: `.github/workflows/deploy.yml`
- Workflow name: `Deploy to Production`
- Triggers: push to `main` / `master`, or manual `workflow_dispatch`
- Secrets: `SERVER_HOST`, `SERVER_USER`, `SERVER_PASSWORD`, `SERVER_PORT`

Agent rules:

1. After committing and pushing to `main` or `master`, check the GitHub Actions run first.
2. Do not SSH into the server to publish while the Actions run is queued or in progress.
3. Treat a successful Actions run as the deployment result, then verify the site and backend.
4. Use manual SSH deployment only when Actions failed, Actions did not trigger, the user explicitly asks for manual publish, or there is an emergency hotfix with explicit user approval.
5. If manual SSH is used, say clearly that it is a manual fallback and not the normal release path.
6. Never confuse the server Git checkout state with the deployed runtime state; the workflow copies built frontend assets and backend files.

Useful checks:

```bash
gh run list --repo guoliang1114-boop/AriaAI --workflow deploy.yml --limit 5
curl -fsS https://aria.d2cgo.co/
curl -fsS https://aria.d2cgo.co/api/health
```

See `DEPLOY.md` for the canonical deployment protocol. Deployment scripts, nginx config, SSL setup, and backup are all in `deploy/`.

---

## 11. Agent Collaboration Protocol

When multiple LLM agents work on this codebase simultaneously, follow these rules:

### Ownership boundaries

| Domain | Owner agent |
|---|---|
| Backend routers & models | Backend agent |
| Backend services | Backend agent |
| Web pages & components | Frontend agent |
| Web types & i18n | Frontend agent |
| Web client | Frontend agent |
| Database migrations | Backend agent (coordinate with Frontend on type changes) |
| Documentation in `docs/` | Any agent, but update after code changes |

### Communication conventions

- **Do not duplicate work.** If you are unsure whether another agent is working on a module, check git status or the active task list first.
- **Single source of truth per layer:**
  - Types: `app/models/db.py` (backend) is authoritative; `src/types/` (web) must mirror it.
  - Config: `app/config.py` is authoritative for backend; `src/config/api.ts` for web.
  - Enums: backend defines values; frontend maps them to display labels.
- **When changing a data model**, update: `db.py` → migration → TypeScript types → affected pages.
- **When changing an API endpoint**, update: router → `api.ts` or `APIClient.swift` → affected pages.

### Commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(chat): add message reactions
fix(web): correct mojibake in enums.ts
refactor(backend): extract provider selector from chat.py
docs: update architecture diagram for RAG changes
```

### What NOT to do

- Do not hardcode API keys, URLs, or secrets. Always use `config.py` / `.env`.
- Do not commit `backend/data/` (uploads). It is gitignored.
- Do not modify `alembic/versions/` without running `alembic revision --autogenerate` first.
- Do not add `console.log` or `print` debug statements to committed code.
- Do not refactor code that is outside the scope of your current task.

---

## 12. Where to Find More Context

| Question | Read |
|---|---|
| Full system architecture | `docs/00-项目总览.md` §3 |
| Product vision & roadmap | `docs/01-产品战略方向.md` |
| Skill system | `docs/02-Skill体系.md` |
| How to build a Skill | `docs/03-Skill标准化规范.md` |
| RAG upgrade plan | `docs/04-RAG演进方案.md` |
| Chat system design | `docs/05-对话系统设计与规范.md` |
| HITAS tool approval | `docs/06-Human-in-the-Loop Tool Approval 设计.md` |
| Backend entry point | `AriaAI/backend/main.py` |
| All config values | `AriaAI/backend/app/config.py` |
| All data models | `AriaAI/backend/app/models/db.py` |
| Web API base config | `aria-web/src/config/api.ts` |
