"""The engine interface.

Everything above this layer (launcher, API, self-test) only knows about
``LaunchSpec`` in and ``LaunchHandle`` out. Camoufox is the first
implementation; a Chromium engine can be added later behind the same methods.
"""

from __future__ import annotations

import contextlib
import os
import signal
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import psutil

from app.models import Geo, LaunchOptions


@dataclass
class ProxyCredentials:
    scheme: str
    host: str
    port: int
    username: str | None = None
    password: str | None = None

    @property
    def server(self) -> str:
        return f"{self.scheme}://{self.host}:{self.port}"

    def as_playwright(self) -> dict[str, str]:
        d = {"server": self.server}
        if self.username:
            d["username"] = self.username
        if self.password:
            d["password"] = self.password
        return d


@dataclass
class LaunchSpec:
    profile_id: str
    name: str
    user_data_dir: Path
    fingerprint: dict[str, Any]
    os: str
    options: LaunchOptions = field(default_factory=LaunchOptions)
    proxy: ProxyCredentials | None = None
    exit_ip: str | None = None
    geo: Geo | None = None
    headless: bool = False
    engine_version: str | None = None


@dataclass
class LaunchHandle:
    profile_id: str
    ws_endpoint: str
    pid: int | None
    started_at: str
    engine_version: str | None = None
    # Engine-private state (subprocess objects etc.). Not serialised.
    extra: dict[str, Any] = field(default_factory=dict, repr=False)

    def to_record(self) -> dict[str, Any]:
        return {
            "profile_id": self.profile_id,
            "ws_endpoint": self.ws_endpoint,
            "pid": self.pid,
            "started_at": self.started_at,
            "engine_version": self.engine_version,
        }


ProgressCallback = Callable[[int, int], None]


class EngineError(RuntimeError):
    pass


class BrowserNotInstalled(EngineError):
    pass


class Engine(Protocol):
    name: str

    def launch(self, spec: LaunchSpec) -> LaunchHandle:
        """Start a browser for ``spec`` and return once its websocket is ready.

        Blocking. The launcher runs it in a worker thread.
        """

    def stop(self, handle: LaunchHandle, timeout: float = 20.0) -> None: ...

    def is_alive(self, handle: LaunchHandle) -> bool: ...

    def reattach(self, record: dict[str, Any]) -> LaunchHandle | None:
        """Rebuild a handle for a browser that survived a daemon restart."""

    def installed(self) -> bool: ...

    def version(self) -> str | None: ...

    def install(self, progress: ProgressCallback | None = None) -> None: ...


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        proc = psutil.Process(pid)
        return proc.is_running() and proc.status() != psutil.STATUS_ZOMBIE
    except psutil.Error:
        return False


def kill_pid_tree(pid: int | None, timeout: float = 10.0) -> None:
    """Terminate ``pid`` and its children, escalating to kill."""
    if not pid_alive(pid):
        return
    try:
        root = psutil.Process(pid)
        procs = root.children(recursive=True) + [root]
    except psutil.Error:
        return
    for p in procs:
        with contextlib.suppress(psutil.Error):
            p.terminate()
    _, alive = psutil.wait_procs(procs, timeout=timeout)
    for p in alive:
        with contextlib.suppress(psutil.Error):
            p.kill()


def interrupt_pid(pid: int) -> None:
    """Best-effort polite stop (SIGINT / CTRL_BREAK)."""
    try:
        if os.name == "nt":
            os.kill(pid, signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
        else:
            os.kill(pid, signal.SIGINT)
    except OSError:
        pass
