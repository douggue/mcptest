"""Camoufox engine.

Camoufox is a Firefox build whose fingerprint spoofing happens inside the C++
engine, configured through a JSON "config" that Camoufox's Python package
derives from a fingerprint dict. We:

1. ask ``camoufox.utils.launch_options`` for the Playwright launch options for
   the profile's **stored** fingerprint, proxy and geo (nothing is regenerated);
2. start Playwright's bundled Node driver with ``launch_server.js`` which
   launches the persistent profile directory and serves it over a websocket;
3. hand the websocket endpoint back to the launcher.

Stopping closes the Node process's stdin, which lets Playwright close the
browser gracefully so the profile is flushed to disk.
"""

from __future__ import annotations

import base64
import contextlib
import json
import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from app.db import now_iso
from app.engines.base import (
    BrowserNotInstalled,
    EngineError,
    LaunchHandle,
    LaunchSpec,
    ProgressCallback,
    kill_pid_tree,
    pid_alive,
)

log = logging.getLogger(__name__)

LAUNCH_SCRIPT = Path(__file__).with_name("launch_server.js")
START_TIMEOUT = 90.0


def _camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.title() for p in parts[1:])


def to_camel_case_dict(d: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        key = _camel(k) if isinstance(k, str) else k
        out[key] = to_camel_case_dict(v) if isinstance(v, dict) and k != "firefox_user_prefs" else v
    return out


def _driver_paths() -> tuple[str, Path]:
    """Playwright's bundled Node binary and its driver ``package`` dir."""
    from playwright._impl._driver import compute_driver_executable

    exe = compute_driver_executable()[0]
    node = exe[0] if isinstance(exe, tuple) else exe
    return str(node), Path(node).parent / "package"


class CamoufoxEngine:
    name = "camoufox"

    def __init__(self, *, executable_path: str | None = None, headless_default: bool = False):
        self.executable_path = executable_path or os.environ.get("MULTIPROFILE_CAMOUFOX_PATH")
        self.headless_default = headless_default
        self._install_lock = threading.Lock()

    # -- install / version ------------------------------------------------------
    def installed(self) -> bool:
        try:
            from camoufox.pkgman import launch_path

            launch_path(Path(self.executable_path).parent if self.executable_path else None)
            return True
        except Exception:  # CamoufoxNotInstalled or import error
            return False

    def version(self) -> str | None:
        try:
            from camoufox.pkgman import installed_verstr

            return installed_verstr()
        except Exception:
            return None

    def install(self, progress: ProgressCallback | None = None) -> None:
        """Download the pinned Camoufox build into the user cache dir."""
        with self._install_lock:
            from camoufox.pkgman import CamoufoxFetcher

            fetcher = CamoufoxFetcher()
            if progress is not None:
                # Newer camoufox builds call a progress callback from install();
                # older ones only report through rich. Attach where supported.
                for attr in ("progress_callback", "on_progress"):
                    if hasattr(fetcher, attr):
                        setattr(fetcher, attr, progress)
            fetcher.install()
            if progress is not None:
                progress(1, 1)

    # -- launch -------------------------------------------------------------------
    def build_options(self, spec: LaunchSpec) -> dict[str, Any]:
        """Playwright launch options for this spec (pure function, used by tests)."""
        try:
            from camoufox.utils import launch_options
        except ImportError as exc:  # pragma: no cover
            raise EngineError("camoufox is not installed in this environment") from exc

        config: dict[str, Any] = {}
        locale: str | None = None
        if spec.geo:
            if spec.geo.timezone:
                config["timezone"] = spec.geo.timezone
            if spec.geo.latitude is not None and spec.geo.longitude is not None:
                config["geolocation:latitude"] = float(spec.geo.latitude)
                config["geolocation:longitude"] = float(spec.geo.longitude)
                if spec.geo.accuracy:
                    config["geolocation:accuracy"] = float(spec.geo.accuracy)
            locale = spec.geo.locale

        opts = spec.options
        block_webrtc = opts.webrtc == "block" or (opts.webrtc == "proxy" and not spec.exit_ip)
        if opts.webrtc == "proxy" and spec.exit_ip:
            key = "webrtc:ipv6" if ":" in spec.exit_ip else "webrtc:ipv4"
            config[key] = spec.exit_ip

        kwargs: dict[str, Any] = {
            "config": config,
            "os": spec.os,
            "fingerprint": spec.fingerprint,
            "block_webrtc": block_webrtc,
            "block_images": opts.block_images or None,
            "humanize": opts.humanize or None,
            "headless": spec.headless,
            "enable_cache": True,
            "i_know_what_im_doing": True,
            "proxy": spec.proxy.as_playwright() if spec.proxy else None,
            "window": tuple(opts.window) if opts.window else None,
            "addons": list(opts.extensions) or None,
            "locale": locale,
            "executable_path": self.executable_path,
        }
        kwargs = {k: v for k, v in kwargs.items() if v is not None}
        try:
            options = launch_options(**kwargs)
        except Exception as exc:
            name = type(exc).__name__
            if "NotInstalled" in name:
                raise BrowserNotInstalled(str(exc)) from exc
            raise EngineError(f"camoufox launch_options failed: {exc}") from exc

        options["user_data_dir"] = str(spec.user_data_dir)
        # The persistent window is for a person: no fixed viewport.
        options.setdefault("no_viewport", True)
        if spec.proxy:
            # Belt and braces: Firefox must never fall back to a direct connection.
            prefs = options.setdefault("firefox_user_prefs", {})
            prefs.setdefault("network.proxy.failover_direct", False)
            prefs.setdefault("network.proxy.allow_bypass", False)
            prefs.setdefault("network.proxy.socks_remote_dns", True)
        return options

    def launch(self, spec: LaunchSpec) -> LaunchHandle:
        if not self.installed():
            raise BrowserNotInstalled("Camoufox browser is not downloaded yet")
        spec.user_data_dir.mkdir(parents=True, exist_ok=True)
        options = self.build_options(spec)
        node, package = _driver_paths()
        payload = base64.b64encode(json.dumps(to_camel_case_dict(options)).encode()).decode()

        log_path = spec.user_data_dir.parent / "engine.log"
        log_file = open(log_path, "ab")  # noqa: SIM115 - handed to the subprocess
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW  # type: ignore[attr-defined]
        proc = subprocess.Popen(  # noqa: S603
            [node, str(LAUNCH_SCRIPT), str(package)],
            cwd=str(package),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=log_file,
            text=True,
            creationflags=creationflags,
        )
        assert proc.stdin and proc.stdout
        try:
            proc.stdin.write(payload + "\n")
            proc.stdin.flush()
        except OSError as exc:
            proc.kill()
            raise EngineError(f"launcher exited early: {exc}") from exc

        ws_endpoint: str | None = None
        browser_pid: int | None = None
        deadline = time.monotonic() + START_TIMEOUT
        while time.monotonic() < deadline:
            line = proc.stdout.readline()
            if not line:
                break
            line = line.strip()
            if line.startswith("WS_ENDPOINT "):
                ws_endpoint = line.split(" ", 1)[1]
            elif line.startswith("BROWSER_PID "):
                pid_txt = line.split(" ", 1)[1].strip()
                browser_pid = int(pid_txt) if pid_txt.isdigit() else None
            elif line == "READY":
                break
        if not ws_endpoint:
            kill_pid_tree(proc.pid)
            tail = ""
            with contextlib.suppress(OSError):
                tail = log_path.read_text(encoding="utf-8", errors="replace")[-2000:]
            raise EngineError(f"Camoufox did not start.\n{tail}")

        handle = LaunchHandle(
            profile_id=spec.profile_id,
            ws_endpoint=ws_endpoint,
            pid=proc.pid,
            started_at=now_iso(),
            engine_version=self.version(),
            extra={"process": proc, "browser_pid": browser_pid, "log_file": log_file},
        )
        # Drain stdout in the background so the pipe never fills up.
        threading.Thread(target=self._drain, args=(proc,), daemon=True).start()
        return handle

    @staticmethod
    def _drain(proc: subprocess.Popen) -> None:
        try:
            for _ in proc.stdout or []:
                pass
        except Exception:
            pass

    def stop(self, handle: LaunchHandle, timeout: float = 20.0) -> None:
        proc: subprocess.Popen | None = handle.extra.get("process")
        if proc is not None:
            try:
                if proc.stdin and not proc.stdin.closed:
                    proc.stdin.close()
                proc.wait(timeout=timeout)
            except Exception:
                kill_pid_tree(proc.pid)
            finally:
                lf = handle.extra.get("log_file")
                if lf:
                    with contextlib.suppress(OSError):
                        lf.close()
            return
        # Reattached handle without a process object: terminate by pid.
        kill_pid_tree(handle.pid, timeout=timeout)

    def is_alive(self, handle: LaunchHandle) -> bool:
        proc: subprocess.Popen | None = handle.extra.get("process")
        if proc is not None:
            return proc.poll() is None
        return pid_alive(handle.pid)

    def reattach(self, record: dict[str, Any]) -> LaunchHandle | None:
        pid = record.get("pid")
        if pid_alive(pid):
            return LaunchHandle(
                profile_id=record["profile_id"],
                ws_endpoint=record["ws_endpoint"],
                pid=pid,
                started_at=record.get("started_at") or now_iso(),
                engine_version=record.get("engine_version"),
            )
        return None
