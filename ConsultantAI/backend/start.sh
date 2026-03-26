#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 生产环境数据库配置
export DATABASE_URL="postgresql://postgres:4LsPEyLFeaj3ZdAy@85.137.244.146/aria"

# Create venv if missing
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
fi

PYTHON=".venv/bin/python3"
PIP=".venv/bin/pip"
UVICORN=".venv/bin/uvicorn"

# Upgrade pip silently
"$PYTHON" -m pip install --upgrade pip -q

# Install deps
echo "Installing dependencies..."
"$PIP" install -r requirements.txt -q

echo "Starting ConsultantAI API on http://127.0.0.1:8000"
echo "Database: $DATABASE_URL"
"$UVICORN" main:app --host 127.0.0.1 --port 8000 --reload
