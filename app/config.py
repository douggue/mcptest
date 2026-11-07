"""Paths, ports and settings for the daemon.

Everything lives under one data directory. On Windows that is
``%LOCALAPPDATA%\\MultiProfile``; elsewhere the platform's user data dir.
``MULTIPROFILE_DATA_DIR`` overrides it (used by tests and by the desktop app).
"""

from __future__ import annotations

import os
import secrets
import sys
from dataclasses import dataclass, field
from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "MultiProfile"
DEFAULT_PORT = 47821
DEFAULT_HOST = "127.0.0.1"
TOKEN_FILE = "api_token"


def default_data_dir() -> Path:
    env = os.environ.get("MULTIPROFILE_DATA_DIR")
    if env:
        return Path(env).expanduser()
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            return Path(local) / APP_NAME
    return Path(user_data_dir(APP_NAME, appauthor=False))


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    data_dir: Path = field(default_factory=default_data_dir)
    host: str = DEFAULT_HOST
    port: int = int(os.environ.get("MULTIPROFILE_PORT", DEFAULT_PORT))
    # Engine: "camoufox" (real) or "mock" (development / tests).
    engine: str = os.environ.get("MULTIPROFILE_ENGINE", "camoufox")
    headless: bool = _env_flag("MULTIPROFILE_HEADLESS", False)
    # Optional explicit MaxMind database for proxy geo lookups. When unset the
    # Camoufox GeoIP database (downloaded once, then read locally) is used.
    geoip_db: str | None = os.environ.get("MULTIPROFILE_GEOIP_DB") or None
    # Services used to discover a proxy's exit IP. Only the IP comes back; the
    # geo lookup itself happens locally so the lookup never leaks.
    ip_echo_urls: tuple[str, ...] = (
        "https://api.ipify.org?format=json",
        "https://api64.ipify.org?format=json",
    )
    proxy_check_timeout: float = 15.0
    # Run the leak self-test automatically after create / proxy change / regenerate.
    # Off by default: the self-test starts and stops the real profile, which would
    # open and immediately close the browser window right after you click Start.
    # Run it on demand from the Leak tests screen instead.
    auto_selftest: bool = _env_flag("MULTIPROFILE_AUTO_SELFTEST", False)
    # Refuse to start a profile that has no proxy assigned (strict "one identity, one IP").
    require_proxy: bool = _env_flag("MULTIPROFILE_REQUIRE_PROXY", False)
    # Where the web UI may talk from during `npm run dev` (Vite dev server).
    cors_origins: tuple[str, ...] = (
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
    )

    # Derived paths -------------------------------------------------------
    @property
    def db_path(self) -> Path:
        return self.data_dir / "multiprofile.sqlite3"

    @property
    def profiles_dir(self) -> Path:
        return self.data_dir / "profiles"

    @property
    def logs_dir(self) -> Path:
        return self.data_dir / "logs"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    @property
    def token_path(self) -> Path:
        return self.data_dir / TOKEN_FILE

    @property
    def pid_path(self) -> Path:
        return self.data_dir / "daemon.pid"

    @property
    def port_path(self) -> Path:
        return self.data_dir / "daemon.port"

    def ensure_dirs(self) -> None:
        for p in (self.data_dir, self.profiles_dir, self.logs_dir, self.backups_dir):
            p.mkdir(parents=True, exist_ok=True)

    def load_or_create_token(self) -> str:
        """The API bearer token. Generated once on first run, mode 0600 on POSIX."""
        self.ensure_dirs()
        if self.token_path.exists():
            token = self.token_path.read_text(encoding="utf-8").strip()
            if token:
                return token
        token = secrets.token_urlsafe(32)
        self.token_path.write_text(token, encoding="utf-8")
        if os.name == "posix":
            os.chmod(self.token_path, 0o600)
        return token


settings = Settings()
