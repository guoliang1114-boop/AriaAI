#!/bin/bash
# ============================================================
# AriaAI — 一键部署脚本
# 用法：./deploy.sh [服务器IP或域名]
# 示例：./deploy.sh 192.168.1.100
#       ./deploy.sh api.d2cgo.com
# ============================================================
set -e

# ── 配置（按需修改）────────────────────────────────────────────
SERVER="${1:-your-server-ip}"          # 目标服务器 IP 或域名
SSH_USER="${SSH_USER:-root}"           # SSH 用户名
SSH_PORT="${SSH_PORT:-22}"             # SSH 端口
REMOTE_DIR="/opt/ariaai"              # 服务器上的部署目录
SERVICE_NAME="ariaai"                 # systemd 服务名
API_PORT="${API_PORT:-8000}"           # 后端监听端口
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@d2cgo.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-Admin@d2cgo}"

# ── 颜色输出 ──────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── 参数检查 ──────────────────────────────────────────────────
if [ "$SERVER" = "your-server-ip" ]; then
    error "请传入服务器地址：./deploy.sh 192.168.1.100"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

[ -d "$BACKEND_DIR" ] || error "找不到 backend 目录：$BACKEND_DIR"

SSH="ssh -p $SSH_PORT -o StrictHostKeyChecking=no"
SCP="scp -P $SSH_PORT"

echo ""
echo "  AriaAI 部署脚本"
echo "  目标服务器：$SSH_USER@$SERVER:$SSH_PORT"
echo "  部署路径：  $REMOTE_DIR"
echo "  API 端口：  $API_PORT"
echo "  管理员账号：$ADMIN_EMAIL"
echo ""

# ── Step 1：同步代码 ──────────────────────────────────────────
info "Step 1/4  同步代码到服务器..."
$SSH "$SSH_USER@$SERVER" "mkdir -p $REMOTE_DIR"

rsync -az --delete \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'data/*.db' \
    -e "ssh -p $SSH_PORT -o StrictHostKeyChecking=no" \
    "$BACKEND_DIR/" \
    "$SSH_USER@$SERVER:$REMOTE_DIR/"

info "代码同步完成"

# ── Step 2：安装依赖 ──────────────────────────────────────────
info "Step 2/4  安装 Python 依赖..."
$SSH "$SSH_USER@$SERVER" bash << EOF
    set -e
    cd $REMOTE_DIR
    if [ ! -d ".venv" ]; then
        python3 -m venv .venv
        echo "  虚拟环境已创建"
    fi
    .venv/bin/pip install --upgrade pip -q
    .venv/bin/pip install -r requirements.txt -q
    echo "  依赖安装完成"
EOF
info "依赖安装完成"

# ── Step 3：写入 systemd 服务 ─────────────────────────────────
info "Step 3/4  配置 systemd 服务..."
$SSH "$SSH_USER@$SERVER" bash << EOF
    set -e
    cat > /etc/systemd/system/${SERVICE_NAME}.service << 'UNIT'
[Unit]
Description=AriaAI Backend API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${REMOTE_DIR}
Environment="API_PORT=${API_PORT}"
Environment="ADMIN_EMAIL=${ADMIN_EMAIL}"
Environment="ADMIN_PASSWORD=${ADMIN_PASSWORD}"
ExecStart=${REMOTE_DIR}/.venv/bin/uvicorn main:app --host 0.0.0.0 --port ${API_PORT} --workers 2 --log-level info --no-access-log
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}
    echo "  systemd 服务已配置"
EOF
info "systemd 配置完成"

# ── Step 4：启动/重启服务 ─────────────────────────────────────
info "Step 4/4  启动服务..."
$SSH "$SSH_USER@$SERVER" bash << EOF
    set -e
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        systemctl restart ${SERVICE_NAME}
        echo "  服务已重启"
    else
        systemctl start ${SERVICE_NAME}
        echo "  服务已启动"
    fi
    sleep 2
    systemctl is-active --quiet ${SERVICE_NAME} && echo "  服务状态: 运行中 ✓" || echo "  服务状态: 启动失败 ✗"
EOF

# ── 健康检查 ─────────────────────────────────────────────────
echo ""
info "健康检查..."
sleep 1
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    "http://$SERVER:$API_PORT/health" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    info "健康检查通过 → http://$SERVER:$API_PORT"
else
    warn "健康检查返回 HTTP $HTTP_CODE，请稍等片刻后手动确认"
    warn "查看日志：ssh $SSH_USER@$SERVER 'journalctl -u $SERVICE_NAME -n 50'"
fi

echo ""
echo "  部署完成！"
echo "  API 地址：  http://$SERVER:$API_PORT"
echo "  管理员账号：$ADMIN_EMAIL / $ADMIN_PASSWORD"
echo ""
echo "  常用命令："
echo "    查看日志：ssh $SSH_USER@$SERVER 'journalctl -u $SERVICE_NAME -f'"
echo "    重启服务：ssh $SSH_USER@$SERVER 'systemctl restart $SERVICE_NAME'"
echo "    停止服务：ssh $SSH_USER@$SERVER 'systemctl stop $SERVICE_NAME'"
echo ""
