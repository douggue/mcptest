#!/usr/bin/env bash
# Back up the database (schedules, destinations, encrypted keys, history) and .env.
# Videos are large and can be re-uploaded; pass --with-media to include them.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="backups/studio-$(date +%Y%m%d-%H%M%S)"
mkdir -p backups
docker compose exec -T engine node --disable-warning=ExperimentalWarning -e "
const { DatabaseSync } = require('node:sqlite');
new DatabaseSync('/data/studio.db').exec(\"VACUUM INTO '/data/backup.db'\");"
VOL=$(docker volume ls -q | grep 'studio-data$' | head -1)
if [ "${1:-}" = "--with-media" ]; then INCLUDE="backup.db originals"; else INCLUDE="backup.db"; fi
docker run --rm -v "$VOL":/data -v "$PWD/backups":/backup alpine sh -c "cd /data && tar czf /backup/$(basename "$OUT").tgz $INCLUDE && rm backup.db"
cp .env "backups/$(basename "$OUT").env"
chmod 600 backups/*
echo "Backup written to backups/$(basename "$OUT").tgz (+ .env). Copy both off the server."
