# AriaAI 自动部署指南

本文档介绍如何配置自动部署，实现代码推送到 GitHub 后自动部署到生产服务器。

## 方案对比

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **GitHub Actions** | 免费、集成好、社区成熟 | 需要配置 Secrets | ⭐⭐⭐⭐⭐ |
| 服务器 Webhook | 实时、自主可控 | 需要暴露端口、安全性配置复杂 | ⭐⭐⭐ |
| 手动部署脚本 | 简单直接 | 需要人工执行 | ⭐⭐⭐⭐ |

本文采用 **GitHub Actions** 方案。

---

## 快速开始

### 1. 配置 GitHub Secrets

在 GitHub 仓库页面 → Settings → Secrets and variables → Actions → New repository secret

添加以下 Secrets：

| Secret 名称 | 说明 | 示例值 |
|------------|------|--------|
| `SSH_HOST` | 服务器 IP 或域名 | `85.137.244.146` |
| `SSH_USER` | SSH 用户名 | `root` |
| `SSH_PASSWORD` | SSH 密码 | `your-password` |
| `SSH_PORT` | SSH 端口（可选）| `22` |

> 💡 建议使用 SSH 密钥替代密码：
> - 生成密钥：`ssh-keygen -t ed25519 -a 200 -C "github-actions"`
> - 公钥添加到服务器的 `~/.ssh/authorized_keys`
> - GitHub 添加 `SSH_PRIVATE_KEY` secret

### 2. 推送配置到 GitHub

```bash
# 添加工作流文件
git add .github/workflows/deploy.yml
git add deploy/
git commit -m "添加自动部署配置"
git push origin main
```

### 3. 触发首次部署

推送代码后会自动触发部署，或手动触发：
- GitHub 仓库 → Actions → Deploy to Production → Run workflow

---

## 手动部署（备用方案）

如果自动部署出现问题，可以使用手动部署脚本：

### 在服务器上执行

```bash
# 1. 进入项目目录
cd /www/wwwroot/AriaAI

# 2. 拉取最新代码
git pull origin main

# 3. 执行部署脚本
bash deploy/deploy.sh --git-pull
```

### 部署脚本选项

```bash
bash deploy/deploy.sh              # 标准部署
bash deploy/deploy.sh --git-pull   # 拉取代码后部署
bash deploy/deploy.sh --migrate    # 部署并执行数据库迁移
```

---

## 目录结构

```
AriaAI/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 配置
├── deploy/
│   ├── deploy.sh               # 服务器端部署脚本
│   ├── .env.example            # 环境变量模板
│   └── AUTO_DEPLOY.md          # 本文件
├── aria-web/                   # 前端代码
│   └── dist/                   # 构建输出
└── AriaAI/backend/             # 后端代码；SCP 后位于 /www/wwwroot/AriaAI/AriaAI/backend
```

---

## 常见问题

### Q: 部署失败如何排查？

1. 查看 GitHub Actions 日志：
   - 仓库 → Actions → 选择失败的运行 → 查看日志

2. 在服务器上检查：
   ```bash
   # 查看 PM2 日志
   pm2 logs ariaai-backend
   
   # 检查后端是否运行
   curl http://127.0.0.1:8000/
   
   # 检查 Nginx
   nginx -t
   ```

### Q: 如何只部署前端或后端？

修改 `.github/workflows/deploy.yml` 中的 `source`：

```yaml
# 只部署前端
source: "aria-web/dist/"

# 只部署后端
source: "AriaAI/backend/"
```

### Q: 如何跳过某些步骤？

在 commit message 中添加：
- `[skip ci]` - 完全跳过 CI/CD
- `[skip deploy]` - 跳过部署（仅构建）

### Q: 如何配置多环境（测试/生产）？

创建多个工作流文件：
- `.github/workflows/deploy-staging.yml` - 测试环境
- `.github/workflows/deploy-production.yml` - 生产环境

使用不同的分支触发：
```yaml
on:
  push:
    branches: [develop]  # 测试环境
```

### Q: SSH 连接失败？

检查服务器：
```bash
# 检查 SSH 服务
systemctl status sshd

# 检查防火墙
firewall-cmd --list-ports

# 检查是否允许密码登录
cat /etc/ssh/sshd_config | grep PasswordAuthentication
```

---

## 安全建议

1. **使用 SSH 密钥而非密码**
   ```bash
   # 生成密钥对
   ssh-keygen -t ed25519 -C "github-actions"
   
   # 复制公钥到服务器
   ssh-copy-id -i ~/.ssh/id_ed25519.pub root@服务器IP
   ```

2. **限制部署用户权限**
   - 创建专门用于部署的用户（非 root）
   - 只赋予必要的目录权限

3. **保护敏感信息**
   - 绝不将密码提交到代码仓库
   - 使用 GitHub Secrets 管理敏感信息

4. **启用分支保护**
   - Settings → Branches → Add rule
   - 要求 PR 审查后才能合并到 main

---

## 优化建议

### 1. 使用 Docker 部署（推荐大型项目）

```yaml
# 构建 Docker 镜像
- name: Build Docker Image
  run: |
    docker build -t ariaai:latest .
    docker save ariaai:latest | gzip > ariaai.tar.gz

# 传输并加载镜像
- name: Deploy Docker
  run: |
    ssh server "docker load < ariaai.tar.gz"
    ssh server "docker-compose up -d"
```

### 2. 添加部署通知

部署完成后发送通知到 Slack/钉钉/企业微信：

```yaml
- name: Notify Slack
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    text: '部署完成!'
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### 3. 添加自动化测试

```yaml
- name: Run Tests
  run: |
    cd aria-web && npm test
    cd ../AriaAI/backend && pytest
```

---

## 参考

- [GitHub Actions 文档](https://docs.github.com/cn/actions)
- [appleboy/scp-action](https://github.com/appleboy/scp-action)
- [appleboy/ssh-action](https://github.com/appleboy/ssh-action)
