"""YouTube Data API v3 with the owner's own Google Cloud OAuth client.

Plain HTTPS calls (urllib), no Google client library:
  * OAuth 2.0 authorization code flow with PKCE and a `state` value, offline access for a refresh token;
  * channels.list mine=true to learn which channel the owner picked;
  * videos.insert as a resumable upload, sent in chunks, resumed after transient failures;
  * videos.list part=statistics,status for views, likes and comments.

Every Google base URL can be pointed elsewhere with an environment variable (see BASES), so a local stand-in
server can play Google in tests.

Tokens live in settings.json next to the other secrets (key `youtube_channels`). Nothing here returns a token
or the client secret to the browser: `public_channel` is the only shape the API hands out.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import json
import os
import random
import re
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..config import get_settings, save_settings
from ..media import MediaError

SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"]
CALLBACK_PATH = "/api/youtube/callback"

# environment variable -> default base URL
BASES = {
    "auth": ("CUTROOM_GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth"),
    "token": ("CUTROOM_GOOGLE_TOKEN_URL", "https://oauth2.googleapis.com/token"),
    "revoke": ("CUTROOM_GOOGLE_REVOKE_URL", "https://oauth2.googleapis.com/revoke"),
    "api": ("CUTROOM_YOUTUBE_API_URL", "https://www.googleapis.com/youtube/v3"),
    "upload": ("CUTROOM_YOUTUBE_UPLOAD_URL", "https://www.googleapis.com/upload/youtube/v3"),
}

CHUNK = 256 * 1024                 # resumable chunks must be a multiple of 256 KiB
DEFAULT_CHUNK = 32 * CHUNK         # 8 MiB
MAX_RETRIES = 8
PRIVACY = ("private", "unlisted", "public")

UNVERIFIED_NOTE = (
    "Google keeps videos uploaded through an OAuth app it has not verified (any app created after July 2020) private "
    "until the app passes a YouTube API audit. A personal app normally stays unverified, so expect uploads to be "
    "private: switch them to public in YouTube Studio, or apply for the audit in the Google Cloud console."
)
QUOTA_NOTE = (
    "YouTube's daily quota for your Google Cloud project is used up. Each project gets 10,000 units a day and one "
    "upload costs about 1,600, so about six uploads a day. The quota resets at midnight Pacific time; you can ask "
    "for more in the Google Cloud console under the YouTube Data API's quotas."
)
TESTING_NOTE = (
    "If your OAuth consent screen is still set to Testing, Google ends the connection after 7 days; set its "
    "publishing status to In production to stop that."
)


def base(name: str) -> str:
    env, default = BASES[name]
    return (os.environ.get(env, "").strip() or default).rstrip("/")


class YouTubeError(MediaError):
    """A problem worth showing to the person as it is."""

    def __init__(self, text: str, reason: str = "", status: int = 0, reconnect: bool = False):
        super().__init__(text)
        self.reason = reason
        self.status = status
        self.reconnect = reconnect


# ---------------------------------------------------------------- HTTP

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A resumable upload answers 308 Resume Incomplete, which is not a redirect to follow."""

    def redirect_request(self, *args, **kwargs):  # noqa: D401
        return None


_opener = urllib.request.build_opener(_NoRedirect)
TRANSIENT = (urllib.error.URLError, http.client.HTTPException, ConnectionError, socket.timeout, TimeoutError)


def _http(method: str, url: str, data: Any = None, headers: dict | None = None,
          timeout: float = 60) -> tuple[int, dict[str, str], bytes]:
    """One request. Returns (status, headers, body) for every HTTP status; raises only on network failure."""
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with _opener.open(req, timeout=timeout) as res:
            return res.status, {k.lower(): v for k, v in res.headers.items()}, res.read()
    except urllib.error.HTTPError as e:
        try:
            body = e.read()
        except Exception:
            body = b""
        return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, body


def _json(raw: bytes) -> dict:
    try:
        out = json.loads(raw.decode("utf-8") or "{}")
        return out if isinstance(out, dict) else {}
    except (ValueError, UnicodeDecodeError):
        return {}


def _offline(e: Exception) -> YouTubeError:
    return YouTubeError(f"Could not reach Google ({e.__class__.__name__}: {str(e)[:160]}). Check the internet connection and try again.",
                        reason="network")


# ---------------------------------------------------------------- stored channels

_lock = threading.RLock()
PUBLIC_FIELDS = ("id", "title", "handle", "thumbnail", "account_id", "connected", "needs_reconnect", "problem",
                 "can_upload", "checked")


def client() -> tuple[str, str]:
    s = get_settings()
    cid, secret = str(s.get("youtube_client_id") or "").strip(), str(s.get("youtube_client_secret") or "").strip()
    if not cid or not secret:
        raise YouTubeError("Paste your Google OAuth client ID and secret under Settings → YouTube and save them first.",
                           reason="no_client")
    return cid, secret


def channels() -> list[dict]:
    return [dict(c) for c in get_settings().get("youtube_channels") or [] if isinstance(c, dict) and c.get("id")]


def get_channel(channel_id: str) -> dict | None:
    return next((c for c in channels() if c["id"] == channel_id), None)


def _store(rows: list[dict]) -> None:
    save_settings({"youtube_channels": rows})


def patch_channel(channel_id: str, patch: dict) -> dict | None:
    with _lock:
        rows = channels()
        for r in rows:
            if r["id"] == channel_id:
                r.update(patch)
                _store(rows)
                return r
    return None


def public_channel(c: dict) -> dict:
    return {k: c.get(k) for k in PUBLIC_FIELDS}


def list_public() -> list[dict]:
    return [public_channel(c) for c in channels()]


def remove_channel(channel_id: str) -> dict | None:
    """Forget a channel and ask Google to revoke its token (best effort: it is forgotten either way)."""
    with _lock:
        rows = channels()
        gone = next((c for c in rows if c["id"] == channel_id), None)
        if not gone:
            return None
        _store([c for c in rows if c["id"] != channel_id])
    token = gone.get("refresh_token") or gone.get("access_token")
    if token:
        try:
            _http("POST", base("revoke"), urllib.parse.urlencode({"token": token}).encode(),
                  {"Content-Type": "application/x-www-form-urlencoded"}, timeout=15)
        except TRANSIENT:
            pass
    return gone


def reconnect_text(c: dict) -> str:
    return (f"The connection to {c.get('title') or 'this channel'} has expired or was revoked. "
            f"Reconnect it under Settings → YouTube. {TESTING_NOTE}")


def _mark_reconnect(c: dict, detail: str = "") -> YouTubeError:
    text = reconnect_text(c)
    patch_channel(c["id"], {"needs_reconnect": True, "problem": text, "access_token": "", "expires_at": 0})
    return YouTubeError(text + (f" (Google said: {detail})" if detail else ""), reason="reconnect", reconnect=True)


# ---------------------------------------------------------------- OAuth

_pending: dict[str, dict] = {}
PENDING_TTL = 15 * 60


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def begin_connect(redirect_uri: str, account_id: str = "") -> str:
    """The Google consent page URL for a new (or re-) connection. Remembers state and the PKCE verifier."""
    client_id, _ = client()
    verifier = _b64url(secrets.token_bytes(48))            # 64 characters, inside PKCE's 43..128
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    state = secrets.token_urlsafe(24)
    now = time.time()
    with _lock:
        for k in [k for k, v in _pending.items() if now - v["created"] > PENDING_TTL]:
            _pending.pop(k, None)
        _pending[state] = {"verifier": verifier, "redirect_uri": redirect_uri, "account_id": account_id, "created": now}
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",          # ask for a refresh token
        "include_granted_scopes": "true",
        "prompt": "consent select_account",  # always return a refresh token, and let the owner pick a brand channel
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return base("auth") + "?" + urllib.parse.urlencode(params)


def _token_request(fields: dict, refreshing: bool) -> dict:
    try:
        status, _, raw = _http("POST", base("token"), urllib.parse.urlencode(fields).encode(),
                               {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}, timeout=30)
    except TRANSIENT as e:
        raise _offline(e)
    data = _json(raw)
    if status == 200 and data.get("access_token"):
        return data
    err, desc = str(data.get("error") or ""), str(data.get("error_description") or "")
    if err == "invalid_client":
        raise YouTubeError("Google did not accept the OAuth client ID or secret. Check both under Settings → YouTube.", reason=err, status=status)
    if err == "redirect_uri_mismatch":
        raise YouTubeError(f"Google says the redirect URL ({fields.get('redirect_uri', '')}) is not listed on your OAuth client. "
                           "Add it under Authorized redirect URIs in the Google Cloud console.", reason=err, status=status)
    if err == "unauthorized_client":
        raise YouTubeError("Google does not let this OAuth client use this sign-in method. Create a client of type Desktop app or Web application.",
                           reason=err, status=status)
    if err == "invalid_grant":
        raise YouTubeError(desc or "invalid_grant", reason="invalid_grant", status=status, reconnect=refreshing)
    if status >= 500:
        raise YouTubeError(f"Google's sign-in service had a problem ({status}). Try again in a minute.", reason="server", status=status)
    raise YouTubeError(f"Google refused the sign-in: {desc or err or status}.", reason=err, status=status)


def _fetch_mine(access_token: str) -> dict:
    url = base("api") + "/channels?" + urllib.parse.urlencode({"part": "snippet", "mine": "true", "maxResults": 50})
    try:
        status, _, raw = _http("GET", url, headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"})
    except TRANSIENT as e:
        raise _offline(e)
    if status != 200:
        raise api_error(status, raw, "look up your channel")
    items = _json(raw).get("items") or []
    if not items:
        raise YouTubeError("This Google account has no YouTube channel. Create one at youtube.com, or pick the channel's "
                           "brand account when Google asks which account to use, then connect again.", reason="no_channel")
    it = items[0]
    sn = it.get("snippet") or {}
    thumbs = sn.get("thumbnails") or {}
    thumb = (thumbs.get("default") or thumbs.get("medium") or {}).get("url", "")
    return {"id": it["id"], "title": sn.get("title") or it["id"], "handle": sn.get("customUrl") or "", "thumbnail": thumb}


def finish_connect(state: str, code: str, error: str = "") -> dict:
    """Handle Google's redirect back. Returns the stored channel row (internal, with tokens) plus `account_id` wish."""
    with _lock:
        pend = _pending.pop(state or "", None)
    if not pend or time.time() - pend["created"] > PENDING_TTL:
        raise YouTubeError("This sign-in has expired or was already used. Start again with Connect channel.", reason="state")
    if error:
        if error == "access_denied":
            raise YouTubeError("You did not allow Cutroom to use the channel, so nothing was connected. If Google said the app "
                               "is only for testers, add your Google account under Test users on the OAuth consent screen.",
                               reason=error)
        raise YouTubeError(f"Google returned an error: {error}.", reason=error)
    if not code:
        raise YouTubeError("Google did not send a sign-in code. Start again with Connect channel.", reason="no_code")
    client_id, secret = client()
    try:
        tok = _token_request({
            "grant_type": "authorization_code", "code": code, "redirect_uri": pend["redirect_uri"],
            "client_id": client_id, "client_secret": secret, "code_verifier": pend["verifier"],
        }, refreshing=False)
    except YouTubeError as e:
        if e.reason == "invalid_grant":
            raise YouTubeError("Google refused the sign-in code (it may have expired). Try Connect channel again.", reason="invalid_grant")
        raise
    granted = set(str(tok.get("scope") or " ".join(SCOPES)).split())
    info = _fetch_mine(tok["access_token"])
    now = time.time()
    with _lock:
        rows = channels()
        old = next((c for c in rows if c["id"] == info["id"]), None)
        refresh = tok.get("refresh_token") or (old or {}).get("refresh_token") or ""
        if not refresh:
            raise YouTubeError("Google did not send a long-lived token. Remove Cutroom from your Google account's third-party "
                               "access page (myaccount.google.com/permissions), then connect again.", reason="no_refresh")
        row = {
            **(old or {}), **info,
            "access_token": tok["access_token"], "refresh_token": refresh,
            "expires_at": now + float(tok.get("expires_in") or 3600),
            "scopes": sorted(granted), "can_upload": SCOPES[0] in granted,
            "needs_reconnect": False,
            "problem": "" if SCOPES[0] in granted else "Cutroom was not given permission to upload. Reconnect and tick every box Google shows.",
            "connected": (old or {}).get("connected") or now, "checked": now,
            "account_id": (old or {}).get("account_id", ""),
        }
        rows = [c for c in rows if c["id"] != info["id"]] + [row]
        _store(rows)
    return {**row, "wanted_account_id": pend.get("account_id", "")}


def access_token(channel_id: str, force: bool = False) -> str:
    """A valid access token, refreshed when it is about to expire. Marks the channel when the refresh is refused."""
    with _lock:
        c = get_channel(channel_id)
        if not c:
            raise YouTubeError("That YouTube channel is not connected any more. Connect it under Settings → YouTube.", reason="no_channel")
        if c.get("needs_reconnect") or not c.get("refresh_token"):
            raise YouTubeError(c.get("problem") or reconnect_text(c), reason="reconnect", reconnect=True)
        if not force and c.get("access_token") and float(c.get("expires_at") or 0) - 60 > time.time():
            return c["access_token"]
        client_id, secret = client()
        try:
            tok = _token_request({"grant_type": "refresh_token", "refresh_token": c["refresh_token"],
                                  "client_id": client_id, "client_secret": secret}, refreshing=True)
        except YouTubeError as e:
            if e.reconnect:
                raise _mark_reconnect(c, str(e))
            raise
        patch = {"access_token": tok["access_token"], "expires_at": time.time() + float(tok.get("expires_in") or 3600),
                 "problem": "" if c.get("can_upload", True) else c.get("problem", "")}
        if tok.get("refresh_token"):
            patch["refresh_token"] = tok["refresh_token"]
        patch_channel(channel_id, patch)
        return tok["access_token"]


def _authed(channel_id: str, method: str, url: str, data: Any = None, headers: dict | None = None,
            timeout: float = 60, data_factory: Callable[[], Any] | None = None) -> tuple[int, dict, bytes]:
    """A request with the channel's token; on 401 it refreshes once and tries again."""
    for attempt in (0, 1):
        token = access_token(channel_id, force=attempt == 1)
        h = {**(headers or {}), "Authorization": f"Bearer {token}"}
        body = data_factory() if data_factory else data
        status, rh, raw = _http(method, url, body, h, timeout)
        if status != 401:
            return status, rh, raw
    c = get_channel(channel_id) or {"id": channel_id}
    raise _mark_reconnect(c, _error_parts(raw)[1])


def verify(channel_id: str) -> dict:
    """Refresh the token and re-read the channel's name; used by the Settings 'Check' button."""
    access_token(channel_id, force=True)   # proves the long-lived token still works
    try:
        status, _, raw = _authed(channel_id, "GET", base("api") + "/channels?part=snippet&mine=true")
    except TRANSIENT as e:
        raise _offline(e)
    if status != 200:
        raise api_error(status, raw, "look up the channel")
    items = _json(raw).get("items") or []
    patch: dict = {"checked": time.time()}
    if items:
        sn = items[0].get("snippet") or {}
        patch.update({"title": sn.get("title") or channel_id, "handle": sn.get("customUrl") or ""})
    return public_channel(patch_channel(channel_id, patch) or {})


# ---------------------------------------------------------------- errors from the API

def _error_parts(raw: bytes) -> tuple[str, str]:
    err = _json(raw).get("error")
    if isinstance(err, dict):
        items = err.get("errors") or [{}]
        reason = str((items[0] or {}).get("reason") or err.get("status") or "")
        for d in err.get("details") or []:   # newer error shape
            if isinstance(d, dict) and d.get("reason"):
                reason = reason or str(d["reason"])
        return reason, str(err.get("message") or "")
    if isinstance(err, str):
        return err, str(_json(raw).get("error_description") or "")
    return "", raw.decode("utf-8", "replace")[:200] if raw else ""


def api_error(status: int, raw: bytes, action: str) -> YouTubeError:
    reason, message = _error_parts(raw)
    r = reason.lower()
    if r in ("quotaexceeded", "dailylimitexceeded", "dailylimitexceededunreg"):
        return YouTubeError(QUOTA_NOTE, reason="quota", status=status)
    if r == "uploadlimitexceeded":
        return YouTubeError("This channel has reached YouTube's own limit on uploads for today. Try again tomorrow.",
                            reason="upload_limit", status=status)
    if r in ("ratelimitexceeded", "userratelimitexceeded"):
        return YouTubeError("YouTube asked Cutroom to slow down. Wait a minute and try again.", reason="rate", status=status)
    if r == "youtubesignuprequired":
        return YouTubeError("This Google account has no YouTube channel yet. Create one at youtube.com, then connect again.",
                            reason=reason, status=status)
    if r in ("insufficientpermissions", "access_token_scope_insufficient"):
        return YouTubeError("Cutroom was not given permission to do this on the channel. Reconnect it and tick every box Google shows.",
                            reason="scope", status=status)
    if r in ("invalidtitle", "invaliddescription", "invalidtags", "invalidpublishat", "invalidcategoryid",
             "invalidrecordingdetails", "invalidvideometadata", "invalidfilename"):
        what = {"invalidtitle": "title", "invaliddescription": "description", "invalidtags": "tags",
                "invalidpublishat": "scheduled publish time", "invalidcategoryid": "category"}.get(r, "video details")
        return YouTubeError(f"YouTube did not accept the {what}: {message or reason}.", reason=reason, status=status)
    if r == "mediabodyrequired" or r == "invalidvideofile" or "media" in r:
        return YouTubeError(f"YouTube did not accept the video file: {message or reason}.", reason=reason, status=status)
    text = f"YouTube refused to {action}: {message or reason or 'no reason given'} (HTTP {status})."
    if status == 403 and re.search(r"verif|audit|unverified", message, re.I):
        text += " " + UNVERIFIED_NOTE
    return YouTubeError(text, reason=reason, status=status)


# ---------------------------------------------------------------- metadata

def parse_publish_at(value: str | None) -> datetime | None:
    """An ISO time (with offset or Z) as an aware UTC datetime. A time without an offset is read as this machine's local time."""
    value = str(value or "").strip()
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise YouTubeError(f"Could not read the publish time: {value}", reason="bad_time")
    if dt.tzinfo is None:
        dt = dt.astimezone()
    return dt.astimezone(timezone.utc)


def _clean_text(s: str) -> str:
    return re.sub(r"[<>]", "", str(s or "")).strip()


def build_metadata(title: str, description: str, hashtags: list[str], privacy: str, made_for_kids: bool = False,
                   publish_at: datetime | None = None, category: str = "22", now: datetime | None = None) -> tuple[dict, list[str]]:
    """The videos.insert body (snippet + status) and plain notes about anything that was changed to fit."""
    notes: list[str] = []
    title = re.sub(r"\s+", " ", _clean_text(title))
    if not title:
        raise YouTubeError("Give the video a title first.", reason="no_title")
    if len(title) > 100:
        title = title[:99].rstrip() + "…"
        notes.append("The title was shortened to YouTube's 100 characters.")
    tags = []
    for t in hashtags or []:
        t = re.sub(r"[^\w]", "", str(t).lstrip("#"), flags=re.UNICODE)
        if t and t.lower() not in {x.lower() for x in tags}:
            tags.append(t)
    description = _clean_text(description)
    missing = [t for t in tags if not re.search(r"#" + re.escape(t) + r"\b", f"{title}\n{description}", re.I)]
    if missing:
        description = (description + "\n\n" if description else "") + " ".join("#" + t for t in missing[:15])
    while len(description.encode("utf-8")) > 5000:
        description = description[:-50]
    kept, used = [], 0
    for t in tags:
        if used + len(t) + 1 > 480:
            notes.append("Some tags were left out to stay under YouTube's 500-character limit.")
            break
        kept.append(t)
        used += len(t) + 1
    if privacy not in PRIVACY:
        raise YouTubeError(f"Unknown privacy setting: {privacy}", reason="bad_privacy")
    status: dict = {"privacyStatus": privacy, "selfDeclaredMadeForKids": bool(made_for_kids), "embeddable": True}
    if publish_at:
        now = now or datetime.now(timezone.utc)
        if publish_at <= now:
            raise YouTubeError("The scheduled publish time has already passed. Pick a later time, or post now.", reason="bad_time")
        if privacy != "private":
            notes.append("YouTube schedules a video by uploading it as private; it becomes public at the scheduled time.")
        status["privacyStatus"] = "private"
        status["publishAt"] = publish_at.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    body = {"snippet": {"title": title, "description": description, "tags": kept, "categoryId": category},
            "status": status}
    return body, notes


def video_url(video_id: str, shorts: bool = True) -> str:
    return f"https://www.youtube.com/shorts/{video_id}" if shorts else f"https://www.youtube.com/watch?v={video_id}"


# ---------------------------------------------------------------- resumable upload

def chunk_size() -> int:
    try:
        n = int(os.environ.get("CUTROOM_YOUTUBE_CHUNK_BYTES", "") or DEFAULT_CHUNK)
    except ValueError:
        n = DEFAULT_CHUNK
    return max(CHUNK, n // CHUNK * CHUNK)


def _next_offset(headers: dict) -> int:
    m = re.match(r"bytes=(\d+)-(\d+)", headers.get("range", ""))
    return int(m.group(2)) + 1 if m else 0


def _fmt_mb(n: int) -> str:
    return f"{n / 1_048_576:.1f} MB"


def _start_session(channel_id: str, body: dict, total: int) -> str:
    url = base("upload") + "/videos?" + urllib.parse.urlencode({"uploadType": "resumable", "part": "snippet,status"})
    payload = json.dumps(body).encode("utf-8")
    try:
        status, h, raw = _authed(channel_id, "POST", url, payload, {
            "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Length": str(total),
            "X-Upload-Content-Type": "video/mp4"}, timeout=60)
    except TRANSIENT as e:
        raise _offline(e)
    if status != 200 or not h.get("location"):
        raise api_error(status, raw, "start the upload")
    return h["location"]


def upload(channel_id: str, path: Path, body: dict, progress: Callable[[float, str], None],
           sleep: Callable[[float], None] = time.sleep) -> dict:
    """Send the file with YouTube's resumable protocol. `progress(fraction, message)` may raise to cancel.

    Returns the video resource YouTube sends back.
    """
    total = path.stat().st_size
    if total <= 0:
        raise YouTubeError("The video file is empty.", reason="empty")
    size = chunk_size()
    session = _start_session(channel_id, body, total)
    offset, failures, restarts, query = 0, 0, 0, False
    progress(0.0, f"Uploading 0 of {_fmt_mb(total)}")

    while True:
        if query:   # after a failure, ask YouTube how much it already has
            headers = {"Content-Length": "0", "Content-Range": f"bytes */{total}"}
            data_factory = None
        else:
            end = min(offset + size, total) - 1
            headers = {"Content-Length": str(end - offset + 1), "Content-Type": "video/mp4",
                       "Content-Range": f"bytes {offset}-{end}/{total}"}
            start = offset

            def data_factory(start=start, end=end):
                def gen():
                    with path.open("rb") as f:
                        f.seek(start)
                        pos = start
                        while pos <= end:
                            piece = f.read(min(CHUNK, end - pos + 1))
                            if not piece:
                                break
                            pos += len(piece)
                            progress(pos / total, f"Uploading {_fmt_mb(pos)} of {_fmt_mb(total)}")
                            yield piece
                return gen()
        try:
            status, h, raw = _authed(channel_id, "PUT", session, None, headers, timeout=120, data_factory=data_factory)
        except YouTubeError:
            raise
        except TRANSIENT as e:
            status, h, raw = 0, {}, str(e).encode()
        except OSError as e:          # connection reset while sending
            status, h, raw = 0, {}, str(e).encode()

        if status in (200, 201):
            progress(1.0, "Upload finished")
            return _json(raw)
        if status == 308:
            moved = _next_offset(h)
            # only real progress resets the failure count: a status query that answers 308 while every chunk fails
            # must not, or the upload would retry forever
            if moved > offset:
                failures = 0
            offset, query = moved, False
            progress(offset / total, f"Uploading {_fmt_mb(offset)} of {_fmt_mb(total)}")
            continue
        if status in (404, 410) and restarts < 1:      # the upload session expired: start over once
            restarts += 1
            session, offset, query = _start_session(channel_id, body, total), 0, False
            continue
        if status == 0 or status >= 500 or status == 429:
            failures += 1
            if failures > MAX_RETRIES:
                raise YouTubeError(f"The upload kept failing after {MAX_RETRIES} tries "
                                   f"({'network problem' if status == 0 else f'HTTP {status}'}). Try again later.",
                                   reason="retries", status=status)
            wait = min(64.0, 2.0 ** (failures - 1)) + random.random()
            progress(offset / total, f"Connection problem; resuming in {wait:.0f}s (try {failures} of {MAX_RETRIES})")
            waited = 0.0
            while waited < wait:          # short sleeps so a cancel is noticed
                sleep(min(0.5, wait - waited))
                waited += 0.5
                progress(offset / total, f"Connection problem; resuming in {max(0, wait - waited):.0f}s (try {failures} of {MAX_RETRIES})")
            query = True
            continue
        raise api_error(status, raw, "take the upload")


# ---------------------------------------------------------------- statistics

def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def video_stats(channel_id: str, ids: list[str]) -> dict[str, dict]:
    """{video_id: {views, likes, comments, privacy, publish_at, upload_status}} for the ids YouTube still has."""
    out: dict[str, dict] = {}
    ids = [i for i in dict.fromkeys(ids) if i]
    for i in range(0, len(ids), 50):
        part = ids[i:i + 50]
        url = base("api") + "/videos?" + urllib.parse.urlencode({"part": "statistics,status", "id": ",".join(part), "maxResults": 50})
        try:
            status, _, raw = _authed(channel_id, "GET", url, headers={"Accept": "application/json"}, timeout=30)
        except TRANSIENT as e:
            raise _offline(e)
        if status != 200:
            raise api_error(status, raw, "report the video statistics")
        for it in _json(raw).get("items") or []:
            st, stx = it.get("statistics") or {}, it.get("status") or {}
            out[it["id"]] = {
                "views": _int(st.get("viewCount")) or 0, "likes": _int(st.get("likeCount")),
                "comments": _int(st.get("commentCount")), "privacy": stx.get("privacyStatus", ""),
                "publish_at": stx.get("publishAt", ""), "upload_status": stx.get("uploadStatus", ""),
                "rejection": stx.get("rejectionReason", "") or stx.get("failureReason", ""),
            }
    return out
