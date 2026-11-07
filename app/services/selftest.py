"""Leak and consistency self-test.

Starts the profile if needed, collects what the browser actually exposes
(``BrowserProbe``), and compares it with what it *should* expose: the stored
fingerprint, the proxy's exit IP and the proxy-derived geo. A deliberately
broken config (no proxy, wrong timezone) fails with a clear reason.
"""

from __future__ import annotations

import contextlib
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.db import Database, new_id, now_iso
from app.models import CheckResult, Geo, SelfTestReport
from app.services.launcher import LaunchManager
from app.services.profiles import ProfileService
from app.services.proxies import ProxyService

log = logging.getLogger(__name__)

Collector = Callable[[str, list[str] | None], Awaitable[dict[str, Any]]]

# Public pages a person may want to eyeball. Off by default: they are slow and
# every page is a third party. Enable per run with ``external=True``.
EXTERNAL_PAGES = [
    "https://browserleaks.com/webrtc",
    "https://browserleaks.com/ip",
    "https://abrahamjuliot.github.io/creepjs/",
    "https://www.dnsleaktest.com/",
]


def _norm_lang(value: str | None) -> str | None:
    return value.lower().replace("_", "-") if value else None


def compare(
    observed: dict[str, Any],
    fingerprint: dict[str, Any],
    *,
    exit_ip_seen: str | None,
    proxy_exit_ip: str | None,
    has_proxy: bool,
    expected_geo: Geo | None,
    webrtc_mode: str,
) -> list[CheckResult]:
    """Pure comparison so it is unit-testable without a browser."""
    checks: list[CheckResult] = []
    nav = fingerprint.get("navigator", {}) or {}
    scr = fingerprint.get("screen", {}) or {}

    # 1. A proxy exists at all.
    checks.append(
        CheckResult(
            name="proxy_assigned",
            passed=has_proxy,
            expected="a proxy",
            actual="proxy" if has_proxy else "direct connection",
            reason=None if has_proxy else "no proxy assigned: the real IP is exposed",
        )
    )
    # 2. Traffic leaves through the proxy.
    if has_proxy:
        ok = bool(exit_ip_seen) and exit_ip_seen == proxy_exit_ip
        checks.append(
            CheckResult(
                name="exit_ip_matches_proxy",
                passed=ok,
                expected=proxy_exit_ip,
                actual=exit_ip_seen,
                reason=None
                if ok
                else (
                    "could not determine exit IP from inside the browser"
                    if not exit_ip_seen
                    else "browser traffic does not exit through the proxy"
                ),
            )
        )
    # 3. WebRTC never shows anything but the proxy IP.
    rtc = observed.get("webrtc") or {}
    rtc_ips = [s.split(" ")[0] for s in rtc.get("ips", [])]
    public_rtc = [ip for ip in rtc_ips if not _is_private(ip)]
    if webrtc_mode == "block":
        ok = not rtc.get("supported", True) or not rtc_ips
        reason = None if ok else f"WebRTC is supposed to be blocked but produced {rtc_ips}"
    else:
        leaked = [ip for ip in public_rtc if proxy_exit_ip and ip != proxy_exit_ip]
        if not has_proxy:
            leaked = public_rtc
        ok = not leaked
        reason = None if ok else f"WebRTC exposes non-proxy IP(s): {leaked}"
    checks.append(
        CheckResult(
            name="webrtc_no_leak",
            passed=ok,
            expected=proxy_exit_ip if webrtc_mode == "proxy" else "no candidates",
            actual=rtc_ips,
            reason=reason,
        )
    )
    # 4. Timezone matches the IP geo (or the manual override).
    if expected_geo and expected_geo.timezone:
        ok = observed.get("timezone") == expected_geo.timezone
        checks.append(
            CheckResult(
                name="timezone_matches_geo",
                passed=ok,
                expected=expected_geo.timezone,
                actual=observed.get("timezone"),
                reason=None if ok else "browser timezone does not match the proxy location",
            )
        )
    # 5. Language matches.
    if expected_geo and expected_geo.locale:
        want = _norm_lang(expected_geo.locale)
        langs = [_norm_lang(x) for x in observed.get("languages") or []]
        ok = bool(langs) and (langs[0] == want or langs[0].split("-")[0] == want.split("-")[0])
        checks.append(
            CheckResult(
                name="language_matches_geo",
                passed=ok,
                expected=expected_geo.locale,
                actual=observed.get("languages"),
                reason=None
                if ok
                else "Accept-Language / navigator.languages do not match the proxy country",
            )
        )
    # 6. Fingerprint is the stored one (stability) and self-consistent.
    checks.append(
        CheckResult(
            name="user_agent_is_stored",
            passed=observed.get("userAgent") == nav.get("userAgent"),
            expected=nav.get("userAgent"),
            actual=observed.get("userAgent"),
            reason=None
            if observed.get("userAgent") == nav.get("userAgent")
            else "user agent differs from the frozen fingerprint",
        )
    )
    checks.append(
        CheckResult(
            name="platform_is_stored",
            passed=observed.get("platform") == nav.get("platform"),
            expected=nav.get("platform"),
            actual=observed.get("platform"),
        )
    )
    ua = observed.get("userAgent") or ""
    plat = observed.get("platform") or ""
    consistent = (
        ("Windows" in ua and plat.startswith("Win"))
        or ("Macintosh" in ua and plat.startswith("Mac"))
        or ("Linux" in ua and plat.startswith("Linux"))
    )
    checks.append(
        CheckResult(
            name="ua_platform_consistent",
            passed=consistent,
            expected="UA OS == navigator.platform",
            actual={"userAgent": ua, "platform": plat},
            reason=None if consistent else "user agent OS and navigator.platform disagree",
        )
    )
    obs_scr = observed.get("screen") or {}
    if scr.get("width"):
        ok = obs_scr.get("width") == scr.get("width") and obs_scr.get("height") == scr.get("height")
        checks.append(
            CheckResult(
                name="screen_is_stored",
                passed=ok,
                expected=f"{scr.get('width')}x{scr.get('height')}",
                actual=f"{obs_scr.get('width')}x{obs_scr.get('height')}",
            )
        )
    if nav.get("hardwareConcurrency"):
        ok = observed.get("hardwareConcurrency") == nav.get("hardwareConcurrency")
        checks.append(
            CheckResult(
                name="cores_are_stored",
                passed=ok,
                expected=nav.get("hardwareConcurrency"),
                actual=observed.get("hardwareConcurrency"),
            )
        )
    return checks


def _is_private(ip: str) -> bool:
    import ipaddress

    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True  # mDNS hostnames like xxxx.local are not leaks
    return addr.is_private or addr.is_loopback or addr.is_link_local


class SelfTestService:
    def __init__(
        self,
        db: Database,
        profiles: ProfileService,
        proxies: ProxyService,
        launcher: LaunchManager,
        collector: Collector,
    ):
        self.db = db
        self.profiles = profiles
        self.proxies = proxies
        self.launcher = launcher
        self.collector = collector

    async def run(self, profile_id: str, *, external: bool = False) -> SelfTestReport:
        profile = self.profiles.get(profile_id)
        started_here = False
        error: str | None = None
        checks: list[CheckResult] = []
        pages: list[dict[str, Any]] = []
        try:
            handle, already = await self.launcher.start(profile_id)
            started_here = not already
            proxy_exit_ip = None
            expected_geo: Geo | None = None
            if profile.proxy_id:
                p = self.proxies.get(profile.proxy_id)
                proxy_exit_ip = p.last_exit_ip
                expected_geo = p.last_geo
            row = self.profiles._row(profile_id)
            expected_geo = self.profiles.resolve_geo(row, expected_geo)
            data = await self.collector(handle.ws_endpoint, EXTERNAL_PAGES if external else None)
            pages = data.get("external_pages", [])
            checks = compare(
                data.get("observed", {}),
                self.profiles.fingerprint(profile_id),
                exit_ip_seen=data.get("exit_ip"),
                proxy_exit_ip=proxy_exit_ip,
                has_proxy=bool(profile.proxy_id),
                expected_geo=expected_geo,
                webrtc_mode=profile.launch_options.webrtc,
            )
        except Exception as exc:  # noqa: BLE001 - a failed run is a failed test
            log.exception("self-test for %s crashed", profile_id)
            error = f"{type(exc).__name__}: {exc}"
        finally:
            if started_here:
                with contextlib.suppress(Exception):
                    await self.launcher.stop(profile_id)
        passed = error is None and all(c.passed for c in checks)
        report = SelfTestReport(
            id=new_id(),
            profile_id=profile_id,
            ran_at=now_iso(),
            passed=passed,
            checks=checks,
            external_pages=pages,
            error=error,
        )
        self.db.execute(
            "INSERT INTO selftests(id, profile_id, ran_at, passed, report) VALUES (?,?,?,?,?)",
            (report.id, profile_id, report.ran_at, int(passed), report.model_dump_json()),
        )
        self.db.record_event(
            "selftest.finished",
            profile_id,
            passed=passed,
            failed=[c.name for c in checks if not c.passed],
            error=error,
        )
        return report

    def history(self, profile_id: str, limit: int = 20) -> list[SelfTestReport]:
        rows = self.db.fetchall(
            "SELECT report FROM selftests WHERE profile_id=? ORDER BY ran_at DESC LIMIT ?",
            (profile_id, limit),
        )
        return [SelfTestReport(**json.loads(r["report"])) for r in rows]

    def latest(self, profile_id: str) -> SelfTestReport | None:
        hist = self.history(profile_id, 1)
        return hist[0] if hist else None
