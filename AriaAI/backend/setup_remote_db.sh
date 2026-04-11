#!/bin/bash
# ============================================================
# AriaAI — 配置远程 PostgreSQL 数据库 (Supabase)
# ============================================================
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step()  { echo -e "${BLUE}[→]${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  AriaAI 远程数据库配置"
echo ""

# 检查 .env 文件
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        step "创建 .env 文件..."
        cp .env.example .env
        warn "请编辑 .env 文件，填入您的数据库密码"
        echo "   文件路径: $SCRIPT_DIR/.env"
        exit 1
    else
        error ".env.example 文件不存在"
    fi
fi

# 检查是否配置了远程数据库
if grep -q "YOUR_PASSWORD_HERE" .env; then
    warn "请先在 .env 文件中设置真实的数据库密码"
    echo "   编辑文件: $SCRIPT_DIR/.env"
    exit 1
fi

# 加载环境变量
export $(grep -v '^#' .env | xargs)

if [ -z "$DATABASE_URL" ]; then
    error "DATABASE_URL 未设置"
fi

if [[ "$DATABASE_URL" == *"sqlite"* ]]; then
    warn "当前配置的是 SQLite，不是远程 PostgreSQL"
    echo "   请修改 .env 中的 DATABASE_URL"
    exit 1
fi

info "数据库配置: ${DATABASE_URL%%:*}://***"
echo ""

# 确保虚拟环境
if [ ! -d ".venv" ]; then
    step "创建虚拟环境..."
    python3 -m venv .venv
fi

source .venv/bin/activate

# 安装依赖
step "检查依赖..."
pip install -q psycopg2-binary 2>/dev/null || pip install -q psycopg2-binary

# 测试连接
step "测试数据库连接..."
python3 test_db.py
if [ $? -ne 0 ]; then
    error "数据库连接失败，请检查 .env 配置"
fi

echo ""
step "初始化数据库表..."
python3 -c "
from app.database import create_db
from app.config import DATABASE_URL
print(f'正在创建表...')
create_db()
print('✅ 表创建完成')
"

echo ""
info "数据库配置完成!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  当前配置:"
echo "    数据库: Supabase PostgreSQL"
echo "    URL: ${DATABASE_URL%%@*}@***${DATABASE_URL##*@}"
echo ""
echo "  启动服务:"
echo "    ./start.sh"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
