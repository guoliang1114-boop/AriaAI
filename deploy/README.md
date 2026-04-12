# AriaAI 部署文档

本目录包含 AriaAI 项目的部署相关文件。

## 文件说明

| 文件 | 说明 |
|------|------|
| `AUTO_DEPLOY.md` | 完整的自动部署配置指南 |
| `deploy.sh` | 服务器端部署脚本 |
| `setup-server.sh` | 新服务器初始化脚本 |
| `.env.example` | 环境变量配置模板 |

## 快速导航

- 🚀 **自动部署**: 查看 [AUTO_DEPLOY.md](./AUTO_DEPLOY.md)
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
