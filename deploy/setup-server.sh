#!/bin/bash
# AriaAI 服务器初始化脚本
# 在新服务器上运行此脚本完成环境配置

set -e

echo "========================================"
echo "AriaAI 服务器初始化脚本"
echo "========================================"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then 
    log_error "请使用 root 用户运行此脚本"
    exit 1
fi

# 1. 安装基础依赖
log_info "安装基础依赖..."
yum update -y
yum install -y git nginx python3 python3-pip nodejs npm

# 2. 配置 Nginx
log_info "配置 Nginx..."

cat > /etc/nginx/conf.d/aria.d2cgo.co.conf << 'EOF'
server {
    listen 80;
    server_name aria.d2cgo.co;
    root /www/wwwroot/aria.d2cgo.co;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    client_max_body_size 100M;
}
EOF

nginx -t && systemctl restart nginx
systemctl enable nginx

# 3. 安装 PM2
log_info "安装 PM2..."
npm install -g pm2

# 4. 创建项目目录
log_info "创建项目目录..."
mkdir -p /www/wwwroot/aria.d2cgo.co
mkdir -p /www/wwwroot/backups
mkdir -p /www/wwwroot/AriaAI

# 5. 配置 GitHub Actions 部署用户（可选）
log_info "配置部署用户..."

# 创建部署用户
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    log_info "创建用户: deploy"
fi

# 设置目录权限
chown -R deploy:deploy /www/wwwroot/AriaAI
chown -R www:www /www/wwwroot/aria.d2cgo.co

# 6. 配置 SSH（如果使用密钥部署）
log_info "SSH 配置说明..."
echo ""
echo "如果需要使用 SSH 密钥部署，请执行以下操作："
echo ""
echo "1. 在本地生成密钥对："
echo "   ssh-keygen -t ed25519 -C \"github-actions\""
echo ""
echo "2. 将公钥添加到服务器："
echo "   ssh-copy-id -i ~/.ssh/id_ed25519.pub root@你的服务器IP"
echo ""
echo "3. 在 GitHub 添加私钥："
echo "   Settings → Secrets → SSH_PRIVATE_KEY"
echo ""

# 7. 防火墙配置
log_info "配置防火墙..."
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --permanent --add-service=ssh
firewall-cmd --reload

# 8. 创建部署脚本快捷方式
log_info "创建快捷命令..."

cat > /usr/local/bin/aria-deploy << 'EOF'
#!/bin/bash
cd /www/wwwroot/AriaAI && bash deploy/deploy.sh "$@"
EOF

chmod +x /usr/local/bin/aria-deploy

# 9. 环境检查
log_info "环境检查..."

echo ""
echo "安装版本:"
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo "  Python: $(python3 --version)"
echo "  PM2: $(pm2 --version)"
echo "  Nginx: $(nginx -v 2>&1 | head -1)"

echo ""
echo "========================================"
log_info "服务器初始化完成!"
echo "========================================"
echo ""
echo "下一步操作:"
echo ""
echo "1. 克隆代码仓库:"
echo "   cd /www/wwwroot/AriaAI"
echo "   git clone https://github.com/你的用户名/AriaAI.git ."
echo ""
echo "2. 配置环境变量:"
echo "   cd /www/wwwroot/AriaAI/backend"
echo "   cp ../deploy/.env.example .env"
echo "   # 编辑 .env 文件填写配置"
echo ""
echo "3. 初始化后端:"
echo "   python3 -m venv .venv"
echo "   source .venv/bin/activate"
echo "   pip install -r requirements.txt"
echo ""
echo "4. 配置 PM2:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 startup"
echo ""
echo "5. 部署命令:"
echo "   aria-deploy              # 标准部署"
echo "   aria-deploy --git-pull   # 拉取代码后部署"
echo ""
echo "详细文档: DEPLOY.md"
echo ""
