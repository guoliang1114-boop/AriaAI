# AriaAI

AriaAI 是面向咨询、售前与交付团队的 AI 协作工作台。当前仓库已经进入“下一版本迭代准备”阶段，主线不再是补基础页面，而是把项目记忆、客户记忆、Skill 工作流、后台任务治理和部署可靠性做成稳定产品能力。

## 技术栈

- 前端：`aria-web`，React 19 + TypeScript + Vite
- 后端：`AriaAI/backend`，FastAPI + SQLModel + Alembic
- 数据库：PostgreSQL
- 调度：APScheduler
- AI 能力：多模型配置、项目/客户上下文、RAG、工具调用、Skill 模板

## 快速启动

后端：

```bash
cd AriaAI/backend
./start.sh
```

前端：

```bash
cd aria-web
npm install
npm run dev
```

生产构建校验：

```bash
cd aria-web
npm run build
```

数据库迁移治理：

在部署或更新代码后，使用以下命令管理数据库迁移：

- `report`: 查看当前迁移状态
- `ensure`: 确保数据库模式和 Alembic 状态正确
- `upgrade`: 升级数据库到最新迁移
- `check`: 检查是否有待处理的迁移

```bash
cd AriaAI/backend
python scripts/migration_governance.py report
python scripts/migration_governance.py ensure
python scripts/migration_governance.py upgrade
python scripts/migration_governance.py check
```

## 当前核心能力

- 项目工作台：概览、聊天、记忆、笔记、待办、里程碑、财务、文档、设置。
- 项目聊天：SSE 流式输出、项目/客户/全局知识范围、RAG 引用、工具调用、生成物卡片、Skill 入口。
- 项目记忆：结构化项目记忆、多视角摘要、摘要缓存、预热、槽位编辑、手动刷新、任务队列。
- 客户记忆：客户级长期记忆、跨项目沉淀、手动提升、归档自动沉淀、多视角摘要、客户记忆页。
- 统一任务治理：项目/客户记忆任务统一面板、失败分类、失败明细、重试、预算、告警汇总。
- 迁移治理：Alembic revision 检测、短号 alias 修复、部署脚本接入、设置页迁移状态。
- Settings：AI、用户、服务器、语言、项目记忆、客户记忆、Memory Operations、Migration Status。

## 推荐先读

1. [项目总览](docs/00-项目总览.md) — 定位、架构、能力、记忆系统
2. [产品战略方向](docs/01-产品战略方向.md) — 护城河、北极星场景
3. [Skill 体系](docs/02-Skill体系.md) — Skill 运行链路与当前能力
4. [Skill 标准化规范](docs/03-Skill标准化规范.md) — Skill 新增与维护流程
5. [RAG 演进方案](docs/04-RAG演进方案.md) — RAG 现状、风险与路线
6. [对话系统设计与规范](docs/05-对话系统设计与规范.md) — 对话系统架构与设计
7. [HITAS 设计](docs/06-Human-in-the-Loop%20Tool%20Approval%20设计.md) — 高风险工具审批
8. [向 Codex 学习的产品建议](docs/07-向Codex学习的产品建议.md) — 产品机制借鉴

## 当前注意事项

- 每次部署前优先跑 `migration_governance.py report/check`，再执行 `ensure/upgrade`。
- 线上当前使用 PostgreSQL 数据库。
- `Memory Operations` 是后续排查记忆任务、预算、失败和重试的首选入口。
- `docs/` 文档已重新编号为 00-07，后续新增文档请保持连续编号。
