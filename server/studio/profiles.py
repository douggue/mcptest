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
FRAMES_PER_REFERENCE = 14   # four across the opening, the rest spread over the video, plus the last moment
MAX_FRAMES = 60

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
The person who uploaded them wants their own videos to feel like these: the same framing, captions, on-screen text, \
effects, pacing and way of writing, with their own content and branding. Your report is the only description of the \
style the program and its AI writer will ever have, so anything you leave out is lost. Be specific and concrete: \
measured positions, exact colours, counted words, timed beats. "Bold captions at the bottom" is not enough; \
"white heavy condensed capitals, about 8% of the frame width tall, centred 70% down, two or three words at a time, \
the spoken word turning yellow" is.

What you are given: still frames with timestamps, sampled more densely over the first three seconds because the \
opening matters most, plus measurements the program took itself (size, length, how often the picture cuts). When the \
full videos are attached as well, the request says so.

Work through each reference in this order, then compare them.

1. Format and framing. The canvas shape. Whether the picture fills the frame or sits in a box, and what is behind the \
box. How large the main subject is in the frame (wide, medium, close) and where they sit. Whether the framing changes \
between shots, punches in, or follows the subject (compare the subject's size and position across frames).

2. The opening. Exactly what is on screen in the first frame and how it changes over the first three seconds: the \
hook text, any callout, flash or freeze. This is what stops a viewer scrolling, so describe it precisely.

3. On-screen text, one kind at a time. A style usually has several kinds of text that look different: a title, \
running captions, story labels, name tags, callout labels, a watermark. For each kind you see, describe the lettering \
(serif or sans, condensed or wide, weight, italic, capitals), its height as a share of the frame width, its fill \
colour, every accent colour and what that colour is used for, any outline, shadow, glow or box behind it, where it \
sits (how far down the frame, and left, centre or right), how many lines and words it holds, and how long one piece \
of text stays up (estimate from which frames it appears in). If consecutive frames show text arriving letter by \
letter, word by word, or all at once, say which.

4. Colour. The overall grade compared with ordinary footage: brighter or darker, more or less contrast and \
saturation, warm or cool. Any black-and-white passages, vignette, or frames washed in a single colour (a tint \
flash), and what each tint seems to mark.

5. Effects and graphics. Circles, arrows, spotlights that dim the surroundings, emoji, progress bars, borders, \
split screens, picture-in-picture, cutaway images. Two frames that are identical apart from the overlays suggest a \
freeze-frame. For each effect say when in the video it is used and for how long, as far as the frames show.

6. Structure and pacing. The beats of the story with rough times: how it opens, how tension builds, where the turn \
or payoff lands, how it ends, and whether there is an end card or closing animation. How long the videos run. Use \
the cut measurements for rhythm, and count how often the text changes.

7. Branding. Where a logo, watermark or channel header sits, how large and how opaque. Describe placement only; \
never copy another channel's name, handle or logo into the style.

8. Sound, only when the full videos are attached: music and its mood, sound effects and what triggers them, whether \
there is a narrator or only the original audio. From stills alone, say you cannot tell.

9. The writing. Read every piece of on-screen text. Work out how this creator writes: how the hook is phrased, how \
long lines are, capitals, punctuation, emoji, whether actions are marked (for example in asterisks), how the story \
is told (narrator, labels, dialogue), and how the ending lands. Quote a few short lines as examples.

Then compare the references. The style is what they have in common. Report shared choices as the style, list what \
differs between them under varies, and do not let one unusual reference change the style.

The style will be rebuilt with a fixed set of tools, listed in the request. Where the report asks for a choice from \
those tools, pick the closest and keep your own precise description alongside it. When a reference does something the \
tools cannot do, do not force it into the nearest tool: list it under cannot_reproduce so the person knows.

Stills cannot show motion, sound or exact timing. Say what you could not determine under unsure, and rate your \
confidence in each area honestly. A report that admits what it could not see is more useful than a confident guess.

Write every rule as a plain instruction that would still make sense to someone who never saw the references, and \
make each one specific enough to check a finished video against."""


WATCHING = """\
The full videos are attached as well, in reference order, with their sound. You see them at {fps} frames a second, so \
anything shorter than {gap} may fall between frames; the numbered stills further down are exact frames and are sharper, \
so read small text and colours from the stills and take motion, timing and sound from the videos.

Watch each video from start to finish before writing anything, then use it for what stills cannot show:

- Timing. Give the moment each thing happens in seconds from the start: when the hook text appears and leaves, when \
each caption or label changes, when every effect starts and how long it lasts. Fill in the timeline with these.
- Text animation. How each kind of text arrives and leaves: cut, fade, pop with overshoot, slide, typed letter by \
letter, or word by word in time with the voice. Whether the word being spoken changes colour or size.
- Transitions. How one shot becomes the next: hard cut, flash to white or a colour, dip to black, blur, zoom, whip, \
slide. Whether the picture is ever frozen, slowed down or sped up, and at what point in the story.
- Camera and crop. Whether the frame slowly pushes in, punches in on a beat, shakes, or follows the subject.
- Voice. Whether anyone speaks; whether it is the original sound, a narrator added afterwards, or a synthetic voice; \
the narrator's tone and pace (count roughly how many words are spoken in ten seconds); whether captions repeat the \
speech word for word or tell the story in different words.
- Music. Genre, mood and tempo, when it starts, where it rises, drops or cuts out, how loud it is against the voice.
- Sound effects. Each kind you hear (whoosh, pop, camera shutter, ding, riser, bass hit), and what on screen it lands on.

With the videos you can judge sound and motion, so do not list them under unsure unless a video failed to play."""


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
of the video or over black. A shot can also be split into two or three stacked crops, and the crop can follow a face.
Caption looks (for words that follow speech or narration):
{looks}
Fonts: {", ".join(FONTS)}.
Elements that can be placed anywhere and timed freely: label (free text; neon, in quotes, white with shadow, black \
box, or outline only; words can be coloured individually), nametag (short text with a pointer under it), circle, \
arrow, spotlight (dims everything outside an ellipse), flash (white or any colour), dip (to black), heart (ending \
animation), emoji.
Timing: freeze (hold a frame), speed_change (fast-forward or slow motion), zoom punch-ins, hard cuts.
Animated cards: keyword, counter, lowerthird, steps, broll (cutaway image or clip).
Always-on: progress_bar, logo, watermark, channel_header (profile picture, name and handle above a boxed video).
Colour: brightness, contrast and saturation adjustments, black and white, vignette.
Sound: background music that lowers under speech, sound effects on graphics, a voiceover track.

Give colours as #rrggbb. Give vertical positions as a percentage down the frame (0 is the top edge, 100 the bottom). \
Give text height as a percentage of the frame width. Give times in seconds from the start of the video."""


_TEXT_ROLE = {
    "type": "object", "additionalProperties": False,
    "required": ["role", "lettering", "nearest_font", "uppercase", "italic", "height_pct", "colour", "accents", "outline", "shadow_or_glow",
                 "box", "position", "align", "lines", "words_per_line", "arrives", "stays_seconds", "used_for"],
    "properties": {
        "role": {"type": "string", "enum": ["title", "captions", "story_label", "name_tag", "callout_label", "dialogue", "watermark", "other"]},
        "lettering": {"type": "string", "description": "The letterforms in words: serif or sans, condensed or wide, weight, any distinctive feature."},
        "nearest_font": {"type": "string", "enum": FONTS},
        "uppercase": {"type": "boolean"}, "italic": {"type": "boolean"},
        "height_pct": {"type": "number", "description": "Capital-letter height as a percentage of the frame width."},
        "colour": {"type": "string", "description": "Main fill colour, #rrggbb."},
        "accents": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["colour", "used_for"],
                                                "properties": {"colour": {"type": "string"}, "used_for": {"type": "string"}}}},
        "outline": {"type": "string", "description": "Colour and rough thickness, or 'none'."},
        "shadow_or_glow": {"type": "string", "description": "What sits behind the letters, or 'none'."},
        "box": {"type": "string", "description": "Any shape behind the text (colour, corners), or 'none'."},
        "position": {"type": "number"}, "align": {"type": "string", "enum": ["left", "centre", "right", "beside_subject"]},
        "lines": {"type": "integer"}, "words_per_line": {"type": "integer"},
        "arrives": {"type": "string", "enum": ["all_at_once", "word_by_word", "letter_by_letter", "pops", "fades", "unknown"]},
        "stays_seconds": {"type": "number", "description": "Roughly how long one piece of this text stays up; 0 if it stays for the whole video."},
        "used_for": {"type": "string", "description": "What this kind of text carries in the story, in one sentence."},
    },
}

ANALYSIS_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["summary", "canvas", "picture", "framing", "opening", "text_styles", "captions", "title", "palette", "elements", "colour",
                 "structure", "timeline", "transitions", "ending", "pacing", "branding", "sound", "writing_rules", "editing_rules", "example_lines", "brief",
                 "per_reference", "varies", "cannot_reproduce", "unsure", "confidence"],
    "properties": {
        "summary": {"type": "string", "description": "Three or four plain sentences describing the style as a whole."},
        "canvas": {"type": "string", "enum": ["9:16", "3:4", "4:5", "1:1", "16:9"]},
        "picture": {"type": "object", "additionalProperties": False, "required": ["mode", "corners", "background", "box_position", "box_width"],
                    "properties": {"mode": {"type": "string", "enum": ["full", "panel"]},
                                   "corners": {"type": "string", "enum": ["square", "rounded", "squircle"]},
                                   "background": {"type": "string", "enum": ["blur", "black"]},
                                   "box_position": {"type": "number", "description": "Centre of the box, % down the frame; 50 when the picture fills the frame."},
                                   "box_width": {"type": "number", "description": "Box width as % of the frame width; 100 when the picture fills the frame."}}},
        "framing": {"type": "object", "additionalProperties": False, "required": ["subject_size", "subject_position", "movement", "note"],
                    "properties": {"subject_size": {"type": "string", "enum": ["wide", "medium", "close", "mixed"]},
                                   "subject_position": {"type": "string"},
                                   "movement": {"type": "string", "enum": ["static", "follows_subject", "punch_ins", "constant_slow_zoom", "mixed", "unknown"]},
                                   "note": {"type": "string"}}},
        "opening": {"type": "string", "description": "What is on screen in the first frame and how the first three seconds unfold."},
        "text_styles": {"type": "array", "items": _TEXT_ROLE, "description": "One entry for each kind of on-screen text the style uses."},
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
        "palette": {"type": "array", "description": "Every recurring colour in text and effects, and what it signals.",
                    "items": {"type": "object", "additionalProperties": False, "required": ["colour", "meaning"],
                              "properties": {"colour": {"type": "string"}, "meaning": {"type": "string"}}}},
        "elements": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["type", "how", "when", "seconds"],
                                                 "properties": {"type": {"type": "string", "enum": ELEMENTS},
                                                                "how": {"type": "string", "description": "What it looks like and what it is used for in this style."},
                                                                "when": {"type": "string", "description": "Where in the video it appears, e.g. 'about 1.5s in, on the main person' or 'on each scene change'."},
                                                                "seconds": {"type": "number", "description": "Roughly how long it lasts each time."}}}},
        "colour": {"type": "object", "additionalProperties": False, "required": ["brightness", "contrast", "saturation", "black_and_white", "vignette", "note"],
                   "properties": {"brightness": {"type": "number", "description": "1 is unchanged; 0.7 to 1.4."},
                                  "contrast": {"type": "number"}, "saturation": {"type": "number"},
                                  "black_and_white": {"type": "boolean"}, "vignette": {"type": "boolean"},
                                  "note": {"type": "string", "description": "Warmth, tint flashes and anything else about the colour."}}},
        "structure": {"type": "array", "description": "The beats a typical video in this style goes through, in order.",
                      "items": {"type": "object", "additionalProperties": False, "required": ["beat", "from_seconds", "to_seconds", "on_screen"],
                                "properties": {"beat": {"type": "string"}, "from_seconds": {"type": "number"}, "to_seconds": {"type": "number"},
                                               "on_screen": {"type": "string", "description": "What the viewer sees and reads during this beat."}}}},
        "timeline": {"type": "array", "description": "Up to forty dated events from the references, in order: text appearing or changing, effects, freezes, speed changes, cuts that matter, music and sound cues.",
                     "items": {"type": "object", "additionalProperties": False, "required": ["reference", "at_seconds", "kind", "what"],
                               "properties": {"reference": {"type": "integer"}, "at_seconds": {"type": "number"},
                                              "kind": {"type": "string", "enum": ["text", "effect", "cut", "freeze", "speed", "zoom", "sound", "music", "voice", "other"]},
                                              "what": {"type": "string"}}}},
        "transitions": {"type": "string", "description": "How shots change and how text and graphics arrive and leave. 'Cannot tell from stills' if no video was attached."},
        "ending": {"type": "string", "description": "How the videos end: last text, closing animation, how abruptly."},
        "pacing": {"type": "string", "description": "Rhythm: typical length, how often the picture cuts and the text changes, any speed changes."},
        "branding": {"type": "string", "description": "Where logos, watermarks or a channel header sit, their size and opacity. Placement only, no names."},
        "sound": {"type": "object", "additionalProperties": False, "required": ["music", "effects", "voice", "words_per_minute", "captions_match_speech"],
                  "properties": {"music": {"type": "string", "description": "Genre, mood, tempo, where it rises or drops, level against the voice."},
                                 "effects": {"type": "string", "description": "Each kind of sound effect and what on screen it lands on."},
                                 "voice": {"type": "string", "description": "Original sound, added narrator or synthetic voice; tone and pace."},
                                 "words_per_minute": {"type": "number", "description": "Speaking pace; 0 if nobody speaks or it cannot be heard."},
                                 "captions_match_speech": {"type": "string", "enum": ["word_for_word", "paraphrase", "different_story", "no_speech", "unknown"]}}},
        "writing_rules": {"type": "array", "items": {"type": "string"}, "description": "Six to twelve rules about wording."},
        "editing_rules": {"type": "array", "items": {"type": "string"}, "description": "Six to twelve rules about how the edit is built."},
        "example_lines": {"type": "array", "items": {"type": "string"}, "description": "Up to six short on-screen lines quoted from the references."},
        "brief": {"type": "string", "description": "Two paragraphs an editor could follow to make a new video in this style, start to finish."},
        "per_reference": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["reference", "notes"],
                                                      "properties": {"reference": {"type": "integer"}, "notes": {"type": "string"}}}},
        "varies": {"type": "array", "items": {"type": "string"}},
        "cannot_reproduce": {"type": "array", "items": {"type": "string"}},
        "unsure": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "object", "additionalProperties": False, "required": ["layout", "text", "colour", "effects", "pacing", "writing"],
                       "properties": {k: {"type": "string", "enum": ["low", "medium", "high"]} for k in ("layout", "text", "colour", "effects", "pacing", "writing")}},
    },
}


FRAME_BUDGET = 600   # video frames Gemini is asked to look at across all references


def folder(pid: str) -> Path:
    return DATA / "profiles" / pid


def _frames(video: Path, duration: float, n: int, start: float = 0.0) -> list[tuple[float, bytes]]:
    """n JPEG stills spread across `duration` seconds from `start`, with their source times."""
    out = []
    for i in range(n):
        t = start + duration * (i + 0.5) / n   # with duration 0 this is exactly `start`
        r = subprocess.run([need("ffmpeg"), "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
                            "-vf", "scale='min(768,iw)':-2", "-q:v", "4", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], capture_output=True)
        if r.returncode == 0 and r.stdout:
            out.append((t, r.stdout))
    return out


def _study_frames(video: Path, duration: float, n: int) -> list[tuple[float, bytes]]:
    """Stills for style analysis: the first frame and the opening seconds in close-up, the body evenly, and the ending."""
    opening = [t for t in (0.1, 1.0, 2.0, 3.0) if t < duration * 0.5]
    tail = [max(0.0, duration - 0.4)]
    body_n = max(2, n - len(opening) - len(tail))
    body = [3.5 + (duration - 4.5) * (i + 0.5) / body_n for i in range(body_n)] if duration > 6 else [duration * (i + 0.5) / body_n for i in range(body_n)]
    out = []
    for t in sorted(set(round(x, 2) for x in opening + body + tail)):
        got = _frames(video, 0.0, 1, start=t)
        if got:
            out.append((t, got[0][1]))
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


def style_from(analysis: dict | None, refs: list[dict], brand: dict) -> tuple[dict, list[dict], str]:
    """From a report: (the style the editor applies, standing elements, which planner suits it)."""
    from .spec import ASPECTS
    first = refs[0] if refs else {"width": 1080, "height": 1920, "fps": 30}
    aspect = (analysis or {}).get("canvas") or nearest_aspect(first["width"], first["height"])
    w, h = ASPECTS[aspect]
    style: dict = {"width": w, "height": h, "fps": 60 if first["fps"] > 45 else 30}
    if not analysis:
        return style, [], "speech"
    c, pic, col = analysis["captions"], analysis["picture"], analysis["colour"]
    clamp = lambda v, lo, hi: max(lo, min(hi, float(v)))
    hexc = lambda v, d: v if re.fullmatch(r"#[0-9a-fA-F]{6}", str(v or "")) else d
    roles = {t["role"]: t for t in analysis.get("text_styles", [])}
    cap_text = roles.get("captions") or roles.get("story_label")
    # caption size in the editor is in px at a 1080-wide frame, roughly 1.45x the capital height
    size = clamp(cap_text["height_pct"] * 10.8 * 1.45, 40, 150) if cap_text and cap_text["height_pct"] > 0 else {"small": 64, "medium": 84, "large": 108}[c["size"]]
    spoken = bool(c["present"]) and c["carry"] in ("speech", "narration")
    style["captions"] = {"visible": spoken, "preset": c["look"], "font": c["font"], "uppercase": bool(c["uppercase"]),
                         "color": hexc(c["colour"], "#ffffff"), "highlight": hexc(c["highlight"], brand["accent"]),
                         "position": clamp(c["position"], 8, 92), "size": round(size), "maxWords": int(clamp(c["words_per_line"], 1, 7))}
    style["look"] = {"preset": "none", "bw": bool(col["black_and_white"]), "vignette": bool(col["vignette"]),
                     "progressBar": any(e["type"] == "progress_bar" for e in analysis["elements"]),
                     "brightness": clamp(col["brightness"], 0.7, 1.4), "contrast": clamp(col["contrast"], 0.7, 1.4), "saturation": clamp(col["saturation"], 0, 1.8)}
    if pic["mode"] == "panel":
        style["frame"] = {"mode": "panel", "shape": pic["corners"], "width": clamp(pic.get("box_width") or 90, 50, 100), "aspect": 1.0,
                          "y": clamp(pic["box_position"], 25, 75), "bg": pic["background"]}
    style["brand"] = {"font": (roles.get("title") or {}).get("nearest_font") or c["font"], "accent": hexc(c["highlight"], brand["accent"])}
    mark = roles.get("watermark")
    if mark:
        style["brand"]["watermarkY"] = clamp(mark["position"], 3, 98)
    elements: list[dict] = []
    title = analysis["title"]
    if title["present"] and title["stays_all_video"]:
        colour = hexc((title["colours"] or [None])[-1], style["brand"]["accent"])
        elements.append({"type": "label", "style": "plain", "color": colour, "text": "title", "at": "start", "duration": "all",
                         "dy": round(clamp(title["position"], 4, 96) - 50, 1), "scale": 1.0, "animation": "fade"})
    if any(e["type"] == "heart" for e in analysis["elements"]):
        elements.append({"type": "heart", "text": "", "at": "end", "duration": 2.2, "dy": -4})
    return style, elements, "speech" if spoken else "story"


def _brief(analysis: dict) -> str:
    """The brief the AI planners get: the model's own two paragraphs plus the timed specifics from the report."""
    parts = [analysis["brief"].strip()]
    if analysis.get("opening"):
        parts.append("Opening: " + analysis["opening"].strip())
    timed = [f"{e['type'].replace('_', ' ')} ({e['when']}; about {e['seconds']:g}s): {e['how']}" for e in analysis["elements"] if e.get("when")]
    if timed:
        parts.append("Elements and when to use them: " + " | ".join(timed))
    if analysis.get("palette"):
        parts.append("Colours: " + "; ".join(f"{p['colour']} for {p['meaning']}" for p in analysis["palette"]))
    if analysis.get("structure"):
        parts.append("Beats: " + " -> ".join(f"{b['beat']} ({b['from_seconds']:g}-{b['to_seconds']:g}s)" for b in analysis["structure"]))
    if analysis.get("transitions") and "cannot tell" not in analysis["transitions"].lower():
        parts.append("Transitions: " + analysis["transitions"].strip())
    if analysis.get("ending"):
        parts.append("Ending: " + analysis["ending"].strip())
    sound = analysis.get("sound") or {}
    heard = [f"{k}: {sound[k].strip()}" for k in ("music", "effects", "voice") if sound.get(k) and "cannot" not in sound[k].lower()]
    if heard:
        parts.append("Sound: " + "; ".join(heard))
    return "\n".join(parts)


def analyse(pid: str, job: Job, use: str = "") -> dict:
    """Measure every reference, then have the chosen AI (`use`; '' = the one set for references) describe the style.
    Each AI's study is kept under its own name (analysis_by), so studies by different AIs can be compared and
    switched; the newest becomes the style's look. Saves and returns the profile."""
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
    key = use or ai.current_key("references")
    who = ai.label_for(key) if use else ai.provider_label("references")
    if (use and any(c["key"] == use and c["ready"] for c in ai.ai_choices())) or (not use and ai.available("references")):
        per = max(6, min(FRAMES_PER_REFERENCE, MAX_FRAMES // len(files)))
        parts: list = [_analysis_request(refs)]
        if (any(c["key"] == use and c["watches_video"] for c in ai.ai_choices()) if use else ai.watches_video("references")):
            # Gemini can watch the references themselves, which adds motion, timing and sound to what the stills show.
            # It looks at one frame a second by default; short-form edits change faster than that, so ask for more
            # while keeping the whole request to about FRAME_BUDGET frames.
            small = [(f, r) for f, r in zip(files, refs) if f.stat().st_size < 200 * 1024 * 1024]
            total = sum(r["duration"] for _, r in small) or 1.0
            fps = max(1.0, min(4.0, round(FRAME_BUDGET / total * 2) / 2))
            if small:
                parts.append(WATCHING.format(fps=f"{fps:g}", gap="a second" if fps <= 1 else f"1/{fps:g} of a second"))
                parts += [{"video": f, "fps": fps if fps > 1 else None} for f, _ in small]
        for i, (f, r) in enumerate(zip(files, refs)):
            job.update(0.45 + 0.15 * i / len(files), "Picking frames to study")
            for t, jpeg in _study_frames(f, r["duration"], per):
                parts.append(f"Reference {i + 1}, frame at {t:.1f}s:")
                parts.append({"image": jpeg})
        job.update(0.62, f"Studying the style with {who}")
        try:
            analysis = ai.ask_with(use, ANALYSIS_SYSTEM, parts, ANALYSIS_SCHEMA, max_tokens=32000, effort="high", task="references")
            analysis.pop("_watched", None)
        except ai.AIUnavailable as e:
            note = f"The AI step failed ({e}), so this style holds measurements only."
    else:
        note = "No AI is set up, so this style holds measurements only (shape, frame rate and pacing). Set one up under Settings → AI and study it again for captions, colours and rules."

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
    style, elements, planner = style_from(analysis, refs, get_settings()["brand"])
    was = {r.get("file"): r for r in profile.get("references", [])}
    patch = {"references": [{**{k: r[k] for k in ("name", "file", "url", "width", "height", "fps", "duration", "cuts", "shot_seconds")},
                             "name": was.get(r["file"], {}).get("name") or r["name"], "source_url": was.get(r["file"], {}).get("source_url", "")}
                            for r in refs],
             "analysis": analysis, "note": note, "style": style, "elements": elements, "planner": planner,
             "summary": (analysis or {}).get("summary", profile.get("summary", "")),
             "rules": kept + learned, "brief": _brief(analysis) if analysis else profile.get("brief", ""),
             "analysed": time.time(), "engine": who if analysis else ""}
    if analysis:
        # keep this AI's study next to the others', so the style can be switched back to it
        by = dict(profile.get("analysis_by") or {})
        by[key] = {k: patch[k] for k in ("analysis", "style", "elements", "planner", "summary", "brief", "analysed", "engine")}
        by[key]["learned"] = learned
        patch.update(analysis_by=by, analysis_from=key)
    return profiles.update(pid, patch)


def use_analysis(pid: str, key: str) -> dict:
    """Make the style follow the study one AI made earlier: its look, brief and learned rules."""
    profile = profiles.get(pid)
    if not profile:
        raise MediaError("That style no longer exists.")
    a = (profile.get("analysis_by") or {}).get(key)
    if not a:
        raise MediaError("That AI has not studied this style yet.")
    kept = [r for r in profile.get("rules", []) if r.get("source") != "references"]
    patch = {k: a[k] for k in ("analysis", "style", "elements", "planner", "summary", "brief", "analysed", "engine")}
    patch.update(rules=kept + list(a.get("learned") or []), analysis_from=key)
    return profiles.update(pid, patch)


# A built-in style's definition lives in code, but its saved reference videos and what the AI noticed in them
# (its memory) are the person's, so they are kept here, keyed by the style's id.
state = Collection("style_state")
STATE_KEYS = ("references", "memory", "reviewed", "review_note", "review_engine", "memory_by", "memory_from")


def is_builtin(pid: str) -> bool:
    from . import presets
    return presets.get(pid) is not None


def lookup(profile_id: str | None) -> dict | None:
    """A built-in style (with its saved references and memory) or one of the person's own."""
    if not profile_id:
        return None
    from . import presets
    base = presets.get(profile_id)
    if base:
        saved = state.get(profile_id) or {}
        return {**base, **{k: saved[k] for k in STATE_KEYS if k in saved}}
    return profiles.get(profile_id)


def save(pid: str, patch: dict) -> dict:
    """Update a style's references or memory, built-in or not. Returns the style as lookup() gives it."""
    if is_builtin(pid):
        if state.get(pid):
            state.update(pid, patch)
        else:
            state.insert({"id": pid, **patch})
    else:
        profiles.update(pid, patch)
    return lookup(pid)


def guidance(profile_id: str | None) -> tuple[str, list[str]]:
    """(brief, active rules) to add to an AI request for a clip that uses this profile. What the AI noticed when it
    last reviewed the style's reference videos goes along as rules too, so every request carries that memory."""
    p = lookup(profile_id)
    if not p:
        return "", []
    rules = [r["text"] for r in p.get("rules", []) if r.get("on", True)]
    rules += [f"Seen in this style's reference videos: {m}" for m in p.get("memory") or []]
    return p.get("brief", ""), rules


# ---------------------------------------------------------------- reference videos: saved, reviewed, shown again

def add_reference_file(pid: str, path: Path, name: str = "", source_url: str = "") -> dict:
    """Record a video already in the style's folder as one of its references, with its measurements."""
    p = lookup(pid) or {}
    try:
        m = measure(path)
    except MediaError:
        m = {}
    row = {"name": name or path.stem, "file": path.name, "url": media_url(path), "source_url": source_url, **m}
    refs = [r for r in p.get("references") or [] if r.get("file") != path.name and (not source_url or r.get("source_url") != source_url)]
    return save(pid, {"references": refs + [row]})


def download_reference(pid: str, url: str, name: str, job: Job, span: tuple[float, float] = (0.0, 1.0)) -> dict:
    """Download one reference video into the style's folder (so it is kept), and record it."""
    import shutil
    from .sources import download
    file, info = download(url, 1080, job)
    out = folder(pid)
    out.mkdir(parents=True, exist_ok=True)
    from ..media import safe_name, unique_path
    dest = unique_path(out, safe_name(name or info.get("title") or "reference", "reference"), file.suffix.lstrip("."))
    shutil.move(str(file), str(dest))
    return add_reference_file(pid, dest, name or info.get("title") or dest.stem, url)


def download_missing(pid: str, job: Job) -> dict:
    """Download every reference link the style lists that is not saved yet, then review them all.
    A link that fails is reported and skipped; the others still download."""
    p = lookup(pid)
    if not p:
        raise MediaError("That style no longer exists.")
    have = {r.get("source_url") for r in p.get("references") or []}
    todo = [l for l in p.get("reference_links") or [] if l["url"] not in have]
    failed = []
    for i, link in enumerate(todo):
        job.update(0.02 + 0.6 * i / max(1, len(todo)), f"Downloading reference {i + 1} of {len(todo)}: {link['title']}")
        try:
            download_reference(pid, link["url"], link["title"], job)
        except MediaError as e:
            failed.append(f"{link['title']}: {e}")
    note = ("Could not download " + "; ".join(failed)) if failed else ""
    if (lookup(pid) or {}).get("references") and ai.available("references"):
        review(pid, job, (0.65, 1.0))
    p = save(pid, {"review_note": note} if note else {})
    return p


REVIEW_SYSTEM = """You keep an editor's memory of a video style fresh. You are shown frames from the style's reference videos (finished shorts made in the style) together with the style's written description and rules. Look at the references again and write down the concrete things an editor must match that the description leaves out or gets only roughly: sizes, positions, colours, how text arrives and leaves, timings, framing, pacing, what the first frame shows, how videos end. Be specific and measurable; one fact per line. Then list where the references contradict the description. Describe the craft only: never copy their wording, names, channel names, watermarks or logos into a line."""
REVIEW_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["memory", "contradictions"],
                 "properties": {"memory": {"type": "array", "items": {"type": "string"}},
                                "contradictions": {"type": "array", "items": {"type": "string"}}}}


def _reference_files(p: dict) -> list[tuple[dict, Path]]:
    pid = p["id"]
    out = []
    for r in p.get("references") or []:
        f = folder(pid) / r["file"]
        if f.is_file():
            out.append((r, f))
    return out


def review(pid: str, job: Job, span: tuple[float, float] = (0.0, 1.0), use: str = "") -> dict:
    """Have an AI (`use`; '' = the one set for references) look at the saved references again and store what it
    noticed as the style's memory. Each AI keeps its own notes (memory_by); the newest review becomes the memory
    used, and the person can switch to another AI's notes."""
    p = lookup(pid)
    if not p:
        raise MediaError("That style no longer exists.")
    files = _reference_files(p)
    if not files:
        raise MediaError("This style has no saved reference videos yet.")
    key = use or ai.current_key("references")
    who = ai.label_for(key) if use else ai.provider_label("references")
    if not use and not ai.available("references"):
        raise ai.AIUnavailable("Reviewing reference videos needs the AI. " + ai.setup_hint())
    watches = any(c["key"] == use and c["watches_video"] for c in ai.ai_choices()) if use else ai.watches_video("references")
    per = max(4, min(10, 48 // len(files)))
    rules = "\n".join(f"- {r['text']}" for r in p.get("rules", []) if r.get("on", True))
    parts: list = [f"The style: {p.get('name')}\n\nIts description:\n{p.get('brief', '')}\n\nIts rules:\n{rules or '(none)'}\n\n"
                   f"{len(files)} reference videos follow, as frames with their times."]
    for i, (r, f) in enumerate(files):
        job.update(span[0] + (span[1] - span[0]) * 0.5 * i / len(files), f"Looking at reference {i + 1} of {len(files)} again")
        dur = r.get("duration") or probe(f)["duration"]
        if watches:   # the whole video, with its motion, timing and sound
            parts.append(f"Reference {i + 1}, the whole video:")
            parts.append({"video": f})
        for t, jpeg in _study_frames(f, dur, per):
            parts.append(f"Reference {i + 1}, frame at {t:.1f}s:")
            parts.append({"image": jpeg})
    job.update(span[0] + (span[1] - span[0]) * 0.6, f"Reviewing the references with {who}")
    out = ai.ask_with(use, REVIEW_SYSTEM, parts, REVIEW_SCHEMA, max_tokens=8000, effort="medium", task="references")
    memory = [m.strip() for m in out["memory"] if m.strip()][:20]
    note = ("The references differ from the description: " + " ".join(out["contradictions"])) if out["contradictions"] else ""
    if out.get("_watched") == "frames":
        note = ("The whole videos could not be watched this time, so the review used still frames (no motion or sound). " + note).strip()
    entry = {"memory": memory, "reviewed": time.time(), "review_note": note, "review_engine": who}
    by = dict((lookup(pid) or {}).get("memory_by") or {})
    by[key or "ai"] = entry
    return save(pid, {**entry, "memory_by": by, "memory_from": key or "ai"})


def use_memory(pid: str, key: str) -> dict:
    """Use the notes one AI made when it last reviewed the references."""
    entry = ((lookup(pid) or {}).get("memory_by") or {}).get(key)
    if not entry:
        raise MediaError("That AI has not reviewed these references yet.")
    return save(pid, {**entry, "memory_from": key})


def reference_frames(pid: str | None, n: int = 8) -> list[tuple[str, bytes]]:
    """A few stills from the style's saved references, shown to the AI with every plan so it looks at them again."""
    p = lookup(pid)
    if not p:
        return []
    files = _reference_files(p)[:4]
    if not files:
        return []
    out = []
    per = max(2, n // len(files))
    for i, (r, f) in enumerate(files):
        dur = r.get("duration") or 0
        if not dur:
            try:
                dur = probe(f)["duration"]
            except MediaError:
                continue
        for t, jpeg in _frames(f, max(0.1, dur - 0.5), per, start=0.2):
            out.append((f"Reference {i + 1} at {t:.1f}s", jpeg))
    return out[:n]


def limits(profile_id: str | None) -> dict | None:
    """What the planners may add for this style (graphic types, sound effects, emoji, a timed opening title,
    freezes, speed changes). None means no limits, as for styles learned from references."""
    p = lookup(profile_id)
    if not p or not p.get("limits"):
        return None
    return {**p["limits"], "camera_on": list((p.get("audio") or {}).get("camera_on") or [])}


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
    dragged = {("captions", "x"), ("captions", "lead"), ("brand", "logoX"), ("brand", "logoY"), ("brand", "watermarkY"), ("hook", "y"), ("hook", "scale")}
    for path, label, show in _LEARN:
        now, was = _get(spec, path), _get(style, path)
        if now is None or now == was:
            continue
        if was is None and path not in dragged:
            continue   # the style never set this, so a difference says nothing about the person's taste
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
