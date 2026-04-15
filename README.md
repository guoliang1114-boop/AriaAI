# AriaAI

面向咨询团队的 AI 协作工作台。

当前仓库的主工作形态已经明确为：
- 前端：`aria-web`，React + TypeScript + Vite
- 后端：`AriaAI/backend`，FastAPI + SQLModel + Alembic
- 数据库：PostgreSQL

## 快速启动

### 后端

```powershell
cd C:\Users\Administrator\AP\AriaAI\AriaAI\backend
.\start.ps1
```

Linux / macOS:

```bash
cd AriaAI/backend
./start.sh
```

默认数据库连接：

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ariaai
```

首次切换数据库或拉取新迁移后，先执行：

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

生产构建校验：

```powershell
cd C:\Users\Administrator\AP\AriaAI\aria-web
npm run build
```

## 当前核心能力

- 统一认证与用户管理
- 项目工作台与项目详情页
- 项目聊天
  - 流式输出
  - 标题生成
  - Markdown / PDF 导出
  - 项目级上下文注入
- 项目文档工作区
  - 左侧 Markdown 文档树
  - 右侧编辑 / 预览 / 分栏
  - 咨询类售前模板初始化
  - 新建、重命名、删除
  - AI 润色，含流式输出
- 项目待办
  - 指派负责人
  - 截止日期
  - 仪表盘“我的待办”聚合
- 客户管理与客户详情
- 知识库上传、向量化与 RAG 检索
- 项目级知识范围隔离
  - 仅当前项目
  - 当前客户
  - 全局知识库
- Skills、模板、调度任务、生成文件

## 仓库结构

```text
AriaAI/
├─ README.md
├─ docs/
├─ AriaAI/
│  ├─ backend/
│  │  ├─ app/
│  │  ├─ alembic/
│  │  └─ POSTGRESQL.md
│  └─ skills/
└─ aria-web/
   └─ src/
```

## 推荐先读

1. [docs/00-项目总览.md](docs/00-项目总览.md)
2. [docs/06-当前架构图.md](docs/06-当前架构图.md)
3. [docs/03-代码问题清单.md](docs/03-代码问题清单.md)
4. [AriaAI/backend/POSTGRESQL.md](AriaAI/backend/POSTGRESQL.md)

## 当前注意事项

- 线上默认应使用 PostgreSQL，不建议继续依赖 SQLite。
- 每次部署新代码后，都应执行 `alembic upgrade head`。
- 近期项目域能力增长很快，`AriaAI/backend/app/routers/projects.py` 和 `aria-web/src/pages/projects/ProjectDetail.tsx` 仍是复杂度中心。
- 仓库里仍有少量历史中文编码污染，功能可用，但值得继续治理。
