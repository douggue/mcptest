"""Claude access for the studio. Every caller has a rule-based fallback, so the app works without a key."""
from __future__ import annotations

import json

from ..config import anthropic_key, get_settings

# Models that accept the server-side refusal fallback.
_FALLBACK_OK = ("claude-opus-5-5", "claude-opus-5", "claude-fable-5-2", "claude-fable-5-1", "claude-sonnet-5-5")


class AIUnavailable(RuntimeError):
    """No key configured, or the request could not be completed."""


def available() -> bool:
    return bool(anthropic_key())


def ask_json(system: str, user: str, schema: dict, max_tokens: int = 32000, effort: str = "medium") -> dict:
    """One structured request. Returns the parsed object or raises AIUnavailable with a readable reason."""
    key = anthropic_key()
    if not key:
        raise AIUnavailable("No Anthropic API key is set (Settings → AI).")
    try:
        import anthropic
    except ImportError as e:  # pragma: no cover
        raise AIUnavailable("The 'anthropic' package is not installed.") from e

    model = get_settings().get("ai_model") or "claude-opus-5-5"
    client = anthropic.Anthropic(api_key=key)
    kwargs: dict = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
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
    text = next((b.text for b in message.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise AIUnavailable("The AI returned something that was not valid JSON.") from e
