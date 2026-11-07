"""A fake engine for tests and UI development.

It launches nothing. It records every spec it was asked to launch, hands back
a plausible-looking websocket endpoint, and tracks "alive" state in memory, so
the launcher, API and self-test plumbing can be exercised without a browser.
Set ``MULTIPROFILE_ENGINE=mock`` to use it in the daemon.
"""

from __future__ import annotations

import itertools
import os
from typing import Any

from app.db import now_iso
from app.engines.base import LaunchHandle, LaunchSpec, ProgressCallback

_counter = itertools.count(1)


class MockEngine:
    name = "mock"

    def __init__(self) -> None:
        self.launched: list[LaunchSpec] = []
        self._alive: set[str] = set()
        self.fail_next: str | None = None
        self._installed = True

    # -- Engine protocol --------------------------------------------------------
    def launch(self, spec: LaunchSpec) -> LaunchHandle:
        if self.fail_next:
            msg, self.fail_next = self.fail_next, None
            raise RuntimeError(msg)
        self.launched.append(spec)
        spec.user_data_dir.mkdir(parents=True, exist_ok=True)
        (spec.user_data_dir / "prefs.js").write_text(
            f'user_pref("mock.profile", "{spec.profile_id}");\n', encoding="utf-8"
        )
        self._alive.add(spec.profile_id)
        port = 40000 + next(_counter)
        return LaunchHandle(
            profile_id=spec.profile_id,
            ws_endpoint=f"ws://127.0.0.1:{port}/{spec.profile_id}",
            pid=os.getpid(),
            started_at=now_iso(),
            engine_version="mock-1",
        )

    def stop(self, handle: LaunchHandle, timeout: float = 20.0) -> None:
        self._alive.discard(handle.profile_id)

    def is_alive(self, handle: LaunchHandle) -> bool:
        return handle.profile_id in self._alive

    def reattach(self, record: dict[str, Any]) -> LaunchHandle | None:
        if record.get("profile_id") in self._alive:
            return LaunchHandle(**record)
        return None

    def installed(self) -> bool:
        return self._installed

    def version(self) -> str | None:
        return "mock-1"

    def install(self, progress: ProgressCallback | None = None) -> None:
        if progress:
            progress(1, 1)
        self._installed = True

    # -- test helpers ----------------------------------------------------------
    def crash(self, profile_id: str) -> None:
        self._alive.discard(profile_id)
