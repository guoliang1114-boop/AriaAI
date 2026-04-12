#!/bin/bash
# AriaAI 自动部署脚本
# 在服务器上执行此脚本完成部署

set -e  # 遇到错误立即退出

echo "========================================"
echo "AriaAI 自动部署脚本"
echo "========================================"

# 配置
PROJECT_DIR="/www/wwwroot/AriaAI"
BACKEND_DIR="$PROJECT_DIR/AriaAI/AriaAI/backend"
FRONTEND_DIR="$PROJECT_DIR/aria-web/dist"
NGINX_ROOT="/www/wwwroot/aria.d2cgo.co"
PM2_APP_NAME="ariaai-backend"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查目录是否存在
if [ ! -d "$BACKEND_DIR" ]; then
    log_error "后端目录不存在: $BACKEND_DIR"
    exit 1
fi

# 1. 更新代码（如果是手动执行）
if [ "$1" == "--git-pull" ]; then
    log_info "从 Git 拉取最新代码..."
    cd $PROJECT_DIR
    git pull origin main || git pull origin master
fi

# 2. 部署前端
deploy_frontend() {
    log_info "部署前端..."
    
    if [ ! -d "$FRONTEND_DIR" ]; then
        log_error "前端构建目录不存在: $FRONTEND_DIR"
        log_info "请先在本地构建前端: cd aria-web && npm run build"
        exit 1
    fi
    
    # 备份当前版本
    if [ -d "$NGINX_ROOT" ] && [ "$(ls -A $NGINX_ROOT)" ]; then
        BACKUP_DIR="/www/wwwroot/backups/aria-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$BACKUP_DIR"
        cp -r $NGINX_ROOT/* "$BACKUP_DIR/" 2>/dev/null || true
        log_info "已备份当前版本到: $BACKUP_DIR"
    fi
    
    # 清空并复制新文件
    rm -rf $NGINX_ROOT/*
    cp -r $FRONTEND_DIR/* $NGINX_ROOT/
    
    # 设置权限
    chown -R www:www $NGINX_ROOT
    
    log_info "前端部署完成"
}

# 3. 部署后端
deploy_backend() {
    log_info "部署后端..."
    
    cd $BACKEND_DIR
    
    # 检查虚拟环境
    if [ ! -d ".venv" ]; then
        log_warn "虚拟环境不存在，正在创建..."
        python3 -m venv .venv
    fi
    
    # 激活虚拟环境
    source .venv/bin/activate
    
    # 升级 pip
    pip install --upgrade pip
    
    # 安装/更新依赖
    if [ -f "requirements.txt" ]; then
        log_info "安装依赖..."
        pip install -r requirements.txt
    fi
    
    # 检查 .env 文件
    if [ ! -f ".env" ]; then
        log_warn ".env 文件不存在，请检查环境变量配置"
    fi
    
    # 检查 PM2 配置
    if [ ! -f "ecosystem.config.js" ]; then
        log_warn "ecosystem.config.js 不存在"
    fi
    
    log_info "后端部署完成"
}

# 4. 数据库迁移（可选）
migrate_database() {
    if [ "$1" == "--migrate" ]; then
        log_info "执行数据库迁移..."
        cd $BACKEND_DIR
        source .venv/bin/activate
        
        if [ -f "migrate_fix.py" ]; then
            python migrate_fix.py
        else
            log_warn "迁移脚本不存在，跳过"
        fi
    fi
}

# 5. 重启服务
restart_services() {
    log_info "重启服务..."
    
    # 重启 PM2
    if pm2 list | grep -q "$PM2_APP_NAME"; then
        log_info "重启 PM2 服务: $PM2_APP_NAME"
        pm2 reload $PM2_APP_NAME --update-env
    else
        log_info "启动 PM2 服务: $PM2_APP_NAME"
        cd $BACKEND_DIR
        pm2 start ecosystem.config.js
    fi
    
    # 保存 PM2 配置
    pm2 save
    
    # 重启 Nginx
    log_info "重启 Nginx..."
    nginx -t && nginx -s reload
    
    log_info "服务重启完成"
}

# 6. 健康检查
health_check() {
    log_info "执行健康检查..."
    
    # 检查后端 API
    for i in {1..5}; do
        if curl -s http://127.0.0.1:8000/health > /dev/null 2>&1 || \
           curl -s http://127.0.0.1:8000/api/health > /dev/null 2>&1 || \
           curl -s http://127.0.0.1:8000/ > /dev/null 2>&1; then
            log_info "后端服务运行正常"
            break
        fi
        if [ $i -eq 5 ]; then
            log_warn "后端服务可能未正常启动，请检查日志: pm2 logs"
        else
            sleep 2
        fi
    done
    
    # 检查前端
    if curl -s -o /dev/null -w "%{http_code}" https://aria.d2cgo.co | grep -q "200\|301\|302"; then
        log_info "前端网站可访问"
    else
        log_warn "前端网站可能无法访问"
    fi
}

# 主流程
main() {
    log_info "开始部署..."
    
    deploy_frontend
    deploy_backend
    migrate_database "$1"
    restart_services
    health_check
    
    echo ""
    echo "========================================"
    log_info "🎉 部署完成!"
    echo "========================================"
    echo ""
    echo "访问地址:"
    echo "  前端: https://aria.d2cgo.co"
    echo "  后端: https://aria.d2cgo.co/api/"
    echo ""
    echo "常用命令:"
    echo "  查看日志: pm2 logs ariaai-backend"
    echo "  重启后端: pm2 restart ariaai-backend"
    echo "  查看状态: pm2 status"
    echo ""
}

# 显示帮助
show_help() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --git-pull     部署前先从 Git 拉取最新代码"
    echo "  --migrate      同时执行数据库迁移"
    echo "  --help         显示此帮助"
    echo ""
    echo "示例:"
    echo "  $0                          # 标准部署"
    echo "  $0 --git-pull               # 拉取代码后部署"
    echo "  $0 --migrate                # 部署并执行数据库迁移"
    echo "  $0 --git-pull --migrate     # 完整部署流程"
}

# 解析参数
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    show_help
    exit 0
fi

# 执行主流程
main "$@"
