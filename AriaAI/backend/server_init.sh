#!/bin/bash
# ============================================================
# AriaAI — 宝塔服务器初始化脚本
# 在服务器上运行（上传 backend 目录后执行）
# 用法：bash server_init.sh
# ============================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── 配置 ──────────────────────────────────────────────────────
DEPLOY_DIR="/www/wwwroot/ariaai"   # 宝塔网站目录（aria.d2cgo.co）
API_PORT=8000
ADMIN_EMAIL="admin@d2cgo.com"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?Set ADMIN_PASSWORD before running}"
DATABASE_URL="${DATABASE_URL:-sqlite:///./data/ariaai.db}"

echo ""
echo "  AriaAI 宝塔初始化"
echo "  部署目录：$DEPLOY_DIR"
echo ""

# ── 确认目录存在 ──────────────────────────────────────────────
[ -d "$DEPLOY_DIR" ] || error "目录不存在：$DEPLOY_DIR\n请先在宝塔文件管理器上传 backend 目录到该路径"

cd "$DEPLOY_DIR"

# ── Python 版本检查 ───────────────────────────────────────────
PYTHON=$(which python3.11 2>/dev/null || which python3.10 2>/dev/null || which python3.9 2>/dev/null || which python3 2>/dev/null)
[ -z "$PYTHON" ] && error "未找到 python3，请在宝塔「软件商店」安装 Python 3.9+"
PY_VERSION=$($PYTHON --version 2>&1)
info "Python：$PY_VERSION ($PYTHON)"

# ── 创建虚拟环境 ──────────────────────────────────────────────
if [ ! -d ".venv" ]; then
    info "创建虚拟环境..."
    $PYTHON -m venv .venv
fi

PIP=".venv/bin/pip"
UVICORN=".venv/bin/uvicorn"

# ── 安装依赖 ──────────────────────────────────────────────────
info "安装依赖（首次较慢，请耐心等待）..."
$PIP install --upgrade pip -q
$PIP install -r requirements.txt -q
info "依赖安装完成"

# ── 创建数据目录 ──────────────────────────────────────────────
mkdir -p data
info "数据目录：$DEPLOY_DIR/data"

# ── 写入环境变量文件 ──────────────────────────────────────────
cat > .env << EOF
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD
API_PORT=$API_PORT
DATABASE_URL=$DATABASE_URL
EOF
info "环境变量文件已写入 .env"

# ── 写入启动脚本（宝塔守护进程用） ───────────────────────────
cat > start_server.sh << EOF
#!/bin/bash
cd $DEPLOY_DIR
export \$(cat .env | xargs)
exec .venv/bin/uvicorn main:app \\
    --host 0.0.0.0 \\
    --port \${API_PORT:-8000} \\
    --workers 2 \\
    --log-level info \\
    --no-access-log
EOF
chmod +x start_server.sh
info "启动脚本：$DEPLOY_DIR/start_server.sh"

# ── 测试能否启动（快速验证） ──────────────────────────────────
info "验证服务可启动..."
timeout 8 .venv/bin/uvicorn main:app \
    --host 127.0.0.1 --port 18999 \
    --workers 1 --log-level error &
UVPID=$!
sleep 4
HTTP=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18999/health 2>/dev/null || echo "000")
kill $UVPID 2>/dev/null || true
wait $UVPID 2>/dev/null || true

if [ "$HTTP" = "200" ]; then
    info "服务验证通过 ✓"
else
    warn "验证返回 $HTTP，请检查依赖是否完整"
fi

# ── 完成提示 ──────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  初始化完成！下一步在宝塔面板操作："
echo ""
echo "  【1】添加守护进程"
echo "       宝塔 → 软件商店 → 守护进程（Supervisor）→ 添加守护进程"
echo "       名称：ariaai"
echo "       启动命令：bash $DEPLOY_DIR/start_server.sh"
echo "       运行目录：$DEPLOY_DIR"
echo "       日志文件：$DEPLOY_DIR/data/server.log"
echo ""
echo "  【2】添加 Nginx 反向代理（可选，需要域名）"
echo "       宝塔 → 网站 → 选择站点 → 反向代理 → 添加反向代理"
echo "       代理名称：ariaai-api"
echo "       目标 URL：http://127.0.0.1:$API_PORT"
echo ""
echo "  【3】放行防火墙端口（直接 IP 访问时）"
echo "       宝塔 → 安全 → 放行端口 $API_PORT"
echo ""
echo "  默认管理员账号："
echo "       邮箱：$ADMIN_EMAIL"
echo "       密码：$ADMIN_PASSWORD"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
