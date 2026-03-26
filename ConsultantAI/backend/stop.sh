#!/bin/bash

# Stop Aria AI Backend
# Usage: ./stop.sh

echo "🛑 Stopping Aria AI Backend..."

# Find and kill uvicorn processes
UVICORN_PIDS=$(pgrep -f "uvicorn main:app" 2>/dev/null)

if [ -n "$UVICORN_PIDS" ]; then
    echo "Found uvicorn processes: $UVICORN_PIDS"
    echo "$UVICORN_PIDS" | xargs kill -TERM 2>/dev/null
    sleep 2
    
    # Force kill if still running
    UVICORN_PIDS_LEFT=$(pgrep -f "uvicorn main:app" 2>/dev/null)
    if [ -n "$UVICORN_PIDS_LEFT" ]; then
        echo "Force killing remaining processes..."
        echo "$UVICORN_PIDS_LEFT" | xargs kill -KILL 2>/dev/null
    fi
    
    echo "✅ Backend stopped"
else
    echo "ℹ️  No backend process found"
fi

# Also check port 8000
PORT_PID=$(lsof -ti:8000 2>/dev/null)
if [ -n "$PORT_PID" ]; then
    echo "Killing process on port 8000: $PORT_PID"
    kill -TERM $PORT_PID 2>/dev/null
    sleep 1
    kill -KILL $PORT_PID 2>/dev/null
fi

echo "Done"
