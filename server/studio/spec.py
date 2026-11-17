"""Building and transforming short specs (the JSON the editor edits and the renderer renders)."""
from __future__ import annotations

import copy

from ..config import get_settings

ASPECTS = {"9:16": (1080, 1920), "3:4": (1080, 1440), "4:5": (1080, 1350), "1:1": (1080, 1080), "16:9": (1920, 1080)}

# What a template may carry from one clip to the next.
TEMPLATE_KEYS = ("captions", "look", "brand", "width", "height", "fps", "frame", "header")


def default_spec(project: dict, t_in: float, t_out: float, hook: str = "", template: dict | None = None) -> dict:
    brand = get_settings()["brand"]
    src = project["source"]
    words = [dict(w) for w in (project.get("transcript") or {}).get("words", [])
             if w["start"] >= t_in - 0.05 and w["end"] <= t_out + 0.05]
    spec = {
        "src": src["url"], "srcW": src["width"], "srcH": src["height"], "fps": 30, "width": 1080, "height": 1920,
        "in": round(t_in, 3), "out": round(t_out, 3),
        "segments": [{"start": round(t_in, 3), "end": round(t_out, 3)}],
        "words": words,
        "shots": [{"start": round(t_in, 3), "layout": "single", "x": [50], "transition": "cut"}],
        "zooms": [], "graphics": [],
        "hook": {"text": hook, "visible": bool(hook), "duration": 2.4},
        "captions": {"visible": True, "preset": "boldpop", "font": brand["font"], "size": 84, "color": "#ffffff",
                     "highlight": brand["accent"], "position": 70, "uppercase": True, "maxWords": 3, "emoji": True,
                     "mode": "original", "translations": []},
        "look": {"preset": "none", "bw": False, "vignette": False, "progressBar": False},
        "audio": {"voice": 1.0, "fx": 0.5, "music": None, "voiceover": None},
        "brand": {k: brand[k] for k in ("accent", "secondary", "font", "logo", "logoPos", "logoSize", "watermark")},
        "sfxBase": "/media/assets/sfx/",
    }
    if template:
        apply_template(spec, template)
    return spec


def apply_template(spec: dict, template: dict) -> dict:
    for key in TEMPLATE_KEYS:
        if key not in template:
            continue
        if isinstance(spec.get(key), dict) and isinstance(template[key], dict):
            keep = {"translations": spec[key].get("translations", [])} if key == "captions" else {}
            spec[key] = {**spec[key], **copy.deepcopy(template[key]), **keep}
        else:
            spec[key] = template[key]
    return spec


def template_from(spec: dict) -> dict:
    t = {k: copy.deepcopy(spec[k]) for k in TEMPLATE_KEYS if k in spec}
    t.get("captions", {}).pop("translations", None)
    return t


def for_render(spec: dict, offset: float, base_url: str, src_url: str) -> dict:
    """Shift every source time by -offset (the render works on a trimmed copy) and make media URLs absolute."""
    s = copy.deepcopy(spec)

    def url(u: str | None) -> str:
        return base_url + u if u and u.startswith("/") else (u or "")

    s["src"] = src_url
    s["in"] -= offset
    s["out"] -= offset
    for seg in s.get("segments", []):
        seg["start"] -= offset
        seg["end"] -= offset
    for w in s.get("words", []):
        w["start"] -= offset
        w["end"] -= offset
    for shot in s.get("shots", []):
        shot["start"] -= offset
        for k in shot.get("track") or []:
            k["t"] -= offset
        shot.pop("faces", None)
    for z in s.get("zooms", []):
        z["at"] -= offset
    for g in s.get("graphics", []):
        g["at"] -= offset
        if g.get("src"):
            g["src"] = url(g["src"])
    for line in s.get("captions", {}).get("translations", []):
        line["start"] -= offset
        line["end"] -= offset
    audio = s.get("audio", {})
    if audio.get("cleanSrc"):
        audio["cleanSrc"] = url(audio["cleanSrc"])
        audio["cleanOffset"] = audio.get("cleanOffset", 0) - offset
    for key in ("music", "voiceover"):
        if audio.get(key) and audio[key].get("src"):
            audio[key]["src"] = url(audio[key]["src"])
    if s.get("brand", {}).get("logo"):
        s["brand"]["logo"] = url(s["brand"]["logo"])
    s["sfxBase"] = url(s.get("sfxBase") or "/media/assets/sfx/")
    return s


def kept_duration(spec: dict) -> float:
    segs = spec.get("segments") or [{"start": spec["in"], "end": spec["out"]}]
    return sum(max(0.0, min(spec["out"], s["end"]) - max(spec["in"], s["start"])) for s in segs)


def transcript_text(spec: dict) -> str:
    return " ".join(w["text"] for w in spec.get("words", []) if not w.get("removed"))
