"""Finding and dressing up moments: clip selection, virality scores, hooks, emphasis, graphics, metadata.

Each function tries Claude first and falls back to transparent rules, returning which engine produced the result.
"""
from __future__ import annotations

import re
from collections import Counter

from . import ai

STOP = set("""a about after again all also am an and any are as at be because been before being but by can could did do does
doing down for from further had has have having he her here hers him his how i if in into is it its just like me more most
my no nor not now of off on once only or other our out over own really same she so some such than that the their them then
there these they this those through to too under until up very was we were what when where which while who why will with
you your yeah okay um uh gonna got get going know think thing things actually basically kind sort mean lot little one would
said say says went go back well right every much many even still let make made want need thats dont im ive youre its""".split())

HOOK_WORDS = set("""secret nobody never always mistake truth why how stop worst best biggest crazy insane shocking wrong
accidentally actually hate love biggest first last only money million billion free hack trick lie lied warning""".split())
VALUE_WORDS = set("because so therefore means result learned lesson realized simple step rule tip fix fixed works reason percent".split())
TREND_WORDS = set("ai money sleep coffee caffeine gym diet dating business startup crypto invest job career school mindset discipline habit health viral".split())
FILLERS = {"um", "uh", "erm", "er", "hmm", "uhh", "umm", "ah"}

EMOJI = {
    "coffee": "☕", "caffeine": "☕", "espresso": "☕", "sleep": "😴", "slept": "😴", "bed": "🛏️", "night": "🌙", "money": "💰",
    "dollars": "💵", "million": "💰", "fire": "🔥", "crazy": "🤯", "insane": "🤯", "idea": "💡", "secret": "🤫", "love": "❤️",
    "heart": "❤️", "time": "⏰", "hours": "⏰", "win": "🏆", "won": "🏆", "energy": "⚡", "fast": "⚡", "brain": "🧠",
    "mind": "🧠", "work": "💼", "job": "💼", "gym": "💪", "strong": "💪", "food": "🍽️", "phone": "📱", "book": "📚",
    "happy": "😄", "sad": "😢", "scared": "😨", "wrong": "❌", "mistake": "❌", "right": "✅", "fixed": "✅", "percent": "📊",
    "rocket": "🚀", "growth": "📈", "up": "📈", "down": "📉", "dropped": "📉", "warning": "⚠️", "stop": "🛑", "world": "🌍",
    "label": "🏷️", "box": "📦", "check": "✅", "why": "🤔", "question": "🤔",
}


def norm(word: str) -> str:
    return re.sub(r"[^a-z0-9%$']", "", word.lower())


def sentences(words: list[dict], max_words: int = 26) -> list[dict]:
    """Group words into sentence-like lines (punctuation when present, pauses otherwise)."""
    out: list[dict] = []
    cur: list[dict] = []

    def flush() -> None:
        if cur:
            out.append({"start": cur[0]["start"], "end": cur[-1]["end"], "first": cur[0]["id"], "last": cur[-1]["id"],
                        "text": " ".join(w["text"] for w in cur)})
            cur.clear()

    for i, w in enumerate(words):
        if cur and w["start"] - cur[-1]["end"] > 0.9:
            flush()
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        ends = bool(re.search(r"[.!?][\"')]?$", w["text"]))
        if ends or len(cur) >= max_words or (nxt and nxt["start"] - w["end"] > 0.9):
            flush()
    flush()
    return out


def keywords(words: list[dict], n: int = 6) -> list[str]:
    counts = Counter(norm(w["text"]) for w in words)
    cands = [(c + (2 if k in TREND_WORDS or k in HOOK_WORDS else 0) + len(k) / 10, k)
             for k, c in counts.items() if len(k) > 3 and k not in STOP and not k.isdigit()]
    return [k for _, k in sorted(cands, reverse=True)[:n]]


# ---------------------------------------------------------------- moments

def _score_window(lines: list[dict]) -> dict:
    first = lines[0]["text"].lower()
    toks = [norm(t) for l in lines for t in l["text"].split()]
    dur = lines[-1]["end"] - lines[0]["start"]
    first_toks = [norm(t) for t in first.split()][:14]
    hook = 35 + 14 * sum(t in HOOK_WORDS for t in first_toks) + (12 if "?" in first else 0) \
        + 8 * sum(t in ("you", "your", "i") for t in first_toks[:6]) + (10 if any(re.search(r"\d", t) for t in first_toks) else 0)
    gaps = [b["start"] - a["end"] for a, b in zip(lines, lines[1:])]
    wps = len(toks) / max(dur, 1)
    flow = 60 + (15 if 2.0 <= wps <= 3.6 else -10) - 12 * sum(g > 1.5 for g in gaps) \
        + (12 if re.search(r"[.!?]$", lines[-1]["text"]) else 0)
    value = 40 + 9 * sum(t in VALUE_WORDS for t in toks) + 7 * sum(bool(re.search(r"\d", t)) for t in toks)
    trend = 38 + 11 * len({t for t in toks if t in TREND_WORDS})
    s = {k: int(max(5, min(98, v))) for k, v in (("hook", hook), ("flow", flow), ("value", value), ("trend", trend))}
    s["total"] = int(round(0.4 * s["hook"] + 0.2 * s["flow"] + 0.25 * s["value"] + 0.15 * s["trend"]))
    return s


def _title_from(text: str, limit: int = 7) -> str:
    toks = re.sub(r"[^\w\s'%$-]", "", text).split()
    while toks and norm(toks[0]) in ("and", "so", "but", "um", "uh", "well", "like", "yeah"):
        toks.pop(0)
    return " ".join(toks[:limit]).strip().capitalize() or "Untitled moment"


def _heuristic_moments(lines: list[dict], count: int, min_len: float, max_len: float, query: str) -> list[dict]:
    q = [norm(t) for t in query.split() if norm(t) and norm(t) not in STOP]
    cands: list[tuple[float, int, int, dict]] = []
    for i in range(len(lines)):
        for j in range(i, len(lines)):
            dur = lines[j]["end"] - lines[i]["start"]
            if dur > max_len:
                break
            if dur < min_len:
                continue
            window = lines[i:j + 1]
            score = _score_window(window)
            rank = float(score["total"])
            if q:
                text = " ".join(norm(t) for l in window for t in l["text"].split())
                hits = sum(text.count(t) for t in q)
                if not hits:
                    continue
                rank += 25 * hits
            # prefer windows near the middle of the allowed length
            rank -= abs(dur - (min_len + max_len) / 2) / max_len * 6
            cands.append((rank, i, j, score))
    cands.sort(key=lambda c: c[0], reverse=True)
    picked: list[tuple[float, int, int, dict]] = []
    for c in cands:
        if all(c[2] < p[1] or c[1] > p[2] for p in picked):
            picked.append(c)
        if len(picked) >= count:
            break
    out = []
    for _, i, j, score in sorted(picked, key=lambda c: c[1]):
        window = lines[i:j + 1]
        text = " ".join(l["text"] for l in window)
        kws = keywords([{"text": t} for t in text.split()], 4)
        title = _title_from(window[0]["text"])
        out.append({
            "in": window[0]["start"], "out": window[-1]["end"], "hook_title": title,
            "reason": "Picked by rules: strong opening words, steady pace and a clean sentence ending.",
            "score": score, "title": title, "description": window[0]["text"][:140],
            "hashtags": ["#" + k for k in kws] + ["#shorts"],
        })
    return out


_MOMENTS_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["clips"],
    "properties": {"clips": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["start_line", "end_line", "hook_title", "reason", "score_hook", "score_flow", "score_value",
                     "score_trend", "title", "description", "hashtags"],
        "properties": {
            "start_line": {"type": "integer"}, "end_line": {"type": "integer"},
            "hook_title": {"type": "string"}, "reason": {"type": "string"},
            "score_hook": {"type": "integer"}, "score_flow": {"type": "integer"},
            "score_value": {"type": "integer"}, "score_trend": {"type": "integer"},
            "title": {"type": "string"}, "description": {"type": "string"},
            "hashtags": {"type": "array", "items": {"type": "string"}},
        }}}},
}


def find_moments(words: list[dict], count: int = 6, min_len: float = 20, max_len: float = 60, query: str = "",
                 brief: str = "", rules: list[str] | None = None, extra: str = "") -> dict:
    """Pick the best self-contained moments. Returns {engine, note, clips:[{in, out, hook_title, reason, score, ...}]}.

    `extra` is appended to the request as is (the editor's instructions, past performance; see cliptypes.extra_note)."""
    lines = sentences(words)
    if not lines:
        return {"engine": "none", "note": "The transcript is empty.", "clips": []}
    note = ""
    if ai.available():
        listing = "\n".join(f"[{i}] ({l['start']:.1f}s-{l['end']:.1f}s) {l['text']}" for i, l in enumerate(lines))
        system = (
            "You select clips from a long video's transcript for a short-form editor (TikTok, Shorts, Reels). "
            "A good clip is self-contained, opens with a line that makes a stranger stop scrolling, builds without "
            "dead air, and ends on a payoff or a clean sentence. It must start and end on the transcript lines given, "
            "so nothing is cut mid-thought. Score each clip 0-100 on four things: hook (the first three seconds), "
            "flow (pace and coherence), value (does the viewer learn or feel something), and trend (how well the topic "
            "travels right now). Be honest with scores; most moments are not 90s. Write the hook title as on-screen "
            "text of at most eight words, the reason as one plain sentence, and a title, description and 3-6 hashtags "
            "ready to post."
        )
        user = (
            f"Choose up to {count} clips, each between {min_len:.0f} and {max_len:.0f} seconds long, that do not overlap. "
            + (f"The editor is specifically looking for: {query.strip()}. Only return moments that match; return fewer, "
               "or none, if little matches.\n\n" if query.strip() else "\n\n")
            + "Transcript lines as [index] (start-end) text:\n\n" + listing
        ) + _style_note(brief, rules) + extra
        try:
            data = ai.ask_json(system, user, _MOMENTS_SCHEMA)
            clips = []
            for c in data.get("clips", []):
                a = max(0, min(len(lines) - 1, int(c["start_line"])))
                b = max(a, min(len(lines) - 1, int(c["end_line"])))
                # keep the model's choice but respect the length limits
                while b > a and lines[b]["end"] - lines[a]["start"] > max_len * 1.15:
                    b -= 1
                s = {k: int(max(0, min(100, c[f"score_{k}"]))) for k in ("hook", "flow", "value", "trend")}
                s["total"] = int(round(0.4 * s["hook"] + 0.2 * s["flow"] + 0.25 * s["value"] + 0.15 * s["trend"]))
                clips.append({
                    "in": lines[a]["start"], "out": lines[b]["end"], "hook_title": c["hook_title"].strip(),
                    "reason": c["reason"].strip(), "score": s, "title": c["title"].strip(),
                    "description": c["description"].strip(),
                    "hashtags": [h if h.startswith("#") else "#" + h for h in c["hashtags"]][:8],
                })
            return {"engine": "ai", "note": "", "clips": sorted(clips, key=lambda c: c["in"])}
        except ai.AIUnavailable as e:
            note = f"AI unavailable ({e}); used built-in rules instead."
    else:
        note = "No AI set up; moments were picked with built-in rules. Set one up under Settings → AI for better picks."
    return {"engine": "rules", "note": note, "clips": _heuristic_moments(lines, count, min_len, max_len, query)}


# ---------------------------------------------------------------- remix (emphasis, emojis, zooms, graphics, hook)

GRAPHIC_TYPES = ["keyword", "cascade", "gauge", "counter", "lowerthird", "steps", "emoji"]
ZONES = ["full", "top", "center", "bottom", "overlay"]
ANIMS = ["pop", "slam", "fade", "slide", "glitch", "type"]
SFX = ["", "pop", "whoosh", "click", "ding", "riser", "thud", "swish", "glitch", "sparkle"]

_REMIX_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["hook", "emphasis_word_ids", "emojis", "zooms", "graphics"],
    "properties": {
        "hook": {"type": "string"},
        "emphasis_word_ids": {"type": "array", "items": {"type": "integer"}},
        "emojis": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                               "required": ["word_id", "emoji"],
                                               "properties": {"word_id": {"type": "integer"}, "emoji": {"type": "string"}}}},
        "zooms": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                              "required": ["word_id", "seconds"],
                                              "properties": {"word_id": {"type": "integer"}, "seconds": {"type": "number"}}}},
        "graphics": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["word_id", "type", "zone", "animation", "sfx", "seconds", "primary", "headline", "keywords"],
            "properties": {
                "word_id": {"type": "integer"}, "type": {"type": "string", "enum": GRAPHIC_TYPES},
                "zone": {"type": "string", "enum": ZONES}, "animation": {"type": "string", "enum": ANIMS},
                "sfx": {"type": "string", "enum": SFX}, "seconds": {"type": "number"},
                "primary": {"type": "string"}, "headline": {"type": "string"},
                "keywords": {"type": "array", "items": {"type": "string"}},
            }}},
    },
}


def _heuristic_remix(words: list[dict], density: float) -> dict:
    live = [w for w in words if not w.get("removed")]
    kws = keywords(live, 8)
    emphasis, emojis, zooms, graphics = [], [], [], []
    last_graphic = -99.0
    last_zoom = -99.0
    last_emoji = -99.0
    seen_emoji: set[str] = set()
    gap = max(3.5, 9.0 / max(0.3, density))
    for w in live:
        n = norm(w["text"])
        is_num = bool(re.search(r"\d", n)) or n in ("percent", "hundred", "thousand", "million", "billion")
        if is_num or n in kws[:5] or n in HOOK_WORDS:
            emphasis.append(w["id"])
        if n in EMOJI and EMOJI[n] not in seen_emoji and w["start"] - last_emoji > 5.0:
            emojis.append({"word_id": w["id"], "emoji": EMOJI[n]})
            seen_emoji.add(EMOJI[n])
            last_emoji = w["start"]
        if (n in HOOK_WORDS or is_num) and w["start"] - last_zoom > 4.5:
            zooms.append({"word_id": w["id"], "seconds": 1.4})
            last_zoom = w["start"]
        if w["start"] - last_graphic < gap:
            continue
        if re.fullmatch(r"\$?\d[\d,.]*%?", n) and len(n) > 1:
            pct = n.endswith("%")
            graphics.append({"word_id": w["id"], "type": "gauge" if pct else "counter", "zone": "center",
                             "animation": "pop", "sfx": "pop", "seconds": 2.2, "primary": n.upper(), "headline": "", "keywords": []})
            last_graphic = w["start"]
        elif n in kws[:4] and len(n) > 4:
            graphics.append({"word_id": w["id"], "type": "keyword", "zone": "top", "animation": "slam", "sfx": "thud",
                             "seconds": 1.8, "primary": n.upper(), "headline": "", "keywords": []})
            last_graphic = w["start"]
    if live and len(kws) >= 3:
        tail = [w for w in live if w["start"] >= live[-1]["end"] - 4.0]
        if tail and tail[0]["start"] - last_graphic > 3:
            graphics.append({"word_id": tail[0]["id"], "type": "cascade", "zone": "full", "animation": "fade", "sfx": "whoosh",
                             "seconds": 2.6, "primary": "", "headline": "", "keywords": [k.upper() for k in kws[:3]]})
    first = sentences(live)[:1]
    return {"hook": _title_from(first[0]["text"], 6) if first else "", "emphasis_word_ids": emphasis, "emojis": emojis,
            "zooms": zooms, "graphics": graphics}


def _style_note(brief: str, rules: list[str] | None) -> str:
    """The person's style, appended to a request so every answer follows it."""
    if not brief and not rules:
        return ""
    out = "\n\nThis video is being made in a particular house style. Follow it over the general guidance above where they differ."
    if brief:
        out += f"\nThe style: {brief}"
    if rules:
        out += "\nStanding rules:\n" + "\n".join(f"- {r}" for r in rules)
    return out


def remix(words: list[dict], density: float = 1.0, title: str = "", brief: str = "", rules: list[str] | None = None,
          limits: dict | None = None) -> dict:
    """Editing plan for one clip. `density` scales how many graphics to add (0.3 sparse .. 2 busy).
    `limits` (from the style) removes what the style does not allow, whatever the AI or the fallback suggested."""
    return limit_remix(_remix(words, density, title, brief, rules, limits), limits)


def limit_remix(plan: dict, limits: dict | None) -> dict:
    if not limits:
        return plan
    allowed = set(limits.get("graphics") or [])
    plan = dict(plan)
    plan["graphics"] = [dict(g, sfx=g.get("sfx", "") if limits.get("sfx", True) else "") for g in plan.get("graphics") or [] if g.get("type") in allowed]
    if not limits.get("emoji", True):
        plan["emojis"] = []
    if not limits.get("zooms", True):
        plan["zooms"] = []
    if not limits.get("hook", True):
        plan["hook"] = ""
    return plan


def _limits_note(limits: dict | None) -> str:
    if not limits:
        return ""
    parts = []
    g = limits.get("graphics")
    parts.append("Graphics allowed in this style: " + (", ".join(g) if g else "none") + ".")
    if not limits.get("sfx", True):
        parts.append("Use no sound effects (sfx empty).")
    if not limits.get("emoji", True):
        parts.append("Use no emoji.")
    if not limits.get("freezes", True):
        parts.append("Use no freeze-frames.")
    if not limits.get("speeds", True):
        parts.append("Use no speed changes.")
    elif limits.get("min_rate"):
        parts.append(f"Never slow below {limits['min_rate']}x.")
    return "\n\nLimits of this style, which override everything else: " + " ".join(parts)


def _remix(words: list[dict], density: float, title: str, brief: str, rules: list[str] | None, limits: dict | None) -> dict:
    live = [w for w in words if not w.get("removed")]
    if not live:
        return {"engine": "none", "note": "No words in this clip.", "hook": "", "emphasis_word_ids": [], "emojis": [], "zooms": [], "graphics": []}
    note = ""
    if ai.available():
        dur = live[-1]["end"] - live[0]["start"]
        target = max(1, round(dur / 8 * density))
        listing = " ".join(f"{w['id']}|{w['text']}" for w in live)
        system = (
            "You plan the on-screen edit of a vertical short: which spoken words to emphasise in the captions, where an "
            "emoji helps, where a quick punch-in zoom lands, and which motion graphics to add. Everything is anchored to "
            "a word id from the transcript and appears when that word is spoken. Use graphics to make a number, a "
            "contrast or a list land harder, never to decorate: a gauge for a percentage, a counter for another number, "
            "a keyword for the one word that carries a beat, a cascade or steps for a list of two to four items "
            "(put the items in keywords), a lowerthird for a name or takeaway. Graphics must not sit on top of each "
            "other in time, and the first two seconds belong to the hook. Keep on-screen text to a few words, in the "
            "speaker's own terms. Pick a sound effect that fits, or an empty string for none."
        )
        user = (
            f"Clip length {dur:.0f}s" + (f", working title: {title}" if title else "") + f". Aim for about {target} graphics, "
            f"about {max(2, round(dur / 6))} zooms of 1-2 seconds, emphasis on roughly one word in eight, and emojis only "
            "where they add meaning. Also write a hook of at most eight words to show for the first seconds.\n\n"
            "Transcript as id|word:\n" + listing
        )
        user += _style_note(brief, rules) + _limits_note(limits)
        try:
            data = ai.ask_json(system, user, _REMIX_SCHEMA, max_tokens=16000)
            ids = {w["id"] for w in live}
            data["emphasis_word_ids"] = [i for i in data["emphasis_word_ids"] if i in ids]
            for key in ("emojis", "zooms", "graphics"):
                data[key] = [x for x in data[key] if x["word_id"] in ids]
            return {"engine": "ai", "note": "", **data}
        except ai.AIUnavailable as e:
            note = f"AI unavailable ({e}); used built-in rules instead."
    else:
        note = "No AI set up; this plan comes from built-in rules."
    return {"engine": "rules", "note": note, **_heuristic_remix(words, density)}


# ---------------------------------------------------------------- metadata, hooks, translation

_META_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["title", "description", "hashtags"],
    "properties": {"title": {"type": "string"}, "description": {"type": "string"},
                   "hashtags": {"type": "array", "items": {"type": "string"}}},
}
_HOOKS_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["hooks"],
    "properties": {"hooks": {"type": "array", "items": {"type": "string"}}},
}
_TRANSLATE_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["lines"],
    "properties": {"lines": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["index", "text"],
        "properties": {"index": {"type": "integer"}, "text": {"type": "string"}}}}},
}


def _text(words: list[dict]) -> str:
    return " ".join(w["text"] for w in words if not w.get("removed"))


def post_meta(words: list[dict], hook: str = "", brief: str = "", rules: list[str] | None = None) -> dict:
    text = _text(words)
    if ai.available():
        try:
            data = ai.ask_json(
                "You write the post text for a short-form video: a title under 70 characters that earns the click "
                "without lying about the content, a one or two sentence description, and 4-6 hashtags mixing broad and "
                "specific. Plain language, no emoji spam.",
                (f"On-screen hook: {hook}\n\n" if hook else "") + "Transcript of the short:\n" + text + _style_note(brief, rules),
                _META_SCHEMA, max_tokens=4000, effort="low")
            data["hashtags"] = [h if h.startswith("#") else "#" + h for h in data["hashtags"]][:8]
            return {"engine": "ai", "note": "", **data}
        except ai.AIUnavailable as e:
            note = f"AI unavailable ({e}); used built-in rules instead."
    else:
        note = "No AI set up; written with built-in rules."
    first = sentences([w for w in words if not w.get("removed")])[:1]
    title = hook or (_title_from(first[0]["text"], 9) if first else "Untitled")
    return {"engine": "rules", "note": note, "title": title, "description": (first[0]["text"] if first else "")[:180],
            "hashtags": ["#" + k for k in keywords(words, 4)] + ["#shorts"]}


def hook_ideas(words: list[dict], n: int = 5, brief: str = "", rules: list[str] | None = None) -> dict:
    text = _text(words)
    if ai.available():
        try:
            data = ai.ask_json(
                "You write on-screen hook titles for short-form video: at most eight words, shown for the first two "
                "seconds, that open a curiosity gap the clip actually closes. Vary the angle between options "
                "(a question, a bold claim, a number, a confession).",
                f"Write {n} options for this clip:\n{text}" + _style_note(brief, rules), _HOOKS_SCHEMA, max_tokens=4000, effort="low")
            return {"engine": "ai", "note": "", "hooks": [h.strip() for h in data["hooks"]][:n]}
        except ai.AIUnavailable as e:
            note = f"AI unavailable ({e}); used built-in rules instead."
    else:
        note = "No AI set up; these come from built-in rules."
    lines = sentences([w for w in words if not w.get("removed")])
    kws = keywords(words, 3)
    ideas = [_title_from(l["text"], 7) for l in lines[:2]]
    if kws:
        ideas += [f"The truth about {kws[0]}", f"Nobody talks about {kws[0]}", f"Why {kws[0]} matters"]
    return {"engine": "rules", "note": note, "hooks": list(dict.fromkeys(i for i in ideas if i))[:n]}


def translate_lines(lines: list[dict], language: str) -> dict:
    """lines: [{start, end, text}] -> same timings with translated text. AI only."""
    data = ai.ask_json(
        f"You translate video captions into {language}. Keep each line short enough to read at a glance, keep the "
        "speaker's tone, and return exactly one translated line per input line with the same index.",
        "\n".join(f"[{i}] {l['text']}" for i, l in enumerate(lines)), _TRANSLATE_SCHEMA, max_tokens=16000, effort="low")
    by_index = {x["index"]: x["text"] for x in data["lines"]}
    return {"engine": "ai", "lines": [{"start": l["start"], "end": l["end"], "text": by_index.get(i, l["text"])}
                                      for i, l in enumerate(lines)]}


# ---------------------------------------------------------------- director: plans a story edit by looking at the picture

DIRECT_TYPES = ["label", "nametag", "circle", "arrow", "spotlight", "flash", "dip", "heart", "emoji", "keyword", "counter", "lowerthird"]
_DIRECT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "elements", "freezes", "speeds", "post_title", "description", "hashtags", "notes"],
    "properties": {
        "title": {"type": "string", "description": "The on-screen title or hook. Mark words to colour with {curly brackets}; use a line break for a second row."},
        "elements": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["type", "at_seconds", "seconds", "text", "colour", "label_look", "position", "on_subject", "animation"],
            "properties": {
                "type": {"type": "string", "enum": DIRECT_TYPES},
                "at_seconds": {"type": "number", "description": "When it appears, in seconds from the start of the clip."},
                "seconds": {"type": "number", "description": "How long it stays."},
                "text": {"type": "string", "description": "Its text, with {curly brackets} around words to colour. Empty for circle, arrow, spotlight, flash, dip."},
                "colour": {"type": "string", "description": "#rrggbb, or empty for the style's default."},
                "label_look": {"type": "string", "enum": ["", "neon", "quoted", "plain", "box", "outline", "flat"]},
                "position": {"type": "string", "enum": ["top", "upper", "middle", "lower", "bottom"], "description": "Where a text element sits in the frame."},
                "on_subject": {"type": "boolean", "description": "True to place it on the main person or object (circle, arrow, spotlight, nametag)."},
                "animation": {"type": "string", "enum": ["pop", "fade", "type", "slam", "slide"]},
            }}},
        "freezes": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["at_seconds", "seconds"],
                                                "properties": {"at_seconds": {"type": "number"}, "seconds": {"type": "number"}}}},
        "speeds": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["from_seconds", "to_seconds", "rate"],
                                               "properties": {"from_seconds": {"type": "number"}, "to_seconds": {"type": "number"}, "rate": {"type": "number"}}}},
        "post_title": {"type": "string"}, "description": {"type": "string"},
        "hashtags": {"type": "array", "items": {"type": "string"}},
        "notes": {"type": "array", "items": {"type": "string"}, "description": "Anything the editor should check by eye, such as an assumed relationship or a placement you could not judge."},
    },
}

DIRECT_SYSTEM = """\
You are directing the edit of a short video from raw footage, for an editing program that will place what you ask for. \
You are shown still frames from the clip with their times, and the transcript if anyone speaks. Work out what happens, \
find the beats of the story, and plan the on-screen text and effects that tell it in the given style.

Everything is timed in seconds from the start of the clip. Text elements stay readable only if they do not overlap in \
time unless the style calls for it, and nothing should sit on a face. You cannot place things precisely from stills, so \
for anything that must sit on a person or object set on_subject and the program will put it on the main subject; the \
editor will adjust by hand. Say in notes what you were unsure of.

Write only what the footage shows. Do not invent names, relationships or events; where the style calls for dialogue \
written to fit the story, keep it short and note that it is written, not heard."""


def direct(frames: list[tuple[float, bytes]], words: list[dict], duration: float, brief: str, rules: list[str] | None, title: str = "",
           limits: dict | None = None, has_title: bool = False, reference_frames: list | None = None) -> dict:
    """A story edit planned from the picture. Needs an AI key: there is no rule-based way to see what happens."""
    said = " ".join(f"[{w['start']:.1f}s] {w['text']}" if i % 6 == 0 else w["text"] for i, w in enumerate(words) if not w.get("removed")) or "(no speech)"
    parts: list = [
        f"The clip is {duration:.1f} seconds long" + (f"; working title: {title}" if title else "") + ".\n\nTranscript, with times in seconds from the start of the clip:\n" + said
        + _style_note(brief, rules) + _limits_note(limits) + "\n\nFrames follow, each introduced by its time."]
    if reference_frames:
        # the style's own reference videos, looked at again on every plan so the edit matches them, not just the words
        parts.append("Before the clip, look again at stills from finished videos in this style. Match their look, text sizes, "
                     "positions and pacing; never copy their words, names, watermarks or logos. The clip's own frames follow after these.")
        for label, jpeg in reference_frames:
            parts.append(label + ":")
            parts.append({"image": jpeg})
        parts.append("The clip to edit:")
    for t, jpeg in frames:
        parts.append(f"Frame at {t:.1f}s:")
        parts.append({"image": jpeg})
    data = ai.ask_json(DIRECT_SYSTEM, parts, _DIRECT_SCHEMA, max_tokens=16000, effort="high")
    clamp = lambda v, lo, hi: max(lo, min(hi, float(v)))
    data["elements"] = [e for e in data["elements"] if e.get("type") in DIRECT_TYPES and e["at_seconds"] < duration]
    data["elements"] = [{**e, "at_seconds": clamp(e["at_seconds"], 0, max(0, duration - 0.2)), "seconds": clamp(e["seconds"], 0.15, duration)} for e in data["elements"]]
    data["freezes"] = [{"at_seconds": clamp(f["at_seconds"], 0, duration), "seconds": clamp(f["seconds"], 0.3, 4)} for f in data["freezes"]]
    data["speeds"] = [{"from_seconds": clamp(x["from_seconds"], 0, duration), "to_seconds": clamp(x["to_seconds"], 0, duration), "rate": clamp(x["rate"], 0.4, 4)}
                      for x in data["speeds"] if x["to_seconds"] - x["from_seconds"] > 0.2]
    data["hashtags"] = [h if h.startswith("#") else "#" + h for h in data["hashtags"]][:8]
    return {"engine": "ai", **limit_direct(data, limits, has_title)}


def _style_element(e: dict, limits: dict) -> dict:
    """How the style animates an element: labels typing on or arriving word by word, how fast things leave, typing
    clicks, the spotlight's dimming, the length of flashes and the size of emoji."""
    e = dict(e)
    if e["type"] in ("label", "nametag"):
        if limits.get("label_weight"):
            e["weight"] = limits["label_weight"]
        if limits.get("label_animation"):
            e["animation"] = limits["label_animation"]
        if limits.get("type_clicks") and e.get("animation") == "type":
            e["type_clicks"] = True
    if e["type"] in ("label", "nametag", "circle", "arrow", "emoji") and limits.get("exit"):
        e["exit"] = limits["exit"]
        if limits.get("exit_blur"):
            e["exit_blur"] = True
    if e["type"] == "spotlight" and limits.get("spotlight"):
        e.update({k: v for k, v in limits["spotlight"].items() if k in ("dim", "ramp")})
    if e["type"] == "flash" and limits.get("flash_seconds"):
        e["seconds"] = limits["flash_seconds"]
    if e["type"] == "emoji" and limits.get("emoji_scale"):
        e["scale"] = limits["emoji_scale"]
    return e


def limit_direct(data: dict, limits: dict | None, has_title: bool) -> dict:
    """Keep a story plan inside its style's limits. A style without a timed opening title gets the title as its
    first label instead (unless the style shows a title all video, which takes the title itself)."""
    if not limits:
        return data
    data = dict(data)
    allowed = set(limits.get("graphics") or [])
    look = limits.get("label_look", "")
    els = [dict(e, label_look=e.get("label_look") or look) if e["type"] == "label" else e for e in data["elements"] if e["type"] in allowed]
    if not limits.get("hook", True) and not has_title and data.get("title", "").strip():
        if "label" in allowed and not any(e["type"] == "label" and e["at_seconds"] < 0.3 for e in els):
            els.insert(0, {"type": "label", "at_seconds": 0.0, "seconds": 2.5, "text": data["title"].strip(), "colour": "", "label_look": look,
                           "position": "upper", "on_subject": False, "animation": "type"})
        data["title"] = ""
    els = [_style_element(e, limits) for e in els]
    camera = set(limits.get("camera_on") or [])
    if camera:
        from .sfx import camera_name
        name = camera_name()
        els = [dict(e, sfx=name) if e["type"] in camera else e for e in els]
    data["elements"] = els
    if not limits.get("freezes", True):
        data["freezes"] = []
    if not limits.get("speeds", True):
        data["speeds"] = []
    elif limits.get("min_rate"):
        data["speeds"] = [dict(x, rate=max(x["rate"], limits["min_rate"])) for x in data["speeds"]]
    return data
