#!/bin/bash
# AriaAI Backend — Production Start Script
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create venv if missing
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
fi

PYTHON=".venv/bin/python3"
PIP=".venv/bin/pip"
UVICORN=".venv/bin/uvicorn"

"$PYTHON" -m pip install --upgrade pip -q
echo "Installing dependencies..."
"$PIP" install -r requirements.txt -q

HOST="${API_HOST:-0.0.0.0}"
PORT="${API_PORT:-8000}"
WORKERS="${API_WORKERS:-2}"

echo "Starting AriaAI API on $HOST:$PORT (workers=$WORKERS)"
"$UVICORN" main:app \
    --host "$HOST" \
    --port "$PORT" \
    --workers "$WORKERS" \
    --log-level info \
    --no-access-log
