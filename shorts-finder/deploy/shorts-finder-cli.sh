#!/usr/bin/env bash
# Runs a Shorts finder command on the server as the service's user, with the
# service's settings. Installed as /usr/local/bin/shorts-finder by setup.sh:
#
#   sudo shorts-finder status
#   sudo shorts-finder subjects add "a keyword"
#   sudo shorts-finder subjects list
#   sudo shorts-finder report
#
# Only the SHORTS_ settings are passed on. The API key and the Telegram token
# are not: these commands do not need them.
# Not yet run on a real server: see deploy/README.md.
set -euo pipefail

readonly APP_DIR="/opt/shorts-finder"
readonly ENV_FILE="/etc/shorts-finder/env"
readonly SERVICE_USER="shorts"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this with sudo: sudo shorts-finder $*" >&2
  exit 1
fi

settings=()
if [[ -f "${ENV_FILE}" ]]; then
  mapfile -t settings < <(grep -E '^SHORTS_[A-Z_]+=' "${ENV_FILE}" || true)
fi

cd "${APP_DIR}"
exec runuser -u "${SERVICE_USER}" -- \
  env -i PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  HOME="/var/lib/shorts-finder" "${settings[@]}" \
  node --import tsx src/cli.ts "$@"
