# AriaAI GitHub 自动部署指南

更新日期：2026-04-15

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
4. 通过 SCP 上传 `web/dist` 和 `backend`
5. 通过 SSH 在服务器执行部署脚本
6. 服务器完成以下动作
   - 激活后端虚拟环境
   - `pip install -r requirements.txt`
   - `python3 scripts/ensure_db.py`
   - `alembic upgrade head`
   - `pm2 reload ariaai-backend --update-env`
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
python3 scripts/ensure_db.py
alembic upgrade head
```

这两步的目标是：

1. 先修复历史迁移状态问题
2. 再把数据库结构升级到最新版本

注意：迁移失败应视为部署失败，而不是可以忽略的警告。

## 7. 一次发布实际上做了什么

当你执行：

```bash
git push origin main
```

实际会发生：

### 7.1 GitHub Actions 侧

1. 拉取最新代码
2. 使用 Node 20 构建前端
3. 使用 Python 3.11 安装后端依赖

### 7.2 服务器侧

1. 上传最新前端构建产物和后端代码
2. 激活 `.venv`
3. 安装依赖
4. 执行数据库修复和迁移
5. reload PM2
6. 覆盖前端站点目录
7. reload Nginx

## 8. 发布后最小检查

每次自动部署完成后，至少检查：

1. `/auth/me`
2. `/projects`
3. `/clients`
4. `/knowledge/documents`
5. 任意一个项目详情页
6. 任意一个项目待办页

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

建议登录服务器检查：

```bash
cd /www/wwwroot/AriaAI/backend
source .venv/bin/activate
alembic current
alembic upgrade head
```

### 9.3 自动部署后迁移报“表已存在”或“列已存在”

这通常表示：

1. 数据库真实结构已经更新
2. 但 `alembic_version` 落后

处理顺序：

1. 先确认真实表结构
2. 再执行对应版本的 `alembic stamp ...`
3. 然后重新执行 `alembic upgrade head`

例如：

```bash
alembic stamp 004_v1_4
alembic upgrade head
```

### 9.4 GitHub Actions 没有触发

优先检查：

1. 是否真的推送到了远端 `main` 或 `master`
2. 仓库 Actions 是否启用
3. `deploy.yml` 是否有语法错误
4. GitHub App / 仓库权限是否限制了 workflow 执行

## 10. 自动部署失败时的手动补救

自动部署失败时，目标不是重走整套手动部署，而是补齐失败的那一步。

最常见的补救动作：

```bash
cd /www/wwwroot/AriaAI/backend
source .venv/bin/activate
pip install -r requirements.txt
python3 scripts/ensure_db.py
alembic upgrade head
pm2 reload ariaai-backend --update-env

cd /www/wwwroot/AriaAI/web
cp -r dist/* /www/wwwroot/aria.d2cgo.co/
nginx -t && nginx -s reload
```

## 11. 建议保留的运维习惯

1. 每次推送后看一次 GitHub Actions 日志
2. 每次数据库相关改动后关注迁移输出
3. 每次部署后做最小接口健康检查
4. 如果 `deploy.yml` 改动了，同步更新本文档

## 12. 一句话原则

`发布动作以 GitHub Actions 为准，数据库迁移成功与否是部署是否真正成功的关键判断点。`
