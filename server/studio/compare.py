"""Understanding an edit: a raw video and the short an editor made from it, compared.

Measured, not guessed:
  - timing: the two soundtracks are lined up piece by piece, which gives what was kept, trimmed or cut;
  - framing: a patch from the middle of each edited frame is found in the raw frame at every scale, which gives
    where the crop sits (its centre, 0..1 of the raw width) and how tight it is compared with the edit's usual
    framing (1 = usual, 1.2 = a 20% punch-in), so pans and punch-ins show up shot by shot.
Then an AI is shown each shot side by side (the raw frame with the crop drawn on it, and the edited frame) with
those numbers, and explains what the editor did and why, as rules that would apply to other videos.
"""
from __future__ import annotations

import io
from pathlib import Path

import numpy as np

from ..jobs import Job
from ..media import MediaError, ffmpeg, probe
from . import ai, vision

SR = 8000           # audio rate for lining up
WIN, STEP = 1.0, 0.5
SAMPLE = 0.33       # seconds between framing measurements


def _pcm(path: Path, work: Path) -> np.ndarray:
    out = work / (path.stem + ".pcm")
    ffmpeg(["-i", str(path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", str(out)])
    data = np.frombuffer(out.read_bytes(), np.int16).astype(np.float32)
    out.unlink(missing_ok=True)
    return data


def align(raw: Path, edit: Path, work: Path) -> list[dict]:
    """Pieces of the edit and where each comes from in the raw: [{edit_start, edit_end, raw_start}]."""
    r, e = _pcm(raw, work), _pcm(edit, work)
    if not len(r) or not len(e):
        return []
    n = 1 << int(np.ceil(np.log2(len(r) + int(WIN * SR))))
    fr = np.fft.rfft(r, n)
    marks = []
    t = 0.0
    while t + WIN <= len(e) / SR:
        seg = e[int(t * SR):int((t + WIN) * SR)]
        if np.abs(seg).mean() > 40:   # skip silence: it matches anywhere
            c = np.fft.irfft(fr * np.conj(np.fft.rfft(seg, n)), n)[:len(r)]
            k = int(np.argmax(c))
            score = c[k] / (np.linalg.norm(seg) * np.linalg.norm(r[k:k + len(seg)]) + 1e-9)
            if score > 0.6:
                marks.append((t, k / SR - t))
        t += STEP
    pieces: list[dict] = []
    for t, off in marks:
        if pieces and abs(pieces[-1]["offset"] - off) < 0.04:
            pieces[-1]["edit_end"] = t + WIN
        else:
            pieces.append({"edit_start": t, "edit_end": t + WIN, "offset": off})
    for p in pieces:
        p["raw_start"] = round(p["edit_start"] + p["offset"], 3)
        p["edit_start"], p["edit_end"], p["offset"] = round(p["edit_start"], 3), round(p["edit_end"], 3), round(p["offset"], 3)
    return pieces


def raw_time(pieces: list[dict], t: float) -> float | None:
    """Where edit time t comes from in the raw (nearest piece's offset)."""
    if not pieces:
        return None
    best = min(pieces, key=lambda p: 0 if p["edit_start"] <= t <= p["edit_end"] else min(abs(t - p["edit_start"]), abs(t - p["edit_end"])))
    return t + best["offset"]


def _grab(cap, t: float):
    import cv2
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000)
    ok, f = cap.read()
    return f if ok else None


def framing(raw: Path, edit: Path, pieces: list[dict], job: Job | None = None) -> list[dict]:
    """[{t, raw_t, cx, cy, scale, score}] every SAMPLE seconds of the edit. scale = raw pixels per edit pixel."""
    import cv2
    E, R = cv2.VideoCapture(str(edit)), cv2.VideoCapture(str(raw))
    try:
        dur = probe(edit)["duration"]
        out = []
        t = 0.15
        while t < dur - 0.1:
            if job is not None and len(out) % 12 == 0:
                job.update(0.15 + 0.45 * t / dur, "Measuring the framing")
            rt = raw_time(pieces, t)
            ef, rf = _grab(E, t), (_grab(R, rt) if rt is not None else None)
            t += SAMPLE
            if ef is None or rf is None:
                continue
            eh = 960
            ef = cv2.resize(ef, (int(ef.shape[1] * eh / ef.shape[0]), eh))
            rf = cv2.resize(rf, (640, int(rf.shape[0] * 640 / rf.shape[1])))
            eg, rg = cv2.cvtColor(ef, cv2.COLOR_BGR2GRAY), cv2.cvtColor(rf, cv2.COLOR_BGR2GRAY)
            pw, ph = int(eg.shape[1] * 0.4), int(eh * 0.2)
            best = (-1.0,)
            for yc in (0.4, 0.5, 0.6):   # the picture may sit higher or lower in the edit (a box under a title)
                y0 = int(eh * yc - ph / 2)
                x0 = int(eg.shape[1] / 2 - pw / 2)
                patch = eg[y0:y0 + ph, x0:x0 + pw]
                if patch.std() < 8:
                    continue   # a flat patch (black background) cannot be found
                for s in np.geomspace(0.2, 1.8, 30):
                    tw, th = int(pw * s), int(ph * s)
                    if tw < 16 or th < 8 or tw >= rg.shape[1] or th >= rg.shape[0]:
                        continue
                    m = cv2.matchTemplate(rg, cv2.resize(patch, (tw, th), interpolation=cv2.INTER_AREA), cv2.TM_CCOEFF_NORMED)
                    _, v, _, loc = cv2.minMaxLoc(m)
                    if v > best[0]:
                        best = (v, s, loc, tw, th)
            if best[0] < 0.5:
                continue
            v, s, (lx, ly), tw, th = best
            out.append({"t": round(t - SAMPLE, 2), "raw_t": round(rt, 2), "cx": round((lx + tw / 2) / rg.shape[1], 3),
                        "cy": round((ly + th / 2) / rg.shape[0], 3), "scale": round(float(s), 3), "score": round(float(v), 2)})
        return out
    finally:
        E.release()
        R.release()


def edit_cuts(raw: Path, edit: Path, pieces: list[dict]) -> list[float]:
    """Cuts in the edit's timeline. A short's titles, header and background stay put, so cuts inside its picture
    box hardly register; the raw video's own cuts are found instead and moved into the edit's time, plus the
    places where the edit itself jumps in the raw."""
    dur = probe(edit)["duration"]
    raw_cuts = vision.detect_cuts(raw, 0.0, probe(raw)["duration"])
    out = []
    for c in raw_cuts:
        for p in pieces:
            t = c - p["offset"]
            if p["edit_start"] - 0.3 <= t <= p["edit_end"] + 0.3 and 0.3 < t < dur - 0.3:
                out.append(round(t, 2))
                break
    out += [p["edit_start"] for p in pieces[1:] if 0.3 < p["edit_start"] < dur - 0.3]
    merged: list[float] = []
    for t in sorted(out):
        if not merged or t - merged[-1] > 0.4:
            merged.append(t)
    return merged


def shots(edit: Path, frames: list[dict], cuts: list[float]) -> list[dict]:
    """The edit's shots with their framing: centre, zoom against the edit's usual framing, and any pan."""
    dur = probe(edit)["duration"]
    bounds = [0.0] + cuts + [dur]
    usual = float(np.median([f["scale"] for f in frames])) if frames else 1.0
    out = []
    for a, b in zip(bounds, bounds[1:]):
        inside = [f for f in frames if a + 0.05 <= f["t"] <= b - 0.05]
        row = {"start": round(a, 2), "end": round(b, 2)}
        if inside:
            row.update(cx=round(float(np.median([f["cx"] for f in inside])), 3),
                       zoom=round(usual / float(np.median([f["scale"] for f in inside])), 2),
                       pan=round(inside[-1]["cx"] - inside[0]["cx"], 3), raw_t=inside[len(inside) // 2]["raw_t"],
                       t=inside[len(inside) // 2]["t"])
        out.append(row)
    return out


def _side_by_side(raw: Path, edit: Path, shot: dict, usual: float) -> bytes:
    """The raw frame with the crop drawn in green, next to the edited frame."""
    import cv2
    R, E = cv2.VideoCapture(str(raw)), cv2.VideoCapture(str(edit))
    try:
        rf, ef = _grab(R, shot["raw_t"]), _grab(E, shot["t"])
    finally:
        R.release()
        E.release()
    if rf is None or ef is None:
        return b""
    rf = cv2.resize(rf, (640, int(rf.shape[0] * 640 / rf.shape[1])))
    h = rf.shape[0]
    ef = cv2.resize(ef, (int(ef.shape[1] * h / ef.shape[0]), h))
    # the crop: as tall as the raw frame at the usual framing, narrower when punched in
    ch = h / shot.get("zoom", 1)
    cw = min(640, ch * 0.75)
    x0 = int(shot["cx"] * 640 - cw / 2)
    y0 = int(h / 2 - ch / 2)
    cv2.rectangle(rf, (x0, max(0, y0)), (int(x0 + cw), int(min(h - 1, y0 + ch))), (0, 220, 0), 3)
    both = np.concatenate([rf, np.zeros((h, 12, 3), np.uint8), ef], axis=1)
    ok, buf = cv2.imencode(".jpg", both, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return buf.tobytes() if ok else b""


EXPLAIN_SYSTEM = """\
You are studying how an editor turned a raw video into a short, to learn their style. You get the measurements \
(what was kept and trimmed, and for every shot of the short where the crop sits in the raw frame, how tight it is \
and whether it pans) and, for each shot, a picture: on the left the raw frame with the editor's crop drawn in green, \
on the right the finished short at that moment. Explain each real decision (framing, punch-ins, pans, trims, text, \
captions, pacing): what was done, and why, in terms of what is in the picture (who is reacting, what the product is, \
where the action moves). Then write the general rules this editor follows, worded so they apply to other videos of \
this kind, not to this one's content. Do not repeat channel names, watermarks or logos."""

EXPLAIN_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["summary", "decisions", "rules"],
    "properties": {
        "summary": {"type": "string", "description": "Two or three sentences on how this editor works."},
        "decisions": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["at_seconds", "kind", "what", "why"],
            "properties": {"at_seconds": {"type": "number"},
                           "kind": {"type": "string", "enum": ["framing", "zoom", "pan", "trim", "cut", "text", "captions", "pacing", "sound", "other"]},
                           "what": {"type": "string"}, "why": {"type": "string"}}}},
        "rules": {"type": "array", "items": {"type": "string"}, "description": "General rules, one instruction each."},
    },
}


def measure(raw: Path, edit: Path, work: Path, job: Job | None = None) -> dict:
    if job is not None:
        job.update(0.03, "Lining up the two by their sound")
    pieces = align(raw, edit, work)
    if not pieces:
        raise MediaError("The two videos could not be lined up by their sound. Are they the same footage, with the original sound kept?")
    frames = framing(raw, edit, pieces, job)
    rd, ed = probe(raw)["duration"], probe(edit)["duration"]
    kept = sum(p["edit_end"] - p["edit_start"] for p in pieces)
    trims = []
    if pieces[0]["raw_start"] > 0.05:
        trims.append({"raw_from": 0.0, "raw_to": pieces[0]["raw_start"], "where": "start"})
    for a, b in zip(pieces, pieces[1:]):
        gap = b["offset"] - a["offset"]
        if gap > 0.05:
            trims.append({"raw_from": round(a["edit_end"] + a["offset"], 2), "raw_to": round(a["edit_end"] + b["offset"], 2), "where": "middle"})
    end_raw = pieces[-1]["edit_end"] + pieces[-1]["offset"]
    if rd - end_raw > 0.3:
        trims.append({"raw_from": round(end_raw, 2), "raw_to": round(rd, 2), "where": "end"})
    return {"raw_seconds": round(rd, 2), "edit_seconds": round(ed, 2), "pieces": pieces, "kept_seconds": round(kept, 2),
            "trims": trims, "shots": shots(edit, frames, edit_cuts(raw, edit, pieces)), "frames": frames}


def explain(raw: Path, edit: Path, measured: dict, use: str = "", job: Job | None = None) -> dict:
    """Have an AI explain the edit from the measurements and side-by-side pictures."""
    usual = float(np.median([f["scale"] for f in measured["frames"]])) if measured["frames"] else 1.0
    lines = [f"The raw video runs {measured['raw_seconds']} s; the short runs {measured['edit_seconds']} s.",
             "Trims: " + ("; ".join(f"{t['where']}: raw {t['raw_from']}-{t['raw_to']} s" for t in measured["trims"]) or "none") + ".",
             "Shots of the short (crop centre as 0..1 of the raw width; zoom against the short's usual framing; pan = how far the crop moves):"]
    for s in measured["shots"]:
        if "cx" in s:
            lines.append(f"  {s['start']}-{s['end']} s: centre {s['cx']}, zoom x{s['zoom']}, pan {s['pan']:+}")
        else:
            lines.append(f"  {s['start']}-{s['end']} s: not measured (no picture match)")
    parts: list = ["\n".join(lines), "Each shot follows: left, the raw frame with the crop in green; right, the short."]
    shown = [s for s in measured["shots"] if "cx" in s][:18]
    for i, s in enumerate(shown):
        if job is not None:
            job.update(0.62 + 0.1 * i / max(1, len(shown)), "Preparing the pictures")
        jpeg = _side_by_side(raw, edit, s, usual)
        if jpeg:
            parts.append(f"Shot {s['start']}-{s['end']} s:")
            parts.append({"image": jpeg})
    if job is not None:
        job.update(0.75, f"Understanding the edit with {ai.label_for(use) if use else ai.provider_label('references')}")
    out = ai.ask_with(use, EXPLAIN_SYSTEM, parts, EXPLAIN_SCHEMA, max_tokens=16000, effort="high", task="references")
    out.pop("_watched", None)
    return out


MERGE_SYSTEM = """\
You turn what was learned from several edits by the same editor into the standing rules of their style. You get, \
for each before-and-after pair, a summary, the decisions with their reasons, and the rules drawn from that one \
edit. Keep what holds across the pairs, merge rules that say the same thing, and drop one-offs that only fit one \
video's content. Each rule is one plain instruction an editor or an AI could follow on a new video. 5 to 15 rules."""
MERGE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["rules", "summary"],
                "properties": {"rules": {"type": "array", "items": {"type": "string"}}, "summary": {"type": "string"}}}


def merge(pairs: list[dict], use: str = "") -> dict:
    blocks = []
    for i, p in enumerate(pairs, 1):
        blocks.append(f"Pair {i} ({p['name']}): {p['summary']}\nDecisions:\n" + "\n".join(f"- {d['kind']} at {d['at_seconds']} s: {d['what']} Because: {d['why']}" for d in p["decisions"])
                      + "\nRules from this pair:\n" + "\n".join(f"- {r}" for r in p["rules"]))
    return ai.ask_with(use, MERGE_SYSTEM, "\n\n".join(blocks), MERGE_SCHEMA, max_tokens=8000, effort="high", task="references")
