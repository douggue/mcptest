from __future__ import annotations

import itertools
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.engines.base import ProxyCredentials
from app.engines.mock_engine import MockEngine
from app.main import build_context, create_app
from app.models import Geo
from app.services.fingerprints import FingerprintService
from app.services.proxies import ProxyError, ProxyService
from app.vault import Vault

MASTER_KEY = bytes(range(32))
EXIT_IP = "203.0.113.5"
GEO = Geo(
    country="DE",
    timezone="Europe/Berlin",
    locale="de-DE",
    latitude=52.52,
    longitude=13.405,
)

_fp_counter = itertools.count(1)


def fake_generate(**kwargs: Any) -> dict[str, Any]:
    """Deterministic, internally consistent fingerprints; each call differs."""
    n = next(_fp_counter)
    os_name = kwargs.get("os", "windows")
    ua_os = {
        "windows": "Windows NT 10.0; Win64; x64",
        "macos": "Macintosh; Intel Mac OS X 10.15",
        "linux": "X11; Linux x86_64",
    }[os_name]
    platform = {"windows": "Win32", "macos": "MacIntel", "linux": "Linux x86_64"}[os_name]
    width = 1920 if n % 2 else 2560
    screen = kwargs.get("screen") or {}
    if screen.get("max_width"):
        width = min(width, screen["max_width"])
    return {
        "browser": "Firefox",
        "os": os_name.title(),
        "navigator": {
            "userAgent": f"Mozilla/5.0 ({ua_os}; rv:146.0) Gecko/20100101 Firefox/146.0",
            "platform": platform,
            "languages": ["en-US", "en"],
            "language": "en-US",
            "hardwareConcurrency": 8 + (n % 3) * 4,
        },
        "screen": {"width": width, "height": 1080 if width == 1920 else 1440, "colorDepth": 24},
        "window": {"outerWidth": width - 20, "outerHeight": 1000},
        "webgl": {"vendor": "Google Inc. (NVIDIA)", "renderer": f"ANGLE (NVIDIA GeForce {n})"},
        "intl": {"timeZone": "UTC"},
    }


async def fake_fetch_exit_ip(creds: ProxyCredentials) -> tuple[str, float]:
    if creds.host.startswith("dead"):
        raise ProxyError("connection refused")
    if creds.host.startswith("shared"):
        return EXIT_IP, 20.0
    # distinct exit IPs per host otherwise
    last = sum(ord(c) for c in creds.host) % 200 + 10
    return (EXIT_IP if creds.host == "proxy.example" else f"198.51.100.{last}"), 12.5


def fake_geo_lookup(ip: str) -> Geo:
    if ip == EXIT_IP:
        return GEO.model_copy()
    return Geo(
        country="US", timezone="America/New_York", locale="en-US", latitude=40.7, longitude=-74.0
    )


class FakeCollector:
    """Pretends to be the browser probe. Reads the mock engine's last launch spec."""

    def __init__(self, engine: MockEngine):
        self.engine = engine
        self.overrides: dict[str, Any] = {}
        self.fail_with: Exception | None = None

    async def __call__(self, ws_endpoint: str, external_pages: list[str] | None) -> dict[str, Any]:
        if self.fail_with:
            raise self.fail_with
        spec = next(s for s in reversed(self.engine.launched) if ws_endpoint.endswith(s.profile_id))
        fp = spec.fingerprint
        geo = spec.geo
        observed = {
            "userAgent": fp["navigator"]["userAgent"],
            "platform": fp["navigator"]["platform"],
            "languages": [geo.locale, geo.locale.split("-")[0]]
            if geo and geo.locale
            else fp["navigator"]["languages"],
            "hardwareConcurrency": fp["navigator"]["hardwareConcurrency"],
            "timezone": geo.timezone if geo and geo.timezone else "UTC",
            "screen": dict(fp["screen"]),
            "webrtc": {
                "supported": True,
                "ips": [f"{spec.exit_ip} (srflx)"] if spec.exit_ip else [],
            },
        }
        observed.update(self.overrides.get("observed", {}))
        return {
            "observed": observed,
            "exit_ip": self.overrides.get("exit_ip", spec.exit_ip),
            "external_pages": [{"url": u, "ok": True, "title": "x"} for u in external_pages or []],
        }


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    s = Settings(data_dir=tmp_path / "data", engine="mock", auto_selftest=False)
    s.ensure_dirs()
    return s


@pytest.fixture
def engine() -> MockEngine:
    return MockEngine()


@pytest.fixture
def vault() -> Vault:
    return Vault(master_key=MASTER_KEY)


@pytest.fixture
def collector(engine: MockEngine) -> FakeCollector:
    return FakeCollector(engine)


@pytest.fixture
def ctx(settings: Settings, engine: MockEngine, vault: Vault, collector: FakeCollector):
    c = build_context(
        settings,
        engine=engine,
        vault=vault,
        fingerprints=FingerprintService(fake_generate),
        proxies_service=None,
        collector=collector,
    )
    # swap in the proxy service with fakes but sharing the context's db
    c.proxies = ProxyService(
        c.db, vault, settings, exit_ip_fetcher=fake_fetch_exit_ip, geo_lookup=fake_geo_lookup
    )
    c.profiles.proxies = c.proxies
    c.launcher.proxies = c.proxies
    c.selftest.proxies = c.proxies
    c.backup.proxies = c.proxies
    yield c
    c.db.close()


@pytest.fixture
def client(settings: Settings, ctx) -> Iterator[TestClient]:
    app = create_app(settings, ctx=ctx)
    with TestClient(app) as c:
        c.headers["Authorization"] = f"Bearer {ctx.token}"
        yield c
