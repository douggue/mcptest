#!/bin/sh
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
command -v codex >/dev/null || { echo "Install the Codex CLI first." >&2; exit 1; }
if [ "${1:-}" = "--app" ]; then
  [ "$#" = 2 ] || { echo 'Usage: sh scripts/install-plugin.sh [--app /path/JGcut.app]' >&2; exit 1; }
  REACUT_APP="$2" python3 "$task_root/plugin/scripts/launch.py" --check
  python3 - "$2" <<'PY'
import json, pathlib, sys
app = pathlib.Path(sys.argv[1]).expanduser().resolve()
if not app.exists(): raise SystemExit('JGcut application path does not exist')
config = pathlib.Path.home() / '.config/reacut/plugin.json'
config.parent.mkdir(parents=True, exist_ok=True)
config.write_text(json.dumps({'app': str(app)}, ensure_ascii=False) + '\n')
PY
elif [ "$#" != 0 ]; then
  echo 'Usage: sh scripts/install-plugin.sh [--app /path/JGcut.app]' >&2; exit 1
fi
python3 "$task_root/plugin/scripts/launch.py" --check
codex plugin marketplace add "$task_root" --json
codex plugin add reacut@reacut-local --json
printf '%s\n' 'JGcut plugin installed. Reconnect or open a new Codex chat, then ask: 用 JGcut 在右侧打开视频编辑器。'
