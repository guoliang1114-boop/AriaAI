# AriaAI 部署指南

## 方式一：Docker 一键部署（推荐 ⭐）

最简单的方式，适合大多数服务器。

### 1. 环境要求
- Docker & Docker Compose
- 服务器内存 >= 2GB

### 2. 快速部署

```bash
# 1. 克隆代码
git clone https://github.com/guoliang1114-boop/AriaAI.git
cd AriaAI

# 2. 启动服务
docker-compose up -d

# 3. 查看状态
docker-compose ps
```

访问 `http://服务器IP`，默认管理员账号：
- 邮箱: `admin@example.com`
- 密码: `admin123`

### 3. 自定义配置

创建 `.env` 文件修改配置：

```bash
# 数据库密码
DB_PASSWORD=your-secure-password

# JWT 密钥
JWT_SECRET=your-random-secret-key

# 管理员账号
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourPassword123
```

然后重启：
```bash
docker-compose down
docker-compose up -d
```

---

## 方式二：宝塔面板部署

适合已有宝塔环境的服务器。

### 1. 准备工作

在宝塔面板安装：
- [x] Nginx
- [x] PostgreSQL 15
- [x] PM2 管理器（Node.js）
- [x] Python 3.11

### 2. 上传代码

```bash
cd /www/wwwroot
git clone https://github.com/guoliang1114-boop/AriaAI.git
```

### 3. 运行部署脚本

```bash
cd AriaAI
cd AriaAI/deploy

# 修改域名
vi baota-deploy.sh
# 修改 DOMAIN="your-domain.com"

# 运行部署
bash baota-deploy.sh
```

### 4. 配置 SSL（可选）

宝塔面板 → 网站 → 选择网站 → SSL → 申请 Let's Encrypt 证书

---

## 方式三：手动部署

### 后端部署

```bash
cd AriaAI/backend

# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 编辑 .env 配置数据库等

# 启动
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 前端部署

```bash
cd aria-web

# 安装依赖
npm install

# 构建
npm run build

# 将 dist 目录部署到 Nginx/Apache
```

---

## 常见问题

### 1. 端口冲突

修改 `docker-compose.yml` 中的端口映射：
```yaml
ports:
  - "8080:80"  # 改为 8080 端口
```

### 2. 数据库连接失败

检查数据库配置是否正确：
```bash
# 查看日志
docker-compose logs db
docker-compose logs backend
```

### 3. 文件上传失败

确保上传目录有写入权限：
```bash
chmod -R 777 uploads/
```

### 4. 内存不足

添加 Swap：
```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
```

---

## 更新部署

### Docker 方式

```bash
cd AriaAI

# 拉取最新代码
git pull

# 重新构建
docker-compose down
docker-compose up -d --build
```

### 宝塔方式

```bash
cd /www/wwwroot/AriaAI
git pull

# 前端重新构建
cd aria-web
npm install
npm run build
cp -r dist/* /www/wwwroot/your-domain/

# 后端重启
pm2 restart ariaai-backend
```

---

## 备份与恢复

### 备份数据库

```bash
# Docker 方式
docker exec ariaai-db pg_dump -U ariaai ariaai > backup.sql

# 宝塔方式
pg_dump -U ariaai_user ariaai > backup.sql
```

### 恢复数据库

```bash
# Docker 方式
docker exec -i ariaai-db psql -U ariaai ariaai < backup.sql
```

---

## 生产环境建议

1. **使用 HTTPS**：申请 SSL 证书
2. **修改默认密码**：首次登录后修改管理员密码
3. **配置防火墙**：只开放 80/443 端口
4. **定期备份**：数据库和上传文件
5. **监控资源**：使用 PM2/Docker 监控服务状态

---

有问题请提交 Issue 或联系支持。
