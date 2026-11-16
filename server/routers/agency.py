"""Agency: campaigns, accounts, post planner, view tracking, analytics, rule checks, duplicates.

Cutroom never uploads to a platform. Posts here are a plan and a record; the user publishes by hand.
"""
from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, HTTPException

from .. import agency_core as core
from .. import jobs
from ..store import Collection

router = APIRouter(prefix="/api/agency", tags=["agency"])

campaigns = Collection("agency_campaigns")
accounts = Collection("agency_accounts")
posts = Collection("agency_posts")


# ---------------------------------------------------------------- cleaning input

def _clean_campaign(body: dict) -> dict:
    name = str(body.get("name", "")).strip()
    if not name:
        raise HTTPException(422, "Campaign name is required")
    rules = body.get("rules") or {}
    return {
        "name": name,
        "creator": str(body.get("creator", "")).strip(),
        "platforms": [p for p in core.as_list(body.get("platforms")) if p in core.PLATFORMS],
        "rate": max(0.0, core.num(body.get("rate"))),
        "budget": max(0.0, core.num(body.get("budget"))),
        "max_payout": max(0.0, core.num(body.get("max_payout"))),
        "min_views": max(0.0, core.num(body.get("min_views"))),
        "start": str(body.get("start", "") or "")[:10],
        "end": str(body.get("end", "") or "")[:10],
        "link": str(body.get("link", "")).strip(),
        "notes": str(body.get("notes", "")),
        "rules": {
            "required_hashtags": core.as_tags(rules.get("required_hashtags")),
            "required_mentions": core.as_list(rules.get("required_mentions")),
            "banned_words": core.as_list(rules.get("banned_words")),
            "min_duration": max(0.0, core.num(rules.get("min_duration"))),
            "max_duration": max(0.0, core.num(rules.get("max_duration"))),
            "required_phrase": str(rules.get("required_phrase", "") or "").strip(),
        },
    }


def _clean_account(body: dict) -> dict:
    handle = str(body.get("handle", "")).strip()
    if not handle:
        raise HTTPException(422, "Account handle is required")
    platform = body.get("platform") if body.get("platform") in core.PLATFORMS else "Other"
    return {
        "platform": platform,
        "handle": handle,
        "label": str(body.get("label", "")).strip(),
        "times": core.parse_times(body.get("times")),
        "notes": str(body.get("notes", "")),
    }


def _clean_schedule(value) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    for fmt in (core.SCHEDULE_FMT, "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(value[:19], fmt).strftime(core.SCHEDULE_FMT)
        except ValueError:
            continue
    raise HTTPException(422, f"Could not read the scheduled time: {value}")


def _clean_caption(body) -> dict:
    body = body or {}
    return {
        "title": str(body.get("title", "") or ""),
        "description": str(body.get("description", "") or ""),
        "hashtags": core.as_tags(body.get("hashtags")),
    }


def _clean_post(body: dict, existing: dict | None = None) -> dict:
    row = dict(existing or {})
    if "video_key" in body or not existing:
        row["video_key"] = str(body.get("video_key", "") or "")
    if "video_title" in body or not existing:
        row["video_title"] = str(body.get("video_title", "") or "").strip()
    if "account_id" in body or not existing:
        row["account_id"] = str(body.get("account_id", "") or "")
    if "campaign_id" in body or not existing:
        row["campaign_id"] = str(body.get("campaign_id", "") or "")
    if "scheduled" in body or not existing:
        row["scheduled"] = _clean_schedule(body.get("scheduled"))
    if "status" in body or not existing:
        status = body.get("status") or "planned"
        if status not in core.STATUSES:
            raise HTTPException(422, f"Unknown status: {status}")
        row["status"] = status
    if "url" in body or not existing:
        row["url"] = str(body.get("url", "") or "").strip()
    if "notes" in body or not existing:
        row["notes"] = str(body.get("notes", "") or "")
    if "caption" in body or not existing:
        row["caption"] = _clean_caption(body.get("caption"))
    if "views" in body or not existing:
        views = max(0, int(core.num(body.get("views"))))
        _record_views(row, views)
    if not row.get("video_key") and not row.get("video_title"):
        raise HTTPException(422, "Pick a video or type a title for the post")
    if not row.get("account_id") or not accounts.get(row["account_id"]):
        raise HTTPException(422, "Pick an account for the post")
    if row.get("campaign_id") and not campaigns.get(row["campaign_id"]):
        raise HTTPException(422, "That campaign no longer exists")
    return row


def _record_views(row: dict, views: int) -> None:
    """Set the view count and keep one snapshot per day for the views-over-time chart."""
    changed = views != row.get("views")
    row["views"] = views
    history = list(row.get("views_history") or [])
    if changed and (views > 0 or history):
        today = date.today().isoformat()
        history = [h for h in history if h.get("date") != today] + [{"date": today, "views": views}]
    row["views_history"] = history


# ---------------------------------------------------------------- videos

def all_videos() -> list[dict]:
    """Exports and clipper clips in one list, newest first."""
    out: list[dict] = []
    for r in Collection("exports").all():
        meta = r.get("meta") or {}
        out.append({
            "key": f"export:{r['id']}", "kind": "export", "id": r["id"],
            "title": meta.get("title") or r.get("title") or "Untitled short",
            "file": r.get("file", ""), "cover": r.get("cover", ""),
            "duration": core.num(r.get("duration")), "status": r.get("status") or "draft",
            "meta": {"title": meta.get("title") or r.get("title") or "", "description": meta.get("description", ""),
                     "hashtags": core.as_tags(meta.get("hashtags"))},
            "source_origin": r.get("source_origin", ""), "source_in": r.get("source_in"),
            "source_out": r.get("source_out"), "transcript_text": r.get("transcript_text", ""),
            "created": r.get("created", 0),
        })
    for r in Collection("clips").all():
        out.append({
            "key": f"clip:{r['id']}", "kind": "clip", "id": r["id"],
            "title": r.get("title") or "Untitled clip", "file": r.get("file", ""), "cover": "",
            "duration": core.num(r.get("duration")), "status": "",
            "meta": {"title": r.get("title", ""), "description": "", "hashtags": []},
            "source_origin": r.get("source_origin", ""), "source_in": r.get("source_in"),
            "source_out": r.get("source_out"), "transcript_text": "",
            "created": r.get("created", 0),
        })
    return sorted(out, key=lambda v: v.get("created", 0), reverse=True)


@router.get("/videos")
def list_videos(approved: bool = False) -> list[dict]:
    vids = all_videos()
    if approved:
        vids = [v for v in vids if v["kind"] == "export" and v["status"] in ("approved", "posted")]
    return vids


@router.get("/options")
def options() -> dict:
    return {"platforms": core.PLATFORMS, "statuses": core.STATUSES, "earnings_rule": core.EARNINGS_RULE}


# ---------------------------------------------------------------- campaigns

def _campaign_out(c: dict, all_posts: list[dict]) -> dict:
    stats = core.allocate_campaign(c, [p for p in all_posts if p.get("campaign_id") == c["id"]])
    stats.pop("per_post")
    return {**c, "stats": stats}


@router.get("/campaigns")
def list_campaigns() -> list[dict]:
    all_posts = posts.all()
    return [_campaign_out(c, all_posts) for c in sorted(campaigns.all(), key=lambda r: r.get("created", 0), reverse=True)]


@router.post("/campaigns")
def create_campaign(body: dict) -> dict:
    return _campaign_out(campaigns.insert(_clean_campaign(body)), [])


@router.put("/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, body: dict) -> dict:
    row = campaigns.update(campaign_id, _clean_campaign(body))
    if not row:
        raise HTTPException(404, "campaign not found")
    return _campaign_out(row, posts.all())


@router.delete("/campaigns/{campaign_id}")
def delete_campaign(campaign_id: str) -> dict:
    if not campaigns.delete(campaign_id):
        raise HTTPException(404, "campaign not found")
    detached = 0
    for p in posts.all(lambda r: r.get("campaign_id") == campaign_id):
        posts.update(p["id"], {"campaign_id": ""})
        detached += 1
    return {"ok": True, "detached_posts": detached}


# ---------------------------------------------------------------- accounts

@router.get("/accounts")
def list_accounts() -> list[dict]:
    return sorted(accounts.all(), key=lambda r: (r.get("platform", ""), r.get("handle", "").lower()))


@router.post("/accounts")
def create_account(body: dict) -> dict:
    return accounts.insert(_clean_account(body))


@router.put("/accounts/{account_id}")
def update_account(account_id: str, body: dict) -> dict:
    row = accounts.update(account_id, _clean_account(body))
    if not row:
        raise HTTPException(404, "account not found")
    return row


@router.delete("/accounts/{account_id}")
def delete_account(account_id: str) -> dict:
    used = len(posts.all(lambda r: r.get("account_id") == account_id))
    if used:
        raise HTTPException(409, f"This account has {used} post{'s' if used != 1 else ''}. Delete or move them first.")
    if not accounts.delete(account_id):
        raise HTTPException(404, "account not found")
    return {"ok": True}


# ---------------------------------------------------------------- posts

def _posts_out(rows: list[dict]) -> list[dict]:
    earned = core.earnings_by_post(campaigns.all(), posts.all())
    return [{**r, "earnings": earned.get(r["id"], 0.0)} for r in rows]


@router.get("/posts")
def list_posts() -> list[dict]:
    rows = sorted(posts.all(), key=lambda r: (r.get("scheduled") or "9999", r.get("created", 0)))
    return _posts_out(rows)


@router.post("/posts")
def create_post(body: dict) -> dict:
    return _posts_out([posts.insert(_clean_post(body))])[0]


@router.post("/posts/distribute")
def distribute(body: dict) -> dict:
    """One post per chosen account, each at that account's next free default posting time."""
    video_key = str(body.get("video_key", "") or "")
    video_title = str(body.get("video_title", "") or "").strip()
    if not video_key and not video_title:
        raise HTTPException(422, "Pick a video to distribute")
    campaign_id = str(body.get("campaign_id", "") or "")
    if campaign_id and not campaigns.get(campaign_id):
        raise HTTPException(422, "That campaign no longer exists")
    ids = core.as_list(body.get("account_ids"))
    if not ids:
        raise HTTPException(422, "Pick at least one account")
    after_raw = _clean_schedule(body.get("after")) or datetime.now().strftime(core.SCHEDULE_FMT)
    after = datetime.strptime(after_raw, core.SCHEDULE_FMT)
    caption = _clean_caption(body.get("caption"))

    existing = posts.all()
    created, skipped = [], []
    for account_id in ids:
        acct = accounts.get(account_id)
        if not acct:
            skipped.append({"account_id": account_id, "reason": "Account not found"})
            continue
        mine = [p for p in existing if p.get("account_id") == account_id and p.get("status") != "rejected"]
        if video_key and any(p.get("video_key") == video_key for p in mine):
            skipped.append({"account_id": account_id, "reason": f"Already planned for {acct['handle']}"})
            continue
        taken = {p.get("scheduled", "") for p in mine}
        slot = core.next_free_slot(acct.get("times") or [], taken, after)
        row = posts.insert({
            "video_key": video_key, "video_title": video_title, "account_id": account_id,
            "campaign_id": campaign_id, "scheduled": slot, "status": "planned", "url": "", "notes": "",
            "caption": caption, "views": 0, "views_history": [],
        })
        existing.append(row)
        created.append(row)
    return {"created": _posts_out(created), "skipped": skipped}


@router.put("/posts/{post_id}")
def update_post(post_id: str, body: dict) -> dict:
    existing = posts.get(post_id)
    if not existing:
        raise HTTPException(404, "post not found")
    row = posts.update(post_id, _clean_post(body, existing))
    return _posts_out([row])[0]


@router.delete("/posts/{post_id}")
def delete_post(post_id: str) -> dict:
    if not posts.delete(post_id):
        raise HTTPException(404, "post not found")
    return {"ok": True}


# ---------------------------------------------------------------- view tracking

def fetch_views(url: str) -> int:
    """Read a public view count from a post URL with yt-dlp. Needs network access to the platform."""
    import yt_dlp

    opts = {"quiet": True, "skip_download": True, "no_warnings": True, "socket_timeout": 20, "noplaylist": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    views = (info or {}).get("view_count")
    if views is None:
        raise ValueError("the platform did not report a view count for this link")
    return int(views)


def _refresh(post: dict) -> dict:
    views = fetch_views(post["url"])
    row = dict(post)
    _record_views(row, views)
    return posts.update(post["id"], {"views": row["views"], "views_history": row["views_history"]}) or row


def _short_error(e: Exception) -> str:
    text = str(e).replace("ERROR: ", "").strip() or e.__class__.__name__
    return text.splitlines()[0][:240]


@router.post("/posts/{post_id}/refresh-views")
def refresh_views(post_id: str) -> dict:
    post = posts.get(post_id)
    if not post:
        raise HTTPException(404, "post not found")
    if not post.get("url"):
        raise HTTPException(422, "Add the post link first, then refresh its views")
    try:
        row = _refresh(post)
    except Exception as e:  # network, private post, unsupported site, missing count
        raise HTTPException(502, f"Could not read views: {_short_error(e)}. Enter the number by hand instead.")
    return _posts_out([row])[0]


@router.post("/posts/refresh-all")
def refresh_all() -> dict:
    targets = [p for p in posts.all() if p.get("url") and p.get("status") in core.VIEW_STATUSES]
    if not targets:
        raise HTTPException(422, "No live posts have a link yet")

    def work(job: jobs.Job) -> dict:
        updated, failed = 0, []
        for i, p in enumerate(targets):
            job.update(i / len(targets), f"Reading views {i + 1} of {len(targets)}")
            try:
                _refresh(p)
                updated += 1
            except jobs.Cancelled:
                raise
            except Exception as e:
                failed.append({"id": p["id"], "url": p["url"], "error": _short_error(e)})
        return {"updated": updated, "failed": failed}

    job = jobs.submit("agency-views", "Refresh views", work)
    return {"job_id": job.id}


# ---------------------------------------------------------------- rule check and duplicates

@router.post("/check")
def check(body: dict) -> list[dict]:
    campaign = campaigns.get(str(body.get("campaign_id", "")))
    if not campaign:
        raise HTTPException(404, "campaign not found")
    duration = body.get("duration")
    return core.check_rules(
        campaign,
        title=str(body.get("title", "") or ""),
        description=str(body.get("description", "") or ""),
        hashtags=body.get("hashtags"),
        duration=core.num(duration) if duration not in (None, "") else None,
        transcript_text=str(body.get("transcript_text", "") or ""),
        platform=str(body.get("platform", "") or ""),
    )


@router.get("/duplicates")
def duplicates() -> dict:
    return {
        "pairs": core.find_duplicates(all_videos()),
        "double_bookings": core.double_bookings(posts.all()),
        "thresholds": {"overlap": core.OVERLAP_MIN, "text": core.TEXT_MIN},
    }


# ---------------------------------------------------------------- analytics

@router.get("/analytics")
def analytics() -> dict:
    all_posts = posts.all()
    all_campaigns = campaigns.all()
    all_accounts = {a["id"]: a for a in accounts.all()}
    earned = core.earnings_by_post(all_campaigns, all_posts)

    def bucket() -> dict:
        return {"posts": 0, "live": 0, "views": 0.0, "earned": 0.0}

    def add(b: dict, p: dict) -> None:
        b["posts"] += 1
        if p.get("status") in core.VIEW_STATUSES:
            b["live"] += 1
            b["views"] += core.num(p.get("views"))
        b["earned"] = round(b["earned"] + earned.get(p["id"], 0.0), 2)

    totals = bucket()
    totals["paid"] = 0.0
    by_campaign: dict[str, dict] = {c["id"]: {"id": c["id"], "name": c["name"], "budget": core.num(c.get("budget")), **bucket()}
                                    for c in all_campaigns}
    by_account: dict[str, dict] = {}
    by_platform: dict[str, dict] = {}
    none_campaign = {"id": "", "name": "No campaign", "budget": 0.0, **bucket()}

    for p in all_posts:
        add(totals, p)
        if p.get("status") == "paid":
            totals["paid"] = round(totals["paid"] + earned.get(p["id"], 0.0), 2)
        add(by_campaign.get(p.get("campaign_id") or "", none_campaign), p)
        acct = all_accounts.get(p.get("account_id") or "")
        platform = acct["platform"] if acct else "Other"
        key = p.get("account_id") or ""
        if key not in by_account:
            by_account[key] = {"id": key, "handle": acct["handle"] if acct else "Deleted account",
                               "platform": platform, "label": (acct or {}).get("label", ""), **bucket()}
        add(by_account[key], p)
        if platform not in by_platform:
            by_platform[platform] = {"platform": platform, **bucket()}
        add(by_platform[platform], p)

    campaign_rows = list(by_campaign.values())
    for row in campaign_rows:
        row["remaining"] = round(row["budget"] - row["earned"], 2) if row["budget"] > 0 else None
    if none_campaign["posts"]:
        none_campaign["remaining"] = None
        campaign_rows.append(none_campaign)

    by_views = lambda r: (-r["views"], -r["posts"])  # noqa: E731
    return {
        "totals": totals,
        "by_campaign": sorted(campaign_rows, key=by_views),
        "by_account": sorted(by_account.values(), key=by_views),
        "by_platform": sorted(by_platform.values(), key=by_views),
        "timeline": core.views_timeline(all_posts),
        "rule": core.EARNINGS_RULE,
    }
