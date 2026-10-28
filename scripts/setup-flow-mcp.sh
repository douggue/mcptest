#!/usr/bin/env bash
# Clones and builds GTAI-1/flow-mcp into ./flow-mcp so .mcp.json can launch it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/flow-mcp"

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone https://github.com/GTAI-1/flow-mcp.git "$DIR"
fi

cd "$DIR"
npm install
npm run build

echo
echo "flow-mcp built at $DIR/dist/index.js"
echo "Next: run 'npm --prefix \"$DIR\" run login' once to sign into Google Flow,"
echo "then restart Claude Code in this folder and approve the 'flow' server."
