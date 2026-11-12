#!/usr/bin/env bash
# One-command install for a fresh Ubuntu 22.04/24.04 server.
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/setup.sh | sudo bash   (or run ./setup.sh from a clone)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo ./setup.sh)"; exit 1; fi
cd "$(dirname "$0")"

echo "==> Installing Docker (if needed)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Firewall: SSH, HTTP/HTTPS (dashboard) and RTMP 1935 (OBS ingest)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw allow 1935/tcp >/dev/null
  ufw --force enable >/dev/null
fi

# Video conversion is memory hungry on small servers; add swap if there is none.
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  echo "==> Adding 2 GB swap"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if [ ! -f .env ]; then
  read -rp "Domain for the dashboard (e.g. studio.example.com): " DOMAIN </dev/tty
  cp .env.example .env
  sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|; s|^PUBLIC_HOST=.*|PUBLIC_HOST=${DOMAIN}|" .env
  sed -i "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^HLS_CDN_SECRET=.*|HLS_CDN_SECRET=$(openssl rand -hex 24)|" .env
  sed -i "s|^SETUP_CODE=.*|SETUP_CODE=$(openssl rand -hex 4)|" .env
  chmod 600 .env
  echo "==> Wrote .env (keep a copy of APP_SECRET somewhere safe)"
fi

echo "==> Building and starting"
docker compose up -d --build

DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
CODE=$(grep '^SETUP_CODE=' .env | cut -d= -f2)
echo
echo "Stream Studio is starting."
echo "  Dashboard:  https://${DOMAIN}   (DNS must point here for the certificate)"
echo "  Setup code: ${CODE}            (asked once, when you create your password)"
echo "  OBS server: rtmp://${DOMAIN}:1935/live"
echo
echo "Logs:    docker compose logs -f engine"
echo "Update:  git pull && docker compose up -d --build"
