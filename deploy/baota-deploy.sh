#!/bin/bash
# AriaAI 宝塔面板一键部署脚本
# 使用方式: bash baota-deploy.sh

set -e

echo "======================================"
echo "AriaAI 宝塔面板部署脚本"
echo "======================================"

# 配置项（可修改）
DOMAIN="your-domain.com"  # 修改为你的域名
BACKEND_PORT=8000
DB_NAME="ariaai"
DB_USER="ariaai_user"
DB_PASSWORD="$(openssl rand -base64 32)"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@$DOMAIN}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 24)}"

# 颜色输出
red() { echo -e "\033[31m$1\033[0m"; }
green() { echo -e "\033[32m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }

# 检查是否在宝塔环境
if [ ! -d "/www/server/panel" ]; then
    red "错误: 未检测到宝塔面板，请先安装宝塔"
    exit 1
fi

# 获取项目路径
PROJECT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_PATH"

green "项目路径: $PROJECT_PATH"

# ===========================================
# 1. 安装依赖
# ===========================================
yellow "[1/6] 检查并安装依赖..."

# 检查 Python3
if ! command -v python3 &> /dev/null; then
    red "未安装 Python3，正在安装..."
    yum install -y python3 python3-pip || apt-get install -y python3 python3-pip
fi

# 检查 Node.js
if ! command -v node &> /dev/null; then
    yellow "未安装 Node.js，使用宝塔面板安装..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs || yum install -y nodejs
fi

# 安装 PM2（用于管理后端进程）
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

green "依赖检查完成"

# ===========================================
# 2. 准备数据目录
# ===========================================
yellow "[2/6] 准备数据目录..."

mkdir -p "$PROJECT_PATH/backend/data"
green "数据目录已准备: $PROJECT_PATH/backend/data"

# ===========================================
# 3. 配置后端
# ===========================================
yellow "[3/6] 配置后端服务..."

cd "$PROJECT_PATH/backend"

# 创建虚拟环境
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi

source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt -q

# 创建生产环境配置文件
cat > .env << EOF
# 生产环境配置
DATABASE_URL=postgresql://postgres:password@localhost:5432/ariaai
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD

# CORS 配置
CORS_ORIGINS=https://$DOMAIN,http://$DOMAIN

# 功能开关
ENABLE_BIGMODEL=true
ENABLE_RAG=true
ENABLE_FILE_GENERATION=true
SCHEDULER_ENABLED=true

# 日志级别
LOG_LEVEL=WARNING
EOF

green "后端配置完成"

# ===========================================
# 4. 配置前端
# ===========================================
yellow "[4/6] 构建前端..."

cd "$PROJECT_PATH/web"

# 安装依赖
npm install -q

# 创建生产环境配置
cat > .env.production << EOF
VITE_API_URL=https://$DOMAIN/api
EOF

# 构建
npm run build

green "前端构建完成"

# ===========================================
# 5. 宝塔网站配置
# ===========================================
yellow "[5/6] 配置宝塔网站..."

# 创建网站目录
WEB_DIR="/www/wwwroot/$DOMAIN"
mkdir -p "$WEB_DIR"

# 复制前端构建文件
cp -r "$PROJECT_PATH/web/dist"/* "$WEB_DIR/"

# 设置权限
chown -R www:www "$WEB_DIR"
chmod -R 755 "$WEB_DIR"

green "网站目录: $WEB_DIR"

cat > "$WEB_DIR/.htaccess" << 'EOF'
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /
  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>
EOF

green "宝塔网站配置完成"

# ===========================================
# 6. 启动后端服务
# ===========================================
yellow "[6/6] 启动后端服务..."

cd "$PROJECT_PATH/backend"

# 使用 PM2 启动后端
pm2 delete ariaai-backend 2>/dev/null || true

pm2 start "uvicorn main:app --host 127.0.0.1 --port $BACKEND_PORT" \
    --name ariaai-backend \
    --interpreter ./.venv/bin/python \
    --cwd "$PROJECT_PATH/backend"

# 保存 PM2 配置
pm2 save
pm2 startup systemd 2>/dev/null || true

green "后端服务已启动"

# ===========================================
# 7. 生成 Nginx 配置
# ===========================================
yellow "生成 Nginx 配置..."

NGINX_CONF="/www/server/panel/vhost/nginx/$DOMAIN.conf"

cat > "$NGINX_CONF" << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    # 前端静态文件
    location / {
        root $WEB_DIR;
        index index.html index.htm;
        try_files \$uri \$uri/ /index.html;
    }
    
    # 后端 API 代理
    location /api {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # SSE 支持
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
    
    # 上传文件大小限制
    client_max_body_size 100M;
}
EOF

# 测试并重载 Nginx
nginx -t && systemctl reload nginx

green "Nginx 配置完成"

# ===========================================
# 完成
# ===========================================
echo ""
echo "======================================"
green "AriaAI 部署完成！"
echo "======================================"
echo ""
yellow "访问地址: http://$DOMAIN"
echo ""
echo "默认管理员账号:"
echo "  邮箱: $ADMIN_EMAIL"
echo "  密码: 已写入 $PROJECT_PATH/backend/.env"
echo ""
echo "数据库信息:"
echo "  数据库: $DB_NAME"
echo "  用户名: $DB_USER"
echo "  密码: $DB_PASSWORD"
echo ""
echo "配置文件:"
echo "  后端: $PROJECT_PATH/backend/.env"
echo ""
echo "管理命令:"
echo "  查看后端日志: pm2 logs ariaai-backend"
echo "  重启后端: pm2 restart ariaai-backend"
echo "  停止后端: pm2 stop ariaai-backend"
echo ""
echo "宝塔面板操作:"
echo "  1. 登录宝塔面板"
echo "  2. 网站 -> 找到 $DOMAIN -> 设置"
echo "  3. SSL -> 申请 Let's Encrypt 证书（推荐）"
echo "  4. 保存即可自动配置 HTTPS"
echo ""
