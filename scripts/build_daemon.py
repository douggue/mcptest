"""Freeze the daemon with PyInstaller and drop it where Tauri expects a sidecar.

    uv run python scripts/build_daemon.py

Produces (Windows):
    desktop/src-tauri/binaries/multiprofile-daemon-x86_64-pc-windows-msvc.exe
    desktop/src-tauri/binaries/_internal/...        (onedir payload)

We use --onedir rather than --onefile: it starts faster and is far less often
flagged by antivirus heuristics (see PLAN.md risks). Tauri bundles the exe as
``externalBin`` and the ``_internal`` folder as resources, and both end up in
the app folder next to each other on Windows.
"""

from __future__ import annotations

import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "multiprofile.spec"
OUT = ROOT / "desktop" / "src-tauri" / "binaries"


def target_triple() -> str:
    try:
        out = subprocess.check_output(["rustc", "-vV"], text=True)
        for line in out.splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    arch = {"AMD64": "x86_64", "x86_64": "x86_64", "arm64": "aarch64", "aarch64": "aarch64"}.get(
        platform.machine(), platform.machine()
    )
    if sys.platform == "win32":
        return f"{arch}-pc-windows-msvc"
    if sys.platform == "darwin":
        return f"{arch}-apple-darwin"
    return f"{arch}-unknown-linux-gnu"


def main() -> None:
    dist = ROOT / "dist" / "multiprofile-daemon"
    shutil.rmtree(dist, ignore_errors=True)
    subprocess.check_call(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", str(SPEC)], cwd=ROOT
    )
    exe = "multiprofile-daemon.exe" if sys.platform == "win32" else "multiprofile-daemon"
    built = dist / exe
    if not built.exists():
        sys.exit(f"build failed: {built} missing")
    OUT.mkdir(parents=True, exist_ok=True)
    suffix = ".exe" if sys.platform == "win32" else ""
    target = OUT / f"multiprofile-daemon-{target_triple()}{suffix}"
    shutil.copy2(built, target)
    internal_dst = OUT / "_internal"
    shutil.rmtree(internal_dst, ignore_errors=True)
    shutil.copytree(dist / "_internal", internal_dst)
    print(f"sidecar: {target}")
    print(f"payload: {internal_dst}")


if __name__ == "__main__":
    main()
