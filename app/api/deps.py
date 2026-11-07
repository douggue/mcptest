"""Application context and shared FastAPI dependencies."""

from __future__ import annotations

import asyncio
import logging
import secrets
from dataclasses import dataclass, field
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings
from app.db import Database
from app.engines.base import Engine
from app.services.backup import BackupService
from app.services.fingerprints import FingerprintService
from app.services.launcher import LaunchManager
from app.services.profiles import ProfileService
from app.services.proxies import ProxyService
from app.services.selftest import SelfTestService
from app.vault import Vault

log = logging.getLogger(__name__)


@dataclass
class AppContext:
    settings: Settings
    db: Database
    vault: Vault
    engine: Engine
    fingerprints: FingerprintService
    proxies: ProxyService
    profiles: ProfileService
    launcher: LaunchManager
    selftest: SelfTestService
    backup: BackupService
    token: str
    install_state: dict[str, Any] = field(
        default_factory=lambda: {"in_progress": False, "progress": None, "error": None}
    )
    background: set[Any] = field(default_factory=set)
    shutdown_event: asyncio.Event | None = None
    loop: asyncio.AbstractEventLoop | None = None

    def spawn(self, coro: Any) -> Any:
        """Run ``coro`` in the background from the event loop *or* a worker thread."""
        try:
            asyncio.get_running_loop()
            task: Any = asyncio.create_task(coro)
        except RuntimeError:
            if self.loop is None:
                coro.close()
                raise RuntimeError("no event loop to schedule background work on") from None
            task = asyncio.run_coroutine_threadsafe(coro, self.loop)
        self.background.add(task)
        task.add_done_callback(self.background.discard)
        return task

    def schedule_selftest(self, profile_id: str) -> None:
        """Run the leak self-test in the background (after create/proxy change/regenerate)."""
        if not self.settings.auto_selftest:
            return

        async def _run() -> None:
            try:
                await self.selftest.run(profile_id)
            except Exception:  # noqa: BLE001
                log.exception("background self-test for %s failed", profile_id)

        self.spawn(_run())


_bearer = HTTPBearer(auto_error=False)


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


def require_token(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    ctx: AppContext = request.app.state.ctx
    presented = creds.credentials if creds else request.headers.get("X-API-Token")
    if not presented or not secrets.compare_digest(presented, ctx.token):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing or invalid API token")
