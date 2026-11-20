#!/usr/bin/env bash
# Writes a dated, compressed copy of the store and keeps the last 14.
# Run nightly by shorts-finder-backup.timer as the user "shorts".
# Not yet run on a real server: see deploy/README.md.
set -euo pipefail

readonly STORE="${SHORTS_DB_PATH:-/var/lib/shorts-finder/shorts-finder.db}"
readonly BACKUP_DIR="${SHORTS_BACKUP_DIR:-/var/lib/shorts-finder/backups}"
# Nightly copies kept; older ones are deleted.
readonly KEEP_NIGHTLY=14
# Copies the service itself writes before changing the store's shape; the last few are kept.
readonly KEEP_PRE_UPDATE=3

if [[ ! -f "${STORE}" ]]; then
  echo "No store at ${STORE} yet; nothing to copy."
  exit 0
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

# A copy needs room for the store once more (before it is compressed). If the
# disk cannot hold that, stop here and say so rather than fill it.
store_kb="$(du -k "${STORE}" | cut -f1)"
free_kb="$(df -Pk "${BACKUP_DIR}" | awk 'NR == 2 { print $4 }')"
if (( free_kb < store_kb * 2 )); then
  echo "Not enough free disk for a copy: ${free_kb} KB free, the store is ${store_kb} KB." >&2
  exit 1
fi

name="$(basename "${STORE}" .db)"
stamp="$(date -u +%Y%m%d)"
target="${BACKUP_DIR}/${name}-${stamp}.db"
partial="${target}.partial"

# sqlite3's ".backup" takes a whole, consistent copy while the service runs.
rm -f "${partial}" "${partial}.gz"
sqlite3 "${STORE}" ".timeout 30000" ".backup '${partial}'"
gzip -f "${partial}"
mv -f "${partial}.gz" "${target}.gz"
echo "Wrote ${target}.gz"

# Names carry the date, so sorting by name is sorting by age.
prune() {
  local dir="$1" pattern="$2" keep="$3"
  local -a old=()
  mapfile -t old < <(find "${dir}" -maxdepth 1 -type f -name "${pattern}" | sort | head -n "-${keep}")
  if (( ${#old[@]} > 0 )); then
    rm -f -- "${old[@]}"
    echo "Removed ${#old[@]} older copies matching ${pattern}"
  fi
}

prune "${BACKUP_DIR}" "${name}-*.db.gz" "${KEEP_NIGHTLY}"
prune "$(dirname "${STORE}")" "${name}.backup-v*.db" "${KEEP_PRE_UPDATE}"
