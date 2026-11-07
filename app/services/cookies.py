"""Cookie import/export in JSON (Playwright-style) and Netscape ``cookies.txt``.

Cookies live inside the Firefox profile. Reading or writing them goes through
the running browser, so the launcher starts the profile briefly when needed.
"""

from __future__ import annotations

import json
import time
from typing import Any

from app.models import Cookie, CookieImport

NETSCAPE_HEADER = "# Netscape HTTP Cookie File\n# Exported by MultiProfile\n\n"


def parse_netscape(text: str) -> list[Cookie]:
    out: list[Cookie] = []
    for raw in text.splitlines():
        line = raw.strip()
        http_only = False
        if line.startswith("#HttpOnly_"):
            http_only = True
            line = line[len("#HttpOnly_") :]
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        domain, _flag, path, secure, expiry, name, value = parts[:7]
        exp = float(expiry) if expiry and expiry != "0" else None
        out.append(
            Cookie(
                name=name,
                value=value,
                domain=domain,
                path=path or "/",
                expires=exp,
                http_only=http_only,
                secure=secure.upper() == "TRUE",
            )
        )
    return out


def to_netscape(cookies: list[Cookie]) -> str:
    lines = [NETSCAPE_HEADER.rstrip("\n")]
    for c in cookies:
        flag = "TRUE" if c.domain.startswith(".") else "FALSE"
        expiry = str(int(c.expires)) if c.expires else "0"
        prefix = "#HttpOnly_" if c.http_only else ""
        lines.append(
            "\t".join(
                [
                    prefix + c.domain,
                    flag,
                    c.path,
                    "TRUE" if c.secure else "FALSE",
                    expiry,
                    c.name,
                    c.value,
                ]
            )
        )
    return "\n".join(lines) + "\n"


def parse_json(text: str) -> list[Cookie]:
    data = json.loads(text)
    if isinstance(data, dict):
        data = data.get("cookies", [])
    out: list[Cookie] = []
    for item in data:
        exp = item.get("expires", item.get("expirationDate"))
        if exp in (None, -1, "", 0):
            exp = None
        same_site = item.get("sameSite")
        if isinstance(same_site, str):
            same_site = {
                "strict": "Strict",
                "lax": "Lax",
                "none": "None",
                "no_restriction": "None",
            }.get(same_site.lower())
        out.append(
            Cookie(
                name=item["name"],
                value=str(item.get("value", "")),
                domain=item.get("domain") or "",
                path=item.get("path") or "/",
                expires=float(exp) if exp is not None else None,
                http_only=bool(item.get("httpOnly", item.get("http_only", False))),
                secure=bool(item.get("secure", False)),
                same_site=same_site,
            )
        )
    return out


def from_request(data: CookieImport) -> list[Cookie]:
    if data.cookies:
        return list(data.cookies)
    if not data.text:
        raise ValueError("provide either `cookies` or `text`")
    if data.format == "netscape":
        return parse_netscape(data.text)
    return parse_json(data.text)


def to_playwright(cookies: list[Cookie]) -> list[dict[str, Any]]:
    out = []
    now = time.time()
    for c in cookies:
        if c.expires and c.expires < now:
            continue  # already expired
        d: dict[str, Any] = {
            "name": c.name,
            "value": c.value,
            "domain": c.domain,
            "path": c.path,
            "httpOnly": c.http_only,
            "secure": c.secure,
        }
        if c.expires:
            d["expires"] = c.expires
        if c.same_site:
            d["sameSite"] = c.same_site
        out.append(d)
    return out


def from_playwright(raw: list[dict[str, Any]]) -> list[Cookie]:
    out = []
    for item in raw:
        exp = item.get("expires")
        out.append(
            Cookie(
                name=item["name"],
                value=item.get("value", ""),
                domain=item.get("domain", ""),
                path=item.get("path", "/"),
                expires=None if exp in (None, -1) else float(exp),
                http_only=bool(item.get("httpOnly")),
                secure=bool(item.get("secure")),
                same_site=item.get("sameSite"),
            )
        )
    return out
