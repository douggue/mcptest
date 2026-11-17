"""Splitting one clip in two and merging several clips of the same video into one.

Both work on clip specs (source times), so nothing is re-rendered or re-cut: a split clip keeps every edit on its
side of the split, and a merged clip keeps each part's edits, with the gaps between the parts kept out by
`ranges` (see deriveSegments in web/src/studio/logic.ts).
"""
from __future__ import annotations

import copy

from ..media import MediaError
from .capcut import kept_segments


def _standing(spec: dict, g: dict) -> bool:
    """A graphic placed by a style that stays up for (nearly) the whole clip, such as a title."""
    return g.get("origin") == "style" and g.get("duration", 0) >= (spec["out"] - spec["in"]) * 0.6


def _cut(ranges: list[dict], a: float, b: float) -> list[dict]:
    out = []
    for r in ranges:
        s, e = max(r["start"], a), min(r["end"], b)
        if e - s > 0.05:
            out.append({"start": round(s, 3), "end": round(e, 3)})
    return out


def _half(spec: dict, a: float, b: float, first: bool) -> dict:
    s = copy.deepcopy(spec)
    s["in"], s["out"] = round(a, 3), round(b, 3)
    s["segments"] = _cut(kept_segments(spec), a, b) or [{"start": s["in"], "end": s["out"]}]
    if spec.get("ranges"):
        s["ranges"] = _cut(spec["ranges"], a, b) or None
    s["words"] = [w for w in spec["words"] if a - 0.05 <= (w["start"] + w["end"]) / 2 < b + 0.05]
    s["freezes"] = [f for f in spec.get("freezes") or [] if a <= f["at"] < b or (not first and f["at"] == b)]
    s["speeds"] = [dict(x, start=max(x["start"], a), end=min(x["end"], b)) for x in spec.get("speeds") or [] if x["end"] > a and x["start"] < b]
    s["zooms"] = [z for z in spec.get("zooms") or [] if a <= z["at"] < b]
    shots = spec.get("shots") or [{"start": spec["in"], "layout": "single", "x": [50], "transition": "cut"}]
    current = max((x for x in shots if x["start"] <= a + 1e-6), key=lambda x: x["start"], default=shots[0])
    s["shots"] = [dict(current, start=round(a, 3), transition="cut")] + [x for x in shots if a + 1e-6 < x["start"] < b]
    graphics = []
    for g in spec.get("graphics") or []:
        if _standing(spec, g):
            graphics.append(dict(g, at=round(a, 3)))
        elif a <= g["at"] < b:
            graphics.append(g)
    s["graphics"] = graphics
    if not first:   # the opening title belongs to the start of the original clip
        s["hook"] = dict(s.get("hook") or {}, visible=False)
    return s


def split(spec: dict, t: float) -> tuple[dict, dict]:
    """Two specs, before and after source time t."""
    if not spec["in"] + 0.5 <= t <= spec["out"] - 0.5:
        raise MediaError("Split at least half a second inside the clip.")
    return _half(spec, spec["in"], t, True), _half(spec, t, spec["out"], False)


def merge(specs: list[dict]) -> dict:
    """One spec playing the kept parts of every clip, in source order. Settings (captions, look, brand, frame,
    title) come from the earliest clip."""
    if len(specs) < 2:
        raise MediaError("Choose at least two clips to merge.")
    specs = copy.deepcopy(specs)   # never change the clips being merged
    if len({s["src"] for s in specs}) > 1:
        raise MediaError("Only clips from the same video can be merged.")
    specs = sorted(specs, key=lambda s: s["in"])
    base = copy.deepcopy(specs[0])
    parts: list[dict] = []
    for s in specs:
        parts += kept_segments(s)
    parts.sort(key=lambda r: r["start"])
    ranges: list[dict] = []
    for r in parts:   # join overlapping or touching parts
        if ranges and r["start"] <= ranges[-1]["end"] + 0.05:
            ranges[-1]["end"] = max(ranges[-1]["end"], r["end"])
        else:
            ranges.append(dict(r))
    ranges = [{"start": round(r["start"], 3), "end": round(r["end"], 3)} for r in ranges]
    words: dict = {}
    for s in specs:
        for w in s["words"]:
            if w["id"] not in words or not w.get("removed"):   # a word kept in any clip stays kept
                words[w["id"]] = w
    shots = []
    for s in specs:
        own = s.get("shots") or [{"start": s["in"], "layout": "single", "x": [50], "transition": "cut"}]
        shots += [dict(x, start=max(x["start"], s["in"])) for x in own if x["start"] < s["out"]]
    shots.sort(key=lambda x: x["start"])
    deduped = []
    for x in shots:
        if deduped and abs(x["start"] - deduped[-1]["start"]) < 0.05:
            deduped[-1] = x
        elif deduped and x.get("layout") == deduped[-1].get("layout") and x.get("x") == deduped[-1].get("x") and not x.get("track") \
                and x.get("transition", "cut") == "cut":
            continue   # the same framing carried on, e.g. where a clip was split
        else:
            deduped.append(x)
    standing = [g for g in base.get("graphics") or [] if _standing(base, g)]
    graphics = list(standing)
    for s in specs:
        graphics += [g for g in s.get("graphics") or [] if not _standing(s, g)]

    def unique(items: list[dict], key) -> list[dict]:
        """Overlapping clips carry the same freeze, zoom or graphic twice; keep one of each."""
        seen, out = set(), []
        for it in items:
            k = it.get("id") or key(it)
            if k not in seen:
                seen.add(k)
                out.append(it)
        return out
    base.update(
        **{"in": ranges[0]["start"], "out": ranges[-1]["end"]},
        ranges=ranges, segments=[dict(r) for r in ranges],
        words=sorted(words.values(), key=lambda w: w["start"]),
        shots=deduped,
        freezes=unique(sorted((f for s in specs for f in s.get("freezes") or []), key=lambda f: f["at"]), lambda f: round(f["at"], 2)),
        speeds=_no_overlap(unique(sorted((x for s in specs for x in s.get("speeds") or []), key=lambda x: x["start"]), lambda x: (x["start"], x["end"]))),
        zooms=unique(sorted((z for s in specs for z in s.get("zooms") or []), key=lambda z: z["at"]), lambda z: round(z["at"], 2)),
        graphics=unique(sorted(graphics, key=lambda g: g["at"]), lambda g: (g["type"], round(g["at"], 2), g.get("primary", ""))),
    )
    total = sum(r["end"] - r["start"] for r in ranges) + sum(f["duration"] for f in base["freezes"])
    for g in standing:   # only graphics that stood for the whole first clip stand for the whole merge
        g["duration"] = max(g.get("duration", 0), round(total, 2))
    return base


def _no_overlap(speeds: list[dict]) -> list[dict]:
    """Speed ranges from overlapping clips can overlap each other; the earlier one wins."""
    out: list[dict] = []
    for x in speeds:
        if out and x["start"] < out[-1]["end"]:
            if x["end"] <= out[-1]["end"]:
                continue
            x = dict(x, start=out[-1]["end"])
        out.append(x)
    return out
