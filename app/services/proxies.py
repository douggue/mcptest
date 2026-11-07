"""Proxies: parsing, encrypted storage, health checks and exit-IP geo lookup.

Health check = fetch the exit IP *through* the proxy, measure latency, then
look the IP up in a **local** GeoIP database (so the lookup itself never
leaks). The result (country, timezone, locale, coordinates) is what the
launcher aligns the browser to.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any
from urllib.parse import unquote, urlsplit

import httpx

from app.config import Settings
from app.db import Database, new_id, now_iso
from app.engines.base import ProxyCredentials
from app.models import (
    Geo,
    Proxy,
    ProxyBulkImport,
    ProxyCheckResult,
    ProxyCreate,
    ProxyUpdate,
)
from app.vault import Vault

log = logging.getLogger(__name__)

SCHEMES = {"http", "https", "socks5", "socks5h", "socks"}


class ProxyError(ValueError):
    pass


class ProxyNotFound(LookupError):
    pass


# -- parsing -------------------------------------------------------------------
_HOST_RE = re.compile(r"^[A-Za-z0-9.\-_\[\]:]+$")


def parse_proxy(text: str, default_scheme: str = "http") -> ProxyCreate:
    """Parse ``scheme://user:pass@host:port``, ``host:port:user:pass`` or ``host:port``.

    Credentials in URL form may be percent-encoded.
    """
    raw = text.strip()
    if not raw:
        raise ProxyError("empty proxy")
    scheme = default_scheme
    if "://" in raw:
        parts = urlsplit(raw)
        scheme = (parts.scheme or default_scheme).lower()
        if scheme == "socks5h" or scheme == "socks":
            scheme = "socks5"
        if scheme not in {"http", "https", "socks5"}:
            raise ProxyError(f"unsupported proxy scheme {parts.scheme!r}")
        if not parts.hostname or not parts.port:
            raise ProxyError(f"proxy needs host and port: {raw!r}")
        return ProxyCreate(
            scheme=scheme,  # type: ignore[arg-type]
            host=parts.hostname,
            port=parts.port,
            username=unquote(parts.username) if parts.username else None,
            password=unquote(parts.password) if parts.password else None,
        )
    if "@" in raw:  # user:pass@host:port without a scheme
        return parse_proxy(f"{default_scheme}://{raw}", default_scheme)
    # colon form. Allow an optional leading "scheme:" like socks5:host:port:user:pass
    pieces = raw.split(":")
    if pieces and pieces[0].lower() in SCHEMES and len(pieces) >= 3:
        scheme = pieces.pop(0).lower()
        if scheme in {"socks5h", "socks"}:
            scheme = "socks5"
    if len(pieces) == 2:
        host, port = pieces
        user = pwd = None
    elif len(pieces) >= 4:
        host, port, user = pieces[0], pieces[1], pieces[2]
        pwd = ":".join(pieces[3:])  # passwords may contain ':'
    else:
        raise ProxyError(f"cannot parse proxy {raw!r}")
    if not port.isdigit():
        raise ProxyError(f"bad port in {raw!r}")
    if not _HOST_RE.match(host):
        raise ProxyError(f"bad host in {raw!r}")
    return ProxyCreate(
        scheme=scheme,  # type: ignore[arg-type]
        host=host,
        port=int(port),
        username=user or None,
        password=pwd or None,
    )


# -- exit ip + geo ------------------------------------------------------------------
ExitIpFetcher = Callable[[ProxyCredentials], Awaitable[tuple[str, float]]]
GeoLookup = Callable[[str], Geo]

_IP_RE = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$")


async def fetch_exit_ip(
    creds: ProxyCredentials,
    urls: tuple[str, ...],
    timeout: float = 15.0,
) -> tuple[str, float]:
    """Return ``(exit_ip, latency_ms)`` by calling an IP echo service via the proxy."""
    scheme = "socks5" if creds.scheme == "socks5" else creds.scheme
    auth = ""
    if creds.username:
        from urllib.parse import quote

        auth = quote(creds.username, safe="")
        if creds.password:
            auth += ":" + quote(creds.password, safe="")
        auth += "@"
    proxy_url = f"{scheme}://{auth}{creds.host}:{creds.port}"
    last_error: Exception | None = None
    async with httpx.AsyncClient(proxy=proxy_url, timeout=timeout, follow_redirects=True) as client:
        for url in urls:
            t0 = time.perf_counter()
            try:
                resp = await client.get(url, headers={"User-Agent": "curl/8.0"})
                resp.raise_for_status()
                latency = (time.perf_counter() - t0) * 1000
                text = resp.text.strip()
                ip = None
                if text.startswith("{"):
                    data = resp.json()
                    ip = data.get("ip") or data.get("ip_addr") or data.get("query")
                elif _IP_RE.match(text):
                    ip = text
                if ip and _IP_RE.match(str(ip)):
                    return str(ip), latency
                last_error = ProxyError(f"unexpected response from {url}: {text[:80]!r}")
            except (httpx.HTTPError, ValueError) as exc:
                last_error = exc
    raise ProxyError(f"proxy check failed: {last_error}")


class GeoResolver:
    """Local GeoIP lookup. Prefers an explicit MaxMind City DB, else Camoufox's DB."""

    def __init__(self, geoip_db: str | None = None):
        self.geoip_db = geoip_db
        self._reader: Any = None

    def lookup(self, ip: str) -> Geo:
        if self.geoip_db:
            return self._lookup_maxmind(ip)
        return self._lookup_camoufox(ip)

    def _lookup_maxmind(self, ip: str) -> Geo:
        import geoip2.database

        if self._reader is None:
            self._reader = geoip2.database.Reader(self.geoip_db)
        r = self._reader.city(ip)
        locale = None
        try:
            from camoufox.locales import SELECTOR

            locale = SELECTOR.from_region(r.country.iso_code).as_string
        except Exception:
            locale = None
        return Geo(
            country=r.country.iso_code,
            region=(r.subdivisions.most_specific.name if r.subdivisions else None),
            city=r.city.name,
            timezone=r.location.time_zone,
            locale=locale,
            latitude=r.location.latitude,
            longitude=r.location.longitude,
            accuracy=float(r.location.accuracy_radius) if r.location.accuracy_radius else None,
        )

    @staticmethod
    def _lookup_camoufox(ip: str) -> Geo:
        from camoufox.geolocation import get_geolocation

        g = get_geolocation(ip)
        return Geo(
            country=g.locale.region,
            timezone=g.timezone,
            locale=g.locale.as_string,
            latitude=g.latitude,
            longitude=g.longitude,
            accuracy=g.accuracy,
        )


# -- service ---------------------------------------------------------------------------
class ProxyService:
    def __init__(
        self,
        db: Database,
        vault: Vault,
        settings: Settings,
        *,
        exit_ip_fetcher: ExitIpFetcher | None = None,
        geo_lookup: GeoLookup | None = None,
    ):
        self.db = db
        self.vault = vault
        self.settings = settings
        self._fetch_exit_ip = exit_ip_fetcher or (
            lambda creds: fetch_exit_ip(creds, settings.ip_echo_urls, settings.proxy_check_timeout)
        )
        self._geo_lookup = geo_lookup or GeoResolver(settings.geoip_db).lookup

    # -- crud ---------------------------------------------------------------------
    def create(self, data: ProxyCreate) -> Proxy:
        pid = new_id()
        self.db.execute(
            """INSERT INTO proxies(id,label,scheme,host,port,username,password_enc,sticky,
               created_at) VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                pid,
                data.label,
                data.scheme,
                data.host,
                data.port,
                data.username,
                self.vault.encrypt(data.password) if data.password else None,
                int(data.sticky),
                now_iso(),
            ),
        )
        self.db.record_event("proxy.created", proxy_id=pid, host=data.host)
        return self.get(pid)

    def bulk_import(self, data: ProxyBulkImport) -> tuple[list[Proxy], list[str]]:
        created: list[Proxy] = []
        errors: list[str] = []
        for i, line in enumerate(data.text.splitlines(), start=1):
            if not line.strip() or line.strip().startswith("#"):
                continue
            try:
                parsed = parse_proxy(line, data.default_scheme)
            except ProxyError as exc:
                errors.append(f"line {i}: {exc}")
                continue
            if data.label_prefix:
                parsed.label = f"{data.label_prefix}-{len(created) + 1}"
            created.append(self.create(parsed))
        return created, errors

    def get(self, proxy_id: str) -> Proxy:
        row = self.db.fetchone("SELECT * FROM proxies WHERE id=?", (proxy_id,))
        if not row:
            raise ProxyNotFound(proxy_id)
        return self._to_model(row)

    def list(self) -> list[Proxy]:
        rows = self.db.fetchall("SELECT * FROM proxies ORDER BY created_at DESC")
        return [self._to_model(r) for r in rows]

    def update(self, proxy_id: str, data: ProxyUpdate) -> Proxy:
        self.get(proxy_id)
        fields = data.model_dump(exclude_unset=True)
        sets: list[str] = []
        params: list[Any] = []
        for key, value in fields.items():
            if key == "password":
                sets.append("password_enc=?")
                params.append(self.vault.encrypt(value) if value else None)
            elif key == "sticky":
                sets.append("sticky=?")
                params.append(int(bool(value)))
            else:
                sets.append(f"{key}=?")
                params.append(value)
        if any(k in fields for k in ("scheme", "host", "port", "username", "password")):
            # connection details changed: forget old health info
            sets += ["healthy=NULL", "last_exit_ip=NULL", "last_geo=NULL", "last_error=NULL"]
        if sets:
            params.append(proxy_id)
            self.db.execute(f"UPDATE proxies SET {', '.join(sets)} WHERE id=?", tuple(params))
        return self.get(proxy_id)

    def delete(self, proxy_id: str) -> None:
        self.get(proxy_id)
        self.db.execute("DELETE FROM proxies WHERE id=?", (proxy_id,))
        self.db.record_event("proxy.deleted", proxy_id=proxy_id)

    def credentials(self, proxy_id: str) -> ProxyCredentials:
        row = self.db.fetchone("SELECT * FROM proxies WHERE id=?", (proxy_id,))
        if not row:
            raise ProxyNotFound(proxy_id)
        return ProxyCredentials(
            scheme=row["scheme"],
            host=row["host"],
            port=row["port"],
            username=row["username"],
            password=self.vault.decrypt_str(row["password_enc"]),
        )

    # -- health -------------------------------------------------------------------
    async def check(self, proxy_id: str) -> ProxyCheckResult:
        creds = self.credentials(proxy_id)
        try:
            exit_ip, latency = await self._fetch_exit_ip(creds)
            geo = await asyncio.to_thread(self._safe_geo, exit_ip)
        except Exception as exc:  # noqa: BLE001 - every failure means "unhealthy"
            self.db.execute(
                "UPDATE proxies SET healthy=0, last_error=?, last_checked_at=? WHERE id=?",
                (str(exc)[:500], now_iso(), proxy_id),
            )
            self.db.record_event("proxy.check_failed", proxy_id=proxy_id, error=str(exc))
            return ProxyCheckResult(proxy_id=proxy_id, healthy=False, error=str(exc))
        self.db.execute(
            """UPDATE proxies SET healthy=1, last_error=NULL, last_exit_ip=?, last_geo=?,
               last_latency_ms=?, last_checked_at=? WHERE id=?""",
            (exit_ip, geo.model_dump_json(), latency, now_iso(), proxy_id),
        )
        shared = [
            r["id"]
            for r in self.db.fetchall(
                "SELECT id FROM proxies WHERE last_exit_ip=? AND id<>?", (exit_ip, proxy_id)
            )
        ]
        if shared:
            self.db.record_event(
                "proxy.shared_exit_ip", proxy_id=proxy_id, exit_ip=exit_ip, shared_with=shared
            )
        return ProxyCheckResult(
            proxy_id=proxy_id,
            healthy=True,
            exit_ip=exit_ip,
            geo=geo,
            latency_ms=round(latency, 1),
            shared_with=shared,
        )

    def _safe_geo(self, ip: str) -> Geo:
        try:
            return self._geo_lookup(ip)
        except Exception as exc:  # unknown IP etc. -> still healthy, no geo
            log.warning("geo lookup failed for %s: %s", ip, exc)
            return Geo()

    async def check_all(self) -> list[ProxyCheckResult]:
        ids = [p.id for p in self.list()]
        sem = asyncio.Semaphore(8)

        async def one(pid: str) -> ProxyCheckResult:
            async with sem:
                return await self.check(pid)

        return list(await asyncio.gather(*(one(p) for p in ids)))

    def shared_exit_ips(self) -> dict[str, list[str]]:
        rows = self.db.fetchall(
            """SELECT last_exit_ip AS ip, GROUP_CONCAT(id) AS ids FROM proxies
               WHERE last_exit_ip IS NOT NULL GROUP BY last_exit_ip HAVING COUNT(*) > 1"""
        )
        return {r["ip"]: r["ids"].split(",") for r in rows}

    # -- helpers ------------------------------------------------------------------
    def _to_model(self, row: Any) -> Proxy:
        count = self.db.fetchone(
            "SELECT COUNT(*) AS n FROM profiles WHERE proxy_id=?", (row["id"],)
        )
        return Proxy(
            id=row["id"],
            label=row["label"],
            scheme=row["scheme"],
            host=row["host"],
            port=row["port"],
            username=row["username"],
            has_password=row["password_enc"] is not None,
            sticky=bool(row["sticky"]),
            last_exit_ip=row["last_exit_ip"],
            last_geo=Geo(**json.loads(row["last_geo"])) if row["last_geo"] else None,
            last_latency_ms=row["last_latency_ms"],
            last_checked_at=row["last_checked_at"],
            last_error=row["last_error"],
            healthy=None if row["healthy"] is None else bool(row["healthy"]),
            created_at=row["created_at"],
            profile_count=count["n"] if count else 0,
        )
