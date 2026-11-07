"""Process management: start/stop profiles, per-profile locks, crash recovery.

Rules enforced here:

* a profile never runs twice (lockfile with the owning pid, plus an asyncio
  lock per profile inside the daemon);
* if the profile has a proxy, the proxy is health-checked right before launch
  and a dead proxy **refuses** the launch. There is no silent direct fallback;
* on daemon startup, browsers that survived a daemon crash are re-attached
  (``running.json`` + live pid) and stale locks are removed.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from collections import defaultdict
from pathlib import Path

from app.config import Settings
from app.db import Database, now_iso
from app.engines.base import Engine, LaunchHandle, pid_alive
from app.models import Geo, RunningProfile
from app.services.profiles import ProfileService
from app.services.proxies import ProxyService

log = logging.getLogger(__name__)

LOCK_FILE = "lock"
RUNNING_FILE = "running.json"


class LaunchRefused(RuntimeError):
    """Launch blocked on purpose (dead proxy, missing proxy, already running elsewhere)."""


class NotRunning(RuntimeError):
    pass


class LaunchManager:
    def __init__(
        self,
        db: Database,
        engine: Engine,
        profiles: ProfileService,
        proxies: ProxyService,
        settings: Settings,
    ):
        self.db = db
        self.engine = engine
        self.profiles = profiles
        self.proxies = proxies
        self.settings = settings
        self._handles: dict[str, LaunchHandle] = {}
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    # -- paths ----------------------------------------------------------------------
    def _lock_path(self, profile_id: str) -> Path:
        return self.profiles.profile_dir(profile_id) / LOCK_FILE

    def _running_path(self, profile_id: str) -> Path:
        return self.profiles.profile_dir(profile_id) / RUNNING_FILE

    # -- lockfile ------------------------------------------------------------------
    def _acquire_lock(self, profile_id: str) -> None:
        path = self._lock_path(profile_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            try:
                owner = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                owner = {}
            owner_pid = owner.get("pid")
            browser_pid = owner.get("browser_pid")
            if (owner_pid and owner_pid != os.getpid() and pid_alive(owner_pid)) or pid_alive(
                browser_pid
            ):
                raise LaunchRefused(
                    f"profile {profile_id} is locked by another process (pid {owner_pid})"
                )
            log.info("removing stale lock for %s", profile_id)
            path.unlink(missing_ok=True)
        path.write_text(json.dumps({"pid": os.getpid(), "ts": now_iso()}), encoding="utf-8")

    def _update_lock(self, profile_id: str, handle: LaunchHandle) -> None:
        self._lock_path(profile_id).write_text(
            json.dumps({"pid": os.getpid(), "browser_pid": handle.pid, "ts": now_iso()}),
            encoding="utf-8",
        )
        self._running_path(profile_id).write_text(json.dumps(handle.to_record()), encoding="utf-8")

    def _release(self, profile_id: str) -> None:
        self._lock_path(profile_id).unlink(missing_ok=True)
        self._running_path(profile_id).unlink(missing_ok=True)
        self._handles.pop(profile_id, None)
        self.profiles.set_status(profile_id, "stopped")

    # -- queries ---------------------------------------------------------------------
    def handle(self, profile_id: str) -> LaunchHandle | None:
        h = self._handles.get(profile_id)
        if h and not self.engine.is_alive(h):
            log.warning("profile %s exited on its own", profile_id)
            self.db.record_event("profile.exited", profile_id)
            self._release(profile_id)
            return None
        return h

    def is_running(self, profile_id: str) -> bool:
        return self.handle(profile_id) is not None

    def running_map(self) -> dict[str, LaunchHandle]:
        for pid in list(self._handles):
            self.handle(pid)  # reaps dead ones
        return dict(self._handles)

    def running(self) -> list[RunningProfile]:
        out = []
        for pid, h in self.running_map().items():
            try:
                name = self.profiles.get(pid).name
            except LookupError:
                name = pid
            out.append(
                RunningProfile(
                    profile_id=pid,
                    name=name,
                    ws_endpoint=h.ws_endpoint,
                    pid=h.pid,
                    started_at=h.started_at,
                )
            )
        return out

    # -- start / stop -------------------------------------------------------------------
    async def start(
        self, profile_id: str, *, headless: bool | None = None
    ) -> tuple[LaunchHandle, bool]:
        """Start ``profile_id``. Returns ``(handle, already_running)``."""
        async with self._locks[profile_id]:
            existing = self.handle(profile_id)
            if existing:
                return existing, True
            profile = self.profiles.get(profile_id)

            proxy_creds = None
            exit_ip = None
            proxy_geo: Geo | None = None
            if profile.proxy_id:
                result = await self.proxies.check(profile.proxy_id)
                if not result.healthy:
                    self.db.record_event(
                        "profile.launch_refused",
                        profile_id,
                        reason="proxy_down",
                        error=result.error,
                    )
                    raise LaunchRefused(
                        f"proxy check failed, refusing to launch without it: {result.error}"
                    )
                if result.shared_with:
                    self.db.record_event(
                        "profile.shared_exit_ip_warning",
                        profile_id,
                        exit_ip=result.exit_ip,
                        shared_with=result.shared_with,
                    )
                proxy_creds = self.proxies.credentials(profile.proxy_id)
                exit_ip = result.exit_ip
                proxy_geo = result.geo
            elif self.settings.require_proxy:
                self.db.record_event("profile.launch_refused", profile_id, reason="no_proxy")
                raise LaunchRefused("profile has no proxy assigned and require_proxy is on")
            else:
                self.db.record_event("profile.launch_direct_warning", profile_id)

            spec = self.profiles.build_launch_spec(
                profile_id,
                headless=self.settings.headless if headless is None else headless,
                proxy=proxy_creds,
                exit_ip=exit_ip,
                proxy_geo=proxy_geo,
            )
            self._acquire_lock(profile_id)
            self.profiles.set_status(profile_id, "starting")
            try:
                handle = await asyncio.to_thread(self.engine.launch, spec)
            except Exception as exc:
                self._release(profile_id)
                self.db.record_event("profile.launch_failed", profile_id, error=str(exc))
                raise
            self._handles[profile_id] = handle
            self._update_lock(profile_id, handle)
            self.profiles.set_status(profile_id, "running", touch=True)
            self.profiles.set_engine_version(profile_id, handle.engine_version)
            self.db.record_event(
                "profile.started",
                profile_id,
                pid=handle.pid,
                ws_endpoint=handle.ws_endpoint,
                exit_ip=exit_ip,
                timezone=spec.geo.timezone if spec.geo else None,
            )
            return handle, False

    async def stop(self, profile_id: str) -> None:
        async with self._locks[profile_id]:
            h = self._handles.get(profile_id)
            if not h:
                raise NotRunning(profile_id)
            try:
                await asyncio.to_thread(self.engine.stop, h)
            finally:
                self._release(profile_id)
                self.db.record_event("profile.stopped", profile_id)

    async def stop_all(self) -> None:
        await asyncio.gather(
            *(self.stop(pid) for pid in list(self._handles)), return_exceptions=True
        )

    async def start_group(self, group: str) -> dict[str, str]:
        results: dict[str, str] = {}
        for p in self.profiles.list(group=group):
            try:
                await self.start(p.id)
                results[p.id] = "started"
            except Exception as exc:  # noqa: BLE001
                results[p.id] = f"error: {exc}"
        return results

    async def stop_group(self, group: str) -> dict[str, str]:
        results: dict[str, str] = {}
        for p in self.profiles.list(group=group):
            if self.is_running(p.id):
                await self.stop(p.id)
                results[p.id] = "stopped"
        return results

    # -- recovery ----------------------------------------------------------------------
    def recover(self) -> None:
        """Called on daemon startup. Re-attach survivors, clear stale state."""
        if not self.settings.profiles_dir.exists():
            return
        for pdir in self.settings.profiles_dir.iterdir():
            if not pdir.is_dir():
                continue
            profile_id = pdir.name
            running_file = pdir / RUNNING_FILE
            handle = None
            if running_file.exists():
                try:
                    record = json.loads(running_file.read_text(encoding="utf-8"))
                    handle = self.engine.reattach(record)
                except (OSError, ValueError, TypeError):
                    handle = None
            if handle:
                self._handles[profile_id] = handle
                self._update_lock(profile_id, handle)
                self.profiles.set_status(profile_id, "running")
                self.db.record_event("profile.reattached", profile_id, pid=handle.pid)
                log.info("re-attached running profile %s (pid %s)", profile_id, handle.pid)
            else:
                (pdir / LOCK_FILE).unlink(missing_ok=True)
                running_file.unlink(missing_ok=True)
                with contextlib.suppress(Exception):  # profile dir without a DB row
                    self.profiles.set_status(profile_id, "stopped")
