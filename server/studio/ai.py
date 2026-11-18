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


def available(task: str = "") -> bool:
    return gemini_cli_for(task) or bool(provider())


def provider_label(task: str = "") -> str:
    if gemini_cli_for(task):
        return "Gemini (your Google subscription)"
    return {"anthropic": "Claude", "gemini": "Gemini", "claude_code": "Claude (your subscription)"}.get(provider(), "")


def ask_json(system: str, user: "str | list", schema: dict, max_tokens: int = 32000, effort: str = "medium", task: str = "") -> dict:
    """One structured request. Returns the parsed object or raises AIUnavailable with a readable reason.

    `user` is text, or an ordered list of parts for requests with pictures: plain strings,
    `{"image": <jpeg bytes>}` items and `{"video": <path>, "fps": <optional frames a second>}` items, in the order
    the model should read them.
    Whole videos are only sent to Gemini, which can watch them; Claude gets the stills, so always include stills too.
    """
    if gemini_cli_for(task):
        return _ask_gemini_cli(system, user, schema)
    which = provider()
    if not which:
        raise AIUnavailable(setup_hint())
    if which == "claude_code":
        return _ask_claude_code(system, user, schema, effort)   # already parsed
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
    return gemini_cli_for(task) or provider() == "gemini"


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


# ---------------------------------------------------------------- Gemini CLI (the person's Google subscription)

def gemini_cli_exe() -> list[str] | None:
    """The command that runs Google's Gemini CLI here, or None. An npm install on Windows gives a gemini.cmd shim,
    which cannot run without a shell, so its JavaScript entry point is run with node instead."""
    import os
    import shutil
    from pathlib import Path
    custom = (get_settings().get("gemini_cli_path") or "").strip().strip('"')
    found = custom if custom and Path(custom).exists() else shutil.which("gemini")
    if not found:
        return None
    if found.lower().endswith((".cmd", ".bat", ".ps1")):
        script = Path(found).parent / "node_modules" / "@google" / "gemini-cli" / "bundle" / "gemini.js"
        node = shutil.which("node")
        return [node, str(script)] if script.exists() and node else None
    return [found] if os.access(found, os.X_OK) or os.name == "nt" else None


def _gemini_cli_env() -> dict:
    """Without API keys, so the Google sign-in (the subscription) is what gets used, not a key that bills."""
    import os
    env = dict(os.environ)
    for k in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI", "GOOGLE_GENAI_USE_GCA"):
        env.pop(k, None)
    env["NO_COLOR"] = "1"
    return env


def gemini_cli_status() -> dict:
    """{installed, version, signed_in, why} for Settings. Signed in = the CLI has saved a Google login."""
    import subprocess
    from pathlib import Path
    exe = gemini_cli_exe()
    if not exe:
        return {"installed": False, "version": "", "signed_in": False,
                "why": "The Gemini CLI was not found. Install it with  npm install -g @google/gemini-cli  then run  gemini  "
                       "once in a terminal and choose Sign in with Google (use the account with your Gemini plan)."}
    out = {"installed": True, "version": "", "signed_in": False, "why": ""}
    try:
        v = subprocess.run(exe + ["--version"], capture_output=True, text=True, timeout=60, env=_gemini_cli_env())
        out["version"] = (v.stdout or "").strip().splitlines()[-1] if (v.stdout or "").strip() else ""
    except (OSError, subprocess.TimeoutExpired) as e:
        out["why"] = f"The Gemini CLI is installed but did not answer ({e})."
        return out
    out["signed_in"] = (Path.home() / ".gemini" / "oauth_creds.json").exists()
    if not out["signed_in"]:
        out["why"] = "The Gemini CLI is not signed in. Open a terminal, run  gemini  and choose Sign in with Google."
    return out


def _json_from(text: str) -> dict:
    """The JSON object in a model's text answer (it may come in a code fence or with words around it)."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        a, b = t.find("{"), t.rfind("}")
        if a >= 0 and b > a:
            return json.loads(t[a:b + 1])
        raise


def _ask_gemini_cli(system: str, user: "str | list", schema: dict) -> dict:
    """One answer from the Gemini CLI in headless mode (-p), read-only (--approval-mode plan), run from an empty
    folder that holds only this request's pictures and videos, which the prompt names as @files."""
    import subprocess
    import tempfile
    from ..config import DATA
    exe = gemini_cli_exe()
    if not exe:
        raise AIUnavailable("The Gemini CLI was not found on this computer (Settings → AI).")
    model = (get_settings().get("gemini_cli_model") or "").strip()
    work = DATA / "tmp" / "gemini-cli"
    work.mkdir(parents=True, exist_ok=True)

    def run(with_video: bool) -> dict:
        # "@name" asks the CLI to attach a file: every other @ (a handle in a transcript or a rule) is escaped
        lit = lambda t: re.sub(r"(?<!\\)@", r"\\@", t)   # noqa: E731
        with tempfile.TemporaryDirectory(dir=work) as tmp:
            pieces = [lit(system), ""]
            n = 0
            for part in ([user] if isinstance(user, str) else user):
                if isinstance(part, str):
                    pieces.append(lit(part))
                elif "image" in part:
                    n += 1
                    name = f"picture_{n:03d}.jpg"
                    with open(f"{tmp}/{name}", "wb") as f:
                        f.write(part["image"])
                    pieces.append(f"@{name}")
                elif "video" in part and with_video:
                    import shutil
                    from pathlib import Path
                    src = Path(part["video"])
                    if src.is_file() and src.stat().st_size < 20 * 1024 * 1024:   # the CLI sends files inline
                        n += 1
                        name = f"video_{n:03d}{src.suffix.lower()}"
                        shutil.copy2(src, f"{tmp}/{name}")
                        pieces.append(f"@{name}")
            pieces.append("\nAnswer with one JSON object and nothing else, matching this JSON schema:\n"
                          + lit(json.dumps(schema, separators=(",", ":"))))
            cmd = exe + ["-p", "Follow the instructions above.", "--output-format", "json", "--approval-mode", "plan", "--skip-trust"]
            if model:
                cmd += ["-m", model]
            try:
                r = subprocess.run(cmd, input="\n".join(pieces), capture_output=True, text=True, encoding="utf-8",
                                   timeout=1800, cwd=tmp, env=_gemini_cli_env())
            except subprocess.TimeoutExpired as e:
                raise AIUnavailable("The Gemini CLI took more than 30 minutes and was stopped.") from e
            except OSError as e:
                raise AIUnavailable(f"The Gemini CLI could not be started: {e}") from e
        data: dict = {}
        raw = ""
        for stream in (r.stdout or "", r.stderr or ""):   # the answer comes on stdout, an error as JSON on stderr
            raw = stream.strip()
            if "{" not in raw:
                continue
            try:
                data = json.loads(raw[raw.find("{"):raw.rfind("}") + 1])
                break
            except json.JSONDecodeError:
                continue
        err = data.get("error") or {}
        if r.returncode != 0 or err or not data.get("response"):
            why = (err.get("message") if isinstance(err, dict) else str(err)) or (r.stderr or raw or "no answer").strip().splitlines()[-1]
            low = why.lower()
            if any(k in low for k in ("login", "sign in", "auth", "credential", "oauth")):   # incl. "Please set an Auth method"
                raise AIUnavailable("The Gemini CLI is not signed in. Open a terminal, run  gemini  and choose Sign in with Google.")
            if any(k in low for k in ("quota", "rate limit", "resource_exhausted", "429")):
                raise AIUnavailable(f"Your Gemini plan's usage limit was reached for now: {why[:200]}")
            raise AIUnavailable(f"The Gemini CLI did not answer: {why[:300]}")
        try:
            return _json_from(str(data["response"]))
        except json.JSONDecodeError as e:
            raise AIUnavailable("Gemini answered, but not with the JSON that was asked for.") from e

    try:
        return run(True)
    except AIUnavailable as e:
        if "video" in str(e).lower() or "file" in str(e).lower():
            return run(False)   # a video it could not take: the stills carry the picture
        raise
