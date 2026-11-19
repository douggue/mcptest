"""AI access for the studio: Claude (Anthropic) or Gemini (Google), chosen in Settings.

Every caller has a rule-based fallback, so the app works without a key.
"""
from __future__ import annotations

import json
import re

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


# Claude through the Claude Code program on this computer, signed in with the owner's own subscription.
# Aliases always mean the newest model of that kind; any full model name can be typed in Settings instead.
CLAUDE_CODE_MODELS = [
    {"id": "opus", "label": "Opus (newest; default)"},
    {"id": "sonnet", "label": "Sonnet (newest; faster)"},
    {"id": "haiku", "label": "Haiku (newest; fastest, lightest on your usage)"},
    {"id": "fable", "label": "Fable (newest; if your plan includes it)"},
]


class AIUnavailable(RuntimeError):
    """No key configured, or the request could not be completed."""


def provider() -> str:
    """The provider to use: the one chosen in Settings if it is ready, otherwise whichever API has a key. '' if none.

    Claude Code is only used when chosen: it runs on the owner's subscription, which they should opt into."""
    keys = {"anthropic": anthropic_key(), "gemini": gemini_key()}
    chosen = get_settings().get("ai_provider") or "anthropic"
    if chosen == "claude_code":
        from .. import auth
        # never on the server edition: everyone signed in would be spending the owner's subscription
        if not auth.enabled() and claude_code_exe():
            return "claude_code"
    elif chosen == "codex":
        from .. import auth
        if not auth.enabled() and codex_exe():
            return "codex"
    elif keys.get(chosen):
        return chosen
    return next((name for name, key in keys.items() if key), "")


def setup_hint() -> str:
    """Why no AI is in use, in a sentence that says what to do."""
    chosen = get_settings().get("ai_provider") or "anthropic"
    if chosen == "claude_code":
        from .. import auth
        if auth.enabled():
            return ("The server edition cannot use your Claude subscription (anyone signed in would be using it). "
                    "Add a Claude or Gemini API key under Settings → AI.")
        if not claude_code_exe():
            return ("Claude subscription is chosen under Settings → AI, but Claude Code was not found on this computer. "
                    "Install it and sign in by running  claude  once in a terminal, or set where it is in Settings → AI.")
    if chosen == "codex":
        from .. import auth
        if auth.enabled():
            return ("The server edition cannot use your ChatGPT subscription (anyone signed in would be using it). "
                    "Add a Claude or Gemini API key under Settings → AI.")
        if not codex_exe():
            return ("ChatGPT subscription is chosen under Settings → AI, but the Codex CLI was not found on this computer. "
                    "Install it with  npm install -g @openai/codex  and sign in by running  codex login  once.")
    return ("No AI is set up yet. Under Settings → AI choose Claude subscription (uses Claude Code on this computer) "
            "or add a Claude or Gemini API key.")


GEMINI_CLI_TASKS = {"moments": "Finding moments", "references": "Studying and reviewing style references"}


def gemini_cli_for(task: str) -> bool:
    """Whether this task goes to the Gemini CLI (the person's Google subscription) instead of the main provider.
    Never on the server edition: everyone signed in would be spending the owner's subscription."""
    if not task or task not in (get_settings().get("gemini_cli_tasks") or []):
        return False
    from .. import auth
    return not auth.enabled() and gemini_cli_exe() is not None


def backup_ready() -> bool:
    """Whether the Google CLI stands in when the main provider fails (Settings → AI). Own computer only."""
    if not get_settings().get("gemini_cli_backup"):
        return False
    from .. import auth
    return not auth.enabled() and gemini_cli_exe() is not None


def available(task: str = "") -> bool:
    return gemini_cli_for(task) or bool(provider()) or backup_ready()


def provider_label(task: str = "") -> str:
    if gemini_cli_for(task) or (not provider() and backup_ready()):
        return f"Gemini (your Google subscription, {gemini_cli_label()})"
    return {"anthropic": "Claude", "gemini": "Gemini", "claude_code": "Claude (your subscription)",
            "codex": "ChatGPT (your subscription)"}.get(provider(), "")


AI_NAMES = {"claude_code": "Claude (your subscription)", "codex": "ChatGPT (your subscription)", "agy": "Gemini (your Google subscription)",
            "anthropic": "Claude (API key)", "gemini": "Gemini (API key)"}


def ai_choices() -> list[dict]:
    """Every AI Cutroom can use here, for choosing one for a job: {key, label, ready, why, watches_video}."""
    from .. import auth
    local = not auth.enabled()
    out = [
        {"key": "claude_code", "ready": local and claude_code_exe() is not None, "watches_video": False,
         "why": "" if local else "Not on the server edition."},
        {"key": "codex", "ready": local and codex_exe() is not None, "watches_video": False,
         "why": "" if local else "Not on the server edition."},
        {"key": "agy", "ready": local and gemini_cli_exe() is not None, "watches_video": (get_settings().get("gemini_cli_video") or "video") != "frames",
         "why": "" if local else "Not on the server edition."},
        {"key": "anthropic", "ready": bool(anthropic_key()), "watches_video": False, "why": ""},
        {"key": "gemini", "ready": bool(gemini_key()), "watches_video": True, "why": ""},
    ]
    for c in out:
        c["label"] = AI_NAMES[c["key"]]
        if not c["ready"] and not c["why"]:
            c["why"] = {"claude_code": "Claude Code was not found.", "codex": "The Codex CLI was not found.", "agy": "The Antigravity CLI was not found.",
                        "anthropic": "No Claude API key.", "gemini": "No Gemini API key."}[c["key"]]
    return out


def current_key(task: str = "") -> str:
    """Which AI a task would use now: 'agy' when routed to the Google CLI, else the main provider ('' if none)."""
    return "agy" if gemini_cli_for(task) else provider()


def label_for(key: str) -> str:
    return AI_NAMES.get(key, key or "")


def ask_with(use: str, system: str, user: "str | list", schema: dict, max_tokens: int = 32000, effort: str = "medium", task: str = "") -> dict:
    """A request to one chosen AI ('' = whatever the task normally uses)."""
    if not use:
        return ask_json(system, user, schema, max_tokens, effort, task)
    choice = next((c for c in ai_choices() if c["key"] == use), None)
    if not choice or not choice["ready"]:
        raise AIUnavailable(f"{label_for(use)} is not set up here: {(choice or {}).get('why', '')}".strip())
    if use == "agy":
        return _ask_gemini_cli(system, user, schema, task)
    if use == "claude_code":
        return _ask_claude_code(system, user, schema, effort)
    if use == "codex":
        return _ask_codex(system, user, schema, effort)
    text = _ask_gemini(system, user, schema) if use == "gemini" else _ask_claude(system, user, schema, max_tokens, effort)
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise AIUnavailable("The AI returned something that was not valid JSON.") from e


def ask_json(system: str, user: "str | list", schema: dict, max_tokens: int = 32000, effort: str = "medium", task: str = "") -> dict:
    """One structured request. Returns the parsed object or raises AIUnavailable with a readable reason.

    `user` is text, or an ordered list of parts for requests with pictures: plain strings,
    `{"image": <jpeg bytes>}` items and `{"video": <path>, "fps": <optional frames a second>}` items, in the order
    the model should read them.
    Whole videos are only sent to Gemini, which can watch them; Claude gets the stills, so always include stills too.
    """
    if gemini_cli_for(task):
        return _ask_gemini_cli(system, user, schema, task)
    try:
        return _ask_main(system, user, schema, max_tokens, effort)
    except AIUnavailable as first:
        if not backup_ready():
            raise
        # The backup: the same request through the person's Google subscription. Slower, but the work gets done.
        import logging
        logging.getLogger("cutroom.ai").warning("Main AI failed (%s); trying the Google CLI backup", first)
        try:
            return _ask_gemini_cli(system, user, schema, task)
        except AIUnavailable as second:
            raise AIUnavailable(f"{first} The backup (Gemini through the {gemini_cli_label()}) failed too: {second}") from second


def _ask_main(system: str, user: "str | list", schema: dict, max_tokens: int, effort: str) -> dict:
    which = provider()
    if not which:
        raise AIUnavailable(setup_hint())
    if which == "claude_code":
        return _ask_claude_code(system, user, schema, effort)   # already parsed
    if which == "codex":
        return _ask_codex(system, user, schema, effort)   # already parsed
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


def watches_video(task: str = "") -> bool:
    """True when the provider for this task can be given whole videos, not just stills."""
    if gemini_cli_for(task):
        return (get_settings().get("gemini_cli_video") or "video") != "frames"
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


# ---------------------------------------------------------------- Claude Code (the owner's subscription)

def claude_code_exe() -> list[str] | None:
    """The command that runs Claude Code here, or None when it is not installed.

    Windows: the native installer gives claude.exe; an npm install gives a claude.cmd shim, which cannot be run
    without a shell (and a shell would mangle the JSON arguments), so its JavaScript entry point is run with node."""
    import os
    import shutil
    from pathlib import Path
    custom = (get_settings().get("claude_code_path") or "").strip().strip('"')
    found = custom if custom and Path(custom).exists() else (shutil.which("claude.exe") or shutil.which("claude"))
    if not found:
        home = Path.home()
        for guess in (home / ".local" / "bin" / "claude.exe", home / ".local" / "bin" / "claude", home / ".claude" / "local" / "claude"):
            if guess.exists():
                found = str(guess)
                break
    if not found:
        return None
    if found.lower().endswith((".cmd", ".bat")):
        script = Path(found).parent / "node_modules" / "@anthropic-ai" / "claude-code" / "cli.js"
        node = shutil.which("node")
        if script.exists() and node:
            return [node, str(script)]
        return None
    return [found] if os.access(found, os.X_OK) or os.name == "nt" else None


def _claude_code_env() -> dict:
    """The environment for Claude Code: without API keys, so the subscription login is what gets used
    (in print mode Claude Code would otherwise bill an ANTHROPIC_API_KEY it finds, without asking)."""
    import os
    env = dict(os.environ)
    for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"):
        env.pop(k, None)
    return env


def claude_code_status() -> dict:
    """{installed, version, logged_in, method, why} for Settings."""
    import subprocess
    exe = claude_code_exe()
    if not exe:
        return {"installed": False, "version": "", "logged_in": False, "method": "",
                "why": "Claude Code was not found. Install it (https://claude.com/claude-code), sign in once by running "
                       "claude in a terminal, or set its location below."}
    out = {"installed": True, "version": "", "logged_in": False, "method": "", "why": ""}
    try:
        v = subprocess.run(exe + ["--version"], capture_output=True, text=True, timeout=30, env=_claude_code_env())
        out["version"] = (v.stdout or "").strip().split(" ")[0]
        a = subprocess.run(exe + ["auth", "status"], capture_output=True, text=True, timeout=30, env=_claude_code_env())
        info = json.loads(a.stdout or "{}")
        out["logged_in"] = bool(info.get("loggedIn"))
        out["method"] = info.get("authMethod") or ""
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        out["why"] = f"Claude Code is installed but did not answer ({e})."
        return out
    if not out["logged_in"]:
        out["why"] = "Claude Code is not signed in. Open a terminal, run  claude  and sign in with your Claude account."
    return out


def _ask_claude_code(system: str, user: "str | list", schema: dict, effort: str) -> dict:
    """One structured answer from Claude Code in print mode: tools off, customisations off (--safe-mode),
    nothing saved, run from an empty folder. Text and pictures go in on stdin as one stream-json user message."""
    import base64
    import subprocess
    import tempfile
    exe = claude_code_exe()
    if not exe:
        raise AIUnavailable("Claude Code was not found on this computer (Settings → AI).")
    s = get_settings()
    model = (s.get("claude_code_model") or "opus").strip()
    effort = (s.get("claude_code_effort") or effort or "").strip()
    if isinstance(user, str):
        content = [{"type": "text", "text": user}]
    else:
        content = []
        for part in user:
            if isinstance(part, str):
                content.append({"type": "text", "text": part})
            elif "image" in part:
                content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                             "data": base64.standard_b64encode(part["image"]).decode("ascii")}})
            # whole videos: only Gemini watches them; the stills carry the picture here
    message = json.dumps({"type": "user", "message": {"role": "user", "content": content}, "parent_tool_use_id": None})
    from ..config import DATA
    work = DATA / "tmp" / "claude-code"
    work.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=work) as tmp:
        prompt_file = f"{tmp}/system.txt"
        with open(prompt_file, "w", encoding="utf-8") as f:
            f.write(system)
        cmd = exe + ["-p", "--safe-mode", "--tools", "", "--no-session-persistence",
                     "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                     "--model", model, "--system-prompt-file", prompt_file,
                     "--json-schema", json.dumps(schema, separators=(",", ":")), "--max-turns", "6"]
        if effort in ("low", "medium", "high", "xhigh", "max"):
            cmd += ["--effort", effort]
        try:
            run = subprocess.run(cmd, input=message + "\n", capture_output=True, text=True, encoding="utf-8",
                                 timeout=1800, cwd=tmp, env=_claude_code_env())
        except subprocess.TimeoutExpired as e:
            raise AIUnavailable("Claude Code took more than 30 minutes and was stopped.") from e
        except OSError as e:
            raise AIUnavailable(f"Claude Code could not be started: {e}") from e
    result = None
    for line in (run.stdout or "").splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if item.get("type") == "result":
            result = item
    if result is None:
        detail = (run.stderr or run.stdout or "").strip().splitlines()
        raise AIUnavailable("Claude Code gave no answer" + (f": {detail[-1][:300]}" if detail else "."))
    if result.get("is_error") or result.get("structured_output") is None:
        why = " ".join(result.get("errors") or []) or str(result.get("result") or result.get("subtype") or "")
        low = why.lower()
        if "login" in low or "log in" in low or "auth" in low or "credential" in low:
            raise AIUnavailable("Claude Code is not signed in. Open a terminal, run  claude  and sign in, then try again.")
        if "limit" in low or "usage" in low or "rate" in low:
            raise AIUnavailable(f"Your Claude plan's usage limit was reached: {why[:200]}")
        if "model" in low and ("not" in low or "invalid" in low):
            raise AIUnavailable(f"Claude Code does not accept the model '{model}'. Pick another under Settings → AI.")
        raise AIUnavailable(f"Claude Code could not answer: {why[:300] or 'unknown reason'}")
    return result["structured_output"]


# ---------------------------------------------------------------- Google subscription: Antigravity CLI (agy), or the Gemini CLI
# Since June 2026 personal Google accounts (AI Pro / Ultra) are served by the Antigravity CLI; the Gemini CLI only takes
# API keys and company licences. Both run headless (-p) with JSON output; agy is preferred when both are installed.

def gemini_cli_exe() -> list[str] | None:
    """The command for Google's CLI here: agy, else gemini; None when neither is installed. A gemini.cmd npm shim is
    run through its JavaScript entry point with node."""
    import os
    import shutil
    from pathlib import Path
    custom = (get_settings().get("gemini_cli_path") or "").strip().strip('"')
    found = custom if custom and Path(custom).exists() else (shutil.which("agy") or shutil.which("gemini"))
    if not found:
        home = Path.home()
        for guess in (home / ".local" / "bin" / "agy", home / ".local" / "bin" / "agy.exe", home / "AppData" / "Local" / "Programs" / "agy" / "agy.exe"):
            if guess.exists():
                found = str(guess)
                break
    if not found:
        return None
    if _cli_kind([found]) == "gemini" and found.lower().endswith((".cmd", ".bat", ".ps1")):
        script = Path(found).parent / "node_modules" / "@google" / "gemini-cli" / "bundle" / "gemini.js"
        node = shutil.which("node")
        return [node, str(script)] if script.exists() and node else None
    return [found] if os.access(found, os.X_OK) or os.name == "nt" else None


def _cli_kind(exe: list[str]) -> str:
    """'agy' or 'gemini', from the program's name."""
    from pathlib import Path
    name = Path(exe[-1]).name.lower()
    return "gemini" if name.startswith("gemini") else "agy"


def gemini_cli_label() -> str:
    exe = gemini_cli_exe()
    return ("Antigravity CLI" if _cli_kind(exe) == "agy" else "Gemini CLI") if exe else "Antigravity CLI"


def _gemini_cli_env() -> dict:
    """Without API keys, so the Google sign-in (the subscription) is what gets used, not a key that bills."""
    import os
    env = dict(os.environ)
    for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA"):
        env.pop(k, None)
    env["NO_COLOR"] = "1"
    return env


def gemini_cli_status() -> dict:
    """{installed, version, signed_in, kind, why} for Settings. Whether it is signed in shows on Test."""
    import subprocess
    from pathlib import Path
    exe = gemini_cli_exe()
    if not exe:
        return {"installed": False, "version": "", "signed_in": False, "kind": "",
                "why": "The Antigravity CLI (agy) was not found. Install it from antigravity.google, run  agy  once in a "
                       "terminal and sign in with the Google account that has your Gemini plan, or set where it is below."}
    kind = _cli_kind(exe)
    out = {"installed": True, "version": "", "signed_in": True, "kind": kind, "why": ""}
    try:
        v = subprocess.run(exe + ["--version"], capture_output=True, text=True, timeout=60, env=_gemini_cli_env())
        lines = (v.stdout or "").strip().splitlines()
        out["version"] = lines[-1].strip() if lines else ""
    except (OSError, subprocess.TimeoutExpired) as e:
        out["why"] = f"The {gemini_cli_label()} is installed but did not answer ({e})."
        return out
    if kind == "gemini":
        out["signed_in"] = (Path.home() / ".gemini" / "oauth_creds.json").exists()
        out["why"] = ("Note: the Gemini CLI no longer takes personal Google sign-ins (AI Pro / Ultra). Install the "
                      "Antigravity CLI (agy) instead; Cutroom uses it when it finds it.")
    return out


def _json_from(text: str) -> dict:
    """The JSON object in a model's text answer (it may come in a code fence or with words around it)."""
    t = text.strip()
    if "```" in t:
        a = t.find("```")
        t = t[a + 3:]
        t = t.split("\n", 1)[1] if t[:4].lower().startswith("json") or "\n" in t[:8] else t
        t = t.rsplit("```", 1)[0]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        a, b = t.find("{"), t.rfind("}")
        if a >= 0 and b > a:
            return json.loads(t[a:b + 1])
        raise


_CLI_REJECTED: set[str] = set()   # options this CLI build answered with its help text (it does not know them)


def _printed_help(r) -> bool:
    """True when the CLI printed its usage instead of answering: it did not accept an option."""
    out = (r.stdout or "") + "\n" + (r.stderr or "")
    if '"response"' in out:
        return False
    return bool(re.search(r"(?im)^\s*(usage:|commands?:|options:)|unknown (option|flag|argument)|unrecognized", out)) \
        or bool(re.search(r"(?im)^\s*update\s+update cli", out))


AGY_TIMEOUT = 3600   # seconds; watching one 28 s video took about five minutes in testing
VIDEO_TIMEOUT = 1800 # a try with whole videos gets this long before the frame-by-frame backup takes over
MAX_CLI_VIDEO = 60 * 1024 * 1024


def gemini_cli_model(task: str = "") -> str:
    """The model for a task: its own choice, else the general one, else '' (the CLI chooses)."""
    s = get_settings()
    return ((s.get("gemini_cli_task_models") or {}).get(task) or s.get("gemini_cli_model") or "").strip()


def gemini_cli_models() -> list[str]:
    """The models the signed-in account can use, as the CLI lists them (agy models / gemini --list-models)."""
    import subprocess
    exe = gemini_cli_exe()
    if not exe:
        raise AIUnavailable("The Antigravity CLI (agy) was not found on this computer.")
    tries = [["models"], ["models", "list"], ["--list-models"]] if _cli_kind(exe) == "agy" else [["--list-models"]]
    for args in tries:
        try:
            r = subprocess.run(exe + args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120, env=_gemini_cli_env())
        except (OSError, subprocess.TimeoutExpired):
            continue
        names: list[str] = []
        for line in (r.stdout or "").splitlines():
            t = line.strip().strip("-*•›>").strip()
            if not t or t.endswith(":") or len(t) > 80 or t.lower().startswith(("usage", "available", "error", "note")):
                continue
            m = re.search(r"\b[a-z][a-z0-9]*(?:[-.][a-z0-9]+)+\b", t)   # a slug such as gemini-3.1-pro-high
            names.append(m.group(0) if m else t)
        names = list(dict.fromkeys(names))
        if r.returncode == 0 and names:
            return names[:60]
    raise AIUnavailable("The CLI listed no models (is it signed in?). Type a model name instead; in a terminal, "
                        "agy models  shows the ones your plan offers.")


def _ask_gemini_cli(system: str, user: "str | list", schema: dict, task: str = "") -> dict:
    """One answer from Google's CLI in headless mode (-p), run in an empty folder that holds only this request: its
    instructions (prompt.md, so a long transcript never hits the command-line length limit) and its pictures and
    videos, which the instructions name as @files. The Gemini CLI also runs read-only (--approval-mode plan); agy
    refuses anything but reading in headless mode unless allowed in its own settings."""
    import shutil
    import subprocess
    import tempfile
    from pathlib import Path
    from ..config import DATA
    exe = gemini_cli_exe()
    if not exe:
        raise AIUnavailable("The Antigravity CLI (agy) was not found on this computer (Settings → AI).")
    kind = _cli_kind(exe)
    label = gemini_cli_label()
    model = gemini_cli_model(task)
    watch = (get_settings().get("gemini_cli_video") or "video") != "frames"
    work = DATA / "tmp" / "google-cli"
    work.mkdir(parents=True, exist_ok=True)
    # "@name" attaches a file: every other @ (a handle in a transcript or a rule) is escaped
    lit = lambda t: re.sub(r"(?<!\\)@", r"\\@", t)   # noqa: E731

    def run(with_video: bool, limit: int, fix: str = "") -> dict:
        with tempfile.TemporaryDirectory(dir=work) as tmp:
            pieces = [lit(system), ""]
            n = 0
            for part in ([user] if isinstance(user, str) else user):
                if isinstance(part, str):
                    pieces.append(lit(part))
                elif "image" in part:
                    n += 1
                    name = f"picture_{n:03d}.jpg"
                    Path(tmp, name).write_bytes(part["image"])
                    pieces.append(f"@{name}")
                elif "video" in part and with_video:
                    src = Path(part["video"])
                    if src.is_file() and src.stat().st_size < MAX_CLI_VIDEO:
                        n += 1
                        name = f"video_{n:03d}{src.suffix.lower()}"
                        shutil.copy2(src, Path(tmp, name))
                        pieces.append(f"@{name} (watch the whole video, with its sound)")
            if fix:
                pieces.append("\nYour previous answer did not match the required format. Problems: " + lit(fix)
                              + "\nAnswer again, fixing exactly these, and keep everything else as before.")
            pieces.append("\nAnswer with one JSON object and nothing else, matching this JSON schema:\n"
                          + lit(json.dumps(schema, separators=(",", ":"))))
            prompt = "\n".join(pieces)
            if kind == "agy":
                Path(tmp, "prompt.md").write_text(prompt, "utf-8")
                base = exe + ["-p", "Read @prompt.md and do exactly what it says, using the files it names. Change no files.",
                              "--output-format", "json"]
                stdin = None
                # Options newer builds take; an older build answers an option it does not know with its help text,
                # so each is dropped in turn (and remembered) until agy runs, ending with what the owner's own test used.
                extras = [("--print-timeout", str(limit)), ("--model", model)] if model else [("--print-timeout", str(limit))]
            else:
                base = exe + ["-p", "Follow the instructions above.", "--output-format", "json", "--approval-mode", "plan", "--skip-trust"]
                stdin = prompt
                extras = [("-m", model)] if model else []
            keep = [x for x in extras if x[0] not in _CLI_REJECTED]
            # all of them; then without each one in turn (so only the refused one is lost); then none
            tries = [keep] + [[x for x in keep if x is not y] for y in keep] + ([[]] if len(keep) > 1 else [])
            for opts in tries:
                cmd = base + [v for pair in opts for v in pair]
                try:
                    r = subprocess.run(cmd, input=stdin, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                       timeout=limit + 120, cwd=tmp, env=_gemini_cli_env())
                except subprocess.TimeoutExpired as e:
                    raise AIUnavailable(f"The {label} took more than {limit // 60} minutes and was stopped.") from e
                except OSError as e:
                    raise AIUnavailable(f"The {label} could not be started: {e}") from e
                if not _printed_help(r):
                    _CLI_REJECTED.update(name for name, _ in keep if (name, dict(keep)[name]) not in opts)   # remember what it refused
                    break
            else:
                raise AIUnavailable(f"The {label} did not accept Cutroom's request and printed its help instead. "
                                    "In a terminal run  agy --help  and send what it shows, so the request can be fitted to your version.")
        data: dict = {}
        raw = ""
        for stream in (r.stdout or "", r.stderr or ""):   # the answer comes on stdout; an error may come as JSON on stderr
            raw = stream.strip()
            if "{" not in raw:
                continue
            try:
                data = json.loads(raw[raw.find("{"):raw.rfind("}") + 1])
                break
            except json.JSONDecodeError:
                continue
        err = data.get("error") or {}
        status = str(data.get("status") or "SUCCESS").upper()
        if r.returncode != 0 or err or status != "SUCCESS" or not data.get("response"):
            printed = "\n".join(x for x in ((r.stderr or "") + "\n" + (r.stdout or "")).splitlines() if x.strip())
            shown = " | ".join(printed.splitlines()[-6:])[-400:]   # the end of what it printed, not just one line
            why = (err.get("message") if isinstance(err, dict) else str(err)) or (data.get("response") if status != "SUCCESS" else "") or shown
            if re.search(r"new version|update (is )?available|please update|out of date", printed, re.I) and not data.get("response"):
                # agy stops to offer an update, which it cannot ask about when run in the background
                raise AIUnavailable(f"The {label} wants to update itself before it will answer. Open a terminal, run  "
                                    f"{'agy' if kind == 'agy' else 'gemini'}  and accept the update (or run  agy update ), then press Test "
                                    f"again. What it printed: {shown[:250]}")
            if not why:
                why = ("it returned an empty answer. In headless mode it quietly refuses anything it is not allowed to do; "
                       "check it is signed in (run  agy  once) and that it may read files in its settings")
            low = why.lower()
            if any(k in low for k in ("login", "sign in", "unauthenticated", "credential", "oauth", "auth method")):
                raise AIUnavailable(f"The {label} is not signed in. Open a terminal, run  {'agy' if kind == 'agy' else 'gemini'}  and sign in with Google.")
            if any(k in low for k in ("quota", "rate limit", "resource_exhausted", "429", "limit reached")):
                raise AIUnavailable(f"Your Gemini plan's usage limit was reached for now: {why[:200]}")
            if "no longer supported" in low and kind == "gemini":
                raise AIUnavailable("The Gemini CLI no longer takes personal Google sign-ins. Install the Antigravity CLI (agy) from antigravity.google.")
            raise AIUnavailable(f"The {label} did not answer: {why[:300]}")
        try:
            return _json_from(str(data["response"]))
        except json.JSONDecodeError as e:
            raise AIUnavailable("Gemini answered, but not with the JSON that was asked for.") from e

    def checked(with_video: bool, limit: int) -> dict:
        """An answer that matches the schema: one retry with the mismatches spelled out, since the CLI cannot be
        held to a schema the way Claude Code's --json-schema is."""
        out = run(with_video, limit)
        problems = _schema_problems(out, schema)
        if not problems:
            return out
        out = run(with_video, limit, "; ".join(problems))
        problems = _schema_problems(out, schema)
        if problems:
            raise AIUnavailable("Gemini's answer did not have the expected shape: " + "; ".join(problems)[:300])
        return out

    has_video = watch and not isinstance(user, str) and any(isinstance(x, dict) and "video" in x for x in user)
    if not has_video:
        return checked(False, AGY_TIMEOUT)
    try:
        return checked(True, VIDEO_TIMEOUT)
    except AIUnavailable as e:
        low = str(e).lower()
        if "not signed in" in low or "usage limit" in low:
            raise   # the frames would fail the same way
        # Frame-by-frame backup: whatever went wrong with the whole videos (too big, too slow, refused, garbled),
        # the same request with the still frames alone still gets an answer.
        out = checked(False, AGY_TIMEOUT)
        out["_watched"] = "frames"
        return out


def _schema_problems(data: object, schema: dict, limit: int = 12) -> list[str]:
    """Where an answer breaks the JSON schema, in plain words ('' list when it fits)."""
    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        return []
    errs = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda e: list(e.path))
    out = []
    for e in errs[:limit]:
        where = "/".join(str(p) for p in e.path) or "the top level"
        out.append(f"at {where}: {e.message[:160]}")
    return out


# ---------------------------------------------------------------- ChatGPT subscription: OpenAI's Codex CLI

CODEX_EFFORTS = ("minimal", "low", "medium", "high", "xhigh")
_CODEX_OK: list[bool] = []   # set once the sign-in has been checked in this run


def codex_exe() -> list[str] | None:
    """The command for the Codex CLI, or None. An npm install on Windows gives a codex.cmd shim, run through its
    JavaScript entry point with node instead (a shell would mangle the arguments)."""
    import os
    import shutil
    from pathlib import Path
    custom = (get_settings().get("codex_path") or "").strip().strip('"')
    found = custom if custom and Path(custom).exists() else shutil.which("codex")
    if not found:
        return None
    if found.lower().endswith((".cmd", ".bat", ".ps1")):
        script = Path(found).parent / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
        node = shutil.which("node")
        return [node, str(script)] if script.exists() and node else None
    return [found] if os.access(found, os.X_OK) or os.name == "nt" else None


def _codex_env() -> dict:
    """Without API keys, so the ChatGPT sign-in (the subscription) is what gets used, not a key that bills."""
    import os
    env = dict(os.environ)
    for k in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"):
        env.pop(k, None)
    env["NO_COLOR"] = "1"
    return env


def codex_status() -> dict:
    """{installed, version, logged_in, method, why} for Settings."""
    import subprocess
    exe = codex_exe()
    if not exe:
        return {"installed": False, "version": "", "logged_in": False, "method": "",
                "why": "The Codex CLI was not found. Install it with  npm install -g @openai/codex  then run  codex login  "
                       "once in a terminal and sign in with your ChatGPT account, or set where it is below."}
    out = {"installed": True, "version": "", "logged_in": False, "method": "", "why": ""}
    try:
        v = subprocess.run(exe + ["--version"], capture_output=True, text=True, timeout=60, env=_codex_env())
        out["version"] = (v.stdout or "").strip().split()[-1] if (v.stdout or "").strip() else ""
        a = subprocess.run(exe + ["login", "status"], capture_output=True, text=True, timeout=60, env=_codex_env())
        said = ((a.stdout or "") + (a.stderr or "")).strip()
        low = said.lower()
        out["logged_in"] = "logged in" in low and "not logged in" not in low   # anything else (a warning, an error) is not
        out["method"] = "ChatGPT" if "chatgpt" in said.lower() else ("API key" if "api key" in said.lower() else "")
    except (OSError, subprocess.TimeoutExpired) as e:
        out["why"] = f"The Codex CLI is installed but did not answer ({e})."
        return out
    if not out["logged_in"]:
        out["why"] = "The Codex CLI is not signed in. Open a terminal, run  codex login  and sign in with your ChatGPT account."
    elif out["method"] == "API key":
        out["why"] = "Codex is signed in with an API key, which is billed per use; run  codex login  to use your ChatGPT plan instead."
    return out


def _strict(schema: dict) -> dict | None:
    """The schema in the strict form OpenAI's structured outputs need (every object closed, every property
    required), or None when it cannot be made strict (an object with no listed properties)."""
    import copy

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "object" or "properties" in n:
                if not n.get("properties"):
                    raise ValueError("open object")
                n["additionalProperties"] = False
                n["required"] = list(n["properties"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    out = copy.deepcopy(schema)
    try:
        walk(out)
    except ValueError:
        return None
    return out


def _ask_codex(system: str, user: "str | list", schema: dict, effort: str = "medium") -> dict:
    """One answer from the Codex CLI (codex exec): read-only sandbox, nothing saved, the person's own Codex config
    and plugins not loaded, run in an empty folder. Pictures are attached with -i; the answer is held to the schema
    with --output-schema and read from the file -o writes."""
    import subprocess
    import tempfile
    from pathlib import Path
    from ..config import DATA
    exe = codex_exe()
    if not exe:
        raise AIUnavailable("The Codex CLI was not found on this computer (Settings → AI).")
    if not _CODEX_OK:   # signed out, Codex keeps retrying for minutes; check first (once per run once it is fine)
        st = codex_status()
        if not st["logged_in"]:
            raise AIUnavailable(st["why"] or "The Codex CLI is not signed in. Open a terminal, run  codex login  and sign in.")
        _CODEX_OK.append(True)
    s = get_settings()
    model = (s.get("codex_model") or "").strip()
    effort = (s.get("codex_effort") or effort or "").strip()
    work = DATA / "tmp" / "codex"
    work.mkdir(parents=True, exist_ok=True)
    strict = _strict(schema)

    def run(enforce: bool, fix: str = "") -> dict:
        with tempfile.TemporaryDirectory(dir=work) as tmp:
            pieces = [system, ""]
            images: list[str] = []
            for part in ([user] if isinstance(user, str) else user):
                if isinstance(part, str):
                    pieces.append(part)
                elif "image" in part:
                    name = str(Path(tmp, f"picture_{len(images) + 1:03d}.jpg"))
                    Path(name).write_bytes(part["image"])
                    images.append(name)
                    pieces.append(f"[picture {len(images)} of the attached pictures]")
                # whole videos: Codex takes pictures only; the stills carry the picture
            if fix:
                pieces.append("\nYour previous answer did not match the required format. Problems: " + fix + "\nAnswer again, fixing exactly these.")
            if not enforce:
                pieces.append("\nAnswer with one JSON object and nothing else, matching this JSON schema:\n" + json.dumps(schema, separators=(",", ":")))
            answer = Path(tmp, "answer.json")
            cmd = exe + ["exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "-s", "read-only",
                         "-C", tmp, "-o", str(answer)]
            if enforce and strict:
                Path(tmp, "schema.json").write_text(json.dumps(strict), "utf-8")
                cmd += ["--output-schema", str(Path(tmp, "schema.json"))]
            if model:
                cmd += ["-m", model]
            if effort in CODEX_EFFORTS or effort == "max":
                cmd += ["-c", f'model_reasoning_effort="{"xhigh" if effort == "max" else effort}"']
            for img in images:
                cmd += ["-i", img]
            cmd += ["--color", "never", "-"]   # the prompt comes on stdin ("-" after a flag, so -i does not take it)
            try:
                r = subprocess.run(cmd, input="\n".join(pieces), capture_output=True, text=True, encoding="utf-8",
                                   errors="replace", timeout=1800, cwd=tmp, env=_codex_env())
            except subprocess.TimeoutExpired as e:
                raise AIUnavailable("The Codex CLI took more than 30 minutes and was stopped.") from e
            except OSError as e:
                raise AIUnavailable(f"The Codex CLI could not be started: {e}") from e
            text = answer.read_text("utf-8").strip() if answer.exists() else ""
        if r.returncode != 0 or not text:
            printed = [x for x in ((r.stderr or "") + "\n" + (r.stdout or "")).splitlines() if x.strip()]
            why = " | ".join(printed[-5:])[-400:] or "no answer"
            low = why.lower()
            if any(k in low for k in ("not logged in", "login", "unauthorized", "401", "sign in")):
                raise AIUnavailable("The Codex CLI is not signed in. Open a terminal, run  codex login  and sign in with your ChatGPT account.")
            if any(k in low for k in ("usage limit", "rate limit", "quota", "429")):
                raise AIUnavailable(f"Your ChatGPT plan's usage limit was reached for now: {why[:200]}")
            if enforce and any(k in low for k in ("schema", "output_schema", "json_schema", "invalid_request")):
                raise _SchemaRefused(why)
            raise AIUnavailable(f"The Codex CLI did not answer: {why[:300]}")
        try:
            return _json_from(text)
        except json.JSONDecodeError as e:
            raise AIUnavailable("ChatGPT answered, but not with the JSON that was asked for.") from e

    if strict:
        try:
            return run(True)
        except AIUnavailable as e:
            if "not signed in" in str(e) or "usage limit" in str(e):
                raise
            # a schema OpenAI would not take as strict (or any other trouble with it): asked for in words instead,
            # and the answer checked against the schema here

    out = run(False)
    problems = _schema_problems(out, schema)
    if problems:
        out = run(False, "; ".join(problems))
        problems = _schema_problems(out, schema)
        if problems:
            raise AIUnavailable("ChatGPT's answer did not have the expected shape: " + "; ".join(problems)[:300])
    return out


class _SchemaRefused(AIUnavailable):
    """Codex would not take the schema as a strict output schema."""
