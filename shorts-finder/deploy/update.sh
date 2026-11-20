#!/usr/bin/env bash
# Brings Shorts finder on the server up to date: fetch the new code, install
# what it needs, restart. Run as root from anywhere:
#
#   sudo /opt/shorts-finder/deploy/update.sh
#
# The service copies its store by itself before changing the store's shape.
# Not yet run on a real server: see deploy/README.md.
set -euo pipefail

readonly APP_DIR="/opt/shorts-finder"
readonly SERVICE="shorts-finder"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this with sudo: sudo ${APP_DIR}/deploy/update.sh" >&2
  exit 1
fi

project_dir="$(readlink -f "${APP_DIR}")"
cd "${project_dir}"

echo "1/4 Fetching the new code"
git pull --ff-only

echo "2/4 Stopping the service"
systemctl stop "${SERVICE}"

echo "3/4 Installing what the code needs"
npm ci --omit=dev --no-audit --no-fund

echo "4/4 Installing the service files and starting"
install -m 644 deploy/shorts-finder.service "/etc/systemd/system/${SERVICE}.service"
install -m 644 deploy/shorts-finder-backup.service "/etc/systemd/system/${SERVICE}-backup.service"
install -m 644 deploy/shorts-finder-backup.timer "/etc/systemd/system/${SERVICE}-backup.timer"
install -m 755 deploy/shorts-finder-cli.sh /usr/local/bin/shorts-finder
systemctl daemon-reload
systemctl start "${SERVICE}"

sleep 5
if systemctl is-active --quiet "${SERVICE}"; then
  echo "Shorts finder is running. Its last lines:"
else
  echo "Shorts finder did not stay running. Its last lines say why:" >&2
fi
journalctl -u "${SERVICE}" -n 10 --no-pager
