"""Generating media through Google AI Studio (the Gemini key): still images, short video clips, narration,
and whole "faceless" videos assembled from a script.

Everything here is billed by Google per use. Model names change often, so every model is a setting and the
live list can be loaded from the user's own key.
"""
from __future__ import annotations

import base64
import re
import shutil
import time
import wave
from pathlib import Path

from ..config import DATA, gemini_key, get_settings, media_path, save_settings
from ..jobs import Cancelled, Job
from ..media import MediaError, ffmpeg, probe, safe_name, unique_path
from ..store import new_id
from . import ai

ASPECT_SIZES = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350), "3:4": (1080, 1440)}
# Shapes the image models accept through generate_content; anything else is mapped to the nearest.
IMAGE_ASPECTS = ("1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9")
SETTING_KEYS = ("gen_image_model", "gen_tts_model", "gen_tts_voice", "gen_music_model")
VIDEO_MODEL = "gemini-omni-1.2-flash"   # the only video model Cutroom uses

# Names taken from Google's own cookbook (github.com/google-gemini/cookbook). Google renames and retires models often,
# so every model is free text in Settings and "Load list" asks Google what the key can really use.
KNOWN_MODELS = {
    "image": [
        {"id": "gemini-3.1-flash-lite-image", "label": "Nano Banana 2 Lite (fastest, cheapest, has a free tier)"},
        {"id": "gemini-3.1-flash-image", "label": "Nano Banana 2 (general purpose, up to 4K)"},
        {"id": "gemini-nano-banana-2.1", "label": "Nano Banana 2.1 (higher fidelity)"},
        {"id": "gemini-3-pro-image-preview", "label": "Nano Banana Pro (best text in images, 4K)"},
    ],
    "video": [
        {"id": "gemini-omni-1.2-flash", "label": "Gemini Omni 1.2 Flash (3 to 15 s, with sound)"},
    ],
    "tts": [
        {"id": "gemini-3.8-flash-tts", "label": "Gemini 3.8 Flash TTS"},
        {"id": "gemini-3.8-flash-lite-tts", "label": "Gemini 3.8 Flash Lite TTS (cheaper)"},
    ],
    "music": [
        {"id": "lyria-3-clip-preview", "label": "Lyria 3 Clip (30-second clips and loops)"},
        {"id": "lyria-3.5", "label": "Lyria 3.5 (full songs up to 3 minutes)"},
        {"id": "lyria-3-pro-preview", "label": "Lyria 3 Pro (full songs)"},
    ],
}
# Some of the thirty prebuilt voices; the field is free text, so any other can be typed in.
KNOWN_VOICES = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Enceladus", "Zephyr", "Leda", "Orus"]
EDGE_VOICES = ["en-US-GuyNeural", "en-US-JennyNeural", "en-US-AriaNeural", "en-GB-RyanNeural", "en-GB-SoniaNeural"]
# Clip lengths Omni accepts, from Google's documentation.
OMNI_SECONDS = (3, 15)

_DECLINED = {"SAFETY", "IMAGE_SAFETY", "PROHIBITED_CONTENT", "IMAGE_PROHIBITED_CONTENT", "BLOCKLIST", "SPII",
             "RECITATION", "IMAGE_RECITATION", "LANGUAGE"}


# ---------------------------------------------------------------- shared plumbing

def _client():
    if not gemini_key():
        raise MediaError("Add a Gemini API key under Settings → AI first.")
    try:
        return ai._gemini_client()
    except ai.AIUnavailable as e:
        raise MediaError(str(e)) from e


class _Shim(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code, self.message = code, message


def _status(e: Exception) -> int | None:
    """HTTP status of an SDK error; the two halves of the SDK name it differently."""
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    return code if isinstance(code, int) else None


def _error(e: Exception, model: str) -> MediaError:
    """One readable message for whatever the SDK raised."""
    if isinstance(e, MediaError):
        return e
    message = str(getattr(e, "message", "") or e)
    if _status(e) == 404 and "API key" not in message:
        return MediaError(f"Google does not know the model '{model}'. Model names change often: press Load list on the "
                          "Generate page and pick another." if model else "Google could not find that. Try again.")
    return MediaError(str(ai._gemini_error(_Shim(_status(e), message), model)))


def _can_fall_back(e: Exception) -> bool:
    """A 400 that is not about the key usually means "this model does not take this kind of request"."""
    return _status(e) == 400 and "API key" not in str(getattr(e, "message", "") or e)


def _inline(response, kind: str) -> tuple[bytes, str]:
    """The first inline `kind/` part of a generate_content response, or a readable error."""
    feedback = response.prompt_feedback
    if feedback is not None and feedback.block_reason:
        raise MediaError("Google declined this prompt. Try rewording it.")
    reason = ""
    for cand in response.candidates or []:
        reason = getattr(cand.finish_reason, "name", str(cand.finish_reason or "")) or reason
        for part in (cand.content.parts if cand.content and cand.content.parts else []):
            blob = part.inline_data
            if blob is not None and blob.data and (blob.mime_type or "").startswith(kind):
                data = blob.data if isinstance(blob.data, (bytes, bytearray)) else base64.b64decode(blob.data)
                return bytes(data), blob.mime_type or ""
    if reason in _DECLINED:
        raise MediaError("Google declined this prompt. Try rewording it.")
    raise MediaError("Nothing came back from the model. Try rewording the prompt, or pick another model.")


def _content_bytes(content, model: str) -> tuple[bytes, str]:
    """Bytes of an Interactions output block (inline data, or a file to download)."""
    if content is None:
        raise MediaError("Nothing came back from the model. Try again, or pick another model.")
    mime = str(content.mime_type or "")
    if content.data:
        return base64.b64decode(content.data), mime
    if content.uri:
        return _download(content.uri, model), mime
    raise MediaError("The model finished but returned no file.")


def _download(uri: str, model: str) -> bytes:
    client = _client()
    from google.genai import types
    try:
        data = client.files.download(file=types.Video(uri=uri))
        if data:
            return bytes(data)
    except Exception:
        pass   # not a Files API address; fetch it directly below
    host = re.sub(r"^https://([^/]+)/.*$", r"\1", uri)
    if not uri.startswith("https://") or not host.endswith((".googleapis.com", ".google.com", ".googleusercontent.com")):
        raise MediaError("The generated file is at an address Cutroom will not fetch.")
    import urllib.request
    try:
        # the key goes only to the API's own host; any other Google storage link is fetched without it
        headers = {"x-goog-api-key": gemini_key()} if host == "generativelanguage.googleapis.com" else {}
        req = urllib.request.Request(uri, headers=headers)
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.read()
    except Exception as e:
        raise MediaError(f"Could not download the generated file: {e}") from e


def _interaction_failed(it) -> MediaError:
    detail = next((x.message for x in (it.errors or []) if x.message), "")
    if any((x.code or "").upper() in _DECLINED for x in (it.errors or [])) or "safety" in detail.lower():
        return MediaError("Google declined this prompt. Try rewording it.")
    return MediaError(f"Generation {it.status}: {detail}" if detail else f"Generation ended as '{it.status}'.")


def _row(kind: str, path: Path) -> dict:
    from ..routers.library import _row as row
    return row(kind, path)


def _image_aspect(aspect: str) -> str:
    if aspect in IMAGE_ASPECTS:
        return aspect
    return "1:1"


# ---------------------------------------------------------------- images

def image_bytes(prompt: str, aspect: str, model: str | None = None) -> tuple[bytes, str]:
    """One generated image as (bytes, mime type)."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise MediaError("Describe the image first.")
    client = _client()
    from google.genai import types
    model = model or get_settings().get("gen_image_model") or KNOWN_MODELS["image"][0]["id"]
    if model.lower().startswith("imagen"):
        return _imagen(client, model, prompt, aspect)
    try:
        response = client.models.generate_content(
            model=model, contents=prompt,
            config=types.GenerateContentConfig(response_modalities=["TEXT", "IMAGE"],
                                               image_config=types.ImageConfig(aspect_ratio=_image_aspect(aspect))))
        return _inline(response, "image/")
    except MediaError:
        raise
    except Exception as first:
        if not _can_fall_back(first):
            raise _error(first, model) from first
        try:   # some models only answer through the newer Interactions endpoint
            it = client.interactions.create(model=model, input=prompt, response_modalities=["image"],
                                            response_format={"type": "image", "aspect_ratio": _image_aspect(aspect)})
            if it.status not in (None, "completed"):
                raise _interaction_failed(it)
            return _content_bytes(it.output_image, model)
        except MediaError:
            raise
        except Exception:
            raise _error(first, model) from first


def _imagen(client, model: str, prompt: str, aspect: str) -> tuple[bytes, str]:
    """Imagen's own endpoint, kept only for someone who types an Imagen model name."""
    from google.genai import types
    shape = aspect if aspect in ("1:1", "3:4", "4:3", "9:16", "16:9") else {"4:5": "3:4", "5:4": "4:3"}.get(aspect, "1:1")
    try:
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")   # the SDK marks this method as deprecated
            response = client.models.generate_images(
                model=model, prompt=prompt, config=types.GenerateImagesConfig(number_of_images=1, aspect_ratio=shape))
    except ValueError as e:   # this SDK version refuses the method for an AI Studio key
        raise MediaError("Imagen models cannot be used with an AI Studio key here. Press Load list and pick a Gemini image model.") from e
    except Exception as e:
        raise _error(e, model) from e
    for item in response.generated_images or []:
        if item.image is not None and item.image.image_bytes:
            return bytes(item.image.image_bytes), item.image.mime_type or "image/png"
        if item.rai_filtered_reason:
            raise MediaError("Google declined this prompt. Try rewording it.")
    raise MediaError("Nothing came back from the model. Try rewording the prompt, or pick another model.")


def image(prompt: str, aspect: str, job: Job, model: str | None = None) -> dict:
    job.update(0.15, "Asking Google for an image")
    data, mime = image_bytes(prompt, aspect, model)
    ext = {"image/jpeg": "jpg", "image/webp": "webp"}.get(mime, "png")
    out = unique_path(DATA / "assets" / "broll", safe_name(prompt[:48], "image"), ext)
    out.write_bytes(data)
    return _row("broll", out)


# ---------------------------------------------------------------- speech

def _wav(pcm: bytes, rate: int, out: Path) -> None:
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)


def _chunks(text: str, limit: int = 2400) -> list[str]:
    """Split long narration at sentence ends so each request stays small."""
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return [text]
    out, cur = [], ""
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        if cur and len(cur) + len(sentence) + 1 > limit:
            out.append(cur)
            cur = sentence
        else:
            cur = f"{cur} {sentence}".strip()
    if cur:
        out.append(cur)
    return out


def _save_audio(data: bytes, mime: str, dest: Path, rate: int = 24000) -> Path:
    """Write returned audio next to `dest` with the right suffix. Complete WAV files start with RIFF; bare samples
    (audio/L16) are wrapped so players can open them."""
    mime = (mime or "").lower()
    if data[:4] == b"RIFF":
        out = dest.with_suffix(".wav")
    elif data[:3] == b"ID3" or "mp3" in mime or "mpeg" in mime:
        out = dest.with_suffix(".mp3")
    elif data[:4] == b"OggS" or "ogg" in mime or "opus" in mime:
        out = dest.with_suffix(".ogg")
    elif data[:4] == b"fLaC" or "flac" in mime:
        out = dest.with_suffix(".flac")
    elif "l16" in mime or "pcm" in mime or not mime:
        m = re.search(r"rate=(\d+)", mime)
        out = dest.with_suffix(".wav")
        _wav(data, int(m.group(1)) if m else rate, out)
        return out
    else:
        out = dest.with_suffix(".m4a" if "mp4" in mime or "aac" in mime else ".wav")
    out.write_bytes(data)
    return out


def _gemini_speech(text: str, dest: Path, voice: str, style: str, model: str) -> Path:
    """Speak one chunk into `dest` (suffix is set from what comes back). Returns the file written.

    The 3.8 speech models read `text` aloud exactly as written, so the delivery ("calm and warm", an accent, a pace)
    travels separately as speech_metadata; putting it in the text would make the voice read the instruction out.
    """
    client = _client()
    from google.genai import types
    style = (style or "").strip()
    turn: dict = {"type": "text", "text": text}
    if style:
        turn["annotations"] = [{"type": "speech_metadata", "style": style}]
    try:
        it = client.interactions.create(model=model, input=[turn], response_format={"type": "audio"},
                                        generation_config={"speech_config": [{"voice": voice}]})
        if it.status not in (None, "completed"):
            raise _interaction_failed(it)
        data, mime = _content_bytes(it.output_audio, model)
    except MediaError:
        raise
    except Exception as first:
        if not _can_fall_back(first):
            raise _error(first, model) from first
        try:   # older speech models answer through generate_content and take the delivery as a prefix
            response = client.models.generate_content(
                model=model, contents=f"{style.rstrip(':')}: {text}" if style and "3.8" not in model else text,
                config=types.GenerateContentConfig(
                    response_modalities=["AUDIO"],
                    speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)))))
            data, mime = _inline(response, "audio/")
        except MediaError:
            raise
        except Exception:
            raise _error(first, model) from first
    return _save_audio(data, mime, dest)


def _edge_speech(text: str, dest: Path, voice: str) -> Path:
    try:
        import edge_tts
    except ImportError as e:
        raise MediaError("The free voices need the 'edge-tts' package: pip install edge-tts") from e
    import asyncio
    out = dest.with_suffix(".mp3")
    try:
        asyncio.run(edge_tts.Communicate(text, voice).save(str(out)))
    except Exception as e:
        out.unlink(missing_ok=True)
        raise MediaError(f"Voiceover failed (this needs internet access): {e}") from e
    return out


def speak_to(dest: Path, text: str, provider: str = "gemini", voice: str | None = None, style: str = "",
             model: str | None = None) -> Path:
    """Narrate `text` into a file next to `dest` (the suffix depends on the provider). No Library entry."""
    text = (text or "").strip()
    if not text:
        raise MediaError("Write the narration first.")
    s = get_settings()
    if provider == "edge":
        voice = voice or s.get("tts_voice") or EDGE_VOICES[0]
        speak = lambda chunk, d: _edge_speech(chunk, d, voice)   # noqa: E731
    else:
        voice = voice or s.get("gen_tts_voice") or KNOWN_VOICES[0]
        model = model or s.get("gen_tts_model") or KNOWN_MODELS["tts"][0]["id"]
        speak = lambda chunk, d: _gemini_speech(chunk, d, voice, style, model)   # noqa: E731
    parts = _chunks(text)
    if len(parts) == 1:
        return speak(parts[0], dest)
    files = [speak(chunk, dest.with_name(f"{dest.stem}_{i}")) for i, chunk in enumerate(parts)]
    joined = dest.with_suffix(".wav")
    listing = dest.with_name(dest.stem + "_list.txt")
    listing.write_text("".join(f"file '{f.as_posix()}'\n" for f in files), "utf-8")
    try:
        ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing), "-ar", "44100", "-ac", "1", str(joined)])
    finally:
        listing.unlink(missing_ok=True)
        for f in files:
            f.unlink(missing_ok=True)
    return joined


def speech(text: str, job: Job, provider: str = "gemini", voice: str | None = None, style: str | None = None,
           model: str | None = None) -> dict:
    job.update(0.15, "Generating voiceover")
    work = DATA / "tmp" / f"tts_{job.id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        made = speak_to(work / "voice", text, provider, voice, style or "", model)
        out = unique_path(DATA / "assets" / "voice", safe_name(text[:40], "voiceover"), made.suffix.lstrip("."))
        shutil.move(str(made), str(out))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    row = _row("voice", out)
    row["duration"] = probe(out)["duration"]
    return row


# ---------------------------------------------------------------- music

def music(prompt: str, job: Job, model: str | None = None, instrumental: bool = True) -> dict:
    """A generated music track, saved to the Library's music. Lyria writes lyrics too unless told not to."""
    prompt = (prompt or "").strip()
    if not prompt:
        raise MediaError("Describe the music first.")
    client = _client()
    model = model or get_settings().get("gen_music_model") or KNOWN_MODELS["music"][0]["id"]
    ask = f"{prompt.rstrip('.')}. Instrumental only, no vocals." if instrumental and "instrumental" not in prompt.lower() else prompt
    job.update(0.1, "Asking Google for music (this can take a minute)")
    try:
        it = client.interactions.create(model=model, input=ask, response_modalities=["audio", "text"])
    except Exception as e:
        raise _error(e, model) from e
    if it.status not in (None, "completed"):
        raise _interaction_failed(it)
    data, mime = _content_bytes(it.output_audio, model)
    job.update(0.9, "Saving the track")
    work = DATA / "tmp" / f"music_{job.id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        made = _save_audio(data, mime, work / "track", rate=48000)
        out = unique_path(DATA / "assets" / "music", safe_name(prompt[:48], "music"), made.suffix.lstrip("."))
        shutil.move(str(made), str(out))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    row = _row("music", out)
    row["duration"] = probe(out)["duration"]
    row["lyrics"] = "" if instrumental else (it.output_text or "")
    return row


# ---------------------------------------------------------------- video

def _video_aspect(aspect: str) -> str:
    if aspect in ("16:9", "9:16"):
        return aspect
    w, h = ASPECT_SIZES.get(aspect, (16, 9))
    return "9:16" if h > w else "16:9"


def _wait(job: Job, started: float, cancel) -> None:
    """One polling pause for a clip: honours cancel, gives up after 20 minutes, and reports elapsed time."""
    if job.cancelled:
        try:
            cancel()
        except Exception:
            pass
        raise Cancelled()
    waited = time.time() - started
    if waited > 20 * 60:
        raise MediaError("Google is still working after 20 minutes. Check your AI Studio account before trying again.")
    # no real percentage exists, so creep towards 90% and say how long it has been
    job.update(0.05 + 0.85 * (1 - 1 / (1 + waited / 60)), f"Google is generating the clip ({int(waited)}s so far)")
    time.sleep(POLL_FAST if waited < 60 else POLL_SLOW)


POLL_FAST, POLL_SLOW = 5.0, 10.0


def _video_interaction(client, model: str, prompt: str, shape: str, seconds: float | None, image: tuple[bytes, str] | None,
                       job: Job) -> bytes:
    """The Interactions endpoint, run in the background on Google's side and polled until it is done."""
    fmt: dict = {"type": "video", "aspect_ratio": shape}
    if seconds:
        fmt["duration"] = f"{max(OMNI_SECONDS[0], min(OMNI_SECONDS[1], int(round(float(seconds)))))}s"
    payload: object = prompt
    if image:
        payload = [{"type": "image", "data": base64.b64encode(image[0]).decode(), "mime_type": image[1]}]
        if prompt:
            payload.insert(0, {"type": "text", "text": prompt})
    try:
        it = client.interactions.create(model=model, input=payload, response_format=fmt, background=True)
    except Exception as e:
        raise _error(e, model) from e
    started = time.time()
    while it.status in ("queued", "in_progress"):
        _wait(job, started, lambda: client.interactions.cancel(it.id))
        try:
            it = client.interactions.get(it.id)
        except Exception as e:
            raise _error(e, model) from e
    if it.status != "completed":
        raise _interaction_failed(it)
    job.update(0.93, "Downloading the clip")
    return _content_bytes(it.output_video, model)[0]


def video(prompt: str, aspect: str, seconds: float | None, job: Job, image_url: str | None = None) -> dict:
    """A short clip from Gemini Omni 1.2 Flash (3 to 15 seconds, with sound). Takes minutes; progress is elapsed time, not a percentage."""
    prompt = (prompt or "").strip()
    if not prompt and not image_url:
        raise MediaError("Describe the clip first.")
    client = _client()
    shape = _video_aspect(aspect)
    image = None
    if image_url:
        src = media_path(image_url)
        if not src.is_file():
            raise MediaError("The starting image no longer exists.")
        image = (src.read_bytes(), {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(src.suffix.lower(), "image/png"))
    job.update(0.03, "Sending the request to Google")
    data = _video_interaction(client, VIDEO_MODEL, prompt, shape, seconds, image, job)
    if not data:
        raise MediaError("The model finished but the clip was empty.")
    out = unique_path(DATA / "assets" / "broll", safe_name(prompt[:48] or "clip", "clip"), "mp4")
    out.write_bytes(data)
    row = _row("broll", out)
    row["note"] = "" if shape == aspect else f"Video models make 16:9 or 9:16 only, so this is {shape}."
    return row


# ---------------------------------------------------------------- options

def _classify(name: str) -> str | None:
    n = name.lower()
    if any(x in n for x in ("embedding", "live", "robotics", "computer-use", "transcribe", "realtime", "aqa", "gemma")):
        return None
    if "lyria" in n:
        return "music"
    if "tts" in n:
        return "tts"
    if "veo" in n or "omni" in n:
        return None   # video is fixed to Gemini Omni 1.2 Flash
    if n.startswith("imagen"):
        return None   # Imagen's own endpoint is not available with an AI Studio key in this SDK
    if "image" in n or "banana" in n:
        return "image"
    return None


def options(live: bool = False) -> dict:
    s = get_settings()
    models = {k: [dict(m) for m in v] for k, v in KNOWN_MODELS.items()}
    voices = list(KNOWN_VOICES)
    note = ""
    loaded = False
    if live:
        if not gemini_key():
            raise MediaError("Add a Gemini API key under Settings → AI first.")
        client = _client()
        try:
            for m in client.models.list():
                name = (m.name or "").removeprefix("models/")
                kind = _classify(name)
                if kind and all(x["id"] != name for x in models[kind]):
                    models[kind].append({"id": name, "label": m.display_name or name})
            loaded = True
        except Exception as e:
            raise _error(e, "") from e
        try:   # the voice list is newer than the model list; its absence is not an error
            for v in client.voices.list().voices or []:
                label = v.display_name or (v.id or "")
                if label and label not in voices:
                    voices.append(label)
        except Exception:
            note = "Voices could not be listed, so only the built-in suggestions are shown."
    for kind, key in (("image", "gen_image_model"), ("tts", "gen_tts_model"), ("music", "gen_music_model")):
        if s.get(key) and all(m["id"] != s[key] for m in models[kind]):
            models[kind].insert(0, {"id": s[key], "label": s[key]})
    if s.get("gen_tts_voice") and s["gen_tts_voice"] not in voices:
        voices.insert(0, s["gen_tts_voice"])
    return {
        "key": bool(gemini_key()), "ai": ai.available(), "live": loaded, "note": note,
        "settings": {k: s.get(k, "") for k in SETTING_KEYS}, "edge_voice": s.get("tts_voice", EDGE_VOICES[0]),
        "models": models, "voices": voices, "edge_voices": EDGE_VOICES,
        "aspects": {k: list(v) for k, v in ASPECT_SIZES.items()},
    }


def save_options(patch: dict) -> dict:
    clean = {k: str(patch[k]).strip() for k in SETTING_KEYS if isinstance(patch.get(k), str) and patch[k].strip()}
    if clean:
        save_settings(clean)
    return options()


# ---------------------------------------------------------------- a whole video from a script

_SCRIPT_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["title", "beats"],
    "properties": {
        "title": {"type": "string"},
        "beats": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["narration", "image_prompt"],
            "properties": {"narration": {"type": "string"}, "image_prompt": {"type": "string"}}}},
    },
}


def _split_script(script: str) -> list[str]:
    """Narration beats from pasted text: one or two sentences each, never more than about 220 characters."""
    beats: list[str] = []
    for para in re.split(r"\n\s*\n|\n", script.strip()):
        cur = ""
        for sentence in re.split(r"(?<=[.!?…])\s+", para.strip()):
            if not sentence:
                continue
            if cur and len(cur) + len(sentence) + 1 > 220:
                beats.append(cur)
                cur = sentence
            else:
                cur = f"{cur} {sentence}".strip()
        if cur:
            beats.append(cur)
    return beats


def _rules_text(rules: list[str] | None) -> str:
    rules = [r.strip() for r in (rules or []) if isinstance(r, str) and r.strip()]
    return ("\n\nHouse style rules to follow:\n" + "\n".join(f"- {r}" for r in rules)) if rules else ""


def write_script(topic: str, script: str, seconds: float, rules: list[str] | None, image_style: str) -> dict:
    """{title, beats:[{narration, image_prompt}]} from a topic (AI writes it) or a pasted script (kept word for word)."""
    style = f" Every image prompt should suit this look: {image_style.strip()}." if image_style.strip() else ""
    if script.strip():
        lines = _split_script(script)
        if not lines:
            raise MediaError("The script is empty.")
        title = (topic.strip() or re.sub(r"[.!?].*$", "", lines[0]))[:80]
        if ai.available():
            try:
                data = ai.ask_json(
                    "You illustrate a narrated video. For each narration line you are given, write one image prompt: a "
                    "single concrete scene a still image can show, with subject, setting and mood, and no text in the "
                    "picture. Return the narration lines exactly as given, in the same order, one beat per line. Also "
                    "give the video a short title." + style + _rules_text(rules),
                    "\n".join(f"[{i}] {l}" for i, l in enumerate(lines)), _SCRIPT_SCHEMA, max_tokens=16000, effort="low")
                prompts = [b.get("image_prompt", "") for b in data.get("beats", [])]
                if len(prompts) == len(lines):
                    return {"title": (topic.strip() or data.get("title") or title)[:80],
                            "beats": [{"narration": l, "image_prompt": p or l} for l, p in zip(lines, prompts)]}
            except ai.AIUnavailable:
                pass   # fall through: the narration itself is a usable prompt
        return {"title": title, "beats": [{"narration": l, "image_prompt": l} for l in lines]}

    if not topic.strip():
        raise MediaError("Give a topic or paste a script.")
    if not ai.available():
        raise MediaError("Writing a script from a topic needs an AI key (Settings → AI). You can paste your own script instead.")
    words = max(40, int(seconds * 2.5))
    try:
        data = ai.ask_json(
            "You write narrated videos made of still images with a voiceover. Write the narration as short spoken "
            "beats of one or two sentences each. Open with a line that makes a stranger keep watching, keep each "
            "beat to one idea, use plain spoken language, and end on a payoff rather than a summary. For every beat "
            "also write one image prompt: a single concrete scene a still image can show, with subject, setting and "
            "mood, and no text in the picture." + style + _rules_text(rules),
            f"Topic: {topic.strip()}\nTotal narration length: about {words} words (roughly {int(seconds)} seconds spoken).",
            _SCRIPT_SCHEMA, max_tokens=32000)
    except ai.AIUnavailable as e:
        raise MediaError(str(e)) from e
    beats = [{"narration": b["narration"].strip(), "image_prompt": (b.get("image_prompt") or b["narration"]).strip()}
             for b in data.get("beats", []) if b.get("narration", "").strip()]
    if not beats:
        raise MediaError("The AI returned an empty script. Try again or paste your own.")
    return {"title": (data.get("title") or topic).strip()[:80], "beats": beats}


def _plain_card(out: Path, size: tuple[int, int]) -> None:
    ffmpeg(["-f", "lavfi", "-i", f"color=c=0x16161a:s={size[0]}x{size[1]}", "-frames:v", "1", str(out)])


def from_script(body: dict, job: Job) -> dict:
    """Script → narration → images → one assembled video → a normal studio project with captions."""
    aspect = body.get("aspect") if body.get("aspect") in ASPECT_SIZES else "9:16"
    W, H = ASPECT_SIZES[aspect]
    provider = "edge" if body.get("provider") == "edge" else "gemini"
    if not gemini_key():
        raise MediaError("Generating a video from a script uses a Gemini API key for the images. Add one under Settings → AI.")
    seconds = float(body.get("seconds") or (45 if H > W else 120))
    image_style = str(body.get("image_style") or "")
    work = DATA / "tmp" / f"script_{job.id}"
    work.mkdir(parents=True, exist_ok=True)
    try:
        job.update(0.02, "Writing the script" if not (body.get("script") or "").strip() else "Reading the script")
        plan = write_script(str(body.get("topic") or ""), str(body.get("script") or ""), seconds, body.get("rules"), image_style)
        beats = plan["beats"]
        n = len(beats)

        # --- narration, one file per beat, so timings are known exactly
        audio: list[Path] = []
        lengths: list[float] = []
        for i, beat in enumerate(beats):
            job.update(0.08 + 0.32 * i / n, f"Recording narration ({i + 1} of {n})")
            f = speak_to(work / f"voice_{i:03d}", beat["narration"], provider, body.get("voice") or None, str(body.get("voice_style") or ""))
            audio.append(f)
            lengths.append(max(0.4, probe(f)["duration"]))

        # --- images: at most max_images, shared across neighbouring beats beyond that
        n_img = max(1, min(n, int(body.get("max_images") or 12)))
        owner = [min(n_img - 1, i * n_img // n) for i in range(n)]
        first_beat = {k: owner.index(k) for k in range(n_img)}
        images: list[Path | None] = [None] * n_img
        skipped = 0
        for k in range(n_img):
            job.update(0.40 + 0.35 * k / n_img, f"Generating images ({k + 1} of {n_img})")
            prompt = beats[first_beat[k]]["image_prompt"] + (f". Style: {image_style.strip()}" if image_style.strip() else "")
            try:
                data, mime = image_bytes(prompt, aspect)
                ext = {"image/jpeg": "jpg", "image/webp": "webp"}.get(mime, "png")
                f = work / f"img_{k:03d}.{ext}"
                f.write_bytes(data)
                images[k] = f
            except MediaError as e:
                if k == 0 and "declined" not in str(e):
                    raise   # a bad key, model or quota will fail every image: stop now
                skipped += 1
        for k in range(n_img):   # a declined image borrows its neighbour, or a plain card if there is none
            if images[k] is None:
                images[k] = next((images[j] for j in (*range(k - 1, -1, -1), *range(k + 1, n_img)) if images[j]), None)
        if all(img is None for img in images):
            raise MediaError("Google declined every image prompt. Try a different topic or style.")
        card = work / "card.png"
        for k in range(n_img):
            if images[k] is None:
                if not card.exists():
                    _plain_card(card, (W, H))
                images[k] = card

        # --- one segment per beat: a slow push in or out on the still, with the beat's narration
        fps, gap = 30, 0.25
        segs: list[Path] = []
        starts: list[float] = []
        clock = 0.0
        total = sum(lengths) + gap * n
        for i in range(n):
            dur = lengths[i] + gap
            frames = max(2, round(dur * fps))
            dur = frames / fps
            z = f"1+0.10*on/{frames}" if i % 2 == 0 else f"1.10-0.10*on/{frames}"
            vf = (f"scale={int(W * 1.5)}:{int(H * 1.5)}:force_original_aspect_ratio=increase,crop={int(W * 1.5)}:{int(H * 1.5)},"
                  f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={fps},format=yuv420p")
            seg = work / f"seg_{i:03d}.mp4"
            ffmpeg(["-i", str(images[owner[i]]), "-i", str(audio[i]), "-filter_complex", f"[0:v]{vf}[v];[1:a]apad[a]",
                    "-map", "[v]", "-map", "[a]", "-frames:v", str(frames), "-t", f"{dur:.4f}", "-r", str(fps),
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
                    str(seg)], job, dur, (0.75 + 0.2 * clock / total, 0.75 + 0.2 * (clock + dur) / total),
                   f"Assembling the video ({i + 1} of {n})")
            segs.append(seg)
            starts.append(clock)
            clock += dur

        job.update(0.96, "Joining the scenes")
        listing = work / "list.txt"
        listing.write_text("".join(f"file '{s.as_posix()}'\n" for s in segs), "utf-8")
        final = DATA / "sources" / f"{new_id('src_')}.mp4"
        ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(final)])

        # --- a normal project: transcript timed from the narration, one clip covering the whole video
        from ..routers import projects
        from . import sources, transcribe
        words: list[dict] = []
        for i, beat in enumerate(beats):
            tokens = beat["narration"].split()
            weight = sum(len(t) + 1 for t in tokens) or 1
            t = starts[i]
            for tok in tokens:
                d = lengths[i] * (len(tok) + 1) / weight
                words.append({"text": tok, "start": t, "end": t + d * 0.94})
                t += d
        project = sources.new_project(plan["title"] or "Generated video", final, "Generated from a script")
        project["created"] = time.time()
        project["transcript"] = {"words": transcribe._finish(words), "language": "", "engine": "script"}
        project["script"] = {"title": plan["title"], "beats": beats, "aspect": aspect}
        clip = projects._new_clip(project, 0.0, project["source"]["duration"], plan["title"] or "Generated video",
                                  {"hook_title": plan["title"], "reason": "Generated from a script."})
        clip["spec"].update(width=W, height=H)
        project["clips"].append(clip)
        projects.save(project)
        return {"project_id": project["id"], "clip_id": clip["id"], "title": plan["title"], "beats": n, "images": n_img,
                "seconds": round(clock, 2), "note": f"{skipped} image prompt(s) were declined and reused a neighbouring image." if skipped else ""}
    finally:
        shutil.rmtree(work, ignore_errors=True)
