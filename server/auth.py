"""Optional password login, for when Cutroom is reachable from a network (the server edition).

Set CUTROOM_PASSWORD to turn it on. Without it the app is open, which is right for 127.0.0.1 on your own computer.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie

from .config import DATA

COOKIE = "cutroom_session"
SESSION_DAYS = 30
# The renderer fetches media from this same server. It reaches it through a path only this process knows,
# so it keeps working when everything else needs a login.
INTERNAL = secrets.token_urlsafe(24)
INTERNAL_PREFIX = f"/internal/{INTERNAL}"

_lock = threading.Lock()
_attempts: dict[str, list[float]] = {}
MAX_ATTEMPTS, WINDOW = 8, 300.0


def enabled() -> bool:
    return bool(os.environ.get("CUTROOM_PASSWORD"))


def _file():
    return DATA / "db" / "sessions.json"


def _load() -> dict[str, float]:
    try:
        return json.loads(_file().read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _save(rows: dict[str, float]) -> None:
    _file().parent.mkdir(parents=True, exist_ok=True)
    _file().write_text(json.dumps(rows), "utf-8")


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()   # only hashes are stored on disk


def throttled(ip: str) -> bool:
    now = time.time()
    with _lock:
        recent = [t for t in _attempts.get(ip, []) if now - t < WINDOW]
        _attempts[ip] = recent
        return len(recent) >= MAX_ATTEMPTS


def login(password: str, ip: str) -> str | None:
    """Returns a new session token, or None when the password is wrong."""
    expected = os.environ.get("CUTROOM_PASSWORD", "")
    if not expected or not hmac.compare_digest(password.encode(), expected.encode()):
        with _lock:
            _attempts.setdefault(ip, []).append(time.time())
        return None
    token = secrets.token_urlsafe(32)
    with _lock:
        now = time.time()
        rows = {k: v for k, v in _load().items() if v > now}
        rows[_digest(token)] = now + SESSION_DAYS * 86400
        _save(rows)
        _attempts.pop(ip, None)
    return token


def valid(token: str | None) -> bool:
    if not token:
        return False
    return _load().get(_digest(token), 0) > time.time()


def logout(token: str | None) -> None:
    if not token:
        return
    with _lock:
        rows = _load()
        rows.pop(_digest(token), None)
        _save(rows)


def token_from(headers: list[tuple[bytes, bytes]]) -> str | None:
    for name, value in headers:
        if name == b"cookie":
            jar = SimpleCookie()
            try:
                jar.load(value.decode("latin-1"))
            except Exception:
                return None
            return jar[COOKIE].value if COOKIE in jar else None
    return None


OPEN_PATHS = {"/api/login", "/api/logout", "/api/health"}
GUARDED = ("/api/", "/media/", "/docs", "/redoc", "/openapi.json")


def _private_file(path: str) -> bool:
    """True for anything inside the data folder's db/ (settings with API keys and YouTube tokens, sessions), however
    the path is spelled: encoded, with '..', in another letter case (Windows), with backslashes, or via the
    renderer's private prefix."""
    from posixpath import normpath
    from urllib.parse import unquote
    p = unquote(path).replace("\\", "/").lower()
    if p.startswith(INTERNAL_PREFIX.lower() + "/"):
        p = p[len(INTERNAL_PREFIX):]
    p = normpath("/" + p.lstrip("/"))
    return p == "/media/db" or p.startswith("/media/db/")


class Gate:
    """ASGI middleware: lets the renderer in through its private path, and asks everyone else to be logged in."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]
        if _private_file(path):   # settings, keys, tokens and sessions are never served, to anyone
            await send({"type": "http.response.start", "status": 404, "headers": [(b"content-length", b"0")]})
            await send({"type": "http.response.body", "body": b""})
            return
        if path.startswith(INTERNAL_PREFIX + "/"):
            inner = path[len(INTERNAL_PREFIX):]
            return await self.app({**scope, "path": inner, "raw_path": inner.encode()}, receive, send)
        if path.startswith("/internal/"):   # a wrong token gets nothing, not even the app page
            await send({"type": "http.response.start", "status": 404, "headers": [(b"content-length", b"0")]})
            await send({"type": "http.response.body", "body": b""})
            return
        if enabled() and path.startswith(GUARDED) and path not in OPEN_PATHS and not valid(token_from(scope["headers"])):
            body = b'{"detail":"Sign in first."}'
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        return await self.app(scope, receive, send)
