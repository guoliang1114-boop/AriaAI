#!/bin/bash
# 服务器初始化脚本 - 只需运行一次
# 用法: bash setup-server.sh

echo "========== AriaAI 服务器初始化 =========="

# 配置
DOMAIN="your-domain.com"  # 修改为你的域名
PROJECT_DIR="/www/wwwroot/AriaAI"

# 颜色
green() { echo -e "\033[32m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }

# 1. 安装宝塔插件
yellow "安装必要组件..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

# 2. 创建目录
green "创建项目目录..."
mkdir -p $PROJECT_DIR
mkdir -p /www/wwwroot/$DOMAIN

# 3. 克隆代码
green "克隆代码..."
cd $PROJECT_DIR
git clone https://github.com/guoliang1114-boop/AriaAI.git .

# 4. 配置后端
green "配置后端..."
cd AriaAI/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 创建环境变量
cat > .env << EOF
DATABASE_URL=postgresql://ariaai:your-password@localhost:5432/ariaai
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_EMAIL=admin@$DOMAIN
ADMIN_PASSWORD=Admin@123456
CORS_ORIGINS=https://$DOMAIN
EOF

# 5. 配置前端
green "配置前端..."
cd ../../aria-web
npm install

# 6. 构建前端
green "构建前端..."
npm run build
cp -r dist/* /www/wwwroot/$DOMAIN/

# 7. 启动后端
green "启动后端服务..."
cd ../AriaAI/backend
pm2 start "uvicorn main:app --host 127.0.0.1 --port 8000" \
    --name ariaai-backend \
    --interpreter ./.venv/bin/python

pm2 save
pm2 startup

green "初始化完成！"
echo ""
echo "请完成以下步骤:"
echo "1. 在宝塔面板创建网站: $DOMAIN"
echo "2. 配置反向代理到 127.0.0.1:8000"
echo "3. 在 GitHub 添加 Secrets 实现自动部署"
echo ""
