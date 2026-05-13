#!/usr/bin/env bash
# Storyplay launcher — starts the local server and opens the library.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-7878}"

if ! command -v python3 >/dev/null 2>&1; then
  printf "\033[31mPython 3 is required but not found.\033[0m\n" >&2
  printf "Install it from https://www.python.org/downloads/ and try again.\n" >&2
  exit 1
fi

# kill any prior instance on this port
if command -v lsof >/dev/null 2>&1 && lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "Port $PORT in use; killing previous Storyplay server…"
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 0.5
fi

# auto-build the library index if it's missing
if [ ! -f library.json ]; then
  echo "First run — building library index…"
  python3 tools/build-library.py || true
fi

printf "\033[32m\n  Storyplay running at http://localhost:%s/\033[0m\n" "$PORT"
echo "  Ctrl-C to stop."
echo

# open browser shortly after server starts (Mac / Linux / Windows-Git-Bash)
( sleep 0.6
  if command -v open >/dev/null 2>&1; then open "http://localhost:$PORT/"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$PORT/" >/dev/null 2>&1
  elif command -v start >/dev/null 2>&1; then start "http://localhost:$PORT/"
  fi
) &

exec python3 serve.py "$PORT"
