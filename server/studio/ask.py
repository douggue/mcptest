"""Edit by asking: turn a plain-language request ("make the title red, cut the first sentence") into a list of typed
changes to a clip. The model only chooses changes from a fixed menu and the editor applies them itself
(web/src/studio/ask.ts), so a bad answer can at worst make an edit the person undoes with Ctrl+Z.

Times in the request and the answer are seconds from the clip's start in the SOURCE video (the times words are
listed at), which stay the same whatever has been cut.
"""
from __future__ import annotations

from . import ai
from .capcut import build_plan, total_frames

CAPTION_LOOKS = ["boldpop", "karaoke", "tape", "clean", "neon", "typeon", "shadow", "box", "glow"]
FONTS = ["Anton", "Archivo Black", "Bebas Neue", "Montserrat", "Poppins", "Cinzel", "Inter", "JetBrains Mono"]
LOOKS = ["none", "punchy", "warm", "cool", "cinematic", "vintage"]
ASPECTS = ["9:16", "4:5", "3:4", "1:1", "16:9"]
TRANSITIONS = ["cut", "smooth", "fade", "slide", "push", "zoom", "whip", "spin", "blur", "flash", "dip", "glitch"]
GRAPHICS = ["label", "nametag", "circle", "arrow", "spotlight", "flash", "dip", "heart", "emoji", "keyword", "counter",
            "lowerthird", "blurbox"]
LABEL_LOOKS = ["", "neon", "quoted", "plain", "box", "outline", "flat"]
YES_NO = ["", "yes", "no"]


def _op(name: str, props: dict, desc: str) -> dict:
    return {"type": "object", "additionalProperties": False, "description": desc,
            "required": ["op", *props], "properties": {"op": {"type": "string", "enum": [name]}, **props}}


S = {"type": "string"}
N = {"type": "number"}
B = {"type": "boolean"}


def _enum(values: list[str]) -> dict:
    return {"type": "string", "enum": values}


OPS = [
    _op("title", {"text": S, "visible": B}, "Set the on-screen title. text: '' keeps it; words in {curly brackets} take a colour: {WORD|#ff0000}."),
    _op("captions", {"visible": B, "look": _enum([""] + CAPTION_LOOKS), "font": _enum([""] + FONTS), "size": N, "colour": S, "highlight": S,
                     "position": N, "words_per_line": N, "uppercase": _enum(YES_NO), "punctuation": _enum(["", "keep", "drop"])},
        "Caption settings. '' or 0 leaves a setting unchanged. size: px on a 1080-wide frame (40-110). position: % down the frame (10-90). colours #rrggbb."),
    _op("look", {"preset": _enum([""] + LOOKS), "brightness": N, "contrast": N, "saturation": N, "black_and_white": _enum(YES_NO),
                 "vignette": _enum(YES_NO), "grain": N, "bars": N, "push_in": N, "fade_in": N, "fade_out": N, "mirror": _enum(YES_NO)},
        "Picture look. '' leaves a choice unchanged and -1 leaves a number unchanged. brightness/contrast/saturation: 1 = normal (0.7-1.4, saturation 0-1.8). "
        "grain 0-1, bars 0-18 (% of height each), push_in 0-0.25, fade_in/fade_out seconds 0-2."),
    _op("shape", {"aspect": _enum([""] + ASPECTS), "fps": N}, "Canvas shape and frame rate (30 or 60; 0 unchanged)."),
    _op("trim", {"start_seconds": N, "end_seconds": N}, "Move the clip's start and/or end, in seconds from the current start (-1 leaves it)."),
    _op("cut_words", {"from_word": N, "to_word": N}, "Cut the words with these ids and everything between them."),
    _op("restore_words", {"from_word": N, "to_word": N}, "Put back cut words in this id range (from_word -1 = all)."),
    _op("tighten", {"remove_fillers": B, "pause_seconds": N}, "Remove filler words and/or pauses longer than pause_seconds (0 leaves pauses, -1 keeps all pauses)."),
    _op("add_freeze", {"at_seconds": N, "seconds": N}, "Freeze the picture at a moment for some seconds."),
    _op("remove_freeze", {"at_seconds": N}, "Remove the freeze nearest this moment (-1 = all freezes)."),
    _op("speed", {"from_seconds": N, "to_seconds": N, "rate": N}, "Play a range faster (2-8) or slower (0.25-0.75); rate 1 removes speed changes in the range."),
    _op("zoom", {"at_seconds": N, "seconds": N, "scale": N}, "Punch in (scale 1.1-1.6) for some seconds; scale 1 removes zooms starting in that second."),
    _op("add_graphic", {"type": _enum(GRAPHICS), "at_seconds": N, "seconds": N, "text": S, "colour": S,
                        "position": _enum(["top", "upper", "middle", "lower", "bottom"]), "label_look": _enum(LABEL_LOOKS)},
        "Add a graphic. text '' for ones without text; colour #rrggbb or ''."),
    _op("edit_graphic", {"id": S, "text": S, "colour": S, "at_seconds": N, "seconds": N, "remove": B},
        "Change or remove an existing graphic by its id. '' / -1 / 0 leave a field unchanged."),
    _op("transition", {"shot": N, "type": _enum(TRANSITIONS), "seconds": N}, "How shot number N (1-based; -1 = every shot after the first) arrives. seconds 0 = default."),
    _op("frame", {"mode": _enum(["", "full", "panel"]), "corners": _enum(["", "square", "rounded", "squircle"]), "corner_size": N, "background": _enum(["", "blur", "black"])},
        "Picture fills the frame or sits in a box. corner_size % of the box width (0-50, -1 unchanged)."),
    _op("audio", {"voice": N, "music": N, "effects": N}, "Volumes 0-1 (-1 leaves one unchanged)."),
]

SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["changes", "reply"],
    "properties": {
        "changes": {"type": "array", "items": {"anyOf": OPS}},
        "reply": {"type": "string", "description": "One or two plain sentences: what you changed, and anything asked for that you could not do."},
    },
}

SYSTEM = """\
You are the assistant inside a short-video editor. The person describes a change to the clip they are editing; you \
answer with changes from the menu in the schema, nothing else. Make exactly what was asked, no extra "improvements". \
Use the ids and times from the description of the clip. Times are seconds from the clip's start in the source video. \
When something cannot be done with the menu, leave it out and say so in the reply. When the request is unclear, make \
the most likely change and say what you assumed. Keep the reply short and plain."""


def _r(x: float) -> float:
    return round(float(x), 2)


def describe(spec: dict) -> str:
    """The clip as the model sees it: settings, timeline and the words with ids."""
    t0 = spec["in"]
    rel = lambda t: _r(t - t0)   # noqa: E731
    plan = build_plan(spec)
    lines = [f"Canvas {spec['width']}x{spec['height']} at {spec['fps']} fps. Source range {rel(spec['in'])}-{rel(spec['out'])} s; "
             f"the finished clip runs {total_frames(plan) / spec['fps']:.1f} s."]
    title = next((g for g in spec.get("graphics") or [] if g.get("origin") == "style" and g["type"] == "label"
                  and g.get("duration", 0) > (spec["out"] - spec["in"]) * 0.6), None)
    hook = spec.get("hook") or {}
    if title:
        lines.append(f"Title (stays up all video): {title['primary']!r}")
    else:
        lines.append(f"Opening title: {hook.get('text', '')!r}, {'shown' if hook.get('visible') else 'hidden'} for {hook.get('duration', 3)} s")
    c = spec.get("captions") or {}
    lines.append(f"Captions: {'on' if c.get('visible', True) else 'off'}, look {c.get('preset')}, font {c.get('font')}, size {c.get('size')}, "
                 f"colour {c.get('color')}, highlight {c.get('highlight')}, {c.get('position')}% down, {c.get('maxWords')} words per line, "
                 f"uppercase {bool(c.get('uppercase'))}, punctuation {'dropped' if c.get('noPunct') else 'kept'}")
    lk = spec.get("look") or {}
    look = ", ".join(f"{k} {v}" for k, v in lk.items() if v not in (None, False, 0, "none"))
    lines.append(f"Look: {look or 'as filmed'}")
    fm = spec.get("frame") or {"mode": "full"}
    lines.append(f"Picture: {'in a ' + fm.get('shape', 'rounded') + ' box' if fm.get('mode') == 'panel' else 'fills the frame'}")
    a = spec.get("audio") or {}
    lines.append(f"Audio: voice {a.get('voice', 1)}, effects {a.get('fx', 1)}, music {'volume ' + str((a.get('music') or {}).get('volume')) if a.get('music') else 'none'}")
    shots = spec.get("shots") or []
    if len(shots) > 1:
        lines.append("Shots: " + "; ".join(f"#{i + 1} at {rel(s['start'])} s ({s['layout']}, arrives by {s.get('transition', 'cut')})" for i, s in enumerate(shots)))
    for name, items, fmt in (("Freezes", spec.get("freezes"), lambda f: f"at {rel(f['at'])} s for {f['duration']} s"),
                             ("Speed changes", spec.get("speeds"), lambda x: f"{rel(x['start'])}-{rel(x['end'])} s at x{x['rate']}"),
                             ("Zooms", spec.get("zooms"), lambda z: f"at {rel(z['at'])} s for {z['duration']} s, x{z['scale']}")):
        if items:
            lines.append(f"{name}: " + "; ".join(fmt(i) for i in items))
    gs = [g for g in spec.get("graphics") or [] if g is not title]
    if gs:
        lines.append("Graphics:")
        lines += [f"  id {g['id']}: {g['type']} at {rel(g['at'])} s for {g['duration']} s"
                  + (f", text {g['primary']!r}" if g.get("primary") else "") + (f", colour {g['color']}" if g.get("color") else "") for g in gs]
    words = [w for w in spec.get("words") or [] if w["end"] > spec["in"] and w["start"] < spec["out"]]
    lines.append("Words (id: text start-end; [cut] = cut out):")
    lines += [f"  {w['id']}: {w['text']} {rel(w['start'])}-{rel(w['end'])}{' [cut]' if w.get('removed') else ''}" for w in words[:900]]
    return "\n".join(lines)


def plan(spec: dict, request: str) -> dict:
    """{changes, reply, engine}. Needs an AI key: there is no rule-based way to read a free-text request."""
    if not ai.available():
        raise ai.AIUnavailable("Editing by asking needs the AI. " + ai.setup_hint())
    out = ai.ask_json(SYSTEM, f"The clip:\n{describe(spec)}\n\nThe request: {request.strip()}", SCHEMA, max_tokens=8000, effort="medium")
    changes = [c for c in out.get("changes") or [] if isinstance(c, dict) and c.get("op") in {o["properties"]["op"]["enum"][0] for o in OPS}]
    return {"changes": changes, "reply": str(out.get("reply") or "").strip(), "engine": ai.provider()}
