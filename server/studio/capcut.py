"""Export a clip as a CapCut project ("draft"), so the edit can be finished in CapCut with the cuts, framing,
captions, titles and audio all still editable on its timeline.

CapCut has no import format; a project is a folder holding `draft_content.json` plus the media. The file is written
with the open-source `pycapcut` library, which its author checks against CapCut for Windows. Nothing here could be
opened in CapCut while it was being written, so treat the result as "should open" rather than "known to open".

What goes on the timeline:
  Video        one clip per kept stretch of the source (cuts, speed changes), a still image for each freeze,
               scaled and positioned to match the framing; punch-ins and speaker tracking become keyframes
  Split 2/3    the lower panes of a two- or three-person layout
  B-roll       cutaway images and clips
  Logo         the brand logo
  Captions     one text clip per caption line
  Title        the opening hook
  Graphics n   text for labels, name tags, keyword pops, counters, lower thirds and step lists
  Watermark    the handle
  Voice, Music, Voiceover, Sound effects n

What cannot be carried over is returned as notes: CapCut has its own effects, and Cutroom's animated graphics,
word-by-word caption highlight and colour looks have no equivalent that can be written into a project file.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

from ..config import DATA, get_settings, media_path, media_url
from ..jobs import Job
from ..media import MediaError, ffmpeg, probe, safe_name, unique_path

# CapCut swaps this token for the project's own folder when it loads a draft, which keeps a zipped project portable.
PLACEHOLDER = "##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##"
FONT_PX_PER_UNIT = 5.5   # Cutroom sizes text in pixels on a 1080-wide frame; CapCut uses its own unit. Approximate.
TEXT_GRAPHICS = ("label", "nametag", "keyword", "cascade", "counter", "lowerthird", "steps", "emoji")
LOST_GRAPHICS = {"circle": "circles", "arrow": "arrows", "spotlight": "spotlights", "flash": "flashes", "dip": "dips to black",
                 "heart": "the heart animation", "gauge": "gauges"}
ZONE_Y = {"top": 22.0, "center": 50.0, "bottom": 72.0, "overlay": 50.0, "full": 50.0, "free": 50.0}


def _lib():
    try:
        import pycapcut
        return pycapcut
    except ImportError as e:
        raise MediaError("CapCut export needs the 'pycapcut' package: pip install pycapcut==0.0.4") from e


def available() -> bool:
    import importlib.util
    return importlib.util.find_spec("pycapcut") is not None


def detect_folder() -> str:
    """Where CapCut keeps its projects on this computer, if it is installed in the usual place."""
    home = Path.home()
    guesses = []
    if sys.platform == "win32":
        local = os.environ.get("LOCALAPPDATA") or str(home / "AppData" / "Local")
        guesses.append(Path(local) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft")
    elif sys.platform == "darwin":
        guesses.append(home / "Movies" / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft")
    return next((str(g) for g in guesses if g.is_dir()), "")


def state() -> dict:
    """What the interface needs to explain where an export will go."""
    from .. import auth
    saved = (get_settings().get("capcut_folder") or "").strip()
    detected = "" if auth.enabled() else detect_folder()
    folder = saved or detected
    direct = bool(folder) and not auth.enabled() and Path(folder).is_dir()
    return {"available": available(), "folder": folder, "saved": saved, "detected": detected, "direct": direct,
            "server_edition": auth.enabled()}


# ---------------------------------------------------------------- the same timing maths as web/src/remotion/timing.ts

def _round(x: float) -> int:
    return math.floor(x + 0.5)   # JavaScript's Math.round, so both sides land on the same frame


def kept_segments(spec: dict) -> list[dict]:
    segs = spec.get("segments") or [{"start": spec["in"], "end": spec["out"]}]
    out = [{"start": max(spec["in"], s["start"]), "end": min(spec["out"], s["end"])} for s in segs]
    out = sorted((s for s in out if s["end"] - s["start"] > 0.02), key=lambda s: s["start"])
    return out or [{"start": spec["in"], "end": max(spec["out"], spec["in"] + 0.1)}]


def _shot_index(shots: list[dict], t: float) -> int:
    idx = 0
    for i, s in enumerate(shots):
        if s["start"] <= t + 1e-6:
            idx = i
    return idx


def _rate(speeds: list[dict], t: float) -> float:
    for s in speeds:
        if s["start"] - 1e-6 <= t < s["end"] - 1e-6:
            return max(0.1, min(8.0, float(s["rate"])))
    return 1.0


def build_plan(spec: dict) -> list[dict]:
    """The short as a list of pieces on the output frame grid: source stretches at some speed, and held frames."""
    fps = spec["fps"]
    shots = spec.get("shots") or [{"start": spec["in"], "layout": "single", "x": [50], "transition": "cut"}]
    speeds = spec.get("speeds") or []
    freezes = sorted(spec.get("freezes") or [], key=lambda f: f["at"])
    raw: list[dict] = []
    for seg in kept_segments(spec):
        marks = {seg["start"], seg["end"]}
        prev = _shot_index(shots, seg["start"])
        for i in range(prev + 1, len(shots)):
            if shots[i]["start"] >= seg["end"]:
                break
            if shots[i]["layout"] != shots[prev]["layout"] or len(shots[i]["x"]) != len(shots[prev]["x"]):
                marks.add(shots[i]["start"])
            prev = i
        for sp in speeds:
            for t in (sp["start"], sp["end"]):
                if seg["start"] < t < seg["end"]:
                    marks.add(t)
        for f in freezes:
            if seg["start"] < f["at"] < seg["end"]:
                marks.add(f["at"])
        cuts = sorted(marks)
        for s, e in zip(cuts, cuts[1:]):
            for f in freezes:
                if abs(f["at"] - s) < 1e-6 and f["duration"] > 0.02:
                    raw.append({"s": s, "e": s, "shot": _shot_index(shots, s), "rate": 1.0, "hold": f["duration"]})
            if e - s > 1e-4:
                raw.append({"s": s, "e": e, "shot": _shot_index(shots, s), "rate": _rate(speeds, s), "hold": 0.0})
        for f in freezes:
            if abs(f["at"] - seg["end"]) < 1e-6 and f["duration"] > 0.02:
                raw.append({"s": seg["end"], "e": seg["end"], "shot": _shot_index(shots, seg["end"] - 1e-3), "rate": 1.0, "hold": f["duration"]})
    plan, seconds, start = [], 0.0, 0
    for r in raw:
        src_start = _round(r["s"] * fps) / fps
        seconds += r["hold"] if r["hold"] else (r["e"] - r["s"]) / r["rate"]
        end = _round(seconds * fps)
        frames = end - start
        if frames <= 0:
            continue
        plan.append({"src_start": src_start, "src_end": src_start if r["hold"] else src_start + frames / fps * r["rate"],
                     "from": start, "frames": frames, "shot": r["shot"], "rate": r["rate"], "hold": bool(r["hold"])})
        start = end
    return plan


def total_frames(plan: list[dict]) -> int:
    return plan[-1]["from"] + plan[-1]["frames"] if plan else 1


def out_frame_of(plan: list[dict], t: float, fps: float) -> int:
    for p in plan:
        if p["hold"]:
            if t <= p["src_start"] + 1e-6:
                return p["from"]
            continue
        if t < p["src_start"]:
            return p["from"]
        if t < p["src_end"]:
            return p["from"] + _round((t - p["src_start"]) / p["rate"] * fps)
    return total_frames(plan)


def caption_pages(words: list[dict], max_words: int) -> list[dict]:
    pages: list[dict] = []
    cur: list[dict] = []

    def flush():
        nonlocal cur
        if cur:
            pages.append({"words": cur, "start": cur[0]["start"], "end": cur[-1]["end"]})
        cur = []

    for w in (w for w in words if not w.get("removed") and str(w.get("text", "")).strip()):
        if cur and w["start"] - cur[-1]["end"] > 0.7:
            flush()
        cur.append(w)
        chars = sum(len(x["text"]) + 1 for x in cur)
        ends = re.search(r"[.!?][\"')]?$", w["text"]) is not None
        soft = re.search(r"[,;:]$", w["text"]) is not None and len(cur) >= max(2, max_words - 1)
        if len(cur) >= max_words or chars >= 26 or ends or soft:
            flush()
    flush()
    return pages


def _pane_x(shot: dict, t: float) -> list[float]:
    xs = [float(x) for x in shot.get("x") or [50]]
    track = shot.get("track") or []
    if track:
        if t <= track[0]["t"]:
            xs[0] = track[0]["x"]
        elif t >= track[-1]["t"]:
            xs[0] = track[-1]["x"]
        else:
            for a, b in zip(track, track[1:]):
                if a["t"] <= t <= b["t"]:
                    xs[0] = a["x"] + (b["x"] - a["x"]) * (t - a["t"]) / max(1e-6, b["t"] - a["t"])
                    break
    return xs


def _zoom(zooms: list[dict], t: float) -> float:
    scale = 1.0
    for z in zooms:
        if not z["at"] <= t <= z["at"] + z["duration"]:
            continue
        ramp = max(1e-3, min(0.18, z["duration"] / 3))
        p = max(0.0, min(1.0, (t - z["at"]) / ramp, (z["at"] + z["duration"] - t) / ramp))
        scale = max(scale, 1 + (z["scale"] - 1) * p)
    return scale


# ---------------------------------------------------------------- helpers

def _rgb(colour: str, fallback=(1.0, 1.0, 1.0)) -> tuple[float, float, float]:
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", (colour or "").strip())
    if not m:
        return fallback
    v = m.group(1)
    return tuple(int(v[i:i + 2], 16) / 255 for i in (0, 2, 4))   # type: ignore[return-value]


def _plain(text: str) -> str:
    """Drop Cutroom's colour markup: {word|#hex} and {word} become word."""
    return re.sub(r"\{([^{}|]*)(?:\|[^{}]*)?\}", r"\1", text or "").strip()


def _lane(lanes: list[int], start: int, end: int) -> int:
    """First track whose last clip has ended by `start` (clips on one CapCut track cannot overlap)."""
    for i, busy_until in enumerate(lanes):
        if busy_until <= start:
            lanes[i] = end
            return i
    lanes.append(end)
    return len(lanes) - 1


class _Builder:
    def __init__(self, cc, spec: dict, media: Path, job: Job):
        self.cc, self.spec, self.media, self.job = cc, spec, media, job
        self.W, self.H, self.fps = int(spec["width"]), int(spec["height"]), spec["fps"]
        self.notes: list[str] = []
        self.counts: dict[str, int] = {}
        self.copied: dict[str, Path] = {}

    def us(self, frame: float) -> int:
        return _round(frame * 1_000_000 / self.fps)

    def span(self, start_frame: float, end_frame: float):
        a, b = self.us(start_frame), self.us(end_frame)
        return self.cc.Timerange(a, max(1, b - a))

    def count(self, what: str, n: int = 1) -> None:
        self.counts[what] = self.counts.get(what, 0) + n

    def bring(self, url_or_path, name: str = "") -> Path | None:
        """Copy a media file into the project so it travels with it. Returns the copy, or None if it is missing."""
        try:
            src = url_or_path if isinstance(url_or_path, Path) else media_path(str(url_or_path))
        except ValueError:
            return None
        if not src.is_file():
            return None
        key = str(src)
        if key not in self.copied:
            dest = unique_path(self.media, safe_name(name or src.stem, "media"), src.suffix.lstrip(".") or "bin")
            shutil.copy2(src, dest)
            self.copied[key] = dest
        return self.copied[key]

    # where a w×h picture sits by default in CapCut: fitted inside the canvas, centred, at scale 1
    def fit(self, w: float, h: float) -> float:
        return min(self.W / w, self.H / h)

    def at_box(self, cx: float, cy: float) -> tuple[float, float]:
        """CapCut position (in half-canvases, up is positive) for a centre given in canvas pixels."""
        return (cx - self.W / 2) / (self.W / 2), -(cy - self.H / 2) / (self.H / 2)

    def text_at(self, x_pct: float, y_pct: float):
        tx, ty = self.at_box(self.W * x_pct / 100, self.H * y_pct / 100)
        return self.cc.ClipSettings(transform_x=tx, transform_y=ty)

    def font(self, name: str):
        key = {"Anton": "Anton", "Bebas Neue": "BebasNeue", "Cinzel": "CINZEL", "Montserrat": "Montserrat", "Poppins": "Poppins_Bold"}.get(name or "")
        return getattr(self.cc.FontType, key, None) if key else None

    def size(self, px: float, scale: float = 1.0) -> float:
        return round(max(2.0, px * scale / FONT_PX_PER_UNIT), 1)


def _crop(cc, sw: float, sh: float, pw: float, ph: float, x: float, y: float):
    """The part of the source that fills a pw×ph box when cropped at x%, y%."""
    s = max(pw / sw, ph / sh)
    cw, ch = pw / s, ph / s
    left, top = (sw - cw) * x / 100, (sh - ch) * y / 100
    l, r, t, b = left / sw, (left + cw) / sw, top / sh, (top + ch) / sh
    return cc.CropSettings(upper_left_x=l, upper_left_y=t, upper_right_x=r, upper_right_y=t,
                           lower_left_x=l, lower_left_y=b, lower_right_x=r, lower_right_y=b), cw, ch


# ---------------------------------------------------------------- the export

def export(project: dict, clip: dict, job: Job, as_zip: bool = False) -> dict:
    """Write the clip as a CapCut project: straight into CapCut's projects folder when it is on this computer,
    otherwise as a zip to unpack there."""
    cc = _lib()
    spec = clip["spec"]
    where = state()
    direct = where["direct"] and not as_zip
    title = (clip.get("title") or project.get("name") or "Cutroom short").strip()
    work = DATA / "tmp" / f"capcut_{job.id}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    try:
        name = safe_name(title, "Cutroom short")
        if direct:   # a folder name CapCut does not have yet
            base, n = name, 2
            while (Path(where["folder"]) / name).exists():
                name, n = f"{base} {n}", n + 1
        draft_dir = work / name
        script = cc.DraftFolder(str(work)).create_draft(name, int(spec["width"]), int(spec["height"]), int(round(spec["fps"])), allow_replace=True)
        media = draft_dir / "media"
        media.mkdir(parents=True, exist_ok=True)
        b = _Builder(cc, spec, media, job)
        _build(cc, script, b, spec, job)
        job.update(0.9, "Writing the CapCut project")
        script.save()

        content = draft_dir / "draft_content.json"
        if direct:
            final = Path(where["folder"]) / name
            _repath(content, draft_dir, str(final))
            shutil.move(str(draft_dir), str(final))
            out = {"where": "capcut", "name": name, "folder": str(final), "file": "", "size": 0}
        else:
            # absolute paths when we know the person's folder, CapCut's own "this project's folder" token when not
            base = f"{where['saved'].rstrip('/').rstrip(chr(92))}{chr(92) if chr(92) in where['saved'] or ':' in where['saved'][:3] else '/'}{name}" if where["saved"] else PLACEHOLDER
            _repath(content, draft_dir, base)
            dest = DATA / "exports" / "capcut"
            dest.mkdir(parents=True, exist_ok=True)
            zip_path = unique_path(dest, name, "zip")
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as z:   # media is already compressed
                for f in sorted(draft_dir.rglob("*")):
                    if f.is_file():
                        z.write(f, Path(name) / f.relative_to(draft_dir))
            out = {"where": "zip", "name": name, "folder": where["saved"], "file": media_url(zip_path), "size": zip_path.stat().st_size}
        out.update(notes=b.notes, tracks=b.counts, seconds=round(total_frames(build_plan(spec)) / spec["fps"], 2))
        return out
    except cc.exceptions.SegmentOverlap as e:
        raise MediaError(f"Two items overlap on one CapCut track, so the project could not be written ({e}).") from e
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _repath(content: Path, local: Path, target: str) -> None:
    """Point every media path in the project at where the files will live on the computer that runs CapCut."""
    data = json.loads(content.read_text("utf-8"))
    prefix = str(local.resolve())
    windows = "\\" in target or re.match(r"^[A-Za-z]:", target) is not None

    def fix(v):
        if isinstance(v, str) and v.startswith(prefix):
            rest = v[len(prefix):].replace("\\", "/")
            return target + (rest.replace("/", "\\") if windows else rest)
        if isinstance(v, list):
            return [fix(i) for i in v]
        if isinstance(v, dict):
            return {k: fix(i) for k, i in v.items()}
        return v

    content.write_text(json.dumps(fix(data), ensure_ascii=False), "utf-8")


def _build(cc, script, b: _Builder, spec: dict, job: Job) -> None:
    W, H, fps = b.W, b.H, b.fps
    plan = build_plan(spec)
    total = total_frames(plan)
    audio = spec.get("audio") or {}
    shots = spec.get("shots") or [{"start": spec["in"], "layout": "single", "x": [50], "transition": "cut"}]
    zooms = spec.get("zooms") or []
    frame = spec.get("frame") or {"mode": "full"}
    panel = frame.get("mode") == "panel"

    # ---- the source, trimmed to this clip so the project stays small
    source = media_path(spec["src"])
    if not source.is_file():
        raise MediaError("The source video for this clip no longer exists.")
    offset = max(0.0, spec["in"] - 0.5)
    length = spec["out"] - offset + 0.5
    trimmed = b.media / "source.mp4"
    ffmpeg(["-ss", f"{offset:.3f}", "-t", f"{length:.3f}", "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(trimmed)], job, length, (0.02, 0.45), "Copying this clip's part of the source")
    info = probe(trimmed)
    sw, sh = float(info["width"]), float(info["height"])
    src_us = int(info["duration"] * 1_000_000)

    clean = None
    if audio.get("cleanSrc"):
        clean = b.bring(audio["cleanSrc"], "voice-cleaned")
    muted = bool((audio.get("voiceover") or {}).get("muteOriginal")) or bool((audio.get("music") or {}).get("replaces"))
    voice = 0.0 if muted else float(audio.get("voice", 1.0))

    # ---- picture area
    if panel:
        bw = round(W * frame.get("width", 100) / 100)
        bh = min(H, round(bw / max(0.1, frame.get("aspect", 1))))
        box_top = max(0, min(H - bh, H * frame.get("y", 50) / 100 - bh / 2))
        box = ((W - bw) / 2, box_top, bw, bh)
        if frame.get("shape") in ("rounded", "squircle"):
            b.notes.append("The picture box has square corners in CapCut; add a mask there if you want them rounded.")
    else:
        box = (0.0, 0.0, float(W), float(H))
    blur_bg = panel and frame.get("bg") == "blur"

    max_panes = max((3 if shots[p["shot"]].get("layout") == "trio" else 2 if shots[p["shot"]].get("layout") == "split" else 1) for p in plan)
    script.add_track(cc.TrackType.video, "Video", relative_index=0)
    for n in range(2, max_panes + 1):
        script.add_track(cc.TrackType.video, f"Split {n}", relative_index=n - 1)

    def source_range(p: dict):
        a = max(0, _round((p["src_start"] - offset) * 1_000_000))
        d = max(1, _round((p["src_end"] - p["src_start"]) * 1_000_000))
        if a + d > src_us:
            d = max(1, src_us - a)
        return cc.Timerange(a, d)

    stills = 0
    tracked = False
    for p in plan:
        shot = shots[min(p["shot"], len(shots) - 1)]
        layout = shot.get("layout", "single")
        n = 3 if layout == "trio" else 2 if layout == "split" else 1
        target = b.span(p["from"], p["from"] + p["frames"])
        still = None
        if p["hold"]:
            stills += 1
            still = b.media / f"freeze-{stills}.png"
            ffmpeg(["-ss", f"{max(0.0, p['src_start'] - offset):.3f}", "-i", str(trimmed), "-frames:v", "1", str(still)])
        y = float(shot.get("y", 50))
        xs = _pane_x(shot, p["src_start"])
        bx, by, bw_, bh_ = box
        landscape = bw_ > bh_
        gap = round(bw_ * 0.006) if n > 1 else 0
        pw = (bw_ - gap * (n - 1)) / n if landscape else bw_
        ph = bh_ if landscape else (bh_ - gap * (n - 1)) / n

        for i in range(n):
            px = bx + (pw + gap) * i if landscape else bx
            py = by if landscape else by + (ph + gap) * i
            tx, ty = b.at_box(px + pw / 2, py + ph / 2)
            keys: list[tuple[int, float, float, float]] = []
            if layout == "fit":
                # the whole picture inside the box, on a blurred copy of itself
                material = cc.VideoMaterial(str(still or trimmed))
                k = min(pw / sw, ph / sh) / b.fit(sw, sh)
                settings = cc.ClipSettings(scale_x=k, scale_y=k, transform_x=tx, transform_y=ty)
            elif n == 1 and not panel:
                # full frame: keep the whole picture and slide it, so it can be re-framed by dragging in CapCut
                material = cc.VideoMaterial(str(still or trimmed))
                cover = max(W / sw, H / sh)

                def place(t: float) -> tuple[float, float, float]:
                    z = 1.0 if p["hold"] else _zoom(zooms, t)
                    x = _pane_x(shot, t)[0]
                    dw, dh = sw * cover * z, sh * cover * z
                    return cover * z / b.fit(sw, sh), (dw - W) * (0.5 - x / 100) / (W / 2), -(dh - H) * (0.5 - y / 100) / (H / 2)

                k, kx, ky = place(p["src_start"])
                settings = cc.ClipSettings(scale_x=k, scale_y=k, transform_x=kx, transform_y=ky)
                if not p["hold"]:
                    times = {p["src_start"], p["src_end"]}
                    for z in zooms:
                        ramp = min(0.18, z["duration"] / 3)
                        times |= {z["at"], z["at"] + ramp, z["at"] + z["duration"] - ramp, z["at"] + z["duration"]}
                    times |= {k_["t"] for k_ in shot.get("track") or []}
                    inside = sorted(t for t in times if p["src_start"] - 1e-6 <= t <= p["src_end"] + 1e-6)
                    values = [(t, *place(t)) for t in inside]
                    if any(abs(v[1] - k) > 1e-4 or abs(v[2] - kx) > 1e-4 for v in values):
                        keys = [(max(0, _round((t - p["src_start"]) / p["rate"] * 1_000_000)), s_, x_, y_) for t, s_, x_, y_ in values]
                        tracked = tracked or bool(shot.get("track"))
            else:
                # a pane of a split, or a picture in a box: crop the source to the pane and place it
                crop, cw, ch = _crop(cc, sw, sh, pw, ph, xs[i] if i < len(xs) else 50.0, y)
                material = cc.VideoMaterial(str(still or trimmed), crop_settings=crop)
                k = pw / (cw * b.fit(cw, ch))
                settings = cc.ClipSettings(scale_x=k, scale_y=k, transform_x=tx, transform_y=ty)
            volume = voice if (i == 0 and not clean and not p["hold"]) else 0.0
            if still:
                seg = cc.VideoSegment(material, target, clip_settings=settings)
            else:
                seg = cc.VideoSegment(material, target, source_timerange=source_range(p), volume=volume, clip_settings=settings)
            for at, s_, x_, y_ in keys:
                seg.add_keyframe(cc.KeyframeProperty.uniform_scale, at, s_)
                seg.add_keyframe(cc.KeyframeProperty.position_x, at, x_)
                seg.add_keyframe(cc.KeyframeProperty.position_y, at, y_)
            if i == 0 and (layout == "fit" or blur_bg):
                seg.add_background_filling("blur", 0.0625)
            script.add_segment(seg, "Video" if i == 0 else f"Split {i + 1}")
        b.count("video clips")
    if stills:
        b.count("freeze frames", stills)
    if any(shots[p["shot"]].get("transition") == "smooth" for p in plan):
        b.notes.append("Smooth slides between framings are hard cuts in CapCut.")
    if panel and any(shots[p["shot"]].get("track") for p in plan):
        b.notes.append("Speaker tracking is not carried into a boxed or split picture; the framing at the start of each clip is used.")
    job.update(0.55, "Placing captions and titles")

    seconds = total / fps
    vindex = max_panes

    # ---- b-roll, then the logo, above the picture
    broll_lanes: list[int] = []
    for g in sorted((g for g in spec.get("graphics") or [] if g.get("type") == "broll" and g.get("src")), key=lambda g: g["at"]):
        start = out_frame_of(plan, g["at"], fps)
        end = min(total, start + max(1, _round(g["duration"] * fps)))
        if end <= start:
            continue
        copy = b.bring(g["src"], "broll")
        if not copy:
            b.notes.append("A b-roll file was missing and was left out.")
            continue
        mat = cc.VideoMaterial(str(copy))
        if mat.material_type != "photo" and mat.duration < b.us(end - start):
            end = start + max(1, int(mat.duration * fps / 1_000_000))
        lane = _lane(broll_lanes, start, end)
        track = f"B-roll {lane + 1}" if lane else "B-roll"
        if lane == len(broll_lanes) - 1 and not any(t.name == track for t in script.tracks.values()):
            script.add_track(cc.TrackType.video, track, relative_index=vindex)
            vindex += 1
        k = max(W / mat.width, H / mat.height) / b.fit(mat.width, mat.height)
        kw = {} if mat.material_type == "photo" else {"volume": 0.0}
        script.add_segment(cc.VideoSegment(mat, b.span(start, end), clip_settings=cc.ClipSettings(scale_x=k, scale_y=k), **kw), track)
        b.count("b-roll")

    brand = spec.get("brand") or {}
    if brand.get("logo"):
        copy = b.bring(brand["logo"], "logo")
        if copy:
            mat = cc.VideoMaterial(str(copy))
            size = W * float(brand.get("logoSize", 14)) / 100
            k = size / (mat.width * b.fit(mat.width, mat.height))
            shown_h = mat.height * b.fit(mat.width, mat.height) * k
            margin = W * 0.04
            if brand.get("logoX") is not None and brand.get("logoY") is not None:
                cx, cy = W * brand["logoX"] / 100, H * brand["logoY"] / 100
            else:
                pos = brand.get("logoPos", "top-right")
                cx = margin + size / 2 if "left" in pos else W - margin - size / 2
                cy = margin + shown_h / 2 if "top" in pos else H - margin - shown_h / 2
            tx, ty = b.at_box(cx, cy)
            script.add_track(cc.TrackType.video, "Logo", relative_index=vindex)
            script.add_segment(cc.VideoSegment(mat, b.span(0, total), clip_settings=cc.ClipSettings(
                scale_x=k, scale_y=k, transform_x=tx, transform_y=ty, alpha=float(brand.get("logoOpacity", 1.0)))), "Logo")
            b.count("logo")

    # ---- captions
    tindex = 0
    cap = spec.get("captions") or {}
    if cap.get("visible", True):
        preset = cap.get("preset", "boldpop")
        style = cc.TextStyle(size=b.size(cap.get("size", 86)), bold=preset not in ("clean", "typeon"), color=_rgb(cap.get("color", "#ffffff")),
                             align=1, auto_wrapping=True, max_line_width=0.86)
        border = cc.TextBorder(color=(0.0, 0.0, 0.0), width=45.0) if preset in ("boldpop", "karaoke", "tape", "typeon") else None
        background = cc.TextBackground(color="#000000", alpha=0.72 if preset == "clean" else 1.0, round_radius=0.3 if preset == "clean" else 0.0) if preset in ("clean", "box") else None
        shadow = cc.TextShadow(color=_rgb(cap.get("highlight", "#000000")) if preset in ("neon", "glow") else (0.0, 0.0, 0.0),
                               diffuse=60.0 if preset in ("neon", "glow") else 25.0, distance=0.0 if preset in ("neon", "glow") else 6.0) if preset in ("shadow", "neon", "glow") else None
        where = b.text_at(float(cap.get("x", 50)), float(cap.get("position", 70)))
        font = b.font(cap.get("font", ""))
        lead = float(cap.get("lead", 0.04) if cap.get("lead") is not None else 0.04)
        lines: list[tuple[float, float, str]] = []
        mode = cap.get("mode", "original")
        translations = cap.get("translations") or []
        if mode == "translated" and translations:
            lines = [(l["start"], l["end"], l["text"]) for l in translations]
        else:
            pages = caption_pages(spec.get("words") or [], int(cap.get("maxWords", 3)))
            for i, pg in enumerate(pages):
                nxt = pages[i + 1]["start"] - lead if i + 1 < len(pages) else None
                end = min(nxt, pg["end"] + 0.5) if nxt is not None else pg["end"] + 0.5
                text = " ".join(w["text"].strip() for w in pg["words"])
                if mode == "bilingual":
                    extra = next((l["text"] for l in translations if l["start"] <= pg["start"] < l["end"]), "")
                    text = f"{text}\n{extra}" if extra else text
                lines.append((pg["start"] - lead, end, text))
        script.add_track(cc.TrackType.text, "Captions", relative_index=tindex)
        tindex += 1
        last = 0
        for start_t, end_t, text in lines:
            start = max(last, out_frame_of(plan, max(spec["in"], start_t), fps))
            end = min(total, out_frame_of(plan, end_t, fps))
            if end - start < 1 or not text.strip():
                continue
            script.add_segment(cc.TextSegment(text.upper() if cap.get("uppercase") else text, b.span(start, end), font=font, style=style,
                                              clip_settings=where, border=border, background=background, shadow=shadow), "Captions")
            last = end
            b.count("caption lines")
        if preset in ("karaoke", "boldpop", "neon", "glow", "typeon"):
            b.notes.append("Captions arrive a line at a time in CapCut; the word-by-word highlight, typing effect and per-word colours are not carried over.")
        if any(w.get("emoji") for w in spec.get("words") or []) and cap.get("emoji"):
            b.notes.append("Emoji above caption words are not carried over.")

    # ---- the opening title
    hook = spec.get("hook") or {}
    if hook.get("visible") and _plain(hook.get("text", "")):
        end = min(total, max(1, _round(float(hook.get("duration", 3)) * fps)))
        script.add_track(cc.TrackType.text, "Title", relative_index=tindex)
        tindex += 1
        script.add_segment(cc.TextSegment(
            _plain(hook["text"]).upper(), b.span(0, end), font=b.font(brand.get("font", "")),
            style=cc.TextStyle(size=b.size(96, float(hook.get("scale", 1))), bold=True, align=1, auto_wrapping=True, max_line_width=0.86),
            border=cc.TextBorder(color=(0.0, 0.0, 0.0), width=45.0),
            clip_settings=b.text_at(float(hook.get("x", 50)), float(hook.get("y", 11)) + 6)), "Title")
        b.count("title")

    # ---- graphics that are text
    lanes: list[int] = []
    lost: dict[str, int] = {}
    fx_lanes: list[int] = []
    fx_volume = float(audio.get("fx", 1.0))
    for g in sorted(spec.get("graphics") or [], key=lambda g: g["at"]):
        kind = g.get("type")
        start = out_frame_of(plan, g["at"], fps)
        end = min(total, start + max(1, _round(float(g.get("duration", 2)) * fps)))
        if end <= start:
            continue
        if g.get("sfx") and fx_volume > 0:
            copy = b.bring(DATA / "assets" / "sfx" / Path(str(g["sfx"])).name, "sfx")
            if copy:
                mat = cc.AudioMaterial(str(copy))
                stop = min(total, start + max(1, int(mat.duration * fps / 1_000_000)))
                lane = _lane(fx_lanes, start, stop)
                track = f"Sound effects {lane + 1}" if lane else "Sound effects"
                if not any(t.name == track for t in script.tracks.values()):
                    script.add_track(cc.TrackType.audio, track, relative_index=10 + lane)
                script.add_segment(cc.AudioSegment(mat, b.span(start, stop), volume=fx_volume), track)
                b.count("sound effects")
        if kind == "broll":
            continue
        if kind not in TEXT_GRAPHICS:
            lost[kind] = lost.get(kind, 0) + 1
            continue
        if kind in ("cascade", "steps"):
            text = "\n".join(x for x in [g.get("headline", ""), *(g.get("keywords") or [])] if x)
        elif kind in ("keyword", "counter", "lowerthird"):
            text = "\n".join(x for x in (g.get("primary", ""), g.get("headline", "")) if x)
        else:
            text = g.get("primary", "")
        text = _plain(text)
        if not text:
            continue
        lane = _lane(lanes, start, end)
        track = f"Graphics {lane + 1}"
        if not any(t.name == track for t in script.tracks.values()):
            script.add_track(cc.TrackType.text, track, relative_index=tindex)
            tindex += 1
        base = {"keyword": 120, "counter": 150, "emoji": 150, "lowerthird": 60, "nametag": 46, "label": 58}.get(kind, 64)
        colour = _rgb(g.get("color") or "", (1.0, 1.0, 1.0))
        look = g.get("style") or ("plain" if kind in ("label", "nametag") else "")
        y_pct = ZONE_Y.get(g.get("zone", "center"), 50.0) + float(g.get("dy") or 0)
        x_pct = 50.0 + float(g.get("dx") or 0)
        script.add_segment(cc.TextSegment(
            text, b.span(start, end), font=b.font(brand.get("font", "")),
            style=cc.TextStyle(size=b.size(base, float(g.get("scale") or 1)), bold=True, color=colour, align=1, auto_wrapping=True, max_line_width=0.86),
            border=None if look == "box" else cc.TextBorder(color=(0.0, 0.0, 0.0), width=40.0),
            background=cc.TextBackground(color="#000000") if look == "box" else None,
            clip_settings=b.text_at(max(4.0, min(96.0, x_pct)), max(4.0, min(96.0, y_pct)))), track)
        b.count("text graphics")
    if lost:
        names = ", ".join(sorted({LOST_GRAPHICS.get(k, k) for k in lost}))
        b.notes.append(f"Not carried over ({sum(lost.values())}): {names}. CapCut has its own versions of these; add them there, or export the MP4 from Cutroom and use that instead.")
    if any(g.get("type") in ("keyword", "counter", "cascade", "steps", "lowerthird") for g in spec.get("graphics") or []):
        b.notes.append("Animated cards (keyword pops, counters, lists, lower thirds) become plain text at the same time and place.")

    # ---- handle / channel header
    if (brand.get("watermark") or "").strip():
        script.add_track(cc.TrackType.text, "Watermark", relative_index=tindex)
        tindex += 1
        script.add_segment(cc.TextSegment(
            brand["watermark"].strip(), b.span(0, total),
            style=cc.TextStyle(size=b.size(float(brand.get("watermarkSize", 28))), bold=True, align=1, alpha=float(brand.get("watermarkOpacity", 0.62))),
            clip_settings=b.text_at(float(brand.get("watermarkX", 50)), float(brand.get("watermarkY", 97.6)) - 1.2)), "Watermark")
        b.count("watermark")
    header = spec.get("header") or {}
    if header.get("name") or header.get("handle"):
        script.add_track(cc.TrackType.text, "Channel header", relative_index=tindex)
        tindex += 1
        script.add_segment(cc.TextSegment(
            "\n".join(x for x in (header.get("name", ""), header.get("handle", "")) if x), b.span(0, total),
            style=cc.TextStyle(size=b.size(40), bold=True, align=1), clip_settings=b.text_at(50, float(header.get("y", 12)))), "Channel header")
        b.notes.append("The channel header is text only; add the profile picture in CapCut.")

    job.update(0.75, "Placing audio")
    # ---- audio
    aindex = 0
    if clean and voice > 0:
        mat = cc.AudioMaterial(str(clean))
        script.add_track(cc.TrackType.audio, "Voice (cleaned)", relative_index=aindex)
        aindex += 1
        base_t = float(audio.get("cleanOffset") or 0)
        for p in plan:
            if p["hold"]:
                continue
            a = max(0, _round((p["src_start"] - base_t) * 1_000_000))
            d = max(1, _round((p["src_end"] - p["src_start"]) * 1_000_000))
            if a >= mat.duration:
                continue
            d = min(d, mat.duration - a)
            script.add_segment(cc.AudioSegment(mat, b.span(p["from"], p["from"] + p["frames"]), source_timerange=cc.Timerange(a, d), volume=voice), "Voice (cleaned)")
        b.count("cleaned voice")
    vo = audio.get("voiceover")
    if vo and vo.get("src"):
        copy = b.bring(vo["src"], "voiceover")
        if copy:
            mat = cc.AudioMaterial(str(copy))
            start = max(0, _round(float(vo.get("at", 0)) * fps))
            end = min(total, start + max(1, int(mat.duration * fps / 1_000_000)))
            if end > start:
                script.add_track(cc.TrackType.audio, "Voiceover", relative_index=aindex)
                aindex += 1
                script.add_segment(cc.AudioSegment(mat, b.span(start, end), volume=float(vo.get("volume", 1.0))), "Voiceover")
                b.count("voiceover")
    music = audio.get("music")
    if music and music.get("src"):
        copy = b.bring(music["src"], "music")
        if copy:
            mat = cc.AudioMaterial(str(copy))
            script.add_track(cc.TrackType.audio, "Music", relative_index=aindex)
            aindex += 1
            first = max(0, min(mat.duration - 1, _round(float(music.get("start", 0)) * 1_000_000)))
            at = 0
            end_us = b.us(total)
            head = first
            while at < end_us and mat.duration > 1000:
                d = min(mat.duration - head, end_us - at)
                script.add_segment(cc.AudioSegment(mat, cc.Timerange(at, d), source_timerange=cc.Timerange(head, d), volume=float(music.get("volume", 0.2))), "Music")
                at += d
                head = 0   # loop from the top once the track runs out
            b.count("music")
            if music.get("duck"):
                b.notes.append("Music does not lower itself under speech in CapCut; it plays at its set volume throughout.")

    look = spec.get("look") or {}
    changed = look.get("preset", "none") != "none" or look.get("bw") or look.get("vignette") or any(abs(float(look.get(k, 1) or 1) - 1) > 0.01 for k in ("brightness", "contrast", "saturation"))
    if changed:
        b.notes.append("The colour look is not carried over; use CapCut's filters and adjustments.")
    if look.get("progressBar"):
        b.notes.append("The progress bar is not carried over.")
    if tracked:
        b.notes.append("Speaker tracking and punch-ins are position and scale keyframes on the video clips.")
    b.notes.append("Text sizes and positions are close, not exact: CapCut measures text differently. Select a whole text track to adjust it in one go.")
    b.counts["length"] = round(seconds, 2)
