"""Talking to a running profile over its Playwright websocket.

The engine serves the persistent profile in "shared browser" mode, so a
client that connects sees the on-disk context as ``browser.contexts[0]``.
Disconnecting never closes the browser; the person keeps using it.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from typing import Any

# JavaScript run inside the profile to collect what the self-test compares.
PROBE_JS = r"""
async () => {
  const out = {};
  const n = navigator;
  out.userAgent = n.userAgent;
  out.platform = n.platform;
  out.oscpu = n.oscpu || null;
  out.language = n.language;
  out.languages = Array.from(n.languages || []);
  out.hardwareConcurrency = n.hardwareConcurrency;
  out.maxTouchPoints = n.maxTouchPoints;
  out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  out.locale = Intl.DateTimeFormat().resolvedOptions().locale;
  out.tzOffset = new Date().getTimezoneOffset();
  out.screen = {width: screen.width, height: screen.height,
                availWidth: screen.availWidth, availHeight: screen.availHeight,
                colorDepth: screen.colorDepth, dpr: window.devicePixelRatio};
  out.window = {outerWidth: window.outerWidth, outerHeight: window.outerHeight,
                innerWidth: window.innerWidth, innerHeight: window.innerHeight};
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.webgl = {
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    }
  } catch (e) { out.webgl = {error: String(e)}; }
  // WebRTC: gather ICE candidates for ~2.5s and report every IP seen.
  out.webrtc = await new Promise((resolve) => {
    const ips = new Set();
    let pc;
    try {
      pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]});
    } catch (e) { resolve({supported: false, ips: [], error: String(e)}); return; }
    const done = () => { try { pc.close(); } catch (_) {} resolve({supported: true, ips: Array.from(ips)}); };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      const m = /candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\S+)/.exec(ev.candidate.candidate);
      if (m) ips.add(m[1] + ' (' + m[2] + ')');
    };
    try { pc.createDataChannel('x'); pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => done()); }
    catch (e) { done(); return; }
    setTimeout(done, 2500);
  });
  return out;
}
"""

EXIT_IP_JS = r"""
async (urls) => {
  for (const url of urls) {
    try {
      const r = await fetch(url, {cache: 'no-store'});
      const t = (await r.text()).trim();
      if (t.startsWith('{')) { const j = JSON.parse(t); if (j.ip) return j.ip; }
      else if (/^[0-9a-fA-F.:]+$/.test(t)) return t;
    } catch (e) {}
  }
  return null;
}
"""


class PlaywrightSession:
    """``async with PlaywrightSession(ws) as s: await s.context.new_page()``"""

    def __init__(self, ws_endpoint: str, timeout_ms: float = 30_000):
        self.ws_endpoint = ws_endpoint
        self.timeout_ms = timeout_ms
        self._pw: Any = None
        self.browser: Any = None
        self.context: Any = None

    async def __aenter__(self) -> PlaywrightSession:
        from playwright.async_api import async_playwright

        self._pw = await async_playwright().start()
        try:
            self.browser = await self._pw.firefox.connect(self.ws_endpoint, timeout=self.timeout_ms)
        except Exception:
            await self._pw.stop()
            raise
        contexts = self.browser.contexts
        self.context = contexts[0] if contexts else await self.browser.new_context()
        return self

    async def __aexit__(self, *exc: object) -> None:
        with contextlib.suppress(Exception):
            await self.browser.close()  # closes only this client's connection
        with contextlib.suppress(Exception):
            await self._pw.stop()

    @contextlib.asynccontextmanager
    async def page(self, url: str | None = None) -> AsyncIterator[Any]:
        page = await self.context.new_page()
        try:
            if url:
                await page.goto(url, wait_until="domcontentloaded", timeout=self.timeout_ms)
            yield page
        finally:
            with contextlib.suppress(Exception):
                await page.close()


class BrowserProbe:
    """Collects observed values from a running profile (used by the self-test)."""

    def __init__(self, ip_echo_urls: tuple[str, ...]):
        self.ip_echo_urls = list(ip_echo_urls)

    async def collect(self, ws_endpoint: str, external_pages: list[str] | None = None) -> dict:
        result: dict[str, Any] = {"external_pages": []}
        async with PlaywrightSession(ws_endpoint) as session:
            async with session.page("about:blank") as page:
                result["observed"] = await page.evaluate(PROBE_JS)
                try:
                    result["exit_ip"] = await asyncio.wait_for(
                        page.evaluate(EXIT_IP_JS, self.ip_echo_urls), timeout=30
                    )
                except Exception as exc:  # noqa: BLE001
                    result["exit_ip"] = None
                    result["exit_ip_error"] = str(exc)
            for url in external_pages or []:
                entry: dict[str, Any] = {"url": url}
                try:
                    async with session.page(url) as page:
                        await page.wait_for_timeout(4000)
                        entry["title"] = await page.title()
                        entry["ok"] = True
                except Exception as exc:  # noqa: BLE001
                    entry["ok"] = False
                    entry["error"] = str(exc)
                result["external_pages"].append(entry)
        return result


async def get_cookies(ws_endpoint: str) -> list[dict[str, Any]]:
    async with PlaywrightSession(ws_endpoint) as s:
        return list(await s.context.cookies())


async def add_cookies(ws_endpoint: str, cookies: list[dict[str, Any]]) -> int:
    async with PlaywrightSession(ws_endpoint) as s:
        await s.context.add_cookies(cookies)
        return len(cookies)
