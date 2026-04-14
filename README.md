# AriaAI

面向咨询团队的 AI 工作台。

当前仓库的主工作形态已经是 Web + FastAPI：
- 前端：`aria-web`，React + TypeScript + Vite
- 后端：`AriaAI/backend`，FastAPI + SQLModel + Alembic
- 数据库：PostgreSQL 为默认方案

## 快速启动

### 后端

```powershell
cd C:\Users\Administrator\AP\AriaAI\AriaAI\backend
.\start.ps1
```

或在 Linux/macOS：

```bash
cd AriaAI/backend
./start.sh
```

默认数据库连接已切到 PostgreSQL：

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ariaai
```

首次切换数据库或拉取新迁移后，建议执行：

```bash
cd AriaAI/backend
source .venv/bin/activate
alembic upgrade head
```

### 前端

```powershell
cd C:\Users\Administrator\AP\AriaAI\aria-web
npm install
npm run dev
```

生产校验：

```powershell
cd C:\Users\Administrator\AP\AriaAI\aria-web
npm run build
```

## 当前核心能力

- 统一认证与用户管理
- 多项目工作台与项目详情页
- 项目聊天、流式输出、对话导出
- 项目文档工作区
  - Markdown 文档树
  - 咨询售前模板初始化
  - 新建、重命名、删除、编辑、预览、AI 润色
- 项目待办
  - 指派负责人
  - 截至日期
  - “我的待办”跨项目聚合
- 客户管理与客户详情
- 知识库上传、向量化、RAG 检索
- 项目级知识范围隔离
  - 当前项目
  - 当前客户
  - 全局知识库
- 技能、模板、调度任务、生成文件

## 仓库结构

```text
AriaAI/
├─ README.md
├─ docs/
│  ├─ 00-项目总览.md
│  ├─ 01-产品设计文档.md
│  ├─ 02-Skill开发指南.md
│  ├─ 03-代码问题清单.md
│  ├─ 04-产品方向建议.md
│  ├─ 04-网页版本开发计划.md
│  ├─ 05-技术建议.md
│  ├─ 06-当前架构图.md
│  └─ 07-RAG演进方案.md
├─ AriaAI/
│  ├─ backend/
│  └─ skills/
└─ aria-web/
```

## 推荐先读

1. [docs/00-项目总览.md](docs/00-项目总览.md)
2. [docs/06-当前架构图.md](docs/06-当前架构图.md)
3. [AriaAI/backend/POSTGRESQL.md](AriaAI/backend/POSTGRESQL.md)

## 当前注意事项

- 线上部署默认应使用 PostgreSQL，不建议继续依赖 SQLite。
- 数据库迁移需要显式执行 `alembic upgrade head`。
- 仓库内仍有少量历史文档与文案编码问题，已逐步清理，但不保证全部完成。
- `AriaAI/backend/app/routers/projects.py` 和 `aria-web/src/pages/projects/ProjectDetail.tsx` 仍然偏大，是后续持续拆分的重点。
