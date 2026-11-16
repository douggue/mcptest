"""Pure logic for the Agency section: earnings, rule checks, duplicate detection, slot planning.

Nothing here touches disk or the network, so it is unit-testable on its own.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta

PLATFORMS = ["TikTok", "YouTube Shorts", "Instagram Reels", "X", "Facebook", "Other"]
STATUSES = ["planned", "posted", "submitted", "approved", "rejected", "paid"]

# Views are counted once a post is live. Earnings are estimated for live posts that have not been rejected.
VIEW_STATUSES = {"posted", "submitted", "approved", "rejected", "paid"}
EARNING_STATUSES = {"posted", "submitted", "approved", "paid"}
EARNINGS_RULE = (
    "Views count for every post that has gone live (posted, submitted, approved, rejected or paid). "
    "Estimated earnings count posted, submitted, approved and paid posts; planned and rejected posts earn nothing. "
    "Per post: nothing below the campaign's minimum views, otherwise views ÷ 1,000 × rate, capped at the "
    "campaign's max payout per post. Campaign totals stop at the campaign budget."
)

SCHEDULE_FMT = "%Y-%m-%dT%H:%M"


def num(value, default: float = 0.0) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def as_list(value) -> list[str]:
    """Accept a list or a comma / newline separated string."""
    if value is None:
        return []
    if isinstance(value, str):
        value = re.split(r"[,\n]", value)
    return [str(v).strip() for v in value if str(v).strip()]


def as_tags(value) -> list[str]:
    """Hashtags from a list or a space / comma separated string, without the leading #."""
    if value is None:
        return []
    if isinstance(value, str):
        value = re.split(r"[\s,]+", value)
    out = []
    for v in value:
        out.extend(t.lstrip("#") for t in re.split(r"[\s,]+", str(v)) if t.lstrip("#"))
    return out


# ---------------------------------------------------------------- earnings

def post_earnings(views: float, campaign: dict | None, status: str = "posted") -> float:
    """Uncapped-by-budget estimate for one post."""
    if not campaign or status not in EARNING_STATUSES:
        return 0.0
    views = num(views)
    if views <= 0 or views < num(campaign.get("min_views")):
        return 0.0
    earned = views / 1000.0 * num(campaign.get("rate"))
    cap = num(campaign.get("max_payout"))
    if cap > 0:
        earned = min(earned, cap)
    return round(earned, 2)


def allocate_campaign(campaign: dict, posts: list[dict]) -> dict:
    """Earnings for one campaign's posts, oldest first, stopping at the budget.

    Returns {"per_post": {post_id: earned}, "earned", "uncapped", "budget", "remaining", "views", "posts"}.
    """
    budget = num(campaign.get("budget"))
    left = budget if budget > 0 else float("inf")
    per_post: dict[str, float] = {}
    uncapped = 0.0
    views = 0.0
    for p in sorted(posts, key=lambda r: (r.get("scheduled") or "", r.get("created") or 0)):
        if p.get("status") in VIEW_STATUSES:
            views += num(p.get("views"))
        want = post_earnings(p.get("views"), campaign, p.get("status", "planned"))
        uncapped += want
        got = round(min(want, left), 2)
        left -= got
        per_post[p["id"]] = got
    earned = round(sum(per_post.values()), 2)
    return {
        "per_post": per_post,
        "earned": earned,
        "uncapped": round(uncapped, 2),
        "budget": budget,
        "remaining": round(budget - earned, 2) if budget > 0 else None,
        "views": views,
        "posts": len(posts),
    }


def earnings_by_post(campaigns: list[dict], posts: list[dict]) -> dict[str, float]:
    out: dict[str, float] = {p["id"]: 0.0 for p in posts}
    for c in campaigns:
        mine = [p for p in posts if p.get("campaign_id") == c["id"]]
        out.update(allocate_campaign(c, mine)["per_post"])
    return out


# ---------------------------------------------------------------- rule check

def _norm_tag(tag: str) -> str:
    return tag.strip().lstrip("#").lower()


def _has_word(text: str, word: str) -> bool:
    return re.search(r"(?<!\w)" + re.escape(word.lower()) + r"(?!\w)", text.lower()) is not None


def check_rules(campaign: dict, title: str = "", description: str = "", hashtags=None,
                duration: float | None = None, transcript_text: str = "", platform: str = "") -> list[dict]:
    """Compare a post's caption and video against a campaign's rules. Returns [{rule, ok, detail}]."""
    rules = campaign.get("rules") or {}
    tags = {_norm_tag(t) for t in as_tags(hashtags)}
    caption = f"{title}\n{description}"
    # hashtags typed into the caption count too
    tags |= {m.lower() for m in re.findall(r"#(\w+)", caption)}
    out: list[dict] = []

    for tag in as_tags(rules.get("required_hashtags")):
        ok = _norm_tag(tag) in tags
        out.append({"rule": f"Hashtag #{_norm_tag(tag)}", "ok": ok,
                    "detail": "Present" if ok else "Missing from the hashtags and caption"})

    for text in as_list(rules.get("required_mentions")):
        ok = text.lower() in caption.lower()
        out.append({"rule": f"Credit or mention “{text}”", "ok": ok,
                    "detail": "Present" if ok else "Not found in the title or description"})

    phrase = (rules.get("required_phrase") or "").strip()
    if phrase:
        ok = phrase.lower() in caption.lower()
        out.append({"rule": f"Caption phrase “{phrase}”", "ok": ok,
                    "detail": "Present" if ok else "Not found in the title or description"})

    banned = as_list(rules.get("banned_words"))
    if banned:
        haystacks = {"caption": caption + "\n" + " ".join(as_tags(hashtags)), "transcript": transcript_text or ""}
        hits = [f"“{w}” in the {where}" for w in banned for where, text in haystacks.items() if _has_word(text, w)]
        out.append({"rule": "No banned words", "ok": not hits,
                    "detail": "; ".join(hits) if hits else f"None of {len(banned)} banned words found"})

    lo, hi = num(rules.get("min_duration")), num(rules.get("max_duration"))
    if lo > 0 or hi > 0:
        label = "Duration " + (f"{lo:g}–{hi:g}s" if lo > 0 and hi > 0 else f"at least {lo:g}s" if lo > 0 else f"at most {hi:g}s")
        if duration is None or num(duration) <= 0:
            out.append({"rule": label, "ok": False, "detail": "Video length unknown — pick a video or check it yourself"})
        else:
            d = num(duration)
            ok = (lo <= 0 or d >= lo) and (hi <= 0 or d <= hi)
            out.append({"rule": label, "ok": ok, "detail": f"Video is {d:.1f}s"})

    allowed = as_list(campaign.get("platforms"))
    if allowed and platform:
        ok = platform in allowed
        out.append({"rule": "Platform allowed", "ok": ok,
                    "detail": platform if ok else f"{platform} is not in this campaign ({', '.join(allowed)})"})

    return out


# ---------------------------------------------------------------- duplicates

def overlap_ratio(a_in: float, a_out: float, b_in: float, b_out: float) -> float:
    """Shared time as a fraction of the shorter range (0..1)."""
    la, lb = a_out - a_in, b_out - b_in
    if la <= 0 or lb <= 0:
        return 0.0
    shared = min(a_out, b_out) - max(a_in, b_in)
    return max(0.0, shared) / min(la, lb)


def shingles(text: str, k: int = 3) -> set[tuple[str, ...]]:
    words = re.findall(r"[a-z0-9']+", (text or "").lower())
    if len(words) < k:
        return {tuple(words)} if words else set()
    return {tuple(words[i:i + k]) for i in range(len(words) - k + 1)}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def text_similarity(a: str, b: str) -> float:
    return jaccard(shingles(a), shingles(b))


OVERLAP_MIN = 0.5
TEXT_MIN = 0.6
MIN_WORDS_FOR_TEXT = 8  # very short transcripts match by accident


def find_duplicates(videos: list[dict]) -> list[dict]:
    """Pairs of videos that look like the same clip.

    Each video: {key, title, source_origin, source_in, source_out, transcript_text}.
    """
    pairs: list[dict] = []
    sh = {v["key"]: shingles(v.get("transcript_text") or "") for v in videos}
    for i, a in enumerate(videos):
        for b in videos[i + 1:]:
            reasons: list[str] = []
            score = 0.0
            if a.get("source_origin") and a.get("source_origin") == b.get("source_origin"):
                try:
                    r = overlap_ratio(num(a.get("source_in")), num(a.get("source_out")),
                                      num(b.get("source_in")), num(b.get("source_out")))
                except TypeError:
                    r = 0.0
                if r >= OVERLAP_MIN:
                    reasons.append(f"Same source, {round(r * 100)}% of the shorter clip overlaps")
                    score = max(score, r)
            sa, sb = sh[a["key"]], sh[b["key"]]
            if len(sa) >= MIN_WORDS_FOR_TEXT and len(sb) >= MIN_WORDS_FOR_TEXT:
                j = jaccard(sa, sb)
                if j >= TEXT_MIN:
                    reasons.append(f"Transcripts are {round(j * 100)}% alike")
                    score = max(score, j)
            if reasons:
                pairs.append({"a": a["key"], "b": b["key"], "a_title": a.get("title", ""), "b_title": b.get("title", ""),
                              "reasons": reasons, "score": round(score, 3)})
    return sorted(pairs, key=lambda p: p["score"], reverse=True)


def double_bookings(posts: list[dict]) -> list[dict]:
    """The same video planned more than once for the same account."""
    seen: dict[tuple[str, str], list[dict]] = {}
    for p in posts:
        if p.get("video_key") and p.get("account_id") and p.get("status") != "rejected":
            seen.setdefault((p["video_key"], p["account_id"]), []).append(p)
    return [
        {"video_key": k[0], "account_id": k[1], "post_ids": [p["id"] for p in ps]}
        for k, ps in seen.items() if len(ps) > 1
    ]


# ---------------------------------------------------------------- slots

def parse_times(value) -> list[str]:
    """['9:00', '18:30'] -> ['09:00', '18:30'], dropping anything that is not a time."""
    out = []
    for t in as_list(value):
        m = re.fullmatch(r"(\d{1,2})[:.h](\d{2})", t)
        if m and int(m.group(1)) < 24 and int(m.group(2)) < 60:
            out.append(f"{int(m.group(1)):02d}:{m.group(2)}")
    return sorted(set(out))


def next_free_slot(times: list[str], taken: set[str], after: datetime, horizon_days: int = 365) -> str:
    """First of the account's daily posting times that is later than `after` and not already taken.

    `taken` holds schedule strings (YYYY-MM-DDTHH:MM). Accounts without default times get 12:00.
    """
    times = parse_times(times) or ["12:00"]
    day = after.date()
    for _ in range(horizon_days):
        for t in times:
            slot = datetime.strptime(f"{day.isoformat()}T{t}", SCHEDULE_FMT)
            key = slot.strftime(SCHEDULE_FMT)
            if slot > after and key not in taken:
                return key
        day += timedelta(days=1)
    raise ValueError("no free slot found")


# ---------------------------------------------------------------- timeline

def views_timeline(posts: list[dict]) -> list[dict]:
    """Total tracked views per day, carrying each post's last known count forward.

    Uses each post's views_history snapshots [{date: 'YYYY-MM-DD', views}].
    """
    events: dict[str, dict[str, float]] = {}
    for p in posts:
        if p.get("status") not in VIEW_STATUSES:
            continue
        for snap in p.get("views_history") or []:
            day = str(snap.get("date", ""))[:10]
            if day:
                events.setdefault(day, {})[p["id"]] = num(snap.get("views"))
    current: dict[str, float] = {}
    out = []
    for day in sorted(events):
        current.update(events[day])
        out.append({"date": day, "views": sum(current.values())})
    return out
