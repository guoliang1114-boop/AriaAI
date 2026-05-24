# AriaAI 部署文档

本目录包含 AriaAI 项目的部署相关文件。

## 文件说明

| 文件 | 说明 |
|------|------|
| `deploy.sh` | 服务器端部署脚本 |
| `setup-server.sh` | 新服务器初始化脚本 |
| `.env.example` | 环境变量配置模板 |
| `baota-deploy.sh` | 宝塔面板部署脚本 |
| `backup.sh` | 数据库备份脚本 |
| `setup_ssl.sh` | SSL 证书配置脚本 |
| `nginx_ariaai.conf` | Nginx 配置文件 |

## 快速导航

- 🚀 **自动部署**: 查看根目录 [DEPLOY.md](../DEPLOY.md)
- 🖥️ **手动部署**: 使用 [deploy.sh](./deploy.sh) 脚本
- ⚙️ **新服务器**: 运行 [setup-server.sh](./setup-server.sh)

## 部署方式

### 方式一：GitHub Actions 自动部署（推荐）

推送代码到 `main` 分支自动触发部署：

```bash
git push origin main
```

### 方式二：手动执行部署脚本

在服务器上执行：

```bash
# 标准部署
bash deploy/deploy.sh

# 拉取最新代码后部署
bash deploy/deploy.sh --git-pull

# 部署并执行数据库迁移
bash deploy/deploy.sh --migrate
```

## 数据库迁移治理

自动部署和手动 `--migrate` 都会优先使用：

```bash
cd AriaAI/backend
python scripts/migration_governance.py report
python scripts/migration_governance.py ensure
python scripts/migration_governance.py upgrade
python scripts/migration_governance.py check
```

动作含义：

- `report`：输出当前数据库模式、当前 revision、最新 revision 和待执行 revision。
- `ensure`：对历史轻量库执行幂等 additive schema guard，并在缺失 `alembic_version` 时安全 stamp。
- `upgrade`：执行 `alembic upgrade head`，并输出前后状态。
- `check`：作为发布保护；Alembic 库仍有 pending revision 或 legacy lightweight 状态会返回非零退出码。

如果发布失败，先查看：

```bash
cd AriaAI/backend
python scripts/migration_governance.py json
```

也可以访问公开健康检查：

```bash
curl https://aria.d2cgo.co/api/health/db/migrations
```

## 配置 GitHub Secrets

在 GitHub 仓库设置中添加以下 Secrets：

- `SSH_HOST`: 服务器 IP 或域名
- `SSH_USER`: SSH 用户名
- `SSH_PASSWORD`: SSH 密码（或使用 `SSH_PRIVATE_KEY`）

## 故障排查

查看后端日志：
```bash
pm2 logs ariaai-backend
```

查看 Nginx 日志：
```bash
tail -f /var/log/nginx/error.log
```

检查服务状态：
```bash
pm2 status
nginx -t
```
