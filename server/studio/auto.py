"""One-shot automatic edit of a clip, for the command line (the editor does the same steps interactively)."""
from __future__ import annotations

import uuid

from ..jobs import Job
from . import moments, sources, vision

FILLERS = {"um", "uh", "uhh", "umm", "er", "erm", "ah", "hmm", "mm"}


def face_to_x(cx: float, spec: dict, panes: int = 1) -> float:
    """Crop position (0..100) that centres a face at cx (0..1 of the source) in one pane."""
    landscape = spec["width"] > spec["height"]
    pane_aspect = spec["width"] / panes / spec["height"] if landscape else spec["width"] / (spec["height"] / panes)
    visible = pane_aspect / (spec["srcW"] / spec["srcH"])
    if visible >= 1:
        return 50.0
    return round(max(0.0, min(1.0, (cx - visible / 2) / (1 - visible))) * 100, 1)


def derive_segments(spec: dict, silence: float = 0.0) -> list[dict]:
    """Kept source ranges after dropping removed words and pauses longer than `silence` (0 keeps pauses)."""
    tin, tout = spec["in"], spec["out"]
    words = [w for w in spec["words"] if w["end"] > tin and w["start"] < tout]
    cuts: list[tuple[float, float]] = []
    i = 0
    while i < len(words):
        if not words[i].get("removed"):
            i += 1
            continue
        j = i
        while j + 1 < len(words) and words[j + 1].get("removed"):
            j += 1
        start = min(words[i - 1]["end"] + 0.04, words[i]["start"]) if i > 0 else tin
        end = max(words[j + 1]["start"] - 0.04, words[j]["end"]) if j + 1 < len(words) else tout
        if end - start > 0.06:
            cuts.append((start, end))
        i = j + 1
    live = [w for w in words if not w.get("removed")]
    if silence > 0 and live:
        keep = min(silence, 0.24) / 2
        for a, b in zip(live, live[1:]):
            if b["start"] - a["end"] > silence:
                cuts.append((a["end"] + keep, b["start"] - keep))
        if live[0]["start"] - tin > silence:
            cuts.append((tin, live[0]["start"] - 0.15))
        if tout - live[-1]["end"] > silence + 0.2:
            cuts.append((live[-1]["end"] + 0.3, tout))
    segs, cursor = [], tin
    for s, e in sorted(cuts):
        s, e = max(tin, min(tout, s)), max(tin, min(tout, e))
        if e <= cursor:
            continue
        if s - cursor > 0.08:
            segs.append({"start": round(cursor, 3), "end": round(s, 3)})
        cursor = max(cursor, e)
    if tout - cursor > 0.08:
        segs.append({"start": round(cursor, 3), "end": round(tout, 3)})
    return segs or [{"start": tin, "end": tout}]


def auto_edit(project: dict, clip: dict, job: Job, center: bool = True, tighten: bool = True, graphics: bool = True) -> dict:
    """Centre the speaker per shot, tighten pauses and fillers, and add the remix plan. Mutates and returns the clip."""
    spec = clip["spec"]
    src = sources.source_path(project)
    if center:
        cuts = vision.detect_cuts(src, spec["in"], spec["out"])
        bounds = [spec["in"], *cuts, spec["out"]]
        ranges = list(zip(bounds, bounds[1:]))
        found = vision.analyse_shots(src, ranges, job)
        spec["shots"] = [
            {"start": round(a, 3), "layout": "single", "transition": "cut", "faces": s["faces"],
             "x": [face_to_x(s["faces"][0]["cx"], spec) if s["faces"] else 50.0]}
            for (a, _), s in zip(ranges, found["shots"])
        ]
    if tighten:
        for w in spec["words"]:
            if "".join(ch for ch in w["text"].lower() if ch.isalnum()) in FILLERS:
                w["removed"] = True
        spec["edit"] = {"silence": 0.5}
    spec["segments"] = derive_segments(spec, 0.5 if tighten else 0.0)
    if graphics and spec["words"]:
        plan = moments.remix(spec["words"], 1.0, clip["title"])
        at = {w["id"]: w["start"] for w in spec["words"]}
        emph = set(plan["emphasis_word_ids"])
        emoji = {e["word_id"]: e["emoji"] for e in plan["emojis"]}
        for w in spec["words"]:
            w["emphasis"] = w["id"] in emph
            if w["id"] in emoji:
                w["emoji"] = emoji[w["id"]]
        spec["zooms"] = [{"id": uuid.uuid4().hex[:8], "at": round(max(spec["in"], at[z["word_id"]] - 0.1), 3),
                          "duration": max(0.6, min(3.0, z["seconds"])), "scale": 1.14} for z in plan["zooms"] if z["word_id"] in at]
        spec["graphics"] = [{"id": uuid.uuid4().hex[:8], "type": g["type"], "zone": g["zone"], "at": round(at[g["word_id"]], 3),
                             "duration": max(1.0, min(6.0, g["seconds"])), "animation": g["animation"], "sfx": g["sfx"],
                             "primary": g["primary"], "headline": g["headline"], "keywords": g["keywords"]}
                            for g in plan["graphics"] if g["word_id"] in at]
        if plan.get("hook") and not spec["hook"]["text"]:
            spec["hook"].update(text=plan["hook"], visible=True)
    return clip
