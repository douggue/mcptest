"""FastAPI app factory and daemon entry point.

* binds to 127.0.0.1 only, bearer-token auth on everything except ``/health``;
* writes ``daemon.pid`` / ``daemon.port`` so the desktop app can find (and, after
  a crash, kill) an orphaned daemon;
* recovers running profiles on startup and stops them on shutdown.
"""

from __future__ import annotations

import asyncio
import logging
import os
import socket
import sys
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api import backup, launch, profiles, proxies, selftest, system
from app.api.deps import AppContext
from app.config import Settings
from app.config import settings as default_settings
from app.db import Database
from app.engines import make_engine
from app.engines.base import Engine, pid_alive
from app.services.backup import BackupService
from app.services.browser import BrowserProbe
from app.services.fingerprints import FingerprintService
from app.services.launcher import LaunchManager
from app.services.profiles import ProfileService
from app.services.proxies import ProxyService
from app.services.selftest import SelfTestService
from app.vault import Vault

log = logging.getLogger("multiprofile")


def build_context(
    settings: Settings,
    *,
    engine: Engine | None = None,
    vault: Vault | None = None,
    fingerprints: FingerprintService | None = None,
    proxies_service: ProxyService | None = None,
    collector=None,
) -> AppContext:
    settings.ensure_dirs()
    db = Database(settings.db_path)
    vault = vault or Vault(key_file=settings.data_dir / "master.key")
    engine = engine or make_engine(settings.engine, headless=settings.headless)
    fingerprints = fingerprints or FingerprintService()
    proxy_svc = proxies_service or ProxyService(db, vault, settings)
    profile_svc = ProfileService(db, settings, fingerprints, proxy_svc)
    launcher = LaunchManager(db, engine, profile_svc, proxy_svc, settings)
    if collector is None:
        if engine.name == "mock":
            from app.engines.mock_engine import MockCollector

            collector = MockCollector(engine)  # type: ignore[arg-type]
        else:
            collector = BrowserProbe(settings.ip_echo_urls).collect
    selftest_svc = SelfTestService(db, profile_svc, proxy_svc, launcher, collector)
    backup_svc = BackupService(db, settings, profile_svc, proxy_svc, launcher)
    return AppContext(
        settings=settings,
        db=db,
        vault=vault,
        engine=engine,
        fingerprints=fingerprints,
        proxies=proxy_svc,
        profiles=profile_svc,
        launcher=launcher,
        selftest=selftest_svc,
        backup=backup_svc,
        token=settings.load_or_create_token(),
    )


def create_app(
    settings: Settings | None = None, ctx: AppContext | None = None, **overrides
) -> FastAPI:
    settings = settings or default_settings
    ctx = ctx or build_context(settings, **overrides)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        ctx.loop = asyncio.get_running_loop()
        ctx.shutdown_event = asyncio.Event()
        ctx.launcher.recover()
        _write_pidfiles(settings)
        watcher = asyncio.create_task(_watch_shutdown(app, ctx))
        try:
            yield
        finally:
            watcher.cancel()
            for t in list(ctx.background):
                t.cancel()
            await ctx.launcher.stop_all()
            ctx.db.close()
            _remove_pidfiles(settings)

    app = FastAPI(title="MultiProfile", version=__version__, lifespan=lifespan)
    app.state.ctx = ctx
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(system.router)
    # launch/selftest first: their fixed paths (/profiles/running, /profiles/groups/..)
    # must win over /profiles/{profile_id}.
    app.include_router(launch.router)
    app.include_router(selftest.router)
    app.include_router(profiles.router)
    app.include_router(proxies.router)
    app.include_router(backup.router)
    return app


async def _watch_shutdown(app: FastAPI, ctx: AppContext) -> None:
    assert ctx.shutdown_event is not None
    await ctx.shutdown_event.wait()
    log.info("shutdown requested over the API")
    server = getattr(app.state, "server", None)
    if server is not None:
        server.should_exit = True
    else:  # not running under our uvicorn wrapper
        os.kill(os.getpid(), 15)


def _write_pidfiles(settings: Settings) -> None:
    settings.pid_path.write_text(str(os.getpid()), encoding="utf-8")
    settings.port_path.write_text(str(settings.port), encoding="utf-8")


def _remove_pidfiles(settings: Settings) -> None:
    settings.pid_path.unlink(missing_ok=True)
    settings.port_path.unlink(missing_ok=True)


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def _setup_logging(settings: Settings) -> None:
    settings.ensure_dirs()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    handler = RotatingFileHandler(
        settings.logs_dir / "daemon.log", maxBytes=5_000_000, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(fmt)
    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[handler, stream])


def run() -> None:
    """Console entry point / PyInstaller target."""
    import uvicorn

    s = default_settings
    _setup_logging(s)
    if s.pid_path.exists():
        try:
            old = int(s.pid_path.read_text().strip())
        except ValueError:
            old = 0
        if old and old != os.getpid() and pid_alive(old) and _port_in_use(s.host, s.port):
            log.error("daemon already running (pid %s) on port %s", old, s.port)
            sys.exit(3)
    app = create_app(s)
    config = uvicorn.Config(app, host=s.host, port=s.port, log_level="info", access_log=False)
    server = uvicorn.Server(config)
    app.state.server = server
    server.run()


if __name__ == "__main__":
    run()
