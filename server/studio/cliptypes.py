"""Clip types for Find moments: highlights, a numbered series, a topic search, a recap and a trailer.

Highlights are moments.find_moments. The other types each have their own prompt and schema, a check of what the
model sends back (indices clamped to the transcript, cuts on sentence ends, no overlaps, series parts that meet
exactly), and a rule-based fallback for when there is no AI key. Every function returns {engine, note, clips}.

A clip may carry `segments`: the source ranges it keeps, for recaps and trailers made of several pieces.
"""
from __future__ import annotations

import re

from . import ai
from .moments import (HOOK_WORDS, STOP, VALUE_WORDS, _score_window, _style_note, _title_from, find_moments, keywords,
                      norm, sentences)

KINDS = ("highlights", "series", "topic", "recap", "trailer")
LABELS = {"highlights": "highlights", "series": "the series was", "topic": "topic clips were", "recap": "the recap was",
          "trailer": "the trailer was"}

# ---------------------------------------------------------------- prompt pieces shared by every type


def extra_note(instructions: str = "", performance: dict | None = None) -> str:
    """The editor's own instructions and what has done well before, appended to any request. Empty when neither."""
    out = ""
    if instructions.strip():
        out += ("\n\nInstructions from the editor for this run. Follow them where they do not break the rules above:\n"
                + instructions.strip())
    if performance and performance.get("count"):
        def row(p: dict) -> str:
            length = f"{p['seconds']:.0f}s" if p.get("seconds") else "length unknown"
            return f"- \"{p['title']}\" ({length}): {p['views']:,} views"
        out += (f"\n\nWhat has worked for this audience, from the views of {performance['count']} earlier posts. "
                "Treat it as a hint about hooks and length, not a rule; the transcript comes first.\n"
                "Best performers:\n" + "\n".join(row(p) for p in performance["top"])
                + "\nWeakest performers:\n" + "\n".join(row(p) for p in performance["bottom"]))
        if performance.get("top_quarter_median_seconds"):
            out += f"\nThe best quarter of posts had a median length of {performance['top_quarter_median_seconds']:.0f} seconds."
    return out


def _listing(lines: list[dict]) -> str:
    return "\n".join(f"[{i}] ({l['start']:.1f}s-{l['end']:.1f}s) {l['text']}" for i, l in enumerate(lines))


def _tags(values) -> list[str]:
    return [h if h.startswith("#") else "#" + h for h in (str(v).strip() for v in values or []) if h.strip("#")][:8]


def _rule_tags(text: str) -> list[str]:
    return ["#" + k for k in keywords([{"text": t} for t in text.split()], 4)] + ["#shorts"]


def _span(lines: list[dict], a: int, b: int) -> float:
    return lines[b]["end"] - lines[a]["start"]


def _clamp_range(lines: list[dict], start, end) -> tuple[int, int]:
    """Line indices from the model, kept inside the transcript and in order."""
    last = len(lines) - 1
    a = max(0, min(last, int(start)))
    b = max(a, min(last, int(end)))
    return a, b


def _no_overlaps(ranges: list[tuple[int, int, dict]]) -> list[tuple[int, int, dict]]:
    """Keep ranges in time order, dropping any that overlap one already kept (first one wins)."""
    kept: list[tuple[int, int, dict]] = []
    for r in ranges:
        if all(r[1] < k[0] or r[0] > k[1] for k in kept):
            kept.append(r)
    return sorted(kept, key=lambda r: r[0])


def _merge_touching(ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for a, b in sorted(ranges):
        if out and a <= out[-1][1] + 1:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def _fit_total(lines: list[dict], ranges: list[tuple[int, int]], max_len: float) -> list[tuple[int, int]]:
    """Shorten a multi-range clip until its kept length fits: trim the longest pieces first, then drop pieces.

    The opening piece goes last, since it carries the hook."""
    ranges = list(ranges)
    total = lambda: sum(_span(lines, a, b) for a, b in ranges)
    while ranges and total() > max_len * 1.15:
        multi = [i for i in range(len(ranges)) if ranges[i][1] > ranges[i][0]]
        pool = multi or list(range(1, len(ranges))) or [0]
        longest = max(pool, key=lambda i: _span(lines, *ranges[i]))
        a, b = ranges[longest]
        if b > a:
            ranges[longest] = (a, b - 1)
        elif len(ranges) > 1:
            ranges.pop(longest)
        else:
            break
    return ranges


def _strip_part(text: str) -> str:
    return re.sub(r"^\s*part\s*\d+\s*(of\s*\d+)?\s*[:.\-–—]\s*", "", text.strip(), flags=re.I).strip()


# ---------------------------------------------------------------- building clips


def _plain_clip(lines: list[dict], a: int, b: int, **extra) -> dict:
    text = " ".join(l["text"] for l in lines[a:b + 1])
    title = extra.pop("hook_title", "") or _title_from(lines[a]["text"])
    return {"in": lines[a]["start"], "out": lines[b]["end"], "hook_title": title, "title": extra.pop("title", "") or title,
            "description": extra.pop("description", "") or lines[a]["text"][:140],
            "hashtags": extra.pop("hashtags", None) or _rule_tags(text), "score": extra.pop("score", None),
            "reason": extra.pop("reason", ""), **extra}


def _multi_clip(lines: list[dict], ranges: list[tuple[int, int]], **extra) -> dict:
    """One clip made of several source ranges, played in time order."""
    segs = [{"start": lines[a]["start"], "end": lines[b]["end"]} for a, b in ranges]
    text = " ".join(lines[i]["text"] for a, b in ranges for i in range(a, b + 1))
    title = extra.pop("hook_title", "") or _title_from(lines[ranges[0][0]]["text"])
    return {"in": segs[0]["start"], "out": segs[-1]["end"], "segments": segs, "hook_title": title,
            "title": extra.pop("title", "") or title, "description": extra.pop("description", "") or text[:140],
            "hashtags": extra.pop("hashtags", None) or _rule_tags(text), "score": None,
            "reason": extra.pop("reason", ""), **extra}


def _series_clips(lines: list[dict], parts: list[dict], max_len: float) -> list[dict]:
    """Parts in order, each starting on the line after the previous one ended, numbered from 1.

    Adjacent parts share one cut point, halfway through the pause between the two sentences."""
    out: list[dict] = []
    prev_end = -1
    for p in sorted(parts, key=lambda p: p["a"]):
        a = prev_end + 1 if prev_end >= 0 else p["a"]
        if a >= len(lines):
            break
        b = max(a, p["b"])
        while b > a and _span(lines, a, b) > max_len * 1.15:
            b -= 1
        out.append({**p, "a": a, "b": b})
        prev_end = b
    clips = []
    for k, p in enumerate(out):
        hook = f"Part {k + 1}: {_strip_part(p['hook']) or _title_from(lines[p['a']]['text'], 6)}"
        title = f"Part {k + 1}: {_strip_part(p['title'])}" if _strip_part(p.get("title", "")) else hook
        clip = _plain_clip(lines, p["a"], p["b"], hook_title=hook, title=title,
                           description=p.get("description", ""), hashtags=p.get("hashtags"), reason=p.get("reason", ""), part=k + 1)
        if k > 0:   # meet the previous part exactly
            prev = clips[-1]
            cut = round((lines[out[k - 1]["b"]]["end"] + lines[p["a"]]["start"]) / 2, 3)
            prev["out"] = cut
            clip["in"] = cut
        clips.append(clip)
    for c in clips:
        c["parts"] = len(clips)
    return clips


# ---------------------------------------------------------------- schemas and prompts

_PART = {"type": "object", "additionalProperties": False,
         "required": ["start_line", "end_line", "hook_title", "teaser", "title", "description", "hashtags"],
         "properties": {"start_line": {"type": "integer"}, "end_line": {"type": "integer"}, "hook_title": {"type": "string"},
                        "teaser": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"},
                        "hashtags": {"type": "array", "items": {"type": "string"}}}}
_SERIES_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["series_title", "parts"],
                  "properties": {"series_title": {"type": "string"}, "parts": {"type": "array", "items": _PART}}}

_MATCH = {"type": "object", "additionalProperties": False,
          "required": ["start_line", "end_line", "hook_title", "reason", "score_hook", "score_flow", "score_value",
                       "score_trend", "title", "description", "hashtags"],
          "properties": {"start_line": {"type": "integer"}, "end_line": {"type": "integer"}, "hook_title": {"type": "string"},
                         "reason": {"type": "string"}, "score_hook": {"type": "integer"}, "score_flow": {"type": "integer"},
                         "score_value": {"type": "integer"}, "score_trend": {"type": "integer"}, "title": {"type": "string"},
                         "description": {"type": "string"}, "hashtags": {"type": "array", "items": {"type": "string"}}}}
_TOPIC_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["topic_matches"],
                 "properties": {"topic_matches": {"type": "array", "items": _MATCH}}}

_RANGE = {"type": "object", "additionalProperties": False, "required": ["start_line", "end_line", "point"],
          "properties": {"start_line": {"type": "integer"}, "end_line": {"type": "integer"}, "point": {"type": "string"}}}
_ONE_CLIP = {"hook_title": {"type": "string"}, "reason": {"type": "string"}, "title": {"type": "string"},
             "description": {"type": "string"}, "hashtags": {"type": "array", "items": {"type": "string"}}}
_RECAP_SCHEMA = {"type": "object", "additionalProperties": False,
                 "required": ["recap_ranges", "hook_title", "reason", "title", "description", "hashtags"],
                 "properties": {"recap_ranges": {"type": "array", "items": _RANGE}, **_ONE_CLIP}}
_TRAILER_SCHEMA = {"type": "object", "additionalProperties": False,
                   "required": ["trailer_beats", "hook_title", "reason", "title", "description", "hashtags"],
                   "properties": {"trailer_beats": {"type": "array", "items": _RANGE}, **_ONE_CLIP}}

_COMMON = ("Clips must start and end on the transcript lines given, so nothing is cut mid-thought. Write hook titles "
           "as on-screen text of at most eight words, reasons as one plain sentence, and a title, description and 3-6 "
           "hashtags ready to post.")

SYSTEM = {
    "series": ("You cut one long video into a numbered short-form series (Part 1, Part 2, ...) for TikTok, Shorts and "
               "Reels. The parts are consecutive: together they tell one continuous story, each part starts on the "
               "line right after the previous part ends, and nothing is skipped in between. Choose cut points where "
               "a part can end on a reason to watch the next one: an open question, a turn, a promise of what comes "
               "next. Part 1 must open with a line that makes a stranger stop scrolling. In teaser, say in a few words "
               "why the viewer will want the next part. Do not put 'Part 1' in the hook title; it is added for you. "
               + _COMMON),
    "topic": ("You search a long video's transcript for every strong moment about one topic, for a short-form editor. "
              "Each clip must be clearly about the topic and work on its own: it opens with a line that makes a "
              "stranger stop scrolling and ends on a payoff or a clean sentence. Never add a moment that is off the "
              "topic to reach the number asked for; return fewer, or none, if little matches. Score each clip 0-100 "
              "on hook, flow, value and trend, honestly. " + _COMMON),
    "recap": ("You make ONE short recap of a long video out of several of its own pieces. Pick the lines that carry "
              "the main points, in the order they come in the video, so a viewer who watches only the recap gets the "
              "whole argument or story. Each piece is a range of whole transcript lines; pieces do not overlap and "
              "should be few and meaningful rather than many fragments. In point, say what each piece covers. "
              + _COMMON),
    "trailer": ("You make ONE short trailer for a long video out of a few of its own lines: the beats that build "
                "curiosity, such as the setup, the stakes, a surprising claim, a question. Never include the payoff, "
                "the answer or the ending: the trailer must make people want to watch the full video to find out. "
                "Prefer short, punchy lines. Each beat is a range of whole transcript lines; beats do not overlap and "
                "play in the video's order. In point, say what each beat does. " + _COMMON),
}


def _user_prompt(kind: str, lines: list[dict], count: int, min_len: float, max_len: float, query: str) -> str:
    if kind == "series":
        ask = (f"Cut this into up to {count} parts, each between {min_len:.0f} and {max_len:.0f} seconds long. Use fewer "
               "parts if the story is shorter; never pad.")
    elif kind == "topic":
        ask = (f"The topic: {query.strip()}\nReturn up to {count} clips about it, each between {min_len:.0f} and "
               f"{max_len:.0f} seconds long, that do not overlap.")
    else:
        ask = (f"Make one {kind} between {min_len:.0f} and {max_len:.0f} seconds long in total, from about "
               f"{2 if kind == 'trailer' else 3} to {5 if kind == 'trailer' else 7} pieces."
               + (f" Focus on: {query.strip()}." if query.strip() else ""))
    return ask + "\n\nTranscript lines as [index] (start-end) text:\n\n" + _listing(lines)


# ---------------------------------------------------------------- checking what the model sent back


def _items(data: dict, key: str, need: tuple[str, ...] = ("start_line", "end_line")) -> list[dict]:
    """The model's list under `key`, without entries that lack a usable line range."""
    out = []
    for item in data.get(key) or []:
        try:
            if isinstance(item, dict) and all(isinstance(item[k], (int, float)) and not isinstance(item[k], bool) for k in need):
                out.append(item)
        except KeyError:
            continue
    return out


def check_series(data: dict, lines: list[dict], count: int, max_len: float) -> list[dict]:
    parts = []
    for p in _items(data, "parts"):
        a, b = _clamp_range(lines, p["start_line"], p["end_line"])
        parts.append({"a": a, "b": b, "hook": str(p.get("hook_title", "")), "title": str(p.get("title", "")),
                      "description": str(p.get("description", "")).strip(), "hashtags": _tags(p.get("hashtags")),
                      "reason": str(p.get("teaser", "")).strip() and f"Next part: {str(p['teaser']).strip()}"})
    return _series_clips(lines, parts, max_len)[:count]


def check_topic(data: dict, lines: list[dict], count: int, min_len: float, max_len: float) -> list[dict]:
    picked = []
    for c in _items(data, "topic_matches", ("start_line", "end_line", "score_hook", "score_flow", "score_value", "score_trend")):
        if int(c["start_line"]) >= len(lines):
            continue   # past the end of the transcript: nothing there to be about the topic
        a, b = _clamp_range(lines, c["start_line"], c["end_line"])
        while b > a and _span(lines, a, b) > max_len * 1.15:
            b -= 1
        if _span(lines, a, b) < min(min_len * 0.5, 8):
            continue
        s = {k: int(max(0, min(100, int(c[f"score_{k}"])))) for k in ("hook", "flow", "value", "trend")}
        s["total"] = int(round(0.4 * s["hook"] + 0.2 * s["flow"] + 0.25 * s["value"] + 0.15 * s["trend"]))
        picked.append((a, b, {"hook_title": str(c.get("hook_title", "")).strip(), "reason": str(c.get("reason", "")).strip(),
                              "score": s, "title": str(c.get("title", "")).strip(), "description": str(c.get("description", "")).strip(),
                              "hashtags": _tags(c.get("hashtags"))}))
    return [_plain_clip(lines, a, b, **x) for a, b, x in _no_overlaps(picked)[:count]]


def check_multi(kind: str, data: dict, lines: list[dict], max_len: float) -> list[dict]:
    key = "recap_ranges" if kind == "recap" else "trailer_beats"
    ranges = [_clamp_range(lines, r["start_line"], r["end_line"]) for r in _items(data, key) if int(r["start_line"]) < len(lines)]
    ranges = [(a, b) for a, b, _ in _no_overlaps([(a, b, {}) for a, b in ranges])]
    if kind == "trailer":
        # whatever the model chose, keep the ending out of it
        limit = lines[-1]["end"] * 0.85
        ranges = [(a, b) for a, b in ranges if lines[a]["start"] < limit]
        ranges = [(a, max(a, next((j for j in range(b, a - 1, -1) if lines[j]["end"] <= limit), a))) for a, b in ranges]
    ranges = _fit_total(lines, _merge_touching(ranges), max_len)
    if not ranges:
        return []
    return [_multi_clip(lines, ranges, hook_title=str(data.get("hook_title", "")).strip(), reason=str(data.get("reason", "")).strip(),
                        title=str(data.get("title", "")).strip(), description=str(data.get("description", "")).strip(),
                        hashtags=_tags(data.get("hashtags")))]


# ---------------------------------------------------------------- rule-based fallbacks


def rules_series(lines: list[dict], count: int, min_len: float, max_len: float) -> list[dict]:
    """Split the transcript into up to `count` consecutive parts at sentence ends, each near the target length."""
    total = lines[-1]["end"] - lines[0]["start"]
    n = max(1, min(count, int(total // max(min_len, 1)) or 1))
    target = max(min_len, min(max_len, total / n))
    parts, i = [], 0
    while i < len(lines) and len(parts) < count:
        best = i
        for j in range(i, len(lines)):
            if _span(lines, i, j) > max_len and j > i:
                break
            best = j
            if _span(lines, i, j) >= target:
                # stop here, or one sentence earlier if that lands closer to the target
                if j > i and abs(_span(lines, i, j - 1) - target) < abs(_span(lines, i, j) - target) and _span(lines, i, j - 1) >= min_len:
                    best = j - 1
                break
        parts.append({"a": i, "b": best, "hook": "", "reason": ""})
        i = best + 1
    # a stub of a last part joins the one before it when there is room
    if len(parts) > 1 and _span(lines, parts[-1]["a"], parts[-1]["b"]) < min_len * 0.5 \
            and _span(lines, parts[-2]["a"], parts[-1]["b"]) <= max_len * 1.15:
        parts[-2]["b"] = parts.pop()["b"]
    clips = _series_clips(lines, parts, max_len)
    for c in clips:
        c["reason"] = f"Part {c['part']} of {len(clips)}, cut at a sentence end."
    return clips


def _topic_terms(topic: str) -> list[str]:
    out = []
    for t in topic.split():
        n = norm(t)
        if n and n not in STOP:
            out.append(n[:-1] if len(n) > 4 and n.endswith("s") else n)
    return out


def rules_topic(lines: list[dict], count: int, min_len: float, max_len: float, topic: str) -> list[dict]:
    """Windows of whole sentences that mention the topic words, best first, never padded with other moments."""
    terms = _topic_terms(topic)
    if not terms:
        return []
    hits = [sum(n.startswith(t) for t in terms for n in (norm(w) for w in l["text"].split())) for l in lines]
    cands = []
    for i in range(len(lines)):
        for j in range(i, len(lines)):
            dur = _span(lines, i, j)
            if dur > max_len:
                break
            h = sum(hits[i:j + 1])
            if not hits[i] and not (i + 1 <= j and hits[i + 1]):
                continue   # open on, or right before, the topic
            if h == 0 or dur < min(min_len, lines[-1]["end"] - lines[0]["start"]):
                continue
            score = _score_window(lines[i:j + 1])
            rank = score["total"] + 20 * h - abs(dur - (min_len + max_len) / 2) / max_len * 6
            cands.append((rank, i, j, score))
    cands.sort(key=lambda c: c[0], reverse=True)
    picked = []
    for _, i, j, score in cands:
        if all(j < p[0] or i > p[1] for p in picked):
            picked.append((i, j, {"score": score, "reason": f"Mentions {topic.strip()}: picked by rules."}))
        if len(picked) >= count:
            break
    return [_plain_clip(lines, a, b, **x) for a, b, x in sorted(picked)]


def _line_value(line: dict) -> float:
    toks = [norm(t) for t in line["text"].split()]
    return (_score_window([line])["total"] + 6 * sum(t in VALUE_WORDS for t in toks)
            + 5 * sum(bool(re.search(r"\d", t)) for t in toks) - 15 * (len(toks) < 4))


def rules_recap(lines: list[dict], min_len: float, max_len: float) -> list[dict]:
    """The strongest sentence from each stretch of the video, in order, until the target length is reached."""
    target = (min_len + max_len) / 2
    avg = sum(l["end"] - l["start"] for l in lines) / len(lines)
    k = max(2, min(7, len(lines), round(target / max(avg, 1))))
    size = len(lines) / k
    ranges = []
    for b in range(k):
        bucket = range(int(b * size), max(int(b * size) + 1, int((b + 1) * size)))
        best = max(bucket, key=lambda i: _line_value(lines[i]))
        ranges.append((best, best))
    ranges = _fit_total(lines, _merge_touching(ranges), max_len)
    return [_multi_clip(lines, ranges, reason="Picked by rules: the strongest sentence from each part of the video, in order.")]


def _energy(line: dict) -> float:
    toks = [norm(t) for t in line["text"].split()]
    dur = line["end"] - line["start"]
    return (14 * sum(t in HOOK_WORDS for t in toks) + 12 * ("?" in line["text"]) + 8 * ("!" in line["text"])
            + 6 * sum(bool(re.search(r"\d", t)) for t in toks) + 8 * sum(t in ("you", "your") for t in toks[:6])
            - 3 * max(0.0, dur - 5) - 20 * (len(toks) < 3))


def rules_trailer(lines: list[dict], min_len: float, max_len: float) -> list[dict]:
    """Short, high-energy lines from before the last third, in order: the setup without the payoff."""
    limit = lines[0]["start"] + (lines[-1]["end"] - lines[0]["start"]) * 2 / 3
    pool = [i for i, l in enumerate(lines) if l["end"] <= limit] or [0]
    target = max(min_len, min(max_len, (min_len + max_len) / 2))
    chosen: list[int] = []
    for i in sorted(pool, key=lambda i: _energy(lines[i]), reverse=True):
        if chosen and sum(lines[j]["end"] - lines[j]["start"] for j in chosen) >= target:
            break
        if sum(lines[j]["end"] - lines[j]["start"] for j in chosen) + lines[i]["end"] - lines[i]["start"] > max_len * 1.15 and chosen:
            continue
        chosen.append(i)
    ranges = _fit_total(lines, _merge_touching([(i, i) for i in chosen]), max_len)
    return [_multi_clip(lines, ranges, reason="Picked by rules: short, punchy lines from before the last third, so the ending stays a surprise.")]


# ---------------------------------------------------------------- the entry point


def find(words: list[dict], kind: str = "highlights", count: int = 6, min_len: float = 20, max_len: float = 60,
         query: str = "", instructions: str = "", brief: str = "", rules: list[str] | None = None,
         performance: dict | None = None) -> dict:
    """Clips of the given type. Returns {engine, note, clips:[{in, out, hook_title, reason, score, ..., segments?}]}."""
    if kind not in KINDS:
        raise ValueError(f"unknown clip type {kind}")
    extra = extra_note(instructions, performance)
    if kind == "highlights":
        found = find_moments(words, count, min_len, max_len, query, brief, rules, extra=extra)
        if instructions.strip() and found["engine"] == "rules":
            found["note"] += " Instructions are only followed with AI."
        return found
    lines = sentences(words)
    if not lines:
        return {"engine": "none", "note": "The transcript is empty.", "clips": []}
    if kind == "topic" and not query.strip():
        return {"engine": "none", "note": "Type the topic to look for.", "clips": []}
    note = ""
    if ai.available():
        user = _user_prompt(kind, lines, count, min_len, max_len, query) + _style_note(brief, rules) + extra
        schema = {"series": _SERIES_SCHEMA, "topic": _TOPIC_SCHEMA, "recap": _RECAP_SCHEMA, "trailer": _TRAILER_SCHEMA}[kind]
        try:
            data = ai.ask_json(SYSTEM[kind], user, schema)
            if kind == "series":
                clips = check_series(data, lines, count, max_len)
            elif kind == "topic":
                clips = check_topic(data, lines, count, min_len, max_len)
            else:
                clips = check_multi(kind, data, lines, max_len)
            if clips or kind == "topic":
                return {"engine": "ai", "note": "" if clips else "Nothing in the video is clearly about that topic.", "clips": clips}
            note = f"The AI did not return a usable {kind}; used built-in rules instead."
        except ai.AIUnavailable as e:
            note = f"AI unavailable ({e}); used built-in rules instead."
        except (KeyError, TypeError, ValueError, AttributeError):
            note = "The AI's answer did not fit the transcript; used built-in rules instead."
    else:
        note = f"No AI set up; {LABELS[kind]} made with built-in rules. Set one up under Settings → AI for better picks."
    if instructions.strip():
        note += " Instructions are only followed with AI."
    if kind == "series":
        clips = rules_series(lines, count, min_len, max_len)
    elif kind == "topic":
        clips = rules_topic(lines, count, min_len, max_len, query)
        if not clips:
            note += " Nothing in the transcript mentions that topic."
    elif kind == "recap":
        clips = rules_recap(lines, min_len, max_len)
    else:
        clips = rules_trailer(lines, min_len, max_len)
    return {"engine": "rules", "note": note, "clips": clips}


# ---------------------------------------------------------------- applying several kept ranges to a clip spec


def apply_ranges(spec: dict, segments: list[dict]) -> dict:
    """Keep only these source ranges of a clip: words outside them are marked removed, and spec.segments is set the
    same way the editor derives it from removed words, so opening the clip in the editor keeps the same cut."""
    ranges = sorted((float(s["start"]), float(s["end"])) for s in segments)
    inside = lambda w: any(a - 0.05 <= w["start"] and w["end"] <= b + 0.05 for a, b in ranges)
    tin, tout = spec["in"], spec["out"]
    words = [w for w in spec["words"] if w["end"] > tin and w["start"] < tout]
    for w in words:
        if not inside(w):
            w["removed"] = True
    cuts = []
    i = 0
    while i < len(words):
        if not words[i].get("removed"):
            i += 1
            continue
        j = i
        while j + 1 < len(words) and words[j + 1].get("removed"):
            j += 1
        before = words[i - 1] if i > 0 else None
        after = words[j + 1] if j + 1 < len(words) else None
        start = min(before["end"] + 0.04, words[i]["start"]) if before else tin
        end = max(after["start"] - 0.04, words[j]["end"]) if after else tout
        if end - start > 0.06:
            cuts.append((start, end))
        i = j + 1
    segs, cursor = [], tin
    for s, e in cuts:
        s, e = max(tin, min(tout, s)), max(tin, min(tout, e))
        if e <= cursor:
            continue
        if s - cursor > 0.08:
            segs.append({"start": round(cursor, 3), "end": round(s, 3)})
        cursor = max(cursor, e)
    if tout - cursor > 0.08:
        segs.append({"start": round(cursor, 3), "end": round(tout, 3)})
    spec["segments"] = segs or [{"start": tin, "end": tout}]
    # The chosen ranges themselves: the editor keeps its derived segments inside these, so a later word cut or
    # pause removal does not bring the gaps back.
    spec["ranges"] = [{"start": round(a, 3), "end": round(b, 3)} for a, b in ranges]
    return spec
