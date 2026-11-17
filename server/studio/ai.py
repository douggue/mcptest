"""AI access for the studio: Claude (Anthropic) or Gemini (Google), chosen in Settings.

Every caller has a rule-based fallback, so the app works without a key.
"""
from __future__ import annotations

import json

from ..config import anthropic_key, gemini_key, get_settings

# Claude models that accept the server-side refusal fallback.
_FALLBACK_OK = ("claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5")

CLAUDE_MODELS = [
    {"id": "claude-opus-5-5", "label": "Claude Opus 5.5 (default)"},
    {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5"},
    {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5"},
    {"id": "claude-fable-5-2", "label": "Claude Fable 5.2"},
]
# Names and descriptions are taken from Google's own cookbook; "Load list" in Settings asks Google what a key can use.
GEMINI_MODELS = [
    {"id": "gemini-4-hydrogen", "label": "Gemini 4 Hydrogen (default; fast, works on the free tier)"},
    {"id": "gemini-4-argon", "label": "Gemini 4 Argon (stronger; paid)"},
    {"id": "gemini-4-carbon", "label": "Gemini 4 Carbon (strongest; paid)"},
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash"},
    {"id": "gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite (cheapest)"},
]
GEMINI_DEFAULT = GEMINI_MODELS[0]["id"]


class AIUnavailable(RuntimeError):
    """No key configured, or the request could not be completed."""


def provider() -> str:
    """The provider to use: the one chosen in Settings if it has a key, otherwise whichever does. '' if neither."""
    keys = {"anthropic": anthropic_key(), "gemini": gemini_key()}
    chosen = get_settings().get("ai_provider") or "anthropic"
    if keys.get(chosen):
        return chosen
    return next((name for name, key in keys.items() if key), "")


def available() -> bool:
    return bool(provider())


def provider_label() -> str:
    return {"anthropic": "Claude", "gemini": "Gemini"}.get(provider(), "")


def ask_json(system: str, user: "str | list", schema: dict, max_tokens: int = 32000, effort: str = "medium") -> dict:
    """One structured request. Returns the parsed object or raises AIUnavailable with a readable reason.

    `user` is text, or an ordered list of parts for requests with pictures: plain strings,
    `{"image": <jpeg bytes>}` items and `{"video": <path>, "fps": <optional frames a second>}` items, in the order
    the model should read them.
    Whole videos are only sent to Gemini, which can watch them; Claude gets the stills, so always include stills too.
    """
    which = provider()
    if not which:
        raise AIUnavailable("No AI key is set (Settings → AI).")
    text = _ask_gemini(system, user, schema) if which == "gemini" else _ask_claude(system, user, schema, max_tokens, effort)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise AIUnavailable("The AI returned something that was not valid JSON.") from e


# ---------------------------------------------------------------- Claude

def _claude_content(user: "str | list"):
    if isinstance(user, str):
        return user
    import base64
    blocks = []
    for part in user:
        if isinstance(part, str):
            blocks.append({"type": "text", "text": part})
        elif "video" in part:
            continue   # stills carry the picture for Claude
        else:
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                         "data": base64.standard_b64encode(part["image"]).decode("ascii")}})
    return blocks


def _ask_claude(system: str, user: "str | list", schema: dict, max_tokens: int, effort: str) -> str:
    try:
        import anthropic
    except ImportError as e:  # pragma: no cover
        raise AIUnavailable("The 'anthropic' package is not installed.") from e

    model = get_settings().get("ai_model") or "claude-opus-5-5"
    client = anthropic.Anthropic(api_key=anthropic_key())
    kwargs: dict = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": _claude_content(user)}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    betas: list[str] = []
    if model in _FALLBACK_OK:
        # If a safety classifier declines, the API re-runs the request on a fallback model in the same call.
        betas.append("server-side-fallback-2026-07-01")
        kwargs["fallbacks"] = "default"
    try:
        # Streamed so long transcripts / long outputs do not hit HTTP timeouts.
        with client.beta.messages.stream(betas=betas, **kwargs) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError as e:
        raise AIUnavailable("The Anthropic API key was rejected.") from e
    except anthropic.RateLimitError as e:
        raise AIUnavailable("Rate limited by the Anthropic API; try again in a minute.") from e
    except anthropic.BadRequestError as e:
        raise AIUnavailable(f"The AI request was rejected: {e.message}") from e
    except anthropic.APIStatusError as e:
        raise AIUnavailable(f"Anthropic API error {e.status_code}.") from e
    except anthropic.APIConnectionError as e:
        raise AIUnavailable("Could not reach the Anthropic API.") from e

    if message.stop_reason == "refusal":
        raise AIUnavailable("The AI declined this request.")
    if message.stop_reason == "max_tokens":
        raise AIUnavailable("The AI response was cut off (too long).")
    return next((b.text for b in message.content if b.type == "text"), "")


# ---------------------------------------------------------------- Gemini

_GEMINI_DECLINED = {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE"}


def _gemini_client():
    try:
        from google import genai
        from google.genai import types
    except ImportError as e:
        raise AIUnavailable("Gemini needs the 'google-genai' package: pip install google-genai") from e
    # timeout is in milliseconds; a two-hour transcript can take a few minutes to read
    return genai.Client(api_key=gemini_key(), http_options=types.HttpOptions(timeout=600_000))


def _gemini_error(e: Exception, model: str) -> AIUnavailable:
    code = getattr(e, "code", None)
    message = str(getattr(e, "message", "") or e)
    if code in (401, 403) or "API key" in message:
        return AIUnavailable("The Gemini API key was rejected.")
    if code == 404:
        return AIUnavailable(f"Gemini does not know the model '{model}'. Pick another under Settings → AI.")
    if code == 429:
        return AIUnavailable("Gemini rate limit or quota reached; wait a minute, or use a Flash model on the free tier.")
    if code and 400 <= code < 500:
        return AIUnavailable(f"The AI request was rejected: {message[:200]}")
    if code:
        return AIUnavailable(f"Gemini API error {code}.")
    return AIUnavailable("Could not reach the Gemini API.")


def _ask_gemini(system: str, user: "str | list", schema: dict) -> str:
    client = _gemini_client()
    from google.genai import errors, types
    detailed = False
    if not isinstance(user, str):
        parts = []
        for p in user:
            if isinstance(p, str):
                parts.append(p)
            elif "video" in p:
                uploaded = _gemini_upload(client, p["video"])
                if uploaded is None:
                    continue
                part = types.Part.from_uri(file_uri=uploaded.uri, mime_type=uploaded.mime_type or "video/mp4")
                if p.get("fps"):
                    # Gemini looks at one frame a second unless told otherwise, which misses fast cuts and captions.
                    part.video_metadata = types.VideoMetadata(fps=float(p["fps"]))
                    detailed = True
                parts.append(part)
            else:
                parts.append(types.Part.from_bytes(data=p["image"], mime_type="image/jpeg"))
        user = parts
    model = get_settings().get("gemini_model") or GEMINI_DEFAULT
    config = types.GenerateContentConfig(system_instruction=system, response_mime_type="application/json",
                                         response_json_schema=schema)

    def send():
        return client.models.generate_content(model=model, contents=user, config=config)

    try:
        try:
            response = send()
        except errors.APIError as e:
            if not (detailed and getattr(e, "code", None) == 400):
                raise
            for part in user:   # this model does not take a frame rate: ask again at the default one
                if getattr(part, "video_metadata", None) is not None:
                    part.video_metadata = None
            response = send()
    except errors.APIError as e:
        raise _gemini_error(e, model) from e
    except Exception as e:   # connection and timeout errors come from the HTTP layer
        raise _gemini_error(e, model) from e

    feedback = response.prompt_feedback
    if feedback is not None and feedback.block_reason:
        raise AIUnavailable("The AI declined this request.")
    candidate = response.candidates[0] if response.candidates else None
    reason = getattr(candidate.finish_reason, "name", str(candidate.finish_reason or "")) if candidate else ""
    if reason in _GEMINI_DECLINED:
        raise AIUnavailable("The AI declined this request.")
    if reason == "MAX_TOKENS":
        raise AIUnavailable("The AI response was cut off (too long).")
    text = ""
    if candidate and candidate.content and candidate.content.parts:
        text = "".join(p.text for p in candidate.content.parts if p.text and not getattr(p, "thought", False))
    if not text:
        raise AIUnavailable("The AI returned an empty answer.")
    return text


def _gemini_upload(client, path, wait_seconds: float = 180.0):
    """Upload a video for Gemini to watch and wait until it is ready. Returns None if that does not work out
    (the request then goes ahead with the stills alone)."""
    import time
    try:
        f = client.files.upload(file=str(path))
        deadline = time.time() + wait_seconds
        while getattr(f.state, "name", str(f.state)) == "PROCESSING" and time.time() < deadline:
            time.sleep(2)
            f = client.files.get(name=f.name)
        return f if getattr(f.state, "name", str(f.state)) == "ACTIVE" else None
    except Exception:
        return None


def watches_video() -> bool:
    """True when the active provider can be given whole videos, not just stills."""
    return provider() == "gemini"


def gemini_models() -> list[dict]:
    """Text models this key can use, straight from Google, so the list never goes stale."""
    if not gemini_key():
        raise AIUnavailable("Add a Gemini API key first.")
    client = _gemini_client()
    skip = ("embedding", "image", "tts", "audio", "live", "robotics", "computer-use", "veo", "imagen", "aqa", "gemma")
    try:
        found = []
        for m in client.models.list():
            name = (m.name or "").removeprefix("models/")
            if "generateContent" not in (m.supported_actions or []) or not name.startswith("gemini"):
                continue
            if any(word in name for word in skip):
                continue
            found.append({"id": name, "label": m.display_name or name})
    except Exception as e:
        raise _gemini_error(e, "") from e
    return sorted(found, key=lambda m: m["id"])
