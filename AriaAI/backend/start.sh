#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Local development default: SQLite in the repo. Production should override via env.
export DATABASE_URL="${DATABASE_URL:-sqlite:///./data/ariaai.db}"

is_windows_bash() {
    case "${OSTYPE:-}" in
        msys*|cygwin*|win32*) return 0 ;;
    esac

    case "$(uname -s 2>/dev/null || echo "")" in
        MINGW*|MSYS*|CYGWIN*) return 0 ;;
    esac

    return 1
}

run_host_python() {
    if is_windows_bash && command -v py >/dev/null 2>&1; then
        for version in -3.12 -3.11 -3.10 -3.9 -3; do
            if py "$version" --version >/dev/null 2>&1; then
                py "$version" "$@"
                return
            fi
        done
    elif command -v python3.12 >/dev/null 2>&1; then
        python3.12 "$@"
    elif command -v python3.11 >/dev/null 2>&1; then
        python3.11 "$@"
    elif command -v python3.10 >/dev/null 2>&1; then
        python3.10 "$@"
    elif command -v python3.9 >/dev/null 2>&1; then
        python3.9 "$@"
    elif command -v python3 >/dev/null 2>&1; then
        python3 "$@"
    elif command -v python >/dev/null 2>&1; then
        python "$@"
    else
        echo "Python not found. Please install Python 3 first." >&2
        exit 1
    fi
}

if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    run_host_python -m venv .venv
fi

if is_windows_bash; then
    PYTHON=".venv/Scripts/python.exe"
    PIP=".venv/Scripts/pip.exe"
else
    PYTHON=".venv/bin/python3"
    PIP=".venv/bin/pip"
fi

if [ ! -x "$PYTHON" ]; then
    echo "Virtual environment Python not found at $PYTHON" >&2
    echo "If you are on Windows, please run this script from Git Bash or recreate .venv." >&2
    exit 1
fi

PYTHON_VERSION="$("$PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
case "$PYTHON_VERSION" in
    3.9|3.10|3.11|3.12) ;;
    *)
        echo "Current .venv uses Python $PYTHON_VERSION." >&2
        echo "This backend currently requires Python 3.9-3.12 because fastembed==0.4.2 is incompatible with newer versions." >&2
        echo "Delete .venv and rerun this script after installing Python 3.12." >&2
        exit 1
        ;;
esac

echo "Using Python: $PYTHON"
if ! "$PYTHON" -c "import uvicorn, fastapi, sqlmodel" >/dev/null 2>&1; then
    echo "Installing backend dependencies..."
    "$PYTHON" -m pip install --upgrade pip -q
    "$PIP" install -r requirements.txt -q
fi

echo "Starting AriaAI API on http://127.0.0.1:8000"
echo "Database: $DATABASE_URL"
if is_windows_bash; then
    echo "Reload: disabled on Windows by default (set ARIAAI_RELOAD=1 to enable)"
    if [ "${ARIAAI_RELOAD:-0}" = "1" ]; then
        "$PYTHON" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
    else
        "$PYTHON" -m uvicorn main:app --host 127.0.0.1 --port 8000
    fi
else
    "$PYTHON" -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
fi
