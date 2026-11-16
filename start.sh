#!/usr/bin/env bash
# First run installs everything; later runs just start the app.  Usage: ./start.sh [port]
set -e
cd "$(dirname "$0")"
for tool in python3 node npm ffmpeg; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool. Install it first (see README)."; exit 1; }
done
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
[ -d web/node_modules ] || (cd web && npm install)
[ -f web/dist/index.html ] || (cd web && npm run build)
exec python run.py --open --port "${1:-8000}"
