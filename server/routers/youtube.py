"""YouTube: connect the owner's channels, upload exports, read statistics back.

Works with the owner's own Google Cloud OAuth client (Settings → YouTube); Cutroom has no credentials of its own.
Every upload is recorded as an Agency post on the Agency account linked to the channel, so the planner, analytics
and view tracking see it like any other post. Protocol details live in server/social/youtube.py.
"""
from __future__ import annotations

import os
import re
import threading
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from .. import agency_core as core
from .. import auth, jobs
from ..config import get_settings, media_path
from ..social import youtube as yt
from ..store import Collection
from . import agency

router = APIRouter(prefix="/api/youtube", tags=["youtube"])
exports = Collection("exports")

_last: dict = {}   # outcome of the most recent sign-in, shown once by Settings


def _fail(e: Exception, code: int = 422):
    raise HTTPException(code, str(e))


# ---------------------------------------------------------------- redirect URL

def redirect_url(request: Request | None) -> tuple[str, str]:
    """(url, how it was chosen). It must match an Authorized redirect URI on the owner's OAuth client exactly."""
    saved = str(get_settings().get("youtube_redirect_url") or "").strip()
    if saved:
        return saved, "saved"
    public = os.environ.get("CUTROOM_PUBLIC_URL", "").strip().rstrip("/")
    if public:
        return public + yt.CALLBACK_PATH, "env"
    domain = os.environ.get("CUTROOM_DOMAIN", "").strip().rstrip("/")
    if domain:
        return f"https://{domain}{yt.CALLBACK_PATH}", "env"
    if auth.enabled() and request is not None:   # server edition: the address the browser used
        h = request.headers
        proto = (h.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
        host = (h.get("x-forwarded-host") or h.get("host") or request.url.netloc).split(",")[0].strip()
        return f"{proto}://{host}{yt.CALLBACK_PATH}", "request"
    port = os.environ.get("CUTROOM_PORT") or (str(request.url.port) if request is not None and request.url.port else "8000")
    return f"http://127.0.0.1:{port}{yt.CALLBACK_PATH}", "desktop"


# ---------------------------------------------------------------- agency accounts

def _norm_handle(s: str) -> str:
    return re.sub(r"^@+", "", str(s or "").strip()).lower()


def account_for(channel_id: str) -> dict | None:
    return next((a for a in agency.accounts.all() if a.get("youtube_channel_id") == channel_id), None)


def link_account(channel: dict, wanted: str = "") -> dict:
    """Link a connected channel to one Agency account: the one asked for, the one already linked, a YouTube account
    with the same handle, or a new one."""
    cid = channel["id"]
    target = agency.accounts.get(wanted) if wanted else None
    if not target:
        target = account_for(cid)
    if not target:
        handle = _norm_handle(channel.get("handle"))
        target = next((a for a in agency.accounts.all() if a.get("platform") == "YouTube Shorts" and not a.get("youtube_channel_id")
                       and handle and _norm_handle(a.get("handle")) == handle), None)
    if not target:
        target = agency.accounts.insert({
            "platform": "YouTube Shorts", "handle": channel.get("handle") or channel.get("title") or cid,
            "label": channel.get("title", ""), "times": [], "notes": "Connected under Settings → YouTube.",
        })
    for a in agency.accounts.all(lambda r: r.get("youtube_channel_id") == cid and r["id"] != target["id"]):
        agency.accounts.update(a["id"], {"youtube_channel_id": ""})
    return agency.accounts.update(target["id"], {"youtube_channel_id": cid}) or target


def _channel_out(c: dict) -> dict:
    out = yt.public_channel(c)
    acct = account_for(c["id"])
    out["account_id"] = acct["id"] if acct else ""
    out["account_handle"] = acct["handle"] if acct else ""
    return out


# ---------------------------------------------------------------- settings and connection

@router.get("/state")
def state(request: Request) -> dict:
    s = get_settings()
    url, source = redirect_url(request)
    return {
        "client_id": s.get("youtube_client_id", ""),
        "client_secret_set": bool(s.get("youtube_client_secret")),
        "configured": bool(s.get("youtube_client_id") and s.get("youtube_client_secret")),
        "redirect_url": url, "redirect_source": source,
        "server_edition": auth.enabled(),
        "channels": [_channel_out(c) for c in yt.channels()],
        "last": dict(_last) if _last else None,
        "notes": {"unverified": yt.UNVERIFIED_NOTE, "quota": yt.QUOTA_NOTE, "testing": yt.TESTING_NOTE},
        "stand_in": any(os.environ.get(env) for env, _ in yt.BASES.values()),
    }


@router.post("/connect")
def connect(request: Request, body: dict | None = None) -> dict:
    """Returns the Google consent page to open. `account_id` links the channel to that Agency account."""
    body = body or {}
    url, _ = redirect_url(request)
    account_id = str(body.get("account_id", "") or "")
    if account_id and not agency.accounts.get(account_id):
        raise HTTPException(422, "That Agency account no longer exists.")
    try:
        return {"url": yt.begin_connect(url, account_id), "redirect_url": url}
    except yt.YouTubeError as e:
        _fail(e)


@router.get("/callback", include_in_schema=False)
def callback(state: str = "", code: str = "", error: str = "") -> RedirectResponse:
    """Google sends the browser here after the consent page. Behind a password the session cookie must be present
    (the Gate refuses the request otherwise), so only the signed-in owner can finish a connection."""
    _last.clear()
    try:
        row = yt.finish_connect(state, code, error)
        acct = link_account(row, row.get("wanted_account_id", ""))
        text = f"Connected {row['title']}. It is linked to the Agency account {acct['handle']}."
        if not row.get("can_upload"):
            text += " Upload permission was not given, so Cutroom can read statistics but not post. Reconnect and tick every box to post."
        _last.update({"ok": True, "text": text, "channel_id": row["id"], "at": time.time()})
    except yt.YouTubeError as e:
        _last.update({"ok": False, "text": str(e), "at": time.time()})
    except Exception as e:  # never strand the person on a JSON error page
        _last.update({"ok": False, "text": f"Connecting failed: {e}", "at": time.time()})
    return RedirectResponse("/#/settings", status_code=303)


@router.post("/channels/{channel_id}/check")
def check_channel(channel_id: str) -> dict:
    try:
        yt.verify(channel_id)
    except yt.YouTubeError as e:
        _fail(e)
    return _channel_out(yt.get_channel(channel_id) or {"id": channel_id})


@router.put("/channels/{channel_id}")
def relink_channel(channel_id: str, body: dict) -> dict:
    """Link the channel to another Agency account."""
    c = yt.get_channel(channel_id)
    if not c:
        raise HTTPException(404, "That channel is not connected.")
    wanted = str(body.get("account_id", "") or "")
    if not agency.accounts.get(wanted):
        raise HTTPException(422, "Pick an Agency account to link.")
    link_account(c, wanted)
    return _channel_out(c)


@router.delete("/channels/{channel_id}")
def disconnect(channel_id: str) -> dict:
    gone = yt.remove_channel(channel_id)
    if not gone:
        raise HTTPException(404, "That channel is not connected.")
    for a in agency.accounts.all(lambda r: r.get("youtube_channel_id") == channel_id):
        agency.accounts.update(a["id"], {"youtube_channel_id": ""})
    return {"ok": True}


# ---------------------------------------------------------------- publishing

def _video_key(export_id: str) -> str:
    return f"export:{export_id}"


def _find_post(body: dict, export_id: str, account_id: str) -> dict | None:
    post_id = str(body.get("post_id", "") or "")
    if post_id:
        p = agency.posts.get(post_id)
        if not p:
            raise HTTPException(404, "That planned post no longer exists.")
        return p
    # reuse a planned post of this export on this account that has not been uploaded yet
    return next((p for p in sorted(agency.posts.all(), key=lambda r: r.get("scheduled") or "")
                 if p.get("video_key") == _video_key(export_id) and p.get("account_id") == account_id
                 and p.get("status") == "planned" and not (p.get("youtube") or {}).get("video_id")), None)


def _active(p: dict) -> bool:
    y = p.get("youtube") or {}
    j = jobs.get(y.get("job_id", "")) if y.get("state") == "uploading" else None
    return bool(j and j.status in ("queued", "running"))


@router.post("/publish")
def publish(body: dict) -> dict:
    """Upload an export to a connected channel, now or scheduled, and record it as an Agency post.

    Body: export_id, channel_id (or account_id), title, description, hashtags, privacy (private | unlisted | public),
    made_for_kids, publish_at (ISO time with offset, for a scheduled publish), scheduled (the same time as the planner's
    local YYYY-MM-DDTHH:MM, optional), post_id (an existing planned post to fill), campaign_id (optional), again.
    """
    export = exports.get(str(body.get("export_id", "") or ""))
    if not export:
        raise HTTPException(404, "That export no longer exists. Export the clip again.")
    try:
        path = media_path(export.get("file", ""))
    except ValueError:
        raise HTTPException(422, "The export's file is not in Cutroom's data folder.")
    if not path.is_file():
        raise HTTPException(422, "The export's video file is missing. Export the clip again.")

    channel_id = str(body.get("channel_id", "") or "")
    if not channel_id and body.get("account_id"):
        channel_id = (agency.accounts.get(str(body["account_id"])) or {}).get("youtube_channel_id", "")
    channel = yt.get_channel(channel_id) if channel_id else None
    if not channel:
        raise HTTPException(422, "Pick a connected YouTube channel. Channels are connected under Settings → YouTube.")
    if channel.get("needs_reconnect"):
        raise HTTPException(422, channel.get("problem") or yt.reconnect_text(channel))
    if not channel.get("can_upload", True):
        raise HTTPException(422, "Cutroom was not given permission to upload to this channel. Reconnect it under Settings → YouTube and tick every box Google shows.")

    privacy = str(body.get("privacy", "private") or "private")
    try:
        publish_at = yt.parse_publish_at(body.get("publish_at"))
        meta, notes = yt.build_metadata(
            str(body.get("title", "") or ""), str(body.get("description", "") or ""), core.as_tags(body.get("hashtags")),
            privacy, bool(body.get("made_for_kids", False)), publish_at)
    except yt.YouTubeError as e:
        _fail(e)

    acct = account_for(channel_id) or link_account(channel)
    post = _find_post(body, export["id"], acct["id"])
    if post and _active(post):
        raise HTTPException(409, "This post is already uploading. Wait for it to finish or cancel it.")
    if post and (post.get("youtube") or {}).get("video_id") and not body.get("again"):
        raise HTTPException(409, f"This post is already on YouTube: {post.get('url', '')}")

    scheduled = ""
    if body.get("scheduled"):
        scheduled = agency._clean_schedule(body.get("scheduled"))
    elif publish_at:
        scheduled = publish_at.astimezone().strftime(core.SCHEDULE_FMT)
    caption = {"title": meta["snippet"]["title"], "description": str(body.get("description", "") or ""),
               "hashtags": core.as_tags(body.get("hashtags"))}
    campaign_id = str(body.get("campaign_id", "") or "")
    if campaign_id and not agency.campaigns.get(campaign_id):
        campaign_id = ""
    if not post:
        post = agency.posts.insert({
            "video_key": _video_key(export["id"]), "video_title": caption["title"], "account_id": acct["id"],
            "campaign_id": campaign_id, "scheduled": scheduled or datetime.now().strftime(core.SCHEDULE_FMT),
            "status": "planned", "url": "", "notes": "", "caption": caption, "views": 0, "views_history": [],
        })
    post_id = post["id"]
    shorts = (export.get("height") or 0) >= (export.get("width") or 0) and core.num(export.get("duration")) <= 180

    def work(job: jobs.Job) -> dict:
        def progress(p: float, msg: str) -> None:
            job.update(0.01 + 0.97 * p, msg)

        try:
            video = yt.upload(channel_id, path, meta, progress)
        except jobs.Cancelled:
            _patch_yt(post_id, {"state": "cancelled", "error": "Upload cancelled."})
            raise
        except Exception as e:
            _patch_yt(post_id, {"state": "failed", "error": str(e)})
            raise
        vid = video.get("id") or ""
        if not vid:
            raise yt.YouTubeError("YouTube finished the upload but did not say which video it made. Check YouTube Studio.")
        got = (video.get("status") or {})
        got_privacy = got.get("privacyStatus") or meta["status"]["privacyStatus"]
        warnings = list(notes)
        if meta["status"]["privacyStatus"] != "private" and got_privacy == "private":
            warnings.append("YouTube set this video to private. " + yt.UNVERIFIED_NOTE)
        if publish_at and not got.get("publishAt") and got_privacy == "private":
            warnings.append("YouTube did not confirm the scheduled time; check the video in YouTube Studio. " + yt.UNVERIFIED_NOTE)
        url = yt.video_url(vid, shorts)
        current = agency.posts.get(post_id) or post
        y = {"video_id": vid, "channel_id": channel_id, "privacy": got_privacy,
             "publish_at": got.get("publishAt") or meta["status"].get("publishAt", ""),
             "state": "scheduled" if publish_at and got_privacy == "private" else
                      ("live" if got_privacy in core.YOUTUBE_LIVE else "private"),
             "uploaded": time.time(), "error": "", "warning": " ".join(warnings), "likes": None, "comments": None}
        patch = {"url": url, "status": core.youtube_post_status(got_privacy, current.get("status", "planned"))}
        if scheduled:
            patch["scheduled"] = scheduled
        elif not publish_at:
            patch["scheduled"] = datetime.now().strftime(core.SCHEDULE_FMT)
        _patch_yt(post_id, y, patch)
        return {"post_id": post_id, "video_id": vid, "url": url, "privacy": got_privacy,
                "publish_at": y["publish_at"], "state": y["state"], "warnings": warnings}

    # mark the post before the job starts, so a quick failure is not overwritten afterwards
    _patch_yt(post_id, {"state": "uploading", "job_id": "", "channel_id": channel_id, "video_id": "",
                        "privacy": meta["status"]["privacyStatus"], "publish_at": meta["status"].get("publishAt", ""),
                        "error": "", "warning": " ".join(notes)},
              {"video_key": _video_key(export["id"]), "video_title": caption["title"], "account_id": acct["id"],
               "caption": caption, **({"campaign_id": campaign_id} if campaign_id else {}),
               **({"scheduled": scheduled} if scheduled else {})})
    job = jobs.submit("youtube-upload", f"Post to YouTube: {caption['title'][:60]}", work,
                      meta={"post_id": post_id, "export_id": export["id"], "channel_id": channel_id})
    _patch_yt(post_id, {"job_id": job.id})
    return {"job_id": job.id, "post_id": post_id, "notes": notes}


_post_lock = threading.Lock()


def _patch_yt(post_id: str, fields: dict, extra: dict | None = None) -> None:
    """Merge into a post's `youtube` record (the request thread and the upload job both write it)."""
    with _post_lock:
        cur = dict((agency.posts.get(post_id) or {}).get("youtube") or {})
        agency.posts.update(post_id, {**(extra or {}), "youtube": {**cur, **fields}})


@router.get("/posts")
def list_posts(export_id: str = "") -> list[dict]:
    """Agency posts that went (or are going) to YouTube, optionally for one export; newest first."""
    rows = [p for p in agency.posts.all() if p.get("youtube")]
    if export_id:
        rows = [p for p in rows if p.get("video_key") == _video_key(export_id)]
    return agency._posts_out(sorted(rows, key=lambda r: r.get("created", 0), reverse=True))


@router.post("/posts/{post_id}/stats")
def post_stats(post_id: str) -> dict:
    """Views, likes and comments for one uploaded post, from the API (falls back to the post link)."""
    return agency.refresh_views(post_id)

