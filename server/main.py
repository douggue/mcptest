"""Cutroom API. Run with:  python run.py"""
from __future__ import annotations

import importlib
import mimetypes
import pkgutil

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import auth, jobs
from .config import DATA, WEB, ensure_dirs, get_settings, save_settings

ensure_dirs()
# Windows can map these wrongly through the registry (.js as text/plain stops the interface loading).
for _type, _ext in (("application/javascript", ".js"), ("text/css", ".css"), ("image/svg+xml", ".svg"),
                    ("font/woff2", ".woff2"), ("font/woff", ".woff"), ("application/json", ".json"),
                    ("video/mp4", ".mp4"), ("audio/mp4", ".m4a"), ("audio/wav", ".wav"), ("audio/mpeg", ".mp3")):
    mimetypes.add_type(_type, _ext)

app = FastAPI(title="Cutroom", version="0.1.0")
app.add_middleware(auth.Gate)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

# Every module in server/routers that exposes `router` is mounted automatically.
from . import routers as _routers  # noqa: E402

for mod in pkgutil.iter_modules(_routers.__path__):
    module = importlib.import_module(f"{_routers.__name__}.{mod.name}")
    if hasattr(module, "router"):
        app.include_router(module.router)


@app.get("/api/health")
def health(request: Request) -> dict:
    import shutil
    from .studio import ai
    locked = auth.enabled() and not auth.valid(request.cookies.get(auth.COOKIE))
    if locked:   # tell a visitor nothing but that a login is needed
        return {"ok": True, "auth": True, "signed_in": False}
    return {
        "ok": True,
        "auth": auth.enabled(),
        "signed_in": True,
        "ffmpeg": bool(shutil.which("ffmpeg")),
        "ai": ai.available(),
        "ai_provider": ai.provider_label(),
        "ai_problem": "" if ai.available() else ai.setup_hint(),
        "data": str(DATA),
    }


@app.post("/api/login")
def login(body: dict, request: Request, response: Response) -> dict:
    ip = (request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (request.client.host if request.client else "?"))
    if auth.throttled(ip):
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
    token = auth.login(str(body.get("password", "")), ip)
    if not token:
        raise HTTPException(401, "That password is not right.")
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    response.set_cookie(auth.COOKIE, token, max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, response: Response) -> dict:
    auth.logout(request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")
    return {"ok": True}


@app.get("/api/jobs")
def list_jobs() -> list[dict]:
    return [j.to_dict() for j in jobs.all_jobs()[:50]]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job.to_dict()


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    return {"ok": jobs.cancel(job_id)}


SECRETS = ("anthropic_api_key", "gemini_api_key", "pexels_api_key", "youtube_client_secret")
HIDDEN = ("youtube_channels",)   # OAuth tokens: managed by /api/youtube, never sent to or taken from the browser


@app.get("/api/settings")
def read_settings() -> dict:
    import os
    s = get_settings()
    for key in HIDDEN:
        s.pop(key, None)
    # never send secrets back to the browser; only whether they are set
    for key in SECRETS:
        s[key + "_set"] = bool(s.get(key))
        s[key] = ""
    s["anthropic_api_key_set"] = s["anthropic_api_key_set"] or bool(os.environ.get("ANTHROPIC_API_KEY"))
    s["gemini_api_key_set"] = s["gemini_api_key_set"] or bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    return s


@app.put("/api/settings")
def write_settings(patch: dict) -> dict:
    # an empty secret means "leave unchanged"
    for key in SECRETS:
        if key in patch and not patch[key]:
            patch.pop(key)
    patch = {k: v for k, v in patch.items() if not k.endswith("_set") and k not in HIDDEN}
    save_settings(patch)
    return read_settings()


@app.get("/api/ai/claude-code")
def claude_code_status() -> dict:
    """Is Claude Code installed and signed in on this computer? Server edition: it is not offered."""
    from .studio import ai
    if auth.enabled():
        return {"installed": False, "version": "", "logged_in": False, "method": "", "server_edition": True,
                "why": "The server edition uses API keys. Claude Code with your subscription is for Cutroom on your own computer."}
    return {**ai.claude_code_status(), "server_edition": False}


@app.get("/api/ai/gemini-cli")
def gemini_cli_status() -> dict:
    """Is the Gemini CLI installed and signed in here, and which tasks use it? Not offered on the server edition."""
    from .studio import ai
    if auth.enabled():
        return {"installed": False, "version": "", "signed_in": False, "server_edition": True, "tasks": ai.GEMINI_CLI_TASKS,
                "why": "The server edition uses API keys. Your Google subscription is for Cutroom on your own computer."}
    return {**ai.gemini_cli_status(), "server_edition": False, "tasks": ai.GEMINI_CLI_TASKS}


@app.post("/api/ai/gemini-cli/test")
def gemini_cli_test() -> dict:
    """A tiny request through the Gemini CLI, whatever tasks it is chosen for."""
    import time as _t
    from .studio import ai
    if auth.enabled() or not ai.gemini_cli_exe():
        raise HTTPException(422, "The Antigravity CLI (agy) is not available here.")
    started = _t.time()
    try:
        out = ai._ask_gemini_cli("Answer in the requested format.", "Reply with ok set to true and a three-word greeting.",
                                 {"type": "object", "required": ["ok", "greeting"], "properties": {"ok": {"type": "boolean"}, "greeting": {"type": "string"}}})
    except ai.AIUnavailable as e:
        raise HTTPException(422, str(e))
    return {"ok": bool(out.get("ok")), "greeting": out.get("greeting", ""), "seconds": round(_t.time() - started, 1)}


@app.get("/api/ai/gemini-cli/models")
def gemini_cli_models() -> list[str]:
    """The models the signed-in Google account can use, as the CLI lists them."""
    import re
    import subprocess
    from .studio import ai
    exe = ai.gemini_cli_exe()
    if auth.enabled() or not exe:
        raise HTTPException(422, "The Antigravity CLI (agy) is not available here.")
    if ai._cli_kind(exe) == "agy":
        raise HTTPException(422, "Type the model name (as agy shows it), or leave it empty to let agy choose.")
    try:
        r = subprocess.run(exe + ["--list-models"], capture_output=True, text=True, timeout=120, env=ai._gemini_cli_env())
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(422, f"The Gemini CLI did not answer: {e}")
    names = list(dict.fromkeys(re.findall(r"\b(gemini-[a-z0-9.\-]+)", (r.stdout or "") + (r.stderr or ""))))
    if not names:
        raise HTTPException(422, "No models were listed. Is the Gemini CLI signed in? " + (r.stderr or r.stdout or "").strip()[-200:])
    return names


@app.post("/api/ai/test")
def ai_test() -> dict:
    """A tiny request through the chosen provider, to check the setup works."""
    import time as _t
    from .studio import ai
    started = _t.time()
    try:
        out = ai.ask_json("Answer in the requested format.", "Reply with ok set to true and a three-word greeting.",
                          {"type": "object", "additionalProperties": False, "required": ["ok", "greeting"],
                           "properties": {"ok": {"type": "boolean"}, "greeting": {"type": "string"}}}, max_tokens=200, effort="low")
    except ai.AIUnavailable as e:
        raise HTTPException(422, str(e))
    return {"ok": bool(out.get("ok")), "greeting": out.get("greeting", ""), "provider": ai.provider_label(),
            "seconds": round(_t.time() - started, 1)}


@app.get("/api/ai/models")
def ai_models(provider: str = "anthropic") -> list[dict]:
    """Model choices for Settings. Gemini's come live from Google when a key is set."""
    from .studio import ai
    if provider == "claude_code":
        return ai.CLAUDE_CODE_MODELS
    if provider != "gemini":
        return ai.CLAUDE_MODELS
    try:
        live = ai.gemini_models()
    except ai.AIUnavailable as e:
        raise HTTPException(422, str(e))
    known = {m["id"] for m in ai.GEMINI_MODELS}
    return ai.GEMINI_MODELS + [m for m in live if m["id"] not in known]


app.mount("/media", StaticFiles(directory=DATA), name="media")

_dist = WEB / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (_dist / path).resolve()
        if path and _dist.resolve() in f.parents and f.is_file():
            return FileResponse(f)
        return FileResponse(_dist / "index.html")
