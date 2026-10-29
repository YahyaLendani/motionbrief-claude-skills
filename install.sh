#!/usr/bin/env bash
#
# Install the motionbrief skill into a Claude config directory.
# Works on macOS, Linux, WSL and git-bash. For Windows PowerShell use install.ps1.
#
#   bash install.sh                 -> ~/.claude   (every project)
#   bash install.sh --project       -> ./.claude   (this project only)
#   bash install.sh --target DIR    -> DIR         (explicit Claude home)
#   bash install.sh --dry-run       -> print what would happen
#
# Re-running replaces a previous install.

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
SKILL_NAME="motionbrief"

MODE="global"
TARGET=""
DRY_RUN=0

usage() {
  cat <<'USAGE'
Install the motionbrief skill into a Claude config directory.

  bash install.sh                 -> ~/.claude   (every project)
  bash install.sh --project       -> ./.claude   (this project only)
  bash install.sh --target DIR    -> DIR         (explicit Claude home)
  bash install.sh --dry-run       -> print what would happen
  bash install.sh --help          -> this text

Environment:
  CLAUDE_HOME   overrides the default ~/.claude target

Works on macOS, Linux, WSL and git-bash.
On Windows PowerShell, use:  .\install.ps1
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      MODE="project"
      shift
      ;;
    --target)
      if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
        echo "install: --target needs a directory" >&2
        exit 2
      fi
      TARGET="$2"
      MODE="explicit"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "install: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  project)  CLAUDE_HOME="$(pwd)/.claude" ;;
  explicit) CLAUDE_HOME="$TARGET" ;;
  *)        CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}" ;;
esac

SKILL_SRC="$REPO_DIR/skills/$SKILL_NAME"
CMD_SRC="$REPO_DIR/.claude/commands/motion.md"
SKILL_DST="$CLAUDE_HOME/skills/$SKILL_NAME"
CMD_DST="$CLAUDE_HOME/commands/motion.md"

if [ ! -f "$SKILL_SRC/SKILL.md" ]; then
  echo "install: skill source not found at $SKILL_SRC" >&2
  echo "         run this script from a clone of the repository." >&2
  exit 1
fi

# --- platform detection ---------------------------------------------------

case "$(uname -s 2>/dev/null || echo unknown)" in
  Darwin)                 OS="macos" ;;
  Linux)                  OS="linux" ;;
  MINGW*|MSYS*|CYGWIN*)   OS="windows" ;;
  *)                      OS="unknown" ;;
esac

ffmpeg_hint() {
  case "$OS" in
    macos)   echo "            brew install ffmpeg" ;;
    linux)   echo "            sudo apt install ffmpeg     # or your distro's package manager" ;;
    windows) echo "            winget install --id Gyan.FFmpeg -e" ;;
    *)       echo "            install ffmpeg from https://ffmpeg.org/download.html" ;;
  esac
}

echo "motionbrief installer"
echo "  from    $REPO_DIR"
echo "  into    $CLAUDE_HOME"
echo "  system  ${OS}"
echo ""

if [ "$DRY_RUN" -eq 1 ]; then
  echo "  would copy $SKILL_SRC -> $SKILL_DST"
  echo "  would copy $CMD_SRC   -> $CMD_DST"
  exit 0
fi

mkdir -p "$CLAUDE_HOME/skills" "$CLAUDE_HOME/commands"
rm -rf "$SKILL_DST"
cp -R "$SKILL_SRC" "$SKILL_DST"
cp "$CMD_SRC" "$CMD_DST"

# Never ship engine caches from a local run.
find "$SKILL_DST" -type d \( -name .hyperframes -o -name renders \) -prune -exec rm -rf {} + 2>/dev/null || true

echo "  installed skill    $SKILL_DST"
echo "  installed command  $CMD_DST"
echo ""

# --- dependency checks ----------------------------------------------------

if command -v node >/dev/null 2>&1; then
  echo "  node      $(node --version)"
else
  echo "  node      MISSING - install Node 18 or newer"
  echo "            https://nodejs.org"
fi

if command -v ffmpeg >/dev/null 2>&1; then
  echo "  ffmpeg    $(ffmpeg -version 2>/dev/null | head -n 1 | cut -d' ' -f1-3)"
else
  echo "  ffmpeg    MISSING - needed to render with HyperFrames"
  ffmpeg_hint
  echo "            (lint, check and snapshot work without it)"
fi

if command -v npx >/dev/null 2>&1; then
  echo "  npx       $(npx --version 2>/dev/null || echo present)"
else
  echo "  npx       MISSING - ships with Node and npm"
fi

echo ""
echo "Done. Restart Claude Code, then:"
echo "  /motion a 10 second launch video for a note-taking app"
