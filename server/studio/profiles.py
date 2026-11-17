"""Style profiles: learn an editing style from reference videos, keep it as readable rules, and improve it from corrections.

Nothing here trains a model. A profile is data on disk: measurements, a style the editor can apply, and written rules
that are sent along with every AI request for clips that use the profile.
"""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

from ..config import DATA, media_url
from ..jobs import Job
from ..media import MediaError, need, probe
from ..store import Collection
from . import ai, vision

profiles = Collection("profiles")
FRAMES_PER_REFERENCE = 8
MAX_FRAMES = 40

# What the editor can draw. The model picks from these so its answer can be applied directly.
CAPTION_LOOKS = {
    "boldpop": "heavy condensed capitals with a black outline; the spoken word pops in the highlight colour",
    "karaoke": "words change to the highlight colour as they are spoken",
    "tape": "each word on its own small white label, the spoken one coloured",
    "clean": "sentence-case text in a dark rounded box",
    "neon": "glowing coloured text",
    "typeon": "words type on one at a time with a cursor",
    "shadow": "heavy capitals on a soft dark shadow, no outline",
    "box": "white text on a plain black rectangle",
    "glow": "saturated serif capitals with a wide coloured haze",
}
FONTS = ["Anton", "Archivo Black", "Bebas Neue", "Montserrat", "Poppins", "Cinzel", "Inter", "JetBrains Mono"]
ELEMENTS = ["label", "nametag", "circle", "arrow", "spotlight", "flash", "dip", "heart", "emoji", "freeze", "speed_change",
            "keyword", "counter", "lowerthird", "steps", "broll", "progress_bar", "logo", "watermark", "channel_header", "split_screen"]

ANALYSIS_SYSTEM = """\
You are studying reference videos so that an editing program can reproduce their style on new footage. \
The person who uploaded them wants their own videos to feel like these: the same kind of framing, captions, on-screen \
text, effects and pacing, with their own content and branding.

The style will be rebuilt with a fixed set of tools, listed in the request. Describe what you see in terms of those \
tools, choosing the closest match, so the answer can be applied without interpretation. When a reference does something \
those tools cannot do, do not force it into the nearest tool; list it under cannot_reproduce so the person knows.

You are given still frames with their timestamps, plus measurements the program took itself (size, length, how often \
the picture cuts). Stills cannot show motion, sound or exact timing, so use the measurements for pacing and say what \
you could not determine under unsure. Do not guess at music, voice or sound effects.

When several references are given, the style is what they have in common. Report the shared choices as the style, and \
put anything that differs between references under varies. One unusual reference should not change the style.

Read the on-screen text closely: it shows how this creator writes. Turn it into writing rules a writer could follow \
(how the opening line works, how long lines are, capitalisation, punctuation, emoji, how the ending lands). Quote short \
examples only to illustrate a rule. Describe the references' logos, watermarks and channel names only as "a logo in \
the top-left corner" and the like; never copy another channel's name or branding into the style.

Write every rule as a plain instruction that would still make sense to someone who never saw the references."""


def _analysis_request(refs: list[dict]) -> str:
    looks = "\n".join(f"- {k}: {v}" for k, v in CAPTION_LOOKS.items())
    facts = "\n".join(
        f"- Reference {i + 1} ({r['name']}): {r['width']}x{r['height']}, {r['fps']:.0f} fps, {r['duration']:.1f}s long, "
        f"{r['cuts']} picture cuts (one every {r['shot_seconds']:.1f}s on average)"
        for i, r in enumerate(refs))
    return f"""\
Measurements:
{facts}

The frames follow, each introduced by a line naming its reference and timestamp.

Tools the editor has:

Canvas shapes: 9:16, 3:4, 4:5, 1:1, 16:9.
Picture: fills the frame, or sits in a box ("panel") with square, rounded or very rounded corners over a blurred copy \
of the video or over black. A shot can also be split into two or three stacked crops.
Caption looks (for words that follow speech or narration):
{looks}
Fonts: {", ".join(FONTS)}.
Elements that can be placed anywhere and timed freely: label (free text; neon, in quotes, white with shadow, black \
box, or outline only), nametag (short text with a pointer under it), circle, arrow, spotlight (dims everything outside \
an ellipse), flash (white or coloured), dip (to black), heart (ending animation), emoji.
Timing: freeze (hold a frame), speed_change (fast-forward or slow motion), zoom punch-ins, hard cuts.
Animated cards: keyword, counter, lowerthird, steps, broll (cutaway image or clip).
Always-on: progress_bar, logo, watermark, channel_header (profile picture, name and handle above a boxed video).
Colour: brightness, contrast and saturation adjustments, black and white, vignette.

Give colours as #rrggbb. Give positions as a percentage down the frame (0 is the top edge, 100 the bottom)."""


ANALYSIS_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "canvas", "picture", "captions", "title", "elements", "colour", "pacing", "writing_rules",
                 "editing_rules", "brief", "varies", "cannot_reproduce", "unsure"],
    "properties": {
        "summary": {"type": "string", "description": "Two or three plain sentences describing the style."},
        "canvas": {"type": "string", "enum": ["9:16", "3:4", "4:5", "1:1", "16:9"]},
        "picture": {"type": "object", "additionalProperties": False, "required": ["mode", "corners", "background", "box_position"],
                    "properties": {"mode": {"type": "string", "enum": ["full", "panel"]},
                                   "corners": {"type": "string", "enum": ["square", "rounded", "squircle"]},
                                   "background": {"type": "string", "enum": ["blur", "black"]},
                                   "box_position": {"type": "number", "description": "Centre of the box, % down the frame; 50 when the picture fills the frame."}}},
        "captions": {"type": "object", "additionalProperties": False,
                     "required": ["present", "carry", "look", "font", "uppercase", "colour", "highlight", "position", "size", "words_per_line"],
                     "properties": {"present": {"type": "boolean"},
                                    "carry": {"type": "string", "enum": ["speech", "narration", "story_labels", "none"],
                                              "description": "What the running text is: the words being spoken, a narrator's script, or short story labels that are not speech."},
                                    "look": {"type": "string", "enum": list(CAPTION_LOOKS)},
                                    "font": {"type": "string", "enum": FONTS},
                                    "uppercase": {"type": "boolean"},
                                    "colour": {"type": "string"}, "highlight": {"type": "string"},
                                    "position": {"type": "number"},
                                    "size": {"type": "string", "enum": ["small", "medium", "large"]},
                                    "words_per_line": {"type": "integer"}}},
        "title": {"type": "object", "additionalProperties": False, "required": ["present", "stays_all_video", "position", "colours", "note"],
                  "properties": {"present": {"type": "boolean"}, "stays_all_video": {"type": "boolean"},
                                 "position": {"type": "number"},
                                 "colours": {"type": "array", "items": {"type": "string"}},
                                 "note": {"type": "string", "description": "How the title is written and styled, in one sentence."}}},
        "elements": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["type", "how"],
                                                 "properties": {"type": {"type": "string", "enum": ELEMENTS},
                                                                "how": {"type": "string", "description": "When and how this style uses it, in one sentence."}}}},
        "colour": {"type": "object", "additionalProperties": False, "required": ["brightness", "contrast", "saturation", "black_and_white", "vignette"],
                   "properties": {"brightness": {"type": "number", "description": "1 is unchanged; 0.7 to 1.4."},
                                  "contrast": {"type": "number"}, "saturation": {"type": "number"},
                                  "black_and_white": {"type": "boolean"}, "vignette": {"type": "boolean"}}},
        "pacing": {"type": "string", "description": "One or two sentences on rhythm, from the measurements and how often the text changes."},
        "writing_rules": {"type": "array", "items": {"type": "string"}},
        "editing_rules": {"type": "array", "items": {"type": "string"}},
        "brief": {"type": "string", "description": "One paragraph an editor could follow to make a new video in this style."},
        "varies": {"type": "array", "items": {"type": "string"}},
        "cannot_reproduce": {"type": "array", "items": {"type": "string"}},
        "unsure": {"type": "array", "items": {"type": "string"}},
    },
}


def folder(pid: str) -> Path:
    return DATA / "profiles" / pid


def _frames(video: Path, duration: float, n: int, start: float = 0.0) -> list[tuple[float, bytes]]:
    """n JPEG stills spread across `duration` seconds from `start`, with their source times."""
    out = []
    for i in range(n):
        t = start + duration * (i + 0.5) / n
        r = subprocess.run([need("ffmpeg"), "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
                            "-vf", "scale='min(768,iw)':-2", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], capture_output=True)
        if r.returncode == 0 and r.stdout:
            out.append((t, r.stdout))
    return out


def measure(video: Path) -> dict:
    info = probe(video)
    if not info["has_video"]:
        raise MediaError(f"{video.name} has no video.")
    cuts = vision.detect_cuts(video, 0.0, info["duration"]) if info["duration"] > 1 else []
    return {"width": info["width"], "height": info["height"], "fps": info["fps"], "duration": info["duration"],
            "cuts": len(cuts), "shot_seconds": info["duration"] / (len(cuts) + 1)}


def nearest_aspect(w: int, h: int) -> str:
    options = {"9:16": 9 / 16, "3:4": 3 / 4, "4:5": 4 / 5, "1:1": 1.0, "16:9": 16 / 9}
    return min(options, key=lambda k: abs(options[k] - w / max(1, h)))


def style_from(analysis: dict | None, refs: list[dict], brand: dict) -> dict:
    """The part of a profile the editor applies to a clip (same shape as a template)."""
    from .spec import ASPECTS
    first = refs[0] if refs else {"width": 1080, "height": 1920, "fps": 30}
    aspect = (analysis or {}).get("canvas") or nearest_aspect(first["width"], first["height"])
    w, h = ASPECTS[aspect]
    style: dict = {"width": w, "height": h, "fps": 60 if first["fps"] > 45 else 30}
    if not analysis:
        return style
    c, pic, col = analysis["captions"], analysis["picture"], analysis["colour"]
    clamp = lambda v, lo, hi: max(lo, min(hi, float(v)))
    hexc = lambda v, d: v if re.fullmatch(r"#[0-9a-fA-F]{6}", str(v or "")) else d
    style["captions"] = {"visible": bool(c["present"]) and c["carry"] in ("speech", "narration"), "preset": c["look"], "font": c["font"],
                         "uppercase": bool(c["uppercase"]), "color": hexc(c["colour"], "#ffffff"), "highlight": hexc(c["highlight"], brand["accent"]),
                         "position": clamp(c["position"], 8, 92), "size": {"small": 64, "medium": 84, "large": 108}[c["size"]],
                         "maxWords": int(clamp(c["words_per_line"], 1, 7))}
    style["look"] = {"preset": "none", "bw": bool(col["black_and_white"]), "vignette": bool(col["vignette"]), "progressBar": any(e["type"] == "progress_bar" for e in analysis["elements"]),
                     "brightness": clamp(col["brightness"], 0.7, 1.4), "contrast": clamp(col["contrast"], 0.7, 1.4), "saturation": clamp(col["saturation"], 0, 1.8)}
    if pic["mode"] == "panel":
        style["frame"] = {"mode": "panel", "shape": pic["corners"], "width": 100 if pic["corners"] == "square" else 90, "aspect": 1.0,
                          "y": clamp(pic["box_position"], 25, 75), "bg": pic["background"]}
    style["brand"] = {"font": c["font"]}
    return style


def analyse(pid: str, job: Job) -> dict:
    """Measure every reference, then (with an AI key) have the model describe the style. Saves and returns the profile."""
    profile = profiles.get(pid)
    if not profile:
        raise MediaError("That style no longer exists.")
    files = [folder(pid) / r["file"] for r in profile.get("references", [])]
    files = [f for f in files if f.is_file()]
    if not files:
        raise MediaError("Add at least one reference video first.")
    refs = []
    for i, f in enumerate(files):
        job.update(0.05 + 0.4 * i / len(files), f"Measuring reference {i + 1} of {len(files)}")
        refs.append({"name": f.name, "file": f.name, "url": media_url(f), **measure(f)})

    analysis, note = None, ""
    if ai.available():
        per = max(3, min(FRAMES_PER_REFERENCE, MAX_FRAMES // len(files)))
        parts: list = [_analysis_request(refs)]
        if ai.watches_video():
            # Gemini can watch the references themselves, which adds motion, timing and sound to what the stills show.
            parts.append("The full videos are attached as well, in reference order. Use them for motion, timing and "
                         "sound; with them you may describe music, voice and sound effects, and need not list those as unsure.")
            parts += [{"video": f} for f in files if f.stat().st_size < 200 * 1024 * 1024]
        for i, (f, r) in enumerate(zip(files, refs)):
            job.update(0.45 + 0.15 * i / len(files), "Picking frames to study")
            for t, jpeg in _frames(f, r["duration"], per):
                parts.append(f"Reference {i + 1}, frame at {t:.1f}s:")
                parts.append({"image": jpeg})
        job.update(0.62, f"Studying the style with {ai.provider_label()}")
        try:
            analysis = ai.ask_json(ANALYSIS_SYSTEM, parts, ANALYSIS_SCHEMA, max_tokens=16000, effort="high")
        except ai.AIUnavailable as e:
            note = f"The AI step failed ({e}), so this style holds measurements only."
    else:
        note = "No AI key is set, so this style holds measurements only (shape, frame rate and pacing). Add a key and analyse again for captions, colours and rules."

    from ..config import get_settings
    known = {r["text"] for r in profile.get("rules", [])}
    learned = []
    if analysis:
        for kind in ("writing", "editing"):
            for text in analysis[f"{kind}_rules"]:
                if text.strip() and text not in known:
                    learned.append({"id": f"r{int(time.time() * 1000) % 10**9}{len(learned)}", "kind": kind, "text": text.strip(), "source": "references", "on": True})
    # rules the person wrote or approved are kept; rules from an earlier analysis are replaced
    kept = [r for r in profile.get("rules", []) if r.get("source") != "references"]
    patch = {"references": [{k: r[k] for k in ("name", "file", "url", "width", "height", "fps", "duration", "cuts", "shot_seconds")} for r in refs],
             "analysis": analysis, "note": note, "style": style_from(analysis, refs, get_settings()["brand"]),
             "rules": kept + learned, "brief": (analysis or {}).get("brief", ""), "analysed": time.time(), "engine": ai.provider_label() if analysis else ""}
    return profiles.update(pid, patch)


def lookup(profile_id: str | None) -> dict | None:
    """A built-in style or one of the person's own."""
    if not profile_id:
        return None
    from . import presets
    return presets.get(profile_id) or profiles.get(profile_id)


def guidance(profile_id: str | None) -> tuple[str, list[str]]:
    """(brief, active rules) to add to an AI request for a clip that uses this profile."""
    p = lookup(profile_id)
    if not p:
        return "", []
    return p.get("brief", ""), [r["text"] for r in p.get("rules", []) if r.get("on", True)]


RULE_SYSTEM = """\
You turn a creator's correction into one standing rule for their editing style. They have just fixed something in a \
video the program made, or told it what it got wrong. Write the rule as a single plain instruction that would prevent \
the same mistake in every future video: specific enough to act on, general enough to apply beyond this one clip. \
If the note is about wording, make it a writing rule; otherwise an editing rule. Do not mention this conversation."""
RULE_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["kind", "rule"],
               "properties": {"kind": {"type": "string", "enum": ["writing", "editing"]}, "rule": {"type": "string"}}}


def rule_from_note(profile: dict, note: str) -> dict:
    """Turn free-form feedback into a rule (kept as written when there is no AI key)."""
    if ai.available():
        try:
            existing = "\n".join(f"- {r['text']}" for r in profile.get("rules", [])) or "(none yet)"
            data = ai.ask_json(RULE_SYSTEM, f"The style so far:\n{profile.get('brief') or '(no description yet)'}\n\nRules already in place:\n{existing}\n\nThe correction:\n{note}",
                               RULE_SCHEMA, max_tokens=2000, effort="low")
            return {"kind": data["kind"], "text": data["rule"].strip()}
        except ai.AIUnavailable:
            pass
    return {"kind": "editing", "text": note.strip()}


# Fields compared when learning from a finished clip: (path, label, how to show a value)
_LEARN = [
    (("captions", "preset"), "Caption look", str), (("captions", "font"), "Caption font", str),
    (("captions", "size"), "Caption size", lambda v: f"{round(v)}"), (("captions", "position"), "Caption height on screen", lambda v: f"{round(v)}%"),
    (("captions", "x"), "Caption left-right position", lambda v: f"{round(v)}%"), (("captions", "color"), "Caption colour", str),
    (("captions", "highlight"), "Caption highlight colour", str), (("captions", "uppercase"), "Captions in capitals", lambda v: "yes" if v else "no"),
    (("captions", "maxWords"), "Words per caption line", str), (("captions", "lead"), "Caption lead time", lambda v: f"{round(v * 1000)} ms"),
    (("look", "preset"), "Colour look", str), (("look", "bw"), "Black and white", lambda v: "yes" if v else "no"),
    (("look", "brightness"), "Brightness", lambda v: f"{round(v * 100)}%"), (("look", "contrast"), "Contrast", lambda v: f"{round(v * 100)}%"),
    (("look", "saturation"), "Saturation", lambda v: f"{round(v * 100)}%"), (("look", "vignette"), "Vignette", lambda v: "yes" if v else "no"),
    (("look", "progressBar"), "Progress bar", lambda v: "yes" if v else "no"),
    (("brand", "font"), "Title font", str), (("brand", "accent"), "Accent colour", str), (("brand", "secondary"), "Title text colour", str),
    (("brand", "logoX"), "Logo position (across)", lambda v: f"{round(v)}%"), (("brand", "logoY"), "Logo position (down)", lambda v: f"{round(v)}%"),
    (("brand", "logoSize"), "Logo size", lambda v: f"{round(v)}%"), (("brand", "watermarkY"), "Watermark position (down)", lambda v: f"{round(v)}%"),
    (("hook", "y"), "Hook title height", lambda v: f"{round(v)}%"), (("hook", "scale"), "Hook title size", lambda v: f"{round(v * 100)}%"),
    (("width",), "Frame width", str), (("height",), "Frame height", str), (("fps",), "Frame rate", str),
]


def _get(d: dict, path: tuple) -> object:
    for key in path:
        if not isinstance(d, dict) or key not in d:
            return None
        d = d[key]
    return d


def differences(profile: dict, spec: dict) -> list[dict]:
    """What the person changed in a clip compared with the profile's style: candidates to make the new default."""
    style = profile.get("style") or {}
    out = []
    for path, label, show in _LEARN:
        now, was = _get(spec, path), _get(style, path)
        if now is None or now == was:
            continue
        if isinstance(now, float) and isinstance(was, (int, float)) and abs(now - was) < 0.011:
            continue
        out.append({"path": list(path), "label": label, "from": show(was) if was is not None else "not set", "to": show(now), "value": now})
    return out


def accept(pid: str, changes: list[dict]) -> dict:
    profile = profiles.get(pid)
    if not profile:
        raise MediaError("That style no longer exists.")
    style = dict(profile.get("style") or {})
    allowed = {tuple(p) for p, _, _ in _LEARN}
    for ch in changes:
        path = tuple(ch.get("path") or [])
        if path not in allowed:
            continue
        if len(path) == 1:
            style[path[0]] = ch["value"]
        else:
            style[path[0]] = {**(style.get(path[0]) or {}), path[1]: ch["value"]}
    return profiles.update(pid, {"style": style})
