"""Generation through Google AI Studio: images, clips, narration, and whole videos from a script.

All of it is billed by Google per use, so the paid, slow one (video) must be confirmed by the caller.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import jobs
from ..media import MediaError
from ..studio import generate

router = APIRouter(prefix="/api/generate", tags=["generate"])


def _text(body: dict, key: str, limit: int) -> str:
    value = str(body.get(key) or "").strip()
    if len(value) > limit:
        raise HTTPException(422, f"That is too long (limit {limit:,} characters).")
    return value


def _aspect(body: dict, default: str = "9:16") -> str:
    aspect = str(body.get("aspect") or default)
    if aspect not in generate.ASPECT_SIZES:
        raise HTTPException(422, f"Unknown shape '{aspect}'. Use one of: {', '.join(generate.ASPECT_SIZES)}.")
    return aspect


@router.get("/options")
def get_options(live: bool = False) -> dict:
    """Current model and voice choices, suggestions, and (with live=true) what this key can really use."""
    try:
        return generate.options(live)
    except MediaError as e:
        raise HTTPException(422, str(e))


@router.put("/options")
def put_options(body: dict) -> dict:
    return generate.save_options(body)


@router.post("/image")
def make_image(body: dict) -> dict:
    """{prompt, aspect?, model?} -> job -> library row {name, label, url, size, type, id}"""
    prompt = _text(body, "prompt", 4000)
    if not prompt:
        raise HTTPException(422, "Describe the image first.")
    aspect = _aspect(body)
    model = _text(body, "model", 120) or None
    return {"job_id": jobs.submit("gen-image", "Generating image", lambda job: generate.image(prompt, aspect, job, model)).id}


@router.post("/video")
def make_video(body: dict) -> dict:
    """{prompt, aspect?, seconds?, model?, image_url?, confirm: true} -> job -> library row (+ note)"""
    if body.get("confirm") is not True:
        raise HTTPException(422, "Video generation is billed by Google per clip. Confirm before starting.")
    prompt = _text(body, "prompt", 4000)
    image_url = _text(body, "image_url", 600) or None
    if not prompt and not image_url:
        raise HTTPException(422, "Describe the clip first.")
    aspect = _aspect(body)
    seconds = body.get("seconds")
    try:
        seconds = float(seconds) if seconds not in (None, "", 0) else None
    except (TypeError, ValueError):
        raise HTTPException(422, "Length must be a number of seconds.")
    if seconds is not None and not 1 <= seconds <= 60:
        raise HTTPException(422, "Length must be between 1 and 60 seconds.")
    model = _text(body, "model", 120) or None
    return {"job_id": jobs.submit("gen-video", "Generating clip",
                                  lambda job: generate.video(prompt, aspect, seconds, job, model, image_url)).id}


@router.post("/speech")
def make_speech(body: dict) -> dict:
    """{text, provider?: 'gemini'|'edge', voice?, style?, model?} -> job -> library row (+ duration)"""
    text = _text(body, "text", 40000)
    if not text:
        raise HTTPException(422, "Write the narration first.")
    provider = "edge" if body.get("provider") == "edge" else "gemini"
    voice, style, model = _text(body, "voice", 80) or None, _text(body, "style", 300) or None, _text(body, "model", 120) or None
    return {"job_id": jobs.submit("gen-speech", "Generating voiceover",
                                  lambda job: generate.speech(text, job, provider, voice, style, model)).id}


@router.post("/from-script")
def make_from_script(body: dict) -> dict:
    """{topic?, script?, aspect?, seconds?, provider?, voice?, voice_style?, image_style?, max_images?, rules?[]}
    -> job -> {project_id, clip_id, title, beats, images, seconds, note}"""
    topic, script = _text(body, "topic", 600), _text(body, "script", 60000)
    if not topic and not script:
        raise HTTPException(422, "Give a topic or paste a script.")
    clean = {
        "topic": topic, "script": script, "aspect": _aspect(body),
        "provider": "edge" if body.get("provider") == "edge" else "gemini",
        "voice": _text(body, "voice", 80), "voice_style": _text(body, "voice_style", 300),
        "image_style": _text(body, "image_style", 300),
        "rules": [str(r)[:300] for r in (body.get("rules") or []) if isinstance(r, str)][:40],
    }
    try:
        clean["seconds"] = max(10.0, min(1800.0, float(body["seconds"]))) if body.get("seconds") else None
        clean["max_images"] = max(1, min(60, int(body.get("max_images") or 12)))
    except (TypeError, ValueError):
        raise HTTPException(422, "Length and image count must be numbers.")
    return {"job_id": jobs.submit("gen-script", "Creating video from script", lambda job: generate.from_script(clean, job)).id}
