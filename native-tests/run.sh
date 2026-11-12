#!/usr/bin/env bash
# Builds native-tests/proxy_hook_test.cpp against engine/ (run scripts/fetch-engine.sh first) with
# the Android NDK and runs it on the connected device or emulator.
#
#   ANDROID_HOME=/path/to/sdk native-tests/run.sh            # x86_64 emulator (default)
#   ABI=arm64 native-tests/run.sh                            # a phone
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-${LOCALAPPDATA:-}/Android/Sdk}}"
NDK="${ANDROID_NDK_HOME:-$(ls -d "$SDK"/ndk/* | sort | tail -1)}"
BIN="$(ls -d "$NDK"/toolchains/llvm/prebuilt/*/bin | head -1)"
ADB="${ADB:-$SDK/platform-tools/adb}"
case "${ABI:-x86_64}" in
  arm64) TARGET=aarch64-linux-android30 ;;
  *)     TARGET=x86_64-linux-android30 ;;
esac

OUT="${TMPDIR:-/tmp}/proxy_hook_test"
CPP="$ROOT/engine/Bcore/src/main/cpp"
if command -v cygpath > /dev/null; then   # Git Bash on Windows: the NDK and adb want Windows paths
  OUT="$(cygpath -m "$OUT")"; CPP="$(cygpath -m "$CPP")"; ROOT="$(cygpath -m "$ROOT")"
  export MSYS_NO_PATHCONV=1
fi
"$BIN/clang++" --target="$TARGET" -std=c++17 -O1 -g -Wall -Wno-unused-function \
  -I "$CPP" -o "$OUT" "$ROOT/native-tests/proxy_hook_test.cpp" -static-libstdc++ -llog

"$ADB" push "$OUT" /data/local/tmp/proxy_hook_test > /dev/null
"$ADB" shell "chmod 755 /data/local/tmp/proxy_hook_test && /data/local/tmp/proxy_hook_test"
