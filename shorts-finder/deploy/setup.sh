#!/usr/bin/env bash
# Sets up a fresh Ubuntu LTS server to run Shorts finder. Run it as root from
# the copy of the code on the server:
#
#   sudo bash /opt/shorts-finder-code/shorts-finder/deploy/setup.sh
#
# It is safe to run again: every step checks what is already there.
# It asks for no key or token and none may be given to it. It creates
# /etc/shorts-finder/env with placeholders; you put the real values in that
# file yourself afterwards (see deploy/README.md).
# Not yet run on a real server: see deploy/README.md.
set -euo pipefail

readonly SERVICE="shorts-finder"
readonly SERVICE_USER="shorts"
readonly APP_LINK="/opt/shorts-finder"
readonly DATA_DIR="/var/lib/shorts-finder"
readonly CONFIG_DIR="/etc/shorts-finder"
readonly ENV_FILE="${CONFIG_DIR}/env"
readonly NODE_MAJOR=22
readonly SWAP_FILE="/swapfile"
readonly SWAP_SIZE="1G"
readonly NODESOURCE_KEYRING="/etc/apt/keyrings/nodesource.gpg"

step() {
  echo
  echo "== $* =="
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this as root: sudo bash $0" >&2
  exit 1
fi
if [[ "$#" -ne 0 ]]; then
  echo "This script takes nothing on the command line. Keys go in ${ENV_FILE} afterwards." >&2
  exit 1
fi

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly PROJECT_DIR
case "${PROJECT_DIR}" in
  /root/* | /home/*)
    echo "The code is in ${PROJECT_DIR}, which the service is not allowed to read." >&2
    echo "Move it under /opt (for example /opt/shorts-finder-code) and run this again." >&2
    exit 1
    ;;
esac
if [[ ! -f "${PROJECT_DIR}/package-lock.json" ]]; then
  echo "${PROJECT_DIR} does not look like the Shorts finder folder." >&2
  exit 1
fi

step "1/9 Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git ufw unattended-upgrades sqlite3 \
  build-essential python3

step "2/9 Installing Node ${NODE_MAJOR}"
installed_major=0
if command -v node > /dev/null 2>&1; then
  installed_major="$(node -p 'process.versions.node.split(".")[0]')"
fi
if (( installed_major < NODE_MAJOR )); then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor --yes -o "${NODESOURCE_KEYRING}"
  echo "deb [signed-by=${NODESOURCE_KEYRING}] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt-get install -y nodejs
fi
echo "Node $(node --version)"

step "3/9 Creating the user and the folders"
if ! id -u "${SERVICE_USER}" > /dev/null 2>&1; then
  useradd --system --home-dir "${DATA_DIR}" --no-create-home --shell /usr/sbin/nologin \
    "${SERVICE_USER}"
fi
install -d -m 750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}"
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}/backups"
install -d -m 755 -o root -g root "${CONFIG_DIR}"
ln -sfn "${PROJECT_DIR}" "${APP_LINK}"

step "4/9 Adding swap space if there is none"
if [[ -z "$(swapon --show --noheadings)" ]]; then
  if [[ ! -f "${SWAP_FILE}" ]]; then
    fallocate -l "${SWAP_SIZE}" "${SWAP_FILE}"
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}"
  fi
  swapon "${SWAP_FILE}"
  if ! grep -q "^${SWAP_FILE} " /etc/fstab; then
    echo "${SWAP_FILE} none swap sw 0 0" >> /etc/fstab
  fi
  echo "Added ${SWAP_SIZE} of swap at ${SWAP_FILE}"
else
  echo "Swap is already on; left as it is"
fi

step "5/9 Closing the firewall to everything but SSH"
ssh_port="$(sshd -T 2> /dev/null | awk '$1 == "port" { print $2; exit }')"
ssh_port="${ssh_port:-22}"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${ssh_port}/tcp"
ufw --force enable

step "6/9 Turning on automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
systemctl enable --now unattended-upgrades

step "7/9 Installing what the code needs"
(cd "${PROJECT_DIR}" && npm ci --omit=dev --no-audit --no-fund)

step "8/9 Creating the settings file"
if [[ -f "${ENV_FILE}" ]]; then
  echo "${ENV_FILE} is already there; left as it is"
else
  install -m 600 -o root -g root "${PROJECT_DIR}/deploy/env.template" "${ENV_FILE}"
  echo "Created ${ENV_FILE} with placeholders"
fi
chown root:root "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

step "9/9 Installing the service and the nightly backup"
install -m 644 "${PROJECT_DIR}/deploy/shorts-finder.service" "/etc/systemd/system/${SERVICE}.service"
install -m 644 "${PROJECT_DIR}/deploy/shorts-finder-backup.service" \
  "/etc/systemd/system/${SERVICE}-backup.service"
install -m 644 "${PROJECT_DIR}/deploy/shorts-finder-backup.timer" \
  "/etc/systemd/system/${SERVICE}-backup.timer"
install -m 755 "${PROJECT_DIR}/deploy/shorts-finder-cli.sh" /usr/local/bin/shorts-finder
chmod 755 "${PROJECT_DIR}/deploy/backup.sh" "${PROJECT_DIR}/deploy/update.sh"
systemctl daemon-reload
systemctl enable "${SERVICE}.service"
systemctl enable --now "${SERVICE}-backup.timer"

cat << DONE

Set-up is finished. The service is installed but not started, because it has
no key yet. What to do now:

  1. Put your YouTube key and Telegram details in the settings file:
       sudo nano ${ENV_FILE}
  2. Start the service:
       sudo systemctl start ${SERVICE}
  3. See what it says:
       sudo journalctl -u ${SERVICE} -n 20

The rest is in deploy/README.md.
DONE
