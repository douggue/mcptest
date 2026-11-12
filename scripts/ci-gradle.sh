#!/usr/bin/env bash
# Runs Gradle with the given tasks. When it fails, the reason is repeated as a GitHub annotation:
# annotations of a public repository can be read without signing in, the job log cannot.
set -uo pipefail

log=$(mktemp)
./gradlew --no-daemon "$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}

if [ "$rc" -ne 0 ]; then
  msg=$( { sed -n '/^\* What went wrong:/,/^\* Try:/p' "$log"
           grep -E '^e: |error: |FAILED$|Lint found' "$log" | head -n 15
         } | cut -c1-300 | head -c 3500 | sed 's/%/%25/g' | awk '{ printf "%s%%0A", $0 }' )
  echo "::error title=Gradle failed::${msg:-no matching lines, see the job log}"
fi
exit "$rc"
