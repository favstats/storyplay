#!/bin/bash
# Storyplay launcher — starts the local server and opens the library.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-7878}"

# kill any prior instance on this port
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "Port $PORT in use; killing previous Storyplay server..."
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 0.5
fi

echo "Storyplay running at http://localhost:$PORT/"
echo "Ctrl-C to stop."

# open browser shortly after server starts
( sleep 0.6 && open "http://localhost:$PORT/" ) &

exec python3 serve.py "$PORT"
