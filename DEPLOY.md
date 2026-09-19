# AriaAI GitHub 自动部署指南

更新日期：2026-09-20

当前项目的主部署方式是：

`push 到 GitHub -> GitHub Actions 自动部署到服务器`

本文档以仓库中的真实工作流为准：
- `.github/workflows/deploy.yml`

不再把手动部署作为主路径说明。

## 1. 当前部署结构

当前自动部署链路包括以下步骤：

1. GitHub Actions 检出代码
2. Actions 本地构建前端
3. Actions 准备后端依赖
4. 通过 SCP 上传 `web/dist`、`backend` 和 `skills`
5. 通过 SSH 在服务器执行部署脚本
6. 服务器完成以下动作
   - 激活后端虚拟环境
   - 安装 `requirements.txt` 和 `requirements-test.txt`
   - 校验 Skill manifest，将多余旧包移入可恢复归档
   - 只读核对生产 PostgreSQL，使用独立 SQLite 文件运行后端聚焦回归
   - 执行确定性对话质量门与离线知识检索评测，合成测试固定 hash Provider
   - 创建并校验 PostgreSQL 备份（`verified_postgres_backup.py`）
   - 按 `migration_governance.py report / ensure / upgrade / check` 治理迁移
   - 输出无正文的记忆/知识读取权威报告
   - 通过 PM2 重建进程并核对后端健康
   - 同步前端静态文件到站点目录
   - `nginx -t && nginx -s reload`

## 2. 触发方式

当前工作流触发条件：

```yaml
on:
  push:
    branches: [main, master]
  workflow_dispatch:
```

也就是说，以下动作都会触发部署：

1. 推送到 `main`
2. 推送到 `master`
3. 在 GitHub Actions 页面手动触发

## 3. 关键工作流文件

主部署文件：
- `.github/workflows/deploy.yml`

辅助文件：
- `.github/workflows/test-secrets.yml`
- `.github/workflows/production-db-e2e.yml`：经备份后在严格隔离 PostgreSQL schema 中回归，并核对生产 public 状态。
- `.github/workflows/provider-grounded-qa-eval.yml`：对已部署代码运行真实 Provider 合成资料评测。
- `.github/workflows/knowledge-semantic-eval.yml`：对已部署代码预热并评测本地语义模型，不修改生产检索配置或业务索引。

部署、数据库 E2E、数据库恢复和语义预检共用 `production-database-maintenance` 并发组，`cancel-in-progress=false`。等待当前操作完成，不能为了抢跑取消备份或迁移中的工作流。

如果部署逻辑发生变化，应优先更新 `deploy.yml`，然后再同步更新本文档。

## 4. GitHub Secrets

当前部署依赖这些 Secrets：

1. `SERVER_HOST`
2. `SERVER_USER`
3. `SERVER_PASSWORD`
4. `SERVER_PORT`

用途：

1. SCP 上传文件
2. SSH 登录服务器执行部署脚本

## 5. 服务器前置条件

自动部署成功的前提是服务器已经完成一次基础初始化。至少需要满足：

1. 项目代码目录存在：`/www/wwwroot/AriaAI`
2. 前端站点目录存在：`/www/wwwroot/aria.d2cgo.co`
3. 后端虚拟环境已创建：`/www/wwwroot/AriaAI/backend/.venv`
4. PM2 中已有 `ariaai-backend` 进程
5. Nginx 已完成站点配置
6. PostgreSQL 可用
7. 后端 `.env` 已配置真实 `DATABASE_URL`

## 6. 当前数据库策略

当前线上数据库默认应为 PostgreSQL。

必须满足：

1. `DATABASE_URL` 指向 PostgreSQL
2. 每次部署都执行数据库迁移

当前工作流中包含：

```bash
.venv/bin/python scripts/verified_postgres_backup.py
.venv/bin/python scripts/migration_governance.py report
.venv/bin/python scripts/migration_governance.py ensure
.venv/bin/python scripts/migration_governance.py upgrade
.venv/bin/python scripts/migration_governance.py check
```

执行前配置可写的备份路径 `BACKUP_PATH`；自动工作流会提供带运行身份的路径。目标是：

1. 先生成经 `pg_restore` 校验的备份并记录 SHA-256
2. 按已验证的迁移治理规则处理历史状态并升级
3. 核对目标 schema 和唯一 Alembic head，再重启应用

注意：迁移失败应视为部署失败，而不是可以忽略的警告。

自动部署会安装 `requirements-test.txt` 中单独锁定的测试依赖，并直接连接服务器现有 PostgreSQL 数据库，用 `current_database()`、`current_schema()` 与 `current_user` 完成只读连通性校验。部署前的聚焦测试只包含纯单元测试及使用隔离 SQLite 的用例，不会把建表、删表或清理数据的测试夹具指向生产库。测试通过后才执行受治理的生产迁移与 PM2 重启。

## 7. 一次发布实际上做了什么

当你执行：

```bash
git push origin main
```

实际会发生：

### 7.1 GitHub Actions 侧

1. 拉取最新代码
2. 使用 Node 24 构建前端，执行全量前端测试与零警告 lint
3. 使用 Python 3.11 安装后端依赖

### 7.2 服务器侧

1. 上传最新前端构建产物和后端代码
2. 激活 `.venv`
3. 安装依赖
4. 在独立 SQLite 文件中运行聚焦回归和质量门
5. 校验备份、执行迁移治理和只读权威报告
6. 重建 PM2 后端进程并确认 `/health` 成功
7. 覆盖前端站点目录
8. reload Nginx

## 8. 发布后最小检查

每次自动部署完成后，至少检查：

先核对 `Deploy to Production` 的 `headSha` 与本次发布 commit 一致、结果为 success，再检查站点和 `/api/health`。服务器 Git checkout 不代表实际复制运行的代码；健康响应的静态版本号也不能证明 commit。

1. `/auth/me`
2. `/projects`
3. `/clients`
4. `/knowledge/documents`
5. 任意一个项目详情页
6. 任意一个项目待办页

读取业务接口使用现有原生账号与权限，不把 token 写入 URL 或验收文档。新发布版本再运行 `Production Database E2E` 和 `Provider Grounded QA Eval`；两者测试的是服务器当前文件，必须等待对应部署完成后触发。语义检索另运行 `Knowledge Semantic Eval`，以输出的脚本 SHA-256 核对部署文件。

语义模型预检只下载模型权重、写模型缓存并使用临时内存 SQLite 测试。启用配置和文档 reindex 是后续独立动作，遵循 [语义检索指南](docs/24-知识语义检索与质量验收.md) 和 Aria 原生授权/HITAS；小型合成评测不能替代真实业务语料验收。

## 9. 常见问题

### 9.1 GitHub Actions 成功，但页面异常

优先检查：

1. 前端静态文件是否已复制到 `/www/wwwroot/aria.d2cgo.co`
2. PM2 进程 `ariaai-backend` 是否正常
3. Nginx reload 是否成功

### 9.2 自动部署后接口 500

优先检查数据库迁移。例如：

1. `column knowledgedocument.project_id does not exist`
2. `column projecttodo.due_date does not exist`

这类报错通常表示：

1. 代码已经更新
2. 数据库结构没有同步到最新

先查看 Actions 迁移输出和只读治理报告，不直接试跑迁移覆盖失败证据：

```bash
cd /www/wwwroot/AriaAI/backend
.venv/bin/python scripts/migration_governance.py report
.venv/bin/python -m alembic current
```

### 9.3 自动部署后迁移报“表已存在”或“列已存在”

这通常表示：

1. 数据库真实结构已经更新
2. 但 `alembic_version` 落后

处理顺序：

1. 先确认真实表结构与治理报告
2. 保留已验证备份，确定具体历史状态是否符合治理规则
3. 通过 `migration_governance.py ensure / upgrade / check` 处理；不能猜测 revision 后手工 stamp

### 9.4 GitHub Actions 没有触发

优先检查：

1. 是否真的推送到了远端 `main` 或 `master`
2. 仓库 Actions 是否启用
3. `deploy.yml` 是否有语法错误
4. GitHub App / 仓库权限是否限制了 workflow 执行

## 10. 自动部署失败时的手动补救

自动部署失败时，目标不是重走整套手动部署，而是补齐失败的那一步。

只在 Actions 失败、未触发、用户明确要求手工发布，或明确授权的紧急修复时使用 SSH 发布，并说明这是手动回退。Actions 排队或运行时不并行手工覆盖服务。回退同样需要已验证备份、受治理迁移、健康检查和发布记录；优先修复工作流后重新运行可追踪的发布。

## 11. 建议保留的运维习惯

1. 每次推送后看一次 GitHub Actions 日志
2. 每次数据库相关改动后关注迁移输出
3. 每次部署后做最小接口健康检查
4. 如果 `deploy.yml` 改动了，同步更新本文档

## 12. 一句话原则

`发布动作以 GitHub Actions 为准，数据库迁移成功与否是部署是否真正成功的关键判断点。`
