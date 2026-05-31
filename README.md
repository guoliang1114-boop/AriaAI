# AriaAI

AriaAI is an open-source agentic workspace for professional knowledge work.

It explores how AI systems can work with long-lived project memory, client context, reusable skills, knowledge workflows, human-in-the-loop approvals, and auditable agent runs. The goal is not to build another SaaS dashboard or a generic chatbot, but to prototype an AI-native workspace where professional teams can turn context into reliable delivery.

中文简介：

AriaAI 是一个面向专业知识工作的开源 Agentic Workspace。它关注的不是单次聊天，而是 AI 如何长期理解用户、项目、客户、知识与交付过程，并把这些能力组织成可追踪、可复用、可沉淀的工作系统。

## Why This Exists

Most AI tools still treat work as isolated prompts. Real professional work is different:

- projects have history, risk, files, tasks, and delivery constraints;
- clients have long-term preferences, decision patterns, and relationship context;
- teams need reusable methods, not just one-off answers;
- important AI actions need review, traceability, and rollback paths;
- knowledge needs to become part of a workflow, not just a search result.

AriaAI is an open experiment in this direction: an AI-native workspace with memory, skills, knowledge retrieval, tool use, and human approval as first-class product concepts.

## Core Capabilities

- **Project memory**: structured project context, progress, risks, open questions, delivery signals, and generated summaries.
- **Client memory**: long-term client context across projects, including reusable lessons, preferences, and relationship signals.
- **Agentic chat**: project-aware and workspace-aware chat with streaming output, tool calls, RAG context, and generated artifacts.
- **Skill workflows**: reusable professional workflows for briefing, strategy, analysis, document generation, and consulting delivery.
- **Knowledge workflows**: document ingestion, retrieval, source-aware context, and future integration with project/client memory.
- **Human-in-the-loop approvals**: server-side pending actions for high-risk write/delete/update operations.
- **Run harness direction**: a design path toward auditable AI runs with steps, tools, artifacts, approvals, and memory updates.

## Architecture

```text
AriaAI
  ├─ web/                 React 19 + TypeScript + Vite
  ├─ backend/             FastAPI + SQLModel + Alembic
  ├─ skills/              reusable Skill packages and method prompts
  ├─ docs/                product, architecture, memory, Skill, and harness design
  └─ .github/             workflows and contribution templates
```

Technology stack:

- Frontend: React 19, TypeScript, Vite, React Router, Tailwind CSS, i18next
- Backend: FastAPI, SQLModel, Alembic
- Database: PostgreSQL, with SQLite-compatible development paths
- AI: model provider configuration, project/client context, RAG, tools, and Skill prompts
- Runtime: APScheduler, SSE streaming, migration governance, task monitoring

## Quick Start

Backend:

```bash
cd backend
./start.sh
```

Frontend:

```bash
cd web
npm install
npm run dev
```

Production build check:

```bash
cd web
npm run build
```

Database migration governance:

```bash
cd backend
python scripts/migration_governance.py report
python scripts/migration_governance.py ensure
python scripts/migration_governance.py upgrade
python scripts/migration_governance.py check
```

## Documentation

Recommended reading path:

1. [Project Overview](docs/00-项目总览.md)
2. [Product Strategy](docs/01-产品战略方向.md)
3. [Skill System](docs/02-Skill体系.md)
4. [Skill Standardization](docs/03-Skill标准化规范.md)
5. [RAG Evolution](docs/04-RAG演进方案.md)
6. [Conversation System](docs/05-对话系统设计与规范.md)
7. [Human-in-the-Loop Tool Approval](docs/06-Human-in-the-Loop%20Tool%20Approval%20设计.md)
8. [Architecture and Chat Logic](docs/07-AriaAI架构与对话逻辑图.md)
9. [Skill Roadmap](docs/08-Skill体系评估与优化路线图.md)
10. [Skill Authoring Guide](docs/09-Skill编写规范.md)
11. [Model + Harness Product Design](docs/11-Model-Harness产品方案设计.md)
12. [Memory System Optimization](docs/12-记忆系统优化方案.md)
13. [Knowledge Base Development Plan](docs/14-V0.0.5知识库开发方案.md)
14. [Agentic Workspace Upgrade Design](docs/18-Agentic%20Workspace升级功能设计说明书.md)

## Project Status

AriaAI is under active development. The repository is currently focused on:

- making the project and client memory layers reliable;
- turning Skills into delivery-oriented workflows;
- building a first-class knowledge base;
- improving the AI Run / Harness model;
- making the workspace usable for real professional delivery.

The codebase moves quickly, so some docs describe near-term design direction rather than completed implementation.

## Contributing

Contributions, issues, and design discussions are welcome. Good first areas:

- documentation improvements;
- Skill authoring examples;
- frontend polish and accessibility;
- tests for chat, memory, knowledge, and Skill workflows;
- backend reliability, migration, and task governance.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution guide.

## License

AriaAI is released under the [MIT License](LICENSE).
