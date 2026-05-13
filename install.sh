#!/usr/bin/env bash
# Storyplay — one-command installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/favstats/storyplay/main/install.sh | bash
#
# Or, if you've already cloned the repo:
#   ./install.sh

set -euo pipefail

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; BOLD=$'\033[1m'; RESET=$'\033[0m'
say()  { printf "%s%s%s\n" "$GREEN" "$*" "$RESET"; }
warn() { printf "%s%s%s\n" "$YELLOW" "$*" "$RESET" >&2; }
fail() { printf "%s%s%s\n" "$RED" "$*" "$RESET" >&2; exit 1; }

REPO="${STORYPLAY_REPO:-https://github.com/favstats/storyplay.git}"
DEST="${STORYPLAY_DIR:-$HOME/storyplay}"

# ─── prerequisites ─────────────────────────────────────────────────
need() { command -v "$1" >/dev/null 2>&1 || fail "missing required tool: $1"; }

say "▸ Checking prerequisites…"
need git
need python3
PY_MAJOR=$(python3 -c 'import sys;print(sys.version_info.major)')
PY_MINOR=$(python3 -c 'import sys;print(sys.version_info.minor)')
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 10 ]; }; then
  fail "Storyplay needs Python 3.10 or newer (you have ${PY_MAJOR}.${PY_MINOR})."
fi
say "  ✓ git, python3 ${PY_MAJOR}.${PY_MINOR}"

# ─── clone (or reuse) ──────────────────────────────────────────────
if [ -d "$DEST/.git" ]; then
  say "▸ Reusing existing checkout at $DEST"
  git -C "$DEST" pull --ff-only || warn "  pull failed; continuing with local state"
else
  if [ -e "$DEST" ]; then
    fail "$DEST exists but isn't a git checkout. Move it aside or set STORYPLAY_DIR."
  fi
  say "▸ Cloning into $DEST"
  git clone --depth 1 "$REPO" "$DEST"
fi

cd "$DEST"

# ─── fetch demo books + art (idempotent) ───────────────────────────
say "▸ Fetching demo books and curated art (one-time)…"
python3 tools/setup-demos.py || warn "  setup-demos.py reported some failures — check output above"

# ─── start the server ──────────────────────────────────────────────
say "▸ Launching Storyplay"
say "  The library will open in your browser. Ctrl-C in the terminal to stop."
exec ./start.sh
