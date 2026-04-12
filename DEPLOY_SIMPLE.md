# AriaAI 极简自动部署方案

> 提交代码到 GitHub → 自动部署到服务器

## 方案概述

只需要 **2 步** 配置，之后每次 `git push` 自动部署：

1. 服务器运行初始化脚本（一次）
2. GitHub 添加 3 个 Secrets

---

## 第一步：服务器初始化

在宝塔服务器上执行：

```bash
# 1. 下载初始化脚本
cd /www/wwwroot
curl -O https://raw.githubusercontent.com/guoliang1114-boop/AriaAI/main/deploy/setup-server.sh

# 2. 修改配置（填入你的域名）
vi setup-server.sh
# 修改: DOMAIN="your-domain.com"

# 3. 运行
bash setup-server.sh
```

这会自动：
- ✅ 安装 PM2
- ✅ 克隆代码
- ✅ 配置后端环境
- ✅ 构建前端
- ✅ 启动服务

---

## 第二步：GitHub 配置自动部署

### 1. 获取服务器信息

需要以下信息：
- `SERVER_HOST`: 服务器 IP 或域名
- `SERVER_USER`: 用户名（通常是 `root`）
- `SERVER_PASSWORD`: 服务器密码
- `DOMAIN`: 网站域名

### 2. 添加 Secrets

进入 GitHub 仓库 → Settings → Secrets and variables → Actions → New repository secret

添加以下 4 个 Secrets：

| Name | Value | 说明 |
|------|-------|------|
| `SERVER_HOST` | `1.2.3.4` | 服务器 IP |
| `SERVER_USER` | `root` | SSH 用户名 |
| `SERVER_PASSWORD` | `your-password` | SSH 密码 |
| `DOMAIN` | `your-domain.com` | 网站域名 |

![添加 Secrets 图示](https://docs.github.com/assets/cb-60049/images/help/repository/actions-secrets.png)

---

## 完成！🎉

现在每次提交代码到 `main` 分支，**自动部署到服务器**：

```bash
git add .
git commit -m "更新功能"
git push origin main   # ← 自动触发部署
```

部署过程可以在 GitHub 仓库 → Actions 中查看：

![Actions 图示](https://docs.github.com/assets/images/help/repository/actions-tab.png)

---

## 手动部署（备用）

如果自动部署失败，可以手动执行：

```bash
ssh root@你的服务器IP
cd /www/wwwroot/AriaAI
git pull

# 后端
cd AriaAI/backend
source .venv/bin/activate
pip install -r requirements.txt
pm2 restart ariaai-backend

# 前端
cd ../../aria-web
npm install
npm run build
cp -r dist/* /www/wwwroot/你的域名/
```

---

## 常见问题

### Q: 部署失败怎么排查？

查看 GitHub Actions 日志：
1. 进入 GitHub 仓库
2. 点击 Actions 标签
3. 点击失败的 workflow
4. 查看具体报错

### Q: 如何停止自动部署？

删除 `.github/workflows/deploy.yml` 文件，或禁用 Actions：
Settings → Actions → General → Disable Actions

### Q: 使用密钥而不是密码？

修改 `.github/workflows/deploy.yml`：
```yaml
with:
  host: ${{ secrets.SERVER_HOST }}
  username: ${{ secrets.SERVER_USER }}
  key: ${{ secrets.SSH_PRIVATE_KEY }}  # 替换 password 行
```

然后添加 Secret：`SSH_PRIVATE_KEY` = 服务器私钥内容

---

## 安全建议

1. **使用密钥而非密码**（更安全）
2. **限制服务器 IP 访问**（防火墙配置）
3. **定期更换密钥/密码**

---

搞定！现在享受丝滑的自动部署体验吧 🚀
