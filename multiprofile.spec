# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the MultiProfile daemon (onedir)."""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_data_files

block_cipher = None

datas = [("app/engines/launch_server.js", "app/engines")]
binaries = []
hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
    "keyring.backends.Windows",
    "socksio",
]
# Camoufox ships JSON/YAML data files and the Playwright driver (Node + browser launcher).
for pkg in ("camoufox", "playwright", "browserforge", "language_tags", "maxminddb"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass
datas += collect_data_files("certifi")

a = Analysis(
    ["app/__main__.py"],
    pathex=[str(Path(".").resolve())],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "PyQt5", "PySide2"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="multiprofile-daemon",
    debug=False,
    strip=False,
    upx=False,  # UPX-packed binaries trip antivirus heuristics
    console=True,
)
coll = COLLECT(exe, a.binaries, a.zipfiles, a.datas, strip=False, upx=False, name="multiprofile-daemon")
