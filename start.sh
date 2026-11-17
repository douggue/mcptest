#!/usr/bin/env bash
# First run installs everything; later runs just start the app.  Usage: ./start.sh [port]
set -e
cd "$(dirname "$0")"
for tool in python3 node npm ffmpeg; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool. Install it first (see README)."; exit 1; }
done
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
while read -r pkg _; do
  case "$pkg" in ""|\#*) continue ;; esac
  pip install "$pkg" >/dev/null 2>&1 || echo "Could not install optional $pkg; that feature stays off."
done < requirements-optional.txt
# after an update: reinstall when package.json changed, rebuild when the interface code changed
node web/stale.cjs install && (cd web && npm install)
node web/stale.cjs build && (cd web && npm run build)
exec python run.py --open --port "${1:-8000}"
