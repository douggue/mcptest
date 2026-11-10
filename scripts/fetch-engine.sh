#!/usr/bin/env bash
# Clones NewBlackbox at the pinned commit into engine/ and applies patches/*.patch in order.
# Re-runnable: it resets engine/ to the pin first, so patches never stack twice.
set -euo pipefail

ENGINE_REPO="${ENGINE_REPO:-https://github.com/ALEX5402/NewBlackbox.git}"
ENGINE_PIN="89b59836c66f173756a4ae258cf379a957649820"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_DIR="$ROOT/engine"
PATCH_DIR="$ROOT/patches"

if [ ! -d "$ENGINE_DIR/.git" ]; then
  git clone --no-checkout "$ENGINE_REPO" "$ENGINE_DIR"
fi
git -C "$ENGINE_DIR" fetch --quiet origin "$ENGINE_PIN" 2>/dev/null || git -C "$ENGINE_DIR" fetch --quiet origin
git -C "$ENGINE_DIR" checkout --quiet --force "$ENGINE_PIN"
git -C "$ENGINE_DIR" clean -fdxq
[ "$(git -C "$ENGINE_DIR" rev-parse HEAD)" = "$ENGINE_PIN" ] || { echo "pin mismatch" >&2; exit 1; }

shopt -s nullglob
for p in "$PATCH_DIR"/*.patch; do
  echo "applying $(basename "$p")"
  git -C "$ENGINE_DIR" apply --whitespace=nowarn --index "$p"
done
# Files deleted or added by patches are listed in docs/engine-fixes.md.
echo "engine ready at $ENGINE_DIR (pin $ENGINE_PIN + $(ls "$PATCH_DIR"/*.patch 2>/dev/null | wc -l) patches)"
