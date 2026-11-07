"""Tiny client for scripts.

    from app.client import MultiProfile, profile

    with profile("shopping-1") as page:
        page.goto("https://example.com")

``profile()`` starts the profile if needed (through the local API), connects
Playwright to its websocket, hands you a page in the persistent context and,
on exit, closes that page and disconnects. The browser keeps running for
manual use. Call ``MultiProfile().stop(name)`` when you want it gone.

Token and port are read from the data directory (``api_token``,
``daemon.port``) unless given explicitly or via ``MULTIPROFILE_TOKEN`` /
``MULTIPROFILE_URL``.
"""

from __future__ import annotations

import contextlib
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx

from app.config import default_data_dir


class MultiProfile:
    def __init__(
        self, base_url: str | None = None, token: str | None = None, data_dir: Path | None = None
    ):
        data_dir = data_dir or default_data_dir()
        if base_url is None:
            base_url = os.environ.get("MULTIPROFILE_URL")
        if base_url is None:
            port_file = data_dir / "daemon.port"
            port = port_file.read_text().strip() if port_file.exists() else "47821"
            base_url = f"http://127.0.0.1:{port}"
        if token is None:
            token = (
                os.environ.get("MULTIPROFILE_TOKEN") or (data_dir / "api_token").read_text().strip()
            )
        self.http = httpx.Client(
            base_url=base_url, headers={"Authorization": f"Bearer {token}"}, timeout=180
        )

    # -- lookups --------------------------------------------------------------------
    def profiles(self, **filters: Any) -> list[dict[str, Any]]:
        r = self.http.get("/profiles", params=filters)
        r.raise_for_status()
        return r.json()

    def resolve(self, name_or_id: str) -> str:
        for p in self.profiles():
            if p["id"] == name_or_id or p["name"] == name_or_id:
                return p["id"]
        raise LookupError(f"no profile named {name_or_id!r}")

    # -- lifecycle ------------------------------------------------------------------
    def start(self, name_or_id: str) -> dict[str, Any]:
        r = self.http.post(f"/profiles/{self.resolve(name_or_id)}/start")
        r.raise_for_status()
        return r.json()

    def stop(self, name_or_id: str) -> None:
        self.http.post(f"/profiles/{self.resolve(name_or_id)}/stop").raise_for_status()

    def selftest(self, name_or_id: str) -> dict[str, Any]:
        r = self.http.post(f"/profiles/{self.resolve(name_or_id)}/selftest")
        r.raise_for_status()
        return r.json()

    @contextlib.contextmanager
    def page(self, name_or_id: str) -> Iterator[Any]:
        from playwright.sync_api import sync_playwright

        info = self.start(name_or_id)
        with sync_playwright() as pw:
            browser = pw.firefox.connect(info["ws_endpoint"])
            ctx = browser.contexts[0] if browser.contexts else browser.new_context()
            page = ctx.new_page()
            try:
                yield page
            finally:
                with contextlib.suppress(Exception):
                    page.close()
                with contextlib.suppress(Exception):
                    browser.close()  # disconnects this client only


@contextlib.contextmanager
def profile(name_or_id: str, **client_kwargs: Any) -> Iterator[Any]:
    with MultiProfile(**client_kwargs).page(name_or_id) as page:
        yield page
